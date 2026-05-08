/**
 * SillyTavern ChatVault — 全局聊天档案管理器
 * v0.2.0 — 三 tab + 自定义标题 + 标签 + 最后消息预览
 * https://github.com/shanye5593/SillyTavern-ChatVault
 */

const VERSION = '0.2.0';
const STORAGE_KEY = 'st-chatvault-meta';
const PAGE_SIZE = 50;

/* ============================================================
 *  本地元数据：收藏 / 自定义标题 / 标签
 * ============================================================ */

function loadMeta() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}
function saveMeta(meta) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
}
function metaKey(avatar, fileName) {
    return `${avatar}::${fileName}`;
}
function getMetaFor(avatar, fileName) {
    return loadMeta()[metaKey(avatar, fileName)] || {};
}
function patchMetaFor(avatar, fileName, patch) {
    const m = loadMeta();
    const k = metaKey(avatar, fileName);
    m[k] = { ...(m[k] || {}), ...patch };
    // 清理空值
    if (m[k].customTitle === '') delete m[k].customTitle;
    if (Array.isArray(m[k].tags) && m[k].tags.length === 0) delete m[k].tags;
    if (!m[k].starred && !m[k].customTitle && !m[k].tags) {
        delete m[k];
    }
    saveMeta(m);
    return m[k] || {};
}
function toggleStar(avatar, fileName) {
    const cur = getMetaFor(avatar, fileName);
    return patchMetaFor(avatar, fileName, { starred: !cur.starred }).starred || false;
}

/* ============================================================
 *  酒馆 API
 * ============================================================ */

let _getReqHeaders = null;
const _headersReady = (async () => {
    try {
        const mod = await import('../../../../script.js');
        if (typeof mod.getRequestHeaders === 'function') {
            _getReqHeaders = mod.getRequestHeaders;
            console.log('[ChatVault] getRequestHeaders 已通过 ESM import 加载');
        }
    } catch (e) {
        console.warn('[ChatVault] 动态 import script.js 失败，将使用 cookie fallback:', e.message);
    }
})();

function getCsrfTokenFromCookie() {
    const m = document.cookie.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('csrf-token=') || c.startsWith('X-CSRF-Token='));
    if (!m) return null;
    return decodeURIComponent(m.split('=').slice(1).join('='));
}

function headers() {
    if (typeof _getReqHeaders === 'function') return _getReqHeaders();
    if (typeof globalThis.getRequestHeaders === 'function') return globalThis.getRequestHeaders();
    const token = getCsrfTokenFromCookie();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
    };
}

async function fetchAllCharacters() {
    let raw = null;
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.characters?.length) raw = ctx.characters;
    } catch {}
    if (!raw) {
        const res = await fetch('/api/characters/all', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`角色列表请求失败: ${res.status}`);
        raw = await res.json();
    }
    // 去重：ctx.characters 在某些 ST 版本里会因 shallow/full 双加载或世界书引用出现重复
    const seen = new Set();
    return (Array.isArray(raw) ? raw : []).filter(c => {
        if (!c || !c.avatar) return false;
        if (seen.has(c.avatar)) return false;
        seen.add(c.avatar);
        return true;
    });
}

async function fetchChatsFor(avatar) {
    let res;
    try {
        res = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ avatar_url: avatar }),
        });
    } catch (e) {
        throw new Error(`网络错误: ${e.message}`);
    }
    if (!res.ok) {
        let body = '';
        try { body = (await res.text()).slice(0, 200); } catch {}
        throw new Error(`HTTP ${res.status}${body ? ' - ' + body : ''}`);
    }
    let data;
    try { data = await res.json(); } catch (e) { throw new Error(`响应解析失败: ${e.message}`); }
    if (data && typeof data === 'object' && data.error === true) return [];
    return Array.isArray(data) ? data : Object.values(data || {});
}

function stripExt(name) { return String(name || '').replace(/\.jsonl$/i, ''); }
function withExt(name) { return stripExt(name) + '.jsonl'; }

async function renameChat(avatar, oldName, newName) {
    const res = await fetch('/api/chats/rename', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            avatar_url: avatar,
            original_file: withExt(oldName),
            renamed_file: withExt(newName),
        }),
    });
    if (!res.ok) throw new Error(`重命名失败: ${res.status}`);
}

