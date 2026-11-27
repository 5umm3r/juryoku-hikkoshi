/* Browser glue: screens, input (MouseConstraint), loop, pause, result, replay, share. */
(function () {
  'use strict';

  var t = I18n.t;
  var yen = I18n.yen;
  var EPOCH = '2026-11-01'; // No.1 in JST
  var TOUCH_LIFT = 46; // CSS px: grab point sits above the finger
  var LONG_PRESS_MS = 450;
  var TAP_MOVE = 10;
  var DEBUG = /[?&]debug\b/.test(location.search);
  var ALL_ACH = ['ach.ceilingPiano', 'ach.flyingFish', 'ach.brokenBowl', 'ach.fridgeAvalanche', 'ach.spotless', 'ach.fullHouse', 'ach.leftover'];

  var $ = function (id) { return document.getElementById(id); };
  var screens = { title: $('screen-title'), game: $('screen-game'), result: $('screen-result') };
  var board = $('board');
  var ctx = board.getContext('2d');
  var stage = $('stage');

  var game = null;
  var mode = null; // {daily:boolean, no, seed}
  var info = new Map();
  var mouse = null;
  var mc = null;
  var view = null;
  var dpr = 1;
  var paused = false;
  var dropDelta = true;
  var lastTs = 0;
  var warning = null;
  var touchMode = false;
  var liftActive = false; // touch: after grabbing, hold the item above the finger
  var suppressGrab = false;
  var tap = null;
  var toastTimer = 0;
  var calloutTimer = 0;
  // before play: a work order (and, the first time, a practice run)
  var briefing = false;
  var briefKind = null;
  var practice = null; // {step: drag|rope|switch|done, switchedAt}
  // live feedback: badges on paid items and rising amounts
  var marks = null;
  var PRACTICE_CONFIG = { bag: { box: 1, fridge: 0, piano: 0, fishbowl: 0 }, firstAt: 9999, duration: 3600 };
  // per-game guidance, driven by what the player has done (not by play count)
  var guide = null;
  var lastResult = null;
  var replay = null;
  var ropeArmed = false; // HUD rope button pressed: next tap/click ties or unties
  var longPressTimer = 0;
  var sharePrep = null;

  I18n.setLang('ja');
  I18n.apply(document);
  document.title = t('app.title');

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
  }

  // ---------- title ----------
  function daily() { return Rules.dailyStage(new Date(), EPOCH); }

  function renderTitle() {
    var d = daily();
    $('btn-daily').textContent = t('menu.daily', { no: d.no });
    var bestDaily = Store.get(Rules.bestKey({ daily: true, no: d.no }), null);
    var bestFree = Store.get(Rules.bestKey({ daily: false }), null);
    $('best-label').textContent = t('menu.bestDaily', { no: d.no, yen: bestDaily === null ? t('menu.noRecord') : yen(bestDaily) }) +
      '\n' + t('menu.bestFree', { yen: bestFree === null ? t('menu.noRecord') : yen(bestFree) });
    var got = Store.get('achievements', []);
    $('ach-label').textContent = t('menu.achievements', { n: got.length, total: ALL_ACH.length });
    var ul = $('ach-list');
    ul.innerHTML = '';
    ALL_ACH.forEach(function (k) {
      var li = document.createElement('li');
      var has = got.indexOf(k) >= 0;
      li.textContent = has ? t(k) : t('menu.lockedAch');
      if (has) li.className = 'got';
      ul.appendChild(li);
    });
    show('title');
  }

  // ---------- game ----------
  /** Title/retry entry: practice once, then the work order before every job. */
  function begin(m) {
    if (!Store.get('practiceDone', false)) {
      start(m, true);
      showBrief('practice');
    } else {
      start(m, false);
      showBrief('job');
    }
  }

  function showBrief(kind) {
    briefKind = kind;
    briefing = true;
    var main, sub, go, kicker;
    if (kind === 'job') {
      var total = game.order.reduce(function (s, k) { return s + game.cfg.kinds[k].reward; }, 0);
      kicker = t('brief.kicker'); main = t('brief.main');
      sub = t('brief.sub', { n: game.order.length, yen: yen(total) }); go = t('brief.go');
    } else if (kind === 'practice') {
      kicker = t('practice.kicker'); main = t('practice.main'); sub = t('practice.sub'); go = t('practice.go');
    } else {
      kicker = t('practice.doneKicker'); main = t('practice.doneMain'); sub = t('practice.doneSub'); go = t('practice.doneGo');
    }
    $('brief-kicker').textContent = kicker;
    $('brief-main').textContent = main;
    $('brief-sub').textContent = sub;
    $('brief-go').textContent = go;
    $('btn-skip-practice').hidden = kind !== 'practice';
    $('brief').hidden = false;
  }

  function closeBrief() {
    if (!briefing) return;
    Sfx.unlock();
    $('brief').hidden = true;
    briefing = false;
    dropDelta = true;
    if (briefKind === 'practiceDone') {
      start(mode, false); // the done sheet already said what the job is
    } else if (briefKind === 'practice') {
      callout(t('practice.drag'), 60000);
    }
  }
  $('brief').addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#btn-skip-practice')) return;
    closeBrief();
  });
  $('btn-skip-practice').addEventListener('click', function () {
    Store.set('practiceDone', true);
    $('brief').hidden = true;
    briefing = false;
    start(mode, false);
    showBrief('job');
  });

  function start(m, isPractice) {
    mode = m;
    var firstPlay = !Store.get('tutorialDone', false);
    show('game');
    var sr = stage.getBoundingClientRect();
    var layout = sr.height > sr.width * 1.05 ? 'portrait' : 'landscape';
    game = Sim.createGame({ seed: isPractice ? 1 : m.seed, firstPlay: firstPlay, layout: layout, config: isPractice ? PRACTICE_CONFIG : undefined });
    practice = isPractice ? { step: 'drag', switchedAt: null } : null;
    marks = { steady: new Map(), popped: new Set(), pops: [] };
    briefing = false;
    $('brief').hidden = true;
    ropeArmed = false;
    $('btn-rope').classList.remove('armed');
    info = new Map();
    warning = null;
    paused = false;
    dropDelta = true;
    suppressGrab = false;
    $('pause').hidden = true;
    board.style.visibility = 'visible';
    $('callout').hidden = true;
    guide = { grabbed: false, delivered: false, ropeHinted: false, ropeHintId: null, ropeHintUntil: 0, firstWarn: true, explainFall: false, lastSwitch: -Infinity };
    lastDamage = 0;
    hudSteady = Rules.createSteady(300);
    $('toast').hidden = true;
    resize();
    setupMouse();
    updateHud();
  }

  function setupMouse() {
    if (mc) {
      Matter.Events.off(mc);
    }
    if (!mouse) {
      board.setAttribute('data-pixel-ratio', String(dpr));
      mouse = Matter.Mouse.create(board);
    }
    mouse.pixelRatio = dpr;
    mc = Matter.MouseConstraint.create(game.world.engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, damping: 0.1, render: { visible: false } },
      collisionFilter: Sim.POINTER_FILTER
    });
    Matter.Composite.add(game.world.engine.world, mc);
    Matter.Events.on(mc, 'startdrag', function (e) {
      var item = game.world.itemForBody(e.body);
      if (suppressGrab || !item || item.body.isStatic || game.ended) {
        mc.constraint.bodyB = null;
        mc.body = null;
        return;
      }
      mc.constraint.stiffness = game.cfg.kinds[item.kind].stiffness;
      mc.constraint.angularStiffness = 0;
      game.world.setHeld(item, mc.constraint);
      if (guide) guide.grabbed = true;
    });
    Matter.Events.on(mc, 'enddrag', function () { game.world.setHeld(null); });
    updateMouseTransform();
  }

  function updateMouseTransform() {
    if (!mouse || !view) return;
    var s = view.scale / dpr; // CSS px per world unit
    // hit-testing uses the real finger position; the lift only applies while
    // dragging, capped below the release distance so it never drops the item
    var liftWorld = touchMode && liftActive ? Math.min(TOUCH_LIFT / s, game ? game.cfg.maxStretch * 0.6 : 50) : 0;
    Matter.Mouse.setScale(mouse, { x: 1 / s, y: 1 / s });
    Matter.Mouse.setOffset(mouse, { x: -view.ox / dpr / s, y: -view.oy / dpr / s - liftWorld });
  }

  function resize() {
    var r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    board.width = Math.max(1, Math.round(r.width * dpr));
    board.height = Math.max(1, Math.round(r.height * dpr));
    if (mouse) mouse.pixelRatio = dpr;
    board.setAttribute('data-pixel-ratio', String(dpr));
    if (game) view = Render.computeView(board.width, board.height, game.world.bounds);
    updateMouseTransform();
    placeCallout();
  }

  /**
   * Landscape: the strip above the canvas is too thin, so the callout goes inside
   * the room, below the room label and left of the gravity arrow, where it covers
   * neither the bay label nor the items resting on the floor. Portrait keeps the
   * stylesheet position (the empty band above the building).
   */
  function placeCallout() {
    var el = $('callout');
    if (!game || !view || game.layout !== 'landscape') {
      el.style.left = el.style.top = el.style.width = el.style.right = el.style.maxWidth = '';
      return;
    }
    var room = game.cfg.room;
    var s = view.scale / dpr; // CSS px per world unit
    var left = (room.x + 16) * s + view.ox / dpr;
    var right = (room.x + room.w - 90) * s + view.ox / dpr;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round((room.y + 60) * s + view.oy / dpr) + 'px';
    el.style.width = Math.max(120, Math.round(right - left)) + 'px';
    el.style.right = 'auto';
    el.style.maxWidth = 'none';
  }
  window.addEventListener('resize', resize);
  // the HUD can wrap to two rows and shrink the stage without a window resize
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(stage);

  function eventWorldPoint(clientX, clientY) {
    var r = board.getBoundingClientRect();
    return Render.toWorld(view, (clientX - r.left) * dpr, (clientY - r.top) * dpr);
  }

  function itemAt(p) {
    var bodies = game.world.items.map(function (it) { return it.body; });
    var hit = Matter.Query.point(bodies, p);
    return hit.length ? game.world.itemForBody(hit[0]) : null;
  }

  function rope(p) {
    if (!game || game.ended || paused) return;
    var item = itemAt(p);
    if (!item) return;
    if (mc && mc.constraint.bodyB) { mc.constraint.bodyB = null; mc.body = null; }
    game.world.setHeld(null);
    var r = game.toggleRope(item);
    if (r.ok && r.roped) {
      Store.set('ropeUsed', true);
      addPop(item, t('pop.roped'), 'rope', 2600);
      if (guide) guide.ropeHintId = null;
      hideCallout();
    }
    if (r.ok) toast(t(r.roped ? 'toast.roped' : 'toast.unroped'));
    else if (r.reason === 'limit') toast(t('toast.ropeLimit'));
    else if (r.reason === 'airborne') toast(t('toast.ropeAirborne'));
    updateHud();
  }

  // capture on the stage so it runs before Matter's listeners on the canvas
  stage.addEventListener('touchstart', function (e) {
    Sfx.unlock();
    if (!touchMode) touchMode = true;
    var tt = e.changedTouches[0];
    tap = { x: tt.clientX, y: tt.clientY, at: performance.now(), moved: false };
    if (ropeArmed) {
      suppressGrab = true;
      disarmRope();
      rope(eventWorldPoint(tap.x, tap.y));
      return;
    }
    // long press without moving ties/unties (a plain tap never does)
    clearTimeout(longPressTimer);
    var pressed = tap;
    longPressTimer = setTimeout(function () {
      if (tap === pressed && !tap.moved) {
        suppressGrab = true;
        rope(eventWorldPoint(pressed.x, pressed.y));
      }
    }, LONG_PRESS_MS);
  }, { capture: true, passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!tap) return;
    var tt = e.changedTouches[0];
    if (Math.abs(tt.clientX - tap.x) + Math.abs(tt.clientY - tap.y) > TAP_MOVE) {
      tap.moved = true;
      // lift the item above the finger only once the finger actually drags,
      // so a long press keeps it on the floor (and tieable)
      if (!liftActive && game && game.world.held) { liftActive = true; updateMouseTransform(); }
    }
  }, { capture: true, passive: true });
  stage.addEventListener('touchend', function () {
    clearTimeout(longPressTimer);
    tap = null;
    suppressGrab = false;
    if (liftActive) { liftActive = false; updateMouseTransform(); }
  }, { capture: true, passive: true });
  stage.addEventListener('mousedown', function (e) {
    Sfx.unlock();
    if (touchMode && !tap) { touchMode = false; updateMouseTransform(); }
    if (ropeArmed && !touchMode) {
      suppressGrab = true;
      disarmRope();
      rope(eventWorldPoint(e.clientX, e.clientY));
    }
  }, true);
  function disarmRope() {
    ropeArmed = false;
    $('btn-rope').classList.remove('armed');
  }
  $('btn-rope').addEventListener('click', function () {
    ropeArmed = !ropeArmed;
    $('btn-rope').classList.toggle('armed', ropeArmed);
    if (ropeArmed) toast(t('toast.ropeArmed'));
  });
  window.addEventListener('mouseup', function () { suppressGrab = false; });
  board.addEventListener('dblclick', function (e) {
    if (touchMode) return;
    rope(eventWorldPoint(e.clientX, e.clientY));
  });
  board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 1400);
  }

  function callout(text, ms) {
    var el = $('callout');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(hideCallout, ms);
  }
  function hideCallout() {
    clearTimeout(calloutTimer);
    $('callout').hidden = true;
  }

  var lastDamage = 0;
  var hudSteady = Rules.createSteady(300);
  var hitTimer = 0;
  function updateHud() {
    if (!game) return;
    $('hud-time').textContent = practice ? t('hud.practice') : t('hud.sec', { s: (game.timeLeft / 1000).toFixed(1) });
    var est = game.estimate();
    var shown = hudSteady.update(est.deliveredCount + '|' + est.itemCount + '|' + est.total, game.world.time).split('|');
    $('hud-delivered').textContent = shown[0] + '/' + shown[1];
    var ev = $('hud-estimate');
    ev.textContent = yen(Number(shown[2]));
    ev.classList.toggle('neg', Number(shown[2]) < 0);
    if (est.damage > lastDamage) {
      ev.classList.add('hit');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(function () { ev.classList.remove('hit'); }, 500);
    }
    lastDamage = est.damage;
    updateMarks();
    if (practice) updatePractice(Number(shown[0]));
    else updateGuide({ deliveredCount: Number(shown[0]) });
    $('hud-ropes').textContent = String(game.ropesLeft);
  }

  /**
   * The first item resting in the room ends the goal hint and shows the rope
   * hint (until the player has tied something once). The fall explanation is
   * drawn on the canvas, so both can be on screen during a warning, which is
   * the moment a rope helps most.
   */
  function updateGuide(est) {
    if (!guide || !est.deliveredCount) return;
    guide.delivered = true;
    if (guide.ropeHinted || Store.get('ropeUsed', false)) return;
    // right after a switch, items that look at rest are about to fall
    if (game.world.time - guide.lastSwitch < 1500) return;
    var it = game.world.items.find(function (x) { return game.itemStatus(x) === 'delivered'; });
    if (!it) return;
    guide.ropeHinted = true;
    guide.ropeHintId = it.id;
    guide.ropeHintUntil = game.world.time + 6000;
    guide.ropeHintFrom = game.world.time + 1300; // after the "+amount" pop has risen away
    callout(t(touchMode ? 'hint.ropeTouch' : 'hint.ropeMouse'), 6000);
  }

  function addPop(item, text, kind, life) {
    if (!marks) return;
    var p = item.body.position;
    marks.pops.push({ x: p.x, y: p.y, text: text, kind: kind, life: life, born: game.world.time });
  }

  /** Badge on items that would be paid now; "+amount" the first time each one counts. */
  function updateMarks() {
    if (!marks) return;
    var now = game.world.time;
    marks.done = [];
    game.world.items.forEach(function (it) {
      var st = marks.steady.get(it.id);
      if (!st) { st = Rules.createSteady(300); marks.steady.set(it.id, st); }
      if (st.update(game.itemStatus(it), now) !== 'delivered') return;
      marks.done.push(it.id);
      if (!marks.popped.has(it.id)) {
        marks.popped.add(it.id);
        addPop(it, '+' + yen(game.cfg.kinds[it.kind].reward), 'paid', 1600);
      }
    });
    marks.pops = marks.pops.filter(function (p) { return now - p.born < p.life; });
  }

  function marksState() {
    if (!marks) return null;
    var now = game.world.time;
    return {
      done: marks.done || [],
      pops: marks.pops.map(function (p) { return { x: p.x, y: p.y, text: p.text, kind: p.kind, life: p.life, age: now - p.born }; })
    };
  }

  /** Practice: carry one box in, tie it down, watch gravity turn, then the job. */
  function updatePractice(delivered) {
    var p = practice;
    var now = game.world.time;
    if (delivered > 0 && guide) guide.delivered = true; // the goal guide has done its job
    if (p.step === 'drag' && delivered > 0) {
      p.step = 'rope';
      p.ropeAt = now;
      callout(t(touchMode ? 'practice.ropeTouch' : 'practice.ropeMouse'), 60000);
    } else if (p.step === 'rope' && game.world.items.some(function (it) { return it.roped; })) {
      p.step = 'switch';
      // the warning starts once the "tied" pop has faded, so the two do not overlap
      game.queueSwitch(game.layout === 'portrait' ? 'right' : 'up', 5800);
      callout(t('practice.switch'), 60000);
    } else if (p.step === 'switch' && p.switchedAt !== null && now - p.switchedAt > 2600) {
      p.step = 'done';
      hideCallout();
      Store.set('practiceDone', true);
      showBrief('practiceDone');
    }
  }

  function guideState() {
    if (!guide) return null;
    var g = { goal: !guide.delivered, goalText: t('guide.room'), dragId: null, dragText: t('guide.drag'), ringId: null, ropeId: null, ropeText: t(touchMode ? 'guide.ropeTouch' : 'guide.ropeMouse') };
    // the pointer waits until the "+amount" pop has risen out of the way
    if (practice && practice.step === 'rope' && game.world.time - practice.ropeAt > 1300) {
      var target = game.world.items.find(function (x) { return game.itemStatus(x) === 'delivered' && !x.roped; });
      if (target) g.ropeId = target.id;
    }
    if (!guide.grabbed) {
      var first = game.world.items.find(function (x) { return game.itemStatus(x) === 'truck'; });
      if (first) g.dragId = first.id;
    }
    // the rope hint points at the item with a hand, not only text in the callout
    if (guide.ropeHintId && game.world.time >= guide.ropeHintFrom && game.world.time < guide.ropeHintUntil) g.ropeId = guide.ropeHintId;
    return g;
  }

  function handleEvents(evs) {
    evs.forEach(function (e) {
      if (e.type === 'spawn') {
        var it = game.world.items.find(function (x) { return x.id === e.id; });
        if (it) info.set(it.id, { kind: it.kind, shapes: it.shapes });
      } else if (e.type === 'warn') {
        warning = { dir: e.dir, at: e.at };
        Sfx.beep(false);
        try { if (navigator.vibrate) navigator.vibrate([60, 80, 60]); } catch (err) { /* ignore */ }
        // explain what a switch does, on the first warning of the first two games that reach one
        var seen = Store.get('gravitySeen', 0);
        if (guide) {
          guide.explainFall = guide.firstWarn && seen < 2;
          if (guide.explainFall) Store.set('gravitySeen', seen + 1);
          guide.firstWarn = false;
        }
      } else if (e.type === 'switch') {
        warning = null;
        if (guide) guide.lastSwitch = game.world.time;
        if (practice && practice.step === 'switch') {
          practice.switchedAt = game.world.time;
          game.world.items.forEach(function (it) { if (it.roped) addPop(it, t('pop.roped'), 'rope', 2600); });
        }
        Sfx.beep(true);
      } else if (e.type === 'contact') {
        if (e.speed > 3) Sfx.thud(e.speed / 16);
      } else if (e.type === 'break') {
        Sfx.crash();
        toast(t('toast.broken'));
      } else if (e.type === 'release') {
        suppressGrab = true;
        if (mc) { mc.body = null; mc.mouse.button = -1; }
        toast(t('toast.released'));
      } else if (e.type === 'end') {
        onEnd(e.result);
      }
    });
  }

  function drawGame() {
    if (!game || !view) return;
    var heldId = game.world.held ? game.world.held.id : null;
    Render.draw(ctx, board.width, board.height, {
      cfg: game.cfg,
      bounds: game.world.bounds,
      doorRect: game.world.doorRect,
      snapshot: game.world.snapshot(),
      info: info,
      heldId: heldId,
      time: game.world.time,
      warning: warning ? { dir: warning.dir, remaining: warning.at - game.world.time, label: t('warn.dir', { dir: t('dir.' + warning.dir) }), sub: guide && guide.explainFall ? t('warn.fall') : null } : null,
      labels: { bay: t('area.bay'), room: t('area.room'), door: t('area.door') },
      guide: guideState(),
      marks: marksState()
    });
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = ts - lastTs;
    lastTs = ts;
    if (dropDelta || dt > 250 || dt < 0) { dt = 0; dropDelta = false; }
    frameStep(dt);
  }

  function frameStep(dt) {
    if (game && briefing && !screens.game.hidden) {
      drawGame(); // the job site stays visible behind the work order; time does not run
    } else if (game && !game.ended && !paused && !screens.game.hidden) {
      handleEvents(game.advance(dt));
      updateHud();
      drawGame();
    }
    if (replay) stepReplay(dt);
  }

  function pause(on) {
    if (!game || game.ended) return;
    paused = on;
    $('pause').hidden = !on;
    board.style.visibility = on ? 'hidden' : 'visible';
    if (on) {
      if (mc) { mc.constraint.bodyB = null; mc.body = null; mc.mouse.button = -1; }
      game.world.setHeld(null);
    }
    dropDelta = true;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause(true);
    else dropDelta = true;
  });
  $('btn-pause').addEventListener('click', function () { pause(true); });
  $('btn-resume').addEventListener('click', function () { pause(false); });
  $('btn-quit').addEventListener('click', function () {
    game = null; practice = null; briefing = false;
    $('brief').hidden = true; hideCallout();
    renderTitle();
  });

  // ---------- result ----------
  function stageLabel() {
    return mode.daily ? t('result.dailyStage', { no: mode.no }) : t('result.freeStage');
  }

  function onEnd(result) {
    lastResult = result;
    hideCallout();
    Store.set('tutorialDone', true);
    var key = Rules.bestKey(mode);
    var best = Store.get(key, null);
    var isBest = best === null || result.bill.total > best;
    if (isBest) Store.set(key, result.bill.total);
    var got = Store.get('achievements', []);
    result.achievements.forEach(function (a) { if (got.indexOf(a) < 0) got.push(a); });
    Store.set('achievements', got);

    $('inv-stage').textContent = stageLabel() + '  /  ' + t('result.delivered', { n: result.bill.deliveredCount, total: result.bill.itemCount });
    var tb = $('inv-lines');
    tb.innerHTML = '';
    result.bill.lines.forEach(function (ln) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td></td><td class="num"></td><td class="num"></td>';
      tr.children[0].textContent = t('kind.' + ln.kind) + '  ' + ln.delivered + ' / ' + ln.total;
      tr.children[1].textContent = yen(ln.reward);
      tr.children[2].textContent = ln.damage ? '-' + yen(ln.damage) : yen(0);
      if (ln.damage) tr.children[2].className = 'num neg';
      tb.appendChild(tr);
    });
    $('inv-reward').textContent = yen(result.bill.reward);
    $('inv-damage').textContent = result.bill.damage ? '-' + yen(result.bill.damage) : yen(0);
    $('inv-total').textContent = yen(result.bill.total);
    $('inv-total').className = result.bill.total < 0 ? 'neg' : '';
    var m = result.bill.missed;
    var parts = ['truck', 'outside', 'moving', 'broken'].filter(function (k) { return m && m[k]; }).map(function (k) { return t('missed.' + k, { n: m[k] }); });
    $('inv-missed').textContent = parts.length ? t('result.missed') + ': ' + parts.join(' / ') : '';
    $('inv-missed').hidden = !parts.length;
    $('inv-best').hidden = !isBest;
    $('inv-comment').textContent = t(result.comment);
    var ul = $('inv-ach');
    ul.innerHTML = '';
    (result.achievements.length ? result.achievements : [null]).forEach(function (a) {
      var li = document.createElement('li');
      li.textContent = a ? t(a) : t('result.noAchievements');
      ul.appendChild(li);
    });
    var rb = $('btn-replay');
    rb.disabled = !result.worst;
    rb.querySelector('span').textContent = result.worst ? t('result.replay') : t('result.noReplay');
    $('share-note').hidden = true;
    $('replay').hidden = true;
    show('result');
    // build the share image now so the button can share synchronously
    sharePrep = null;
    var shareBtn = $('btn-share');
    shareBtn.disabled = true;
    Share.prepare(shareData(), shareText()).then(function (p) {
      if (lastResult !== result) return;
      sharePrep = p;
      shareBtn.disabled = false;
    }).catch(function () {
      // leave the button usable: it will retry preparing on click
      shareBtn.disabled = false;
    });
  }

  function shareData() {
    var r = lastResult;
    var labels = {};
    Object.keys(game.cfg.kinds).forEach(function (k) { labels[k] = t('kind.' + k); });
    return {
      stageLabel: stageLabel(),
      bill: r.bill,
      commentText: t(r.comment),
      achievementTexts: r.achievements.map(function (a) { return t(a); }),
      lineLabels: labels
    };
  }

  function shareText() {
    return t('share.text', { stage: mode.daily ? 'No.' + mode.no : t('result.freeStage'), yen: yen(lastResult.bill.total) });
  }

  $('btn-share').addEventListener('click', function () {
    if (!sharePrep) {
      Share.prepare(shareData(), shareText()).then(function (p) { sharePrep = p; toast(t('toast.shareReady')); });
      return;
    }
    var r = Share.shareNow(sharePrep); // synchronous: navigator.share is called inside the gesture
    if (r.promise) r.promise.catch(function () { /* cancelled */ });
    (function () {
      if (r.how === 'downloaded') {
        var n = $('share-note');
        n.textContent = t('result.saved') + ' ';
        var a = document.createElement('a');
        a.href = r.intentUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = t('result.postLink');
        n.appendChild(a);
        n.hidden = false;
      }
    })();
  });
  $('btn-retry').addEventListener('click', function () {
    begin(mode.daily ? mode : { daily: false, seed: (Math.random() * 4294967296) >>> 0 });
  });
  $('btn-menu').addEventListener('click', function () { game = null; renderTitle(); });

  // ---------- replay ----------
  var rcv = $('replay-canvas');
  var rctx = rcv.getContext('2d');

  function openReplay() {
    var r = lastResult;
    if (!r || !r.worst) return;
    var frames = Sim.replayWindow(r.frames, r.worst.t, 3000, 3000);
    if (!frames.length) return;
    $('replay').hidden = false;
    var rect = rcv.getBoundingClientRect();
    rcv.width = Math.round(rect.width * dpr);
    rcv.height = Math.round(rect.height * dpr);
    replay = { frames: frames, t: frames[0].t, start: frames[0].t, end: frames[frames.length - 1].t, focus: r.worst };
  }

  function stepReplay(dt) {
    replay.t += dt * 0.3;
    if (replay.t > replay.end) replay.t = replay.start;
    var fr = replay.frames;
    var i = 0;
    while (i < fr.length - 1 && fr[i + 1].t <= replay.t) i++;
    var snap = fr[i];
    var w = null;
    // show the warning overlay in replay too when a switch is coming
    game.schedule.forEach(function (s) {
      var rem = s.at - snap.t;
      if (rem > 0 && rem <= game.cfg.warnLead * 1000) w = { dir: s.dir, remaining: rem };
    });
    Render.draw(rctx, rcv.width, rcv.height, {
      cfg: game.cfg, bounds: game.world.bounds, doorRect: game.world.doorRect, snapshot: snap, info: info,
      heldId: replay.t >= replay.focus.t - 40 && replay.t <= replay.focus.t + 600 ? replay.focus.id : null,
      time: snap.t, warning: w
    });
  }

  $('btn-replay').addEventListener('click', openReplay);
  $('btn-replay-close').addEventListener('click', function () { replay = null; $('replay').hidden = true; });

  // ---------- boot ----------
  $('btn-daily').addEventListener('click', function () {
    Sfx.unlock();
    var d = daily();
    begin({ daily: true, no: d.no, seed: d.seed });
  });
  $('btn-free').addEventListener('click', function () {
    Sfx.unlock();
    begin({ daily: false, seed: (Math.random() * 4294967296) >>> 0 });
  });

  renderTitle();
  requestAnimationFrame(loop);

  // test hook for automated checks, only with ?debug in the URL
  if (DEBUG) window.__jh = { get game() { return game; }, get paused() { return paused; }, get mc() { return mc; }, get briefing() { return briefing; }, get practice() { return practice; }, closeBrief: closeBrief, tick: function (ms, n) { for (var i = 0; i < (n || 1); i++) frameStep(ms); }, start: start, pause: pause };
})();
