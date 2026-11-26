/* Collision and warning sounds synthesized with WebAudio (no audio files). */
(function (root) {
  'use strict';
  var ctx = null;
  var noise = null;
  var lastThud = 0;

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function unlock() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  /** Low wooden thump; strength 0..1 */
  function thud(strength) {
    var c = ensure();
    if (!c || c.state !== 'running') return;
    var now = c.currentTime;
    if (now - lastThud < 0.06) return;
    lastThud = now;
    var s = Math.max(0.05, Math.min(1, strength));
    var src = c.createBufferSource();
    src.buffer = noise;
    var lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180 + 500 * s;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5 * s, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    var osc = c.createOscillator();
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.15);
    var og = c.createGain();
    og.gain.setValueAtTime(0.4 * s, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(lp); lp.connect(g); g.connect(c.destination);
    osc.connect(og); og.connect(c.destination);
    src.start(now); src.stop(now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  }

  /** Glass breaking: bright noise burst plus a few pings. */
  function crash() {
    var c = ensure();
    if (!c || c.state !== 'running') return;
    var now = c.currentTime;
    var src = c.createBufferSource();
    src.buffer = noise;
    var hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    var g = c.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    src.connect(hp); hp.connect(g); g.connect(c.destination);
    src.start(now); src.stop(now + 0.45);
    [2900, 3700, 4600].forEach(function (f, i) {
      var o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      var og = c.createGain();
      var t = now + 0.02 + i * 0.045;
      og.gain.setValueAtTime(0.12, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(og); og.connect(c.destination);
      o.start(t); o.stop(t + 0.3);
    });
  }

  function beep(high) {
    var c = ensure();
    if (!c || c.state !== 'running') return;
    var now = c.currentTime;
    var o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 880 : 660;
    var g = c.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g); g.connect(c.destination);
    o.start(now); o.stop(now + 0.14);
  }

  root.Sfx = { unlock: unlock, thud: thud, crash: crash, beep: beep };
})(typeof self !== 'undefined' ? self : this);
