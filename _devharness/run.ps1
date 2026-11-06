<#
.SYNOPSIS
  ChatVault mobile verification harness — renders the REAL plugin in a mocked
  SillyTavern page and captures screenshots + layout measurements per phone
  viewport.

.DESCRIPTION
  Always re-copies ..\index.js and ..\style.css into .\dist\ first, so a run
  always tests the current working-tree version of the plugin (the plugin source
  itself is never modified).

  Default mode ('cdp') drives one headless Chrome over the DevTools Protocol and
  uses Emulation.setDeviceMetricsOverride, because Chrome's headless CLI clamps
  --window-size to a minimum width of 500 CSS px (a "390x844" CLI run actually
  renders at 500x746 on Chrome 157). Use -Mode cli only as a no-Node fallback.

.EXAMPLE
  pwsh -File run.ps1 -OutDir out\baseline

.EXAMPLE
  pwsh -File run.ps1 -Scene reader,reader-settings -Viewports 390x844 -OutDir out\reader

.EXAMPLE
  pwsh -File run.ps1 -Scene panel-recent -Mode cli -OutDir out\cli
#>
[CmdletBinding()]
param(
    [string[]] $Scene = @('all'),
    [string]   $OutDir = 'out\baseline',
    [string[]] $Viewports = @('390x844', '360x800', '320x568', '844x390', '768x1024', '1440x900'),
    [ValidateSet('cdp', 'cli')]
    [string]   $Mode = 'cdp',
    [switch]   $AllScenesAtAllViewports,
    [switch]   $SkipBuild,
    [switch]   $SkipMeasure,
    [int]      $ReadyTimeout = 15000,
    [string]   $Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
    # Optional: test a different copy of the plugin (e.g. a git HEAD export) instead of ..\index.js
    [string]   $SourceDir = '',
    [string]   $Node = 'node'
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Path }
$pluginDir = Split-Path -Parent $here
$distDir = Join-Path $here 'dist'
$outPath = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $here $OutDir }

$ALL_SCENES = @(
    'panel-recent',
    'panel-characters',
    'panel-characters-expanded',
    'panel-favorites',
    'panel-current',
    'search-filter',
    'list-with-fold-open',
    'reader',
    'reader-settings',
    'reader-lastpage',
    'msg-menu',
    'edit-modal',
    'export-modal',
    'rules-modal',
    'organizer-modal',
    'preview-tip',
    'reader-settings-dragclose',
    'edit-modal-dragclose'
)
# viewports that get the full scene set; the rest only get the core scenes
$CORE_SCENES = @('panel-recent', 'reader', 'reader-settings', 'edit-modal', 'organizer-modal')

function Write-Head([string]$t) { Write-Host ''; Write-Host "== $t ==" -ForegroundColor Cyan }
function Write-Info([string]$t) { Write-Host "   $t" -ForegroundColor DarkGray }

# Windows PowerShell 5.1 reads UTF-8-without-BOM as ANSI, which turns the
# Chinese scene/viewport names into mojibake and breaks ConvertFrom-Json.
function Read-Json([string]$path) {
    [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
}
function Write-Json($obj, [string]$path, [int]$depth = 10) {
    $json = $obj | ConvertTo-Json -Depth $depth
    [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
}

# ---------------------------------------------------------------- viewport spec
function New-Viewport([string]$spec) {
    if ($spec -notmatch '^(\d+)x(\d+)$') { throw "bad viewport '$spec' (expected WxH)" }
    $w = [int]$Matches[1]; $h = [int]$Matches[2]
    $isLandscape = $w -gt $h
    # Mirrors the plugin/CSS breakpoint: <=720 wide, or landscape with <=560 height.
    $mobile = ($w -le 720) -or ($isLandscape -and $h -le 560)
    if ($w -gt 720 -and $w -le 900) { $mobile = $true }   # tablet portrait
    $dpr = 1
    if ($mobile) { $dpr = 2 }
    $safeTop = 0; $safeBottom = 0; $safeLeft = 0; $safeRight = 0
    if ($mobile -and -not $isLandscape) { $safeTop = 47; $safeBottom = 34 }
    elseif ($mobile -and $isLandscape)  { $safeLeft = 47; $safeRight = 47; $safeBottom = 21 }
    [ordered]@{
        name        = $spec
        w           = $w
        h           = $h
        dpr         = $dpr
        mobile      = $mobile
        touch       = $mobile
        orientation = $(if ($isLandscape) { 'landscape' } else { 'portrait' })
        safeArea    = [ordered]@{ top = $safeTop; bottom = $safeBottom; left = $safeLeft; right = $safeRight }
    }
}

# ------------------------------------------------------------------- build step
function Invoke-Build {
    Write-Head 'build (copy plugin sources into dist/)'
    $srcDir = if ($SourceDir) { (Resolve-Path $SourceDir).Path } else { $pluginDir }
    Write-Info ("from : {0}" -f $srcDir)
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir -Force | Out-Null }
    foreach ($f in @('index.js', 'style.css')) {
        $src = Join-Path $srcDir $f
        if (-not (Test-Path $src)) { throw "missing plugin source: $src" }
        Copy-Item -LiteralPath $src -Destination (Join-Path $distDir $f) -Force
        Write-Info ("copied {0} ({1:N0} bytes)" -f $f, (Get-Item $src).Length)
    }
    # Record exactly which bytes were measured: the plugin is being edited by
    # other agents during the session, so a screenshot needs provenance.
    $meta = [ordered]@{ copiedAt = (Get-Date).ToString('o'); files = @{}; git = @{} }
    foreach ($f in @('index.js', 'style.css')) {
        $p = Join-Path $srcDir $f
        $meta.files[$f] = [ordered]@{
            sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower()
            bytes  = (Get-Item $p).Length
            mtime  = (Get-Item $p).LastWriteTime.ToString('o')
        }
    }
    Push-Location $pluginDir
    try {
        if (Test-Path (Join-Path $pluginDir '.git')) {
            $meta.git['head'] = (& git rev-parse --short HEAD 2>$null)
            $stat = (& git diff --stat 2>$null) | Select-Object -Last 1
            $meta.git['worktree'] = if ($stat) { $stat.Trim() } else { 'clean' }
        }
    } catch { } finally { Pop-Location }
    if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }
    Write-Json $meta (Join-Path $outPath 'source.json') 6
    Write-Info ("index.js sha256 {0}" -f $meta.files['index.js'].sha256)
    Write-Info ("git: {0} {1}" -f $meta.git['head'], $meta.git['worktree'])
}

