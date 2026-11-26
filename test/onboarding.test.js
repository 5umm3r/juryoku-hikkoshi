'use strict';
// First-time player guidance: live estimate, reasons for undelivered items,
// i18n coverage, guide overlays drawn only in live play.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Matter = require('../vendor/matter.min.js');
const Sim = require('../src/sim.js');
const Rules = require('../src/rules.js');
const I18n = require('../src/i18n.js');

const FRAME = 1000 / 60;
// landscape: bay x 0..240, door gap at x 240..280 / y 520..700, room x 280..980, floor y 700
const BOX_ONLY = { box: 5, fridge: 0, piano: 0, fishbowl: 0 };

function boxGame(extra) {
  return Sim.createGame({
    seed: 7,
    config: Object.assign({
      bag: BOX_ONLY,
      firstAt: 999, // no gravity switch
      spawnInterval: 0.5,
      bayCapacity: 3,
      kinds: { box: { reward: 1234 } }
    }, extra || {})
  });
}

function put(item, x, y, vy) {
  Matter.Sleeping.set(item.body, false);
  Matter.Body.setAngle(item.body, 0);
  Matter.Body.setPosition(item.body, { x, y });
  Matter.Body.setVelocity(item.body, { x: 0, y: vy || 0 });
  Matter.Body.setAngularVelocity(item.body, 0);
}

function advanceFor(game, ms) {
  for (let t = 0; t < ms && !game.ended; t += FRAME) game.advance(FRAME);
}

test('live estimate: one box resting in the room pays its reward, the rest are on the truck', () => {
  const game = boxGame();
  advanceFor(game, 1600); // three boxes unloaded, two still queued
  assert.equal(game.world.items.length, 3);
  put(game.world.items[0], 600, 700 - 26);
  advanceFor(game, 2000);
  const est = game.estimate();
  assert.equal(est.deliveredCount, 1);
  assert.equal(est.reward, 1234);
  assert.equal(est.damage, 0);
  assert.equal(est.total, 1234);
  assert.equal(est.missed.truck, 4);
});

test('estimate just before time-up equals the final bill, and the bill says why items missed', () => {
  const game = boxGame({ duration: 12 });
  advanceFor(game, 1600);
  const [a, b] = game.world.items;
  put(a, 600, 700 - 26); // delivered
  put(b, 260, 700 - 26); // straddles the door: outside
  advanceFor(game, 2500);
  while (game.timeLeft > 3000) game.advance(FRAME);
  const est = game.estimate();
  assert.equal(est.deliveredCount, 1);
  let result = null;
  while (!game.ended) game.advance(FRAME).forEach((e) => { if (e.type === 'end') result = e.result; });
  assert.equal(result.bill.total, est.total);
  assert.equal(result.bill.deliveredCount, est.deliveredCount);
  assert.deepEqual(result.bill.missed, { truck: 3, outside: 1, moving: 0, broken: 0 });
});

test('an item still falling inside the room at time-up counts as moving, not delivered', () => {
  const game = boxGame({ duration: 6 });
  advanceFor(game, 1600);
  while (game.timeLeft > 120) game.advance(FRAME);
  put(game.world.items[0], 600, 200, 8);
  let result = null;
  while (!game.ended) game.advance(FRAME).forEach((e) => { if (e.type === 'end') result = e.result; });
  assert.equal(result.bill.missed.moving, 1);
  assert.equal(result.bill.deliveredCount, 0);
});

test('computeBill counts broken items as broken wherever they are', () => {
  const bill = Rules.computeBill([
    { kind: 'box', status: 'delivered', delivered: true, broken: false, damage: 0 },
    { kind: 'bowl', status: 'delivered', delivered: true, broken: true, damage: 900 },
    { kind: 'bowl', status: 'outside', delivered: false, broken: true, damage: 900 },
    { kind: 'box', status: 'truck', delivered: false, broken: false, damage: 0 }
  ], { reward: { box: 100, bowl: 300 } });
  assert.deepEqual(bill.missed, { truck: 1, outside: 0, moving: 0, broken: 2 });
  assert.equal(bill.total, 100 - 1800);
});

// ---------- i18n ----------

function usedKeys() {
  const keys = new Set();
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const f of ['app.js', 'render.js', 'share.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z]+\.[a-zA-Z.]+)'/g)) keys.add(m[1]);
  }
  return keys;
}

test('every UI key used in the page and scripts exists in ja and en', () => {
  const keys = usedKeys();
  assert.ok(keys.has('guide.drag') && keys.has('guide.room') && keys.has('howto.step1'), 'guide keys are used');
  for (const k of keys) {
    assert.ok(I18n.dict.ja[k], `ja missing ${k}`);
    assert.ok(I18n.dict.en[k], `en missing ${k}`);
  }
  assert.deepEqual(Object.keys(I18n.dict.en).sort(), Object.keys(I18n.dict.ja).sort());
});

