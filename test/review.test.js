'use strict';
// Fixes from the audit review: balance, rope rules, bay damage, broken items,
// achievements from real physics, portrait layout, per-stage best.
const test = require('node:test');
const assert = require('node:assert/strict');
const Matter = require('../vendor/matter.min.js');
const Sim = require('../src/sim.js');
const Rules = require('../src/rules.js');

const FRAME = 1000 / 60;
const ROOM = { x: 280, y: 0, w: 700, h: 700 };
const P_BAY = { x: 0, y: 0, w: 700, h: 240 };
const P_ROOM = { x: 0, y: 280, w: 700, h: 700 };
const P_DOOR = { from: 0, size: 180 };
const BAY = { x: 0, y: 0, w: 240, h: 700 };

function run(world, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) world.step(FRAME);
}

// ---------- strategies for the balance check ----------

/** Drop a spawned item gently onto the room surface gravity points at. */
function placeInRoom(game, item, ROOM) {
  const w = game.world;
  const g = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[w.gravity];
  const others = w.items.filter((it) => it !== item).map((it) => it.body);
  const candidates = [];
  for (let x = ROOM.x + 60; x <= ROOM.x + ROOM.w - 60; x += 40) {
    for (let y = ROOM.y + 60; y <= ROOM.y + ROOM.h - 60; y += 40) {
      // closest to the "floor" first
      const depth = g[0] * x + g[1] * y;
      candidates.push({ x, y, depth });
    }
  }
  candidates.sort((a, b) => b.depth - a.depth);
  for (const c of candidates) {
    const r = { min: { x: c.x - 80, y: c.y - 60 }, max: { x: c.x + 80, y: c.y + 60 } };
    if (Matter.Query.region(others, r).length === 0) {
      Matter.Body.setAngle(item.body, 0);
      Matter.Body.setPosition(item.body, { x: c.x, y: c.y });
      Matter.Body.setVelocity(item.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(item.body, 0);
      return true;
    }
  }
  return false;
}

function playStrategy(seed, strategy, layout) {
  const game = Sim.createGame({ seed, layout });
  const room = layout === 'portrait' ? P_ROOM : ROOM;
  let guard = 0;
  while (!game.ended && guard++ < 10000) {
    const evs = game.advance(FRAME);
    if (strategy !== 'nothing') {
      evs.filter((e) => e.type === 'spawn').forEach((e) => {
        const it = game.world.items.find((x) => x.id === e.id);
        placeInRoom(game, it, room);
      });
    }
    if (strategy === 'rope') {
      // keep the most valuable items tied down when allowed
      const order = { piano: 0, fridge: 1, fishbowl: 2, box: 3 };
      game.world.items
        .filter((it) => !it.roped && game.world.isInRoom(it))
        .sort((a, b) => order[a.kind] - order[b.kind])
        .forEach((it) => game.toggleRope(it));
    }
  }
  return game.result.bill;
}

const SEEDS = [1, 2, 3, 20261127];

for (const layout of ['landscape', 'portrait']) test(`balance (${layout}): placing items right away (no rope) beats doing nothing on every seed`, () => {
  const rows = SEEDS.map((seed) => ({
    seed,
    nothing: playStrategy(seed, 'nothing', layout).total,
    place: playStrategy(seed, 'place', layout).total,
    rope: playStrategy(seed, 'rope', layout).total
  }));
  console.log('balance ' + layout, JSON.stringify(rows));
  for (const r of rows) {
    assert.ok(r.place > r.nothing + 3000, `seed ${r.seed}: place ${r.place} vs nothing ${r.nothing}`);
    assert.ok(r.place > 0, `seed ${r.seed}: placing should earn money, got ${r.place}`);
  }
});

test('a fridge gently nudging a box or a fishbowl (relative speed 0.7) breaks nothing', () => {
  const world = Sim.createWorld({});
  const fridge = world.addFurniture('fridge', 500, 645);
  const box = world.addFurniture('box', 560, 675);
  const bowl = world.addFurniture('fishbowl', 440, 678);
  run(world, 2);
  const dmg = [];
  world.on((e) => { if (e.type === 'damage' || e.type === 'break') dmg.push(e); });
  for (const dir of [1, -1]) {
    Matter.Sleeping.set(fridge.body, false);
    for (let i = 0; i < 40; i++) {
      Matter.Body.setVelocity(fridge.body, { x: 0.7 * dir, y: 0 });
      world.step(FRAME);
    }
    run(world, 1);
  }
  assert.equal(box.damage, 0, JSON.stringify(dmg));
  assert.equal(bowl.broken, false);
  assert.equal(fridge.damage, 0);
});

test('a carelessly dropped fishbowl still breaks inside the room', () => {
  const world = Sim.createWorld({});
  const bowl = world.addFurniture('fishbowl', 600, 60);
  run(world, 3);
  assert.equal(bowl.broken, true);
});

test('damage that happens on the truck bay is not billed', () => {
  const world = Sim.createWorld({});
  const box = world.addFurniture('box', 120, 670);
  const bowl = world.addFurniture('fishbowl', 120, 560);
  run(world, 1);
  world.setGravity('up');
  run(world, 3);
  world.setGravity('down');
  run(world, 3);
  assert.equal(box.damage, 0);
  assert.equal(bowl.damage, 0);
  assert.equal(bowl.broken, false);
});

test('ropes: at most 3 tied at once, untying gives one back, no per-period reset needed', () => {
  const game = Sim.createGame({ seed: 8 });
  const w = game.world;
  const items = [400, 480, 560, 640].map((x) => w.addFurniture('box', x, 674));
  while (w.time < 1500) game.advance(FRAME);
  assert.equal(game.toggleRope(items[0]).ok, true);
  assert.equal(game.toggleRope(items[1]).ok, true);
  assert.equal(game.toggleRope(items[2]).ok, true);
  assert.deepEqual(game.toggleRope(items[3]), { ok: false, reason: 'limit' });
  assert.equal(game.toggleRope(items[1]).ok, true, 'untie');
  assert.equal(game.ropesLeft, 1);
  assert.equal(game.toggleRope(items[3]).ok, true, 'rope came back after untying');
});

test('ropes: an item floating in mid-air cannot be tied down', () => {
  const game = Sim.createGame({ seed: 8 });
  const w = game.world;
  const floating = w.addFurniture('box', 600, 200);
  w.setHeld(floating); // held in mid-air, not touching anything
  while (w.time < 1000) game.advance(FRAME);
  assert.ok(floating.body.position.y < 400);
  assert.deepEqual(game.toggleRope(floating), { ok: false, reason: 'airborne' });
  assert.equal(floating.roped, false);

  const onFloor = w.addFurniture('box', 800, 674);
  const againstWall = w.addFurniture('box', 948, 300); // touching the right wall while held there
  w.setHeld(null);
  while (w.time < 1400) game.advance(FRAME);
  assert.equal(game.toggleRope(onFloor).ok, true, 'item on the floor can be tied');
  assert.ok(againstWall.body.position.x > 900);
});

test('a broken item is neither counted as delivered nor as a full house', () => {
  const bill = Rules.computeBill([
    { kind: 'fishbowl', delivered: true, broken: true, damage: 3000 },
    { kind: 'box', delivered: true, broken: false, damage: 0 }
  ], { reward: { fishbowl: 3000, box: 1200 } });
  assert.equal(bill.deliveredCount, 1);
  assert.ok(!Rules.achievements({ events: [], bill }).includes('ach.fullHouse'));
});

test('achievement from real physics: a piano slammed into the ceiling earns Ceiling Piano', () => {
  const game = Sim.createGame({ seed: 8 });
  const w = game.world;
  w.addFurniture('piano', 600, 640);
  while (w.time < 1000) game.advance(FRAME);
  w.setGravity('up');
  while (w.time < 4000) game.advance(FRAME);
  const result = game.finish();
  assert.ok(result.achievements.includes('ach.ceilingPiano'), JSON.stringify(result.achievements));
});

test('portrait layout: bay above the room, world taller than wide, door between them', () => {
  const game = Sim.createGame({ seed: 4, layout: 'portrait' });
  const b = game.world.bounds;
  assert.ok(b.bottom - b.top > (b.right - b.left) * 1.2, JSON.stringify(b));
  assert.deepEqual(b, { left: 0, right: 700, top: 0, bottom: 980 });
  const bay = P_BAY;
  // a box dragged... simply: gravity down keeps the bay's items in the bay unless over the door
  while (game.world.time < 3000) game.advance(FRAME);
  const it = game.world.items[0];
  assert.ok(it.body.position.y < bay.y + bay.h, 'first item rests on the bay floor');
  // gravity toward the bay (up) closes the door so room items stay in
  game.world.setGravity('up');
  assert.equal(game.world.doorClosed, true);
});

test('portrait layout: an item moved over the door opening drops into the room', () => {
  const game = Sim.createGame({ seed: 4, layout: 'portrait' });
  const bay = P_BAY;
  const room = P_ROOM;
  const door = P_DOOR;
  const it = game.world.addFurniture('box', door.from + door.size / 2, bay.y + bay.h - 40);
  while (game.world.time < 3000) game.advance(FRAME);
  assert.ok(game.world.isInRoom(it), JSON.stringify(it.body.position));
  assert.ok(it.body.position.y > room.y);
});

test('best score keys: separate per daily stage number and free play', () => {
  assert.equal(Rules.bestKey({ daily: true, no: 27 }), 'best.daily.27');
  assert.equal(Rules.bestKey({ daily: true, no: 28 }), 'best.daily.28');
  assert.equal(Rules.bestKey({ daily: false }), 'best.free');
});

test('portrait layout: the truck keeps unloading beside an item, never over the door hole', () => {
  const game = Sim.createGame({ seed: 21, layout: 'portrait' });
  // a fridge already standing in the middle of the bay floor (bay is y 0..240, x 0..700)
  game.world.addFurniture('fridge', 350, 184);
  const spawns = [];
  while (game.world.time < 8000) {
    game.advance(FRAME).forEach((e) => { if (e.type === 'spawn') spawns.push(e); });
  }
  assert.ok(spawns.length >= 1, 'truck dropped an item beside the fridge');
  const bay = P_BAY;
  const door = P_DOOR;
  for (const it of game.world.items) {
    assert.ok(it.body.position.y < bay.y + bay.h, `item ${it.kind} stayed on the bay`);
    assert.ok(it.body.bounds.min.x > door.from + door.size || it.body.bounds.max.x < door.from, 'not dropped over the door');
  }
});

test('portrait: Ceiling Piano comes from the room ceiling (the divider), not from the bay', () => {
  // piano in the room, gravity up: it slams into the divider/door above the room (y 280)
  const inRoom = Sim.createGame({ seed: 8, layout: 'portrait' });
  inRoom.world.addFurniture('piano', 450, 930);
  while (inRoom.world.time < 1000) inRoom.advance(FRAME);
  inRoom.world.setGravity('up');
  while (inRoom.world.time < 4000) inRoom.advance(FRAME);
  assert.ok(inRoom.finish().achievements.includes('ach.ceilingPiano'), 'room ceiling hit counts');

  // piano left on the truck bay (y 0..240) hitting the bay ceiling: not the room's ceiling
  const inBay = Sim.createGame({ seed: 8, layout: 'portrait', config: { bag: { box: 1 } } });
  inBay.world.addFurniture('piano', 450, 190);
  while (inBay.world.time < 1000) inBay.advance(FRAME);
  inBay.world.setGravity('up');
  while (inBay.world.time < 4000) inBay.advance(FRAME);
  assert.ok(!inBay.finish().achievements.includes('ach.ceilingPiano'), 'bay ceiling does not count');
});

test('share: navigator.share is called synchronously from shareNow (iOS user-gesture rule)', () => {
  const calls = [];
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { share: (p) => { calls.push(p); return Promise.resolve(); }, canShare: () => true }
  });
  try {
    const Share = require('../src/share.js').Share || globalThis.Share;
    const payload = { files: ['file'], text: 'No.27 請求額 ¥1,000' };
    const r = Share.shareNow({ canShareFiles: true, payload, intentUrl: 'x' });
    assert.equal(calls.length, 1, 'share() ran before shareNow returned');
    assert.equal(calls[0], payload);
    assert.equal(r.how, 'share');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
  }
});