async function deleteChat(avatar, fileName) {
    const res = await fetch('/api/chats/delete', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            avatar_url: avatar,
            chatfile: withExt(fileName),
        }),
    });
    if (!res.ok) throw new Error(`删除失败: ${res.status}`);
}

/* ---- 最后一条消息预览：懒加载 ---- */

const previewCache = new Map(); // key = metaKey, value = string | null

async function fetchLastMessageText(character, fileName) {
    const key = metaKey(character.avatar, fileName);
    if (previewCache.has(key)) return previewCache.get(key);

    // 尝试多种 body 形态以兼容不同 ST 版本（带 force:true 跳过缓存）
    const bodies = [
        { ch_name: character.name, file_name: stripExt(fileName), avatar_url: character.avatar, force: true },
        { avatar_url: character.avatar, file_name: withExt(fileName), force: true },
        { ch_name: character.name, file_name: stripExt(fileName), avatar_url: character.avatar },
    ];
    for (const body of bodies) {
        try {
            const res = await fetch('/api/chats/get', {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify(body),
            });
            if (!res.ok) continue;
            const data = await res.json();
            // 响应通常是数组：[metadata, ...messages]，或对象 { ... }
            const arr = Array.isArray(data) ? data : (data?.chat || []);
            for (let i = arr.length - 1; i >= 0; i--) {
                const msg = arr[i];
                if (msg && typeof msg.mes === 'string' && msg.mes.trim()) {
                    previewCache.set(key, msg.mes);
                    return msg.mes;
                }
            }
            previewCache.set(key, '');
            return '';
        } catch { /* try next body shape */ }
    }
    previewCache.set(key, null); // 永久失败
    return null;
}

/* ============================================================
 *  跳转
 * ============================================================ */

function waitFor(predicate, timeout = 3000, interval = 50) {
    return new Promise(resolve => {
        const start = Date.now();
        const tick = () => {
            try { if (predicate()) return resolve(true); } catch {}
            if (Date.now() - start >= timeout) return resolve(false);
            setTimeout(tick, interval);
        };
        tick();
    });
}

async function jumpToChat(character, fileName) {
    try {
        const ctx = SillyTavern.getContext();
        const candidates = ctx.characters
            .map((c, idx) => ({ c, idx }))
            .filter(({ c }) => c.avatar === character.avatar);
        const target = candidates.find(({ c }) => c.name === character.name) || candidates[0];
        if (!target) throw new Error('找不到角色（可能已被删除）');
        const chid = target.idx;

        const select = ctx.selectCharacterById || window.selectCharacterById;
        if (typeof select !== 'function') throw new Error('当前 ST 版本不支持自动切换角色');
        await select(chid);

        const ok = await waitFor(() => {
            const c = SillyTavern.getContext();
            return Number(c.characterId) === chid;
        }, 3000);
        if (!ok) throw new Error('角色切换超时');

        const target2 = stripExt(fileName);
        const open = ctx.openCharacterChat || window.openCharacterChat;
        // 提前关闭面板：手机端等 await 完成才关会出现 openCharacterChat 不 resolve / 软键盘事件吃掉关闭逻辑等问题
        closePanel();
        if (typeof open === 'function') {
            await open(target2);
        } else if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions(`/chat-jump file="${target2}"`);
        } else {
            toastr.warning('已切换角色，但当前 ST 版本无法直接打开指定聊天，请手动选择');
        }
    } catch (e) {
        console.error('[ChatVault] 跳转失败', e);
        toastr.error(`跳转失败: ${e.message}`);
    }
}

/* ============================================================
 *  状态
 * ============================================================ */

let panelEl = null;
let loadAllToken = 0;            // loadAll 调用计数，用于丢弃过时的回调
const groupOpen = new Set();     // 「按角色」tab 中已展开的角色 avatar
let charactersCache = [];        // 角色数组
let chatsByAvatar = {};          // { avatar: [{file_name, last_mes, mes, file_size, ...}] }
let errorsByAvatar = {};         // 加载失败信息
let activeTab = 'recent';        // 'recent' | 'characters' | 'favorites'
let currentPage = 1;             // 当前 tab 内的分页
let searchQuery = '';
let previewObserver = null;

