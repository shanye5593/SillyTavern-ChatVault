/**
 * SillyTavern ChatVault — 全局聊天档案管理器
 * v0.2.3 — 修复手机端编辑弹窗顶起 + 导出折叠 + 滑块开关 + 导入图标改向内
 * https://github.com/shanye5593/SillyTavern-ChatVault
 */

const VERSION = '0.3.24-test';
const STORAGE_KEY = 'st-chatvault-meta';
const SETTINGS_KEY = 'st-chatvault-settings';
const PAGE_SIZE = 50;
const THEMES = [
    { id: 'dark',   name: '夜间 Dark' },
    { id: 'light',  name: '白底 Light' },
    { id: 'coffee', name: '咖啡 Coffee' },
];
const DEFAULT_STRIP = {
    thinking: true,
    think: true,
    htmlComment: true,
    selfClosing: false,        // <PascalCaseTag ... /> 这种单标签前端占位
    mdHeaders: false,          // ### 正文 这种 markdown 标题行
    recall: false,             // <recall>...</recall>（user 默认会开）
    supplement: false,         // <supplement>...</supplement>（user 默认会开）
    custom: [],
};
const DEFAULT_EXTRACT = {
    content: false,           // <content>...</content>
    reply: false,             // <reply>...</reply>
    userInput: false,         // <本轮用户输入>...</本轮用户输入>（user 默认会开）
    custom: [],               // [{open, close}, ...]
};
const DEFAULT_USER_RULES = {
    enabled: false,
    strip: {
        thinking: false, think: false, htmlComment: false,
        selfClosing: false, mdHeaders: false,
        recall: true, supplement: true,        // 滑块默认打开
        custom: [],
    },
    extract: {
        content: false, reply: false,
        userInput: true,                       // 滑块默认打开
        custom: [],
    },
};
const DEFAULT_SETTINGS = {
    enabled: true,
    theme: 'dark',
    // 摘取规则（v0.3.14 起阅读 / 导出共用一套，从主面板卡片折叠区进入编辑）
    strip:   { ...DEFAULT_STRIP },
    extract: { ...DEFAULT_EXTRACT },
    userRules: JSON.parse(JSON.stringify(DEFAULT_USER_RULES)),
    // 分页器模式: 'always' = 常驻底部, 'autoHide' = 下滑隐藏/上滑出现（同时控制悬浮按钮）
    readerPagerMode: 'autoHide',
    // 阅读模式正文字号 (px)
    readerFontSize: 15,
    // 阅读模式段落首行缩进
    readerIndent: false,
};

function loadSettings() {
    try {
        const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
        // v0.3.14 迁移：阅读 / 导出 规则合并为同一套
        if (s.readStrip || s.readExtract || s.userReadRules) {
            if (s.readStrip   && !localStorage.getItem(SETTINGS_KEY + '__migrated_strip'))   s.strip     = { ...DEFAULT_STRIP,   ...s.readStrip };
            if (s.readExtract && !localStorage.getItem(SETTINGS_KEY + '__migrated_extract')) s.extract   = { ...DEFAULT_EXTRACT, ...s.readExtract };
            if (s.userReadRules)                                                              s.userRules = JSON.parse(JSON.stringify(s.userReadRules));
            delete s.readStrip; delete s.readExtract; delete s.userReadRules;
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
        }
        return s;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}
function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function currentThemeClass() {
    const id = loadSettings().theme;
    return THEMES.some(t => t.id === id) ? `cv-theme-${id}` : 'cv-theme-dark';
}

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
    if (m[k].userAvatar === '') delete m[k].userAvatar;
    if (!m[k].starred && !m[k].customTitle && !m[k].tags && !m[k].userAvatar) {
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

async function newChatFor(character) {
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

        // 提前关闭面板（手机端同样的考量）
        closePanel();

        if (typeof ctx.newChat === 'function') {
            await ctx.newChat();
        } else if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions('/newchat');
        } else {
            toastr.warning('已切换角色，但当前 ST 版本无法自动新建聊天，请手动新建');
            return;
        }
        toastr.success(`已为「${character.name || '角色'}」新建聊天`);
    } catch (e) {
        console.error('[ChatVault] 新建聊天失败', e);
        toastr.error(`新建聊天失败: ${e.message}`);
    }
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
let activeTab = 'recent';        // 'recent' | 'characters' | 'favorites' | 'current'
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
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><polyline points="10 8 14 12 10 16"/><line x1="14" y1="12" x2="3" y2="12"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    chevDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="6 9 12 15 18 9"/></svg>`,
    book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    arrowL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.34.22.7.22 1.06V11a2 2 0 0 1 0 4z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
};

/* ============================================================
 *  UI 顶层
 * ============================================================ */

function openPanel() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'chatvault_overlay';
    panelEl.className = currentThemeClass();
    panelEl.innerHTML = `
        <div id="chatvault_panel" onclick="event.stopPropagation()">
            <div class="cv-header">
                <div class="cv-titleblock">
                    <h1>聊天档案<span class="cv-snapshot-dot" id="cv_snapshot_dot" title="当前显示快照 · 点右上角刷新键同步最新"></span></h1>
                </div>
                <div class="cv-search-wrap">
                    <input type="text" class="cv-search" id="cv_search" placeholder="搜索角色名 / 聊天标题 / 标签…" />
                </div>
                <div class="cv-header-actions">
                    <button class="cv-icon-btn cv-refresh-btn" id="cv_refresh" title="手动刷新（重新加载所有角色和聊天）">${ICONS.refresh}</button>
                    <button class="cv-icon-btn" id="cv_close" title="关闭 (Esc)">✕</button>
                </div>
            </div>
            <div class="cv-tabbar">
                <div class="cv-tabs" id="cv_tabs">
                    <button class="cv-tab active" data-tab="recent">最近<span class="cv-tab-count" id="cv_count_recent"></span></button>
                    <button class="cv-tab" data-tab="characters">按角色<span class="cv-tab-count" id="cv_count_characters"></span></button>
                    <button class="cv-tab" data-tab="favorites">收藏<span class="cv-tab-count" id="cv_count_favorites"></span></button>
                    <button class="cv-tab" data-tab="current">当前角色<span class="cv-tab-count" id="cv_count_current"></span></button>
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
    document.getElementById('cv_refresh').onclick = (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (btn.classList.contains('is-spinning')) return;
        btn.classList.add('is-spinning');
        loadAll().finally(() => btn.classList.remove('is-spinning'));
    };
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
    // 瞬开模式 (B)：内存里已有 cache 就直接渲染，跳过 loadAll；
    // 用户察觉数据过时可点标题栏的刷新按钮强制 loadAll。
    if (charactersCache && charactersCache.length > 0) {
        render();
        observePreviews();
        markSnapshot(true);   // 刷新按钮上挂个小绿点，告诉用户当前是快照
    } else {
        loadAll();
    }
}

