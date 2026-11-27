/*
 * Canvas drawing. Input is a snapshot (positions/angles) plus static item info,
 * so live play and replay share one code path.
 */
(function (root) {
  'use strict';

  var C = {
    outside: '#16191c',
    wall: '#7d868d',
    wallEdge: '#5c646a',
    room: '#dfe3e6',
    roomLine: '#cfd4d8',
    bay: '#30373d',
    bayStripe: '#f2b233',
    door: '#e0782c',
    box: '#b98a52',
    boxEdge: '#6e4f2b',
    tape: '#d8b27a',
    fridge: '#eef2f4',
    fridgeEdge: '#59636b',
    piano: '#1e1f22',
    pianoEdge: '#000000',
    keys: '#f4f4f4',
    bowl: 'rgba(120, 190, 230, 0.45)',
    bowlEdge: '#3f84ab',
    fish: '#f07b2a',
    rope: '#f2b233',
    held: '#2b8cd6',
    warn: '224, 120, 44'
  };

  var MARGIN = 22;

  function computeView(canvasW, canvasH, bounds) {
    var worldW = bounds.right - bounds.left + MARGIN * 2;
    var worldH = bounds.bottom - bounds.top + MARGIN * 2;
    var scale = Math.min(canvasW / worldW, canvasH / worldH);
    return {
      scale: scale,
      ox: (canvasW - worldW * scale) / 2 - (bounds.left - MARGIN) * scale,
      oy: (canvasH - worldH * scale) / 2 - (bounds.top - MARGIN) * scale
    };
  }

  function toWorld(view, px, py) {
    return { x: (px - view.ox) / view.scale, y: (py - view.oy) / view.scale };
  }

  function drawBuilding(ctx, cfg, bounds, doorClosed, doorRect) {
    var bay = cfg.bay;
    var room = cfg.room;
    // walls band
    ctx.fillStyle = C.wall;
    ctx.fillRect(bounds.left - MARGIN, bounds.top - MARGIN, bounds.right - bounds.left + MARGIN * 2, bounds.bottom - bounds.top + MARGIN * 2);
    // room
    ctx.fillStyle = C.room;
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.strokeStyle = C.roomLine;
    ctx.lineWidth = 2;
    for (var x = room.x + 70; x < room.x + room.w; x += 70) {
      ctx.beginPath(); ctx.moveTo(x, room.y); ctx.lineTo(x, room.y + room.h); ctx.stroke();
    }
    // truck bay
    ctx.fillStyle = C.bay;
    ctx.fillRect(bay.x, bay.y, bay.w, bay.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(bay.x, bay.y, bay.w, 14); ctx.rect(bay.x, bay.y + bay.h - 14, bay.w, 14); ctx.clip();
    ctx.fillStyle = C.bayStripe;
    for (var s = -40; s < bay.w + 40; s += 28) {
      ctx.beginPath();
      ctx.moveTo(bay.x + s, bay.y); ctx.lineTo(bay.x + s + 14, bay.y);
      ctx.lineTo(bay.x + s - 14 + 14, bay.y + bay.h); ctx.lineTo(bay.x + s - 14, bay.y + bay.h);
      ctx.fill();
    }
    ctx.restore();
    // door (vertical divider: bay left of room; horizontal: bay above room)
    var d = doorRect;
    var vertical = d.h > d.w;
    if (doorClosed) {
      ctx.fillStyle = C.door;
      if (vertical) ctx.fillRect(d.x + 6, d.y, d.w - 12, d.h);
      else ctx.fillRect(d.x, d.y + 6, d.w, d.h - 12);
    } else {
      ctx.fillStyle = C.room;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = C.door;
      if (vertical) {
        ctx.fillRect(d.x, d.y - 6, d.w, 6);
        ctx.fillRect(d.x, d.y + d.h, d.w, 6);
      } else {
        ctx.fillRect(d.x - 6, d.y, 6, d.h);
        ctx.fillRect(d.x + d.w, d.y, 6, d.h);
      }
    }
    // edge lines
    ctx.strokeStyle = C.wallEdge;
    ctx.lineWidth = 3;
    ctx.strokeRect(room.x, room.y, room.w, room.h);
    ctx.strokeRect(bay.x, bay.y, bay.w, bay.h);
  }

  function rectPath(ctx, s) {
    ctx.beginPath();
    ctx.rect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
  }

  function drawItem(ctx, info, x, y, angle, broken, roped, held, time) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    var shapes = info.shapes;
    var k = info.kind;
    ctx.lineWidth = 3;
    if (k === 'box') {
      var b = shapes[0];
      rectPath(ctx, b); ctx.fillStyle = C.box; ctx.fill(); ctx.strokeStyle = C.boxEdge; ctx.stroke();
      ctx.fillStyle = C.tape;
      ctx.fillRect(b.x - b.w / 2, b.y - 5, b.w, 10);
      ctx.fillRect(b.x - 5, b.y - b.h / 2, 10, b.h / 2);
    } else if (k === 'fridge') {
      var f = shapes[0];
      rectPath(ctx, f); ctx.fillStyle = C.fridge; ctx.fill(); ctx.strokeStyle = C.fridgeEdge; ctx.stroke();
      var splitY = f.y - f.h / 2 + f.h * 0.36;
      ctx.beginPath(); ctx.moveTo(f.x - f.w / 2, splitY); ctx.lineTo(f.x + f.w / 2, splitY); ctx.stroke();
      ctx.fillStyle = C.fridgeEdge;
      ctx.fillRect(f.x + f.w / 2 - 12, splitY - 26, 5, 18);
      ctx.fillRect(f.x + f.w / 2 - 12, splitY + 10, 5, 28);
    } else if (k === 'piano') {
      shapes.forEach(function (s) {
        rectPath(ctx, s); ctx.fillStyle = C.piano; ctx.fill(); ctx.strokeStyle = C.pianoEdge; ctx.stroke();
      });
      var top = shapes[0];
      var ky = top.y + top.h / 2 - 12;
      ctx.fillStyle = C.keys;
      ctx.fillRect(top.x - top.w / 2 + 22, ky, top.w - 44, 9);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1;
      for (var kx = top.x - top.w / 2 + 28; kx < top.x + top.w / 2 - 22; kx += 7) {
        ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx, ky + 9); ctx.stroke();
      }
    } else if (k === 'fishbowl') {
      var c = shapes[0];
      var r = c.r;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      if (!broken) {
        ctx.fillStyle = C.bowl; ctx.fill();
        ctx.strokeStyle = C.bowlEdge; ctx.stroke();
        // fish stays upright-ish relative to the bowl
        var wob = Math.sin(time / 300) * 4;
        ctx.fillStyle = C.fish;
        ctx.beginPath(); ctx.ellipse(c.x + wob, c.y + 3, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(c.x + wob - 7, c.y + 3); ctx.lineTo(c.x + wob - 14, c.y - 3); ctx.lineTo(c.x + wob - 14, c.y + 9); ctx.fill();
      } else {
        ctx.strokeStyle = C.bowlEdge;
        ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c.x - r * 0.7, c.y - r * 0.2); ctx.lineTo(c.x - r * 0.1, c.y + r * 0.1); ctx.lineTo(c.x + r * 0.2, c.y - r * 0.6);
        ctx.moveTo(c.x - r * 0.1, c.y + r * 0.1); ctx.lineTo(c.x + r * 0.5, c.y + r * 0.5);
        ctx.stroke();
        ctx.fillStyle = C.fish;
        ctx.beginPath(); ctx.ellipse(c.x, c.y + r * 0.55, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (roped) {
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 5;
      var bb = shapeBounds(shapes);
      ctx.beginPath();
      ctx.moveTo(bb.minX, bb.minY); ctx.lineTo(bb.maxX, bb.maxY);
      ctx.moveTo(bb.maxX, bb.minY); ctx.lineTo(bb.minX, bb.maxY);
      ctx.stroke();
      ctx.fillStyle = C.rope;
      ctx.fillRect(-5, -5, 10, 10);
    }
    if (held) {
      var hb = shapeBounds(shapes);
      ctx.strokeStyle = C.held;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(hb.minX - 6, hb.minY - 6, hb.maxX - hb.minX + 12, hb.maxY - hb.minY + 12);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function shapeBounds(shapes) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    shapes.forEach(function (s) {
      var hw = s.type === 'circle' ? s.r : s.w / 2;
      var hh = s.type === 'circle' ? s.r : s.h / 2;
      b.minX = Math.min(b.minX, s.x - hw); b.maxX = Math.max(b.maxX, s.x + hw);
      b.minY = Math.min(b.minY, s.y - hh); b.maxY = Math.max(b.maxY, s.y + hh);
    });
    return b;
  }

  var ANGLES = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  /** Solid arrow centered at (x,y) pointing in dir. */
  function drawArrow(ctx, x, y, size, dir, fill) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ANGLES[dir]);
    ctx.beginPath();
    ctx.moveTo(size * 0.5, 0);
    ctx.lineTo(0, -size * 0.42);
    ctx.lineTo(0, -size * 0.17);
    ctx.lineTo(-size * 0.5, -size * 0.17);
    ctx.lineTo(-size * 0.5, size * 0.17);
    ctx.lineTo(0, size * 0.17);
    ctx.lineTo(0, size * 0.42);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  function drawEdgeGlow(ctx, rect, dir, strength) {
    var depth = 90;
    var g;
    var a = 'rgba(' + C.warn + ',' + (0.85 * strength).toFixed(3) + ')';
    var z = 'rgba(' + C.warn + ',0)';
    if (dir === 'down') { g = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y + rect.h - depth); }
    if (dir === 'up') { g = ctx.createLinearGradient(0, rect.y, 0, rect.y + depth); }
    if (dir === 'left') { g = ctx.createLinearGradient(rect.x, 0, rect.x + depth, 0); }
    if (dir === 'right') { g = ctx.createLinearGradient(rect.x + rect.w, 0, rect.x + rect.w - depth, 0); }
    g.addColorStop(0, a);
    g.addColorStop(1, z);
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  var LABEL_FONT = '700 30px system-ui, sans-serif';
  var GUIDE_FONT = '800 34px system-ui, sans-serif';

  /** Text on a solid plate so it reads over any background. */
  function plateText(ctx, text, x, y, font, fg, bg) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var w = ctx.measureText(text).width + 24;
    var h = Number((font.match(/(\d+)px/) || [0, 30])[1]) + 16;
    ctx.fillStyle = bg;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = fg;
    ctx.fillText(text, x, y);
  }

  /** Names of the three areas: truck bay, door, room. */
  function drawAreaLabels(ctx, cfg, doorRect, labels) {
    var bay = cfg.bay;
    var room = cfg.room;
    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(242, 178, 51, 0.9)';
    ctx.fillText(labels.bay, bay.x + 18, bay.y + 22);
    ctx.fillStyle = 'rgba(30, 34, 38, 0.6)';
    ctx.fillText(labels.room, room.x + 18, room.y + 16);
    var d = doorRect;
    ctx.save();
    ctx.translate(d.x + d.w / 2, d.y + d.h / 2);
    if (d.h > d.w) ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1e2226';
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText(labels.door, 0, 0);
    ctx.restore();
  }

  /** Route bay -> door -> room, and a pulsing frame on the room. */
  function drawGoal(ctx, cfg, doorRect, text, time, frameOnly) {
    var bay = cfg.bay;
    var room = cfg.room;
    var d = doorRect;
    var vertical = d.h > d.w;
    var pulse = 0.5 + 0.5 * Math.sin(time / 220);
    ctx.strokeStyle = 'rgba(' + C.warn + ',' + (0.45 + 0.5 * pulse).toFixed(3) + ')';
    ctx.lineWidth = 10;
    ctx.strokeRect(room.x + 5, room.y + 5, room.w - 10, room.h - 10);
    if (frameOnly) return; // the gravity warning owns the middle of the room
    var dc = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    var a = vertical ? { x: bay.x + bay.w / 2, y: dc.y } : { x: dc.x, y: bay.y + bay.h / 2 };
    var b = vertical ? { x: room.x + 150, y: dc.y } : { x: dc.x, y: room.y + 150 };
    var c = { x: room.x + room.w / 2, y: room.y + room.h / 2 + 60 };
    ctx.strokeStyle = 'rgba(' + C.warn + ',0.9)';
    ctx.lineWidth = 8;
    ctx.setLineDash([22, 14]);
    ctx.lineDashOffset = -time / 30;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    var ang = Math.atan2(c.y - b.y, c.x - b.x);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(' + C.warn + ',0.95)';
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-18, -20); ctx.lineTo(-18, 20); ctx.closePath(); ctx.fill();
    ctx.restore();
    // label just past the arrowhead, away from the incoming path
    plateText(ctx, text, c.x + Math.cos(ang) * 110, c.y + Math.sin(ang) * 80, GUIDE_FONT, '#ffffff', 'rgba(' + C.warn + ',0.95)');
  }

  /** A paid item: green badge with a check mark. */
  function drawCheck(ctx, x, y) {
    ctx.fillStyle = '#2e9d5b';
    ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x - 10, y + 1); ctx.lineTo(x - 3, y + 9); ctx.lineTo(x + 11, y - 8); ctx.stroke();
  }

  /** Short text that rises from where something happened and fades out. */
  function drawPop(ctx, pop) {
    var life = pop.life || 1600;
    if (pop.age > life) return;
    var k = pop.age / life;
    ctx.save();
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    // rises above the on-screen tie button that sits just over the item
    var y = pop.y - 110 - 90 * Math.min(1, pop.age / 600);
    plateText(ctx, pop.text, pop.x, y, '800 36px system-ui, sans-serif', '#ffffff', pop.kind === 'rope' ? 'rgba(30, 34, 38, 0.92)' : '#2e9d5b');
    ctx.restore();
  }

  /** Hand pointing at an item, with "drag this". */
  function drawDragHint(ctx, x, y, text, time) {
    var bob = Math.sin(time / 180) * 8;
    var r = 46 + 10 * Math.abs(Math.sin(time / 300));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    // hand: index finger pointing up-left at the item, palm below-right
    ctx.save();
    ctx.translate(x + 22, y + 26 + bob);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1e2226';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(6, -6);
    ctx.lineTo(30, -6); ctx.lineTo(30, 28); ctx.lineTo(-10, 28); ctx.lineTo(-20, 4);
    ctx.lineTo(-6, -2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    plateText(ctx, text, x, y - r - 34, GUIDE_FONT, '#16191c', '#ffffff');
  }

  /**
   * state: { cfg, bounds, doorRect, snapshot, info(Map id->info), heldId, time,
   *          warning: {dir, remaining(ms), label?} | null,
   *          labels?: {bay, room, door},           // live play only
   *          guide?: {goal, goalText, dragId, dragText, ringId} } // live play only
   */
  function draw(ctx, canvasW, canvasH, state) {
    var view = computeView(canvasW, canvasH, state.bounds);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    var snap = state.snapshot;
    drawBuilding(ctx, state.cfg, state.bounds, snap.door, state.doorRect);
    if (state.labels) drawAreaLabels(ctx, state.cfg, state.doorRect, state.labels);
    var guide = state.guide;
    if (guide && guide.goal) drawGoal(ctx, state.cfg, state.doorRect, guide.goalText, state.time, !!state.warning);

    snap.bodies.forEach(function (b) {
      var info = state.info.get(b[0]);
      if (!info) return;
      drawItem(ctx, info, b[1], b[2], b[3], !!b[4], !!b[5], state.heldId === b[0], state.time);
    });

    var marks = state.marks;
    if (marks) {
      var done = marks.done || [];
      snap.bodies.forEach(function (b) { if (done.indexOf(b[0]) >= 0) drawCheck(ctx, b[1], b[2]); });
    }
    if (guide && (guide.dragId || guide.ringId || guide.ropeId)) {
      snap.bodies.forEach(function (b) {
        if (b[0] === guide.dragId) drawDragHint(ctx, b[1], b[2], guide.dragText, state.time);
        if (b[0] === guide.ropeId) drawDragHint(ctx, b[1], b[2], guide.ropeText, state.time);
        if (b[0] === guide.ringId) {
          ctx.strokeStyle = 'rgba(' + C.warn + ',0.95)';
          ctx.lineWidth = 6;
          ctx.setLineDash([12, 8]);
          ctx.beginPath(); ctx.arc(b[1], b[2], 95, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    }

    if (marks && marks.pops) marks.pops.forEach(function (pp) { drawPop(ctx, pp); });

    var whole = { x: state.bounds.left, y: state.bounds.top, w: state.bounds.right - state.bounds.left, h: state.bounds.bottom - state.bounds.top };
    if (state.warning) {
      var rem = state.warning.remaining;
      var pulse = 0.55 + 0.45 * Math.abs(Math.sin(rem / 160));
      drawEdgeGlow(ctx, whole, state.warning.dir, pulse);
      var room = state.cfg.room;
      var cx = room.x + room.w / 2;
      var cy = room.y + room.h / 2;
      drawArrow(ctx, cx, cy, 300, state.warning.dir, 'rgba(' + C.warn + ',' + (0.35 + 0.3 * pulse).toFixed(3) + ')');
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 96px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.max(1, Math.ceil(rem / 1000))), cx, cy);
      if (state.warning.label) {
        // put the text where the furniture is not: items rest on the side current
        // gravity points at (and their tie buttons sit just above them)
        var ly = snap.g === 'down' || state.warning.dir === 'down' ? cy - 250 : cy + 200;
        plateText(ctx, state.warning.label, cx, ly, '800 52px system-ui, sans-serif', '#ffffff', 'rgba(22, 25, 28, 0.85)');
        if (state.warning.sub) plateText(ctx, state.warning.sub, cx, ly + 66, '700 34px system-ui, sans-serif', '#16191c', '#ffffff');
      }
    }
    // current gravity indicator, top-right corner of the room
    var r = state.cfg.room;
    drawArrow(ctx, r.x + r.w - 44, r.y + 44, 52, snap.g, 'rgba(30, 34, 38, 0.55)');
    return view;
  }

  root.Render = {
    computeView: computeView,
    toWorld: toWorld,
    draw: draw,
    drawArrow: drawArrow,
    drawItem: drawItem,
    colors: C
  };
})(typeof self !== 'undefined' ? self : this);