/* ============================================================
 *  HTML 工具
 * ============================================================ */

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return safe.replace(re, m => `<span class="cv-hl">${m}</span>`);
}
function fmtSize(bytes) {
    if (typeof bytes === 'string') return bytes; // 老版本可能直接返回 "123kb"
    if (typeof bytes !== 'number' || !isFinite(bytes)) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtRelTime(dateStr) {
    if (!dateStr) return '';
    const t = parseSTDate(dateStr);
    if (!t) return '';
    const diff = Date.now() - t;
    const min = 60_000, hour = 60 * min, day = 24 * hour;
    if (diff < min) return '刚刚';
    if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} 周前`;
    if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} 个月前`;
    return new Date(t).toLocaleDateString();
}
// 兼容 ST 的多种时间字符串：humanizedDateTime("2026-5-8 @14h 32m 15s 123ms")、ISO、locale string、以及从文件名推断
function parseSTDate(s) {
    if (s == null) return 0;
    if (typeof s === 'number') return s;
    const str = String(s).trim();
    if (!str) return 0;
    // ST humanizedDateTime: "YYYY-M-D @Hh Mm Ss MSms"（@ 与各 unit 之间空格可有可无）
    let m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*@?\s*(\d{1,2})\s*h\s*(\d{1,2})\s*m(?:\s*(\d{1,2})\s*s)?(?:\s*(\d{1,3})\s*ms)?/i);
    if (m) {
        const [, y, mo, d, h, mi, se = '0', ms = '0'] = m;
        const t = new Date(+y, +mo - 1, +d, +h, +mi, +se, +ms).getTime();
        if (!isNaN(t)) return t;
    }
    // 紧凑变体："YYYY-MM-DD @HHhMMm" / "YYYY-MM-DDTHH:MM:SS"
    m = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T@]+(\d{1,2})[h:](\d{1,2})/i);
    if (m) {
        const [, y, mo, d, h, mi] = m;
        const t = new Date(+y, +mo - 1, +d, +h, +mi).getTime();
        if (!isNaN(t)) return t;
    }
    // 兜底：让浏览器原生解析
    const direct = Date.parse(str);
    if (!isNaN(direct)) return direct;
    return 0;
}

function timestampOf(chat) {
    if (!chat) return 0;
    // 优先用 last_mes，再退到 create_date / mes_last_date / 文件名
    return parseSTDate(chat.last_mes)
        || parseSTDate(chat.create_date)
        || parseSTDate(chat.mes_last_date)
        || parseSTDate(chat.file_name);
}

/* ============================================================
 *  图标 (lucide style, 内联 SVG)
 * ============================================================ */

const ICONS = {
    star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    jump: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
    msg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    chevL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>`,
    chevR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>`,
};

/* ============================================================
 *  UI 顶层
 * ============================================================ */

function openPanel() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'chatvault_overlay';
    panelEl.className = 'cv-theme-dark';
    panelEl.innerHTML = `
        <div id="chatvault_panel" onclick="event.stopPropagation()">
            <div class="cv-header">
                <h1>聊天档案 <span style="opacity:0.4;font-size:11px;font-weight:400;letter-spacing:0">v${VERSION}</span></h1>
                <div class="cv-search-wrap">
                    <input type="text" class="cv-search" id="cv_search" placeholder="搜索角色名 / 聊天标题 / 标签…" />
                </div>
                <button class="cv-icon-btn" id="cv_close" title="关闭 (Esc)">✕</button>
            </div>
            <div class="cv-tabbar">
                <div class="cv-tabs" id="cv_tabs">
                    <button class="cv-tab active" data-tab="recent">最近<span class="cv-tab-count" id="cv_count_recent"></span></button>
                    <button class="cv-tab" data-tab="characters">按角色<span class="cv-tab-count" id="cv_count_characters"></span></button>
                    <button class="cv-tab" data-tab="favorites">收藏<span class="cv-tab-count" id="cv_count_favorites"></span></button>
                </div>
                <div class="cv-pagination" id="cv_pagination"></div>
            </div>
            <div class="cv-status" id="cv_status"></div>
            <div class="cv-body" id="cv_body">
                <div class="cv-loading">正在加载…</div>
            </div>
        </div>
    `;
    panelEl.addEventListener('click', closePanel);
    document.body.appendChild(panelEl);

    document.getElementById('cv_close').onclick = closePanel;
    document.getElementById('cv_search').oninput = (e) => {
        searchQuery = e.target.value.trim();
        currentPage = 1;
        render();
    };
    document.getElementById('cv_tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.cv-tab');
        if (!btn) return;
        switchTab(btn.dataset.tab);
    });

    document.addEventListener('keydown', escHandler);

    // 同步 tab 按钮的高亮状态（activeTab 是模块级变量，跨开关保留）
    document.querySelectorAll('#cv_tabs .cv-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === activeTab);
    });

    setupPreviewObserver();
    loadAll();
}

