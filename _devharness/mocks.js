/* ============================================================================
 * mocks.js — the fake SillyTavern runtime the real plugin is loaded into.
 *
 * Load order in harness.html: fixtures.js -> mocks.js -> dist/index.js
 * The plugin is a plain (non-module) browser script, so `SillyTavern`,
 * `toastr` and `jQuery` must already be globals when it executes.
 * ==========================================================================*/
(function () {
  'use strict';

  var F = window.FIXTURES;
  var H = window.__cvh = {
    consoleLog: [],       // {type, text} captured from console.*
    pageErrors: [],       // uncaught errors / rejections
    fetchLog: [],         // {url, body}
    fetchCount: {},
    startedAt: Date.now(),
  };

  /* ------------------------------------------------------- console capture */
  ['error', 'warn', 'log'].forEach(function (kind) {
    var orig = console[kind];
    console[kind] = function () {
      var args = Array.prototype.slice.call(arguments);
      var text = args.map(function (a) {
        if (a instanceof Error) return a.name + ': ' + a.message;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ');
      H.consoleLog.push({ type: kind, text: text });
      if (orig) orig.apply(console, args);
    };
  });
  window.addEventListener('error', function (e) {
    H.pageErrors.push({ kind: 'error', message: String(e.message || e), source: e.filename, line: e.lineno });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    H.pageErrors.push({ kind: 'unhandledrejection', message: r && r.message ? r.message : String(r) });
  });

  /* ------------------------------------------------------------ DOMPurify */
  // Real SillyTavern ships DOMPurify as a global. ChatVault's reader calls
  // window.DOMPurify.sanitize(renderRichMd(text), {...}); without it the plugin
  // fails closed and prints the generated HTML as literal text, which would make
  // every reader screenshot meaningless.
  //
  // This stub honours the options the plugin actually passes (ALLOWED_TAGS,
  // ALLOWED_ATTR, ALLOWED_URI_REGEXP, FORBID_TAGS, FORBID_ATTR) using a detached
  // DOMParser document (nothing executes). It is a *rendering* stand-in, not a
  // security-equivalent sanitizer.
  (function () {
    function toSet(list) {
      var s = {};
      (list || []).forEach(function (x) { s[String(x).toLowerCase()] = 1; });
      return s;
    }
    window.DOMPurify = {
      version: 'harness-stub',
      sanitize: function (html, cfg) {
        if (html == null) return '';
        cfg = cfg || {};
        var allowedTags = cfg.ALLOWED_TAGS ? toSet(cfg.ALLOWED_TAGS) : null;
        var forbidTags = toSet(cfg.FORBID_TAGS);
        var allowedAttrs = cfg.ALLOWED_ATTR ? toSet(cfg.ALLOWED_ATTR) : null;
        var forbidAttrs = toSet(cfg.FORBID_ATTR);
        var uriRe = cfg.ALLOWED_URI_REGEXP || null;

        var doc;
        try {
          doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
        } catch (e) {
          return '';
        }
        var body = doc.body;

        (function walk(node) {
          Array.prototype.slice.call(node.childNodes).forEach(function (n) {
            if (n.nodeType === 8) { n.remove(); return; }
            if (n.nodeType !== 1) return;
            var tag = n.tagName.toLowerCase();
            if (forbidTags[tag] || (allowedTags && !allowedTags[tag])) { n.remove(); return; }
            Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
              var name = a.name.toLowerCase();
              if (forbidAttrs[name] || /^on/i.test(name)) { n.removeAttribute(a.name); return; }
              if (allowedAttrs && !allowedAttrs[name]) { n.removeAttribute(a.name); return; }
              if ((name === 'href' || name === 'src') && uriRe && !uriRe.test(a.value)) {
                n.removeAttribute(a.name);
              }
            });
            walk(n);
          });
        })(body);

        return body.innerHTML;
      },
      isSupported: true,
    };
    H.hasDOMPurify = true;
  })();

  /* ------------------------------------------------------ storage shim */
  // file:// documents normally do have localStorage in Chrome, but a locked-down
  // profile may throw. Fall back to an in-memory implementation so the plugin's
  // meta/settings paths behave identically either way.
  (function () {
    var ok = true;
    try {
      window.localStorage.setItem('__cvh_probe', '1');
      window.localStorage.removeItem('__cvh_probe');
    } catch (e) { ok = false; }
    H.storageMode = ok ? 'native' : 'shim';
    if (ok) return;
    var store = {};
    var fake = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; },
      clear: function () { store = {}; },
      key: function (i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; },
    };
    try {
      Object.defineProperty(window, 'localStorage', { value: fake, configurable: true });
    } catch (e) {
      H.pageErrors.push({ kind: 'storage', message: 'cannot install localStorage shim: ' + e.message });
    }
  })();

  // Seed custom titles / tags / starred / bookmarks exactly where the plugin looks.
  try {
    localStorage.setItem(F.metaStorageKey, JSON.stringify(F.meta));
  } catch (e) {
    H.pageErrors.push({ kind: 'storage', message: 'seed meta failed: ' + e.message });
  }

  /* ------------------------------------------------------------- globals */

  // Character id 0 == 苏晚, so the "当前角色" tab has real content.
  window.SillyTavern = {
    getContext: function () {
      return {
        characters: F.characters,
        characterId: 0,
        chat: [],
        // Real ST hands back the currently-open chat file here; the plugin's
        // isActiveChat() strips the extension off it, so point it at a fixture
        // chat to exercise the "使用中" badge + auto-opened card fold.
        chatId: '长夜漫谈.jsonl',
        name1: '旅人',
        name2: F.characters[0] && F.characters[0].name,
        chatMetadata: {},
        extensionSettings: {},
      };
    },
    getRequestHeaders: function () { return { 'Content-Type': 'application/json' }; },
  };
  // The plugin also probes for a global getRequestHeaders() before falling back
  // to the CSRF cookie, so define it to keep the "headers not ready" path quiet.
  window.getRequestHeaders = function () {
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'harness-csrf' };
  };

  window.toastr = {
    success: function (m) { H.consoleLog.push({ type: 'toastr.success', text: String(m) }); },
    info: function (m) { H.consoleLog.push({ type: 'toastr.info', text: String(m) }); },
    warning: function (m) { H.consoleLog.push({ type: 'toastr.warning', text: String(m) }); },
    error: function (m) { H.consoleLog.push({ type: 'toastr.error', text: String(m) }); },
  };

  // The plugin only uses jQuery as "run after DOM ready": `jQuery(async () => {...})`.
  // Callbacks are deferred so they run after the rest of the page has parsed,
  // which is what a real $(fn) does.
  var jq = function (cb) {
    if (typeof cb !== 'function') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { cb(jq); });
    } else {
      setTimeout(function () { cb(jq); }, 0);
    }
  };
  jq.fn = {};
  jq.ready = jq;
  jq.noop = function () {};
  jq.each = function (obj, fn) { Object.keys(obj || {}).forEach(function (k, i) { fn.call(obj[k], i, obj[k]); }); };
  jq.extend = Object.assign.bind(Object);
  window.jQuery = window.$ = jq;

  /* --------------------------------------------------------------- fetch */
  // ChatVault's backend contract, as implemented by SillyTavern 1.1x:
  //   POST /api/characters/all      -> [{avatar, name, ...}]
  //   POST /api/characters/chats    -> [{file_name, mes, file_size, last_mes, chat_items}]
  //   POST /api/chats/get           -> [metadata, ...messages]
  //   POST /api/chats/rename|delete|save|import -> 200 {}
  function jsonResponse(data, status) {
    var body = JSON.stringify(data);
    return {
      ok: (status || 200) < 400,
      status: status || 200,
      statusText: 'OK',
      headers: { get: function () { return 'application/json'; } },
      json: function () { return Promise.resolve(JSON.parse(body)); },
      text: function () { return Promise.resolve(body); },
      clone: function () { return jsonResponse(data, status); },
    };
  }

  function notFound(url) {
    var body = JSON.stringify({ error: true, message: 'harness: no mock for ' + url });
    return {
      ok: false, status: 404, statusText: 'Not Found',
      headers: { get: function () { return 'application/json'; } },
      json: function () { return Promise.resolve(JSON.parse(body)); },
      text: function () { return Promise.resolve(body); },
      clone: function () { return notFound(url); },
    };
  }

  function baseName(x) { return String(x || '').replace(/\.jsonl$/i, ''); }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '';
    var path = url.split('?')[0];
    var payload = {};
    try {
      if (init && typeof init.body === 'string') payload = JSON.parse(init.body);
      else if (init && init.body && typeof init.body === 'object') payload = init.body;
    } catch (e) { /* form-data or empty body */ }

    H.fetchLog.push({ url: url, body: payload });
    H.fetchCount[path] = (H.fetchCount[path] || 0) + 1;

    var answer;
    if (/\/api\/characters\/all$/.test(path)) {
      answer = F.characters;
    } else if (/\/api\/characters\/chats$/.test(path)) {
      answer = F.chatsByAvatar[payload.avatar_url] || [];
    } else if (/\/api\/chats\/get$/.test(path)) {
      var key = baseName(payload.avatar_url) + '::' + baseName(payload.file_name);
      // The real endpoint keys off (avatar_url, file_name); the plugin retries
      // with .jsonl appended, and our fixture keys are already extension-less.
      var body = F.chatBodies[key];
      if (!body) {
        var av = payload.avatar_url;
        var fn = baseName(payload.file_name);
        body = F.chatBodies[av + '::' + fn];
      }
      if (body) answer = body;
      else return Promise.resolve(notFound(url));
    } else if (/\/api\/chats\/(rename|delete|save|import)$/.test(path)) {
      answer = { ok: true };
    } else {
      return Promise.resolve(notFound(url));
    }

    // A macrotask hop keeps the async ordering realistic (render -> fetch -> render).
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(jsonResponse(answer)); }, 3);
    });
  };

  /* -------------------------------------------------- abort console noise */
  // Avatar thumbnails resolve to file:///D:/thumbnail?... and always fail under
  // file://. The images carry onerror handlers, so this is expected noise; tag
  // it so the runner can separate "expected" from "real" console errors.
  H.expectedNoisePatterns = [
    /thumbnail\?/,
    /script\.js/,
    /Failed to load resource/i,
    /net::ERR_FILE_NOT_FOUND/i,
    /Failed to resolve module specifier/i,
  ];

  H.isExpectedNoise = function (text) {
    return /thumbnail\?|script\.js|Failed to load resource|ERR_FILE_NOT_FOUND|Failed to resolve module specifier|Importing a module script failed/i.test(String(text));
  };
})();
