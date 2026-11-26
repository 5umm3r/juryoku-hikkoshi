'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../src/sim.js');

function playOut(game, onEvent) {
  const all = [];
  let guard = 0;
  while (!game.ended && guard++ < 10000) {
    const evs = game.advance(1000 / 60);
    evs.forEach((e) => { all.push(e); if (onEvent) onEvent(e, game); });
  }
  return all;
}

test('same seed: same furniture order and gravity schedule; consecutive switches differ', () => {
  const a = Sim.createGame({ seed: 1234 });
  const b = Sim.createGame({ seed: 1234 });
  assert.deepEqual(a.order, b.order);
  assert.deepEqual(a.schedule.map((s) => [s.at, s.dir]), b.schedule.map((s) => [s.at, s.dir]));
  assert.equal(a.schedule.length, 6);
  let prev = 'down';
  for (const s of a.schedule) { assert.notEqual(s.dir, prev); prev = s.dir; }
  const c = Sim.createGame({ seed: 99 });
  assert.notDeepEqual(c.order.concat(c.schedule.map((s) => s.dir)), a.order.concat(a.schedule.map((s) => s.dir)));
});

test('a full 60 s stage switches gravity at about 9 s intervals with a 3 s warning', () => {
  const game = Sim.createGame({ seed: 5, config: { duration: 60, interval: 9, firstAt: 9, warnLead: 3 } });
  const warns = [];
  const switches = [];
  const ends = [];
  playOut(game, (e, g) => {
    const t = g.world.time;
    if (e.type === 'warn') warns.push(t);
    if (e.type === 'switch') switches.push([t, e.dir]);
    if (e.type === 'end') ends.push(t);
  });
  assert.equal(switches.length, 6);
  switches.forEach(([t], i) => assert.ok(Math.abs(t - 9000 * (i + 1)) < 40, `switch ${i} at ${t}`));
  warns.forEach((t, i) => assert.ok(Math.abs(t - (9000 * (i + 1) - 3000)) < 40, `warn ${i} at ${t}`));
  assert.equal(ends.length, 1);
  assert.ok(Math.abs(ends[0] - 60000) < 40);
  assert.ok(game.frames.length > 1700, 'recorded about 30 frames per second');
});

test('default stage: no gravity switch in the first 10 s, about 6 switches, same for first-timers', () => {
  const veteran = Sim.createGame({ seed: 5 });
  const firstTimer = Sim.createGame({ seed: 5, firstPlay: true });
  assert.deepEqual(firstTimer.schedule.map((s) => [s.at, s.dir]), veteran.schedule.map((s) => [s.at, s.dir]));
  const evs = playOut(veteran);
  const switchTimes = [];
  // (re-run to observe times)
  const g2 = Sim.createGame({ seed: 5 });
  playOut(g2, (e, g) => { if (e.type === 'switch') switchTimes.push(g.world.time); });
  assert.ok(switchTimes[0] >= 10000, `first switch at ${switchTimes[0]}`);
  assert.ok(switchTimes.length >= 5 && switchTimes.length <= 7, `${switchTimes.length} switches`);
  for (let i = 1; i < switchTimes.length; i++) {
    const gap = switchTimes[i] - switchTimes[i - 1];
    assert.ok(gap >= 8000 && gap <= 10000, `gap ${gap}`);
  }
  assert.ok(evs.every((e) => e.type !== 'warn' || !e.tutorial), 'no tutorial flag for veterans');
});

test('first play: the first warning is marked tutorial', () => {
  const game = Sim.createGame({ seed: 5, firstPlay: true });
  const evs = playOut(game);
  const first = evs.find((e) => e.type === 'switch');
  const warn = evs.find((e) => e.type === 'warn');
  assert.equal(warn.tutorial, true);
  assert.equal(evs.filter((e) => e.type === 'warn' && e.tutorial).length, 1);
  assert.ok(first);
});

test('truck waits while the bay is full', () => {
  const game = Sim.createGame({ seed: 3 });
  // nobody carries anything out: the bay (x < 240) should never hold more than 2 items
  let maxInBay = 0;
  playOut(game, (e, g) => {
    const n = g.world.items.filter((it) => it.body.position.x < 240).length;
    maxInBay = Math.max(maxInBay, n);
  });
  assert.ok(maxInBay <= 2, `bay should cap at 2 items, saw ${maxInBay}`);
  assert.ok(game.world.items.length < 14, 'truck still had items waiting');
  assert.equal(game.result.items.length, 14, 'items left on the truck still appear in the result');
});

test('spawning onto the truck bay does not cost damage', () => {
  const game = Sim.createGame({ seed: 11 });
  const evs = [];
  while (game.world.time < 4000) evs.push(...game.advance(1000 / 60));
  assert.equal(evs.filter((e) => e.type === 'damage').length, 0);
});

test('roped items ignore gravity switches', () => {
  const game = Sim.createGame({ seed: 8 });
  const w = game.world;
  const a = w.addFurniture('box', 400, 674);
  while (w.time < 1000) game.advance(1000 / 60);
  assert.equal(game.toggleRope(a).ok, true);
  const ay = a.body.position.y;
  while (game.period < 1) game.advance(1000 / 60);
  for (let i = 0; i < 90; i++) game.advance(1000 / 60);
  assert.ok(Math.abs(a.body.position.y - ay) < 0.01, 'roped box does not move');
});

test('delivered count at time-up: resting items inside the room only', () => {
  const game = Sim.createGame({ seed: 8, config: { bag: { box: 1 }, interval: 100, firstAt: 100 } });
  const w = game.world;
  w.addFurniture('box', 500, 670);
  w.addFurniture('box', 700, 670);
  playOut(game);
  const delivered = game.result.items.filter((i) => i.delivered).length;
  assert.equal(delivered, 2, JSON.stringify(game.result.items));
  assert.equal(game.result.bill.reward, 2 * 1200);
});

test('replay window picks frames around the worst collision', () => {
  const frames = [];
  for (let t = 0; t <= 60000; t += 1000 / 30) frames.push({ t });
  const win = Sim.replayWindow(frames, 20000, 3000, 3000);
  assert.ok(win[0].t >= 17000 && win[0].t < 17040);
  assert.ok(win[win.length - 1].t <= 23000 && win[win.length - 1].t > 22960);
});

test('truck keeps unloading when the drop spot is already occupied', () => {
  const game = Sim.createGame({ seed: 21 });
  // nobody touches anything for 8 s (before the first switch at 9 s)
  while (game.world.time < 8000) game.advance(1000 / 60);
  assert.equal(game.world.items.length, 2, 'second item should be dropped beside/above the first');
});
