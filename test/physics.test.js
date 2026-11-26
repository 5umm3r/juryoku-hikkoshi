'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Matter = require('../vendor/matter.min.js');
const Sim = require('../src/sim.js');

// Test-owned geometry and tuning. Expectations below are written against these
// literals, not against the game's own defaults.
const ROOM = { x: 280, y: 0, w: 700, h: 700 };
const BAY = { x: 0, y: 0, w: 240, h: 700 };
const CONFIG = {
  bay: BAY,
  room: ROOM,
  door: { y: 520, h: 180 },
  wall: 200,
  substepMs: 1000 / 240,
  maxSpeed: 22,
  gravityScale: 0.0008,
  cooldownMs: 500,
  rest: { speed: 0.15, angularSpeed: 0.01 },
  kinds: {
    box: { w: 56, h: 50, density: 0.0006, threshold: 12, yenPerImpact: 60, cap: 1500, reward: 1200 },
    fishbowl: { r: 22, density: 0.0012, threshold: 14, fragile: true, cap: 5000, reward: 3000 }
  }
};
const FRAME = 1000 / 60;

function run(world, seconds) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) world.step(FRAME);
}

function insideOuterBounds(p) {
  // interior spans x 0..980, y 0..700; allow a few px of contact slop
  return p.x > -5 && p.x < 985 && p.y > -5 && p.y < 705;
}

test('a sleeping body moves after gravity changes', () => {
  const world = Sim.createWorld(CONFIG);
  const box = world.addFurniture('box', 600, 600);
  run(world, 4);
  assert.equal(box.body.isSleeping, true, 'box should fall asleep on the floor');
  const before = { x: box.body.position.x, y: box.body.position.y };
  world.setGravity('up');
  run(world, 1);
  assert.ok(box.body.position.y < before.y - 100, `box should fly up, moved from ${before.y} to ${box.body.position.y}`);

  world.setGravity('right');
  const xBefore = box.body.position.x;
  run(world, 1.5);
  assert.ok(box.body.position.x > xBefore + 50, `box should slide right, ${xBefore} -> ${box.body.position.x}`);
});

test('fast small items never tunnel through the walls', () => {
  const dirs = ['down', 'left', 'up', 'right'];
  let escapes = 0;
  for (let trial = 0; trial < 40; trial++) {
    const world = Sim.createWorld(Object.assign({}, CONFIG, {
      kinds: { box: { w: 14, h: 14, density: 0.0006 } }
    }));
    const it = world.addFurniture('box', 300 + (trial * 37) % 650, 50 + (trial * 53) % 600);
    const dir = dirs[trial % 4];
    world.setGravity(dir);
    for (let f = 0; f < 240; f++) {
      // keep shoving it toward the wall at absurd speed
      const push = { down: { x: 0, y: 80 }, up: { x: 0, y: -80 }, left: { x: -80, y: 0 }, right: { x: 80, y: 0 } }[dir];
      Matter.Body.setVelocity(it.body, push);
      world.step(FRAME);
      if (!insideOuterBounds(it.body.position)) { escapes++; break; }
    }
  }
  assert.equal(escapes, 0, `${escapes} of 40 trials escaped the building`);
});

test('dragging an item hard into a wall with a mouse-like constraint does not push it through', () => {
  for (const [tx, ty] of [[1400, 350], [600, -500], [600, 1300], [-600, 350], [100, 200]]) {
    const world = Sim.createWorld(CONFIG);
    const it = world.addFurniture('box', 600, 350);
    const c = Matter.Constraint.create({ pointA: { x: 600, y: 350 }, bodyB: it.body, pointB: { x: 0, y: 0 }, stiffness: 0.2, length: 0 });
    Matter.Composite.add(world.engine.world, c);
    world.setHeld(it, c);
    let escaped = false;
    for (let f = 0; f < 180; f++) {
      // the pointer sweeps toward (and past) the wall at 25 px per frame and stays there
      const dx = tx - c.pointA.x;
      const dy = ty - c.pointA.y;
      const d = Math.hypot(dx, dy);
      if (d > 25) c.pointA = { x: c.pointA.x + dx / d * 25, y: c.pointA.y + dy / d * 25 };
      world.step(FRAME);
      const p = it.body.position;
      if (!insideOuterBounds(p)) escaped = true;
      // must also never cross the bay/room divider above the door (x 240..280, y < 520)
      if (p.y < 480 && p.x < 240) escaped = true;
    }
    assert.equal(escaped, false, `pulled toward (${tx},${ty}) the box left the room through a wall`);
  }
});

