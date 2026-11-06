/* ============================================================================
 * fixtures.js — deterministic mock SillyTavern data for the ChatVault harness.
 *
 * Everything the real plugin asks the backend for is generated here:
 *   - characters            -> SillyTavern.getContext().characters  AND /api/characters/all
 *   - per-character chat index -> /api/characters/chats  [{file_name, mes, file_size, last_mes, chat_items}]
 *   - chat bodies           -> /api/chats/get           [metadata, ...messages]
 *   - local metadata        -> localStorage['st-chatvault-meta'] (customTitle / tags / starred / bookmarks)
 *
 * Timestamps are generated relative to load time so the relative-time formatter
 * ("刚刚 / 3 小时前 / 2 天前") exercises several branches no matter when the
 * harness runs.
 * ==========================================================================*/
(function () {
  'use strict';

  var NOW = Date.now();
  var MIN = 60000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;

  // SillyTavern's humanizedDateTime(): "2026-5-8 @14h 32m 15s 123ms"
  // (this exact shape is what ChatVault's parseSTDate() is written against)
  function stDate(agoMs) {
    var d = new Date(NOW - agoMs);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var ms = String(d.getMilliseconds());
    while (ms.length < 3) ms = '0' + ms;
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() +
      ' @' + p2(d.getHours()) + 'h ' + p2(d.getMinutes()) + 'm ' + p2(d.getSeconds()) + 's ' + ms + 'ms';
  }

  /* ---------------------------------------------------------------- content */

  var LONG_P1 =
    '雨是傍晚开始下的。咖啡馆临街的落地窗上蒙着一层薄薄的水汽，把外面的霓虹揉成一团团模糊的光斑。' +
    '苏晚把最后一盏台灯调暗，指尖在灯罩上停了停，像是舍不得那点温度。她说，其实她一直不太喜欢下雨天，' +
    '因为雨声会让人分不清自己到底是在等谁。可今天她等了整整一个下午，等一个连名字都不确定的人推开门，' +
    '带着一身潮湿的凉意坐到她对面，然后把伞收起来，水滴落在木地板上，一声，两声，像某种迟到的应答。';

  var LONG_P2 =
    '你有没有想过，人的记忆其实不是一条线，而是一叠被雨水泡过的纸。每一张都黏在一起，' +
    '你小心地揭开其中一张，上面写的可能是三年前的某个下午，也可能是昨天说过的一句话。' +
    '苏晚说她最近总在半夜醒来，听见楼下有人在搬动家具的声音，可这栋楼的三层已经空了很久了。';

  var TABLE_MD = [
    '| 项目 | 说明 | 价格 |',
    '|---|---|---|',
    '| 手冲耶加雪菲 | 花香明显，尾段偏柑橘，适合雨天慢慢喝 | ¥38 |',
    '| 燕麦拿铁 | 甜度可调，奶泡打得很绵 | ¥32 |',
    '| 冷萃 | 只做夏季，售完即止 | ¥36 |',
    '| SUPER-CALI-FRAGILISTIC-EXPIALIDOCIOUS-LATTE-WITH-EXTREMELY-LONG-NAME | 用来测试超长英文单词在窄屏下的换行/溢出 | ¥48 |',
  ].join('\n');

  var CODE_MD = [
    '```js',
    'function greet(name) {',
    '  // 这一行故意写得很长很长，用来测试窄屏下代码块是横向滚动还是直接溢出容器',
    '  return `你好，${name}，欢迎来到这家在下雨天依然亮着灯的咖啡馆，请不要客气，随便坐。`;',
    '}',
    'console.log(greet("旅人"));',
    '```',
  ].join('\n');

  var LIST_MD = [
    '今晚的待办（她写在纸巾背面的那种）：',
    '',
    '- 把靠窗第二张桌子的台灯换一个新的灯泡',
    '- 问清楚那个人到底为什么总是在下雨天来',
    '- 记住别再往咖啡里加第二块方糖',
    '- 如果雨停了，就走一段路，不要急着打车',
    '',
    '1. 先把手冲的水温降到 88 度',
    '2. 闷蒸 30 秒，看着粉层慢慢鼓起来',
    '3. 分三段注水，别急',
  ].join('\n');

  var QUOTE_MD = [
    '> “你总说雨会停的。”',
    '> 她笑了一下，没有回答，只是把杯子往我这边推了推。',
  ].join('\n');

  var INLINE_HTML_MD = (function () {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240">' +
      '<rect width="800" height="240" fill="#334155"/>' +
      '<circle cx="120" cy="120" r="72" fill="#38bdf8" opacity="0.55"/>' +
      '<text x="230" y="112" fill="#e2e8f0" font-size="42" font-family="sans-serif">800x240 test image</text>' +
      '<text x="230" y="160" fill="#94a3b8" font-size="26" font-family="sans-serif">checks max-width:100% on phones</text>' +
      '</svg>';
    var uri = 'data:image/svg+xml;base64,' + btoa(svg);
    return '<img src="' + uri + '" alt="800x240 test image" />' +
      '<p style="color:#8ab4f8;margin-top:8px;">窗外的霓虹倒影在水洼里，碎成一片一片。</p>';
  })();

  var LONG_TOKEN =
    'https://example.com/a/very/long/url/without/any/breaks/that/must/not/blow/out/the/layout/' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  var THINKING =
    '<thinking>（这里是一段被剥离的思考内容，默认设置下不应该出现在阅读模式里）</thinking>' +
    '她把牛奶推到我面前，什么都没说。';

  var USER_INPUT_WRAPPED =
    '（我接过杯子，指尖碰到她的）我其实记得，你上次说不加糖。' +
    '<本轮用户输入>那你今天为什么还是加了一块？</本轮用户输入>';

  var SHORT_LINES = [
    '她“嗯”了一声，低头去看杯底的拉花。',
    '窗外的雨小了一点，路面上的光斑开始连成一条河。',
    '“再坐一会儿吧。”我说。',
    '她把下巴搁在手背上，眼睛半睁半闭，像只不太想承认自己困了的猫。',
    '楼上的住户开始拖动椅子，木头在水泥地上划出一声很长的响。',
    '我想起很久以前也有人这样坐在我对面，只是那个人后来再也没有来过这家店。',
    '“明天还来吗？”她问得很轻，好像怕被雨听见。',
  ];

  /* -------------------------------------------------------------- messages */

  function mes(name, text, isUser, agoMs) {
    return {
      name: name,
      is_user: !!isUser,
      is_system: false,
      send_date: stDate(agoMs),
      mes: text,
      extra: {},
    };
  }

  // Turn a chat spec into the real [/api/chats/get] payload: [metadata, ...messages]
  function buildChatBody(spec) {
    var arr = [];
    arr.push({
      user_name: 'unused',
      character_name: spec.charName,
      create_date: stDate(spec.agoMs + spec.count * 3 * MIN),
      chat_metadata: { note: 'harness fixture' },
      integrity: spec.file + '-fixture',
    });

    // --- rich opening page (page 1 of the reader must look interesting) ---
    // NB: index 7 is the last message of the short (7-8 msg) fixtures, so keep it
    // plain prose — otherwise a data-URI <img> would leak base64 into the card
    // preview snippet.
    var opening = [
      [spec.charName, LONG_P1, false],
      [spec.userName, '（推门进来，收起伞）抱歉，路上有点堵。', true],
      [spec.charName, TABLE_MD, false],
      [spec.userName, '这张单子是你自己写的？字真好看。', true],
      [spec.charName, CODE_MD, false],
      [spec.charName, QUOTE_MD + '\n\n' + INLINE_HTML_MD, false],
      [spec.userName, '那我等你忙完。', true],
      [spec.charName, LIST_MD, false],
      [spec.userName, USER_INPUT_WRAPPED, true],
      [spec.charName, THINKING, false],
      [spec.charName, LONG_P2, false],
      [spec.userName, LONG_TOKEN, true],
      [spec.charName, '', false],
    ];

    var i = 0;
    for (; i < opening.length && arr.length - 1 < spec.count; i++) {
      arr.push(mes(opening[i][0], opening[i][1], opening[i][2], spec.agoMs + (spec.count - i) * 3 * MIN));
    }
    // --- procedural tail ---
    for (var n = arr.length - 1; n < spec.count; n++) {
      var isUser = n % 2 === 0;
      var base = SHORT_LINES[n % SHORT_LINES.length];
      var text = base;
      if (n % 11 === 0) text = base + '\n\n' + SHORT_LINES[(n + 3) % SHORT_LINES.length];
      if (n % 17 === 0) text = '**第 ' + n + ' 楼** —— ' + base + ' ~~删除线测试~~ 和 `行内代码` 与 *斜体*。';
      arr.push(mes(isUser ? spec.userName : spec.charName, text, isUser,
        spec.agoMs + (spec.count - n) * 3 * MIN));
    }
    return arr;
  }

  /* --------------------------------------------------------------- roster */

  var characters = [
    { name: '苏晚', avatar: 'SuWan.png', description: '深夜咖啡馆的店主。', tags: ['女性', '现代'], chat: '长夜漫谈', fav: false },
    { name: '林间', avatar: 'LinJian.png', description: '在旧城区送信的年轻人。', tags: ['男性', '悬疑'], chat: '雨夜便利店', fav: false },
    { name: 'Nyx', avatar: 'Nyx.png', description: 'A very tall stranger who never takes off the coat.', tags: ['other'], chat: '深渊回廊', fav: false },
  ];

  // chat index entries, i.e. /api/characters/chats rows
  var CHAT_SPECS = [
    { avatar: 'SuWan.png', charName: '苏晚', userName: '旅人', file: '长夜漫谈', count: 130, sizeKb: 268, agoMs: 7 * MIN },
    { avatar: 'SuWan.png', charName: '苏晚', userName: '旅人', file: '咖啡馆初遇', count: 42, sizeKb: 96, agoMs: 3 * HOUR },
    { avatar: 'SuWan.png', charName: '苏晚', userName: '旅人', file: '「我们去看海吧」', count: 18, sizeKb: 41, agoMs: 4 * DAY },
    { avatar: 'LinJian.png', charName: '林间', userName: '旅人', file: '雨夜便利店', count: 24, sizeKb: 58, agoMs: 26 * MIN },
    { avatar: 'LinJian.png', charName: '林间', userName: '旅人', file: '旧城区的信', count: 12, sizeKb: 27, agoMs: 9 * DAY },
    { avatar: 'LinJian.png', charName: '林间', userName: '旅人', file: '新建聊天', count: 0, sizeKb: 0, agoMs: 20 * DAY },
    { avatar: 'Nyx.png', charName: 'Nyx', userName: '旅人', file: '深渊回廊', count: 8, sizeKb: 19, agoMs: 2 * HOUR },
    { avatar: 'Nyx.png', charName: 'Nyx', userName: '旅人',
      file: 'A Very Long English Chat Title That Should Wrap On Narrow Phones', count: 7, sizeKb: 15, agoMs: 40 * DAY },
  ];

  var chatsByAvatar = {};
  var chatBodies = {};      // "<avatar>::<basename>" -> [metadata, ...messages]
  var chatIndex = {};       // "<avatar>::<basename>" -> {file_name, mes, ...}

  CHAT_SPECS.forEach(function (spec) {
    var base = spec.file;                       // file_name WITHOUT .jsonl (that is what the plugin stores)
    var row = {
      file_name: base + '.jsonl',
      mes: spec.count,
      file_size: spec.sizeKb * 1024,
      last_mes: stDate(spec.agoMs),
      chat_items: spec.count,
      create_date: stDate(spec.agoMs + spec.count * 3 * MIN),
    };
    if (!chatsByAvatar[spec.avatar]) chatsByAvatar[spec.avatar] = [];
    chatsByAvatar[spec.avatar].push(row);
    chatBodies[spec.avatar + '::' + base] = buildChatBody(spec);
    chatIndex[spec.avatar + '::' + base] = row;
  });

  /* -------------------------------------------- local metadata (localStorage) */

  var META = {
    // starred + custom title + tags + bookmarks (drives bookmark UI / favorites tab)
    'SuWan.png::长夜漫谈': {
      starred: true,
      customTitle: '长夜漫谈 · 修订版',
      tags: ['史诗', '夜间', '重要'],
      bookmarks: [
        { idx: 3, snippet: TABLE_MD.slice(0, 20), note: '价格表', createdAt: NOW - DAY },
        { idx: 17, snippet: '这一楼有转折', note: '', createdAt: NOW - 2 * HOUR },
        { idx: 64, snippet: '雨停了', note: '记得回看', createdAt: NOW - MIN }
      ],
    },
    'SuWan.png::咖啡馆初遇': { starred: true, tags: ['现代AU', '甜'] },
    'LinJian.png::雨夜便利店': { starred: true, customTitle: '雨夜便利店（改）', tags: ['短篇'] },
    'Nyx.png::深渊回廊': { tags: ['dark', '英文'] },
  };

  window.FIXTURES = {
    now: NOW,
    characters: characters,
    chatsByAvatar: chatsByAvatar,
    chatBodies: chatBodies,
    chatIndex: chatIndex,
    meta: META,
    metaStorageKey: 'st-chatvault-meta',
    // handy handles for the scene driver
    readerChat: { avatar: 'SuWan.png', file: '长夜漫谈', count: 130 },
    stDate: stDate,
  };
})();
