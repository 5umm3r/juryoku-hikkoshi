/*
 * Pure game rules: seeded RNG, gravity schedule, daily stage number,
 * damage cooldown, scoring, achievements. No DOM, no Matter.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = ['down', 'left', 'up', 'right'];
  var DIR_VECTORS = {
    down: { x: 0, y: 1 },
    up: { x: 0, y: -1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  // mulberry32: small, fast, deterministic across JS engines.
  function createRng(seed) {
    var a = seed >>> 0;
    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      int: function (n) { return Math.floor(next() * n); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; }
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** Next `count` gravity directions, never repeating the previous one. */
  function gravitySequence(rng, count, startDir) {
    var seq = [];
    var prev = startDir || 'down';
    for (var i = 0; i < count; i++) {
      var options = DIRS.filter(function (d) { return d !== prev; });
      var d = options[rng.int(options.length)];
      seq.push(d);
      prev = d;
    }
    return seq;
  }

  /**
   * Switch times in seconds.
   * opts: { duration, interval, firstAt }
   */
  function switchTimes(opts) {
    var times = [];
    for (var t = opts.firstAt; t < opts.duration - 0.5; t += opts.interval) {
      times.push(Math.round(t * 1000) / 1000);
    }
    return times;
  }

  function shuffle(rng, arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = rng.int(i + 1);
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /** bag: { box: 6, fridge: 3, ... } -> shuffled list of kinds */
  function furnitureOrder(rng, bag) {
    var list = [];
    Object.keys(bag).forEach(function (k) {
      for (var i = 0; i < bag[k]; i++) list.push(k);
    });
    return shuffle(rng, list);
  }

  /**
   * Daily stage number based on the JST calendar date.
   * epochYmd: 'YYYY-MM-DD' that is No.1.
   */
  function jstYmd(date) {
    var jst = new Date(date.getTime() + 9 * 3600 * 1000);
    var y = jst.getUTCFullYear();
    var m = jst.getUTCMonth() + 1;
    var d = jst.getUTCDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  function dailyStage(date, epochYmd) {
    var ymd = jstYmd(date);
    var a = Date.parse(ymd + 'T00:00:00Z');
    var b = Date.parse(epochYmd + 'T00:00:00Z');
    var no = Math.floor((a - b) / 86400000) + 1;
    return { no: no, ymd: ymd, seed: hashString('juryoku-hikkoshi/' + ymd) };
  }

  /** Remembers when each pair last caused damage. */
  function createCooldown(windowMs) {
    var last = new Map();
    return {
      /** returns true if this pair may register damage at time `now` (ms) */
      tryHit: function (keyA, keyB, now) {
        var key = keyA < keyB ? keyA + '|' + keyB : keyB + '|' + keyA;
        var prev = last.get(key);
        if (prev !== undefined && now - prev < windowMs) return false;
        last.set(key, now);
        return true;
      },
      clear: function () { last.clear(); }
    };
  }

  /** Is a polygon (list of {x,y}) fully inside an axis-aligned rect? */
  function verticesInsideRect(vertices, rect, tolerance) {
    var tol = tolerance || 0;
    for (var i = 0; i < vertices.length; i++) {
      var v = vertices[i];
      if (v.x < rect.x - tol || v.x > rect.x + rect.w + tol) return false;
      if (v.y < rect.y - tol || v.y > rect.y + rect.h + tol) return false;
    }
    return true;
  }

  /** body-like {speed, angularSpeed, isSleeping, isStatic} */
  function isResting(state, limits) {
    if (state.isStatic || state.isSleeping) return true;
    return state.speed < limits.speed && state.angularSpeed < limits.angularSpeed;
  }

  /**
   * items: [{ kind, delivered, broken, damage }]
   * prices: { reward: {kind: yen}, brokenRewardFactor }
   */
  function computeBill(items, prices) {
    var lines = [];
    var reward = 0;
    var damage = 0;
    var deliveredCount = 0;
    // why the rest did not count: still on the truck, outside the room,
    // still moving in the room, or broken
    var missed = { truck: 0, outside: 0, moving: 0, broken: 0 };
    items.forEach(function (it) {
      damage += it.damage;
      if (it.broken) missed.broken++;
      else if (!it.delivered && missed[it.status] !== undefined) missed[it.status]++;
      // broken items never count as delivered
      if (it.delivered && !it.broken) {
        deliveredCount++;
        reward += prices.reward[it.kind];
      }
    });
    Object.keys(prices.reward).forEach(function (kind) {
      var ofKind = items.filter(function (it) { return it.kind === kind; });
      if (!ofKind.length) return;
      var delivered = ofKind.filter(function (it) { return it.delivered && !it.broken; }).length;
      var dmg = ofKind.reduce(function (s, it) { return s + it.damage; }, 0);
      lines.push({ kind: kind, total: ofKind.length, delivered: delivered, reward: delivered * prices.reward[kind], damage: dmg });
    });
    return {
      reward: reward,
      damage: damage,
      total: reward - damage,
      deliveredCount: deliveredCount,
      itemCount: items.length,
      missed: missed,
      lines: lines
    };
  }

  /** Returns a landlord comment key from the bill. */
  function landlordCommentKey(bill) {
    if (bill.deliveredCount === 0) return 'landlord.nothing';
    if (bill.total < 0) return 'landlord.negative';
    if (bill.damage === 0 && bill.deliveredCount >= bill.itemCount * 0.6) return 'landlord.perfect';
    if (bill.damage > bill.reward * 0.5) return 'landlord.messy';
    if (bill.deliveredCount >= bill.itemCount * 0.6) return 'landlord.good';
    return 'landlord.ok';
  }

  /**
   * log: { events: [{type, kind, ...}], bill }
   * Event types: 'ceiling' (furniture hit ceiling while gravity up),
   * 'break' (fishbowl broke), 'damage' ({kind, yen}), 'airborne' (fishbowl long flight)
   */
  function achievements(log) {
    var out = [];
    var ev = log.events;
    function has(fn) { return ev.some(fn); }
    if (has(function (e) { return e.type === 'ceiling' && e.kind === 'piano'; })) out.push('ach.ceilingPiano');
    if (has(function (e) { return e.type === 'break' && e.kind === 'fishbowl' && e.airborne; })) out.push('ach.flyingFish');
    else if (has(function (e) { return e.type === 'break' && e.kind === 'fishbowl'; })) out.push('ach.brokenBowl');
    var fridgeHits = ev.filter(function (e) { return e.type === 'damage' && e.kind === 'fridge'; }).length;
    if (fridgeHits >= 3) out.push('ach.fridgeAvalanche');
    if (log.bill.damage === 0 && log.bill.deliveredCount >= 6) out.push('ach.spotless');
    if (log.bill.deliveredCount >= log.bill.itemCount && log.bill.itemCount > 0) out.push('ach.fullHouse');
    if (log.bill.deliveredCount <= 2) out.push('ach.leftover');
    return out;
  }

  /** localStorage key for the best bill: per daily stage number, or free play. */
  function bestKey(mode) {
    return mode.daily ? 'best.daily.' + mode.no : 'best.free';
  }

  return {
    bestKey: bestKey,
    DIRS: DIRS,
    DIR_VECTORS: DIR_VECTORS,
    createRng: createRng,
    hashString: hashString,
    gravitySequence: gravitySequence,
    switchTimes: switchTimes,
    shuffle: shuffle,
    furnitureOrder: furnitureOrder,
    jstYmd: jstYmd,
    dailyStage: dailyStage,
    createCooldown: createCooldown,
    verticesInsideRect: verticesInsideRect,
    isResting: isResting,
    computeBill: computeBill,
    landlordCommentKey: landlordCommentKey,
    achievements: achievements
  };
});
