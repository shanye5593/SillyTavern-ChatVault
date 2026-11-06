#!/usr/bin/env node
/* ============================================================================
 * cdp-run.js — one Chrome, many exact mobile viewports, via the DevTools Protocol.
 *
 * Why not `chrome --headless --screenshot --window-size=390,844`?
 *   Chrome's headless window refuses to go narrower than 500 CSS px, so a CLI
 *   run "at 390x844" actually renders at 500x746 (verified on Chrome 157).
 *   Emulation.setDeviceMetricsOverride is the only way to get a true 390x844
 *   layout viewport with mobile metrics.
 *
 * Usage (normally invoked by run.ps1):
 *   node cdp-run.js --root <dir with harness.html> --out <outDir> --matrix <jobs.json>
 *                   [--chrome <chrome.exe>] [--ready-timeout 15000] [--verbose]
 *
 * matrix json: { "jobs": [ { "scene": "panel-recent",
 *                            "vp": {"name":"390x844","w":390,"h":844,"dpr":2,
 *                                   "mobile":true,"touch":true,
 *                                   "orientation":"portrait"} } ] }
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/* ------------------------------------------------------------------ args */
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const name = k.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { a[name] = next; i++; }
      else a[name] = true;
    } else a._.push(k);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || '.');
const OUT = path.resolve(args.out || path.join(ROOT, 'out', 'run'));
const CHROME = args.chrome || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const READY_TIMEOUT = Number(args['ready-timeout'] || 15000);
const VERBOSE = !!args.verbose;
const MATRIX_RAW = fs.readFileSync(path.resolve(args.matrix), 'utf8').replace(/^\uFEFF/, '');
const MATRIX = JSON.parse(MATRIX_RAW);
const JOBS = MATRIX.jobs || [];
const SETTLE_MS = Number(MATRIX.settleMs || 0);

function log(...xs) { if (VERBOSE) console.log('[cdp]', ...xs); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ------------------------------------------------------------- directories */
const PNG_DIR = path.join(OUT, 'png');
const MEAS_DIR = path.join(OUT, 'measure');
fs.mkdirSync(PNG_DIR, { recursive: true });
fs.mkdirSync(MEAS_DIR, { recursive: true });

/* --------------------------------------------------------------- minimal CDP */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();       // method -> [fn]
    this.closed = false;
    ws.addEventListener('message', ev => this._onMessage(ev.data));
    ws.addEventListener('close', () => { this.closed = true; });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('ws connect timeout')), 10000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); });
      ws.addEventListener('error', e => { clearTimeout(t); rej(new Error('ws error: ' + (e.message || e.type))); });
    });
    return new Cdp(ws);
  }
  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (entry.timer) clearTimeout(entry.timer);   // else the timer keeps node alive for 30s
      if (msg.error) entry.reject(new Error(msg.error.message + ' (' + msg.error.code + ')'));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method) {
      const hs = this.handlers.get(msg.method);
      if (hs) hs.forEach(fn => { try { fn(msg.params, msg.sessionId); } catch { /* ignore */ } });
    }
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 30000);
      if (entry.timer.unref) entry.timer.unref();
      this.pending.set(id, entry);
      try { this.ws.send(JSON.stringify(payload)); }
      catch (e) { clearTimeout(entry.timer); this.pending.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ---------------------------------------------------------------- launch */
async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvh-chrome-'));
  const argv = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--mute-audio',
    '--no-pings',
    '--window-size=1200,1000',
    '--remote-debugging-port=0',
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ];
  log('launch', CHROME);
  const child = spawn(CHROME, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });
  child.on('error', e => { stderr += 'spawn error: ' + e.message; });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').split('\n');
      if (txt[0]) {
        const port = Number(txt[0].trim());
        if (port > 0) {
          log('devtools port', port);
          return { child, port, userDataDir };
        }
      }
    }
    if (child.exitCode !== null) throw new Error('chrome exited early: ' + (child.exitCode) + '\n' + stderr);
    await sleep(80);
  }
  throw new Error('chrome did not expose a DevTools port\n' + stderr);
}

/* ------------------------------------------------------------- page helpers */
async function evalInPage(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: 10000,
  }, sessionId);
  if (res.exceptionDetails) {
    throw new Error('page exception: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description || res.exceptionDetails.text));
  }
  return res.result ? res.result.value : undefined;
}

async function waitReady(cdp, sessionId, timeoutMs) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    let st;
    try {
      st = await evalInPage(cdp, sessionId,
        '(function(){var s=window.__cvh&&window.__cvh.scene;return s?{ready:!!s.ready,error:s.error||null,ms:s.ms||0}:null})()');
    } catch (e) {
      lastErr = e;                        // context destroyed during navigation
      await sleep(40);
      continue;
    }
    if (st && st.ready) return st;
    await sleep(40);
  }
  throw new Error('scene never became ready in ' + timeoutMs + 'ms' +
    (lastErr ? ' (last eval error: ' + lastErr.message + ')' : ''));
}