function markSnapshot(isSnapshot) {
    const dot = document.getElementById('cv_snapshot_dot');
    if (dot) dot.classList.toggle('is-on', !!isSnapshot);
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
    // 关闭面板时清空搜索词，避免下次打开时旧搜索仍然生效但输入框为空
    searchQuery = '';
    currentPage = 1;
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
        setStatus(`正在加载聊天档案…`);

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

        const errCount = Object.keys(errorsByAvatar).length;
        setStatus(errCount ? `⚠ ${errCount} 个角色加载失败` : '');
        markSnapshot(false);   // 新鲜数据，撤掉刷新按钮上的小绿点
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

function getCurrentCharacter() {
    try {
        const ctx = SillyTavern.getContext();
        const idx = Number(ctx.characterId);
        if (!Number.isFinite(idx) || idx < 0) return null;
        const c = ctx.characters?.[idx];
        if (!c || !c.avatar) return null;
        // 用 charactersCache 里的同 avatar 实例（保证后续操作引用一致）
        return charactersCache.find(x => x.avatar === c.avatar) || c;
    } catch {
        return null;
    }
}

function viewCurrentCharacter() {
    const c = getCurrentCharacter();
    if (!c) return { character: null, items: [] };
    const list = (chatsByAvatar[c.avatar] || [])
        .filter(ch => matchesSearch(c, ch))
        .sort((a, b) => timestampOf(b) - timestampOf(a))
        .map(chat => ({ character: c, chat }));
    return { character: c, items: list };
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
    const cur = getCurrentCharacter();
    const totalCur = cur ? (chatsByAvatar[cur.avatar] || []).length : 0;
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('cv_count_recent', totalAll);
    set('cv_count_characters', totalChars);
    set('cv_count_favorites', totalFav);
    set('cv_count_current', totalCur);
}

function render() {
    if (!panelEl) return; // 面板已被关闭，忽略残留的异步回调
    const body = document.getElementById('cv_body');
    if (!body) return;
    if (readerState.active) { renderReader(); return; }
    updateTabCounts();

    if (activeTab === 'characters') {
        renderCharactersTab(body);
        renderPagination(0, 1);
        return;
    }

    let items;
    let curChar = null;
    if (activeTab === 'favorites') {
        items = viewFavorites();
    } else if (activeTab === 'current') {
        const v = viewCurrentCharacter();
        items = v.items;
        curChar = v.character;
    } else {
        items = viewRecent();
    }

    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const slice = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    // 当前角色 tab：顶部固定一个角色信息条 + 新建聊天按钮（即使没聊天也显示）
    let currentHeader = '';
    if (activeTab === 'current' && curChar) {
        const avatarUrl = curChar.avatar
            ? `/thumbnail?type=avatar&file=${encodeURIComponent(curChar.avatar)}`
            : '';
        currentHeader = `
            <div class="cv-current-header">
                <img class="cv-group-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt="" />
                <span class="cv-group-name">${escapeHtml(curChar.name || '(无名)')}</span>
                <span class="cv-group-count">共 ${(chatsByAvatar[curChar.avatar] || []).length} 条聊天</span>
                <button class="cv-group-newchat" id="cv_current_import" title="从 jsonl 文件导入到当前角色">
                    ${ICONS.upload}<span>导入</span>
                </button>
                <button class="cv-group-newchat" id="cv_current_newchat" title="为该角色新建聊天">
                    ${ICONS.plus}<span>新建聊天</span>
                </button>
            </div>
        `;
    }

    if (items.length === 0) {
        let empty;
        if (searchQuery) empty = '没有匹配的结果';
        else if (activeTab === 'favorites') empty = '还没有收藏的聊天';
        else if (activeTab === 'current') empty = curChar ? `「${curChar.name || '当前角色'}」还没有聊天记录` : '当前没有选中任何角色，请先在角色列表里选一个';
        else empty = '没有任何聊天记录';
        body.innerHTML = currentHeader + `<div class="cv-empty">${escapeHtml(empty)}</div>`;
    } else {
        // 当前角色 tab：卡片省略角色名（同一角色重复无意义）
        const hideCharName = activeTab === 'current';
        // PC 端所有 tab 都用双列网格（移动端 CSS 媒体查询会自动回退单列）
        body.innerHTML = currentHeader + `<div class="cv-list cv-list-grid">${slice.map(({ character, chat }) => renderCard(character, chat, hideCharName)).join('')}</div>`;
        bindCardEvents();
        observePreviews();
    }
    // 绑定「当前角色」头部的新建聊天 / 导入按钮
    if (activeTab === 'current' && curChar) {
        const newBtn = document.getElementById('cv_current_newchat');
        if (newBtn) {
            newBtn.onclick = (ev) => {
                ev.stopPropagation();
                if (!confirm(`为「${curChar.name || '角色'}」新建一个聊天？\n\n会切换到该角色并开始全新对话。`)) return;
                newChatFor(curChar);
            };
        }
        const impBtn = document.getElementById('cv_current_import');
        if (impBtn) {
            impBtn.onclick = (ev) => {
                ev.stopPropagation();
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = '.jsonl,application/x-jsonlines';
                inp.onchange = () => {
                    const f = inp.files?.[0];
                    if (!f) return;
                    if (!confirm(`导入文件「${f.name}」到「${curChar.name || '当前角色'}」？\n\n会作为该角色的新聊天加入档案。`)) return;
                    importChatToCharacter(curChar, f);
                };
                inp.click();
            };
        }
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
                    <button class="cv-group-newchat" title="为该角色新建聊天">
                        ${ICONS.plus}<span>新建聊天</span>
                    </button>
                </div>
                <div class="cv-list cv-list-grid cv-group-list">
                    ${chats.map(ch => renderCard(c, ch, /*hideCharName*/ true)).join('')}
                </div>
            </div>
        `;
    }).join('');
    // 绑定折叠
    body.querySelectorAll('.cv-group').forEach(g => {
        const header = g.querySelector('.cv-group-header');
        if (!header) return;
        const avatar = g.dataset.avatar;
        // 新建聊天按钮：阻断折叠、确认后新建
        const newBtn = header.querySelector('.cv-group-newchat');
        if (newBtn) {
            newBtn.onclick = (ev) => {
                ev.stopPropagation();
                const character = (charactersCache || []).find(c => c.avatar === avatar);
                if (!character) return;
                if (!confirm(`为「${character.name || '角色'}」新建一个聊天？\n\n会切换到该角色并开始全新对话。`)) return;
                newChatFor(character);
            };
        }
        header.onclick = () => {
            const nowOpen = !g.classList.contains('is-open');
            g.classList.toggle('is-open', nowOpen);
            if (nowOpen) groupOpen.add(avatar);
            else groupOpen.delete(avatar);
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

    const meta1 = [
        msgCount !== null ? `<span class="cv-meta">${ICONS.msg} ${msgCount} 条</span>` : '',
        sizeStr ? `<span class="cv-meta">${ICONS.file} ${escapeHtml(sizeStr)}</span>` : '',
        timeStr ? `<span class="cv-meta">${ICONS.clock} ${escapeHtml(timeStr)}</span>` : '',
    ].filter(Boolean).join('');

    const tagsHtml = tags.length
        ? `<span class="cv-meta-sep"></span><div class="cv-tags">${tags.map(t => `<span class="cv-tag">${highlight(t, searchQuery)}</span>`).join('')}</div>`
        : '';

    // 第二行小字：角色名（在「按角色」/「当前角色」tab 隐藏）
    const subLine = hideCharName ? '' : `
        <div class="cv-card-subline">
            <span class="cv-character">${highlight(character.name || '', searchQuery)}</span>
        </div>
    `;

    const active = isActiveChat(character, chat.file_name);
    const activeBadge = active ? `<span class="cv-active-badge" title="正在使用">使用中</span>` : '';
    const jumpLabel = active ? '已打开' : '继续';

    return `
        <div class="cv-card ${active ? 'is-active' : ''}" data-avatar="${escapeHtml(character.avatar)}" data-file="${escapeHtml(chat.file_name)}">
            <img class="cv-card-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt="" />
            <div class="cv-card-main">
                <div class="cv-card-row">
                    <div class="cv-card-titleblock">
                        <h3 class="cv-title ${titleClass}">${activeBadge}${highlight(displayTitle, searchQuery)}</h3>
                        ${subLine}
                    </div>
                    <div class="cv-actions">
                        <button class="cv-act cv-star ${starred ? 'is-on' : ''}" data-act="star" title="收藏">${ICONS.star}</button>
                        <button class="cv-act" data-act="edit" title="编辑标题/标签">${ICONS.edit}</button>
                        <button class="cv-act cv-act-delete" data-act="delete" title="删除">${ICONS.trash}</button>
                        <span class="cv-act-divider"></span>
                        <button class="cv-act cv-act-jump ${active ? 'is-active' : ''}" data-act="open" title="跳转到此聊天"><span>${jumpLabel}</span>${ICONS.jump}</button>
                    </div>
                </div>
                <div class="cv-meta-row">
                    ${meta1}
                    ${tagsHtml}
                </div>
                <div class="cv-preview is-loading" data-preview="1">加载预览中…</div>
                <div class="cv-fold">
                    <button class="cv-fold-btn cv-fold-primary" data-act="reader" type="button">${ICONS.book}<span>阅读模式</span></button>
                    <button class="cv-fold-btn" data-act="rules" type="button">${ICONS.gear}<span>摘取规则</span></button>
                    <button class="cv-fold-btn" data-act="export" type="button">${ICONS.download}<span>导出</span></button>
                </div>
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
                    if (activeTab === 'favorites' && !on) render();
                } else if (act === 'edit') {
                    openEditModal(character, fileName);
                } else if (act === 'delete') {
                    handleDelete(character, fileName);
                } else if (act === 'open') {
                    jumpToChat(character, fileName);
                }
            };
        });

        // 折叠区按钮
        card.querySelectorAll('.cv-fold-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const act = btn.dataset.act;
                if (act === 'reader') enterReader(character, fileName);
                else if (act === 'rules') openRulesModal();
                else if (act === 'export') openExportModal(character, fileName);
            };
        });

        // 点卡片主体（避开按钮/预览区/折叠区）→ 切换折叠
        card.querySelector('.cv-card-main').onclick = (e) => {
            if (e.target.closest('.cv-actions')) return;
            if (e.target.closest('.cv-fold')) return;
            // 同一时刻只展开一个：把别的关掉
            const open = !card.classList.contains('is-folded-open');
            document.querySelectorAll('.cv-card.is-folded-open').forEach(c => {
                if (c !== card) c.classList.remove('is-folded-open');
            });
            card.classList.toggle('is-folded-open', open);
        };
    });

    // 当前正在使用的卡片：默认展开折叠区
    const active = document.querySelector('.cv-card.is-active');
    if (active) active.classList.add('is-folded-open');
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
 *  导出 / 导入
 * ============================================================ */