function escHandler(e) {
    if (e.key !== 'Escape') return;
    // 如果有打开的 modal 先关 modal
    const modal = document.getElementById('cv_modal');
    if (modal) { modal.remove(); return; }
    closePanel();
}

function closePanel() {
    if (previewObserver) { previewObserver.disconnect(); previewObserver = null; }
    if (panelEl) { panelEl.remove(); panelEl = null; }
    document.removeEventListener('keydown', escHandler);
}

function switchTab(tab) {
    if (tab === activeTab) return;
    activeTab = tab;
    currentPage = 1;
    document.querySelectorAll('#cv_tabs .cv-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    render();
}

function setStatus(text) {
    const el = document.getElementById('cv_status');
    if (el) el.textContent = text || '';
}

/* ============================================================
 *  数据加载
 * ============================================================ */

async function loadAll() {
    const loadToken = ++loadAllToken; // 防止重复打开造成的并发污染
    setStatus('正在初始化…');
    document.getElementById('cv_body').innerHTML = '<div class="cv-loading">正在加载…</div>';
    try {
        await _headersReady;
        setStatus('正在加载角色列表…');
        charactersCache = await fetchAllCharacters();
        setStatus(`共 ${charactersCache.length} 个角色，正在加载聊天档案…`);

        chatsByAvatar = {};
        errorsByAvatar = {};
        let done = 0;
        const concurrency = 6;
        const queue = [...charactersCache];

        async function worker() {
            while (queue.length) {
                const c = queue.shift();
                try {
                    const list = await fetchChatsFor(c.avatar);
                    chatsByAvatar[c.avatar] = (Array.isArray(list) ? list : []).map(ch => ({
                        ...ch,
                        file_name: stripExt(ch.file_name),
                    }));
                } catch (e) {
                    chatsByAvatar[c.avatar] = [];
                    errorsByAvatar[c.avatar] = e.message || String(e);
                    console.warn('[ChatVault] 角色聊天加载失败:', c.name, e);
                }
                done++;
                if (done % 5 === 0 || done === charactersCache.length) {
                    setStatus(`已加载 ${done} / ${charactersCache.length} 个角色的聊天档案…`);
                }
            }
        }

        await Promise.all(Array.from({ length: concurrency }, worker));
        if (loadToken !== loadAllToken || !panelEl) return; // 已被新一轮加载或关闭抢占

        const totalChats = Object.values(chatsByAvatar).reduce((s, a) => s + a.length, 0);
        const errCount = Object.keys(errorsByAvatar).length;
        const errSuffix = errCount ? `，⚠ ${errCount} 个角色加载失败` : '';
        setStatus(`✓ 共 ${charactersCache.length} 个角色 · ${totalChats} 条聊天${errSuffix}`);
        render();
    } catch (e) {
        console.error('[ChatVault] 加载失败', e);
        setStatus(`❌ 加载失败: ${e.message}`);
        document.getElementById('cv_body').innerHTML =
            `<div class="cv-empty">加载失败：${escapeHtml(e.message)}</div>`;
    }
}

/* ============================================================
 *  数据视图：每个 tab 应该展示什么
 * ============================================================ */

// 把所有聊天打平成 [{character, chat}, ...]
function flatAllChats() {
    const out = [];
    for (const c of charactersCache) {
        const list = chatsByAvatar[c.avatar] || [];
        for (const ch of list) out.push({ character: c, chat: ch });
    }
    return out;
}

function matchesSearch(character, chat) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const meta = getMetaFor(character.avatar, chat.file_name);
    const title = (meta.customTitle || chat.file_name || '').toLowerCase();
    const charName = (character.name || '').toLowerCase();
    const tags = (meta.tags || []).join(' ').toLowerCase();
    return title.includes(q) || charName.includes(q) || (chat.file_name || '').toLowerCase().includes(q) || tags.includes(q);
}

