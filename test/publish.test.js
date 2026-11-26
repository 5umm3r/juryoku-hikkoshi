'use strict';
// Public site URL in the share text and on the invoice image.
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_EXPECTED = 'https://5umm3r.github.io/juryoku-hikkoshi/';

// share.js attaches to `self` in browsers; give it one here so it can read I18n
globalThis.self = globalThis;
globalThis.I18n = require('../src/i18n.js');
require('../src/share.js');

test('share text carries the stage, the bill and the public URL (ja and en)', () => {
  const I18n = globalThis.I18n;
  I18n.setLang('ja');
  const ja = I18n.t('share.text', { stage: 'No.27', yen: '¥12,345' });
  assert.ok(ja.includes('No.27'));
  assert.ok(ja.includes('請求額 ¥12,345'));
  assert.ok(ja.includes(URL_EXPECTED), ja);
  I18n.setLang('en');
  assert.ok(I18n.t('share.text', { stage: 'No.27', yen: '¥1' }).includes(URL_EXPECTED));
  I18n.setLang('ja');
});

test('invoice image draws the public URL near a corner', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'fillText') return (text, x, y) => calls.push({ text, x, y });
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 20 });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop, v) { target[prop] = v; return true; }
  });
  const saved = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    const cv = globalThis.Share.drawInvoice({
      stageLabel: 'No.27',
      bill: { reward: 0, damage: 0, total: 0, lines: [] },
      commentText: 'c',
      achievementTexts: [],
      lineLabels: {}
    });
    const hit = calls.find((c) => String(c.text).includes('5umm3r.github.io/juryoku-hikkoshi'));
    assert.ok(hit, 'URL text drawn: ' + JSON.stringify(calls.map((c) => c.text)));
    assert.ok(hit.y > cv.height * 0.85, `URL near the bottom edge, y=${hit.y} of ${cv.height}`);
  } finally {
    globalThis.document = saved;
  }
});
