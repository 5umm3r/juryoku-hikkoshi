/* UI strings: source code uses English keys, display defaults to Japanese. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18n = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var dict = {
    ja: {
      'app.title': '重力引越',
      'app.tagline': '重力が約9秒ごとに向きを変える部屋へ、家具を運び込め。',
      'menu.daily': '今日の現場 No.{no}',
      'menu.free': 'フリープレイ',
      'menu.best': '最高請求額 {yen}',
      'menu.noBest': 'まだ記録がありません',
      'menu.howto': '家具をドラッグで部屋へ。床か壁に接した家具は、ダブルクリック（スマホは長押し）か、ロープボタンを押してからタップで固定できる。同時に固定できるのは3個まで。',
      'menu.bestDaily': '今日の現場 No.{no} 最高 {yen}',
      'menu.bestFree': 'フリープレイ最高 {yen}',
      'menu.noRecord': '記録なし',
      'menu.achievements': '事故実績 {n} / {total}',
      'hud.time': '残り',
      'hud.ropes': 'ロープ',
      'hud.damage': '被害',
      'hud.truck': '荷台',
      'hud.pause': '一時停止',
      'pause.title': '一時停止中',
      'pause.resume': '再開',
      'pause.quit': 'やめる',
      'warn.next': '重力変更まで',
      'tutorial.warn': '画面の縁が光ったら3秒後に重力が変わる。矢印の向きへ全部が落ちる。',
      'toast.ropeLimit': 'ロープは同時に3本まで。どれかを外すと使える',
      'toast.ropeAirborne': '床か壁に接している家具だけ固定できる',
      'toast.ropeArmed': '固定する家具をタップ',
      'toast.shareReady': '画像の準備ができた。もう一度押すと共有する',
      'toast.roped': 'ロープで固定',
      'toast.unroped': '固定を解除',
      'toast.released': '手がすべった',
      'toast.broken': '金魚鉢が割れた',
      'result.invoice': '大家さんからの請求書',
      'result.stage': '現場',
      'result.dailyStage': '今日の現場 No.{no}',
      'result.freeStage': 'フリープレイ',
      'result.reward': '運搬報酬',
      'result.damage': '被害額',
      'result.total': '請求額',
      'result.delivered': '運び込み {n} / {total}',
      'result.newBest': '自己ベスト更新',
      'result.achievements': '事故実績',
      'result.noAchievements': '特になし',
      'result.replay': '事故のリプレイ',
      'result.noReplay': '大きな事故はなかった',
      'result.retry': 'もう一度',
      'result.share': '請求書をシェア',
      'result.menu': 'タイトルへ',
      'result.saved': '請求書の画像を保存した。',
      'result.postLink': 'Xの投稿画面を開く',
      'menu.lockedAch': '未発見',
      'replay.label': 'リプレイ 0.3倍速',
      'replay.close': '閉じる',
      'share.text': '重力引越 {stage} 請求額 {yen}',
      'kind.box': '段ボール',
      'kind.fridge': '冷蔵庫',
      'kind.piano': 'ピアノ',
      'kind.fishbowl': '金魚鉢',
      'landlord.nothing': '何も届いていないんだけど、トラックごと帰ったの？',
      'landlord.negative': '修理代の方が高くついた。次は丁寧に頼むよ。',
      'landlord.messy': '運んではくれたね。壁の凹みは見なかったことにはできない。',
      'landlord.ok': 'まあ、住めなくはない。',
      'landlord.good': 'いい仕事だ。重力が暴れる物件でよくやった。',
      'landlord.perfect': '傷ひとつない。次の入居者もあなたに頼みたい。',
      'ach.ceilingPiano': '天井ピアノ',
      'ach.flyingFish': '金魚、空を飛ぶ',
      'ach.brokenBowl': '金魚鉢、割れる',
      'ach.fridgeAvalanche': '冷蔵庫なだれ',
      'ach.spotless': '無傷の引越',
      'ach.fullHouse': '全部屋入り',
      'ach.leftover': '積み残し',
      'dir.down': '下',
      'dir.up': '上',
      'dir.left': '左',
      'dir.right': '右'
    },
    en: {
      'app.title': 'Gravity Movers',
      'app.tagline': 'Move furniture into a room whose gravity turns every 9 seconds or so.',
      'menu.daily': "Today's Job No.{no}",
      'menu.free': 'Free play',
      'menu.best': 'Best bill {yen}',
      'menu.noBest': 'No record yet',
      'menu.howto': 'Drag furniture into the room. Tie an item touching the floor or a wall with a double-click (long-press on phones), or press the rope button and tap it. Up to 3 at once.',
      'menu.bestDaily': "Today's Job No.{no} best {yen}",
      'menu.bestFree': 'Free play best {yen}',
      'menu.noRecord': 'none',
      'menu.achievements': 'Incidents {n} / {total}',
      'hud.time': 'Time',
      'hud.ropes': 'Rope',
      'hud.damage': 'Damage',
      'hud.truck': 'Truck',
      'hud.pause': 'Pause',
      'pause.title': 'Paused',
      'pause.resume': 'Resume',
      'pause.quit': 'Quit',
      'warn.next': 'Gravity shift in',
      'tutorial.warn': 'When the edge glows, gravity turns in 3 seconds. Everything falls the way the arrow points.',
      'toast.ropeLimit': 'Only 3 ropes at once. Untie one first',
      'toast.ropeAirborne': 'Only items touching the floor or a wall can be tied',
      'toast.ropeArmed': 'Tap an item to tie it',
      'toast.shareReady': 'Image ready. Press again to share',
      'toast.roped': 'Tied down',
      'toast.unroped': 'Untied',
      'toast.released': 'Lost grip',
      'toast.broken': 'The fishbowl broke',
      'result.invoice': "Landlord's Invoice",
      'result.stage': 'Job',
      'result.dailyStage': "Today's Job No.{no}",
      'result.freeStage': 'Free play',
      'result.reward': 'Moving fee',
      'result.damage': 'Damages',
      'result.total': 'Total',
      'result.delivered': 'Delivered {n} / {total}',
      'result.newBest': 'New best',
      'result.achievements': 'Incidents',
      'result.noAchievements': 'None',
      'result.replay': 'Replay the crash',
      'result.noReplay': 'No major crash',
      'result.retry': 'Retry',
      'result.share': 'Share invoice',
      'result.menu': 'Title',
      'result.saved': 'Invoice image saved.',
      'result.postLink': 'Open the post screen on X',
      'menu.lockedAch': 'Locked',
      'replay.label': 'Replay 0.3x',
      'replay.close': 'Close',
      'share.text': 'Gravity Movers {stage} bill {yen}',
      'kind.box': 'Box',
      'kind.fridge': 'Fridge',
      'kind.piano': 'Piano',
      'kind.fishbowl': 'Fishbowl',
      'landlord.nothing': 'Nothing arrived. Did the truck just drive off?',
      'landlord.negative': 'Repairs cost more than the move.',
      'landlord.messy': 'You got it in. The dents in the wall, though.',
      'landlord.ok': 'Livable, I suppose.',
      'landlord.good': 'Good work in a building with unruly gravity.',
      'landlord.perfect': 'Not a scratch. I will call you again.',
      'ach.ceilingPiano': 'Ceiling Piano',
      'ach.flyingFish': 'The Goldfish Flies',
      'ach.brokenBowl': 'Broken Bowl',
      'ach.fridgeAvalanche': 'Fridge Avalanche',
      'ach.spotless': 'Spotless Move',
      'ach.fullHouse': 'Full House',
      'ach.leftover': 'Left on the Truck',
      'dir.down': 'down',
      'dir.up': 'up',
      'dir.left': 'left',
      'dir.right': 'right'
    }
  };

  var lang = 'ja';

  function t(key, params) {
    var s = (dict[lang] && dict[lang][key]) || dict.ja[key] || key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) { return params[k] !== undefined ? params[k] : m; });
    }
    return s;
  }

  function yen(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  }

  function setLang(l) { if (dict[l]) lang = l; }

  /** Fill [data-i18n] elements. */
  function apply(rootEl) {
    var els = rootEl.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
  }

  return { t: t, yen: yen, setLang: setLang, apply: apply, dict: dict, get lang() { return lang; } };
});