function viewRecent() {
    return flatAllChats()
        .filter(({ character, chat }) => matchesSearch(character, chat))
        .sort((a, b) => timestampOf(b.chat) - timestampOf(a.chat));
}

function viewFavorites() {
    return flatAllChats()
        .filter(({ character, chat }) => getMetaFor(character.avatar, chat.file_name).starred)
        .filter(({ character, chat }) => matchesSearch(character, chat))
        .sort((a, b) => timestampOf(b.chat) - timestampOf(a.chat));
}

function viewByCharacter() {
    // 按角色分组：[{character, chats: [...]}]，每组按时间倒序，组按"该组最新一条"倒序
    const groups = [];
    for (const c of charactersCache) {
        const list = (chatsByAvatar[c.avatar] || [])
            .filter(ch => matchesSearch(c, ch))
            .sort((a, b) => timestampOf(b) - timestampOf(a));
        if (list.length === 0 && searchQuery && !(c.name || '').toLowerCase().includes(searchQuery.toLowerCase())) continue;
        if (list.length === 0 && !searchQuery) continue; // 无聊天的角色不展示
        groups.push({ character: c, chats: list });
    }
    return groups.sort((a, b) => {
        // 先按聊天数倒序（防止 0/1 条的角色抢位置），同数再按最新一条时间倒序
        if (b.chats.length !== a.chats.length) return b.chats.length - a.chats.length;
        const ta = a.chats[0] ? timestampOf(a.chats[0]) : 0;
        const tb = b.chats[0] ? timestampOf(b.chats[0]) : 0;
        return tb - ta;
    });
}

/* ============================================================
 *  渲染
 * ============================================================ */

function updateTabCounts() {
    const totalAll = flatAllChats().length;
    const totalFav = flatAllChats().filter(({ character, chat }) =>
        getMetaFor(character.avatar, chat.file_name).starred).length;
    const totalChars = viewByCharacter().length;
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('cv_count_recent', totalAll);
    set('cv_count_characters', totalChars);
    set('cv_count_favorites', totalFav);
}

function render() {
    if (!panelEl) return; // 面板已被关闭，忽略残留的异步回调
    const body = document.getElementById('cv_body');
    if (!body) return;
    updateTabCounts();

    if (activeTab === 'characters') {
        renderCharactersTab(body);
        renderPagination(0, 1);
        return;
    }

    const items = activeTab === 'favorites' ? viewFavorites() : viewRecent();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const slice = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    if (items.length === 0) {
        body.innerHTML = `<div class="cv-empty">${
            searchQuery ? '没有匹配的结果'
            : activeTab === 'favorites' ? '还没有收藏的聊天'
            : '没有任何聊天记录'
        }</div>`;
    } else {
        body.innerHTML = `<div class="cv-list">${slice.map(({ character, chat }) => renderCard(character, chat)).join('')}</div>`;
        bindCardEvents();
        observePreviews();
    }
    renderPagination(items.length, totalPages);
}

function renderCharactersTab(body) {
    const groups = viewByCharacter();
    if (groups.length === 0) {
        body.innerHTML = `<div class="cv-empty">${searchQuery ? '没有匹配的结果' : '没有任何聊天记录'}</div>`;
        return;
    }
    // 搜索时默认全部展开，便于看到匹配结果；否则按用户记忆的状态（默认折叠）
    body.innerHTML = groups.map(({ character: c, chats }) => {
        const avatarUrl = c.avatar
            ? `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`
            : '';
        const errMsg = errorsByAvatar[c.avatar];
        const right = errMsg
            ? `<span class="cv-group-error" title="${escapeHtml(errMsg)}">⚠ 加载失败</span>`
            : `<span class="cv-group-count">共 ${chats.length} 条聊天</span>`;
        const expanded = !!searchQuery || groupOpen.has(c.avatar);
        return `
            <div class="cv-group ${expanded ? 'is-open' : ''}" data-avatar="${escapeHtml(c.avatar)}">
                <div class="cv-group-header">
                    <span class="cv-group-toggle">${ICONS.chevR}</span>
                    <img class="cv-group-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt="" />
                    <span class="cv-group-name">${highlight(c.name || '(无名)', searchQuery)}</span>
                    ${right}
                </div>
                <div class="cv-list cv-group-list">
                    ${chats.map(ch => renderCard(c, ch, /*hideCharName*/ true)).join('')}
                </div>
            </div>
        `;
    }).join('');
    // 绑定折叠
    body.querySelectorAll('.cv-group').forEach(g => {
        const header = g.querySelector('.cv-group-header');
        if (!header) return;
        header.onclick = () => {
            const avatar = g.dataset.avatar;
            const nowOpen = !g.classList.contains('is-open');
            g.classList.toggle('is-open', nowOpen);
            if (nowOpen) groupOpen.add(avatar);
            else groupOpen.delete(avatar);
            // 展开后才让预览开始懒加载
            if (nowOpen) observePreviews();
        };
    });
    bindCardEvents();
    observePreviews();
}

