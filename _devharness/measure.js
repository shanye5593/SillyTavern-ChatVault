/* ============================================================================
 * measure.js — mobile layout measurements for the current scene.
 *
 * Runs only after the scene has settled (scenes.js calls it). Everything is
 * scoped to #chatvault_overlay: the mocked SillyTavern backdrop is deliberately
 * excluded so the numbers describe the plugin, not the mock page.
 *
 * Overflow that lives inside a horizontal scroller (code blocks, wide tables)
 * is reported as "scrollable" rather than "broken", because the user can reach
 * it; clipped/text-losing overflow is what actually breaks on a phone.
 *
 * Produces window.__report plus two DOM copies so a headless run can read it:
 *   <pre id="report">          pretty JSON, parked off-screen (--dump-dom)
 *   <script id="report-json">  raw JSON, no HTML entity escaping
 * ==========================================================================*/
(function () {
  'use strict';

  var MAX_ITEMS = 25;
  var TAP_MIN = 40;          // the brief's threshold
  var TAP_IOS = 44;          // Apple HIG / Material
  var SAFE = 34;             // iPhone home-indicator band

  /* ------------------------------------------------------------- helpers */

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function style(el) { try { return getComputedStyle(el); } catch (e) { return null; } }
  function svgInside(el) { return !!(el && el.closest && el.closest('svg')); }

  function sel(el) {
    if (!el || el.nodeType !== 1) return '?';
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      if (node.id) { parts.unshift('#' + node.id); break; }
      var name = node.tagName.toLowerCase();
      var cls = '';
      if (typeof node.className === 'string') {
        var list = node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3);
        if (list.length) cls = '.' + list.join('.');
      }
      var nth = '';
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (same.length > 1) nth = ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(name + cls + nth);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' ');
  }

  function rect(el) {
    var r = el.getBoundingClientRect();
    var rnd = function (n) { return Math.round(n * 10) / 10; };
    return { x: rnd(r.left), y: rnd(r.top), w: rnd(r.width), h: rnd(r.height), right: rnd(r.right), bottom: rnd(r.bottom) };
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'BR' || el.tagName === 'HEAD' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
    var cs = style(el);
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function text(el) {
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 44 ? t.slice(0, 44) + '…' : t;
  }

  function cap(list, total) {
    return { count: total, truncated: total > list.length, items: list.slice(0, MAX_ITEMS) };
  }

  // Nearest ancestor that actually scrolls horizontally and has hidden content.
  function horizScroller(el) {
    var n = el && el.parentElement;
    var guard = 0;
    while (n && n !== document.body && guard++ < 20) {
      var cs = style(n);
      if (cs && (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return n;
      n = n.parentElement;
    }
    return null;
  }

  function overflowSeverity(ox, over) {
    if (ox === 'auto' || ox === 'scroll') return 'scrollable';   // reachable by scrolling
    if (ox === 'hidden' || ox === 'clip') return 'clipped';      // content lost
    return over > 8 ? 'overflowing' : 'cosmetic';                // paints over a neighbour
  }
  var SEV_RANK = { clipped: 3, overflowing: 2, cosmetic: 1, scrollable: 0 };

  function sortBySeverity(list) {
    return list.sort(function (a, b) {
      var d = (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
      return d !== 0 ? d : (b.over || 0) - (a.over || 0);
    });
  }

  /* ----------------------------------------------------------- the report */

  function measure() {
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var overlay = q('#chatvault_overlay');
    var panel = q('#chatvault_panel');
    var panelRect = panel ? rect(panel) : null;
    var scoped = overlay ? qa('#chatvault_overlay *') : [];

    var report = {
      scene: (window.__cvh && window.__cvh.scene && window.__cvh.scene.name) || null,
      sceneError: (window.__cvh && window.__cvh.scene && window.__cvh.scene.error) || null,
      sceneSteps: (window.__cvh && window.__cvh.scene && window.__cvh.scene.steps) || [],
      sceneProbe: (window.__cvh && window.__cvh.scene && window.__cvh.scene.probe) || null,
      sceneMs: (window.__cvh && window.__cvh.scene && window.__cvh.scene.ms) || 0,
      ts: new Date().toISOString(),
      viewport: {
        w: vw, h: vh, dpr: window.devicePixelRatio,
        visualViewport: window.visualViewport ? {
          w: Math.round(window.visualViewport.width),
          h: Math.round(window.visualViewport.height),
          top: Math.round(window.visualViewport.offsetTop),
        } : null,
        mobileQuery: window.matchMedia('(max-width: 720px)').matches,
        landscapeQuery: window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches,
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        hoverNone: window.matchMedia('(hover: none)').matches,
        safeAreaBottom: (function () {
          // env() is not readable from JS; render a probe that consumes it.
          var p = document.getElementById('__cvh_safe_probe');
          if (!p) {
            p = document.createElement('div');
            p.id = '__cvh_safe_probe';
            p.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:1px;height:1px;' +
              'border-bottom:1px solid;border-bottom-width:env(safe-area-inset-bottom,0px);');
            document.body.appendChild(p);
          }
          return style(p).borderBottomWidth || null;
        })(),
      },
      page: {
        scrollWidth: document.scrollingElement ? document.scrollingElement.scrollWidth : 0,
        clientWidth: document.scrollingElement ? document.scrollingElement.clientWidth : 0,
        scrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : 0,
        bodyOverflow: document.body ? style(document.body).overflow : null,
        bodyClass: document.body ? document.body.className : '',
      },
      panel: panel ? {
        rect: panelRect,
        classes: panel.className,
        widthStyle: panel.style.width || null,
        heightStyle: panel.style.height || null,
        clientW: panel.clientWidth,
        clientH: panel.clientHeight,
        scrollW: panel.scrollWidth,
        scrollH: panel.scrollHeight,
        layout: panel.className.indexOf('cv-layout-narrow') >= 0 ? 'narrow'
          : (panel.className.indexOf('cv-layout-wide') >= 0 ? 'wide' : 'none'),
        readerMode: panel.className.indexOf('cv-in-reader') >= 0,
      } : null,
      counts: {
        cards: qa('.cv-card').length,
        groups: qa('.cv-group').length,
        tabs: qa('.cv-tab').length,
        readerMsgs: qa('.cv-reader-msg').length,
        modals: qa('#cv_modal').length,
        overlayButtons: qa('#chatvault_overlay button').length,
        previewTips: qa('#cv_preview_tip').length,
        msgMenus: qa('#cv_msg_menu').length,
        rulesBoxes: qa('#cv_rules_holder .cv-strip-box').length,
        organizerRows: qa('.cv-organizer-row').length,
      },
      reader: q('.cv-reader-stage') ? (function () {
        var st = q('.cv-reader-stage');
        var pager = q('.cv-reader-pager');
        var headMeta = q('.cv-reader-headinfo-meta');
        var settings = q('#cv_reader_settings');
        return {
          stageScrollH: st.scrollHeight,
          stageClientH: st.clientHeight,
          pagerMode: st.dataset.pagerMode || null,
          pagerPresent: !!pager,
          pagerRect: pager ? rect(pager) : null,
          pagerSuppressed: !!q('.cv-reader-pager-wrap.cv-pager-suppressed'),
          pageInput: (q('.cv-pager-page input') || {}).value || null,
          headInfoMetaText: headMeta ? text(headMeta) : null,
          headInfoMetaVisible: headMeta ? visible(headMeta) : false,
          fabBack: q('#cv_reader_back') ? rect(q('#cv_reader_back')) : null,
          fabGear: q('#cv_reader_gear') ? rect(q('#cv_reader_gear')) : null,
          settingsOpen: !!(settings && !settings.hidden),
          settingsRect: (settings && !settings.hidden) ? rect(settings) : null,
          bodyFontSize: q('.cv-reader-msg-body') ? style(q('.cv-reader-msg-body')).fontSize : null,
          msgWidths: qa('.cv-reader-msg').slice(0, 4).map(function (m) { return Math.round(m.getBoundingClientRect().width); }),
        };
      })() : null,
      checks: {},
      // Chat-floor organizer: how much of the scrollable row list is actually
      // on screen (a flex layout can silently collapse it to 0 on short viewports).
      organizer: q('#cv_org_body') ? (function () {
        var body = q('#cv_org_body');
        var list = q('.cv-organizer-list');
        var rows = qa('.cv-organizer-row');
        var maxY = window.innerHeight;
        var listRect = list ? rect(list) : null;
        var bodyRect = body ? rect(body) : null;
        // how much of the list is inside its scrolling body's visible box
        var listVisibleInBody = (listRect && bodyRect)
          ? Math.max(0, Math.min(listRect.bottom, bodyRect.bottom) - Math.max(listRect.y, bodyRect.y)) : null;
        return {
          bodyRect: bodyRect,
          controls: (function () {
            var ids = ['cv_org_start','cv_org_end','cv_org_apply','cv_org_clear','cv_org_up','cv_org_down','cv_org_move_floor','cv_org_delete','cv_org_reset','cv_org_write','cv_org_backup','cv_org_close','cv_org_first','cv_org_prev','cv_org_next','cv_org_last','cv_org_skip_backup','cv_org_x'];
            var out = {};
            ids.forEach(function (id) {
              var e = document.getElementById(id);
              if (!e) { out[id] = 'absent'; return; }
              var rr = e.getBoundingClientRect();
              var cs2 = style(e);
              out[id] = {'rx': Math.round(rr.left), 'ry': Math.round(rr.top), 'w': Math.round(rr.width), 'h': Math.round(rr.height),
                        'display': cs2.display, 'visibility': cs2.visibility,
                        'inViewport': rr.width > 0 && rr.height > 0 && rr.top >= 0 && rr.bottom <= maxY && rr.left >= 0 && rr.right <= window.innerWidth};
            });
            return out;
          })(),
          listRect: listRect,
          listVisibleInBody: listVisibleInBody === null ? null : Math.round(listVisibleInBody),
          bodyClientH: body.clientHeight,
          bodyScrollH: body.scrollHeight,
          listClientH: list ? list.clientHeight : null,
          listScrollH: list ? list.scrollHeight : null,
          listOverflowY: list ? style(list).overflowY : null,
          rowCount: rows.length,
          rowsFullyOnScreen: rows.filter(function (r) {
            var b = r.getBoundingClientRect();
            return b.height > 4 && b.top >= 0 && b.bottom <= maxY;
          }).length,
          rowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : null,
          pagerInfo: (q('.cv-organizer-pager-info') || {}).textContent || null,
        };
      })() : null,
      // Floating overlays that the v0.6.0 pass repositioned: recorded with the
      // gap to the panel bottom so "flush at the bottom" is verifiable, not
      // something to eyeball.
      floating: (function () {
        function probe(el) {
          if (!el || !visible(el)) return null;
          var cs = style(el);
          var r = rect(el);
          return {
            rect: r,
            position: cs.position,
            gapToPanelBottom: panelRect ? Math.round((panelRect.bottom - r.bottom) * 10) / 10 : null,
            insetLeft: Math.round((r.x - (panelRect ? panelRect.x : 0)) * 10) / 10,
            insetRight: panelRect ? Math.round((panelRect.right - r.right) * 10) / 10 : null,
            maxHeight: cs.maxHeight,
            zIndex: cs.zIndex,
          };
        }
        return {
          previewTip: probe(q('#cv_preview_tip')),
          msgMenu: probe(q('#cv_msg_menu')),
          readerSettings: probe(q('#cv_reader_settings') && !q('#cv_reader_settings').hidden ? q('#cv_reader_settings') : null),
          modal: probe(q('#cv_modal .cv-modal')),
          pager: probe(q('.cv-reader-pager')),
          listPagination: probe(q('.cv-pagination')),
          pagerWrap: probe(q('.cv-reader-pager-wrap')),
        };
      })(),
    };

    /* (a) horizontal overflow --------------------------------------------- */
    var contentOverflow = [];
    var outsidePanel = [];
    var outsideViewport = [];
    var insideScrollables = 0;

    scoped.forEach(function (el) {
      if (!visible(el)) return;
      var cs = style(el);
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        var over = el.scrollWidth - el.clientWidth;
        contentOverflow.push({
          sel: sel(el),
          clientW: el.clientWidth,
          scrollW: el.scrollWidth,
          over: over,
          overflowX: cs.overflowX,
          whiteSpace: cs.whiteSpace,
          severity: overflowSeverity(cs.overflowX, over),
          text: text(el),
        });
      }
      var r = el.getBoundingClientRect();
      var inScroller = !!horizScroller(el);
      if (inScroller) { insideScrollables++; return; }   // reachable by scrolling: not a defect
      if (panelRect) {
        var dx = Math.max(panelRect.x - r.left, r.right - panelRect.right);
        if (dx > 0.6) outsidePanel.push({ sel: sel(el), over: Math.round(dx * 10) / 10, rect: rect(el), text: text(el) });
      }
      var dv = Math.max(-r.left, r.right - vw);
      if (dv > 0.6) outsideViewport.push({ sel: sel(el), over: Math.round(dv * 10) / 10, rect: rect(el), text: text(el) });
    });
    sortBySeverity(contentOverflow);
    report.checks.contentOverflow = cap(contentOverflow, contentOverflow.length);
    report.checks.contentOverflow.clipped = contentOverflow.filter(function (i) { return i.severity === 'clipped'; }).length;
    report.checks.contentOverflow.overflowing = contentOverflow.filter(function (i) { return i.severity === 'overflowing'; }).length;
    report.checks.contentOverflow.scrollableOnly = contentOverflow.filter(function (i) { return i.severity === 'scrollable'; }).length;
    report.checks.outsidePanel = cap(outsidePanel, outsidePanel.length);
    report.checks.outsideViewport = cap(outsideViewport, outsideViewport.length);

    /* (b) page-level horizontal overflow ---------------------------------- */
    var se = document.scrollingElement || document.documentElement;
    report.checks.pageHorizontalOverflow = {
      overflow: se.scrollWidth - se.clientWidth,
      scrollWidth: se.scrollWidth,
      innerWidth: vw,
    };

    /* (c) tap targets ------------------------------------------------------ */
    var TAP = 'button, a, input[type="checkbox"], input[type="radio"], select, [role="button"]';
    var small40 = [];
    var small44 = [];
    var targets = qa(TAP, overlay || document).filter(visible);
    targets.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var item = {
        sel: sel(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        text: text(el), disabled: !!el.disabled,
      };
      if (r.width < TAP_MIN || r.height < TAP_MIN) small40.push(item);
      if (r.width < TAP_IOS || r.height < TAP_IOS) small44.push(item);
    });
    report.checks.tapTargets = {
      minPx: TAP_MIN,
      count: small40.length,
      totalTargets: targets.length,
      iosMinPx: TAP_IOS,
      countBelow44: small44.length,
      truncated: small40.length > MAX_ITEMS,
      items: small40.slice(0, MAX_ITEMS),
    };

    /* (d) rendered text clipped away to zero size -------------------------- */
    // Deliberately ignores display:none subtrees (collapsed card folds, hidden
    // sheets): those are invisible by design, not clipped. The text itself is
    // measured with a Range so a zero-height wrapper that still paints its text
    // (e.g. display:contents / inline-flex children) is not reported.
    var zeroClipped = [];
    scoped.forEach(function (el) {
      if (svgInside(el)) return;
      var t = (el.textContent || '').trim();
      if (!t) return;
      var cs = style(el);
      if (!cs) return;
      if (cs.display === 'contents') return;
      var rendered = el.offsetParent !== null || cs.position === 'fixed';
      if (!rendered) return;
      var clipped = cs.textOverflow === 'ellipsis' || cs.textOverflow === 'clip'
        || (cs.overflowX === 'hidden' && cs.whiteSpace === 'nowrap');
      if (!clipped) return;
      var r = el.getBoundingClientRect();
      if (r.width !== 0 && r.height !== 0) return;
      var tr = null;
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        tr = range.getBoundingClientRect();
      } catch (e) { /* fall through to element box */ }
      if (tr && tr.width > 0 && tr.height > 0) return;   // text still paints
      zeroClipped.push({
        sel: sel(el), rect: rect(el), whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow, text: text(el),
        textRect: tr ? { w: Math.round(tr.width), h: Math.round(tr.height) } : null,
      });
    });
    report.checks.zeroSizeClipped = cap(zeroClipped, zeroClipped.length);

    /* (e) input font sizes (iOS zooms in below 16px) ---------------------- */
    var TEXTUAL = { text: 1, search: 1, number: 1, tel: 1, url: 1, email: 1, password: 1,
      date: 1, 'datetime-local': 1, month: 1, time: 1, week: 1 };
    var smallFonts = [];
    qa('input, textarea, select', overlay || document).filter(visible).forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'input' && !TEXTUAL[(el.type || 'text').toLowerCase()]) return;  // sliders/checkboxes never zoom
      var cs = style(el);
      var fs = parseFloat(cs.fontSize);
      if (fs && fs < 16) {
        smallFonts.push({
          sel: sel(el), fontSize: cs.fontSize, type: el.type || tag,
          value: (el.value || '').slice(0, 24), placeholder: (el.placeholder || '').slice(0, 24),
        });
      }
    });
    report.checks.smallInputFonts = {
      count: smallFonts.length,
      iosZoomRisk: smallFonts.length > 0,
      items: smallFonts.slice(0, MAX_ITEMS),
    };

    /* (f) bottom safe-area (34px) conflicts ------------------------------- */
    var inSafeArea = [];
    var safeCandidates = qa('button, a, input, select, [role="button"], ' +
      '.cv-pagination, .cv-reader-pager, .cv-reader-pager-wrap, .cv-modal-actions, ' +
      '.cv-reader-settings, .cv-reader-fab, .cv-msg-menu, .cv-preview-tip', overlay || document);
    safeCandidates.forEach(function (el) {
      if (!visible(el)) return;
      var r = el.getBoundingClientRect();
      var overlap = Math.min(r.bottom, vh) - Math.max(r.top, vh - SAFE);
      if (overlap <= 0) return;
      if (r.top > vh - 12) return;            // only a sliver peeking in: scroll noise
      inSafeArea.push({
        sel: sel(el),
        bottom: Math.round(r.bottom * 10) / 10,
        overlapPx: Math.round(overlap * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        position: style(el).position,
      });
    });
    inSafeArea.sort(function (a, b) { return b.overlapPx - a.overlapPx; });
    report.checks.bottomSafeArea = {
      safePx: SAFE, count: inSafeArea.length,
      items: inSafeArea.slice(0, MAX_ITEMS), truncated: inSafeArea.length > MAX_ITEMS,
    };

    /* (g) fixed / absolute pieces outside the viewport -------------------- */
    var offscreenFixed = [];
    scoped.forEach(function (el) {
      if (svgInside(el)) return;
      var cs = style(el);
      if (!cs || (cs.position !== 'fixed' && cs.position !== 'absolute' && cs.position !== 'sticky')) return;
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      var over = Math.max(-r.top, -r.left, r.bottom - vh, r.right - vw);
      if (over <= 1) return;
      // Absolute content parked below the fold of a scroll container is normal.
      if (cs.position === 'absolute' && horizScroller(el) === null) {
        var scrollerY = el.closest('.cv-reader-stage, .cv-body, .cv-reader-settings, .cv-modal-body');
        if (scrollerY) return;
      }
      offscreenFixed.push({
        sel: sel(el), position: cs.position, over: Math.round(over * 10) / 10, rect: rect(el),
      });
    });
    report.checks.offscreenPositioned = cap(offscreenFixed, offscreenFixed.length);

    /* console / errors ---------------------------------------------------- */
    var log = (window.__cvh && window.__cvh.consoleLog) || [];
    var isNoise = (window.__cvh && window.__cvh.isExpectedNoise) || function () { return false; };
    var errors = log.filter(function (l) { return l.type === 'error'; });
    var warns = log.filter(function (l) { return l.type === 'warn'; });
    report.console = {
      errors: errors.filter(function (l) { return !isNoise(l.text); }).map(function (l) { return l.text; }).slice(0, 20),
      errorCount: errors.filter(function (l) { return !isNoise(l.text); }).length,
      expectedNoise: errors.filter(function (l) { return isNoise(l.text); }).map(function (l) { return l.text; }).slice(0, 10),
      warnings: warns.filter(function (l) { return !isNoise(l.text); }).map(function (l) { return l.text; }).slice(0, 20),
      expectedWarnings: warns.filter(function (l) { return isNoise(l.text); }).map(function (l) { return l.text; }).slice(0, 10),
      toasts: log.filter(function (l) { return l.type.indexOf('toastr') === 0; }).map(function (l) { return l.type + ': ' + l.text; }).slice(0, 10),
      pageErrors: ((window.__cvh && window.__cvh.pageErrors) || []).slice(0, 20),
    };
    report.fetches = (window.__cvh && window.__cvh.fetchCount) || {};

    return report;
  }

  window.__measure = measure;

  window.__measureInto = function () {
    var r = measure();
    window.__report = r;
    try {
      var pre = document.getElementById('report');
      if (!pre) {
        pre = document.createElement('pre');
        pre.id = 'report';
        pre.setAttribute('style', 'position:fixed;left:-99999px;top:0;margin:0;padding:0;');
        (document.body || document.documentElement).appendChild(pre);
      }
      pre.textContent = JSON.stringify(r, null, 1);
      var holder = document.getElementById('report-json');
      if (!holder) {
        holder = document.createElement('script');
        holder.type = 'application/json';
        holder.id = 'report-json';
        (document.body || document.documentElement).appendChild(holder);
      }
      holder.textContent = JSON.stringify(r);
    } catch (e) {
      if (window.__cvh) window.__cvh.pageErrors.push({ kind: 'measure', message: String(e) });
    }
    return r;
  };
})();