/* ------------------------------------------------------------------- main */
async function main() {
  const { child, port, userDataDir } = await launchChrome();
  let cdp = null;
  const failures = [];
  const results = [];
  const warns = [];   // played back fine but reported a scene error / console error
  const startedAt = Date.now();

  try {
    const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json();
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const cdpLogs = [];
    cdp.on('Log.entryAdded', p => {
      cdpLogs.push({ level: p.entry.level, text: (p.entry.text || '').slice(0, 300), url: p.entry.url || null });
    });

    const targets = await cdp.send('Target.getTargets');
    const page = (targets.targetInfos || []).find(t => t.type === 'page');
    if (!page) throw new Error('no page target');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    log('attached', sessionId);

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    try { await cdp.send('Log.enable', {}, sessionId); } catch { /* optional */ }

    const fileBase = 'file:///' + ROOT.replace(/\\/g, '/') + '/harness.html';

    for (let i = 0; i < JOBS.length; i++) {
      const job = JOBS[i];
      const scene = job.scene;
      const vp = job.vp;
      const tag = scene + '__' + vp.name;
      const t0 = Date.now();
      cdpLogs.length = 0;

      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: vp.w,
          height: vp.h,
          deviceScaleFactor: vp.dpr || 1,
          mobile: !!vp.mobile,
          screenOrientation: {
            type: vp.orientation === 'landscape' ? 'landscapePrimary' : 'portraitPrimary',
            angle: vp.orientation === 'landscape' ? 90 : 0,
          },
        }, sessionId);
        try {
          await cdp.send('Emulation.setTouchEmulationEnabled', {
            enabled: vp.touch !== false,
            maxTouchPoints: 5,
          }, sessionId);
        } catch { /* older builds */ }
        if (vp.safeArea) {
          // Notified/notch style insets so env(safe-area-inset-*) is non-zero,
          // which is what the CSS is written against.
          try {
            await cdp.send('Emulation.setSafeAreaInsetsOverride', {
              insets: {
                top: vp.safeArea.top || 0,
                bottom: vp.safeArea.bottom || 0,
                left: vp.safeArea.left || 0,
                right: vp.safeArea.right || 0,
              },
            }, sessionId);
          } catch (e) { log('safe-area override unsupported:', e.message); }
        }

        const url = fileBase + '?scene=' + encodeURIComponent(scene);
        await cdp.send('Page.navigate', { url }, sessionId);
        const st = await waitReady(cdp, sessionId, READY_TIMEOUT);
        if (SETTLE_MS) await sleep(SETTLE_MS);

        // --- screenshot first: measuring must not perturb pixels -------------
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        }, sessionId);
        const pngPath = path.join(PNG_DIR, tag + '.png');
        fs.writeFileSync(pngPath, Buffer.from(shot.data, 'base64'));

        // --- then the measurement (writes DOM copies for --dump-dom runs) ----
        const json = await evalInPage(cdp, sessionId,
          '(function(){var r=window.__measureInto();return JSON.stringify(r);})()');
        const report = JSON.parse(json);
        report.cdpLog = cdpLogs.slice(0, 30);
        report.png = path.relative(OUT, pngPath).replace(/\\/g, '/');
        report.harnessMs = st.ms;
        report.wallMs = Date.now() - t0;
        fs.writeFileSync(path.join(MEAS_DIR, tag + '.json'), JSON.stringify(report, null, 1));

        // accumulate into one fat file per viewport
        results.push({ scene, vp: vp.name, report });
        const ok = !st.error && (report.console.errorCount || 0) === 0;
        if (!ok) warns.push({ scene, vp: vp.name, sceneError: st.error || null, consoleErrors: report.console.errorCount || 0, firstError: (report.console.errors || [])[0] || null });
        console.log((ok ? '  ok   ' : '  WARN ') + tag.padEnd(42) +
          ' cards=' + String(report.counts.cards).padStart(2) +
          ' overflow=' + String(report.checks.contentOverflow.count).padStart(2) +
          ' pageOverflow=' + report.checks.pageHorizontalOverflow.overflow +
          ' taps<40=' + String(report.checks.tapTargets.count).padStart(2) +
          (st.error ? ' sceneError=' + st.error : ''));
      } catch (e) {
        const msg = String(e && e.message || e);
        failures.push({ scene, vp: vp.name, error: msg });
        console.log('  FAIL ' + tag + ' -> ' + msg);
      }
    }
  } finally {
    try { if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close(); } } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    await sleep(150);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  /* ---------------------------------------------- per-viewport roll-up files */
  const byVp = new Map();
  for (const r of results) {
    if (!byVp.has(r.vp)) byVp.set(r.vp, {});
    byVp.get(r.vp)[r.scene] = r.report;
  }
  const vpMeta = {};
  JOBS.forEach(j => { vpMeta[j.vp.name] = j.vp; });
  const summary = [];
  for (const [vpName, scenes] of byVp) {
    const file = path.join(OUT, 'measure-' + vpName + '.json');
    const payload = {
      viewport: vpMeta[vpName] || { name: vpName },
      generatedAt: new Date().toISOString(),
      sceneCount: Object.keys(scenes).length,
      scenes,
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 1));
    summary.push({ viewport: vpName, scenes: Object.keys(scenes).length, file: path.basename(file) });
  }
  fs.writeFileSync(path.join(OUT, 'warnings.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: warns.length, warnings: warns }, null, 1));
  fs.writeFileSync(path.join(OUT, 'failures.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: JOBS.length,
    failed: failures.length,
    failures,
  }, null, 1));

  const meta = {
    chrome: CHROME,
    root: ROOT,
    out: OUT,
    jobs: JOBS.length,
    ok: JOBS.length - failures.length,
    warnCount: warns.length,
    failed: failures.length,
    elapsedMs: Date.now() - startedAt,
    viewports: summary,
    pngs: fs.readdirSync(PNG_DIR).filter(f => f.endsWith('.png')).length,
  };
  fs.writeFileSync(path.join(OUT, 'run-meta.json'), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify(meta, null, 1));
  if (failures.length) process.exitCode = 2;
}

main().catch(e => {
  console.error('cdp-run failed:', e && e.stack || e);
  process.exit(1);
});