function renderCard(character, chat, hideCharName = false) {
    const meta = getMetaFor(character.avatar, chat.file_name);
    const customTitle = meta.customTitle || '';
    const displayTitle = customTitle || chat.file_name || '(未命名)';
    const titleClass = customTitle ? '' : 'is-default';
    const tags = Array.isArray(meta.tags) ? meta.tags : [];
    const starred = !!meta.starred;
    const avatarUrl = character.avatar
        ? `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`
        : '';
    const msgCount = typeof chat.mes === 'number' ? chat.mes
                   : (typeof chat.chat_items === 'number' ? chat.chat_items : null);
    const sizeStr = chat.file_size ? fmtSize(chat.file_size) : '';
    const timeStr = fmtRelTime(chat.last_mes);

    const charLabel = hideCharName ? '' : `
        <span class="cv-character">${highlight(character.name || '', searchQuery)}</span>
        <span class="cv-dot"></span>
    `;

    const meta1 = [
        msgCount !== null ? `<span class="cv-meta">${ICONS.msg} ${msgCount} 条</span>` : '',
        sizeStr ? `<span class="cv-meta">${ICONS.file} ${escapeHtml(sizeStr)}</span>` : '',
        timeStr ? `<span class="cv-meta">${ICONS.clock} ${escapeHtml(timeStr)}</span>` : '',
    ].filter(Boolean).join('');

    const tagsHtml = tags.length
        ? `<span class="cv-meta-sep"></span><div class="cv-tags">${tags.map(t => `<span class="cv-tag">${highlight(t, searchQuery)}</span>`).join('')}</div>`
        : '';

    return `
        <div class="cv-card" data-avatar="${escapeHtml(character.avatar)}" data-file="${escapeHtml(chat.file_name)}">
            <img class="cv-card-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt="" />
            <div class="cv-card-main">
                <div class="cv-card-row">
                    <div class="cv-card-titleblock">
                        <div class="cv-card-toprow">
                            ${charLabel}
                            <h3 class="cv-title ${titleClass}">${highlight(displayTitle, searchQuery)}</h3>
                        </div>
                        <div class="cv-filename">${escapeHtml(withExt(chat.file_name))}</div>
                    </div>
                    <div class="cv-actions">
                        <button class="cv-act cv-star ${starred ? 'is-on' : ''}" data-act="star" title="收藏">${ICONS.star}</button>
                        <button class="cv-act" data-act="edit" title="编辑标题/标签">${ICONS.edit}</button>
                        <button class="cv-act cv-act-delete" data-act="delete" title="删除">${ICONS.trash}</button>
                        <span class="cv-act-divider"></span>
                        <button class="cv-act cv-act-jump" data-act="open" title="跳转到此聊天"><span>继续</span>${ICONS.jump}</button>
                    </div>
                </div>
                <div class="cv-meta-row">
                    ${meta1}
                    ${tagsHtml}
                </div>
                <div class="cv-preview is-loading" data-preview="1">加载预览中…</div>
            </div>
        </div>
    `;
}

function renderPagination(total, totalPages) {
    const el = document.getElementById('cv_pagination');
    if (!el) return;
    if (activeTab === 'characters' || total === 0) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `
        <span>第 ${currentPage} / ${totalPages} 页</span>
        <button class="cv-page-btn" id="cv_prev" ${currentPage <= 1 ? 'disabled' : ''}>${ICONS.chevL}</button>
        <button class="cv-page-btn" id="cv_next" ${currentPage >= totalPages ? 'disabled' : ''}>${ICONS.chevR}</button>
    `;
    document.getElementById('cv_prev').onclick = () => { if (currentPage > 1) { currentPage--; render(); document.getElementById('cv_body').scrollTop = 0; } };
    document.getElementById('cv_next').onclick = () => { if (currentPage < totalPages) { currentPage++; render(); document.getElementById('cv_body').scrollTop = 0; } };
}

