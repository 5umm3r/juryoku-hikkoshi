'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rules = require('../src/rules.js');

test('gravity sequence never repeats the previous direction (including the start)', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const seq = Rules.gravitySequence(Rules.createRng(seed), 6, 'down');
    assert.equal(seq.length, 6);
    assert.notEqual(seq[0], 'down', `seed ${seed} first switch kept gravity down`);
    for (let i = 1; i < seq.length; i++) {
      assert.notEqual(seq[i], seq[i - 1], `seed ${seed} repeated ${seq[i]} at ${i}`);
    }
    for (const d of seq) assert.ok(['down', 'left', 'up', 'right'].includes(d));
  }
});

test('same seed gives the same gravity sequence and furniture order; other seeds differ', () => {
  const bag = { box: 6, fridge: 3, piano: 2, fishbowl: 3 };
  const a = Rules.createRng(20261126);
  const b = Rules.createRng(20261126);
  const seqA = Rules.gravitySequence(a, 6, 'down');
  const seqB = Rules.gravitySequence(b, 6, 'down');
  assert.deepEqual(seqA, seqB);
  assert.deepEqual(Rules.furnitureOrder(a, bag), Rules.furnitureOrder(b, bag));

  const distinct = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    distinct.add(Rules.gravitySequence(Rules.createRng(seed), 6, 'down').join(','));
  }
  assert.ok(distinct.size > 20, `only ${distinct.size} distinct sequences out of 50`);
});

test('furniture order contains exactly the bag', () => {
  const order = Rules.furnitureOrder(Rules.createRng(7), { box: 2, piano: 1 });
  assert.deepEqual(order.slice().sort(), ['box', 'box', 'piano']);
});

test('switch times: every 9 s from 9 s inside a 60 s stage', () => {
  assert.deepEqual(Rules.switchTimes({ duration: 60, interval: 9, firstAt: 9 }), [9, 18, 27, 36, 45, 54]);
  const tutorial = Rules.switchTimes({ duration: 60, interval: 8, firstAt: 13 });
  assert.ok(tutorial[0] >= 10);
});

test('daily stage number follows the JST date', () => {
  // 2026-11-25 23:30 JST
  const before = Rules.dailyStage(new Date('2026-11-25T14:30:00Z'), '2026-11-01');
  // 2026-11-26 00:30 JST
  const after = Rules.dailyStage(new Date('2026-11-25T15:30:00Z'), '2026-11-01');
  assert.equal(before.no, 25);
  assert.equal(after.no, 26);
  assert.equal(after.ymd, '2026-11-26');
  assert.notEqual(before.seed, after.seed);
  assert.equal(after.seed, Rules.dailyStage(new Date('2026-11-26T10:00:00Z'), '2026-11-01').seed);
});

test('damage cooldown blocks the same pair for 0.5 s only', () => {
  const cd = Rules.createCooldown(500);
  assert.equal(cd.tryHit(1, 2, 0), true);
  assert.equal(cd.tryHit(2, 1, 300), false, 'reversed pair inside window');
  assert.equal(cd.tryHit(1, 3, 300), true, 'different pair is independent');
  assert.equal(cd.tryHit(1, 2, 499), false);
  assert.equal(cd.tryHit(1, 2, 500), true);
  assert.equal(cd.tryHit(1, 2, 800), false);
});

test('rect containment uses all vertices', () => {
  const rect = { x: 100, y: 0, w: 200, h: 200 };
  assert.equal(Rules.verticesInsideRect([{ x: 110, y: 10 }, { x: 290, y: 190 }], rect, 0), true);
  assert.equal(Rules.verticesInsideRect([{ x: 110, y: 10 }, { x: 310, y: 190 }], rect, 0), false);
  assert.equal(Rules.verticesInsideRect([{ x: 99.5, y: 10 }], rect, 1), true);
});

test('resting rule', () => {
  const lim = { speed: 0.15, angularSpeed: 0.01 };
  assert.equal(Rules.isResting({ speed: 0.05, angularSpeed: 0.001 }, lim), true);
  assert.equal(Rules.isResting({ speed: 2, angularSpeed: 0 }, lim), false);
  assert.equal(Rules.isResting({ speed: 0, angularSpeed: 0.2 }, lim), false);
  assert.equal(Rules.isResting({ speed: 9, angularSpeed: 1, isSleeping: true }, lim), true);
});

test('bill = reward for delivered unbroken items minus all damage', () => {
  const bill = Rules.computeBill([
    { kind: 'box', delivered: true, broken: false, damage: 200 },
    { kind: 'box', delivered: false, broken: false, damage: 0 },
    { kind: 'bowl', delivered: true, broken: true, damage: 5000 },
    { kind: 'piano', delivered: true, broken: false, damage: 0 }
  ], { reward: { box: 1000, bowl: 3000, piano: 8000 } });
  assert.equal(bill.reward, 9000);
  assert.equal(bill.damage, 5200);
  assert.equal(bill.total, 3800);
  assert.equal(bill.deliveredCount, 2, 'the broken bowl is not delivered');
});

test('achievements and landlord comments come from the log', () => {
  const bill = { reward: 0, damage: 9000, total: -9000, deliveredCount: 1, itemCount: 14 };
  const ach = Rules.achievements({
    bill,
    events: [
      { type: 'ceiling', kind: 'piano' },
      { type: 'break', kind: 'fishbowl', airborne: true }
    ]
  });
  assert.ok(ach.includes('ach.ceilingPiano'));
  assert.ok(ach.includes('ach.flyingFish'));
  assert.ok(ach.includes('ach.leftover'));
  assert.equal(Rules.landlordCommentKey(bill), 'landlord.negative');
  assert.equal(Rules.landlordCommentKey({ reward: 10000, damage: 0, total: 10000, deliveredCount: 10, itemCount: 14 }), 'landlord.perfect');
});
