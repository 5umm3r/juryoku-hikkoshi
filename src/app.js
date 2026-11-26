/* Browser glue: screens, input (MouseConstraint), loop, pause, result, replay, share. */
(function () {
  'use strict';

  var t = I18n.t;
  var yen = I18n.yen;
  var EPOCH = '2026-11-01'; // No.1 in JST
  var TOUCH_LIFT = 46; // CSS px: grab point sits above the finger
  var TAP_MS = 260;
  var TAP_MOVE = 10;
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
  var suppressGrab = false;
  var tap = null;
  var toastTimer = 0;
  var tutorialTimer = 0;
  var lastResult = null;
  var replay = null;

  I18n.setLang('ja');
  I18n.apply(document);

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
  }

  // ---------- title ----------
  function daily() { return Rules.dailyStage(new Date(), EPOCH); }

  function renderTitle() {
    var d = daily();
    $('btn-daily').textContent = t('menu.daily', { no: d.no });
    var best = Store.get('best', null);
    $('best-label').textContent = best === null ? t('menu.noBest') : t('menu.best', { yen: yen(best) });
    var got = Store.get('achievements', []);
    $('ach-label').textContent = t('menu.achievements', { n: got.length, total: ALL_ACH.length });
    var ul = $('ach-list');
    ul.innerHTML = '';
    ALL_ACH.forEach(function (k) {
      var li = document.createElement('li');
      var has = got.indexOf(k) >= 0;
      li.textContent = has ? t(k) : '???';
      if (has) li.className = 'got';
      ul.appendChild(li);
    });
    show('title');
  }

  // ---------- game ----------
  function start(m) {
    mode = m;
    var firstPlay = !Store.get('tutorialDone', false);
    game = Sim.createGame({ seed: m.seed, firstPlay: firstPlay });
    info = new Map();
    warning = null;
    paused = false;
    dropDelta = true;
    suppressGrab = false;
    $('pause').hidden = true;
    board.style.visibility = 'visible';
    $('tutorial').hidden = true;
    $('toast').hidden = true;
    show('game');
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
    });
    Matter.Events.on(mc, 'enddrag', function () { game.world.setHeld(null); });
    updateMouseTransform();
  }

  function updateMouseTransform() {
    if (!mouse || !view) return;
    var s = view.scale / dpr; // CSS px per world unit
    var lift = touchMode ? TOUCH_LIFT : 0;
    Matter.Mouse.setScale(mouse, { x: 1 / s, y: 1 / s });
    Matter.Mouse.setOffset(mouse, { x: -view.ox / dpr / s, y: (-view.oy / dpr - lift) / s });
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
  }
  window.addEventListener('resize', resize);

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
    if (r.ok) toast(t(r.roped ? 'toast.roped' : 'toast.unroped'));
    else if (r.reason === 'limit') toast(t('toast.ropeLimit'));
    updateHud();
  }

  // capture on the stage so it runs before Matter's listeners on the canvas
  stage.addEventListener('touchstart', function (e) {
    Sfx.unlock();
    if (!touchMode) { touchMode = true; updateMouseTransform(); }
    var tt = e.changedTouches[0];
    tap = { x: tt.clientX, y: tt.clientY, at: performance.now(), moved: false };
  }, { capture: true, passive: true });
  stage.addEventListener('touchmove', function (e) {
    if (!tap) return;
    var tt = e.changedTouches[0];
    if (Math.abs(tt.clientX - tap.x) + Math.abs(tt.clientY - tap.y) > TAP_MOVE) tap.moved = true;
  }, { capture: true, passive: true });
  stage.addEventListener('touchend', function () {
    if (tap && !tap.moved && performance.now() - tap.at < TAP_MS) rope(eventWorldPoint(tap.x, tap.y));
    tap = null;
    suppressGrab = false;
  }, { capture: true, passive: true });
  stage.addEventListener('mousedown', function () {
    Sfx.unlock();
    if (touchMode && !tap) { touchMode = false; updateMouseTransform(); }
  }, true);
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

  function updateHud() {
    if (!game) return;
    $('hud-time').textContent = (game.timeLeft / 1000).toFixed(1);
    var dmg = game.world.items.reduce(function (s, it) { return s + it.damage; }, 0);
    $('hud-damage').textContent = yen(dmg);
    $('hud-truck').textContent = String(game.queueLength);
    var ropes = $('hud-ropes');
    var left = game.ropesLeft;
    var html = '';
    for (var i = 0; i < game.cfg.ropesPerPeriod; i++) {
      html += '<svg class="' + (i < left ? '' : 'used') + '"><use href="#i-rope"/></svg>';
    }
    if (ropes.innerHTML !== html) ropes.innerHTML = html;
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
        if (e.tutorial) {
          var tu = $('tutorial');
          tu.textContent = t('tutorial.warn');
          tu.hidden = false;
          clearTimeout(tutorialTimer);
          tutorialTimer = setTimeout(function () { tu.hidden = true; }, 5000);
        }
      } else if (e.type === 'switch') {
        warning = null;
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
      snapshot: game.world.snapshot(),
      info: info,
      heldId: heldId,
      time: game.world.time,
      warning: warning ? { dir: warning.dir, remaining: warning.at - game.world.time } : null
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
    if (game && !game.ended && !paused && !screens.game.hidden) {
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
  $('btn-quit').addEventListener('click', function () { game = null; renderTitle(); });

  // ---------- result ----------
  function stageLabel() {
    return mode.daily ? t('result.dailyStage', { no: mode.no }) : t('result.freeStage');
  }

  function onEnd(result) {
    lastResult = result;
    Store.set('tutorialDone', true);
    var best = Store.get('best', null);
    var isBest = best === null || result.bill.total > best;
    if (isBest) Store.set('best', result.bill.total);
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
    $('inv-damage').textContent = '-' + yen(result.bill.damage);
    $('inv-total').textContent = yen(result.bill.total);
    $('inv-total').className = result.bill.total < 0 ? 'neg' : '';
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

  $('btn-share').addEventListener('click', function () {
    var text = t('share.text', { stage: mode.daily ? 'No.' + mode.no : t('result.freeStage'), yen: yen(lastResult.bill.total) });
    Share.shareInvoice(shareData(), text).then(function (how) {
      if (how === 'downloaded') {
        var n = $('share-note');
        n.textContent = t('result.saved');
        n.hidden = false;
      }
    });
  });
  $('btn-retry').addEventListener('click', function () {
    start(mode.daily ? mode : { daily: false, seed: (Math.random() * 4294967296) >>> 0 });
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
      cfg: game.cfg, bounds: game.world.bounds, snapshot: snap, info: info,
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
    start({ daily: true, no: d.no, seed: d.seed });
  });
  $('btn-free').addEventListener('click', function () {
    Sfx.unlock();
    start({ daily: false, seed: (Math.random() * 4294967296) >>> 0 });
  });

  renderTitle();
  requestAnimationFrame(loop);

  // test hook for automated checks in the browser
  window.__jh = { get game() { return game; }, get paused() { return paused; }, get mc() { return mc; }, tick: function (ms, n) { for (var i = 0; i < (n || 1); i++) frameStep(ms); }, start: start, pause: pause };
})();