/* ============================================================
 *  事件绑定
 * ============================================================ */

function bindCardEvents() {
    document.querySelectorAll('.cv-card').forEach(card => {
        const avatar = card.dataset.avatar;
        const fileName = card.dataset.file;
        const character = charactersCache.find(c => c.avatar === avatar);
        if (!character) return;

        card.querySelectorAll('.cv-act').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const act = btn.dataset.act;
                if (act === 'star') {
                    const on = toggleStar(avatar, fileName);
                    btn.classList.toggle('is-on', on);
                    updateTabCounts();
                    if (activeTab === 'favorites' && !on) {
                        // 从收藏 tab 取消收藏 → 重新渲染
                        render();
                    }
                } else if (act === 'edit') {
                    openEditModal(character, fileName);
                } else if (act === 'delete') {
                    handleDelete(character, fileName);
                } else if (act === 'open') {
                    jumpToChat(character, fileName);
                }
            };
        });

        // 双击卡片打开（避开操作按钮区与编辑/删除 modal 触发）
        card.ondblclick = (e) => {
            if (e.target.closest('.cv-actions')) return;
            jumpToChat(character, fileName);
        };
    });
}

/* ============================================================
 *  预览懒加载（IntersectionObserver）
 * ============================================================ */

function setupPreviewObserver() {
    if (previewObserver) previewObserver.disconnect();
    previewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            previewObserver.unobserve(el);
            const card = el.closest('.cv-card');
            if (!card) continue;
            const character = charactersCache.find(c => c.avatar === card.dataset.avatar);
            if (!character) continue;
            const fileName = card.dataset.file;
            fetchLastMessageText(character, fileName).then(text => {
                if (!el.isConnected) return;
                if (text === null) {
                    el.classList.remove('is-loading');
                    el.classList.add('is-empty');
                    el.textContent = '（无法加载预览）';
                } else if (!text) {
                    el.classList.remove('is-loading');
                    el.classList.add('is-empty');
                    el.textContent = '（空聊天）';
                } else {
                    // 简单清洗 markdown 符号，保留可读性
                    const clean = text
                        .replace(/[*_`~]+/g, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 240);
                    el.classList.remove('is-loading');
                    el.textContent = clean;
                }
            });
        }
    }, { root: document.getElementById('cv_body'), rootMargin: '200px' });
}

function observePreviews() {
    if (!previewObserver) return;
    document.querySelectorAll('.cv-preview[data-preview="1"]').forEach(el => {
        // 如果已有缓存就直接显示
        const card = el.closest('.cv-card');
        if (!card) return;
        const key = metaKey(card.dataset.avatar, card.dataset.file);
        if (previewCache.has(key)) {
            const text = previewCache.get(key);
            if (text === null) {
                el.classList.remove('is-loading'); el.classList.add('is-empty');
                el.textContent = '（无法加载预览）';
            } else if (!text) {
                el.classList.remove('is-loading'); el.classList.add('is-empty');
                el.textContent = '（空聊天）';
            } else {
                el.classList.remove('is-loading');
                el.textContent = text.replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
            }
            return;
        }
        previewObserver.observe(el);
    });
}

/* ============================================================
 *  编辑 modal （自定义标题 + 标签 + 重命名文件名）
 * ============================================================ */

function openEditModal(character, fileName) {
    const meta = getMetaFor(character.avatar, fileName);
    const customTitle = meta.customTitle || '';
    const tags = Array.isArray(meta.tags) ? meta.tags : [];

    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal" onclick="event.stopPropagation()">
            <h3>编辑聊天信息</h3>
            <div class="cv-field">
                <label>自定义标题</label>
                <input type="text" id="cv_m_title" value="${escapeHtml(customTitle)}" placeholder="例如：咖啡馆初遇" />
                <div class="cv-field-hint">仅本机显示，不会修改聊天文件本身</div>
            </div>
            <div class="cv-field">
                <label>标签（用逗号分隔）</label>
                <input type="text" id="cv_m_tags" value="${escapeHtml(tags.join(', '))}" placeholder="例如：甜文, 现代AU, 重要" />
            </div>
            <div class="cv-field">
                <label>原始文件名</label>
                <input type="text" id="cv_m_file" value="${escapeHtml(fileName)}" />
                <div class="cv-field-hint">修改这里会真正在服务器上重命名文件</div>
            </div>
            <div class="cv-modal-actions">
                <button class="cv-btn" id="cv_m_cancel">取消</button>
                <button class="cv-btn cv-btn-primary" id="cv_m_save">保存</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    setTimeout(() => document.getElementById('cv_m_title').focus(), 0);

    document.getElementById('cv_m_cancel').onclick = closeModal;
    document.getElementById('cv_m_save').onclick = async () => {
        const newTitle = document.getElementById('cv_m_title').value.trim();
        const newTags = document.getElementById('cv_m_tags').value
            .split(',').map(s => s.trim()).filter(Boolean);
        const newFile = document.getElementById('cv_m_file').value.trim();

        // 1. 文件重命名（如改了）
        let curFile = fileName;
        if (newFile && newFile !== fileName) {
            try {
                setStatus('正在重命名文件…');
                await renameChat(character.avatar, fileName, newFile);
                // 更新缓存
                const list = chatsByAvatar[character.avatar] || [];
                const item = list.find(c => c.file_name === fileName);
                if (item) item.file_name = newFile;
                // 把本地 meta 一并迁移
                const fullMeta = loadMeta();
                const oldKey = metaKey(character.avatar, fileName);
                const newKey = metaKey(character.avatar, newFile);
                if (fullMeta[oldKey]) {
                    fullMeta[newKey] = { ...fullMeta[oldKey], ...(fullMeta[newKey] || {}) };
                    delete fullMeta[oldKey];
                    saveMeta(fullMeta);
                }
                // 预览缓存也迁移
                if (previewCache.has(oldKey)) {
                    previewCache.set(newKey, previewCache.get(oldKey));
                    previewCache.delete(oldKey);
                }
                curFile = newFile;
                setStatus('✓ 已重命名');
            } catch (e) {
                setStatus(`❌ 重命名失败: ${e.message}`);
                toastr.error(`重命名失败: ${e.message}`);
                return;
            }
        }

        // 2. 自定义标题 + 标签
        patchMetaFor(character.avatar, curFile, {
            customTitle: newTitle,
            tags: newTags,
        });

        closeModal();
        render();
    };

    // 回车保存
    wrap.querySelectorAll('input').forEach(inp => {
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') document.getElementById('cv_m_save').click();
            else if (e.key === 'Escape') closeModal();
        };
    });
}

function closeModal() {
    const m = document.getElementById('cv_modal');
    if (m) m.remove();
}

/* ============================================================
 *  删除
 * ============================================================ */

async function handleDelete(character, fileName) {
    const meta = getMetaFor(character.avatar, fileName);
    const display = meta.customTitle || fileName;
    if (!confirm(`确定删除「${character.name}」的聊天「${display}」吗？\n此操作无法撤销。`)) return;
    try {
        setStatus('正在删除…');
        await deleteChat(character.avatar, fileName);
        chatsByAvatar[character.avatar] = (chatsByAvatar[character.avatar] || [])
            .filter(c => c.file_name !== fileName);
        // 清掉本地 meta
        const full = loadMeta();
        delete full[metaKey(character.avatar, fileName)];
        saveMeta(full);
        previewCache.delete(metaKey(character.avatar, fileName));
        setStatus('✓ 已删除');
        render();
    } catch (e) {
        setStatus(`❌ 删除失败: ${e.message}`);
        toastr.error(`删除失败: ${e.message}`);
    }
}

/* ============================================================
 *  入口按钮
 * ============================================================ */

function injectButton() {
    if (document.getElementById('chatvault_open_btn')) return;
    const btn = document.createElement('div');
    btn.id = 'chatvault_open_btn';
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.title = '打开聊天档案';
    btn.innerHTML = `<div class="fa-solid fa-book"></div><span>聊天档案</span>`;
    btn.onclick = openPanel;

    const extMenu = document.getElementById('extensionsMenu');
    if (extMenu) { extMenu.appendChild(btn); return; }

    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#333;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;';
    document.body.appendChild(btn);
}

jQuery(async () => {
    const tryInject = () => {
        if (document.getElementById('extensionsMenu')) injectButton();
        else setTimeout(tryInject, 500);
    };
    tryInject();
    console.log(`[ChatVault] v${VERSION} 已加载`);
});
