# ChatVault mobile verification harness (`_devharness/`)

Renders the **real** `index.js` + `style.css` inside a mocked SillyTavern page,
drives the real UI, screenshots it at exact phone viewports and measures mobile
layout defects. The plugin source is never modified — it is copied into `dist/`
at the start of every run.

```
_devharness/
  harness.html      mocked SillyTavern shell + script wiring (the page under test)
  fixtures.js       deterministic fake backend data (3 chars, 8 chats, one 130-message chat)
  mocks.js          SillyTavern / toastr / jQuery / DOMPurify globals, fetch router, storage
  scenes.js         scene driver: ?scene=NAME, clicks real DOM nodes, exposes __ready
  measure.js        layout measurements → window.__report + <pre id="report">
  cdp-run.js        one headless Chrome, exact viewports via CDP, PNG + JSON
  run.ps1           entry point: build (copy sources) + run + summary
  dist/             freshly copied index.js / style.css (generated)
  out/<run>/        results (generated)
```

## Quick start

```powershell
cd chatvault-mobile\_devharness

# everything: all 17 scenes @ 390x844 + core scenes @ 5 more viewports
pwsh -File run.ps1 -OutDir out\baseline

# one scene, one viewport (fast loop while editing the plugin)
pwsh -File run.ps1 -Scene reader-settings -Viewports 390x844 -OutDir out\one

# several scenes / several viewports
pwsh -File run.ps1 -Scene panel-recent,reader -Viewports 390x844,320x568 -OutDir out\pair

# no Node / no CDP at all (see the caveat below)
pwsh -File run.ps1 -Scene panel-recent -Mode cli -OutDir out\cli

# test a different copy of the plugin, e.g. the pristine released tree,
# to get a true before/after:
git -C .. show HEAD:index.js > out\_src\index.js
git -C .. show HEAD:style.css > out\_src\style.css
pwsh -File run.ps1 -Scene panel-recent,reader -Viewports 1440x900,390x844 `
     -SourceDir out\_src -OutDir out\before
```

`run.ps1` always re-copies `..\index.js` and `..\style.css` into `dist\` before
running (skip with `-SkipBuild`), so a run never tests stale bytes. It records
the SHA-256 of both files plus the git `HEAD`/diffstat into
`out\<run>\source.json` — needed because several agents edit the plugin
concurrently.

## Scenes

`?scene=NAME` selects a driver in `scenes.js`. Every scene clicks elements the
plugin itself rendered (`.cv-tab[data-tab=…]`, `.cv-fold-btn[data-act=reader]`,
`#cv_reader_gear`, `.cv-act[data-act=edit]`, `.cv-pager-btn[data-go=last]`, …)
and waits for the fetch-driven render to land.

| scene | state reached |
|---|---|
| `panel-recent` | panel open, 最近 tab, 8 cards, previews loaded |
| `panel-characters` | 角色 tab (collapsed groups) |
| `panel-characters-expanded` | 角色 tab, first group opened |
| `panel-favorites` | 收藏 tab (3 starred fixtures) |
| `panel-current` | 当前角色 tab (header + import/new buttons) |
| `search-filter` | search box filled with `长夜`, list filtered to 1 card |
| `list-with-fold-open` | one card's fold area open (阅读模式/摘取规则/导出 visible) |
| `reader` | reader mode on the 130-message chat, page 1/5 |
| `reader-settings` | reader + gear → settings sheet open |
| `reader-lastpage` | reader pager → last page (5/5) |
| `msg-menu` | reader floor-number button → floor menu |
| `edit-modal` | card `编辑` → edit modal |
| `export-modal` | card `导出` → export modal |
| `rules-modal` | card `摘取规则` → rules editor (first group expanded) |
| `organizer-modal` | edit modal → `整理楼层` (rows loaded) |
| `preview-tip` | long-press/right-click equivalent (`contextmenu`) on a card preview → tooltip |
| `reader-settings-dragclose` | reader settings sheet open, then a synthetic 80px touch drag on its top band → sheet must close |
| `edit-modal-dragclose` | edit modal open, then the same 80px touch drag on `.cv-modal` → modal must close |

Each run sets `document.title='READY'`, `<body data-scene-ready="1">` and
`window.__cvh.scene = {name, ready, error, steps, probe, ms}`. A scene that
cannot be driven **still produces a screenshot** and records `sceneError`, so a
broken UI shows up as a picture, not a missing file.

## What the harness mocks

