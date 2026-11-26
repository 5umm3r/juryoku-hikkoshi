/*
 * Physics simulation and game flow. Depends on Matter and Rules, but never on
 * the DOM, so Node tests can drive it directly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/matter.min.js'), require('./rules.js'));
  } else {
    root.Sim = factory(root.Matter, root.Rules);
  }
})(typeof self !== 'undefined' ? self : this, function (Matter, Rules) {
  'use strict';

  var Engine = Matter.Engine;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Composite = Matter.Composite;
  var Events = Matter.Events;
  var Sleeping = Matter.Sleeping;
  var Query = Matter.Query;

  var CATEGORY_FURNITURE = 0x0001;
  var CATEGORY_WALL = 0x0002;
  var CATEGORY_POINTER = 0x0004; // MouseConstraint; it has no body, so this only enables grabbing

  var DEFAULT_CONFIG = {
    bay: { x: 0, y: 0, w: 240, h: 700 },
    room: { x: 280, y: 0, w: 700, h: 700 },
    // door opening along the bay/room divider: offset from the divider's start and its length
    door: { from: 520, size: 180 },
    wall: 200,
    substepMs: 1000 / 240,
    maxFrameMs: 100,
    maxSpeed: 22,
    maxAngularSpeed: 0.35,
    maxStretch: 90,
    gravityScale: 0.0008,
    duration: 60,
    // 11 s, then every 8.5 s: 6 switches, and nobody sees a switch in the
    // first 10 s, so daily stages are identical for first-timers and veterans
    interval: 8.5,
    firstAt: 11,
    warnLead: 3,
    bag: { box: 6, fridge: 3, piano: 2, fishbowl: 3 },
    bayCapacity: 2,
    spawnInterval: 2,
    spawnGraceMs: 1500,
    maxBodies: 24,
    ropesMax: 3, // tied at the same time; untying gives the rope back
    ropeContactPx: 4, // must touch a wall or floor within this distance to tie
    cooldownMs: 500,
    rest: { speed: 0.15, angularSpeed: 0.01 },
    flyingSpeed: 11,
    // Damage. severity = relative speed x sqrt(mass ratio, clamped), so a heavy
    // item nudging a light one at walking pace is harmless. Falls caused by a
    // gravity switch are capped per period; careless drops are not.
    massRatioClamp: [0.25, 4],
    switchWindowMs: 4000,
    switchCapRatio: 0.15,
    recordHz: 30,
    kinds: {
      box: { w: 56, h: 50, density: 0.0006, friction: 0.6, stiffness: 0.2, sag: 0, threshold: 7, yenPerImpact: 150, cap: 1200, reward: 1200 },
      fridge: { w: 60, h: 110, density: 0.003, friction: 0.4, stiffness: 0.035, sag: 0.55, threshold: 6, yenPerImpact: 600, cap: 5000, reward: 5000 },
      piano: { w: 150, h: 80, density: 0.0025, friction: 0.5, stiffness: 0.045, sag: 0.45, threshold: 6, yenPerImpact: 900, cap: 8000, reward: 8000 },
      fishbowl: { r: 22, density: 0.0012, friction: 0.2, stiffness: 0.15, sag: 0, threshold: 7, switchBreak: 11, fragile: true, cap: 3000, reward: 3000 }
    }
  };

  /** Bay/room/door geometry. Portrait puts the bay above the room. */
  var LAYOUTS = {
    landscape: {
      bay: { x: 0, y: 0, w: 240, h: 700 },
      room: { x: 280, y: 0, w: 700, h: 700 },
      door: { from: 520, size: 180 }
    },
    portrait: {
      bay: { x: 0, y: 0, w: 700, h: 240 },
      room: { x: 0, y: 280, w: 700, h: 700 },
      door: { from: 0, size: 180 }
    }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeConfig(overrides) {
    var cfg = clone(DEFAULT_CONFIG);
    if (!overrides) return cfg;
    Object.keys(overrides).forEach(function (k) {
      var v = overrides[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && cfg[k] && typeof cfg[k] === 'object') {
        Object.keys(v).forEach(function (kk) {
          if (k === 'kinds' && cfg.kinds[kk]) Object.assign(cfg.kinds[kk], v[kk]);
          else cfg[k][kk] = v[kk];
        });
      } else {
        cfg[k] = v;
      }
    });
    return cfg;
  }

  function makeFurnitureBody(kind, spec, x, y) {
    var common = {
      density: spec.density,
      friction: spec.friction,
      frictionAir: 0.01,
      restitution: 0.05,
      collisionFilter: { category: CATEGORY_FURNITURE, mask: CATEGORY_FURNITURE | CATEGORY_WALL | CATEGORY_POINTER }
    };
    var body;
    if (kind === 'fishbowl') {
      body = Bodies.circle(x, y, spec.r, common);
    } else if (kind === 'piano') {
      // concave piano: a top slab plus two legs, as one compound body
      var slabH = 34;
      var legW = 18;
      var legH = spec.h - slabH;
      var top = Bodies.rectangle(x, y - spec.h / 2 + slabH / 2, spec.w, slabH);
      var legL = Bodies.rectangle(x - spec.w / 2 + legW / 2, y + spec.h / 2 - legH / 2, legW, legH);
      var legR = Bodies.rectangle(x + spec.w / 2 - legW / 2, y + spec.h / 2 - legH / 2, legW, legH);
      body = Body.create(Object.assign({ parts: [top, legL, legR] }, common));
      body.parts.forEach(function (p) { p.collisionFilter = body.collisionFilter; });
    } else {
      body = Bodies.rectangle(x, y, spec.w, spec.h, common);
    }
    body.label = 'furniture:' + kind;
    return body;
  }

  /** Local shapes in body frame (angle 0) for drawing and replay. */
  function localShapes(body, kind) {
    if (kind === 'fishbowl') return [{ type: 'circle', x: 0, y: 0, r: body.circleRadius }];
    var parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    return parts.map(function (p) {
      var b = p.bounds;
      return {
        type: 'rect',
        x: (b.min.x + b.max.x) / 2 - body.position.x,
        y: (b.min.y + b.max.y) / 2 - body.position.y,
        w: b.max.x - b.min.x,
        h: b.max.y - b.min.y
      };
    });
  }

  /**
   * The room, truck bay, walls and door, plus fixed-step stepping,
   * velocity caps, held-item gravity compensation and damage detection.
   */
  function createWorld(overrides) {
    var cfg = mergeConfig(overrides);
    var engine = Engine.create({ enableSleeping: true, positionIterations: 8, velocityIterations: 6 });
    engine.gravity.scale = cfg.gravityScale;
    engine.gravity.x = 0;
    engine.gravity.y = 1;

    var T = cfg.wall;
    var bay = cfg.bay;
    var room = cfg.room;
    var left = Math.min(bay.x, room.x);
    var right = Math.max(bay.x + bay.w, room.x + room.w);
    var top = Math.min(bay.y, room.y);
    var bottom = Math.max(bay.y + bay.h, room.y + room.h);
    var W = right - left;
    var H = bottom - top;
    var wallOpts = function (label) {
      return { isStatic: true, label: label, friction: 0.6, collisionFilter: { category: CATEGORY_WALL, mask: CATEGORY_FURNITURE } };
    };
    var walls = [
      Bodies.rectangle(left + W / 2, top - T / 2, W + 2 * T, T, wallOpts('wall:ceiling')),
      Bodies.rectangle(left + W / 2, bottom + T / 2, W + 2 * T, T, wallOpts('wall:floor')),
      Bodies.rectangle(left - T / 2, top + H / 2, T, H + 2 * T, wallOpts('wall:left')),
      Bodies.rectangle(right + T / 2, top + H / 2, T, H + 2 * T, wallOpts('wall:right'))
    ];
    // divider between bay and room, with a door opening
    var vertical = room.x >= bay.x + bay.w; // bay left of the room
    var doorFrom = cfg.door.from !== undefined ? cfg.door.from : cfg.door.y;
    var doorSize = cfg.door.size !== undefined ? cfg.door.size : cfg.door.h;
    // gravity pointing from the room toward the bay closes the door
    var doorCloseDir = vertical ? 'left' : 'up';
    var divRect = vertical
      ? { x: bay.x + bay.w, y: top, w: room.x - (bay.x + bay.w), h: bottom - top }
      : { x: left, y: bay.y + bay.h, w: right - left, h: room.y - (bay.y + bay.h) };
    var doorRect = vertical
      ? { x: divRect.x, y: doorFrom, w: divRect.w, h: doorSize }
      : { x: doorFrom, y: divRect.y, w: doorSize, h: divRect.h };
    function rectBody(r, label) {
      return Bodies.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, wallOpts(label));
    }
    var segs = vertical
      ? [{ x: divRect.x, y: top, w: divRect.w, h: doorRect.y - top }, { x: divRect.x, y: doorRect.y + doorRect.h, w: divRect.w, h: bottom - doorRect.y - doorRect.h }]
      : [{ x: left, y: divRect.y, w: doorRect.x - left, h: divRect.h }, { x: doorRect.x + doorRect.w, y: divRect.y, w: right - doorRect.x - doorRect.w, h: divRect.h }];
    segs.forEach(function (r) { if (r.w > 0.5 && r.h > 0.5) walls.push(rectBody(r, 'wall:divider')); });
    var door = rectBody(doorRect, 'wall:door');
    door.collisionFilter.mask = 0; // starts open
    walls.push(door);
    Composite.add(engine.world, walls);

    var items = [];
    var byBodyId = new Map();
    var held = null;
    var gravityDir = 'down';
    var doorClosed = false;
    var doorWantClosed = false;
    var accumulator = 0;
    var simTime = 0; // ms
    var cooldown = Rules.createCooldown(cfg.cooldownMs);
    var listeners = [];
    var nextId = 1;
    var lastSwitchAt = -Infinity;
    var period = 0;

    function emit(ev) { listeners.forEach(function (fn) { fn(ev); }); }

    function addFurniture(kind, x, y) {
      var spec = cfg.kinds[kind];
      var body = makeFurnitureBody(kind, spec, x, y);
      Composite.add(engine.world, body);
      var item = {
        id: nextId++,
        kind: kind,
        body: body,
        mass: body.mass,
        shapes: localShapes(body, kind),
        broken: false,
        roped: false,
        damage: 0,
        switchDamage: 0,
        switchPeriod: -1
      };
      items.push(item);
      byBodyId.set(body.id, item);
      return item;
    }

    function wakeAll() {
      Composite.allBodies(engine.world).forEach(function (b) {
        if (!b.isStatic) Sleeping.set(b, false);
      });
    }

    function setGravity(dir) {
      var v = Rules.DIR_VECTORS[dir];
      engine.gravity.x = v.x;
      engine.gravity.y = v.y;
      gravityDir = dir;
      lastSwitchAt = simTime;
      period++;
      wakeAll();
      // door closes while gravity points at it, so nothing slides back out
      doorWantClosed = dir === doorCloseDir;
      updateDoor();
    }

    function doorBlocked() {
      var bodies = items.filter(function (it) { return !it.body.isStatic; }).map(function (it) { return it.body; });
      return Query.region(bodies, door.bounds).length > 0;
    }

    function updateDoor() {
      if (doorWantClosed && !doorClosed && !doorBlocked()) {
        doorClosed = true;
        door.collisionFilter.mask = CATEGORY_FURNITURE;
      } else if (!doorWantClosed && doorClosed) {
        doorClosed = false;
        door.collisionFilter.mask = 0;
      }
    }

    var holdConstraint = null;
    /** item: furniture being dragged; constraint: the grab constraint (MouseConstraint.constraint) */
    function setHeld(item, constraint) {
      held = item || null;
      holdConstraint = held ? constraint || null : null;
    }

    // Drop the grab when the pointer runs far ahead of the item (e.g. behind a wall)
    function checkStretch() {
      if (!held || !holdConstraint || !holdConstraint.bodyB) return;
      var c = holdConstraint;
      var b = c.bodyB;
      var px = b.position.x + (c.pointB ? c.pointB.x : 0);
      var py = b.position.y + (c.pointB ? c.pointB.y : 0);
      var dx = c.pointA.x - px;
      var dy = c.pointA.y - py;
      if (dx * dx + dy * dy > cfg.maxStretch * cfg.maxStretch) {
        var item = held;
        c.bodyB = null;
        c.pointB = { x: 0, y: 0 };
        held = null;
        holdConstraint = null;
        emit({ type: 'release', id: item.id, t: simTime });
      }
    }

    function setRoped(item, on) {
      if (item.roped === on) return;
      item.roped = on;
      Body.setStatic(item.body, on);
      if (!on) {
        Sleeping.set(item.body, false);
        Body.setVelocity(item.body, { x: 0, y: 0 });
      }
    }

    function capVelocity(body) {
      var v = Body.getVelocity(body);
      var s = Math.sqrt(v.x * v.x + v.y * v.y);
      if (s > cfg.maxSpeed) {
        Body.setVelocity(body, { x: v.x / s * cfg.maxSpeed, y: v.y / s * cfg.maxSpeed });
      }
      var av = Body.getAngularVelocity(body);
      if (Math.abs(av) > cfg.maxAngularSpeed) {
        Body.setAngularVelocity(body, av > 0 ? cfg.maxAngularSpeed : -cfg.maxAngularSpeed);
      }
    }

    var prevPos = new Map();

    Events.on(engine, 'beforeUpdate', function () {
      for (var i = 0; i < items.length; i++) {
        var bp = items[i].body.position;
        prevPos.set(items[i].id, { x: bp.x, y: bp.y });
      }
      if (held && !held.body.isStatic) {
        // a held item ignores gravity, except heavy items sag toward it
        var spec = cfg.kinds[held.kind];
        var k = held.body.mass * engine.gravity.scale * (1 - spec.sag);
        held.body.force.x -= engine.gravity.x * k;
        held.body.force.y -= engine.gravity.y * k;
      }
    });

    Events.on(engine, 'afterUpdate', function () {
      // Constraints (the grab) move positions directly, bypassing the velocity
      // cap. Clamp per-substep displacement so nothing can jump a wall.
      var maxStep = cfg.maxSpeed * (cfg.substepMs / (1000 / 60)) * 1.2;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.body.isStatic) continue;
        capVelocity(it.body);
        var prev = prevPos.get(it.id);
        if (!prev) continue;
        var p = it.body.position;
        var dx = p.x - prev.x;
        var dy = p.y - prev.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxStep) {
          Body.setPosition(it.body, { x: prev.x + dx / d * maxStep, y: prev.y + dy / d * maxStep }, false);
        }
      }
    });

    Events.on(engine, 'collisionStart', function (event) {
      event.pairs.forEach(function (pair) {
        var a = pair.bodyA.parent;
        var b = pair.bodyB.parent;
        if (a.label === 'wall:door' || b.label === 'wall:door') {
          if (!doorClosed) return;
        }
        var ia = byBodyId.get(a.id);
        var ib = byBodyId.get(b.id);
        if (!ia && !ib) return;
        // freshly unloaded items settle without costing anything, to either side
        if ((ia && ia.graceUntil > simTime) || (ib && ib.graceUntil > simTime)) return;
        var va = a.isStatic ? { x: 0, y: 0 } : Body.getVelocity(a);
        var vb = b.isStatic ? { x: 0, y: 0 } : Body.getVelocity(b);
        var rel = Math.sqrt(Math.pow(va.x - vb.x, 2) + Math.pow(va.y - vb.y, 2));
        if (rel < 0.5) return;
        if (!cooldown.tryHit(a.id, b.id, simTime)) return;
        [[ia, b, ib], [ib, a, ia]].forEach(function (t) {
          var item = t[0];
          var other = t[1];
          var otherItem = t[2];
          if (!item) return;
          var ratio = otherItem ? otherItem.mass / item.mass : 1;
          ratio = Math.min(cfg.massRatioClamp[1], Math.max(cfg.massRatioClamp[0], ratio));
          var impact = rel * Math.sqrt(ratio);
          // the room's ceiling: a wall touching the room's top edge (the outer
          // ceiling in landscape, the bay divider or door in portrait)
          if (gravityDir === 'up' && rel > 3 && other.label.indexOf('wall:') === 0 && !inBay(item) &&
              item.body.bounds.min.y <= room.y + 8 && other.bounds.max.y <= room.y + 8) {
            emit({ type: 'ceiling', kind: item.kind, id: item.id, t: simTime });
          }
          registerImpact(item, impact, rel);
        });
        emit({ type: 'contact', speed: rel, t: simTime });
      });
    });

    function inBay(item) {
      var p = item.body.position;
      return p.x >= bay.x && p.x <= bay.x + bay.w && p.y >= bay.y && p.y <= bay.y + bay.h;
    }

    function registerImpact(item, impact, rel) {
      var spec = cfg.kinds[item.kind];
      if (item.broken || impact <= spec.threshold) return;
      // nothing that happens on the truck is billed
      if (inBay(item)) return;
      // a fall caused by the latest gravity switch (item not held) is capped
      var bySwitch = held !== item && simTime - lastSwitchAt < cfg.switchWindowMs;
      if (bySwitch && item.switchPeriod !== period) {
        item.switchPeriod = period;
        item.switchDamage = 0;
      }
      var yen;
      if (spec.fragile) {
        if (bySwitch && spec.switchBreak && impact <= spec.switchBreak) return;
        item.broken = true;
        yen = Math.min(spec.cap, spec.cap - item.damage);
        emit({ type: 'break', kind: item.kind, id: item.id, yen: yen, airborne: rel >= cfg.flyingSpeed, t: simTime });
      } else {
        yen = Math.round((impact - spec.threshold) * spec.yenPerImpact);
        yen = Math.min(yen, spec.cap - item.damage);
        if (bySwitch) yen = Math.min(yen, Math.round(spec.reward * cfg.switchCapRatio) - item.switchDamage);
        if (yen <= 0) return;
      }
      if (bySwitch) item.switchDamage += yen;
      item.damage += yen;
      emit({ type: 'damage', kind: item.kind, id: item.id, yen: yen, impact: impact, bySwitch: bySwitch, t: simTime });
    }

    /** Touching a wall, the floor, the ceiling or a closed door (axis-aligned bounds test). */
    function touchesWall(item) {
      var b = item.body.bounds;
      var e = cfg.ropeContactPx;
      var grown = { min: { x: b.min.x - e, y: b.min.y - e }, max: { x: b.max.x + e, y: b.max.y + e } };
      return walls.some(function (w) {
        if (w === door && !doorClosed) return false;
        return Matter.Bounds.overlaps(grown, w.bounds);
      });
    }

    function substep() {
      Engine.update(engine, cfg.substepMs);
      simTime += cfg.substepMs;
      checkStretch();
      if (doorWantClosed !== doorClosed) updateDoor();
    }

    /** Advance by wall-clock ms using fixed substeps. Returns substeps run. */
    function step(ms) {
      accumulator += Math.min(ms, cfg.maxFrameMs);
      var n = 0;
      while (accumulator >= cfg.substepMs) {
        substep();
        accumulator -= cfg.substepMs;
        n++;
      }
      return n;
    }

    function isInRoom(item, rect) {
      var r = rect || room;
      var verts = [];
      var parts = item.body.parts.length > 1 ? item.body.parts.slice(1) : [item.body];
      parts.forEach(function (p) { verts = verts.concat(p.vertices); });
      return Rules.verticesInsideRect(verts, r, 1);
    }

    function isResting(item) {
      var b = item.body;
      return Rules.isResting({
        isStatic: b.isStatic,
        isSleeping: b.isSleeping,
        speed: b.isStatic ? 0 : Body.getSpeed(b),
        angularSpeed: b.isStatic ? 0 : Math.abs(Body.getAngularSpeed(b))
      }, cfg.rest);
    }

    function snapshot() {
      return {
        t: simTime,
        g: gravityDir,
        door: doorClosed,
        bodies: items.map(function (it) {
          var p = it.body.position;
          return [it.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(it.body.angle * 1000) / 1000, it.broken ? 1 : 0, it.roped ? 1 : 0];
        })
      };
    }

    return {
      cfg: cfg,
      engine: engine,
      walls: walls,
      door: door,
      items: items,
      addFurniture: addFurniture,
      setGravity: setGravity,
      setHeld: setHeld,
      setRoped: setRoped,
      step: step,
      isInRoom: isInRoom,
      isResting: isResting,
      touchesWall: touchesWall,
      snapshot: snapshot,
      doorRect: doorRect,
      itemForBody: function (body) { return byBodyId.get((body.parent || body).id) || null; },
      on: function (fn) { listeners.push(fn); },
      get gravity() { return gravityDir; },
      get doorClosed() { return doorClosed; },
      get time() { return simTime; },
      get held() { return held; },
      bounds: { left: left, right: right, top: top, bottom: bottom }
    };
  }

  /**
   * A 60 second stage: gravity schedule, truck spawns, ropes, recording, result.
   * opts: { seed, firstPlay, config }
   */
  function createGame(opts) {
    var layout = LAYOUTS[opts.layout || 'landscape'];
    var world = createWorld(Object.assign({}, layout, opts.config || {}));
    var cfg = world.cfg;
    var rng = Rules.createRng(opts.seed);
    var order = Rules.furnitureOrder(rng, cfg.bag).slice(0, cfg.maxBodies);
    var times = Rules.switchTimes({ duration: cfg.duration, interval: cfg.interval, firstAt: cfg.firstAt });
    var dirs = Rules.gravitySequence(rng, times.length, 'down');
    var schedule = times.map(function (t, i) { return { at: t * 1000, dir: dirs[i], warned: false, done: false }; });
    var queue = order.slice();
    var lastSpawn = -Infinity;
    var period = 0;
    var events = [];
    var log = [];
    var frames = [];
    var lastRecord = -Infinity;
    var ended = false;
    var result = null;
    var pending = [];

    world.on(function (ev) {
      if (ev.type === 'contact') { pending.push(ev); return; }
      log.push(ev);
      pending.push(ev);
    });

    function bayCount() {
      return world.items.filter(function (it) { return world.isInRoom(it, cfg.bay) || isOverlappingBay(it); }).length;
    }
    function isOverlappingBay(it) {
      var c = it.body.position;
      return c.x < cfg.bay.x + cfg.bay.w && c.x > cfg.bay.x && c.y > cfg.bay.y && c.y < cfg.bay.y + cfg.bay.h;
    }

    function trySpawn() {
      if (!queue.length) return;
      var now = world.time;
      if (now - lastSpawn < cfg.spawnInterval * 1000) return;
      if (bayCount() >= cfg.bayCapacity) return;
      // drop off the truck near the bay surface gravity points at; if that
      // spot is taken, try spots further back toward the opposite side
      var g = Rules.DIR_VECTORS[world.gravity];
      var bodies = world.items.map(function (it) { return it.body; });
      var cx = cfg.bay.x + cfg.bay.w / 2;
      var cy = cfg.bay.y + cfg.bay.h / 2;
      var reachX = Math.max(0, cfg.bay.w / 2 - 90);
      var reachY = Math.max(0, cfg.bay.h / 2 - 90);
      var spot = null;
      // perpendicular to gravity: also try beside the center (wide bays)
      var lat = { x: Math.abs(g.y) * Math.max(0, cfg.bay.w / 2 - 100), y: Math.abs(g.x) * Math.max(0, cfg.bay.h / 2 - 100) };
      var door = world.doorRect;
      for (var f = 1; f >= -1 && !spot; f -= 0.5) {
        for (var l = 0; l < 3 && !spot; l++) {
          var side = l === 0 ? 0 : l === 1 ? 1 : -1;
          var x = cx + g.x * reachX * f + lat.x * side;
          var y = cy + g.y * reachY * f + lat.y * side;
          var probe = { min: { x: x - 80, y: y - 70 }, max: { x: x + 80, y: y + 70 } };
          var overDoor = probe.max.x > door.x && probe.min.x < door.x + door.w && probe.max.y > door.y - 4 && probe.min.y < door.y + door.h + 4;
          if (!overDoor && !Query.region(bodies, probe).length) spot = { x: x, y: y };
        }
      }
      if (!spot) return;
      var x0 = spot.x;
      var y0 = spot.y;
      var kind = queue.shift();
      var item = world.addFurniture(kind, x0, y0);
      item.graceUntil = now + cfg.spawnGraceMs;
      lastSpawn = now;
      pending.push({ type: 'spawn', id: item.id, kind: kind, t: now });
    }

    function record() {
      var interval = 1000 / cfg.recordHz;
      if (world.time - lastRecord >= interval - 1e-6) {
        frames.push(world.snapshot());
        lastRecord = world.time;
      }
    }

    function finish() {
      if (result) return result;
      ended = true;
      world.setHeld(null);
      var itemResults = world.items.map(function (it) {
        return {
          id: it.id,
          kind: it.kind,
          delivered: world.isInRoom(it) && world.isResting(it),
          broken: it.broken,
          damage: it.damage
        };
      });
      // furniture still on the truck counts as not delivered
      queue.forEach(function (kind) { itemResults.push({ id: 0, kind: kind, delivered: false, broken: false, damage: 0 }); });
      var bill = Rules.computeBill(itemResults, { reward: mapKinds(function (k) { return cfg.kinds[k].reward; }) });
      var worst = null;
      log.forEach(function (e) { if (e.type === 'damage' && (!worst || e.yen > worst.yen)) worst = e; });
      result = {
        bill: bill,
        items: itemResults,
        comment: Rules.landlordCommentKey(bill),
        achievements: Rules.achievements({ events: log, bill: bill }),
        worst: worst,
        frames: frames,
        log: log
      };
      pending.push({ type: 'end', result: result });
      return result;
    }

    function mapKinds(fn) {
      var o = {};
      Object.keys(cfg.kinds).forEach(function (k) { o[k] = fn(k); });
      return o;
    }

    /** Advance game by wall-clock ms; returns events that happened. */
    function advance(ms) {
      if (ended) return [];
      var budget = Math.min(ms, cfg.maxFrameMs);
      var stepMs = 1000 / cfg.recordHz;
      while (budget > 0 && !ended) {
        var chunk = Math.min(budget, stepMs);
        budget -= chunk;
        world.step(chunk);
        var now = world.time;
        schedule.forEach(function (s, i) {
          if (!s.warned && now >= s.at - cfg.warnLead * 1000) {
            s.warned = true;
            pending.push({ type: 'warn', dir: s.dir, at: s.at, index: i, tutorial: !!opts.firstPlay && i === 0 });
          }
          if (!s.done && now >= s.at) {
            s.done = true;
            world.setGravity(s.dir);
            period++;
            pending.push({ type: 'switch', dir: s.dir, index: i });
          }
        });
        trySpawn();
        record();
        if (now >= cfg.duration * 1000) finish();
      }
      var out = pending;
      pending = [];
      return out;
    }

    function ropedCount() {
      return world.items.filter(function (it) { return it.roped; }).length;
    }

    function toggleRope(item) {
      if (ended) return { ok: false, reason: 'ended' };
      if (item.roped) {
        world.setRoped(item, false);
        return { ok: true, roped: false };
      }
      if (ropedCount() >= cfg.ropesMax) return { ok: false, reason: 'limit' };
      if (!world.touchesWall(item)) return { ok: false, reason: 'airborne' };
      if (world.held === item) world.setHeld(null);
      world.setRoped(item, true);
      return { ok: true, roped: true };
    }

    return {
      world: world,
      cfg: cfg,
      order: order,
      schedule: schedule,
      advance: advance,
      finish: finish,
      toggleRope: toggleRope,
      get ropesLeft() { return cfg.ropesMax - ropedCount(); },
      layout: opts.layout || 'landscape',
      get timeLeft() { return Math.max(0, cfg.duration * 1000 - world.time); },
      get queueLength() { return queue.length; },
      get ended() { return ended; },
      get result() { return result; },
      get frames() { return frames; },
      get period() { return period; }
    };
  }

  /** Frames within [t-before, t+after] ms around a moment, for slow replay. */
  function replayWindow(frames, t, beforeMs, afterMs) {
    return frames.filter(function (f) { return f.t >= t - beforeMs && f.t <= t + afterMs; });
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    LAYOUTS: LAYOUTS,
    POINTER_FILTER: { category: CATEGORY_POINTER, mask: CATEGORY_FURNITURE },
    mergeConfig: mergeConfig,
    createWorld: createWorld,
    createGame: createGame,
    replayWindow: replayWindow
  };
});
