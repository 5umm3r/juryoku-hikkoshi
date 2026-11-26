/* Invoice image generation and sharing. No server: Web Share API or download + X intent. */
(function (root) {
  'use strict';

  var FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", system-ui, sans-serif';

  /**
   * data: { stageLabel, bill, commentText, achievementTexts[], lineLabels{kind:text}, deliveredText }
   */
  function drawInvoice(data) {
    var W = 1080;
    var H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var c = cv.getContext('2d');
    var t = root.I18n.t;
    var yen = root.I18n.yen;

    c.fillStyle = '#16191c';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#fbfbfb';
    c.fillRect(60, 60, W - 120, H - 120);
    // header band
    c.fillStyle = '#e0782c';
    c.fillRect(60, 60, W - 120, 16);

    c.fillStyle = '#16191c';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.font = '700 64px ' + FONT;
    c.fillText(t('result.invoice'), 110, 190);
    c.font = '400 34px ' + FONT;
    c.fillStyle = '#4a5157';
    c.fillText(t('app.title') + '  /  ' + data.stageLabel, 110, 250);

    var y = 330;
    c.strokeStyle = '#16191c';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(110, y); c.lineTo(W - 110, y); c.stroke();
    y += 60;
    c.font = '400 36px ' + FONT;
    data.bill.lines.forEach(function (ln) {
      c.fillStyle = '#16191c';
      c.textAlign = 'left';
      c.fillText(data.lineLabels[ln.kind] + '  ' + ln.delivered + ' / ' + ln.total, 110, y);
      c.textAlign = 'right';
      c.fillText(yen(ln.reward), W - 330, y);
      c.fillStyle = ln.damage > 0 ? '#b3261e' : '#8a9299';
      c.fillText(ln.damage > 0 ? '-' + yen(ln.damage) : yen(0), W - 110, y);
      y += 58;
    });
    y += 10;
    c.strokeStyle = '#c9ced2';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(110, y); c.lineTo(W - 110, y); c.stroke();
    y += 60;
    c.textAlign = 'left';
    c.fillStyle = '#16191c';
    c.fillText(t('result.reward'), 110, y);
    c.textAlign = 'right';
    c.fillText(yen(data.bill.reward), W - 110, y);
    y += 56;
    c.textAlign = 'left';
    c.fillText(t('result.damage'), 110, y);
    c.textAlign = 'right';
    c.fillStyle = '#b3261e';
    c.fillText(data.bill.damage ? '-' + yen(data.bill.damage) : yen(0), W - 110, y);
    y += 40;
    c.strokeStyle = '#16191c';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(110, y); c.lineTo(W - 110, y); c.stroke();
    y += 100;
    c.textAlign = 'left';
    c.fillStyle = '#16191c';
    c.font = '700 44px ' + FONT;
    c.fillText(t('result.total'), 110, y);
    c.textAlign = 'right';
    c.font = '700 84px ' + FONT;
    c.fillStyle = data.bill.total < 0 ? '#b3261e' : '#16191c';
    c.fillText(yen(data.bill.total), W - 110, y);

    y += 90;
    c.textAlign = 'left';
    c.font = '400 34px ' + FONT;
    c.fillStyle = '#4a5157';
    wrap(c, '「' + data.commentText + '」', 110, y, W - 220, 48);

    y += 150;
    c.fillStyle = '#16191c';
    c.font = '700 34px ' + FONT;
    c.fillText(t('result.achievements'), 110, y);
    y += 56;
    c.font = '400 32px ' + FONT;
    var achs = data.achievementTexts.length ? data.achievementTexts : [t('result.noAchievements')];
    var x = 110;
    achs.forEach(function (a) {
      var w = c.measureText(a).width + 36;
      if (x + w > W - 110) { x = 110; y += 62; }
      c.strokeStyle = '#16191c';
      c.lineWidth = 2;
      c.strokeRect(x, y - 38, w, 52);
      c.fillStyle = '#16191c';
      c.fillText(a, x + 18, y);
      x += w + 16;
    });
    // public URL in the bottom-right corner of the dark frame
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.font = '400 26px ' + FONT;
    c.fillStyle = '#9aa3aa';
    c.fillText(root.I18n.t('app.url').replace(/^https:\/\//, ''), W - 64, H - 22);
    return cv;
  }

  function wrap(c, text, x, y, maxW, lh) {
    var line = '';
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      // keep closing punctuation on the same line (simple kinsoku)
      var closing = '」。、？！）'.indexOf(text[i]) >= 0;
      if (c.measureText(test).width > maxW && line && !closing) {
        c.fillText(line, x, y);
        line = text[i];
        y += lh;
      } else {
        line = test;
      }
    }
    if (line) c.fillText(line, x, y);
  }

  function toBlob(cv) {
    return new Promise(function (resolve) { cv.toBlob(resolve, 'image/png'); });
  }

  function intentUrlFor(text) {
    return 'https://x.com/intent/tweet?text=' + encodeURIComponent(text);
  }

  /**
   * Build the image, Blob and File ahead of time (when the result screen opens),
   * so the share button can call navigator.share synchronously: iOS Safari
   * rejects share() that is not directly inside the user gesture.
   */
  async function prepare(data, shareText) {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
    var cv = drawInvoice(data);
    var blob = await toBlob(cv);
    var file = null;
    try { file = new File([blob], 'juryoku-hikkoshi-invoice.png', { type: 'image/png' }); } catch (e) { file = null; }
    var payload = file ? { files: [file], text: shareText } : null;
    var canShareFiles = false;
    try { canShareFiles = !!(payload && navigator.share && navigator.canShare && navigator.canShare(payload)); } catch (e) { canShareFiles = false; }
    return { blob: blob, file: file, payload: payload, canShareFiles: canShareFiles, text: shareText, intentUrl: intentUrlFor(shareText) };
  }

  /** Call from the click handler with a prepared object; no awaits before share(). */
  function shareNow(prep) {
    if (prep.canShareFiles) {
      return { how: 'share', promise: navigator.share(prep.payload) };
    }
    var url = URL.createObjectURL(prep.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'juryoku-hikkoshi-invoice.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    try { root.open(prep.intentUrl, '_blank', 'noopener'); } catch (e) { /* ignore */ }
    return { how: 'downloaded', intentUrl: prep.intentUrl };
  }

  root.Share = { drawInvoice: drawInvoice, prepare: prepare, shareNow: shareNow, intentUrlFor: intentUrlFor };
})(typeof self !== 'undefined' ? self : this);