// 拉一份完整聊天数组：[metadata, ...messages]
async function fetchFullChat(character, fileName) {
    const bodies = [
        { ch_name: character.name, file_name: stripExt(fileName), avatar_url: character.avatar, force: true },
        { avatar_url: character.avatar, file_name: withExt(fileName), force: true },
        { ch_name: character.name, file_name: stripExt(fileName), avatar_url: character.avatar },
    ];
    for (const body of bodies) {
        try {
            const res = await fetch('/api/chats/get', {
                method: 'POST', headers: headers(), body: JSON.stringify(body),
            });
            if (!res.ok) continue;
            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data?.chat || []);
            if (arr.length) return arr;
        } catch { /* try next */ }
    }
    throw new Error('无法读取聊天内容');
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 按设置剥离 message text（删掉指定标签包裹的内容）
function applyStripping(text, strip) {
    if (typeof text !== 'string' || !text) return text || '';
    if (!strip) return text;
    let out = text;
    if (strip.thinking) out = out.replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '');
    if (strip.think)    out = out.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '');
    if (strip.htmlComment) out = out.replace(/<!--[\s\S]*?-->/g, '');
    if (strip.recall)      out = out.replace(/<recall[^>]*>[\s\S]*?<\/recall>/gi, '');
    if (strip.supplement)  out = out.replace(/<supplement[^>]*>[\s\S]*?<\/supplement>/gi, '');
    // 自闭合占位标签 <StatusPlaceHolderImpl/>、<MemoryCard ... /> 等（PascalCase 开头，避免误伤 <br/> <img/>）
    if (strip.selfClosing) out = out.replace(/<[A-Z][A-Za-z0-9_-]*\b[^>]*\/\s*>/g, '');
    // markdown 标题行：### 正文 / ## 思考 等（整行去掉）
    if (strip.mdHeaders)   out = out.replace(/^[ \t]*#{1,6}[ \t]+.*$/gm, '');
    if (Array.isArray(strip.custom)) {
        for (const pair of strip.custom) {
            if (!pair || !pair.open || !pair.close) continue;
            const re = new RegExp(escapeRegex(pair.open) + '[\\s\\S]*?' + escapeRegex(pair.close), 'g');
            out = out.replace(re, '');
        }
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

// 按设置提取 message text（只保留指定标签包裹的内容；都没匹配到就返回原文）
function applyExtraction(text, extract) {
    if (typeof text !== 'string' || !text) return text || '';
    if (!extract) return text;
    const tags = [];
    if (extract.content)   tags.push({ open: '<content>',      close: '</content>'      });
    if (extract.reply)     tags.push({ open: '<reply>',        close: '</reply>'        });
    if (extract.userInput) tags.push({ open: '<本轮用户输入>', close: '</本轮用户输入>' });
    if (Array.isArray(extract.custom)) {
        for (const p of extract.custom) if (p?.open && p?.close) tags.push(p);
    }
    if (!tags.length) return text;
    const parts = [];
    for (const p of tags) {
        const re = new RegExp(escapeRegex(p.open) + '([\\s\\S]*?)' + escapeRegex(p.close), 'gi');
        let m;
        while ((m = re.exec(text)) !== null) parts.push(m[1].trim());
    }
    if (!parts.length) return text; // 没匹配到不丢原文，避免"全空"惊吓
    return parts.join('\n\n');
}

// 完整管线：先剥离再提取
function processMessageText(text, strip, extract) {
    return applyExtraction(applyStripping(text, strip), extract).trim();
}

// 极简 Markdown 行内渲染：只处理 **粗体** 和 *斜体*（同行内）
// 必须在 escapeHtml 之后调用 —— escapeHtml 不动 *，所以可以安全二次替换
// 设计取舍：跨行不识别、不支持 _ __ ` ~ 链接 等其它语法，避免误伤角色名/路径里的下划线
function mdInline(escaped) {
    return escaped
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>');
}

/* ============================================================
 *  阅读模式（面板内分页阅读全部楼层）
 * ============================================================ */
const READER_PAGE_SIZE = 30;
const readerState = {
    active: false,
    character: null,
    fileName: '',
    arr: null,            // 完整聊天数组（含 metadata）
    page: 1,
    settingsOpen: false,
};

async function enterReader(character, fileName) {
    if (!character || !fileName) return;
    // 进入阅读模式前记录列表滚动位置，退出后恢复，避免回滚到顶
    const bodyEl = document.getElementById('cv_body');
    readerState.bodyScrollBefore = bodyEl ? bodyEl.scrollTop : 0;
    readerState.active = true;
    readerState.character = character;
    readerState.fileName = fileName;
    readerState.arr = null;
    readerState.page = 1;
    // 关键：清掉上一次聊天的处理缓存，否则切换聊天还是显示旧内容
    readerState._processed = null;
    readerState._cfgSig = null;
    readerState.settingsOpen = false;
    const panel = document.getElementById('chatvault_panel');
    if (panel) panel.classList.add('cv-in-reader');
    renderReader();
    try {
        readerState.arr = await fetchFullChat(character, fileName);
    } catch (e) {
        readerState.arr = { error: e.message || String(e) };
    }
    renderReader();
}

function exitReader() {
    const saved = readerState.bodyScrollBefore || 0;
    readerState.active = false;
    readerState.arr = null;
    readerState._processed = null;
    readerState._cfgSig = null;
    readerState.settingsOpen = false;
    const panel = document.getElementById('chatvault_panel');
    if (panel) panel.classList.remove('cv-in-reader');
    render();
    // 列表 DOM 重建后恢复滚动位置（同步执行已足够，但 RAF 更稳）
    requestAnimationFrame(() => {
        const body = document.getElementById('cv_body');
        if (body) body.scrollTop = saved;
    });
}

function readerCfg() {
    const cfg = loadSettings();
    const u = { ...DEFAULT_USER_RULES, ...(cfg.userRules || {}) };
    const fs = Number(cfg.readerFontSize);
    return {
        strip:   { ...DEFAULT_STRIP,   ...(cfg.strip   || {}) },
        extract: { ...DEFAULT_EXTRACT, ...(cfg.extract || {}) },
        userRules: {
            enabled: !!u.enabled,
            strip:   { ...DEFAULT_STRIP,   ...(u.strip   || {}) },
            extract: { ...DEFAULT_EXTRACT, ...(u.extract || {}) },
        },
        pagerMode: cfg.readerPagerMode === 'always' ? 'always' : 'autoHide',
        fontSize: (Number.isFinite(fs) && fs >= 12 && fs <= 24) ? fs : 15,
        indent: !!cfg.readerIndent,
    };
}

function renderReader() {
    const body = document.getElementById('cv_body');
    if (!body) return;
    const { character, fileName, arr } = readerState;
    const meta = getMetaFor(character.avatar, fileName);
    const title = meta.customTitle || fileName;
    const avatarUrl = character.avatar ? `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}` : '';
    const cfgPre = readerCfg();

    // 悬浮覆层（按钮 + 设置面板 + 分页器都从 stage 移出，作为 cv_body 的直接子节点）
    // 这样它们才真正"悬浮"——不会随 stage 滚动消失
    const stageStyle = `--cv-reader-font-size:${cfgPre.fontSize}px`;
    const stageOpen = `<div class="cv-reader-stage" data-pager-mode="${cfgPre.pagerMode}" data-indent="${cfgPre.indent ? '1' : '0'}" style="${stageStyle}"><div class="cv-reader-column">`;
    const stageClose = `</div></div>`;
    const overlayHtml = `
        <button class="cv-reader-fab cv-reader-fab-back" id="cv_reader_back" type="button" title="返回列表">${ICONS.arrowL}</button>
        <button class="cv-reader-fab cv-reader-fab-gear" id="cv_reader_gear" type="button" title="阅读模式设置">${ICONS.gear}</button>
        <div class="cv-reader-settings" id="cv_reader_settings" hidden></div>
    `;

    if (!arr) {
        body.innerHTML = stageOpen + `<div class="cv-reader-loading">正在加载完整聊天…</div>` + stageClose + overlayHtml;
        bindReaderHeader();
        return;
    }
    if (arr.error) {
        body.innerHTML = stageOpen + `<div class="cv-empty">加载失败：${escapeHtml(arr.error)}</div>` + stageClose + overlayHtml;
        bindReaderHeader();
        return;
    }

    const cfg = cfgPre;
    const messages = arr.slice(1); // 去掉 metadata
    // user 名字：从聊天记录本身取（每条 user 消息的 m.name 就是当时的用户名）
    // metadata.user_name 经常是 'unused'，而 ctx.name1 是"当前"人设、不是这条聊天用的，会跨档串名
    // 头像：聊天文件不存 user 头像信息，无法准确还原"当时"的头像 —— 统一用首字徽章，不显示图片
    const firstUserMsg = messages.find(m => m && m.is_user);
    const recordedUserName = (firstUserMsg && firstUserMsg.name && firstUserMsg.name !== 'unused')
        ? firstUserMsg.name
        : (arr[0]?.user_name && arr[0].user_name !== 'unused' ? arr[0].user_name : '');
    const userName = recordedUserName || '你';
    const charName = character.name || arr[0]?.character_name || '角色';
    // 自定义绑定的 user 头像（仅文件名，图片走酒馆已有 /thumbnail，零附加存储）
    const boundUserAvatarFile = meta.userAvatar || '';
    const boundUserAvatarUrl = boundUserAvatarFile
        ? `/thumbnail?type=persona&file=${encodeURIComponent(boundUserAvatarFile)}`
        : '';

    // 处理 + 缓存（依赖 strip/extract/userRules 配置，不含 style）
    const cfgSig = JSON.stringify({ s: cfg.strip, e: cfg.extract, u: cfg.userRules });
    if (readerState._cfgSig !== cfgSig || !readerState._processed) {
        readerState._cfgSig = cfgSig;
        readerState._processed = messages.map((m, idx) => {
            const isUser = !!m?.is_user;
            const useUser = cfg.userRules.enabled && isUser;
            const s = useUser ? cfg.userRules.strip : cfg.strip;
            const e = useUser ? cfg.userRules.extract : cfg.extract;
            const text = (m && typeof m.mes === 'string') ? processMessageText(m.mes, s, e) : '';
            // user 名字优先用消息自身记录的 m.name（兼容多 persona 聊天），否则用文件级 userName
            const rawName = m?.name && m.name !== 'unused' ? m.name : '';
            const who = isUser ? (rawName || userName) : (rawName || charName);
            return { idx, who, is_user: isUser, text };
        });
    }
    const processed = readerState._processed;
    const total = processed.length;
    const totalPages = Math.max(1, Math.ceil(total / READER_PAGE_SIZE));
    if (readerState.page > totalPages) readerState.page = totalPages;
    const start = (readerState.page - 1) * READER_PAGE_SIZE;
    const slice = processed.slice(start, start + READER_PAGE_SIZE);

    // 顶部小标题块（章节信息 - 角色 / 标题 / 楼层范围），轻量、不抢戏
    const headInfoHtml = `
        <div class="cv-reader-headinfo">
            <img class="cv-reader-headinfo-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt=""/>
            <div class="cv-reader-headinfo-text">
                <div class="cv-reader-headinfo-char">${escapeHtml(character.name || '')}</div>
                <div class="cv-reader-headinfo-title">${escapeHtml(title)}</div>
            </div>
            <div class="cv-reader-headinfo-meta">第 ${readerState.page} / ${totalPages} 页 · 共 ${total} 楼</div>
        </div>
    `;

    const cardHtml = slice.map(m => {
        const who = escapeHtml(m.who);
        // 把消息按段落（连续换行视作分段）拆成 <p>，单换行保留为 <br>，便于首行缩进
        // 每个非空"行"包成一段，让首行缩进对每段生效（包含连续换行产生的空行也被丢弃）
        const text = m.text
            ? m.text.split(/\n+/).map(s => s.trim()).filter(Boolean)
                .map(seg => `<p class="cv-msg-p">${mdInline(escapeHtml(seg))}</p>`).join('')
              || '<span class="cv-reader-empty">（空）</span>'
            : '<span class="cv-reader-empty">（空）</span>';
        // user 头像：若聊天 meta 里绑定了 persona 文件名，走 /thumbnail（零附加存储）；否则首字徽章
        const userAvHtml = boundUserAvatarUrl
            ? `<img class="cv-reader-msg-avatar" src="${boundUserAvatarUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex'" alt=""/><div class="cv-reader-msg-avatar cv-reader-user-avatar" style="display:none">${escapeHtml((m.who||'你').slice(0,1))}</div>`
            : `<div class="cv-reader-msg-avatar cv-reader-user-avatar">${escapeHtml((m.who||'你').slice(0,1))}</div>`;
        const avHtml = m.is_user
            ? userAvHtml
            : (avatarUrl
                ? `<img class="cv-reader-msg-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt=""/>`
                : `<div class="cv-reader-msg-avatar">${escapeHtml((m.who||'C').slice(0,1))}</div>`);
        return `
            <div class="cv-reader-msg ${m.is_user ? 'is-user' : 'is-char'}">
                <div class="cv-reader-msg-head">
                    ${avHtml}
                    <span class="cv-reader-msg-who">${who}</span>
                    <span class="cv-reader-msg-floor">#${m.idx}</span>
                </div>
                <div class="cv-reader-msg-body">${text}</div>
            </div>
        `;
    }).join('');

    const pagerHtml = renderReaderPager(readerState.page, totalPages, total);
    body.innerHTML = stageOpen
        + headInfoHtml
        + `<div class="cv-reader-list">${cardHtml || '<div class="cv-empty">没有可显示的内容</div>'}</div>`
        + `<div class="cv-reader-bottom-spacer"></div>`
        + stageClose
        + overlayHtml
        + (pagerHtml ? `<div class="cv-reader-pager-wrap" data-pager-mode="${cfgPre.pagerMode}">${pagerHtml}</div>` : '');
    bindReaderHeader();
    bindReaderPager(totalPages);
    if (readerState.settingsOpen) {
        const panel = document.getElementById('cv_reader_settings');
        if (panel) { panel.hidden = false; renderReaderSettings(panel); }
    }
    const stage = body.querySelector('.cv-reader-stage');
    if (stage) stage.scrollTop = 0;
    body.scrollTop = 0;
}

function renderReaderPager(page, totalPages, total) {
    if (totalPages <= 1) return '';
    // 简洁页码：首页/上一页/<input>/下一页/末页 + 跳转
    return `
        <div class="cv-reader-pager">
            <button class="cv-pager-btn" data-go="first" ${page<=1?'disabled':''}>«</button>
            <button class="cv-pager-btn" data-go="prev"  ${page<=1?'disabled':''}>${ICONS.chevL}</button>
            <span class="cv-pager-page">第
                <input type="number" id="cv_pager_input" min="1" max="${totalPages}" value="${page}" />
                / ${totalPages} 页</span>
            <button class="cv-pager-btn" data-go="next"  ${page>=totalPages?'disabled':''}>${ICONS.chevR}</button>
            <button class="cv-pager-btn" data-go="last"  ${page>=totalPages?'disabled':''}>»</button>
            <button class="cv-pager-go" id="cv_pager_go" type="button">跳转</button>
        </div>
    `;
}

function bindReaderHeader() {
    const back = document.getElementById('cv_reader_back');
    const gear = document.getElementById('cv_reader_gear');
    const panel = document.getElementById('cv_reader_settings');
    const stage = document.querySelector('.cv-reader-stage');
    const pagerWrap = document.querySelector('.cv-reader-pager-wrap');
    // 所有"悬浮"元素 —— 自动隐藏时它们会一起淡出/出现
    const overlays = [back, gear, pagerWrap].filter(Boolean);
    if (back) back.onclick = (e) => { e.stopPropagation(); exitReader(); };
    if (gear && panel) {
        const setOpen = (open) => {
            readerState.settingsOpen = !!open;
            panel.hidden = !open;
            gear.classList.toggle('is-on', !!open);
            // v0.3.23-test: 设置面板打开时把分页器藏起来，避免与设置面板底部重叠
            if (pagerWrap) pagerWrap.classList.toggle('cv-pager-suppressed', !!open);
            if (open) renderReaderSettings(panel);
        };
        gear.onclick = (e) => {
            e.stopPropagation();
            setOpen(!readerState.settingsOpen);
        };
        panel.onclick = (e) => e.stopPropagation();
        if (stage) {
            stage.onclick = () => {
                if (readerState.settingsOpen) setOpen(false);
            };
        }
    }
    // 自动隐藏：分页器 + 返回键 + 齿轮 共用一套滚动方向逻辑
    if (stage) {
        const mode = stage.dataset.pagerMode || (pagerWrap && pagerWrap.dataset.pagerMode);
        if (mode === 'autoHide') {
            let lastY = stage.scrollTop;
            let acc = 0;
            const hide = () => overlays.forEach(el => el.classList.add('is-hidden'));
            const show = () => overlays.forEach(el => el.classList.remove('is-hidden'));
            stage.addEventListener('scroll', () => {
                const y = stage.scrollTop;
                const dy = y - lastY;
                lastY = y;
                if (Math.abs(dy) < 2) return;
                acc = (Math.sign(dy) === Math.sign(acc)) ? acc + dy : dy;
                if (acc > 24)       { hide(); acc = 0; }
                else if (acc < -24) { show(); acc = 0; }
                if (stage.scrollHeight - y - stage.clientHeight < 80) show();
                if (y < 40) show();
            }, { passive: true });
        } else {
            overlays.forEach(el => el.classList.remove('is-hidden'));
        }
    }
}

function bindReaderPager(totalPages) {
    const goTo = (p) => {
        p = Math.max(1, Math.min(totalPages, Math.floor(Number(p) || 1)));
        if (p === readerState.page) return;
        readerState.page = p;
        renderReader();
    };
    document.querySelectorAll('.cv-pager-btn').forEach(b => {
        b.onclick = () => {
            const dir = b.dataset.go;
            if (dir === 'first') goTo(1);
            else if (dir === 'last') goTo(totalPages);
            else if (dir === 'prev') goTo(readerState.page - 1);
            else if (dir === 'next') goTo(readerState.page + 1);
        };
    });
    const inp = document.getElementById('cv_pager_input');
    const goBtn = document.getElementById('cv_pager_go');
    if (goBtn) goBtn.onclick = () => goTo(inp?.value);
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter') goTo(inp.value); };
}

/* ============================================================
 *  规则编辑器（剥离/提取/user 规则）—— 阅读模式 & 导出 modal 共用
 *  Bug 修复：custom 输入框 oninput 只保存配置、不触发 repaint，
 *           避免父面板被重渲毁掉输入框 → 焦点丢失 + 输入法关闭。
 *           失焦（onblur）时再 repaint 反映规则变化。
 * ============================================================ */
function mountRulesEditor(host, opts) {
    if (!host) return;
    const px         = opts.prefix;                 // 例：'cv_r' / 'cv_x'
    const stripPath  = opts.stripPath;              // 例：['strip']
    const extractPath= opts.extractPath;            // 例：['extract']
    const userPath   = opts.userPath;               // 例：['userRules']
    const repaint    = typeof opts.repaint === 'function' ? opts.repaint : () => {};

    const getAt = (obj, path) => { let c = obj; for (const k of path) c = c?.[k]; return c; };
    const setAt = (obj, path, value) => {
        let p = obj;
        for (let i = 0; i < path.length - 1; i++) { p[path[i]] = p[path[i]] || {}; p = p[path[i]]; }
        p[path[path.length - 1]] = value;
    };
    const mutateRule = (path, isStrip, mut) => {
        const c = JSON.parse(JSON.stringify(loadSettings()));
        const base = isStrip ? DEFAULT_STRIP : DEFAULT_EXTRACT;
        const cur = { ...base, ...(getAt(c, path) || {}) };
        mut(cur);
        setAt(c, path, cur);
        saveSettings(c);
    };

    const cfg      = loadSettings();
    const strip    = { ...DEFAULT_STRIP,    ...(getAt(cfg, stripPath)   || {}) };
    const extract  = { ...DEFAULT_EXTRACT,  ...(getAt(cfg, extractPath) || {}) };
    const userR    = { ...DEFAULT_USER_RULES, ...(getAt(cfg, userPath)  || {}) };
    const ustrip   = { ...DEFAULT_STRIP,   ...(userR.strip   || {}) };
    const uextract = { ...DEFAULT_EXTRACT, ...(userR.extract || {}) };
    const sw = (id, on, label) => `
        <label class="cv-switch-row">
            <span class="cv-switch-label">${label}</span>
            <span class="cv-switch">
                <input type="checkbox" id="${id}" ${on ? 'checked' : ''}/>
                <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
            </span>
        </label>`;

    host.innerHTML = `
        <div class="cv-strip-box">
            <div class="cv-strip-title">剥离（默认 · 适用于 AI / 角色消息）</div>
            ${sw(`${px}_s_thinking`, strip.thinking,    '&lt;thinking&gt;…&lt;/thinking&gt;')}
            ${sw(`${px}_s_think`,    strip.think,       '&lt;think&gt;…&lt;/think&gt;')}
            ${sw(`${px}_s_html`,     strip.htmlComment, 'HTML 注释')}
            ${sw(`${px}_s_self`,     strip.selfClosing, '自闭合占位标签 &lt;XxxxImpl/&gt;')}
            ${sw(`${px}_s_md`,       strip.mdHeaders,   'Markdown 标题行（### 正文）')}
            <div class="cv-strip-custom-title">自定义剥离对</div>
            <div id="${px}_s_list"></div>
            <button class="cv-btn cv-strip-add" id="${px}_s_add" type="button">+ 添加</button>
        </div>
        <div class="cv-strip-box">
            <div class="cv-strip-title">
                提取（只保留这些标签内的内容）
                <button class="cv-info-btn" type="button" id="${px}_e_info" title="点击查看说明">!</button>
            </div>
            <div class="cv-info-tip" id="${px}_e_info_tip" hidden>
                <b>提取功能注意</b>：开启后，正文必须被对应标签完整包裹（例：<code>&lt;content&gt;…&lt;/content&gt;</code>），否则——<br>
                · 如果原文没有用对应标签包裹正文，该消息将显示为空；<br>
                · 如果包裹错误（标签未闭合），同样为空。<br>
                正文消失时请关闭提取，或确认标签格式一致。
            </div>
            ${sw(`${px}_e_content`, extract.content, '&lt;content&gt;…&lt;/content&gt;')}
            ${sw(`${px}_e_reply`,   extract.reply,   '&lt;reply&gt;…&lt;/reply&gt;')}
            <div class="cv-strip-custom-title">自定义提取对</div>
            <div id="${px}_e_list"></div>
            <button class="cv-btn cv-strip-add" id="${px}_e_add" type="button">+ 添加</button>
        </div>
        <div class="cv-strip-box cv-user-rules-box">
            <label class="cv-switch-row">
                <span class="cv-switch-label"><b>user 消息单独规则</b></span>
                <span class="cv-switch">
                    <input type="checkbox" id="${px}_u_enabled" ${userR.enabled?'checked':''}/>
                    <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
                </span>
            </label>
            <div class="cv-field-hint">开启后，user 消息按下面这组规则处理（覆盖默认规则）。</div>
            <div class="cv-user-rules-body" ${userR.enabled?'':'hidden'}>
                <div class="cv-strip-subbox">
                    <div class="cv-strip-subtitle">user · 剥离</div>
                    ${sw(`${px}_us_recall`,     ustrip.recall,     '&lt;recall&gt;…&lt;/recall&gt;')}
                    ${sw(`${px}_us_supplement`, ustrip.supplement, '&lt;supplement&gt;…&lt;/supplement&gt;')}
                    <div class="cv-strip-custom-title">自定义剥离对</div>
                    <div id="${px}_us_list"></div>
                    <button class="cv-btn cv-strip-add" id="${px}_us_add" type="button">+ 添加</button>
                </div>
                <div class="cv-strip-subbox">
                    <div class="cv-strip-subtitle">user · 提取</div>
                    ${sw(`${px}_ue_userInput`, uextract.userInput, '&lt;本轮用户输入&gt;…&lt;/本轮用户输入&gt;')}
                    <div class="cv-strip-custom-title">自定义提取对</div>
                    <div id="${px}_ue_list"></div>
                    <button class="cv-btn cv-strip-add" id="${px}_ue_add" type="button">+ 添加</button>
                </div>
            </div>
        </div>
    `;

    // —— 自定义对列表渲染 + 输入处理（修好的：oninput 只保存，onblur 才 repaint）——
    const renderList = (listId, addBtnId, path, isStrip) => {
        const list = host.querySelector('#' + listId);
        if (!list) return;
        const cur = (getAt(loadSettings(), path) || {}).custom || [];
        list.innerHTML = cur.map((p, i) => `
            <div class="cv-strip-pair" data-i="${i}">
                <input type="text" class="cv-strip-open"  placeholder="前 tag" value="${escapeHtml(p.open || '')}"/>
                <input type="text" class="cv-strip-close" placeholder="后 tag" value="${escapeHtml(p.close || '')}"/>
                <button class="cv-strip-del" type="button">×</button>
            </div>
        `).join('') || '<div class="cv-field-hint">（暂无）</div>';
        list.querySelectorAll('.cv-strip-pair').forEach(row => {
            const i = Number(row.dataset.i);
            const openEl  = row.querySelector('.cv-strip-open');
            const closeEl = row.querySelector('.cv-strip-close');
            // 关键：只保存配置，不触发 repaint —— 否则上层重渲会销毁本输入框，
            // 导致光标跳走、中文输入法被强制关闭、面板回滚到顶部。
            const saveOnly = () => {
                mutateRule(path, isStrip, r => {
                    const arr = (r.custom || []).slice();
                    arr[i] = { open: openEl.value, close: closeEl.value };
                    r.custom = arr;
                });
            };
            // 失焦时让外部重排正文。延迟到下一个事件循环，
            // 避免 blur 同步重渲 DOM 把刚刚触发 blur 的那个 click（删/加/开关）吞掉。
            // 关键：仅在 focus 时和 blur 时值不同才 repaint —— 否则只是
            // "点了一下框又点回屏幕"也会触发重渲，阅读模式下导致正文回顶。
            let focusVal = '';
            const onFocus = (el) => () => { focusVal = el.value; };
            const onBlur = (el) => () => {
                if (el.value === focusVal) return;
                setTimeout(repaint, 0);
            };
            openEl.oninput  = saveOnly; openEl.onfocus  = onFocus(openEl);  openEl.onblur  = onBlur(openEl);
            closeEl.oninput = saveOnly; closeEl.onfocus = onFocus(closeEl); closeEl.onblur = onBlur(closeEl);
            row.querySelector('.cv-strip-del').onclick = () => {
                mutateRule(path, isStrip, r => { r.custom = (r.custom || []).filter((_, k) => k !== i); });
                renderList(listId, addBtnId, path, isStrip);
                repaint();
            };
        });
        const addBtn = host.querySelector('#' + addBtnId);
        if (addBtn) addBtn.onclick = () => {
            mutateRule(path, isStrip, r => { r.custom = [...((r.custom)||[]), { open:'', close:'' }]; });
            renderList(listId, addBtnId, path, isStrip);
            // 不 repaint —— 等用户填完失焦再重排
            const newRow = list.querySelector(`.cv-strip-pair[data-i="${(((getAt(loadSettings(), path) || {}).custom || []).length - 1)}"]`);
            const firstInput = newRow && newRow.querySelector('.cv-strip-open');
            if (firstInput) firstInput.focus();
        };
    };
    renderList(`${px}_s_list`,  `${px}_s_add`,  stripPath,                true);
    renderList(`${px}_e_list`,  `${px}_e_add`,  extractPath,              false);
    renderList(`${px}_us_list`, `${px}_us_add`, [...userPath, 'strip'],   true);
    renderList(`${px}_ue_list`, `${px}_ue_add`, [...userPath, 'extract'], false);

    // —— 开关组 ——
    const flagMap = [
        [`${px}_s_thinking`,    stripPath,                'thinking',    true],
        [`${px}_s_think`,       stripPath,                'think',       true],
        [`${px}_s_html`,        stripPath,                'htmlComment', true],
        [`${px}_s_self`,        stripPath,                'selfClosing', true],
        [`${px}_s_md`,          stripPath,                'mdHeaders',   true],
        [`${px}_e_content`,     extractPath,              'content',     false],
        [`${px}_e_reply`,       extractPath,              'reply',       false],
        [`${px}_us_recall`,     [...userPath, 'strip'],   'recall',      true],
        [`${px}_us_supplement`, [...userPath, 'strip'],   'supplement',  true],
        [`${px}_ue_userInput`,  [...userPath, 'extract'], 'userInput',   false],
    ];
    flagMap.forEach(([id, path, k, isStrip]) => {
        const el = host.querySelector('#' + id);
        if (!el) return;
        el.onchange = () => {
            mutateRule(path, isStrip, r => { r[k] = el.checked; });
            repaint();
        };
    });

    // user 总开关
    const userToggle = host.querySelector('#' + px + '_u_enabled');
    if (userToggle) userToggle.onchange = () => {
        const c = JSON.parse(JSON.stringify(loadSettings()));
        const cur = { ...DEFAULT_USER_RULES, ...(getAt(c, userPath) || {}) };
        cur.enabled = userToggle.checked;
        setAt(c, userPath, cur);
        saveSettings(c);
        const body = host.querySelector('.cv-user-rules-body');
        if (body) body.hidden = !userToggle.checked;
        repaint();
    };

    // 提取说明气泡
    const eInfo = host.querySelector('#' + px + '_e_info');
    const eTip  = host.querySelector('#' + px + '_e_info_tip');
    if (eInfo && eTip) eInfo.onclick = () => { eTip.hidden = !eTip.hidden; };
}

function renderReaderSettings(panel) {
    const cfg = loadSettings();
    // 当前聊天的 user 头像绑定
    const rChar = readerState.character || {};
    const rFile = readerState.fileName || '';
    const rMeta = (rChar.avatar && rFile) ? getMetaFor(rChar.avatar, rFile) : {};
    const boundUA = rMeta.userAvatar || '';
    // 探测酒馆的 personas 列表（多路径兜底，因为不同酒馆版本字段名不同）
    let personas = {};   // { filename: displayName }
    let curPersonaFile = '';
    try {
        const ctx = SillyTavern?.getContext?.() || {};
        const pu = ctx.powerUserSettings || ctx.power_user || globalThis.power_user || {};
        personas = pu.personas || ctx.personas || {};
        curPersonaFile = ctx.user_avatar || ctx.userAvatar || pu.user_avatar || globalThis.user_avatar || '';
    } catch {}
    const personaEntries = Object.entries(personas || {});
    const sw = (id, on, label) => `
        <label class="cv-switch-row">
            <span class="cv-switch-label">${label}</span>
            <span class="cv-switch">
                <input type="checkbox" id="${id}" ${on ? 'checked' : ''}/>
                <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
            </span>
        </label>`;
    const curTheme = THEMES.some(t => t.id === cfg.theme) ? cfg.theme : 'dark';
    const curPager = cfg.readerPagerMode === 'always' ? 'always' : 'autoHide';
    panel.innerHTML = `
        <div class="cv-reader-settings-header">
            <span class="cv-reader-settings-title">阅读模式设置</span>
            <button class="cv-reader-settings-close" id="cv_r_close" type="button" title="关闭">×</button>
        </div>
        <div class="cv-reader-settings-body">
            <div class="cv-strip-box">
                <div class="cv-strip-title">配色方案</div>
                <div class="cv-reader-style-row">
                    ${THEMES.map(t => `
                        <label class="cv-reader-style-opt ${curTheme===t.id?'is-on':''}">
                            <input type="radio" name="cv_r_theme" value="${t.id}" ${curTheme===t.id?'checked':''}/>
                            <span class="cv-reader-style-name">${escapeHtml(t.name)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="cv-strip-box">
                <div class="cv-strip-title">悬浮按钮 · 分页器显示</div>
                <div class="cv-field-hint">控制返回键、齿轮、跳转分页器三个悬浮元素的可见行为。</div>
                <div class="cv-reader-style-row">
                    <label class="cv-reader-style-opt ${curPager==='autoHide'?'is-on':''}">
                        <input type="radio" name="cv_r_pager" value="autoHide" ${curPager==='autoHide'?'checked':''}/>
                        <span class="cv-reader-style-name">滚动自动隐藏</span>
                        <span class="cv-reader-style-desc">下滑藏 · 上滑出 · 触底显</span>
                    </label>
                    <label class="cv-reader-style-opt ${curPager==='always'?'is-on':''}">
                        <input type="radio" name="cv_r_pager" value="always" ${curPager==='always'?'checked':''}/>
                        <span class="cv-reader-style-name">常驻可见</span>
                        <span class="cv-reader-style-desc">始终悬浮显示</span>
                    </label>
                </div>
            </div>
            <div class="cv-strip-box">
                <div class="cv-strip-title">正文字号</div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_fontsize" min="13" max="22" step="0.5" value="${cfg.readerFontSize || 15}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_fontsize_val">${cfg.readerFontSize || 15}px</span>
                </div>
                ${sw('cv_r_indent', !!cfg.readerIndent, '段落首行缩进 2 字')}
            </div>
            <div class="cv-strip-box">
                <div class="cv-strip-title">
                    user 头像（仅本聊天）
                    <button class="cv-info-btn" type="button" id="cv_r_ua_info" title="点击查看说明">!</button>
                </div>
                <div class="cv-info-tip" id="cv_r_ua_info_tip" hidden>
                    聊天文件不记录 user 头像，无法准确还原"当时"的头像。可以从下方酒馆已有 persona 中选一个绑定到本聊天，仅在阅读模式显示。<br>
                    <b>不会拷贝任何图片</b>，只在 meta 里存一个文件名字符串。换 persona 不影响其它聊天的绑定。
                </div>
                ${personaEntries.length ? `
                    <div class="cv-field-hint">点选要绑定的 persona（再次点选当前选中项即可解绑）：</div>
                    <div class="cv-ua-grid">
                        <label class="cv-ua-opt cv-ua-opt-none ${!boundUA?'is-on':''}" data-file="">
                            <div class="cv-ua-opt-img cv-ua-opt-none-icon">∅</div>
                            <span class="cv-ua-opt-name">无</span>
                        </label>
                        ${personaEntries.map(([file, name]) => `
                            <label class="cv-ua-opt ${boundUA===file?'is-on':''}" data-file="${escapeHtml(file)}" title="${escapeHtml(name||file)}">
                                <img class="cv-ua-opt-img" src="/thumbnail?type=persona&file=${encodeURIComponent(file)}" alt="" onerror="this.style.visibility='hidden'"/>
                                <span class="cv-ua-opt-name">${escapeHtml(name||file)}${file===curPersonaFile ? ' ·当前' : ''}</span>
                            </label>
                        `).join('')}
                    </div>
                ` : `
                    <div class="cv-field-hint">未能从酒馆读取 persona 列表。请手动输入 <code>User Avatars</code> 目录下的图片文件名（如 <code>user-default.png</code>）：</div>
                    <div class="cv-ua-manual">
                        <input type="text" id="cv_r_ua_input" placeholder="user-default.png" value="${escapeHtml(boundUA)}"/>
                        <button class="cv-btn" id="cv_r_ua_apply" type="button">绑定</button>
                        <button class="cv-btn cv-btn-danger" id="cv_r_ua_clear" type="button" ${boundUA?'':'disabled'}>解绑</button>
                    </div>
                    <div class="cv-field-hint" style="margin-top:6px">当前已绑定：${boundUA ? `<code>${escapeHtml(boundUA)}</code>` : '（无）'}</div>
                `}
            </div>
            <div class="cv-reader-settings-hint">摘取规则已搬到主面板每张卡片折叠区的「摘取规则」按钮，阅读 / 导出共用一套</div>
        </div>
    `;

    panel.querySelectorAll('input[name="cv_r_theme"]').forEach(r => {
        r.onchange = () => {
            if (!r.checked) return;
            const c = loadSettings();
            saveSettings({ ...c, theme: r.value });
            const root = document.getElementById('chatvault_panel');
            if (root) root.className = currentThemeClass() + (readerState.active ? ' cv-in-reader' : '');
            panel.querySelectorAll('input[name="cv_r_theme"]').forEach(x => {
                x.closest('.cv-reader-style-opt')?.classList.toggle('is-on', x.checked);
            });
        };
    });
    panel.querySelectorAll('input[name="cv_r_pager"]').forEach(r => {
        r.onchange = () => {
            if (!r.checked) return;
            const c = loadSettings();
            saveSettings({ ...c, readerPagerMode: r.value === 'always' ? 'always' : 'autoHide' });
            renderReader();
        };
    });

    // 字号滑块（实时调整 stage 上的 CSS 变量，无需重排）
    const fsInput = document.getElementById('cv_r_fontsize');
    const fsVal   = document.getElementById('cv_r_fontsize_val');
    if (fsInput) {
        const apply = (save) => {
            const v = Number(fsInput.value) || 15;
            if (fsVal) fsVal.textContent = v + 'px';
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.style.setProperty('--cv-reader-font-size', v + 'px');
            if (save) {
                const c = loadSettings();
                saveSettings({ ...c, readerFontSize: v });
            }
        };
        fsInput.oninput  = () => apply(false);
        fsInput.onchange = () => apply(true);
    }
    // 首行缩进开关
    const indentSw = document.getElementById('cv_r_indent');
    if (indentSw) indentSw.onchange = () => {
        const c = loadSettings();
        saveSettings({ ...c, readerIndent: indentSw.checked });
        const stage = document.querySelector('.cv-reader-stage');
        if (stage) stage.dataset.indent = indentSw.checked ? '1' : '0';
    };

    // 提取功能的"!"说明按钮 → 切换展开 tip
    const bindInfoToggle = (btnId, tipId) => {
        const b = document.getElementById(btnId);
        const t = document.getElementById(tipId);
        if (!b || !t) return;
        b.onclick = (e) => {
            e.stopPropagation();
            t.hidden = !t.hidden;
            b.classList.toggle('is-on', !t.hidden);
        };
    };
    bindInfoToggle('cv_r_e_info',  'cv_r_e_info_tip');
    bindInfoToggle('cv_r_ua_info', 'cv_r_ua_info_tip');

    // user 头像：网格点选 / 手动输入
    const applyUA = (file) => {
        if (!rChar.avatar || !rFile) return;
        patchMetaFor(rChar.avatar, rFile, { userAvatar: file || '' });
        renderReader();   // 重渲染：会重画 stage、然后重新打开设置面板
    };
    panel.querySelectorAll('.cv-ua-opt').forEach(opt => {
        opt.onclick = (e) => {
            e.preventDefault();   // label 点击不触发任何隐藏 input
            e.stopPropagation();
            const file = opt.dataset.file || '';
            // 再次点选当前已选项 = 解绑
            if (file === boundUA) applyUA('');
            else applyUA(file);
        };
    });
    const uaApply = document.getElementById('cv_r_ua_apply');
    const uaInput = document.getElementById('cv_r_ua_input');
    const uaClear = document.getElementById('cv_r_ua_clear');
    if (uaApply && uaInput) uaApply.onclick = () => applyUA(uaInput.value.trim());
    if (uaClear) uaClear.onclick = () => applyUA('');

    // × 关闭按钮
    const closeBtn = document.getElementById('cv_r_close');
    if (closeBtn) closeBtn.onclick = (e) => {
        e.stopPropagation();
        readerState.settingsOpen = false;
        panel.hidden = true;
        const gear = document.getElementById('cv_reader_gear');
        if (gear) gear.classList.remove('is-on');
        // v0.3.23-test: 关闭设置 → 让分页器恢复
        const pw = document.querySelector('.cv-reader-pager-wrap');
        if (pw) pw.classList.remove('cv-pager-suppressed');
    };
}

function getCurrentChatFileName() {
    try {
        const ctx = SillyTavern.getContext();
        let id = ctx.chatId;
        if (!id && typeof ctx.getCurrentChatId === 'function') id = ctx.getCurrentChatId();
        return id ? stripExt(String(id)) : null;
    } catch { return null; }
}
function isActiveChat(character, fileName) {
    const cur = getCurrentCharacter();
    if (!cur || cur.avatar !== character.avatar) return false;
    const cid = getCurrentChatFileName();
    return !!cid && stripExt(fileName) === cid;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
}

async function exportChatJsonl(character, fileName) {
    setStatus('正在导出 jsonl…');
    try {
        const arr = await fetchFullChat(character, fileName);
        const text = arr.map(o => JSON.stringify(o)).join('\n') + '\n';
        const safeName = stripExt(fileName).replace(/[\\/:*?"<>|]/g, '_');
        downloadBlob(new Blob([text], { type: 'application/x-jsonlines' }), `${safeName}.jsonl`);
        setStatus('✓ 已导出 jsonl');
    } catch (e) {
        setStatus(`❌ 导出失败: ${e.message}`);
        toastr.error(`导出失败: ${e.message}`);
    }
}

async function exportChatTxt(character, fileName) {
    setStatus('正在导出 txt…');
    try {
        const arr = await fetchFullChat(character, fileName);
        // 用 txt 导出专属规则（与阅读模式独立）：cfg.strip / cfg.extract / cfg.userRules
        const cfg = loadSettings();
        const strip    = { ...DEFAULT_STRIP,    ...(cfg.strip   || {}) };
        const extract  = { ...DEFAULT_EXTRACT,  ...(cfg.extract || {}) };
        const u        = { ...DEFAULT_USER_RULES, ...(cfg.userRules || {}) };
        const ustrip   = { ...DEFAULT_STRIP,   ...(u.strip   || {}) };
        const uextract = { ...DEFAULT_EXTRACT, ...(u.extract || {}) };
        const meta = arr[0] || {};
        // user 名字优先取首条 user 消息的 m.name（与阅读模式一致），避免跨档串名
        const firstUserMsg = arr.find(m => m && m.is_user);
        const recordedUserName = (firstUserMsg && firstUserMsg.name && firstUserMsg.name !== 'unused')
            ? firstUserMsg.name
            : (meta.user_name && meta.user_name !== 'unused' ? meta.user_name : '');
        const userName = recordedUserName || '用户';
        const charName = character.name || meta.character_name || '角色';
        const lines = [`# ${charName} × ${userName}`, `# 来源: ${withExt(fileName)}`, ''];
        for (let i = 1; i < arr.length; i++) {
            const m = arr[i];
            if (!m || typeof m.mes !== 'string') continue;
            const isUser = !!m.is_user;
            const useUser = u.enabled && isUser;
            const s = useUser ? ustrip   : strip;
            const e = useUser ? uextract : extract;
            const who = isUser
                ? (m.name && m.name !== 'unused' ? m.name : userName)
                : (m.name || charName);
            const cleaned = processMessageText(m.mes, s, e);
            if (!cleaned) continue;
            lines.push(`【${who}】`);
            lines.push(cleaned);
            lines.push('');
        }
        const safeName = stripExt(fileName).replace(/[\\/:*?"<>|]/g, '_');
        downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${safeName}.txt`);
        setStatus('✓ 已导出 txt');
    } catch (e) {
        setStatus(`❌ 导出失败: ${e.message}`);
        toastr.error(`导出失败: ${e.message}`);
    }
}

async function importChatToCharacter(character, file) {
    if (!character?.avatar) { toastr.error('当前没有选中角色'); return; }
    if (!file) return;
    const isJsonl = /\.jsonl$/i.test(file.name);
    if (!isJsonl) {
        toastr.error('只支持 .jsonl 文件（酒馆原生格式）');
        return;
    }
    setStatus('正在导入…');
    try {
        const ctx = SillyTavern.getContext();
        const userName = ctx.name1 || ctx.user?.name || 'User';
        const fd = new FormData();
        fd.append('avatar_url', character.avatar);
        fd.append('file_type', 'jsonl');
        fd.append('user_name', userName);
        fd.append('avatar', file, file.name);   // ST 历史上字段名是 'avatar'
        fd.append('file', file, file.name);     // 兜底也带一个 'file'

        const reqHeaders = headers();
        // multipart 不能手动设 Content-Type
        delete reqHeaders['Content-Type'];
        delete reqHeaders['content-type'];

        const res = await fetch('/api/chats/import', { method: 'POST', headers: reqHeaders, body: fd });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
        }
        toastr.success(`已导入到「${character.name || '当前角色'}」`);
        setStatus('✓ 已导入');
        // 刷新该角色的聊天列表
        await reloadCharacterChats(character);
        render();
    } catch (e) {
        console.error('[ChatVault] 导入失败', e);
        setStatus(`❌ 导入失败: ${e.message}`);
        toastr.error(`导入失败: ${e.message}`);
    }
}

async function reloadCharacterChats(character) {
    try {
        const res = await fetch('/api/characters/chats', {
            method: 'POST', headers: headers(),
            body: JSON.stringify({ avatar_url: character.avatar }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data ? Object.values(data) : []);
        chatsByAvatar[character.avatar] = list;
    } catch { /* 忽略 */ }
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
            <button class="cv-modal-close" id="cv_m_close" type="button" title="关闭">${ICONS.close}</button>
            <h3>编辑聊天信息</h3>
            <div class="cv-modal-body">
                <div class="cv-field">
                    <label>自定义标题</label>
                    <input type="text" id="cv_m_title" value="${escapeHtml(customTitle)}" placeholder="例如：咖啡馆初遇" />
                    <div class="cv-field-hint">仅本机显示，不会修改聊天文件本身</div>
                </div>
                <div class="cv-field">
                    <label>标签（用逗号分隔）</label>
                    <input type="text" id="cv_m_tags" value="${escapeHtml(tags.join(', '))}" placeholder="例如：史诗, 现代AU, 重要" />
                </div>
                <div class="cv-field">
                    <label>原始文件名</label>
                    <input type="text" id="cv_m_file" value="${escapeHtml(fileName)}" />
                    <div class="cv-field-hint">修改这里会真正在服务器上重命名文件</div>
                </div>
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

    document.getElementById('cv_m_close').onclick = closeModal;
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
 *  导出 modal （jsonl 原始 / txt 走自己的摘取规则）
 * ============================================================ */

function openExportModal(character, fileName) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal cv-modal-wide" onclick="event.stopPropagation()">
            <button class="cv-modal-close" id="cv_x_close" type="button" title="关闭">${ICONS.close}</button>
            <h3>导出聊天</h3>
            <div class="cv-modal-body">
                <div class="cv-export-grid">
                    <button class="cv-export-card" id="cv_x_jsonl" type="button">
                        <span class="cv-export-card-icon">${ICONS.download}</span>
                        <span class="cv-export-card-title">jsonl</span>
                        <span class="cv-export-card-desc">原始数据，原样导出，可重新导入到酒馆</span>
                    </button>
                    <button class="cv-export-card" id="cv_x_txt" type="button">
                        <span class="cv-export-card-icon">${ICONS.download}</span>
                        <span class="cv-export-card-title">txt</span>
                        <span class="cv-export-card-desc">纯文本，按当前的"摘取规则"处理</span>
                    </button>
                </div>
                <div class="cv-export-hint">txt 按当前的「摘取规则」处理；要改规则请到主面板卡片折叠区点「摘取规则」</div>
            </div>
            <div class="cv-modal-actions">
                <button class="cv-btn" id="cv_x_cancel">关闭</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    document.getElementById('cv_x_close').onclick = closeModal;
    document.getElementById('cv_x_cancel').onclick = closeModal;
    document.getElementById('cv_x_jsonl').onclick = () => { exportChatJsonl(character, fileName); closeModal(); };
    document.getElementById('cv_x_txt').onclick   = () => { exportChatTxt(character, fileName);   closeModal(); };
}

/* ============================================================
 *  摘取规则 modal（独立窗口；阅读 / 导出共用同一套规则）
 *  独立 modal 的好处：编辑过程中不会触发任何外部组件重渲染，
 *  从根本上避免阅读模式下「改规则正文+设置一起回顶」的 bug
 * ============================================================ */

function openRulesModal() {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal cv-modal-wide" onclick="event.stopPropagation()">
            <button class="cv-modal-close" id="cv_rules_close" type="button" title="关闭">${ICONS.close}</button>
            <h3>摘取规则</h3>
            <div class="cv-modal-body">
                <div class="cv-rules-modal-hint">阅读模式与导出 txt 共用此套规则；改完会即时保存，下次打开阅读模式或导出时生效</div>
                <div id="cv_rules_holder"></div>
            </div>
            <div class="cv-modal-actions">
                <button class="cv-btn" id="cv_rules_done">完成</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    document.getElementById('cv_rules_close').onclick = closeModal;
    document.getElementById('cv_rules_done').onclick = closeModal;
    // 独立 modal：repaint 留空，规则改动不会触发任何外部 DOM 重渲染
    mountRulesEditor(document.getElementById('cv_rules_holder'), {
        prefix: 'cv_rules',
        stripPath: ['strip'],
        extractPath: ['extract'],
        userPath: ['userRules'],
        repaint: () => {},
    });
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
    btn.innerHTML = `<i class="fa-solid fa-book extensionsMenuExtensionButton"></i><span>聊天档案</span>`;
    btn.onclick = openPanel;

    const extMenu = document.getElementById('extensionsMenu');
    if (extMenu) { extMenu.appendChild(btn); return; }

    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#333;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;';
    document.body.appendChild(btn);
}

function removeButton() {
    document.getElementById('chatvault_open_btn')?.remove();
}

function applyEnabledState() {
    const s = loadSettings();
    if (s.enabled) injectButton();
    else {
        removeButton();
        if (panelEl) closePanel();
    }
}

/* ============================================================
 *  扩展设置面板（嵌入 ST「扩展」页）
 * ============================================================ */

function injectSettings() {
    const host = document.getElementById('extensions_settings2')
              || document.getElementById('extensions_settings');
    if (!host || document.getElementById('chatvault_settings')) return;

    const s = loadSettings();
    const wrap = document.createElement('div');
    wrap.id = 'chatvault_settings';
    wrap.className = 'extension_container interactable';
    wrap.innerHTML = `
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>聊天档案 (ChatVault)</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="cv-settings-row">
            <label class="checkbox_label" for="cv_set_enabled">
              <input type="checkbox" id="cv_set_enabled" ${s.enabled ? 'checked' : ''}>
              <span>启用入口按钮（在扩展菜单里显示「聊天档案」）</span>
            </label>
          </div>
          <div class="cv-settings-row">
            <label for="cv_set_theme">配色方案：</label>
            <select id="cv_set_theme">
              ${THEMES.map(t => `<option value="${t.id}" ${s.theme === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="cv-settings-hint">
            v${VERSION} · 设置实时生效，主题切换会立即应用到已打开的面板。
          </div>
        </div>
      </div>
    `;
    host.appendChild(wrap);

    wrap.querySelector('#cv_set_enabled').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, enabled: !!e.target.checked });
        applyEnabledState();
    });
    wrap.querySelector('#cv_set_theme').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, theme: e.target.value });
        if (panelEl) panelEl.className = currentThemeClass();
    });
}

jQuery(async () => {
    const tryInject = () => {
        if (document.getElementById('extensionsMenu')) applyEnabledState();
        if (document.getElementById('extensions_settings2')
         || document.getElementById('extensions_settings')) injectSettings();

        if (!document.getElementById('chatvault_open_btn') && loadSettings().enabled
         || !document.getElementById('chatvault_settings')) {
            setTimeout(tryInject, 500);
        }
    };
    tryInject();
    console.log(`[ChatVault] v${VERSION} 已加载`);
});