| real SillyTavern | here |
|---|---|
| `SillyTavern.getContext()` | `mocks.js` → 3 characters, `characterId: 0`, `chatId: '长夜漫谈.jsonl'` |
| `toastr.*` | no-ops that append to the report's toast list |
| `jQuery(fn)` | runs `fn` on DOMContentLoaded (the plugin only uses `$(fn)`) |
| `window.DOMPurify` | **stub sanitizer** honouring the plugin's `ALLOWED_TAGS` / `ALLOWED_ATTR` / `ALLOWED_URI_REGEXP` / `FORBID_*` options. Render-fidelity only, not a security-equivalent sanitizer |
| `POST /api/characters/all` | fixtures roster |
| `POST /api/characters/chats` | fixture chat index rows (`file_name/mes/file_size/last_mes/chat_items`) |
| `POST /api/chats/get` | `[metadata, ...messages]` fixture bodies |
| `POST /api/chats/{rename,delete,save,import}` | `{ok:true}` |
| `localStorage['st-chatvault-meta']` | seeds custom titles / tags / starred / bookmarks |
| `/thumbnail?…` | intentionally 404 (no image files); `<img onerror>` handles it, layout is unaffected |

Fixtures cover what mobile rendering breaks on: long Chinese paragraphs, a
7-column markdown table with an unbreakable long word, a fenced code block with
over-long lines, lists, blockquote, inline `<p style>` + `800×240` `<img>`,
`<thinking>` (stripped), `<本轮用户输入>` (user-rule extraction), an empty message,
and a 130-message chat (reader = 5 pages).

The `st-chatvault-settings` key is deliberately **not** seeded: the plugin's
defaults (dark theme, auto-hide pager, 15px reader font, rich rendering on) are
what gets verified.

## Viewports

`-Viewports 390x844,360x800,320x568,844x390,768x1024,1440x900` (default).
Each spec becomes: dpr 2 for phone/tablet, 1 for the desktop control; `mobile`
+ touch emulation; orientation; and notch-style safe-area insets
(portrait phone 47/34, landscape phone L/R 47 + bottom 21, tablet 47/34,
desktop 0). `measure.js` proves the insets reached CSS by reading a probe
element that consumes `env(safe-area-inset-bottom)`.

### Why `-Mode cdp` and not the Chrome CLI

Chrome's headless CLI **clamps `--window-size` to a minimum width of 500 CSS
px**: `--headless=new --window-size=390,844` actually renders a 500×746 layout
viewport (verified on Chrome 157). A "mobile" screenshot taken that way is not
390 wide and every width-dependent defect is missed. `cdp-run.js` therefore
drives one headless Chrome over the DevTools Protocol and sets
`Emulation.setDeviceMetricsOverride` (+ touch emulation, + safe-area insets) per
job; it also gets PNG *and* JSON out of a single page load.

`-Mode cli` remains as a no-Node fallback (uses
`--screenshot=` / `--dump-dom` + `--virtual-time-budget`), but its viewports are
clamped — use it only to sanity-check that the page loads.

## Output

```
out/<run>/
  source.json                sha256 + mtime of the plugin bytes that were tested, git HEAD/worktree
  run-meta.json              job counts, warnCount, elapsed, viewport roll-up
  failures.json              jobs that could not be driven at all
  warnings.json              jobs that rendered but reported a sceneError / console error
  png/<scene>__<vp>.png      e.g. reader__390x844.png  (2x pixels: 780x1688)
  measure/<scene>__<vp>.json full report for one job
  measure-<vp>.json          all scenes for one viewport (what you probably want)
```

### Report fields (`measure-<vp>.json → scenes.<scene>`)

* `scene`, `sceneError`, `sceneSteps`, `sceneProbe` (feature probes, e.g. the drag-close result), `sceneMs`
* `organizer` — `bodyClientH/bodyScrollH`, `listClientH/listScrollH`, `rowCount`,
  `rowsFullyOnScreen`, `rowHeight` (detects a flex-collapsed floor list)
* `viewport` — width/height/dpr, `mobileQuery`, `landscapeQuery`, `coarsePointer`, `safeAreaBottom`
* `page` — `scrollWidth/clientWidth` of the scrolling element, body overflow/classes
* `panel` — rect, classes, layout (`narrow|wide|none`), `readerMode`
* `counts` — cards/groups/readerMsgs/modals/menus/rows
* `reader` — stage scroll metrics, pager presence/rect/page, settings rect, fab rects,
  head-info visibility, body font-size, message widths
* `floating` — rect + `gapToPanelBottom` + `insetLeft/Right` for preview-tip, msg-menu,
  reader-settings sheet, modal, pager (verifies "flush at the bottom", not eyeballed).
  Read `gapToPanelBottom` together with `viewport.safeAreaBottom`: the v0.6.0 CSS parks
  bottom sheets at `bottom: calc(8px + env(safe-area-inset-bottom))`, so 42 on a phone
  with a 34px inset **is** flush; 8 on a desktop with 0 inset is the same rule.