# --------------------------------------------------------------- cdp mode run
function Invoke-CdpRun($jobs) {
    Write-Head ("run (cdp): {0} jobs, {1} viewports" -f $jobs.Count, $Viewports.Count)
    $matrixPath = Join-Path $outPath '_matrix.json'
    Write-Json @{ jobs = $jobs; settleMs = 0 } $matrixPath 10
    $scriptPath = Join-Path $here 'cdp-run.js'
    $nodeArgs = @(
        $scriptPath,
        '--root', $here,
        '--out', $outPath,
        '--matrix', $matrixPath,
        '--chrome', $Chrome,
        '--ready-timeout', $ReadyTimeout
    )
    & $Node @nodeArgs
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 2) { throw "cdp-run.js failed (exit $LASTEXITCODE)" }
    return $LASTEXITCODE
}

# ---------------------------------------------------------------- cli fallback
function Invoke-CliRun($jobs) {
    Write-Head 'run (cli): chrome --headless=new --screenshot / --dump-dom'
    Write-Info 'NOTE: headless CLI clamps the window to >=500 CSS px wide; use -Mode cdp for exact phones.'
    $byVp = @{}
    $tmp = Join-Path $env:TEMP ('cvh-cli-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    $pngDir = Join-Path $outPath 'png'
    if (-not (Test-Path $pngDir)) { New-Item -ItemType Directory -Path $pngDir -Force | Out-Null }
    $i = 0
    foreach ($job in $jobs) {
        $i++
        $vp = $job.vp; $scene = $job.scene
        $tag = "$scene" + '__' + $vp.name
        $prof = Join-Path $tmp ('prof-' + $i)
        $png = Join-Path $pngDir ($tag + '.png')
        $base = 'file:///' + ($here -replace '\\', '/') + '/harness.html'
        $common = @(
            '--headless=new', '--disable-gpu', '--hide-scrollbars',
            '--force-device-scale-factor=1', ("--window-size={0},{1}" -f $vp.w, $vp.h),
            '--no-first-run', '--no-default-browser-check',
            '--virtual-time-budget=4000', ("--user-data-dir=$prof")
        )
        # screenshot pass
        & $Chrome @common ("--screenshot=$png") ($base + '?scene=' + $scene) 2>$null | Out-Null
        Write-Host ("   shot {0}" -f $tag)
        if (-not $SkipMeasure) {
            $url = $base + '?scene=' + $scene + '&measure=1'
            $dom = & $Chrome @common '--dump-dom' $url 2>$null | Out-String
            $json = $null
            $m = [regex]::Match($dom, '(?s)<script id="report-json"[^>]*>(.*?)</script>')
            if ($m.Success) { $json = $m.Groups[1].Value }
            if (-not $json) {
                $m = [regex]::Match($dom, '(?s)<pre id="report"[^>]*>(.*?)</pre>')
                if ($m.Success) {
                    $json = $m.Groups[1].Value.Replace('&lt;', '<').Replace('&gt;', '>').Replace('&amp;', '&')
                }
            }
            if ($json) {
                if (-not $byVp.ContainsKey($vp.name)) { $byVp[$vp.name] = [ordered]@{} }
                $byVp[$vp.name][$scene] = ($json | ConvertFrom-Json)
                Write-Host ("   meas {0}" -f $tag)
            } else {
                Write-Warning ("no measurement report for {0}" -f $tag)
            }
        }
    }
    foreach ($vpName in $byVp.Keys) {
        $payload = [ordered]@{
            viewport    = ($Viewports | Where-Object { $_ -eq $vpName } | Select-Object -First 1)
            generatedAt = (Get-Date).ToString('o')
            sceneCount  = $byVp[$vpName].Keys.Count
            scenes      = $byVp[$vpName]
        }
        Write-Json $payload (Join-Path $outPath ("measure-$vpName.json")) 20
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return 0
}

# ============================================================================
# main
# ============================================================================
if (-not (Test-Path $Chrome)) { throw "chrome not found: $Chrome" }
if (-not (Test-Path (Join-Path $pluginDir 'index.js'))) { throw "plugin source not found in $pluginDir" }

Write-Head 'ChatVault mobile harness'
Write-Info ("plugin : {0}" -f $pluginDir)
Write-Info ("output : {0}" -f $outPath)
Write-Info ("mode   : {0}" -f $Mode)

if (-not $SkipBuild) { Invoke-Build } else { Write-Head 'build (skipped)' }

if (-not (Test-Path $outPath)) { New-Item -ItemType Directory -Path $outPath -Force | Out-Null }

$vps = @()
foreach ($v in $Viewports) { $vps += New-Viewport $v }
Write-Head 'viewports'
$vps | ForEach-Object { Write-Info ("{0,-9} dpr={1} mobile={2} safe-area(top/bottom)={3}/{4}" -f $_.name, $_.dpr, $_.mobile, $_.safeArea.top, $_.safeArea.bottom) }

# which scenes
$requestedScenes =
    if ($Scene -contains 'all' -or ($Scene.Count -eq 1 -and [string]::IsNullOrWhiteSpace($Scene[0]))) { $ALL_SCENES }
    else { $Scene | ForEach-Object { ($_ -split ',') } | ForEach-Object { $_.Trim() } | Where-Object { $_ } }
foreach ($s in $requestedScenes) {
    if ($ALL_SCENES -notcontains $s) { throw "unknown scene '$s'. Known: $($ALL_SCENES -join ', ')" }
}

$primaryVp = $vps[0].name
$jobs = New-Object System.Collections.ArrayList
foreach ($vp in $vps) {
    $scenesForVp = if ($vp.name -eq $primaryVp -or $AllScenesAtAllViewports) {
        $requestedScenes
    } else {
        $requestedScenes | Where-Object { $CORE_SCENES -contains $_ }
    }
    foreach ($s in $scenesForVp) {
        [void]$jobs.Add([ordered]@{ scene = $s; vp = $vp })
    }
}
Write-Head 'matrix'
Write-Info ("{0} jobs: {1} scenes on {2}, {3} core scenes on the other {4} viewports" -f $jobs.Count, $requestedScenes.Count, $primaryVp, $CORE_SCENES.Count, ($vps.Count - 1))

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$exit = if ($Mode -eq 'cli') { Invoke-CliRun $jobs } else { Invoke-CdpRun $jobs }
$sw.Stop()

# ------------------------------------------------------------------- summary
Write-Head 'results'
$metaFile = Join-Path $outPath 'run-meta.json'
if (Test-Path $metaFile) {
    $meta = Read-Json $metaFile
    Write-Info ("jobs ok/total : {0}/{1}" -f $meta.ok, $meta.jobs)
    Write-Info ("png files     : {0}" -f $meta.pngs)
    Write-Info ("elapsed       : {0:N1}s" -f ($sw.Elapsed.TotalSeconds))
    if ($meta.warnCount -gt 0 -and (Test-Path (Join-Path $outPath 'warnings.json'))) {
        $wj = Read-Json (Join-Path $outPath 'warnings.json')
        Write-Host ("   PLAYBACK WARNINGS ({0}):" -f $wj.count) -ForegroundColor Yellow
        foreach ($w in $wj.warnings) { Write-Host ("     {0} @ {1}: sceneError={2} consoleErrors={3} {4}" -f $w.scene, $w.vp, $w.sceneError, $w.consoleErrors, $w.firstError) -ForegroundColor Yellow }
    }
    if (Test-Path (Join-Path $outPath 'failures.json')) {
        $fj = Read-Json (Join-Path $outPath 'failures.json')
        if ($fj.failed -gt 0) {
            Write-Host ("   FAILURES ({0}):" -f $fj.failed) -ForegroundColor Red
            foreach ($f in $fj.failures) { Write-Host ("     {0} @ {1}: {2}" -f $f.scene, $f.vp, $f.error) -ForegroundColor Red }
        }
    }
} else {
    Write-Info ("elapsed: {0:N1}s" -f $sw.Elapsed.TotalSeconds)
}
$pngDir = Join-Path $outPath 'png'
if (Test-Path $pngDir) {
    $pngs = Get-ChildItem $pngDir -Filter *.png | Sort-Object Name
    Write-Info ("screenshots: {0} in {1}" -f $pngs.Count, $pngDir)
    $pngs | Group-Object { ($_.Name -split '__')[1] } | Sort-Object Name | ForEach-Object {
        Write-Info ("  {0}: {1} scenes" -f $_.Name, $_.Count)
    }
}
$meas = Get-ChildItem $outPath -Filter 'measure-*.json' -ErrorAction SilentlyContinue
if ($meas) {
    Write-Info ("measurements: {0}" -f (($meas | ForEach-Object { $_.Name }) -join ', '))
}
Write-Host ''
exit $exit
