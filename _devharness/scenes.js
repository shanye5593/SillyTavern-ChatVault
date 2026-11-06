/* ============================================================================
 * scenes.js — drives the REAL plugin UI to a named state, then settles.
 *
 * Every scene clicks real DOM nodes produced by index.js (no direct calls into
 * render functions), so what gets screenshotted is what a user would see.
 * Selected with ?scene=<name>.  Exposes:
 *   window.__cvh.scene = { name, ready, error, steps, ms }
 *   window.__ready     = Promise resolved when the scene has settled
 *   document.title     = 'READY'   and   body[data-scene-ready="1"]
 * ==========================================================================*/
(function () {
  'use strict';

  var F = window.FIXTURES;
  var H = window.__cvh;
  var params = new URLSearchParams(location.search);
  var SCENE = params.get('scene') || 'panel-recent';
  var MEASURE = params.get('measure') === '1';

  var state = H.scene = {
    name: SCENE,
    ready: false,
    error: null,
    steps: [],
    t0: (window.performance && performance.now()) || 0,
    ms: 0,
  };
  document.documentElement.setAttribute('data-scene', SCENE);

  /* ------------------------------------------------------------- utilities */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function raf() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  async function raf2() { await raf(); await raf(); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function step(msg) { state.steps.push(msg); }

  async function waitFor(fn, label, timeout) {
    var limit = timeout == null ? 6000 : timeout;
    var t0 = performance.now();
    var lastErr = null;
    for (;;) {
      try {
        var v = fn();
        if (v) return v;
      } catch (e) { lastErr = e; }
      if (performance.now() - t0 > limit) {
        throw new Error('timeout after ' + limit + 'ms waiting for ' + label +
          (lastErr ? ' (' + lastErr.message + ')' : ''));
      }
      await sleep(20);
    }
  }

  function mustClick(sel, label) {
    var el = typeof sel === 'string' ? q(sel) : sel;
    if (!el) throw new Error('missing element for click: ' + (label || sel));
    if (el.disabled) throw new Error('element is disabled: ' + (label || sel));
    el.click();
    step('click ' + (label || el.className || el.tagName));
    return el;
  }

  function cardByFile(file) {
    return qa('.cv-card').filter(function (c) { return c.dataset.file === file; })[0] || null;
  }
  function activeCard() { return q('.cv-card.is-active'); }

  // Wait until the first N card previews stopped saying "加载预览中…".
  async function waitPreviews(n) {
    n = n || 2;
    try {
      await waitFor(function () {
        var list = qa('.cv-card .cv-preview').slice(0, n);
        return list.length && list.every(function (e) { return !e.classList.contains('is-loading'); });
      }, n + ' previews loaded', 4000);
    } catch (e) { step('preview wait: ' + e.message); }
  }

  /* --------------------------------------------------------- scene steps */

  async function openPanelAndWait() {
    window.openPanel();
    await waitFor(function () { return q('#chatvault_panel'); }, 'panel');
    await waitFor(function () { return qa('.cv-card').length > 0; }, 'cards rendered');
    step('panel open, cards=' + qa('.cv-card').length);
    await waitPreviews(2);
    return qa('.cv-card').length;
  }

  async function openTab(tab) {
    mustClick('.cv-tab[data-tab="' + tab + '"]', 'tab ' + tab);
    await sleep(60);
  }

  async function enterReaderViaCard(file) {
    var card = cardByFile(file) || activeCard() || qa('.cv-card')[0];
    if (!card) throw new Error('no card to read');
    // A real user first opens the card fold, then taps 「阅读模式」.
    if (!card.classList.contains('is-folded-open')) {
      var main = card.querySelector('.cv-card-main');
      if (main) { main.click(); step('open card fold'); await sleep(40); }
    }
    var btn = card.querySelector('.cv-fold-btn[data-act="reader"]');
    if (!btn) throw new Error('reader button missing on card');
    btn.click();
    step('click 阅读模式 on "' + card.dataset.file + '"');
    await waitFor(function () { return qa('.cv-reader-msg').length > 0; }, 'reader messages');
    await sleep(80); // let the pager/settings/fab wiring settle
    return qa('.cv-reader-msg').length;
  }

  /* v0.6.0 feature check helper: synthetic touch drag on a bottom sheet's top
   * band. The plugin's dismiss handler ignores `pointerType === 'mouse'`, so the
   * events are dispatched with pointerType 'touch' (what a finger sends). */
  async function dragSheetDown(sheetSel, dy, label) {
    var sheet = q(sheetSel);
    if (!sheet) throw new Error('no sheet for ' + label);
    var r = sheet.getBoundingClientRect();
    var pid = 7;
    var startY = Math.round(r.top + 12);          // inside the top 60px band
    var x = Math.round(r.left + 40);
    var pa = { bubbles: true, cancelable: true, pointerId: pid, pointerType: 'touch', isPrimary: true, clientX: x };
    state.probe = Object.assign(state.probe || {}, {
      sheetSelector: sheetSel,
      sheetTop: Math.round(r.top),
      sheetHeight: Math.round(r.height),
      dragStartY: startY,
      dragBy: dy,
      pointerType: 'touch',
    });
    sheet.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, pa, { clientY: startY })));
    await sleep(20);
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, pa, { clientY: startY + Math.round(dy / 2) })));
    await sleep(20);
    window.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, pa, { clientY: startY + dy })));
    await sleep(20);
    state.probe.transformDuringDrag = sheet.style.transform || null;
    window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, pa, { clientY: startY + dy })));
    await sleep(200);
    step('drag ' + label + ' down ' + dy + 'px (transform seen: ' + state.probe.transformDuringDrag + ')');
  }

  var SCENES = {
    'panel-recent': async function () {
      await openPanelAndWait();
    },

    'panel-characters': async function () {
      await openPanelAndWait();
      await openTab('characters');
      await waitFor(function () { return qa('.cv-group').length > 0; }, 'character groups');
      step('groups=' + qa('.cv-group').length);
    },

    'panel-characters-expanded': async function () {
      await openPanelAndWait();
      await openTab('characters');
      await waitFor(function () { return qa('.cv-group').length > 0; }, 'character groups');
      var g = qa('.cv-group:not(.is-empty)')[0];
      if (g) {
        mustClick(g.querySelector('.cv-group-header'), 'group header');
        await waitFor(function () { return g.classList.contains('is-open'); }, 'group opened');
        await waitPreviews(2);
      }
    },

    'panel-favorites': async function () {
      await openPanelAndWait();
      await openTab('favorites');
      await waitFor(function () { return qa('.cv-card').length > 0; }, 'favorite cards');
      step('favorites=' + qa('.cv-card').length);
      await waitPreviews(2);
    },

    'panel-current': async function () {
      await openPanelAndWait();
      await openTab('current');
      await waitFor(function () { return q('.cv-current-header') || q('.cv-empty'); }, 'current tab');
      await waitPreviews(1);
    },

    'search-filter': async function () {
      await openPanelAndWait();
      var input = q('#cv_search');
      if (!input) throw new Error('#cv_search missing');
      input.value = '长夜';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      step('search 长夜');
      await waitFor(function () { return qa('.cv-card').length === 1; }, 'filtered to 1 card', 3000);
      await waitPreviews(1);
    },

    'list-with-fold-open': async function () {
      await openPanelAndWait();
      var card = qa('.cv-card').filter(function (c) { return !c.classList.contains('is-folded-open'); })[0]
        || qa('.cv-card')[0];
      var main = card.querySelector('.cv-card-main');
      mustClick(main, 'card main (fold)');
      await waitFor(function () { return card.classList.contains('is-folded-open'); }, 'fold open');
      await waitPreviews(1);
    },

    'reader': async function () {
      await openPanelAndWait();
      var n = await enterReaderViaCard(F.readerChat.file);
      step('reader messages on page=' + n);
    },

    'reader-settings': async function () {
      await openPanelAndWait();
      await enterReaderViaCard(F.readerChat.file);
      mustClick('#cv_reader_gear', 'reader gear');
      await waitFor(function () {
        var p = q('#cv_reader_settings');
        return p && !p.hidden && p.children.length > 0;
      }, 'reader settings panel');
      await sleep(60);
    },

    'reader-lastpage': async function () {
      await openPanelAndWait();
      await enterReaderViaCard(F.readerChat.file);
      var last = q('.cv-pager-btn[data-go="last"]');
      if (!last) throw new Error('pager not rendered (single page?)');
      var total = parseInt((q('.cv-pager-page input') || {}).max || (q('.cv-pager-page input') || {}).value || '1', 10);
      mustClick(last, 'pager last');
      await waitFor(function () {
        var inp = q('.cv-pager-page input');
        return inp && parseInt(inp.value, 10) === Math.max(1, total);
      }, 'last reader page');
      step('reader page ' + (q('.cv-pager-page input') || {}).value + '/' + total);
    },

    'msg-menu': async function () {
      await openPanelAndWait();
      await enterReaderViaCard(F.readerChat.file);
      var floor = q('.cv-reader-msg-floor');
      if (!floor) throw new Error('no floor button in reader');
      mustClick(floor, 'floor number');
      await waitFor(function () { return q('#cv_msg_menu'); }, 'floor menu');
    },

    'edit-modal': async function () {
      await openPanelAndWait();
      var card = activeCard() || qa('.cv-card')[0];
      mustClick(card.querySelector('.cv-act[data-act="edit"]'), 'edit action');
      await waitFor(function () { return q('#cv_modal .cv-modal'); }, 'edit modal');
      await sleep(40);
    },

    'export-modal': async function () {
      await openPanelAndWait();
      var card = activeCard() || qa('.cv-card')[0];
      var btn = card.querySelector('.cv-fold-btn[data-act="export"]');
      if (!btn) throw new Error('export button missing');
      btn.click();
      step('click 导出');
      await waitFor(function () { return q('#cv_modal .cv-export-grid'); }, 'export modal');
    },

    'rules-modal': async function () {
      await openPanelAndWait();
      var card = activeCard() || qa('.cv-card')[0];
      var btn = card.querySelector('.cv-fold-btn[data-act="rules"]');
      if (!btn) throw new Error('rules button missing');
      btn.click();
      step('click 摘取规则');
      await waitFor(function () { return q('#cv_rules_holder .cv-strip-box'); }, 'rules editor');
      var toggle = q('#cv_rules_holder .cv-fold-toggle');
      if (toggle) { toggle.click(); step('expand first rule group'); await sleep(40); }
    },

    'organizer-modal': async function () {
      await openPanelAndWait();
      var card = activeCard() || qa('.cv-card')[0];
      mustClick(card.querySelector('.cv-act[data-act="edit"]'), 'edit action');
      await waitFor(function () { return q('#cv_m_organize'); }, 'edit modal');
      mustClick('#cv_m_organize', '整理楼层');
      await waitFor(function () { return q('.cv-organizer-row') || q('.cv-organizer-empty'); },
        'organizer rows', 8000);
      step('organizer rows=' + qa('.cv-organizer-row').length);
    },

    'preview-tip': async function () {
      await openPanelAndWait();
      await waitPreviews(1);
      var prev = q('.cv-card .cv-preview:not(.is-loading)') || q('.cv-card .cv-preview');
      if (!prev) throw new Error('no preview element');
      var r = prev.getBoundingClientRect();
      prev.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 10),
      }));
      step('contextmenu on .cv-preview');
      await waitFor(function () { return q('#cv_preview_tip'); }, 'preview tooltip', 5000);
    },

    /* v0.6.0 feature check: the reader-settings bottom sheet must close when the
     * user drags its top 60px band down by >72px. */
    'reader-settings-dragclose': async function () {
      await openPanelAndWait();
      await enterReaderViaCard(F.readerChat.file);
      mustClick('#cv_reader_gear', 'reader gear');
      await waitFor(function () {
        var p = q('#cv_reader_settings');
        return p && !p.hidden && p.children.length > 0;
      }, 'reader settings panel');
      await sleep(60);
      var beforeTop = Math.round(q('#cv_reader_settings').getBoundingClientRect().top);
      await dragSheetDown('#cv_reader_settings', 80, 'reader-settings');
      var after = q('#cv_reader_settings');
      state.probe.sheetOpenAfterDrag = !!(after && !after.hidden);
      state.probe.sheetTopBefore = beforeTop;
      if (state.probe.sheetOpenAfterDrag) throw new Error('reader settings sheet did not close after an 80px drag');
    },

    /* same gesture on a bottom-sheet modal (.cv-modal), which goes through closeModal() */
    'edit-modal-dragclose': async function () {
      await openPanelAndWait();
      var card = activeCard() || qa('.cv-card')[0];
      mustClick(card.querySelector('.cv-act[data-act="edit"]'), 'edit action');
      await waitFor(function () { return q('#cv_modal .cv-modal'); }, 'edit modal');
      await sleep(60);
      await dragSheetDown('#cv_modal .cv-modal', 80, 'edit-modal');
      state.probe.modalOpenAfterDrag = !!q('#cv_modal');
      if (state.probe.modalOpenAfterDrag) throw new Error('edit modal did not close after an 80px drag');
    },
  };

  /* ------------------------------------------------------------- runner */

  async function settle() {
    await sleep(60);
    await raf2();
    await sleep(80);
    await raf2();
  }

  async function drive() {
    var fn = SCENES[SCENE];
    if (!fn) throw new Error('unknown scene "' + SCENE + '" (known: ' + Object.keys(SCENES).join(',') + ')');
    // The plugin injects its button from a DOMContentLoaded handler; by the time
    // this runs that has already happened, but wait defensively.
    await waitFor(function () { return typeof window.openPanel === 'function'; }, 'plugin globals', 8000);
    await fn();
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.__ready = (async function () {
      try {
        await drive();
      } catch (e) {
        state.error = (e && e.message) ? e.message : String(e);
        state.steps.push('ERROR: ' + state.error);
      }
      await settle();
      state.ms = Math.round(performance.now() - state.t0);
      state.ready = true;
      try { document.title = 'READY'; } catch (e) {}
      document.body.setAttribute('data-scene-ready', '1');
      if (MEASURE) {
        try { window.__measureInto(); } catch (e) { state.measureError = String(e && e.message || e); }
      }
    })();
  });
})();