* `checks`
  * `contentOverflow` — `scrollWidth > clientWidth+1`, each item tagged
    `clipped` (text lost) / `overflowing` (paints over a neighbour) /
    `cosmetic` (≤8px) / `scrollable` (inside a horizontal scroller → reachable,
    e.g. code blocks); counters `clipped`, `overflowing`, `scrollableOnly`
  * `outsidePanel`, `outsideViewport` — boxes sticking out (scroll-container content excluded)
  * `pageHorizontalOverflow` — `scrollingElement.scrollWidth - clientWidth`
  * `tapTargets` — interactive elements below 40×40 (`count`), plus `countBelow44`
  * `zeroSizeClipped` — rendered, non-empty, text-overflow-clipped elements with 0 size
  * `smallInputFonts` — text-like inputs/textarea/select under 16px (iOS auto-zoom)
  * `bottomSafeArea` — controls overlapping the bottom 34px band
  * `offscreenPositioned` — fixed/sticky (or non-scroller absolute) pieces outside the viewport
* `console` — `errors`/`errorCount` (real errors only), `expectedNoise`, `warnings`,
  `expectedWarnings`, `toasts`, `pageErrors`
* `cdpLog` — CDP `Log.entryAdded` entries (network/security), thumbnails included
* `fetches` — per-endpoint call counts

Expected noise, filtered out of `errorCount`: `/thumbnail?` file-not-found (the
mock has no avatar images) and the plugin's `import('../../../../script.js')`
probe, which cannot resolve outside a real SillyTavern install.

## Reading the results

```powershell
# PowerShell 5.1 reads UTF-8-without-BOM as ANSI — read explicitly, or use node/jq
$r = [System.IO.File]::ReadAllText("out\baseline\measure-390x844.json", [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$r.scenes.'panel-recent'.checks.tapTargets.count
```

A quick failure sweep over a whole run:

```powershell
Get-ChildItem out\baseline\measure\*.json | ForEach-Object {
  $r = [System.IO.File]::ReadAllText($_.FullName, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
  if ($r.sceneError -or $r.console.errorCount -gt 0 -or
      $r.checks.contentOverflow.clipped -gt 0 -or $r.checks.outsideViewport.count -gt 0 -or
      $r.checks.pageHorizontalOverflow.overflow -gt 0 -or $r.checks.tapTargets.count -gt 0 -or
      $r.checks.smallInputFonts.count -gt 0) {
    "{0,-46} err={1} clip={2} out={3} page={4} tap<40={5} font<16={6}" -f `
      $r.scene, $r.viewport.w, $r.sceneError, $r.checks.contentOverflow.clipped, `
      $r.checks.outsideViewport.count, $r.checks.pageHorizontalOverflow.overflow, `
      $r.checks.tapTargets.count, $r.checks.smallInputFonts.count
  }
}
```

## Requirements

* Chrome (`--chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"`)
* Node 20+ (built-in `WebSocket` used by `cdp-run.js`; Node 24 verified)
* PowerShell 5.1 or 7+
* No network, no npm install

## Troubleshooting

* **Every scene reports `sceneError` and a blank/grey screenshot** → read the
  message; the plugin threw before/while opening. `sceneSteps` shows how far it got.
  Check `out/<run>/source.json` to see which plugin bytes were tested.
* **`-SkipBuild` and no `out/` yet** → fixed: the output dir is created before
  the build step.
* **Chrome profile lock / repeated failures** → each run gets a fresh
  `%TEMP%\cvh-chrome-*` profile, deleted afterwards.
* **`run-meta.json` shows `failed > 0`** → those jobs produced no screenshot;
  `failures.json` has the reason (usually a scene wait timeout).

## Known limitations

* `window.DOMPurify` is a stub: rich-reader output is layout-accurate but this
  harness does **not** verify sanitizer security.
* The software keyboard is not simulated; `visualViewport` shrinking is only
  exercised by the plugin's own resize handling, not by a real keyboard.
* Scrolling and long-press are simulated with DOM/pointer events, not real
  touch gestures — the swipe/drag handlers are exercised via synthetic
  `PointerEvent`s (which is what made the `reader-settings-dragclose` check possible).
* Only the plugin's own DOM is measured; the mocked SillyTavern backdrop is excluded.
* `checks.bottomSafeArea` tests a fixed 34px band, while a landscape phone gets a
  smaller inset (21px here); treat landscape hits within ~13px of the edge as
  expected rather than as defects.
* In Windows PowerShell 5.1, `[System.IO.File]::ReadAllText("relative\path")`
  resolves against the *process* working directory, not `cd` — pass absolute paths
  (or `(Resolve-Path ...).Path`) when poking at the JSON by hand.