test('in-room and resting judgement', () => {
  const world = Sim.createWorld(CONFIG);
  const inRoom = world.addFurniture('box', 700, 670);
  const inBay = world.addFurniture('box', 120, 670);
  const straddling = world.addFurniture('box', 262, 300); // overlaps the divider wall area
  run(world, 3);
  assert.equal(world.isInRoom(inRoom), true);
  assert.equal(world.isResting(inRoom), true);
  assert.equal(world.isInRoom(inBay), false);
  // straddling item got pushed out by the divider; whichever side it is on, it is not half-in
  const x = straddling.body.position.x;
  assert.equal(world.isInRoom(straddling), x > 280 + 28);

  const falling = world.addFurniture('box', 600, 100);
  run(world, 0.3);
  assert.equal(world.isInRoom(falling), true);
  assert.equal(world.isResting(falling), false, 'a falling item is not resting');
  run(world, 3);
  assert.equal(world.isResting(falling), true, 'it rests after landing');
});

test('fishbowl breaks when dropped from high up but survives a gentle set-down', () => {
  const world = Sim.createWorld(CONFIG);
  const high = world.addFurniture('fishbowl', 500, 40);
  const low = world.addFurniture('fishbowl', 800, 670);
  const breaks = [];
  world.on((e) => { if (e.type === 'break') breaks.push(e.id); });
  run(world, 3);
  assert.equal(high.broken, true, 'bowl falling 600px breaks');
  assert.equal(low.broken, false, 'bowl resting on the floor does not break');
  assert.deepEqual(breaks, [high.id]);
  assert.equal(high.damage, 5000);
});

test('damage for one pair is counted at most once per 0.5 s', () => {
  const world = Sim.createWorld(CONFIG);
  const box = world.addFurniture('box', 600, 600);
  const hits = [];
  world.on((e) => { if (e.type === 'damage') hits.push(e.t); });
  // slam it into the floor every frame for 2 seconds
  // drop it onto the floor again every 4 frames for 2 seconds
  for (let f = 0; f < 120; f++) {
    if (f % 4 === 0) {
      Matter.Sleeping.set(box.body, false);
      Matter.Body.setAngle(box.body, 0);
      Matter.Body.setPosition(box.body, { x: 600, y: 630 });
      Matter.Body.setVelocity(box.body, { x: 0, y: 20 });
    }
    world.step(FRAME);
  }
  assert.ok(hits.length >= 2, `expected repeated hits, got ${hits.length}`);
  assert.ok(hits.length <= 5, `cooldown should limit hits over 2 s, got ${hits.length}`);
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i] - hits[i - 1] >= 500 - 1e-6, `hits ${hits[i - 1]} and ${hits[i]} too close`);
});

test('held light items float; held heavy items sag toward gravity', () => {
  const world = Sim.createWorld(Object.assign({}, CONFIG, {
    kinds: {
      box: { w: 56, h: 50, density: 0.0006, sag: 0 },
      fridge: { w: 60, h: 110, density: 0.003, sag: 0.55 }
    }
  }));
  const box = world.addFurniture('box', 500, 200);
  world.setHeld(box);
  run(world, 1);
  assert.ok(Math.abs(box.body.position.y - 200) < 2, `held box should hover, y=${box.body.position.y}`);

  const fridge = world.addFurniture('fridge', 800, 200);
  world.setHeld(fridge);
  run(world, 0.5);
  assert.ok(fridge.body.position.y > 230, `held fridge should sag down, y=${fridge.body.position.y}`);
});

test('door closes when gravity points at it, so bay and room stay separate', () => {
  const world = Sim.createWorld(CONFIG);
  const box = world.addFurniture('box', 400, 610);
  run(world, 1);
  world.setGravity('left');
  run(world, 3);
  assert.equal(world.doorClosed, true);
  assert.ok(box.body.position.x > 280, `box stayed in the room, x=${box.body.position.x}`);
  world.setGravity('down');
  assert.equal(world.doorClosed, false);
});
