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

  /**
   * state: { cfg, bounds, doorRect, snapshot, info(Map id->info), heldId, time,
   *          warning: {dir, remaining(ms)} | null }
   */
  function draw(ctx, canvasW, canvasH, state) {
    var view = computeView(canvasW, canvasH, state.bounds);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    var snap = state.snapshot;
    drawBuilding(ctx, state.cfg, state.bounds, snap.door, state.doorRect);

    snap.bodies.forEach(function (b) {
      var info = state.info.get(b[0]);
      if (!info) return;
      drawItem(ctx, info, b[1], b[2], b[3], !!b[4], !!b[5], state.heldId === b[0], state.time);
    });

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