test('no emoji in the UI strings', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const lang of ['ja', 'en']) {
    for (const [k, v] of Object.entries(I18n.dict[lang])) assert.ok(!emoji.test(v), `${lang} ${k}: ${v}`);
  }
});

// ---------- canvas guides ----------

globalThis.self = globalThis;
require('../src/render.js');
const Render = globalThis.Render;

function recordingCtx() {
  const calls = [];
  let font = '';
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'fillText') return (text, x, y) => calls.push({ text: String(text), x, y, font });
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 20 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, v) { if (prop === 'font') font = v; target[prop] = v; return true; }
  });
  return { ctx, calls };
}

function liveState(game, extra) {
  const info = new Map(game.world.items.map((it) => [it.id, { kind: it.kind, shapes: it.shapes }]));
  return Object.assign({
    cfg: game.cfg, bounds: game.world.bounds, doorRect: game.world.doorRect,
    snapshot: game.world.snapshot(), info, heldId: null, time: game.world.time, warning: null
  }, extra || {});
}

const LABELS = { bay: 'BAY-L', room: 'ROOM-L', door: 'DOOR-L' };

test('live play draws bay/room/door names and the drag hint on the first item', () => {
  const game = boxGame();
  advanceFor(game, 200);
  const first = game.world.items[0];
  const { ctx, calls } = recordingCtx();
  Render.draw(ctx, 1280, 740, liveState(game, {
    labels: LABELS,
    guide: { dragId: first.id, dragText: 'DRAG-HERE', goal: true, goalText: 'MOVE-HERE' }
  }));
  const texts = calls.map((c) => c.text);
  for (const s of ['BAY-L', 'ROOM-L', 'DOOR-L', 'DRAG-HERE', 'MOVE-HERE']) assert.ok(texts.includes(s), `drew ${s}`);
  // the hint sits near the item, not somewhere random
  const hint = calls.find((c) => c.text === 'DRAG-HERE');
  const p = first.body.position;
  assert.ok(Math.hypot(hint.x - p.x, hint.y - p.y) < 160, `hint at ${hint.x},${hint.y} vs item ${p.x},${p.y}`);
  // world-unit text must stay readable on a phone (about 0.5 CSS px per unit)
  for (const c of calls.filter((c) => /-L$|HERE$/.test(c.text))) {
    const px = Number((c.font.match(/(\d+)px/) || [])[1]);
    assert.ok(px >= 28, `${c.text} font ${c.font}`);
  }
});

test('replay (no guide in state) draws no guide text; the warning names the new direction', () => {
  const game = boxGame();
  advanceFor(game, 200);
  const { ctx, calls } = recordingCtx();
  Render.draw(ctx, 1280, 740, liveState(game, { warning: { dir: 'up', remaining: 2500, label: 'GRAVITY-UP' } }));
  const texts = calls.map((c) => c.text);
  assert.ok(!texts.includes('DRAG-HERE') && !texts.includes('MOVE-HERE'));
  assert.ok(texts.includes('GRAVITY-UP'));
  assert.ok(texts.includes('3'));
});

test('the first warning can carry a second line explaining the fall', () => {
  const game = boxGame();
  advanceFor(game, 200);
  const { ctx, calls } = recordingCtx();
  Render.draw(ctx, 1280, 740, liveState(game, { warning: { dir: 'left', remaining: 2500, label: 'GRAVITY-LEFT', sub: 'FALLS-THAT-WAY' } }));
  const label = calls.find((c) => c.text === 'GRAVITY-LEFT');
  const sub = calls.find((c) => c.text === 'FALLS-THAT-WAY');
  assert.ok(label && sub, 'both lines drawn');
  assert.ok(sub.y > label.y, 'explanation sits under the direction');
  // with the goal guide still on, its label yields the room center to the warning
  const r2 = recordingCtx();
  Render.draw(r2.ctx, 1280, 740, liveState(game, { warning: { dir: 'left', remaining: 2500, label: 'GRAVITY-LEFT' }, guide: { goal: true, goalText: 'MOVE-HERE' } }));
  assert.ok(!r2.calls.some((c) => c.text === 'MOVE-HERE'));
  assert.ok(Number(sub.font.match(/(\d+)px/)[1]) >= 28, sub.font);
});

test('HUD value holder ignores a value that flips back within the hold time', () => {
  const s = Rules.createSteady(300);
  assert.equal(s.update('A', 0), 'A');
  // an item rocking in and out of rest every 100 ms never changes the display
  for (let t = 100; t <= 1000; t += 100) assert.equal(s.update(t % 200 ? 'B' : 'A', t), 'A');
  // a change that holds for 300 ms shows
  assert.equal(s.update('B', 1100), 'A');
  assert.equal(s.update('B', 1300), 'A');
  assert.equal(s.update('B', 1400), 'B');
});
