/**
 * SillyTavern ChatVault — 全局聊天档案管理器
 * 版本号见下方 VERSION 常量（单一事实源）
 * https://github.com/shanye5593/SillyTavern-ChatVault
 */

const VERSION = '0.6.0';
const STORAGE_KEY = 'st-chatvault-meta';
const SETTINGS_KEY = 'st-chatvault-settings';
const PAGE_SIZE = 50;
const CHAR_PAGE_SIZE = 30;   // 「按角色」tab 每页角色卡数（含 0 聊天）
const THEMES = [
    { id: 'dark',   name: '夜间 Dark' },
    { id: 'light',  name: '白底 Light' },
    { id: 'coffee', name: '咖啡 Coffee' },
    { id: 'custom', name: '自定义' },
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
    enabled: true,                            // v0.5.22 起新用户默认启用；老用户存档若为 false 则保持兼容
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
// v0.5.17/0.5.18 自定义正则默认值
const DEFAULT_CUSTOM_REGEX = { builtinFold: true, items: [] };

const DEFAULT_SETTINGS = {
    enabled: true,
    theme: 'dark',
    // 摘取规则（v0.3.14 起阅读 / 导出共用一套，从主面板卡片折叠区进入编辑）
    strip:   { ...DEFAULT_STRIP },
    extract: { ...DEFAULT_EXTRACT },
    // v0.5.17 自定义正则（仅渲染时清洗，不修改原文件；不支持酒馆 placement / depth / 宏）
    // items: [{ name, pattern, flags, replace, target: 'user'|'ai'|'both', enabled }]
    // builtinFold: 内置「通用折叠」开关，默认 ON
    customRegex: { ...DEFAULT_CUSTOM_REGEX },
    userRules: JSON.parse(JSON.stringify(DEFAULT_USER_RULES)),
    // 分页器模式: 'always' = 常驻底部, 'autoHide' = 下滑隐藏/上滑出现（同时控制悬浮按钮）
    readerPagerMode: 'autoHide',
    // 阅读模式正文字号 (px)
    readerFontSize: 15,
    // 阅读模式段落首行缩进
    readerIndent: false,
    // 阅读模式头部到正文间距 (px, 4-32)
    readerHeadGap: 14,
    // 阅读模式段落之间间距 (em, 0.2-1.5)
    readerParaGap: 0.6,
    // 阅读模式行间距 line-height (1.2-2.6, 默认 1.85)
    readerLineHeight: 1.85,
    // v0.4.2 阅读模式头部排版： 'default' | 'center' | 'dialog'
    readerLayout: 'default',
    // 自定义字体（v0.3.31 起改成多字体优先级数组：[{family, url}, ...]）
    customFonts: [],
    // 自定义配色（v0.3.32 起；只覆盖填了的字段，其它跟随主题）
    // 形如 { accent:'#34d399', bgPanel:'#212327', bgCard:'#2a2d32', text:'#e4e5e7', overlayAlpha:0.55 }
    customColors: {},
    // 桌面窗口模式（仅桌面端生效，手机端完全跳过）
    desktopPanelMode: 'modal',         // 'modal' | 'dock'：经典居中弹窗 / 左侧停靠栏
    desktopCardLayout: 'auto',         // 'auto' | 'narrow' | 'wide'：按面板宽度自动单/双列，或强制指定
    readerExpandMode: 'auto',          // 'auto' | 'off'：阅读模式是否临时展开大屏
    leftDockButton: true,              // 左侧边缘 ChatVault 快捷入口
    dockTabTop: 0.34,                  // 左侧快捷入口纵向位置（0~1，按视口高度记忆）
    windowFreeMode: false,             // 自由模式：去掉遮罩，可同时操作酒馆
    windowHotkey: false,               // 是否启用全局快捷键开关面板
    windowHotkeyCombo: 'Alt+V',        // 快捷键组合
    windowState: null,                 // 记忆位置/尺寸：{ x, y, w, h, layout, mode }；兼容旧 { x, y, scale }
    // 是否在酒馆欢迎页底部追加「聊天档案」快捷按钮（与 API 连接/角色管理/扩展程序 同排）
    welcomeButton: true,
    // v0.5.14 阅读模式增强渲染开关（表格/代码块/列表/引用/AI 内联 HTML 如 <img> <p style>）
    // 默认 ON；如果遇到大图/超长表格卡顿，可关掉退回极简模式（仅识别 *斜* **粗**）
    readerRichRender: true,
};

function loadSettings() {
    try {
        const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
        // v0.3.14 迁移：阅读 / 导出 规则合并为同一套
        if (s.readStrip || s.readExtract || s.userReadRules) {
            if (s.readStrip)      s.strip     = { ...DEFAULT_STRIP,   ...s.readStrip };
            if (s.readExtract)    s.extract   = { ...DEFAULT_EXTRACT, ...s.readExtract };
            if (s.userReadRules)  s.userRules = JSON.parse(JSON.stringify(s.userReadRules));
            // v0.5.25: 一次性清洗——v0.5.21 曾把"折叠态"写进 userRules.enabled，
            // 导致老用户存档里 enabled=false 卡死、UI 又没开关翻回来 → user 单独规则永久失效。
            // 现在彻底废弃该字段：load 时强制 true，运行路径也不再读它。
            if (s.userRules && s.userRules.enabled === false) s.userRules.enabled = true;
            delete s.readStrip; delete s.readExtract; delete s.userReadRules;
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
        }
        // v0.3.31 迁移：单字体 -> 数组
        if (!Array.isArray(s.customFonts)) s.customFonts = [];
        if (s.customFonts.length === 0 && (s.customFontFamily || s.customFontUrl)) {
            s.customFonts = [{ family: String(s.customFontFamily || ''), url: String(s.customFontUrl || '') }];
        }
        delete s.customFontFamily; delete s.customFontUrl;
        // v0.5.16 规范化：boolean 字段防御损坏 / 字符串 'false' / null / undefined 误判
        // 只把"明确 false"和"明确字符串 'false' / 数字 0"视作关；其它一律按默认 true
        const _falsey = (v) => v === false || v === 'false' || v === 0 || v === '0';
        s.readerRichRender = !_falsey(s.readerRichRender);
        return s;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}
function saveSettings(s) {
    // v0.5.24: 容错——配额耗尽 / Safari 隐私模式等场景不要让整条交互链断掉
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {
        console.error('[ChatVault] 设置保存失败（可能是存储配额已满）', e);
        try { toastr.error('设置保存失败：浏览器存储已满或被禁用'); } catch {}
    }
}
function currentThemeClass() {
    const id = loadSettings().theme;
    return THEMES.some(t => t.id === id) ? `cv-theme-${id}` : 'cv-theme-dark';
}
function applyThemeClass(el) {
    if (!el) return;
    THEMES.forEach(t => el.classList.remove(`cv-theme-${t.id}`));
    el.classList.add(currentThemeClass());
}

/* ============================================================
 *  本地元数据：收藏 / 自定义标题 / 标签
 * ============================================================ */

function loadMeta() {
    try {
        const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        // 防御：localStorage 可能被外部脚本/插件冲突写入非对象，避免后续 m[k]=... 直接崩
        if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
        return v;
    } catch {
        return {};
    }
}
function saveMeta(meta) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
    } catch (e) {
        // quota exceeded / 隐私模式 / 磁盘满：仅警告，不让整个交互崩
        console.warn('[ChatVault] saveMeta failed:', e);
    }
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
    if (Array.isArray(m[k].bookmarks) && m[k].bookmarks.length === 0) delete m[k].bookmarks;
    if (!m[k].starred && !m[k].customTitle && !m[k].tags && !m[k].userAvatar && !m[k].bookmarks) {
        delete m[k];
    }
    saveMeta(m);
    return m[k] || {};
}
function toggleStar(avatar, fileName) {
    const cur = getMetaFor(avatar, fileName);
    return patchMetaFor(avatar, fileName, { starred: !cur.starred }).starred || false;
}

/* —— v0.4.2 书签：每聊天独立，最多 50 条；指纹防错位 —— */
const BOOKMARK_LIMIT = 50;
function getBookmarks(avatar, fileName) {
    const m = getMetaFor(avatar, fileName);
    return Array.isArray(m.bookmarks) ? m.bookmarks.slice() : [];
}
function setBookmarks(avatar, fileName, list) {
    const m = loadMeta();
    const k = metaKey(avatar, fileName);
    m[k] = m[k] || {};
    if (Array.isArray(list) && list.length) m[k].bookmarks = list;
    else delete m[k].bookmarks;
    if (!m[k].starred && !m[k].customTitle && !m[k].tags && !m[k].userAvatar && !m[k].bookmarks) delete m[k];
    saveMeta(m);
}
function bmFingerprint(text) {
    return String(text || '').replace(/\s+/g, '').slice(0, 30);
}
function bmSnippet(rawMes) {
    const t = String(rawMes || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 30);
}
function findBookmark(avatar, fileName, idx) {
    return getBookmarks(avatar, fileName).find(b => b.idx === idx) || null;
}
function upsertBookmark(avatar, fileName, idx, snippet, note) {
    const list = getBookmarks(avatar, fileName);
    const exist = list.findIndex(b => b.idx === idx);
    if (exist < 0 && list.length >= BOOKMARK_LIMIT) {
        try { toastr.warning(`书签上限 ${BOOKMARK_LIMIT} 条，请先删几个`); } catch {}
        return false;
    }
    const item = { idx, snippet: snippet || '', note: note || '', createdAt: Date.now() };
    if (exist >= 0) list[exist] = { ...list[exist], snippet: item.snippet, note: item.note };
    else list.push(item);
    list.sort((a, b) => a.idx - b.idx);
    setBookmarks(avatar, fileName, list);
    return true;
}
function removeBookmark(avatar, fileName, idx) {
    setBookmarks(avatar, fileName, getBookmarks(avatar, fileName).filter(b => b.idx !== idx));
}

/* ============================================================
 *  酒馆 API
 * ============================================================ */

let _getReqHeaders = null;
let _showMoreMessages = null;
let _getFirstDisplayedMessageId = null;
const _headersReady = (async () => {
    try {
        const mod = await import('../../../../script.js');
        if (typeof mod.getRequestHeaders === 'function') {
            _getReqHeaders = mod.getRequestHeaders;
            console.log('[ChatVault] getRequestHeaders 已通过 ESM import 加载');
        }
        if (typeof mod.showMoreMessages === 'function') _showMoreMessages = mod.showMoreMessages;
        if (typeof mod.getFirstDisplayedMessageId === 'function') _getFirstDisplayedMessageId = mod.getFirstDisplayedMessageId;
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

// value:
//   string         → 正文首句
//   ''             → 空聊天
//   null           → 失败但仍在冷却期（10 分钟内不重试）
// 内部表示：失败用 { __cvFail: ts } 对象记时间戳，到期后 has() 视为未命中
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 500;        // 软上限，超出按插入序裁掉最早 10%
const PREVIEW_FAIL_TTL  = 10 * 60_000; // 失败 10 分钟后允许重试
const PREVIEW_SNIPPET_MAX = 160;
const PREVIEW_TIP_TOUCH_DELAY = 900;
const PREVIEW_TIP_TOUCH_MOVE = 10;

function previewCacheGet(key) {
    if (!previewCache.has(key)) return { hit: false };
    const v = previewCache.get(key);
    if (v && typeof v === 'object' && '__cvFail' in v) {
        if (Date.now() - v.__cvFail < PREVIEW_FAIL_TTL) return { hit: true, value: null };
        previewCache.delete(key); // 失败已过期，让调用方重新拉
        return { hit: false };
    }
    return { hit: true, value: v };
}
function previewCacheSet(key, value) {
    // 软上限：Map 迭代序 = 插入序，超出就裁掉最早一批，避免逐次 delete 抖动
    if (previewCache.size >= PREVIEW_CACHE_MAX && !previewCache.has(key)) {
        const drop = Math.ceil(PREVIEW_CACHE_MAX / 10);
        const it = previewCache.keys();
        for (let i = 0; i < drop; i++) {
            const k = it.next().value;
            if (k === undefined) break;
            previewCache.delete(k);
        }
    }
    previewCache.set(key, value);
}
function previewCacheMarkFail(key) {
    previewCacheSet(key, { __cvFail: Date.now() });
}

function cleanPreviewText(text) {
    return String(text ?? '')
        .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/[*_`~]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanFullPreviewText(text) {
    return String(text ?? '')
        .replace(/[*_`~]+/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function findPreviewSnippetStart(text, target) {
    const radius = 80;
    const min = Math.max(0, target - radius);
    const max = Math.min(text.length - 1, target + radius);
    let best = -1;
    const punct = '。！？!?；;，,、：:\n\r';
    for (let i = target; i >= min; i--) {
        if (punct.includes(text[i])) { best = i + 1; break; }
    }
    if (best < 0) {
        for (let i = target + 1; i <= max; i++) {
            if (punct.includes(text[i])) { best = i + 1; break; }
        }
    }
    if (best < 0) best = target;
    while (best < text.length && /\s/.test(text[best])) best++;
    return Math.min(best, Math.max(0, text.length - 1));
}

function makePreviewSnippet(text, maxLen = PREVIEW_SNIPPET_MAX) {
    const clean = cleanPreviewText(text);
    if (!clean || clean.length <= maxLen) return clean;
    const start = findPreviewSnippetStart(clean, Math.floor(clean.length * 0.58));
    const end = Math.min(clean.length, start + maxLen);
    const segment = clean.slice(start, end).trim();
    return `...${segment}${end < clean.length ? '...' : ''}`;
}

function renderPreviewText(el, text) {
    el.classList.remove('is-loading', 'is-empty');
    el.innerHTML = '';
    if (text === null) {
        el.classList.add('is-empty');
        el.textContent = '（无法加载预览）';
    } else if (!text) {
        el.classList.add('is-empty');
        el.textContent = '（空聊天）';
    } else {
        el.textContent = makePreviewSnippet(text);
    }
}

async function fetchLastMessageText(character, fileName) {
    const key = metaKey(character.avatar, fileName);
    const cached = previewCacheGet(key);
    if (cached.hit) return cached.value;

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
                    previewCacheSet(key, msg.mes);
                    return msg.mes;
                }
            }
            previewCacheSet(key, '');
            return '';
        } catch { /* try next body shape */ }
    }
    previewCacheMarkFail(key); // 软失败：10 分钟后允许重试
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

// 关键反幽灵函数：select(chid) 内部会读 character.chat 决定打开哪个聊天文件
// 如果该字段指向不存在的文件（被删了/外部改过/从未设过），ST 会自动新建一个 ~100B 的空聊天作为占位
// 在 select 之前预热这个字段，让 ST 直接打开已知存在的聊天，避免幽灵增殖
function _ensureCharacterChatField(charObj, preferred) {
    if (!charObj) return;
    if (preferred) { charObj.chat = preferred; return; }
    // newChat 场景没有具体目标：挑一个已知存在的，让 select 别再自动建空聊天
    const list = chatsByAvatar[charObj.avatar] || [];
    if (list.length > 0) charObj.chat = stripExt(list[0].file_name);
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

        // 关键判断 —— 该角色当前是否已经有聊天？
        // - 有：select 会加载最近一条，再调 newChat 新建一条 → +1 条（正确）
        // - 无：select 副作用会自动建一条；但要小心 short-circuit
        const hadExistingChats = (chatsByAvatar[character.avatar] || []).length > 0;
        const wasOnTarget = Number(ctx.characterId) === chid;

        const select = ctx.selectCharacterById || window.selectCharacterById;
        if (typeof select !== 'function') throw new Error('当前 ST 版本不支持自动切换角色');
        // 反幽灵：select 前预设 chat 字段为已知存在的聊天，避免 ST 找不到旧聊天而新建空聊天
        if (hadExistingChats) _ensureCharacterChatField(target.c);

        if (!wasOnTarget) {
            await select(chid);
            const ok = await waitFor(() => {
                return Number(SillyTavern.getContext().characterId) === chid;
            }, 3000);
            if (!ok) throw new Error('角色切换超时');
        }

        // 提前关闭面板（手机端同样的考量）
        closePanel();

        // 三种情况：
        // a) hadExistingChats=false + 切了角色：select 副作用已自动建一条 → 不用再调
        // b) hadExistingChats=false + 已在该角色：select short-circuit 没建 → 必须显式建（v0.5.10 修复）
        // c) hadExistingChats=true：已加载最近一条，再 +1 条
        if (!hadExistingChats && !wasOnTarget) {
            toastr.success(`已为「${character.name || '角色'}」新建聊天`);
            return;
        }

        const ctx2 = SillyTavern.getContext();
        if (typeof ctx2.newChat === 'function') {
            await ctx2.newChat();
        } else if (typeof ctx2.executeSlashCommandsWithOptions === 'function') {
            await ctx2.executeSlashCommandsWithOptions('/newchat');
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

function findRealChatMessageEl(idx) {
    const chat = document.getElementById('chat') || document;
    const selectors = [
        `.mes[mesid="${idx}"]`,
        `.mes[data-mesid="${idx}"]`,
        `.mes[data-index="${idx}"]`,
        `.mes[data-idx="${idx}"]`,
        `.mes[data-message-id="${idx}"]`,
    ];
    for (const sel of selectors) {
        const el = chat.querySelector(sel) || document.querySelector(sel);
        if (el) return el;
    }
    const all = Array.from(chat.querySelectorAll('.mes'));
    return all.find(el => Number(el.getAttribute('mesid')) === idx
        || Number(el.dataset?.mesid) === idx
        || Number(el.dataset?.index) === idx
        || Number(el.dataset?.idx) === idx
        || Number(el.dataset?.messageId) === idx) || null;
}

function getFirstRealDisplayedMessageId() {
    try {
        if (typeof _getFirstDisplayedMessageId === 'function') {
            const id = Number(_getFirstDisplayedMessageId());
            if (Number.isFinite(id)) return id;
        }
    } catch {}
    const ids = Array.from(document.querySelectorAll('#chat .mes'))
        .map(el => Number(el.getAttribute('mesid')))
        .filter(Number.isFinite);
    return ids.length ? Math.min(...ids) : null;
}

async function ensureRealChatFloorRendered(idx) {
    const chatReady = await waitFor(() => {
        try {
            const chat = SillyTavern.getContext()?.chat;
            return Array.isArray(chat) && chat.length > idx;
        } catch { return false; }
    }, 10000, 80);
    if (!chatReady) return false;

    if (findRealChatMessageEl(idx)) return true;
    let firstDisplayed = getFirstRealDisplayedMessageId();
    if (firstDisplayed !== null && idx < firstDisplayed && typeof _showMoreMessages === 'function') {
        try {
            await _showMoreMessages(firstDisplayed - idx);
            await waitFor(() => {
                firstDisplayed = getFirstRealDisplayedMessageId();
                return firstDisplayed !== null && firstDisplayed <= idx;
            }, 6000, 80);
        } catch (e) {
            console.warn('[ChatVault] 加载更早消息失败，降级为不定位楼层', e);
            return false;
        }
    }
    return !!findRealChatMessageEl(idx);
}

async function scrollRealChatToFloor(idx) {
    const ok = await ensureRealChatFloorRendered(idx);
    const el = ok ? findRealChatMessageEl(idx) : null;
    if (!el) {
        toastr.warning(`已打开聊天，但暂时没定位到 #${idx} 楼，请稍后手动滚动`);
        return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('cv-st-jump-highlight');
    setTimeout(() => el.classList.remove('cv-st-jump-highlight'), 1800);
}

async function jumpToChat(character, fileName, opts = {}) {
    try {
        const ctx = SillyTavern.getContext();
        const candidates = ctx.characters
            .map((c, idx) => ({ c, idx }))
            .filter(({ c }) => c.avatar === character.avatar);
        const target = candidates.find(({ c }) => c.name === character.name) || candidates[0];
        if (!target) throw new Error('找不到角色（可能已被删除）');
        const chid = target.idx;

        const target2 = stripExt(fileName);
        const select = ctx.selectCharacterById || window.selectCharacterById;
        if (typeof select !== 'function') throw new Error('当前 ST 版本不支持自动切换角色');
        // 反幽灵：先把 character.chat 指向真正要去的聊天，再 select
        // 否则若 character.chat 仍指向已删/不存在的旧聊天，ST 会先新建一个空聊天作占位
        _ensureCharacterChatField(target.c, target2);
        await select(chid);

        const ok = await waitFor(() => {
            const c = SillyTavern.getContext();
            return Number(c.characterId) === chid;
        }, 3000);
        if (!ok) throw new Error('角色切换超时');
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
        if (Number.isInteger(opts.floorIdx)) await scrollRealChatToFloor(opts.floorIdx);
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
let paginationScrollState = null;
let previewTipTouchTimer = null;
let previewTipTouchStart = null;
let previewTipSuppressClick = false;

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
    bookmark: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    bookmarkPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/></svg>`,
        gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.34.22.7.22 1.06V11a2 2 0 0 1 0 4z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>`,
};

/* ============================================================
 *  UI 顶层
 * ============================================================ */

/* ---- v0.6.0 手机适配：视觉视口 / 软键盘 / 背景滚动锁 ----
 * 目的：
 *  1) 手机上 #chatvault_overlay 是满屏 fixed，iOS/Android 弹出软键盘时
 *     布局视口不变、只有 visualViewport 变矮 → 面板底部（弹窗按钮、分页器）
 *     会被键盘盖住。这里把 visualViewport 的 height/offsetTop 写进 CSS 变量，
 *     CSS 里 #chatvault_overlay 用它们定位，于是整个面板跟着“可见区域”收缩。
 *  2) 打开面板时锁住 body 滚动，避免 iOS 背景页面被手指带着一起滚（回弹）。
 *  3) 关闭面板时把监听器和变量一起清掉 —— 遵守“关闭面板 = 关闭一切监听器”。
 */
let _cvBodyOverflowBefore = null;
let _cvHtmlOverflowBefore = null;
let _cvVVFrame = 0;

function _cvLockBodyScroll() {
    if (_cvBodyOverflowBefore !== null) return;
    const html = document.documentElement;
    const body = document.body;
    _cvHtmlOverflowBefore = html.style.overflow || '';
    _cvBodyOverflowBefore = body.style.overflow || '';
    html.classList.add('cv-scroll-locked');
    body.classList.add('cv-scroll-locked');
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
}

function _cvUnlockBodyScroll() {
    if (_cvBodyOverflowBefore === null) return;
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove('cv-scroll-locked');
    body.classList.remove('cv-scroll-locked');
    html.style.overflow = _cvHtmlOverflowBefore || '';
    body.style.overflow = _cvBodyOverflowBefore || '';
    _cvHtmlOverflowBefore = null;
    _cvBodyOverflowBefore = null;
}

function _cvSyncVisualViewport() {
    const overlay = document.getElementById('chatvault_overlay');
    if (!overlay) return;
    if (!isMobileLayout()) {
        overlay.style.removeProperty('--cv-vv-h');
        overlay.style.removeProperty('--cv-vv-top');
        return;
    }
    const vv = window.visualViewport;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const top = Math.round(vv ? Math.max(0, vv.offsetTop) : 0);
    overlay.style.setProperty('--cv-vv-h', `${h}px`);
    overlay.style.setProperty('--cv-vv-top', `${top}px`);
}

function _cvScheduleVisualViewportSync() {
    if (_cvVVFrame) return;
    _cvVVFrame = requestAnimationFrame(() => {
        _cvVVFrame = 0;
        _cvSyncVisualViewport();
    });
}

function _cvBindViewportSync(overlay) {
    if (!overlay) return;
    _cvSyncVisualViewport();
    if (!isMobileLayout()) return;
    const vv = window.visualViewport;
    const onChange = () => _cvScheduleVisualViewportSync();
    if (vv) {
        vv.addEventListener('resize', onChange);
        vv.addEventListener('scroll', onChange, { passive: true });
    }
    window.addEventListener('orientationchange', onChange);
    window.addEventListener('resize', onChange);
    overlay._cvViewportCleanup = () => {
        if (vv) {
            vv.removeEventListener('resize', onChange);
            vv.removeEventListener('scroll', onChange);
        }
        window.removeEventListener('orientationchange', onChange);
        window.removeEventListener('resize', onChange);
        if (_cvVVFrame) { cancelAnimationFrame(_cvVVFrame); _cvVVFrame = 0; }
        overlay.style.removeProperty('--cv-vv-h');
        overlay.style.removeProperty('--cv-vv-top');
    };
}

function _cvCleanupViewportSync(overlay) {
    if (overlay && overlay._cvViewportCleanup) {
        overlay._cvViewportCleanup();
        overlay._cvViewportCleanup = null;
    }
}

/* 桌面窗口被拖窄 / 平板分屏变成手机尺寸时，桌面窗口模式写在 panel 上的内联尺寸
 * 是 style="...!important" 级别，会压过移动端 CSS。这里在跨过断点时把它们清掉，
 * 把布局控制权交还给 style.css 的手机层。 */
function _cvEnsureMobileCssOwnership(overlay, panel) {
    if (!overlay || !panel || !isMobileLayout()) return;
    overlay.classList.remove('cv-window-positioned', 'cv-window-free', 'cv-reader-expanded');
    ['left', 'top', 'width', 'height', 'transform', 'transform-origin'].forEach(p => panel.style.removeProperty(p));
    panel.classList.remove('cv-window-positioned');
}

/* 手机底部抽屉：从顶部把手/标题区下拉关闭
 *  - 只认触屏指针（pointerType !== 'mouse'），桌面完全不受影响
 *  - 只有起始点落在抽屉顶部 60px 内才接管，正文/表单区域依然正常滚动
 *  - 下拉超过 72px 视为关闭：弹窗走 closeModal()，阅读设置走齿轮按钮（复用既有收尾逻辑） */
function _cvBindSheetDragDismiss(overlay) {
    let drag = null;
    const onDown = (e) => {
        if (!isMobileLayout() || e.pointerType === 'mouse') return;
        const sheet = e.target.closest('.cv-modal, .cv-reader-settings');
        if (!sheet) return;
        if (e.target.closest('button, input, select, textarea, a, .cv-modal-body, .cv-reader-settings-body')) return;
        const r = sheet.getBoundingClientRect();
        if (e.clientY - r.top > 60) return;
        drag = {
            id: e.pointerId,
            y: e.clientY,
            dy: 0,
            sheet,
            kind: sheet.classList.contains('cv-reader-settings') ? 'reader' : 'modal',
        };
        sheet.style.transition = 'none';
        sheet.style.willChange = 'transform';
    };
    const onMove = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag.dy = Math.max(0, e.clientY - drag.y);
        drag.sheet.style.transform = `translateY(${drag.dy}px)`;
    };
    const finish = (e) => {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        const { sheet, dy, kind } = drag;
        drag = null;
        sheet.style.transition = '';
        sheet.style.willChange = '';
        if (dy > 72) {
            if (kind === 'reader') {
                document.getElementById('cv_reader_gear')?.click();
            } else {
                closeModal();
                return;
            }
        }
        sheet.style.transform = '';
    };
    overlay.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', finish, { passive: true });
    window.addEventListener('pointercancel', finish, { passive: true });
    // 关闭面板时必须解绑 window 级监听器（遵守“关闭面板 = 关闭一切监听器”）
    overlay._cvSheetDragCleanup = () => {
        overlay.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        if (drag && drag.sheet) {
            drag.sheet.style.transition = '';
            drag.sheet.style.willChange = '';
            drag.sheet.style.transform = '';
        }
        drag = null;
    };
}

function openPanel(modeOverride = '') {
    if (panelEl) {
        const panel = document.getElementById('chatvault_panel');
        if (modeOverride && panel && !panel.classList.contains('cv-in-reader')) applyWindowState(panelEl, panel, modeOverride);
        return;
    }
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
                    <input type="search" inputmode="search" enterkeyhint="search"
                           autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
                           class="cv-search" id="cv_search" placeholder="搜索角色名 / 聊天标题 / 标签…" />
                </div>
                <div class="cv-header-actions">
                    <button class="cv-icon-btn cv-refresh-btn" id="cv_refresh" title="手动刷新（重新加载所有角色和聊天）">${ICONS.refresh}</button>
                    <button class="cv-icon-btn" id="cv_close" title="关闭 (Esc)">✕</button>
                </div>
            </div>
            <div class="cv-tabbar">
                <div class="cv-tabs" id="cv_tabs">
                    <button class="cv-tab active" data-tab="recent">最近<span class="cv-tab-count" id="cv_count_recent"></span></button>
                    <button class="cv-tab" data-tab="characters">角色<span class="cv-tab-count" id="cv_count_characters"></span></button>
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
    panelEl.addEventListener('click', (e) => {
        // 拖动/拉伸刚结束时浏览器可能补一个 click 到遮罩上，忽略掉防止误关
        if (_cvSuppressOverlayClick) return;
        // 点在面板内部不当成“点遮罩”
        if (e.target.closest && e.target.closest('#chatvault_panel')) return;
        closePanel();
    });
    // v0.6.0：面板/弹窗内部点击不要冒泡到遮罩。
    // 原来靠每个容器的内联 onclick="event.stopPropagation()"；万一酒馆收紧 CSP
    // 丢掉内联事件，点面板任何位置都会直接关掉面板。这里补真实监听器兜底。
    panelEl.querySelector('#chatvault_panel')?.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(panelEl);

    // v0.6.0 手机适配：跟随视觉视口（软键盘 / 地址栏高度）
    _cvBindViewportSync(panelEl);

    // 桌面窗口模式：装把手、还原位置、绑定拖拽/拉伸（手机端内部直接 return）
    const _panel = document.getElementById('chatvault_panel');
    applyWindowState(panelEl, _panel, modeOverride);
    initWindowChrome(panelEl, _panel);
    // v0.6.0：窗口跨过手机断点时清掉桌面内联尺寸
    _cvEnsureMobileCssOwnership(panelEl, _panel);
    panelEl._cvMobileSwitchHandler = () => _cvEnsureMobileCssOwnership(panelEl, _panel);
    window.addEventListener('resize', panelEl._cvMobileSwitchHandler);

    // v0.6.0：锁背景滚动。
    //  - 手机端面板是全屏的，一律锁；
    //  - 桌面「经典居中弹窗」也锁（避免滚轮滚到背后的酒馆页面）；
    //  - 桌面「自由窗口 / 左侧停靠栏」的设计目的就是“不遮罩、可同时操作酒馆”，
    //    这两种模式绝不能锁，否则用户滚不动酒馆。
    if (isMobileLayout() || !panelEl.classList.contains('cv-window-free')) {
        _cvLockBodyScroll();
    }
    // 手机底部抽屉：下拉把手关闭
    _cvBindSheetDragDismiss(panelEl);

    document.getElementById('cv_close').onclick = closePanel;
    document.getElementById('cv_refresh').onclick = (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (btn.classList.contains('is-spinning')) return;
        btn.classList.add('is-spinning');
        loadAll().finally(() => btn.classList.remove('is-spinning'));
    };
    // v0.6.0：中文输入法适配 + 输入去抖
    // 旧实现每敲一个字符就整页重渲（最多 50 张卡 + 高亮 + 预览观察器）。
    // 手机上 IME 拼字期间 input 事件会连续触发，输入“长夜”就会重绘两三次，
    // 低端机直接卡顿、候选词还会被重绘顶掉。这里 composition 期间不渲染，结束后再渲。
    (() => {
        const el = document.getElementById('cv_search');
        if (!el) return;
        let composing = false;
        let timer = 0;
        const apply = () => {
            if (!document.getElementById('chatvault_panel')) return;
            searchQuery = el.value.trim();
            currentPage = 1;
            render();
            // 搜索结果变少时滚回顶部，否则会停在空白区，看起来像“没结果”
            const body = document.getElementById('cv_body');
            if (body) body.scrollTop = 0;
        };
        el.addEventListener('compositionstart', () => { composing = true; });
        el.addEventListener('compositionend', () => {
            composing = false;
            clearTimeout(timer);
            timer = setTimeout(apply, 0);
        });
        el.addEventListener('input', () => {
            if (composing) return;
            clearTimeout(timer);
            timer = setTimeout(apply, 120);
        });
        el.addEventListener('search', () => {           // 键盘“搜索”键 / 清理按钮
            clearTimeout(timer);
            apply();
        });
    })();
    document.getElementById('cv_tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.cv-tab');
        if (!btn) return;
        switchTab(btn.dataset.tab);
    });
    bindPaginationAutoHide();

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
    const tip = document.getElementById('cv_preview_tip');
    if (tip) { closePreviewTip(); return; }
    // 如果有打开的 modal 先关 modal
    const modal = document.getElementById('cv_modal');
    if (modal) { modal.remove(); return; }
    closePanel();
}

function closePanel() {
    closePreviewTip();
    // 阅读模式楼层菜单可能还开着；它在 document 上挂了 mousedown/touchstart capture 监听
    // 不显式 close 会导致这两个监听器残留 + 闭包持有已 detach 的菜单节点
    closeMsgMenu();
    if (previewObserver) { previewObserver.disconnect(); previewObserver = null; }
    // 移除 PC 端 window resize 监听，避免反复开关导致监听器堆积
    if (panelEl && panelEl._cvOnResize) {
        window.removeEventListener('resize', panelEl._cvOnResize);
        panelEl._cvOnResize = null;
    }
    // v0.6.0 手机适配：清掉视觉视口监听 + 解除背景滚动锁
    if (panelEl && panelEl._cvMobileSwitchHandler) {
        window.removeEventListener('resize', panelEl._cvMobileSwitchHandler);
        panelEl._cvMobileSwitchHandler = null;
    }
    if (panelEl && panelEl._cvSheetDragCleanup) {
        panelEl._cvSheetDragCleanup();
        panelEl._cvSheetDragCleanup = null;
    }
    _cvCleanupViewportSync(panelEl);
    _cvUnlockBodyScroll();
    if (panelEl) { panelEl.remove(); panelEl = null; }
    document.removeEventListener('keydown', escHandler);
    // 重置阅读模式状态——否则下次打开 render() 会因为 readerState.active=true 直接进入旧阅读视图
    readerState.active = false;
    readerState.arr = null;
    readerState._processed = null;
    readerState._cfgSig = null;
    readerState.settingsOpen = false;
    // 关闭面板时清空搜索词，避免下次打开时旧搜索仍然生效但输入框为空
    searchQuery = '';
    currentPage = 1;
    // v0.6.0：阅读模式临时展开的几何记录也必须清掉，否则下次打开会还原成旧尺寸
    _readerPanelBeforeExpand = null;
}

function switchTab(tab) {
    if (tab === activeTab) return;
    activeTab = tab;
    currentPage = 1;
    document.querySelectorAll('#cv_tabs .cv-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    render();
    // v0.6.0：切 Tab 后回到顶部，否则会停在上一页的滚动位置（手机上像“空白页”）
    const body = document.getElementById('cv_body');
    if (body) body.scrollTop = 0;
}

function setStatus(text) {
    const el = document.getElementById('cv_status');
    if (el) el.textContent = text || '';
}

function shouldAutoHidePagination() {
    const panel = document.getElementById('chatvault_panel');
    return isMobileLayout() || !!panel?.classList.contains('cv-layout-narrow');
}

function resetPaginationAutoHide() {
    const pagination = document.getElementById('cv_pagination');
    if (pagination) pagination.classList.remove('is-hidden');
    if (paginationScrollState) {
        paginationScrollState.lastY = document.getElementById('cv_body')?.scrollTop || 0;
        paginationScrollState.acc = 0;
    }
}

function updatePaginationAutoHideMode() {
    const pagination = document.getElementById('cv_pagination');
    if (!pagination) return;
    const enabled = shouldAutoHidePagination();
    pagination.classList.toggle('cv-pagination-autohide', enabled);
    if (!enabled) pagination.classList.remove('is-hidden');
}

function bindPaginationAutoHide() {
    const body = document.getElementById('cv_body');
    const pagination = document.getElementById('cv_pagination');
    if (!body || !pagination || body._cvPaginationAutoHideBound) return;
    body._cvPaginationAutoHideBound = true;
    paginationScrollState = { lastY: body.scrollTop || 0, acc: 0 };
    body.addEventListener('scroll', () => {
        if (!shouldAutoHidePagination()) {
            pagination.classList.remove('is-hidden');
            paginationScrollState.lastY = body.scrollTop;
            paginationScrollState.acc = 0;
            return;
        }
        const y = body.scrollTop;
        const dy = y - paginationScrollState.lastY;
        paginationScrollState.lastY = y;
        if (Math.abs(dy) < 2) return;
        paginationScrollState.acc = (Math.sign(dy) === Math.sign(paginationScrollState.acc)) ? paginationScrollState.acc + dy : dy;
        if (paginationScrollState.acc > 24) {
            pagination.classList.add('is-hidden');
            paginationScrollState.acc = 0;
        } else if (paginationScrollState.acc < -24) {
            pagination.classList.remove('is-hidden');
            paginationScrollState.acc = 0;
        }
        if (body.scrollHeight - y - body.clientHeight < 80) pagination.classList.remove('is-hidden');
        if (y < 40) pagination.classList.remove('is-hidden');
    }, { passive: true });
}

/* ============================================================
 *  数据加载
 * ============================================================ */

async function loadAll() {
    const loadToken = ++loadAllToken; // 防止重复打开造成的并发污染
    // 主刷新时同时让预览缓存重新生成，避免「酒馆里改完档回来还看到旧首句」
    previewCache.clear();
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
                if (loadToken !== loadAllToken) return;   // 早退：被新一轮 loadAll 抢占
                const c = queue.shift();
                try {
                    const list = await fetchChatsFor(c.avatar);
                    if (loadToken !== loadAllToken) return;   // fetch 完成时再核一次，避免污染新对象
                    chatsByAvatar[c.avatar] = (Array.isArray(list) ? list : []).map(ch => ({
                        ...ch,
                        file_name: stripExt(ch.file_name),
                    }));
                } catch (e) {
                    if (loadToken !== loadAllToken) return;
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
        // v0.5.24: 加载失败回调可能在面板已关闭后才触发，此时 cv_body 不存在，要判空
        const body = document.getElementById('cv_body');
        if (body) body.innerHTML = `<div class="cv-empty">加载失败：${escapeHtml(e.message)}</div>`;
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

function viewByCharacter({ withChatsOnly = false } = {}) {
    // 按角色分组：[{character, chats: [...]}]，每组按时间倒序，组按"该组最新一条"倒序
    // v0.5.4-test: 默认包含 0 聊天的角色，便于用每组的「新建聊天」按钮快建；
    //              tab 数字 / 收藏视图等"旧语义"调用方传 withChatsOnly:true 仍只数有聊天的。
    const q = (searchQuery || '').toLowerCase();
    const groups = [];
    for (const c of charactersCache) {
        const list = (chatsByAvatar[c.avatar] || [])
            .filter(ch => matchesSearch(c, ch))
            .sort((a, b) => timestampOf(b) - timestampOf(a));
        if (searchQuery) {
            // 搜索时：聊天命中 OR 角色名命中 才显示
            const nameHit = (c.name || '').toLowerCase().includes(q);
            if (list.length === 0 && !nameHit) continue;
        } else if (withChatsOnly && list.length === 0) {
            continue;
        }
        groups.push({ character: c, chats: list });
    }
    return groups.sort((a, b) => {
        // 先按聊天数倒序（让 0 聊天的角色沉到最底，不抢位置），同数再按最新一条时间倒序
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
    // v0.5.6-test: 「角色」tab 上的数字 = 已加载的全部角色卡数量（含 0 聊天），
    // 与列表实际可见的总数对应，不再产生"显示 40 但其实有更多"的歧义。
    const totalChars = (charactersCache || []).length;
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
        // v0.5.4-test: 「按角色」改为分页（每页 CHAR_PAGE_SIZE 张角色卡），含 0 聊天的角色
        const groups = viewByCharacter();
        const totalPagesC = Math.max(1, Math.ceil(groups.length / CHAR_PAGE_SIZE));
        if (currentPage > totalPagesC) currentPage = totalPagesC;
        const sliceC = groups.slice((currentPage - 1) * CHAR_PAGE_SIZE, currentPage * CHAR_PAGE_SIZE);
        renderCharactersTab(body, sliceC);
        renderPagination(groups.length, totalPagesC);
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

function renderCharactersTab(body, groups) {
    // v0.5.4-test: groups 由 render() 切好分页后传入；不传则退化为全量（兼容旧调用）
    if (!groups) groups = viewByCharacter();
    if (groups.length === 0) {
        body.innerHTML = `<div class="cv-empty">${searchQuery ? '没有匹配的结果' : '没有任何角色'}</div>`;
        return;
    }
    // 搜索时默认全部展开，便于看到匹配结果；否则按用户记忆的状态（默认折叠）
    body.innerHTML = groups.map(({ character: c, chats }) => {
        const avatarUrl = c.avatar
            ? `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`
            : '';
        const errMsg = errorsByAvatar[c.avatar];
        const isEmpty = chats.length === 0;
        const right = errMsg
            ? `<span class="cv-group-error" title="${escapeHtml(errMsg)}">⚠ 加载失败</span>`
            : `<span class="cv-group-count">${isEmpty ? '暂无聊天' : `共 ${chats.length} 条聊天`}</span>`;
        // 0 聊天的组：永远不展开（没东西可展开）；其余按搜索 / 记忆状态
        const expanded = !isEmpty && (!!searchQuery || groupOpen.has(c.avatar));
        return `
            <div class="cv-group ${expanded ? 'is-open' : ''} ${isEmpty ? 'is-empty' : ''}" data-avatar="${escapeHtml(c.avatar)}">
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
            // v0.5.4-test: 0 聊天的组没东西可展开，避免无意义切换
            if (g.classList.contains('is-empty')) return;
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
        <div class="cv-card ${active ? 'is-active' : ''}" data-avatar="${escapeHtml(character.avatar)}" data-name="${escapeHtml(character.name || '')}" data-file="${escapeHtml(chat.file_name)}">
            <img class="cv-card-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" alt="" />
            <div class="cv-card-main">
                <div class="cv-card-row">
                    <div class="cv-card-titleblock">
                        <h3 class="cv-title ${titleClass}">${activeBadge}${highlight(displayTitle, searchQuery)}</h3>
                        ${subLine}
                    </div>
                    <div class="cv-actions">
                        <button class="cv-act cv-star ${starred ? 'is-on' : ''}" data-act="star" title="收藏" aria-label="${starred ? '取消收藏' : '收藏'}">${ICONS.star}</button>
                        <button class="cv-act" data-act="edit" title="编辑标题/标签" aria-label="编辑标题和标签">${ICONS.edit}</button>
                        <button class="cv-act cv-act-delete" data-act="delete" title="删除" aria-label="删除这个聊天">${ICONS.trash}</button>
                        <span class="cv-act-divider"></span>
                        <button class="cv-act cv-act-jump ${active ? 'is-active' : ''}" data-act="open" title="跳转到此聊天" aria-label="${jumpLabel}聊天"><span>${jumpLabel}</span>${ICONS.jump}</button>
                    </div>
                </div>
                <div class="cv-meta-row">
                    ${meta1}
                    ${tagsHtml}
                </div>
                <div class="cv-preview is-loading" data-preview="1" aria-label="右键或长按查看完整预览">加载预览中…</div>
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
    resetPaginationAutoHide();
    updatePaginationAutoHideMode();
    if (total === 0) {
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `
        <span class="cv-page-label">第 ${currentPage} / ${totalPages} 页</span>
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
        const cName  = card.dataset.name || '';
        const fileName = card.dataset.file;
        // 同 avatar 不同 name 的角色（同一张 png 被复制成两个角色）会并存
        // 必须 (avatar, name) 双键查找，否则操作会落到错的那个角色上
        const character = charactersCache.find(c => c.avatar === avatar && (c.name || '') === cName)
                       || charactersCache.find(c => c.avatar === avatar);
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

        bindPreviewTipEvents(card, character, fileName);

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

function clearPreviewTipTimers() {
    if (previewTipTouchTimer) { clearTimeout(previewTipTouchTimer); previewTipTouchTimer = null; }
    previewTipTouchStart = null;
}

function closePreviewTip() {
    clearPreviewTipTimers();
    const tip = document.getElementById('cv_preview_tip');
    if (tip) {
        try { tip._cleanup && tip._cleanup(); } catch {}
        tip.remove();
    }
}

function positionPreviewTip(tip, anchorEl) {
    // v0.6.0：手机端预览气泡由 CSS 固定为底部卡片，不需要也不应该写内联坐标
    // （内联坐标要靠 !important 才能被压住，太脆；同时也省掉一次强制同步布局）
    if (isMobileLayout()) {
        tip.style.removeProperty('left');
        tip.style.removeProperty('top');
        return;
    }
    const anchor = anchorEl.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const margin = 10;
    let left = anchor.left;
    let top = anchor.bottom + 8;
    if (top + rect.height > vh - margin) {
        const above = anchor.top - rect.height - 8;
        top = above >= margin ? above : Math.max(margin, vh - rect.height - margin);
    }
    if (left + rect.width > vw - margin) left = vw - rect.width - margin;
    left = _clamp(left, margin, Math.max(margin, vw - rect.width - margin));
    top = _clamp(top, margin, Math.max(margin, vh - rect.height - margin));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
}

function openTextPreviewTip(anchorEl, text, emptyText = '（空消息）') {
    closePreviewTip();
    if (!anchorEl?.isConnected) return;

    const tip = document.createElement('div');
    tip.className = 'cv-preview-tip';
    tip.id = 'cv_preview_tip';
    tip.textContent = text === null ? emptyText : (cleanFullPreviewText(text) || emptyText);
    (document.getElementById('chatvault_panel') || document.body).appendChild(tip);
    positionPreviewTip(tip, anchorEl);

    const onDocDown = (ev) => {
        if (tip.contains(ev.target)) return;
        if (anchorEl.contains(ev.target)) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        closePreviewTip();
    };
    const onScroll = (ev) => {
        if (tip.contains(ev.target)) return;
        closePreviewTip();
    };
    const onKey = (ev) => {
        if (ev.key === 'Escape') closePreviewTip();
    };
    const onClose = () => closePreviewTip();
    setTimeout(() => {
        if (!tip.isConnected) return;
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('touchstart', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onClose, true);
        tip._cleanup = () => {
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('touchstart', onDocDown, true);
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onClose, true);
        };
    }, 0);
}

async function openPreviewTip(card, anchorEl, character, fileName) {
    closePreviewTip();
    if (!card?.isConnected || !anchorEl?.isConnected || !character || !fileName) return;
    const key = metaKey(character.avatar, fileName);
    const cached = previewCacheGet(key);
    const text = cached.hit ? cached.value : await fetchLastMessageText(character, fileName);
    if (!card.isConnected || !anchorEl.isConnected) return;
    openTextPreviewTip(anchorEl, text, text === null ? '（无法加载预览）' : '（空聊天）');
}

function bindTextPreviewTipEvents(anchorEl, openTip) {
    if (!anchorEl || anchorEl._cvTextPreviewTipBound) return;
    anchorEl._cvTextPreviewTipBound = true;

    anchorEl.addEventListener('click', e => {
        if (!previewTipSuppressClick) return;
        previewTipSuppressClick = false;
        e.preventDefault();
        e.stopPropagation();
    });
    anchorEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        openTip();
    });
    anchorEl.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        clearPreviewTipTimers();
        previewTipTouchStart = { x: e.clientX, y: e.clientY };
        previewTipTouchTimer = setTimeout(() => {
            previewTipTouchTimer = null;
            previewTipTouchStart = null;
            previewTipSuppressClick = true;
            setTimeout(() => { previewTipSuppressClick = false; }, 500);
            e.preventDefault();
            openTip();
        }, PREVIEW_TIP_TOUCH_DELAY);
    });
    anchorEl.addEventListener('pointermove', e => {
        if (!previewTipTouchStart || e.pointerType !== 'touch') return;
        const dx = e.clientX - previewTipTouchStart.x;
        const dy = e.clientY - previewTipTouchStart.y;
        if (Math.hypot(dx, dy) > PREVIEW_TIP_TOUCH_MOVE) clearPreviewTipTimers();
    });
    anchorEl.addEventListener('pointerup', e => {
        if (e.pointerType === 'touch' && previewTipTouchTimer) clearPreviewTipTimers();
    });
    anchorEl.addEventListener('pointercancel', e => {
        if (e.pointerType === 'touch') clearPreviewTipTimers();
    });
}

function bindPreviewTipEvents(card, character, fileName) {
    const preview = card.querySelector('.cv-preview');
    if (!preview || preview._cvPreviewTipBound) return;
    preview._cvPreviewTipBound = true;
    bindTextPreviewTipEvents(preview, () => openPreviewTip(card, preview, character, fileName));
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
                renderPreviewText(el, text);
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
        const cached = previewCacheGet(key);
        if (cached.hit) {
            const text = cached.value;
            renderPreviewText(el, text);
            if (text === null) {
                // 失败仍然挂上 observer：缓存 TTL 过期后用户重新滚动到这里就会自动重试
                // fetchLastMessageText 内部会按 cache 状态决定是否真发请求，不会浪费流量
                previewObserver.observe(el);
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

// v0.5.18 内置「通用折叠」正则：把"以下/以上是用户的本轮输入"或 <用户本轮输入> 标记
// 后的整段（包括标记本身）当作上下文泄漏直接删掉。社区通用正则，target=both。
const BUILTIN_REGEX_FOLD = /(^(?:(?:以下|以上)是用户的本轮输入|<用户本轮输入>)[\s\S]*$)/m;

// v0.5.17 自定义正则：在 strip 之后、extract 之前作用，与 strip 同性质（删除/替换）
// items: [{ name, pattern, flags, replace, target: 'user'|'ai'|'both', enabled }]
// target 决定是否对当前消息生效；isUser 由调用方传入；缺省 target 当 'both'
// v0.5.18: 增加内置 builtinFold 步骤（默认 ON），优先于 items 跑
function applyCustomRegex(text, customRegex, isUser) {
    if (typeof text !== 'string' || !text) return text || '';
    if (!customRegex) return text;
    let out = text;
    // 内置「通用折叠」：customRegex.builtinFold !== false 时启用（默认 true）
    if (customRegex.builtinFold !== false) {
        try { out = out.replace(BUILTIN_REGEX_FOLD, ''); } catch {}
    }
    if (!Array.isArray(customRegex.items) || !customRegex.items.length) {
        return out === text ? text : out.replace(/\n{3,}/g, '\n\n').trim();
    }
    // v0.5.24: ReDoS 护栏。JS 单线程无法真正给同步 regex 加超时，只能缩攻击面：
    //   · pattern 单条上限 1000 字符（正常用户写不到）
    //   · 单条消息正文超过 500KB 直接跳过自定义正则（保留剥离/提取/builtin）
    //   · 启用条数硬上限 50（防被诱导导入巨型 JSON）
    if (out.length > 500_000) return out.replace(/\n{3,}/g, '\n\n').trim();
    let processed = 0;
    for (const it of customRegex.items) {
        if (processed >= 50) break;
        if (!it || it.enabled === false) continue;
        if (typeof it.pattern !== 'string' || !it.pattern) continue;
        if (it.pattern.length > 1000) continue;        // 异常长 pattern 拒绝构造
        const target = it.target || 'both';
        if (target === 'user' && !isUser) continue;
        if (target === 'ai'   &&  isUser) continue;
        let re;
        try { re = new RegExp(it.pattern, typeof it.flags === 'string' ? it.flags : 'g'); }
        catch { continue; }                        // 写错的正则跳过，不炸整条消息
        const repl = typeof it.replace === 'string' ? it.replace : '';
        try { out = out.replace(re, repl); } catch { continue; }
        processed++;
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
}

// 完整管线：剥离 → 自定义正则 → 提取
// customRegex / isUser 形参可选（旧调用点不传时跳过自定义正则步骤，向后兼容）
function processMessageText(text, strip, extract, customRegex, isUser) {
    return applyExtraction(applyCustomRegex(applyStripping(text, strip), customRegex, isUser), extract).trim();
}

// —— v0.5.11: 阅读模式 markdown 渲染（套餐 A + DOMPurify HTML 直通）——
// 行内：***粗斜*** / **粗** / *斜* / ~~删除线~~ / `行内代码`
// 块级：表格 / 围栏代码块 / 引用 / 无序/有序列表
// HTML：AI 输出的 <p style> <span style> <details> 等经 DOMPurify 白名单 sanitize 后通过
// 设计：标题 # / 链接 [](url) / 水平线 --- 故意不接，避免与 strip 选项及 RP 文学描写冲突

function mdInlineRich(s) {
    // s 必须已 escapeHtml；处理顺序：长 → 短，避免吃掉对方的星号
    return s
        .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>')
        .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
        .replace(/`([^`\n]+?)`/g, '<code class="cv-md-code">$1</code>');
}
function mdInline(escaped) { return mdInlineRich(escaped); } // 兼容旧调用点

// 极简渲染（v0.5.14 当用户关闭「增强渲染」时使用）—— 仅 **粗** *斜*，按 \n+ 切段
function renderLiteMd(raw) {
    if (!raw) return '';
    const segs = String(raw).split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!segs.length) return '';
    return segs.map(seg => {
        const safe = escapeHtml(seg)
            .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>');
        return `<p class="cv-msg-p">${safe}</p>`;
    }).join('');
}

// 智能 escape：行里出现疑似 HTML tag (`<tag>` / `<tag/>` / `<tag attr=...>`) 时整段不 escape，
// 让 AI 嵌在文字中的 <img> <span style> <u> <mark> 等能正常渲染（最终由 DOMPurify 兜底安全）；
// 否则按原规则 escape，保护 `1 < 2` `A & B` 等纯文本不被浏览器误解析。
function maybeEscapeHtml(s) {
    if (s == null) return '';
    return /<[a-zA-Z][^>]{0,500}>/.test(String(s)) ? String(s) : escapeHtml(s);
}

function _cvParseTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|'));
}
function _cvIsBlockStart(line, next) {
    if (!line) return false;
    if (/^```/.test(line)) return true;
    if (/^\s*>\s?/.test(line)) return true;
    if (/^\s*[-*]\s+/.test(line)) return true;
    if (/^\s*\d+\.\s+/.test(line)) return true;
    if (/^\s*\|.*\|\s*$/.test(line) && next && /^\s*\|[\s\-:|]+\|\s*$/.test(next)) return true;
    if (/^\s*<[a-zA-Z][^>]*>/.test(line)) return true;
    return false;
}

function renderRichMd(raw) {
    if (!raw) return '';
    const lines = String(raw).split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const _iBefore = i; // 死循环兜底

        // 围栏代码块 ```lang ... ```
        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
            const lang = fence[1] || '';
            const codeLines = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
            if (i < lines.length) i++; // 吃掉收尾 ```
            const langAttr = /^[a-zA-Z0-9_+-]{1,20}$/.test(lang) ? ` class="language-${lang}"` : '';
            out.push(`<pre class="cv-md-pre"><code${langAttr}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        // 表格
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
            const header = _cvParseTableRow(line);
            const sep = _cvParseTableRow(lines[i + 1]);
            const aligns = sep.map(c => {
                const t = c.trim();
                if (/^:-+:$/.test(t)) return 'center';
                if (/^:-+$/.test(t)) return 'left';
                if (/^-+:$/.test(t)) return 'right';
                return '';
            });
            i += 2;
            const body = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(_cvParseTableRow(lines[i])); i++; }
            const cell = (c, j, tag) => {
                const al = aligns[j] ? ` style="text-align:${aligns[j]}"` : '';
                return `<${tag}${al}>${mdInlineRich(maybeEscapeHtml((c || '').trim()))}</${tag}>`;
            };
            const tr = (cells, tag) => '<tr>' + cells.map((c, j) => cell(c, j, tag)).join('') + '</tr>';
            out.push(`<table class="cv-md-table"><thead>${tr(header, 'th')}</thead><tbody>${body.map(r => tr(r, 'td')).join('')}</tbody></table>`);
            continue;
        }

        // 引用（连续 > 合并）
        if (/^\s*>\s?/.test(line)) {
            const quoted = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
            const inner = quoted.map(q => mdInlineRich(maybeEscapeHtml(q))).join('<br>');
            out.push(`<blockquote class="cv-md-quote">${inner}</blockquote>`);
            continue;
        }

        // 无序列表
        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
            out.push(`<ul class="cv-md-ul">${items.map(it => `<li>${mdInlineRich(maybeEscapeHtml(it))}</li>`).join('')}</ul>`);
            continue;
        }

        // 有序列表
        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
            out.push(`<ol class="cv-md-ol">${items.map(it => `<li>${mdInlineRich(maybeEscapeHtml(it))}</li>`).join('')}</ol>`);
            continue;
        }

        // 空行
        if (line.trim() === '') { i++; continue; }

        // HTML 直通行（以 <tag> 开头，整段不再 escape，也不包 <p>）
        // 注意：进入此分支时 line 本身就是 HTML 起始 —— 必须先消费 line 再用 _cvIsBlockStart 判后续行，否则死循环
        if (/^\s*<[a-zA-Z][^>]*>/.test(line)) {
            const htmlBuf = [line];
            i++;
            while (i < lines.length && lines[i].trim() !== '' && !_cvIsBlockStart(lines[i], lines[i + 1])) {
                htmlBuf.push(lines[i]); i++;
            }
            out.push(htmlBuf.join('\n'));
            continue;
        }

        // 普通段落（按行包 <p>，配合首行缩进 CSS）
        out.push(`<p class="cv-msg-p">${mdInlineRich(maybeEscapeHtml(line))}</p>`);
        i++;

        // 死循环防御：若任一分支忘了递增 i，强制前进，避免卡死浏览器
        if (i === _iBefore) i++;
    }
    return out.join('');
}

// DOMPurify 白名单：允许 AI 内联样式 / 表格 / details 等，砍掉 script/iframe/事件/危险协议
function sanitizeMd(html) {
    if (!html) return '';
    const DP = (typeof window !== 'undefined') ? window.DOMPurify : null;
    if (DP && typeof DP.sanitize === 'function') {
        try {
            return DP.sanitize(html, {
                ALLOWED_TAGS: [
                    'p', 'br', 'span', 'div', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
                    'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'hr',
                    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
                    'sub', 'sup', 'small', 'mark', 'details', 'summary', 'font', 'a', 'img',
                    // v0.5.13 扩展：标题 + 语义 + 图配说明 + 定义列表
                    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'figure', 'figcaption',
                    'kbd', 'abbr', 'q', 'cite', 'time', 'ruby', 'rt', 'rp', 'bdi', 'bdo', 'wbr',
                    'dl', 'dt', 'dd',
                ],
                ALLOWED_ATTR: [
                    'style', 'class', 'title', 'colspan', 'rowspan',
                    'align', 'color', 'size', 'face', 'open',
                    'href', 'target', 'rel', 'alt', 'src',
                ],
                ALLOWED_URI_REGEXP: /^(?:https?|mailto|data:image\/(?:png|jpeg|gif|webp|svg\+xml)):/i,
                FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base', 'style'],
                FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseenter', 'onmouseleave', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress', 'onanimationend', 'onanimationstart', 'ontransitionend'],
            });
        } catch (e) {
            console.warn('[ChatVault] DOMPurify.sanitize 抛错，按 fail-closed 退化为字面文本：', e);
        }
    }
    // fail-closed：DOMPurify 不存在或抛错时，**绝不**返回原始 html（否则任何 <script> / on*= 都会被浏览器执行）
    // 退化为「把 HTML 当字面字符串显示」—— 用户能看到原文但不会被攻击
    return escapeHtml(html);
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

let _readerToken = 0;
let _readerPanelBeforeExpand = null;
async function enterReader(character, fileName) {
    if (!character || !fileName) return;
    const myToken = ++_readerToken;
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
    if (panel) {
        panel.classList.add('cv-in-reader');
        applyReaderPanelExpand(panel);
    }
    renderReader();
    let arr;
    try {
        arr = await fetchFullChat(character, fileName);
    } catch (e) {
        arr = { error: e.message || String(e) };
    }
    // 防竞态：旧请求晚返回时，token 已被新一次 enterReader 抢占，丢弃
    if (myToken !== _readerToken) return;
    if (!readerState.active) return;
    readerState.arr = arr;
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
    if (panel) {
        panel.classList.remove('cv-in-reader');
        panel.classList.remove('cv-reader-settings-open');
        restoreReaderPanelExpand(panel);
    }
    render();
    // 列表 DOM 重建后恢复滚动位置（同步执行已足够，但 RAF 更稳）
    requestAnimationFrame(() => {
        const body = document.getElementById('cv_body');
        if (body) body.scrollTop = saved;
    });
}

function applyReaderPanelExpand(panel) {
    if (isMobileLayout() || !panelEl) return;
    const s = loadSettings();
    if (s.readerExpandMode === 'off') return;
    _readerPanelBeforeExpand = {
        ...getCurrentState(panel),
        positioned: panelEl.classList.contains('cv-window-positioned'),
    };
    panel.classList.add('cv-reader-expanded');
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const w = Math.min(CV_PANEL_READER_W, Math.round(vw * 0.96), vw - CV_PANEL_MARGIN * 2);
    const h = Math.min(CV_PANEL_READER_H, Math.round(vh * 0.94), vh - CV_PANEL_MARGIN * 2);
    applyPanelBox(panel, panelEl, {
        x: Math.round((vw - w) / 2),
        y: Math.round((vh - h) / 2),
        w,
        h,
    }, false);
    applyPanelLayoutClass(panel, 'wide');
}

function restoreReaderPanelExpand(panel) {
    if (!panelEl) return;
    panel.classList.remove('cv-reader-expanded');
    if (_readerPanelBeforeExpand && !isMobileLayout()) {
        applyPanelModeClasses(panelEl, panel, _readerPanelBeforeExpand.mode);
        if (_readerPanelBeforeExpand.positioned || _readerPanelBeforeExpand.mode === 'dock') {
            applyPanelBox(panel, panelEl, _readerPanelBeforeExpand, false);
        } else {
            panelEl.classList.remove('cv-window-positioned');
            panel.style.removeProperty('left');
            panel.style.removeProperty('top');
            panel.style.removeProperty('width');
            panel.style.removeProperty('height');
            applyPanelLayoutClass(panel, getLayoutForWidth(getDefaultPanelBox(_readerPanelBeforeExpand.mode).w));
        }
    }
    _readerPanelBeforeExpand = null;
}

function readerCfg() {
    const cfg = loadSettings();
    const u = { ...DEFAULT_USER_RULES, ...(cfg.userRules || {}) };
    const fs = Number(cfg.readerFontSize);
    const hs = Number(cfg.readerHeadScale);
    const hg = Number(cfg.readerHeadGap);
    const pg = Number(cfg.readerParaGap);
    const lh = Number(cfg.readerLineHeight);
    return {
        strip:   { ...DEFAULT_STRIP,   ...(cfg.strip   || {}) },
        extract: { ...DEFAULT_EXTRACT, ...(cfg.extract || {}) },
        // v0.5.17 自定义正则：必须透出，否则 renderReader 拿到的 cfg.customRegex 是 undefined → 阅读模式正则不生效
        // v0.5.18 用 DEFAULT_CUSTOM_REGEX 兜底，老用户没有 builtinFold 字段时也能拿到默认 true
        customRegex: { ...DEFAULT_CUSTOM_REGEX, ...(cfg.customRegex || {}) },
        userRules: {
            // v0.5.25: enabled 字段彻底废弃（UI 已无开关）。运行路径不再读它，留 true 仅为存档兼容。
            enabled: true,
            strip:   { ...DEFAULT_STRIP,   ...(u.strip   || {}) },
            extract: { ...DEFAULT_EXTRACT, ...(u.extract || {}) },
        },
        pagerMode: cfg.readerPagerMode === 'always' ? 'always' : 'autoHide',
        fontSize: (Number.isFinite(fs) && fs >= 12 && fs <= 28) ? fs : 15,
        headScale: (Number.isFinite(hs) && hs >= 0.8 && hs <= 1.8) ? hs : 1.0,
        headGap:   (Number.isFinite(hg) && hg >= 4 && hg <= 32) ? hg : 14,
        paraGap:   (Number.isFinite(pg) && pg >= 0.2 && pg <= 1.5) ? pg : 0.6,
        lineHeight:(Number.isFinite(lh) && lh >= 1.2 && lh <= 2.6) ? lh : 1.85,
        indent: !!cfg.readerIndent,
        layout: ['default','center','dialog'].includes(cfg.readerLayout) ? cfg.readerLayout : 'default',
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
    const stageStyle = `--cv-reader-font-size:${cfgPre.fontSize}px;--cv-reader-head-scale:${cfgPre.headScale};--cv-reader-head-gap:${cfgPre.headGap}px;--cv-reader-para-gap:${cfgPre.paraGap}em;--cv-reader-line-height:${cfgPre.lineHeight}`;
    const stageOpen = `<div class="cv-reader-stage" data-pager-mode="${cfgPre.pagerMode}" data-indent="${cfgPre.indent ? '1' : '0'}" data-layout="${cfgPre.layout}" style="${stageStyle}"><div class="cv-reader-column">`;
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

    // 处理 + 缓存（依赖 strip/extract/userRules/customRegex 配置，不含 style）
    // v0.5.17: cfgSig 纳入 customRegex，否则改了正则不会重算缓存
    const cfgSig = JSON.stringify({ s: cfg.strip, e: cfg.extract, u: cfg.userRules, r: cfg.customRegex });
    if (readerState._cfgSig !== cfgSig || !readerState._processed) {
        readerState._cfgSig = cfgSig;
        readerState._processed = messages.map((m, idx) => {
            const isUser = !!m?.is_user;
            // v0.5.25: enabled 字段废弃（v0.5.21 曾错误地把折叠态写进它，导致部分用户卡死 false）。
            // user 消息一律走 user-rules；想关掉就把下面的 user · 剥离 / 提取 单项关掉即可。
            const useUser = isUser;
            const s = useUser ? cfg.userRules.strip : cfg.strip;
            const e = useUser ? cfg.userRules.extract : cfg.extract;
            const text = (m && typeof m.mes === 'string') ? processMessageText(m.mes, s, e, cfg.customRegex, isUser) : '';
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

    // v0.5.15 fix: renderReader 顶层没有 s 变量，必须显式 load
    const _readerCfg = loadSettings();
    const _useRichRender = _readerCfg.readerRichRender !== false;

    const cardHtml = slice.map(m => {
        const who = escapeHtml(m.who);
        // 把消息按段落（连续换行视作分段）拆成 <p>，单换行保留为 <br>，便于首行缩进
        // 每个非空"行"包成一段，让首行缩进对每段生效（包含连续换行产生的空行也被丢弃）
        const text = m.text
            ? ((_useRichRender
                    ? sanitizeMd(renderRichMd(m.text))
                    : renderLiteMd(m.text))
                || '<span class="cv-reader-empty">（空）</span>')
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
        const _bmHit = (readerState.character && readerState.fileName)
            ? !!findBookmark(readerState.character.avatar, readerState.fileName, m.idx) : false;
        const _floorTitle = _bmHit ? '已有书签 · 打开楼层菜单' : '打开楼层菜单';
        return `
            <div class="cv-reader-msg ${m.is_user ? 'is-user' : 'is-char'}${_bmHit ? ' has-bookmark' : ''}" data-mes-idx="${m.idx}">
                <div class="cv-reader-msg-head">
                    ${avHtml}
                    <span class="cv-reader-msg-who">${who}</span>
                    <button type="button" class="cv-reader-msg-floor${_bmHit ? ' is-bm' : ''}" data-mes-idx="${m.idx}" title="${_floorTitle}">${_bmHit ? ICONS.bookmark : ''}<span class="cv-floor-num">${_bmHit ? '' : '#'}${m.idx}</span></button>
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
    bindReaderMsgMenu();
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
            // v0.6.0：手机端设置面板是底部抽屉，给面板加个 class 让 CSS 把正文压暗，
            // 抽屉和正文才有层次（纯 CSS 无法根据子元素状态给兄弟元素上样式）
            document.getElementById('chatvault_panel')?.classList.toggle('cv-reader-settings-open', !!open);
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
                // v0.6.0：触屏的惯性滚动会持续产生 1~3px 的抖动，阈值太小会让悬浮条
                // 在阅读时反复闪现。抬高阈值 + 加大底部/顶部保护区，只对“明显滚动”响应。
                if (Math.abs(dy) < 5) return;
                acc = (Math.sign(dy) === Math.sign(acc)) ? acc + dy : dy;
                if (acc > 40)       { hide(); acc = 0; }
                else if (acc < -40) { show(); acc = 0; }
                if (stage.scrollHeight - y - stage.clientHeight < 120) show();
                if (y < 48) show();
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
    if (inp) {
        inp.onkeydown = (e) => { if (e.key === 'Enter') goTo(inp.value); };
        // v0.6.0：手机数字键盘不一定有回车键，离开输入框 / 点击上下箭头也要生效
        let lastCommitted = String(readerState.page);
        const commit = () => {
            if (!inp.isConnected) return;
            const v = String(inp.value).trim();
            if (!v || v === lastCommitted) return;
            lastCommitted = v;
            goTo(v);
        };
        inp.onchange = commit;
        inp.onblur = commit;
    }
    bindReaderSwipe(totalPages, goTo);
}

/* v0.6.0 手机专属：左右滑动翻页
 *  - 只在触屏指针下生效（pointerType !== 'mouse'），桌面行为完全不变
 *  - 必须横滑足够远（>64px）且明显比竖滑更横（>2 倍），否则让给纵向滚动
 *  - 起始点落在按钮/输入框/表格/代码块里时直接放弃，避免抢走交互
 *  - 正在选中文字时也放弃，避免“想选字结果翻页”
 */
function bindReaderSwipe(totalPages, goTo) {
    const stage = document.querySelector('.cv-reader-stage');
    if (!stage || totalPages <= 1) return;
    if (stage._cvSwipeBound) return;
    stage._cvSwipeBound = true;
    const DEAD_X = 64;
    let startX = 0, startY = 0, tracking = false, moved = false;
    const onDown = (e) => {
        if (e.pointerType === 'mouse') return;
        if (e.target.closest('input, textarea, select, button, a, .cv-md-table, .cv-md-pre')) return;
        tracking = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
    };
    const onMove = (e) => {
        if (!tracking) return;
        if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) moved = true;
    };
    const onUp = (e) => {
        if (!tracking) return;
        tracking = false;
        if (e.pointerType === 'mouse') return;
        if (!moved) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) < DEAD_X) return;
        if (Math.abs(dx) < Math.abs(dy) * 2) return;
        if (window.getSelection && String(window.getSelection() || '').length > 0) return;
        goTo(readerState.page + (dx < 0 ? 1 : -1));
    };
    const onCancel = () => { tracking = false; moved = false; };
    stage.addEventListener('pointerdown', onDown, { passive: true });
    stage.addEventListener('pointermove', onMove, { passive: true });
    stage.addEventListener('pointerup', onUp, { passive: true });
    stage.addEventListener('pointercancel', onCancel, { passive: true });
    // 每次 renderReader 都会重建 stage，监听器随节点一起回收，无需手动解绑
}

/* —— v0.4.4 书签入口：唯一入口 = 点击楼层号；不再监听任何长按 / 右键 —— */
function bindReaderMsgMenu() {
    const list = document.querySelector('.cv-reader-list');
    if (!list) return;
    list.querySelectorAll('.cv-reader-msg-floor').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const msg = btn.closest('.cv-reader-msg');
            if (!msg) return;
            const rect = btn.getBoundingClientRect();
            openMsgMenu(msg, rect.left, rect.bottom + 4);
        };
    });
}

function closeMsgMenu() {
    const m = document.getElementById('cv_msg_menu');
    if (m) {
        // v0.5.24: 监听器是延迟到 setTimeout 才注册的；如果在 timeout 触发前关闭菜单，
        //          需要先 clearTimeout 阻止"菜单已 remove 但监听器才挂上"的孤儿监听器泄漏。
        if (m._pendingTimer) { clearTimeout(m._pendingTimer); m._pendingTimer = null; }
        try { m._cleanup && m._cleanup(); } catch {}
        m.remove();
    }
}

function openMsgMenu(msgEl, x, y) {
    closeMsgMenu();
    const idx = Number(msgEl.dataset.mesIdx);
    const { character, fileName } = readerState;
    if (!character || !fileName || !Number.isFinite(idx)) return;
    const exist = findBookmark(character.avatar, fileName, idx);
    const menu = document.createElement('div');
    menu.className = 'cv-msg-menu';
    menu.id = 'cv_msg_menu';
    const bookmarkHtml = exist
        ? `<button data-act="edit" type="button">${ICONS.edit}<span>编辑书签</span></button><button data-act="del" type="button" class="cv-msg-menu-danger">${ICONS.trash}<span>删除书签</span></button>`
        : `<button data-act="add" type="button">${ICONS.bookmarkPlus}<span>添加书签到 #${idx}</span></button>`;
    menu.innerHTML = `
        <button data-act="reader-go" type="button">${ICONS.book}<span>阅读模式跳到楼层…</span></button>
        <button data-act="chat-here" type="button">${ICONS.jump}<span>在酒馆打开 #${idx}</span></button>
        <button data-act="chat-go" type="button">${ICONS.msg}<span>在酒馆跳到楼层…</span></button>
        <div class="cv-msg-menu-sep" aria-hidden="true"></div>
        ${bookmarkHtml}
    `;
    // 挂在 chatvault_panel 内部，才能继承 .cv-theme-* 配色变量；落到 body 会变黑块
    (document.getElementById('chatvault_panel') || document.body).appendChild(menu);
    if (!isMobileLayout()) {
        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        let left = x, top = y;
        if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
        // 优先放在下方；下方放不下且上方更宽敞时放上方
        if (top + rect.height > vh - 8) {
            const above = y - rect.height - 8;
            if (above >= 8) top = above;
            else top = Math.max(8, vh - rect.height - 8);
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }
    menu.querySelectorAll('button').forEach(b => {
        b.onclick = (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            closeMsgMenu();
            if (act === 'reader-go') openFloorJumpModal('reader', idx);
            else if (act === 'chat-here') jumpToChat(character, fileName, { floorIdx: idx });
            else if (act === 'chat-go') openFloorJumpModal('chat', idx);
            else if (act === 'add' || act === 'edit') openBookmarkModal(idx, exist);
            else if (act === 'del') {
                removeBookmark(character.avatar, fileName, idx);
                try { toastr.success(`已删除 #${idx} 书签`); } catch {}
                refreshBookmarkUI(idx);
            }
        };
    });
    // dismiss：只在点击菜单外部时关，避免点击菜单内部按钮被吞
    const onDocDown = (ev) => {
        if (menu.contains(ev.target)) return;
        closeMsgMenu();
    };
    // v0.5.24: 保存 timer id，closeMsgMenu 才能在监听器挂上之前撤销，避免孤儿监听器泄漏
    menu._pendingTimer = setTimeout(() => {
        menu._pendingTimer = null;
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('touchstart', onDocDown, true);
    }, 0);
    menu._cleanup = () => {
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('touchstart', onDocDown, true);
    };
}

/* —— v0.5.2 增删书签后局部刷新，避免 renderReader 把阅读位置回顶 —— */
function refreshBookmarkUI(idx) {
    const ch = readerState.character, fn = readerState.fileName;
    if (!ch || !fn) return;
    const hit = !!findBookmark(ch.avatar, fn, idx);
    // 1) 更新该楼层按钮
    const msgEl = document.querySelector(`.cv-reader-msg[data-mes-idx="${idx}"]`);
    if (msgEl) {
        msgEl.classList.toggle('has-bookmark', hit);
        const btn = msgEl.querySelector('.cv-reader-msg-floor');
        if (btn) {
            btn.classList.toggle('is-bm', hit);
            btn.title = hit ? '已有书签 · 打开楼层菜单' : '打开楼层菜单';
            btn.innerHTML = (hit ? ICONS.bookmark : '')
                + `<span class="cv-floor-num">${hit ? '' : '#'}${idx}</span>`;
        }
    }
    // 2) 设置面板若打开，刷新书签分组（数量、列表）
    if (readerState.settingsOpen) {
        const panel = document.getElementById('cv_reader_settings');
        if (panel) renderReaderSettings(panel);
    }
}

function getReaderMaxFloor() {
    const arr = readerState.arr;
    if (!Array.isArray(arr)) return -1;
    return arr.slice(1).length - 1;
}

function jumpReaderToFloor(idx) {
    const maxFloor = getReaderMaxFloor();
    if (!Number.isInteger(idx) || idx < 0 || idx > maxFloor) {
        toastr.warning(maxFloor >= 0 ? `请输入 0-${maxFloor} 之间的楼层号` : '当前没有可跳转楼层');
        return;
    }
    readerState.page = Math.floor(idx / READER_PAGE_SIZE) + 1;
    readerState.settingsOpen = false;
    renderReader();
    requestAnimationFrame(() => {
        const stage = document.querySelector('.cv-reader-stage');
        const target = document.querySelector(`.cv-reader-msg[data-mes-idx="${idx}"]`);
        if (stage && target) stage.scrollTop = Math.max(0, target.offsetTop - 16);
    });
}

function openFloorJumpModal(mode, defaultIdx) {
    const { character, fileName, arr } = readerState;
    if (!character || !fileName || !Array.isArray(arr)) return;
    const maxFloor = arr.slice(1).length - 1;
    if (maxFloor < 0) { toastr.warning('当前没有可跳转楼层'); return; }
    const safeDefault = Math.min(Math.max(0, Number(defaultIdx) || 0), maxFloor);
    const isChat = mode === 'chat';
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal" onclick="event.stopPropagation()">
            <button class="cv-modal-close" id="cv_floor_jump_close" type="button" title="关闭">${ICONS.close}</button>
            <h3>${isChat ? '酒馆聊天跳转楼层' : '阅读模式跳转楼层'}</h3>
            <div class="cv-modal-body">
                <div class="cv-field">
                    <label>楼层号</label>
                    <input type="number" id="cv_floor_jump_input" min="0" max="${maxFloor}" value="${safeDefault}" />
                    <div class="cv-field-hint">请输入 0-${maxFloor} 之间的楼层号</div>
                </div>
            </div>
            <div class="cv-modal-actions">
                <button class="cv-btn" id="cv_floor_jump_cancel" type="button">取消</button>
                <button class="cv-btn cv-btn-primary" id="cv_floor_jump_go" type="button">跳转</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    // v0.6.0：手机弹窗是底部抽屉，自动聚焦会立刻弹出键盘、把抽屉挤小；
    // 桌面端保持原来的“打开即可输入”。
    if (!isMobileLayout()) setTimeout(() => { const i = document.getElementById('cv_floor_jump_input'); if (i) { i.focus(); i.select(); } }, 0);
    document.getElementById('cv_floor_jump_close').onclick = closeModal;
    document.getElementById('cv_floor_jump_cancel').onclick = closeModal;
    const go = () => {
        const raw = String(document.getElementById('cv_floor_jump_input')?.value || '').trim();
        const idx = Number(raw);
        if (!raw || !Number.isInteger(idx) || idx < 0 || idx > maxFloor) {
            toastr.warning(`请输入 0-${maxFloor} 之间的楼层号`);
            return;
        }
        closeModal();
        if (isChat) jumpToChat(character, fileName, { floorIdx: idx });
        else jumpReaderToFloor(idx);
    };
    document.getElementById('cv_floor_jump_go').onclick = go;
    wrap.querySelectorAll('input').forEach(inp => {
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') go();
            else if (e.key === 'Escape') closeModal();
        };
    });
}

function openBookmarkModal(idx, existing) {
    const { character, fileName, arr } = readerState;
    if (!character || !arr) return;
    const messages = arr.slice(1);
    const m = messages[idx];
    if (!m) return;
    const rawMes = (typeof m.mes === 'string') ? m.mes : '';
    const snippet = bmSnippet(rawMes);
    const note = existing?.note || '';
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal" onclick="event.stopPropagation()">
            <button class="cv-modal-close" id="cv_bm_close" type="button" title="关闭">${ICONS.close}</button>
            <h3>${existing ? '编辑书签' : '添加书签'} · #${idx}</h3>
            <div class="cv-modal-body">
                <div class="cv-field">
                    <label>备注（可选，最多 40 字）</label>
                    <input type="text" id="cv_bm_note" maxlength="40" placeholder="例如：两人第一次牵手" value="${escapeHtml(note)}"/>
                    <div class="cv-field-hint">${existing ? `楼层 #${idx}` : `将为楼层 #${idx} 添加书签`}</div>
                </div>
            </div>
            <div class="cv-modal-actions">
                <button class="cv-btn" id="cv_bm_cancel" type="button">取消</button>
                <button class="cv-btn cv-btn-primary" id="cv_bm_save" type="button">${existing ? '保存修改' : '加入书签'}</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    if (!isMobileLayout()) setTimeout(() => { const i = document.getElementById('cv_bm_note'); if (i) { i.focus(); i.select(); } }, 0);
    document.getElementById('cv_bm_close').onclick = closeModal;
    document.getElementById('cv_bm_cancel').onclick = closeModal;
    const save = () => {
        const noteVal = (document.getElementById('cv_bm_note')?.value || '').trim();
        const ok = upsertBookmark(character.avatar, fileName, idx, snippet, noteVal);
        if (!ok) return;
        closeModal();
        try { toastr.success(`已${existing ? '更新' : '添加'} #${idx} 书签`); } catch {}
        refreshBookmarkUI(idx);
    };
    document.getElementById('cv_bm_save').onclick = save;
    wrap.querySelectorAll('input').forEach(inp => {
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') save();
            else if (e.key === 'Escape') closeModal();
        };
    });
}

function jumpToBookmark(b) {
    if (!b) return;
    const arr = readerState.arr;
    if (!arr) return;
    const messages = arr.slice(1);
    if (!messages.length) return;
    const want = bmFingerprint(b.snippet);
    const fpAt = (i) => {
        const m = messages[i];
        if (!m || typeof m.mes !== 'string') return false;
        if (!want) return true;
        return bmFingerprint(m.mes) === want;
    };
    let found = -1;
    if (b.idx >= 0 && b.idx < messages.length && fpAt(b.idx)) found = b.idx;
    if (found < 0) {
        for (let d = 1; d <= 30; d++) {
            if (b.idx - d >= 0 && fpAt(b.idx - d)) { found = b.idx - d; break; }
            if (b.idx + d < messages.length && fpAt(b.idx + d)) { found = b.idx + d; break; }
        }
    }
    if (found < 0) found = Math.min(messages.length - 1, Math.max(0, b.idx));
    const targetPage = Math.max(1, Math.ceil((found + 1) / READER_PAGE_SIZE));
    readerState.page = targetPage;
    readerState.settingsOpen = false;
    renderReader();
    requestAnimationFrame(() => {
        const stage = document.querySelector('.cv-reader-stage');
        const target = document.querySelector(`.cv-reader-msg[data-mes-idx="${found}"]`);
        if (stage && target) {
            stage.scrollTop = Math.max(0, target.offsetTop - 16);
        }
    });
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
    // v0.5.18 自定义正则配置（带内置开关）
    const creCfg   = { ...DEFAULT_CUSTOM_REGEX, ...(cfg.customRegex || {}) };
    const sw = (id, on, label) => `
        <label class="cv-switch-row">
            <span class="cv-switch-label">${label}</span>
            <span class="cv-switch">
                <input type="checkbox" id="${id}" ${on ? 'checked' : ''}/>
                <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
            </span>
        </label>`;

    // v0.5.18 全部 4 个区块改为可折叠，默认全部收起（用户反馈"东西太多"）
    // 共用 .cv-fold-box / .cv-fold-toggle / .cv-fold-body 结构 + 一个委托 click handler
    host.innerHTML = `
        <div class="cv-strip-box cv-fold-box" data-collapsed="1">
            <div class="cv-strip-title cv-fold-toggle">
                <span class="cv-bm-title-label"><span>剥离</span></span>
                <span class="cv-bm-chev">▾</span>
            </div>
            <div class="cv-fold-body" hidden>
                <div class="cv-field-hint">默认规则 · 适用于 AI / 角色消息（user 消息走"user 单独规则"）</div>
                ${sw(`${px}_s_thinking`, strip.thinking,    '&lt;thinking&gt;…&lt;/thinking&gt;')}
                ${sw(`${px}_s_think`,    strip.think,       '&lt;think&gt;…&lt;/think&gt;')}
                ${sw(`${px}_s_html`,     strip.htmlComment, 'HTML 注释')}
                ${sw(`${px}_s_self`,     strip.selfClosing, '自闭合占位标签 &lt;XxxxImpl/&gt;')}
                ${sw(`${px}_s_md`,       strip.mdHeaders,   'Markdown 标题行（### 正文）')}
                <div class="cv-strip-custom-title">自定义剥离对</div>
                <div id="${px}_s_list"></div>
                <button class="cv-btn cv-strip-add" id="${px}_s_add" type="button">+ 添加</button>
            </div>
        </div>
        <div class="cv-strip-box cv-fold-box" data-collapsed="1">
            <div class="cv-strip-title cv-fold-toggle">
                <span class="cv-bm-title-label"><span>提取</span></span>
                <span class="cv-bm-chev">▾</span>
            </div>
            <div class="cv-fold-body" hidden>
                <div class="cv-field-hint">只保留这些标签内的内容</div>
                <div class="cv-info-tip">
                    <b>提取功能注意</b>：开启后只保留对应标签内的内容（例：<code>&lt;content&gt;…&lt;/content&gt;</code>）。<br>
                    · 原文中<b>完全没出现</b>任一启用的标签：保留原文（兜底，避免消息消失）；<br>
                    · 标签存在但<b>内部为空</b>或仅有空白：渲染结果就是空；<br>
                    · 标签未正确闭合：当成不存在处理，按上面第一条走。
                </div>
                ${sw(`${px}_e_content`, extract.content, '&lt;content&gt;…&lt;/content&gt;')}
                ${sw(`${px}_e_reply`,   extract.reply,   '&lt;reply&gt;…&lt;/reply&gt;')}
                <div class="cv-strip-custom-title">自定义提取对</div>
                <div id="${px}_e_list"></div>
                <button class="cv-btn cv-strip-add" id="${px}_e_add" type="button">+ 添加</button>
            </div>
        </div>
        <div class="cv-strip-box cv-fold-box cv-user-rules-box" data-collapsed="1">
            <div class="cv-strip-title cv-fold-toggle">
                <span class="cv-bm-title-label"><span>user 消息单独规则</span></span>
                <span class="cv-bm-chev">▾</span>
            </div>
            <div class="cv-fold-body" hidden>
                <div class="cv-field-hint">user 消息使用下面这组规则</div>
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
        <div class="cv-strip-box cv-fold-box cv-cre-box" data-collapsed="1">
            <div class="cv-strip-title cv-fold-toggle">
                <span class="cv-bm-title-label"><span>自定义正则</span></span>
                <span class="cv-bm-chev">▾</span>
            </div>
            <div class="cv-fold-body" hidden>
                <div class="cv-field-hint">仅作用于阅读模式与 txt 导出，不修改原文件。不支持酒馆宏与位置/深度限制；上传酒馆 JSON 时这些字段会被忽略。</div>
                <label class="cv-switch-row">
                    <span class="cv-switch-label">
                        通用折叠（隐藏"以下/以上是用户的本轮输入"等上下文泄漏）
                        <code class="cv-cre-builtin-preview">${escapeHtml(BUILTIN_REGEX_FOLD.toString())}</code>
                    </span>
                    <span class="cv-switch">
                        <input type="checkbox" id="${px}_cre_builtin" ${creCfg.builtinFold !== false ? 'checked' : ''}/>
                        <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
                    </span>
                </label>
                <div class="cv-info-tip">
                    <b>使用建议</b>：<br>
                    · 如果"user 消息单独规则"已经能把上下文提取干净，<b>不要</b>再开这条；<br>
                    · 如果开启后某条 user 消息渲染为空，<b>关掉这条</b>再看。
                </div>
                <div id="${px}_cre_list"></div>
                <div class="cv-cre-actions">
                    <button class="cv-btn cv-strip-add" id="${px}_cre_add" type="button">+ 创建</button>
                    <button class="cv-btn cv-strip-add" id="${px}_cre_upload_btn" type="button">↑ 上传 JSON</button>
                    <input type="file" id="${px}_cre_upload" accept=".json,application/json" multiple hidden/>
                </div>
            </div>
        </div>
    `;

    // v0.5.18 折叠区委托 handler（一次绑定，覆盖所有 .cv-fold-toggle）
    // v0.5.21: 折叠纯视觉，不再绑定任何启用态。user 单独规则始终生效（见 readerCfg / 导出处的 useUser）
    host.addEventListener('click', (e) => {
        const t = e.target.closest('.cv-fold-toggle');
        if (!t || !host.contains(t)) return;
        const box = t.closest('.cv-fold-box');
        if (!box) return;
        const body = box.querySelector(':scope > .cv-fold-body');
        const wasCollapsed = box.getAttribute('data-collapsed') !== '0';
        const willOpen = wasCollapsed;
        box.setAttribute('data-collapsed', willOpen ? '0' : '1');
        if (body) body.hidden = !willOpen;
    });

    // v0.5.18 内置「通用折叠」开关
    const builtinChk = host.querySelector('#' + px + '_cre_builtin');
    if (builtinChk) builtinChk.onchange = () => {
        const c = JSON.parse(JSON.stringify(loadSettings()));
        c.customRegex = { ...DEFAULT_CUSTOM_REGEX, ...(c.customRegex || {}), builtinFold: builtinChk.checked };
        saveSettings(c);
        repaint();
    };

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

    // —— v0.5.17 自定义正则：列表渲染 + 创建 + 上传 ——
    const mutateCRE = (mut) => {
        const c = JSON.parse(JSON.stringify(loadSettings()));
        const cur = { items: [], ...(c.customRegex || {}) };
        cur.items = Array.isArray(cur.items) ? cur.items.slice() : [];
        mut(cur);
        c.customRegex = cur;
        saveSettings(c);
    };
    const validRegex = (p, f) => { try { new RegExp(p, f || 'g'); return true; } catch { return false; } };
    // 解析酒馆正则 JSON（单条对象）→ 我们的简化结构；忽略 placement/depth/macros 等
    function parseSillyTavernRegex(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const findRegex = typeof raw.findRegex === 'string' ? raw.findRegex : '';
        if (!findRegex) return null;
        // 形如 "/pattern/flags" → 拆出 pattern + flags（兼容裸 pattern）
        let pattern = findRegex, flags = 'g';
        const m = /^\/((?:\\.|[^\\\/])+)\/([gimsuy]*)$/.exec(findRegex);
        if (m) { pattern = m[1]; flags = m[2] || 'g'; }
        const replace = typeof raw.replaceString === 'string' ? raw.replaceString : '';
        const name = typeof raw.scriptName === 'string' ? raw.scriptName : '';
        // placement: 1=user input, 2=AI output；其他（slash/world/reasoning）我们不支持
        const placement = Array.isArray(raw.placement) ? raw.placement : [];
        const hasUser = placement.includes(1);
        const hasAI   = placement.includes(2);
        let target = 'both';
        if (hasUser && !hasAI) target = 'user';
        else if (hasAI && !hasUser) target = 'ai';
        let enabled = !raw.disabled;
        const suspectMacro = /\{\{[^}]+\}\}/.test(replace);
        if (suspectMacro) enabled = false;
        if (placement.length && !hasUser && !hasAI) enabled = false;
        let nm = name;
        if (suspectMacro) nm = '⚠ ' + (name || '含酒馆宏');
        else if (placement.length && !hasUser && !hasAI) nm = '⚠ ' + (name || '原仅作用于不支持的范围');
        return { name: nm, pattern, flags, replace, target, enabled };
    }
    // v0.5.18: 把 pattern + flags 合并成一个 /pattern/flags 输入框（与酒馆习惯一致）
    // 解析：以 / 开头 → 严格匹配 /…/flags；否则按裸 pattern 处理（兜底，flags=g）
    const parseCombined = (s) => {
        const t = (s || '').trim();
        if (!t) return { pattern: '', flags: 'g', ok: false };
        if (t.startsWith('/')) {
            const m = /^\/((?:\\.|[^\\\/])+)\/([gimsuy]*)$/.exec(t);
            if (m) return { pattern: m[1], flags: m[2] || 'g', ok: true };
            return { pattern: t, flags: 'g', ok: false };  // 形似 /…/ 但拆不出来 → 标错
        }
        return { pattern: t, flags: 'g', ok: true };       // 裸 pattern
    };
    const combineDisplay = (it) => {
        const p = it.pattern || ''; const f = it.flags || 'g';
        return p ? `/${p}/${f}` : '';
    };
    const renderCRE = () => {
        const list = host.querySelector('#' + px + '_cre_list');
        if (!list) return;
        const cur = ((loadSettings().customRegex) || {}).items || [];
        if (!cur.length) { list.innerHTML = '<div class="cv-field-hint">（暂无）</div>'; return; }
        list.innerHTML = cur.map((it, i) => {
            const enabled = it.enabled !== false;
            const valid = validRegex(it.pattern || '', it.flags || 'g');
            const labelText = it.name || combineDisplay(it) || '(未命名)';
            const tgt = it.target === 'user' ? 'user' : it.target === 'ai' ? 'AI' : '全部';
            return `
            <div class="cv-cre-row" data-i="${i}" data-collapsed="1">
                <div class="cv-cre-head">
                    <label class="cv-switch cv-cre-en" title="启用">
                        <input type="checkbox" class="cv-cre-en-i" ${enabled?'checked':''}/>
                        <span class="cv-switch-track"><span class="cv-switch-thumb"></span></span>
                    </label>
                    <span class="cv-cre-name ${valid?'':'is-bad'}">${escapeHtml(labelText)}</span>
                    <span class="cv-cre-tgt">${tgt}</span>
                    <button class="cv-cre-toggle" type="button" title="展开/收起">▾</button>
                    <button class="cv-strip-del cv-cre-del" type="button" title="删除">×</button>
                </div>
                <div class="cv-cre-body-row" hidden>
                    <label class="cv-cre-label">名称<input type="text" class="cv-cre-fname" placeholder="（可选）" value="${escapeHtml(it.name || '')}"/></label>
                    <label class="cv-cre-label">查找正则<input type="text" class="cv-cre-fcombined" placeholder="/pattern/flags（与酒馆格式一致）" value="${escapeHtml(combineDisplay(it))}"/></label>
                    <label class="cv-cre-label">替换为<input type="text" class="cv-cre-frep" placeholder="留空 = 删除" value="${escapeHtml(it.replace || '')}"/></label>
                    <div class="cv-cre-target">
                        <span class="cv-cre-label-inline">作用对象</span>
                        <label><input type="radio" name="${px}_cre_t_${i}" value="both" ${(!it.target||it.target==='both')?'checked':''}/> 全部</label>
                        <label><input type="radio" name="${px}_cre_t_${i}" value="user" ${it.target==='user'?'checked':''}/> 仅 user</label>
                        <label><input type="radio" name="${px}_cre_t_${i}" value="ai" ${it.target==='ai'?'checked':''}/> 仅 AI</label>
                    </div>
                    <div class="cv-cre-err" ${valid?'hidden':''}>正则语法错误，已跳过此条</div>
                </div>
            </div>`;
        }).join('');
        list.querySelectorAll('.cv-cre-row').forEach(row => {
            const i = Number(row.dataset.i);
            const head = row.querySelector('.cv-cre-head');
            const body = row.querySelector('.cv-cre-body-row');
            const tog  = row.querySelector('.cv-cre-toggle');
            const expand = (open) => {
                row.dataset.collapsed = open ? '0' : '1';
                body.hidden = !open;
                tog.textContent = open ? '▴' : '▾';
            };
            head.addEventListener('click', (e) => {
                if (e.target.closest('.cv-cre-en, .cv-cre-del, input, label')) return;
                expand(row.dataset.collapsed !== '0');
            });
            tog.onclick = (e) => { e.stopPropagation(); expand(row.dataset.collapsed !== '0'); };
            // 启用开关
            const enInp = row.querySelector('.cv-cre-en-i');
            enInp.onchange = () => { mutateCRE(c => { if (c.items[i]) c.items[i].enabled = enInp.checked; }); repaint(); };
            // 字段：oninput 只存、blur 才 repaint（避免输入时父节点重渲毁焦/中文输入法关闭）
            const nm = row.querySelector('.cv-cre-fname');
            const cb = row.querySelector('.cv-cre-fcombined');
            const rp = row.querySelector('.cv-cre-frep');
            const errEl = row.querySelector('.cv-cre-err');
            const saveOnly = () => mutateCRE(c => {
                if (!c.items[i]) return;
                const parsed = parseCombined(cb.value);
                c.items[i] = { ...c.items[i], name: nm.value, pattern: parsed.pattern, flags: parsed.flags, replace: rp.value };
            });
            const refreshErr = () => {
                const parsed = parseCombined(cb.value);
                const ok = parsed.ok && validRegex(parsed.pattern, parsed.flags);
                errEl.hidden = ok;
                cb.classList.toggle('is-bad', !ok && cb.value.trim() !== '');
            };
            let focusVal = '';
            [nm, cb, rp].forEach(el => {
                el.oninput = () => { saveOnly(); if (el === cb) refreshErr(); };
                el.onfocus = () => { focusVal = el.value; };
                el.onblur  = () => { if (el.value !== focusVal) setTimeout(repaint, 0); };
            });
            // 作用对象
            row.querySelectorAll(`input[name="${px}_cre_t_${i}"]`).forEach(r => {
                r.onchange = () => {
                    if (!r.checked) return;
                    mutateCRE(c => { if (c.items[i]) c.items[i].target = r.value; });
                    repaint();
                };
            });
            // 删除
            row.querySelector('.cv-cre-del').onclick = (e) => {
                e.stopPropagation();
                mutateCRE(c => { c.items = c.items.filter((_, k) => k !== i); });
                renderCRE(); repaint();
            };
        });
    };
    renderCRE();
    // 折叠由 host 顶层的 cv-fold-toggle 委托 handler 统一处理（v0.5.18）
    const creBox = host.querySelector('.cv-cre-box');
    const creBody = creBox && creBox.querySelector(':scope > .cv-fold-body');
    const expandCREBox = () => {
        if (!creBox) return;
        creBox.setAttribute('data-collapsed', '0');
        if (creBody) creBody.hidden = false;
    };
    // + 创建
    const creAddBtn = host.querySelector('#' + px + '_cre_add');
    if (creAddBtn) creAddBtn.onclick = () => {
        mutateCRE(c => { c.items = [...c.items, { name:'', pattern:'', flags:'g', replace:'', target:'both', enabled:true }]; });
        expandCREBox();
        renderCRE();
        // 自动展开新行 + 聚焦输入框
        const rows = host.querySelectorAll('.cv-cre-row');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
            lastRow.dataset.collapsed = '0';
            const lb = lastRow.querySelector('.cv-cre-body-row');
            if (lb) lb.hidden = false;
            const ltog = lastRow.querySelector('.cv-cre-toggle'); if (ltog) ltog.textContent = '▴';
            const ip = lastRow.querySelector('.cv-cre-fcombined'); if (ip) ip.focus();
        }
    };
    // ↑ 上传 JSON（接受单条 / 数组 / 多文件）
    const upBtn = host.querySelector('#' + px + '_cre_upload_btn');
    const upInp = host.querySelector('#' + px + '_cre_upload');
    if (upBtn && upInp) {
        upBtn.onclick = () => upInp.click();
        upInp.onchange = async () => {
            const files = Array.from(upInp.files || []);
            upInp.value = '';
            if (!files.length) return;
            const parsed = []; const skipped = [];
            for (const f of files) {
                try {
                    const data = JSON.parse(await f.text());
                    const arr = Array.isArray(data) ? data : [data];
                    for (const r of arr) {
                        const mapped = parseSillyTavernRegex(r);
                        if (mapped) parsed.push(mapped); else skipped.push(f.name);
                    }
                } catch { skipped.push(f.name + '（解析失败）'); }
            }
            if (parsed.length) {
                mutateCRE(c => { c.items = [...c.items, ...parsed]; });
                expandCREBox();
                renderCRE(); repaint();
            }
            const msg = `导入 ${parsed.length} 条` + (skipped.length ? `；跳过 ${skipped.length} 处：${[...new Set(skipped)].slice(0,3).join(', ')}` : '');
            try { toastr.info(msg); } catch { setStatus(msg); }
        };
    }

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

    // v0.5.19: user 独立规则总开关已删除 —— 折叠状态本身即启用状态（见委托 handler）

    // v0.5.20: 提取说明已平铺为常驻 .cv-info-tip，无需 toggle handler
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
    const curPager = cfg.readerPagerMode === 'always' ? 'always' : 'autoHide';
    panel.innerHTML = `
        <div class="cv-reader-settings-header">
            <span class="cv-reader-settings-title">阅读模式设置</span>
            <button class="cv-reader-settings-close" id="cv_r_close" type="button" title="关闭">×</button>
        </div>
        <div class="cv-reader-settings-body">
            <div class="cv-strip-box cv-bm-box" data-collapsed="${ (rChar.avatar && rFile && getBookmarks(rChar.avatar, rFile).length) ? '0' : '1' }">
                <div class="cv-strip-title cv-bm-toggle" id="cv_r_bm_toggle">
                    <span class="cv-bm-title-label">${ICONS.bookmark}<span>书签 (${ (rChar.avatar && rFile) ? getBookmarks(rChar.avatar, rFile).length : 0 })</span></span>
                    <span class="cv-bm-chev">▾</span>
                </div>
                <div class="cv-bm-body" id="cv_r_bm_body" ${ (rChar.avatar && rFile && getBookmarks(rChar.avatar, rFile).length) ? '' : 'hidden' }>
                    ${ (() => {
                        const _list = (rChar.avatar && rFile) ? getBookmarks(rChar.avatar, rFile) : [];
                        if (!_list.length) return '<div class="cv-field-hint">还没有书签。阅读时点击消息右上角的楼层号 <code>#N</code> 即可添加。</div>';
                        return _list.map(b => `
                            <div class="cv-bm-item" data-idx="${b.idx}">
                                <button class="cv-bm-jump" type="button" title="跳转到 #${b.idx}">
                                    <span class="cv-bm-floor">#${b.idx}</span>
                                    <span class="cv-bm-text">${escapeHtml(b.note || `楼层 ${b.idx}`)}</span>
                                </button>
                                <button class="cv-bm-edit" type="button" title="编辑备注">${ICONS.edit}</button>
                                <button class="cv-bm-del" type="button" title="删除">${ICONS.trash}</button>
                            </div>
                        `).join('');
                    })() }
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
                <div class="cv-strip-title">头部排版</div>
                <div class="cv-field-hint">头像 / 名字 / 楼层号的对齐方式（不影响正文）。</div>
                <div class="cv-reader-style-row">
                    <label class="cv-reader-style-opt ${ (cfg.readerLayout||'default')==='default'?'is-on':'' }">
                        <input type="radio" name="cv_r_layout" value="default" ${ (cfg.readerLayout||'default')==='default'?'checked':'' }/>
                        <span class="cv-reader-style-name">默认</span>
                        <span class="cv-reader-style-desc">头像左 · 楼层右</span>
                    </label>
                    <label class="cv-reader-style-opt ${ cfg.readerLayout==='center'?'is-on':'' }">
                        <input type="radio" name="cv_r_layout" value="center" ${ cfg.readerLayout==='center'?'checked':'' }/>
                        <span class="cv-reader-style-name">居中</span>
                        <span class="cv-reader-style-desc">头像 / 名字 / 楼层全居中</span>
                    </label>
                    <label class="cv-reader-style-opt ${ cfg.readerLayout==='dialog'?'is-on':'' }">
                        <input type="radio" name="cv_r_layout" value="dialog" ${ cfg.readerLayout==='dialog'?'checked':'' }/>
                        <span class="cv-reader-style-name">左右分</span>
                        <span class="cv-reader-style-desc">AI 在左 · 你在右</span>
                    </label>
                </div>
            </div>
            <div class="cv-strip-box">
                <div class="cv-strip-title">正文字号 / 段落 / 头部间距</div>
                <div class="cv-slider-label">字号</div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_fontsize" min="13" max="28" step="0.5" value="${cfg.readerFontSize || 15}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_fontsize_val">${cfg.readerFontSize || 15}px</span>
                </div>
                <div class="cv-slider-label">段落之间间距 <span class="cv-slider-label-sub">行与行之间的呼吸</span></div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_paragap" min="0.2" max="1.5" step="0.05" value="${(Number(cfg.readerParaGap) || 0.6).toFixed(2)}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_paragap_val">${(Number(cfg.readerParaGap) || 0.6).toFixed(2)}em</span>
                </div>
                <div class="cv-slider-label">行间距 <span class="cv-slider-label-sub">同段内上下行的距离</span></div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_lineheight" min="1.2" max="2.6" step="0.05" value="${(Number(cfg.readerLineHeight) || 1.85).toFixed(2)}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_lineheight_val">${(Number(cfg.readerLineHeight) || 1.85).toFixed(2)}</span>
                </div>
                <div class="cv-slider-label">头部到正文间距 <span class="cv-slider-label-sub">角色名下方留白</span></div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_headgap" min="4" max="32" step="1" value="${Number(cfg.readerHeadGap) || 14}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_headgap_val">${Number(cfg.readerHeadGap) || 14}px</span>
                </div>
                ${sw('cv_r_indent', !!cfg.readerIndent, '段落首行缩进 2 字')}
            </div>
            <div class="cv-strip-box" id="cv_r_headscale_box">
                <div class="cv-strip-title">卡片头部大小（头像 / 角色名 / 楼层号）</div>
                <div class="cv-reader-fontsize-row">
                    <input type="range" id="cv_r_headscale" min="0.8" max="1.8" step="0.05" value="${(Number(cfg.readerHeadScale) || 1).toFixed(2)}"/>
                    <span class="cv-reader-fontsize-val" id="cv_r_headscale_val">${Math.round((Number(cfg.readerHeadScale) || 1) * 100)}%</span>
                </div>
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

    // v0.5.26: 阅读模式的"配色方案"块已删除——它本就只改 chatvault_panel 自身样式，
    //           跟主面板设置完全重复。配色统一在主设置面板里改。
    panel.querySelectorAll('input[name="cv_r_pager"]').forEach(r => {
        r.onchange = () => {
            if (!r.checked) return;
            const c = loadSettings();
            saveSettings({ ...c, readerPagerMode: r.value === 'always' ? 'always' : 'autoHide' });
            renderReader();
        };
    });

    panel.querySelectorAll('input[name="cv_r_layout"]').forEach(r => {
        r.onchange = () => {
            if (!r.checked) return;
            const c = loadSettings();
            saveSettings({ ...c, readerLayout: r.value });
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.dataset.layout = r.value;
            panel.querySelectorAll('input[name="cv_r_layout"]').forEach(x => {
                x.closest('.cv-reader-style-opt')?.classList.toggle('is-on', x.checked);
            });
        };
    });

    /* 书签分组：折叠 / 跳转 / 删除 */
    const bmToggle = document.getElementById('cv_r_bm_toggle');
    const bmBody = document.getElementById('cv_r_bm_body');
    if (bmToggle && bmBody) bmToggle.onclick = () => {
        bmBody.hidden = !bmBody.hidden;
        bmToggle.parentElement.dataset.collapsed = bmBody.hidden ? '1' : '0';
    };
    panel.querySelectorAll('.cv-bm-item').forEach(item => {
        const idx = Number(item.dataset.idx);
        const jump = item.querySelector('.cv-bm-jump');
        const edit = item.querySelector('.cv-bm-edit');
        const del  = item.querySelector('.cv-bm-del');
        if (jump) jump.onclick = (e) => {
            e.stopPropagation();
            const b = (rChar.avatar && rFile) ? findBookmark(rChar.avatar, rFile, idx) : null;
            if (b) jumpToBookmark(b);
        };
        if (edit) edit.onclick = (e) => {
            e.stopPropagation();
            const b = (rChar.avatar && rFile) ? findBookmark(rChar.avatar, rFile, idx) : null;
            if (b) openBookmarkModal(idx, b);
        };
        if (del) del.onclick = (e) => {
            e.stopPropagation();
            removeBookmark(rChar.avatar, rFile, idx);
            refreshBookmarkUI(idx); // 同步消息楼层按钮 + 重画书签列表
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
    // 段落间距滑块（em）
    const pgInput = document.getElementById('cv_r_paragap');
    const pgVal   = document.getElementById('cv_r_paragap_val');
    if (pgInput) {
        const apply = (save) => {
            const v = Math.max(0.2, Math.min(1.5, Number(pgInput.value) || 0.6));
            if (pgVal) pgVal.textContent = v.toFixed(2) + 'em';
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.style.setProperty('--cv-reader-para-gap', v + 'em');
            if (save) {
                const c = loadSettings();
                saveSettings({ ...c, readerParaGap: v });
            }
        };
        pgInput.oninput  = () => apply(false);
        pgInput.onchange = () => apply(true);
    }
    // 行间距滑块（unitless line-height）
    const lhInput = document.getElementById('cv_r_lineheight');
    const lhVal   = document.getElementById('cv_r_lineheight_val');
    if (lhInput) {
        const apply = (save) => {
            const v = Math.max(1.2, Math.min(2.6, Number(lhInput.value) || 1.85));
            if (lhVal) lhVal.textContent = v.toFixed(2);
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.style.setProperty('--cv-reader-line-height', String(v));
            if (save) {
                const c = loadSettings();
                saveSettings({ ...c, readerLineHeight: v });
            }
        };
        lhInput.oninput  = () => apply(false);
        lhInput.onchange = () => apply(true);
    }
    // 头部到正文间距滑块（px）
    const hgInput = document.getElementById('cv_r_headgap');
    const hgVal   = document.getElementById('cv_r_headgap_val');
    if (hgInput) {
        const apply = (save) => {
            const v = Math.max(4, Math.min(32, Math.round(Number(hgInput.value) || 14)));
            if (hgVal) hgVal.textContent = v + 'px';
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.style.setProperty('--cv-reader-head-gap', v + 'px');
            if (save) {
                const c = loadSettings();
                saveSettings({ ...c, readerHeadGap: v });
            }
        };
        hgInput.oninput  = () => apply(false);
        hgInput.onchange = () => apply(true);
    }
    // 卡片头部缩放滑块
    const hsInput = document.getElementById('cv_r_headscale');
    const hsVal   = document.getElementById('cv_r_headscale_val');
    if (hsInput) {
        const apply = (save) => {
            const v = Math.max(0.8, Math.min(1.8, Number(hsInput.value) || 1));
            if (hsVal) hsVal.textContent = Math.round(v * 100) + '%';
            const stage = document.querySelector('.cv-reader-stage');
            if (stage) stage.style.setProperty('--cv-reader-head-scale', String(v));
            if (save) {
                const c = loadSettings();
                saveSettings({ ...c, readerHeadScale: v });
            }
        };
        hsInput.oninput  = () => apply(false);
        hsInput.onchange = () => apply(true);
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

function chatArrayToJsonl(arr) {
    return (Array.isArray(arr) ? arr : []).map(o => JSON.stringify(o)).join('\n') + '\n';
}

function safeChatExportBaseName(fileName) {
    return stripExt(fileName).replace(/[\\/:*?"<>|]/g, '_') || 'chat';
}

function timestampForFileName() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function downloadChatArrayJsonl(arr, fileName, suffix = '') {
    const safeName = safeChatExportBaseName(fileName);
    const name = suffix ? `${safeName}.${suffix}.jsonl` : `${safeName}.jsonl`;
    downloadBlob(new Blob([chatArrayToJsonl(arr)], { type: 'application/x-jsonlines' }), name);
}

function jsonlFileFromArray(arr, fileName) {
    return new File([chatArrayToJsonl(arr)], withExt(fileName), { type: 'application/x-jsonlines' });
}

async function postImportChatFile(character, file) {
    const ctx = SillyTavern.getContext();
    const userName = ctx.name1 || ctx.user?.name || 'User';
    const fd = new FormData();
    fd.append('avatar_url', character.avatar);
    fd.append('file_type', 'jsonl');
    fd.append('user_name', userName);
    fd.append('character_name', character.name || 'Character');
    // ST 全局 multer 配置是 .single('avatar')，只允许这一个文件字段。
    fd.append('avatar', file, file.name);

    const reqHeaders = headers();
    // multipart 不能手动设 Content-Type
    delete reqHeaders['Content-Type'];
    delete reqHeaders['content-type'];

    const res = await fetch('/api/chats/import', { method: 'POST', headers: reqHeaders, body: fd });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt.slice(0, 120)}`);
    }
}

async function postSaveChatArray(character, fileName, arr) {
    await _headersReady.catch(() => {});
    const res = await fetch('/api/chats/save', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            avatar_url: character.avatar,
            file_name: stripExt(fileName),
            chat: arr,
            force: true,
        }),
    });
    if (!res.ok) {
        let msg = '';
        try {
            const data = await res.json();
            msg = data?.error ? String(data.error) : JSON.stringify(data).slice(0, 120);
        } catch {
            msg = await res.text().then(t => t.slice(0, 120)).catch(() => '');
        }
        throw new Error(`HTTP ${res.status}${msg ? ' ' + msg : ''}`);
    }
}

async function exportChatJsonl(character, fileName) {
    setStatus('正在导出 jsonl…');
    try {
        const arr = await fetchFullChat(character, fileName);
        downloadChatArrayJsonl(arr, fileName);
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
            // v0.5.25: 与阅读模式一致——enabled 字段废弃，user 消息一律走 user-rules
            const useUser = isUser;
            const s = useUser ? ustrip   : strip;
            const e = useUser ? uextract : extract;
            const who = isUser
                ? (m.name && m.name !== 'unused' ? m.name : userName)
                : (m.name || charName);
            const cleaned = processMessageText(m.mes, s, e, cfg.customRegex, isUser);
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
        await postImportChatFile(character, file);
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
 *  聊天楼层整理
 * ============================================================ */

const ORGANIZER_PAGE_SIZE = 100;

function cloneOrganizerObject(obj) {
    try {
        if (typeof structuredClone === 'function') return structuredClone(obj);
    } catch {}
    try { return JSON.parse(JSON.stringify(obj)); }
    catch { return obj; }
}

function cleanOrganizerPreview(text, maxLen = 140) {
    return makePreviewSnippet(text, maxLen) || '（空消息）';
}

function getOrganizerMessageKind(msg) {
    if (msg?.is_system) return 'system';
    if (msg?.is_user) return 'user';
    if (msg && typeof msg.mes === 'string') return 'char';
    return 'unknown';
}

function getOrganizerMessageName(msg, character, meta) {
    if (msg?.name && msg.name !== 'unused') return msg.name;
    if (msg?.is_user) return meta?.user_name && meta.user_name !== 'unused' ? meta.user_name : '用户';
    return character?.name || meta?.character_name || '角色';
}

function buildOrganizerState(arr, character) {
    const originalArr = (Array.isArray(arr) ? arr : []).map(cloneOrganizerObject);
    const meta = cloneOrganizerObject(originalArr[0] || {});
    const rows = originalArr.slice(1).map((msg, i) => ({
        id: `org_${i + 1}`,
        originalIndex: i,
        msg: cloneOrganizerObject(msg),
    }));
    return {
        character,
        originalArr,
        meta,
        rows,
        selectedIds: new Set(),
        lastSelectedIndex: null,
        dirty: false,
        backupDownloaded: false,
        skipBackup: false,
        page: 1,
        pageSize: ORGANIZER_PAGE_SIZE,
        draggingRange: null,
        dragOverIndex: null,
        dragOverSide: '',
        helpOpen: false,
    };
}

function buildArrangedChatArray(state) {
    return [cloneOrganizerObject(state.meta), ...state.rows.map(r => cloneOrganizerObject(r.msg))];
}

function getOrganizerChangeSummary(state) {
    const arranged = buildArrangedChatArray(state);
    const originalCount = Math.max(0, state.originalArr.length - 1);
    const newCount = Math.max(0, arranged.length - 1);
    const deletedCount = Math.max(0, originalCount - newCount);
    const originalMsgs = state.originalArr.slice(1).map(o => JSON.stringify(o));
    const arrangedMsgs = arranged.slice(1).map(o => JSON.stringify(o));
    const orderChanged = originalMsgs.length !== arrangedMsgs.length || originalMsgs.some((s, i) => s !== arrangedMsgs[i]);
    return { originalCount, newCount, deletedCount, orderChanged };
}

function formatOrganizerSaveSummary(fileName, state) {
    const s = getOrganizerChangeSummary(state);
    const backupText = state.backupDownloaded ? '已下载' : (state.skipBackup ? '已跳过（用户确认风险）' : '未备份');
    return `即将保存整理结果到原聊天：\n\n文件：${withExt(fileName)}\n\n本次更改：\n- 原始楼层：${s.originalCount} 楼\n- 保存后楼层：${s.newCount} 楼\n- 删除楼层：${s.deletedCount} 楼\n- 楼层顺序：${s.orderChanged ? '已调整' : '未变化'}\n- 原文件备份：${backupText}\n\n确认后会调用酒馆保存接口，写回服务器上的原聊天文件。`;
}

function getSelectedIndexes(state) {
    return state.rows
        .map((r, i) => state.selectedIds.has(r.id) ? i : -1)
        .filter(i => i >= 0)
        .sort((a, b) => a - b);
}

function getSelectedContiguousRange(state) {
    const indexes = getSelectedIndexes(state);
    if (!indexes.length) return null;
    for (let i = 1; i < indexes.length; i++) {
        if (indexes[i] !== indexes[i - 1] + 1) return null;
    }
    return { start: indexes[0], end: indexes[indexes.length - 1] };
}

function selectOrganizerIndexes(state, start, end) {
    state.selectedIds.clear();
    for (let i = start; i <= end; i++) {
        if (state.rows[i]) state.selectedIds.add(state.rows[i].id);
    }
    state.lastSelectedIndex = end;
}

function getOrganizerTotalPages(state) {
    return Math.max(1, Math.ceil(state.rows.length / Math.max(1, state.pageSize || ORGANIZER_PAGE_SIZE)));
}

function clampOrganizerPage(state) {
    const totalPages = getOrganizerTotalPages(state);
    state.page = Math.min(Math.max(1, Number(state.page) || 1), totalPages);
    return totalPages;
}

function setOrganizerPageForIndex(state, index) {
    if (!state.rows.length) { state.page = 1; return; }
    const safeIndex = Math.min(Math.max(0, index || 0), state.rows.length - 1);
    state.page = Math.floor(safeIndex / Math.max(1, state.pageSize || ORGANIZER_PAGE_SIZE)) + 1;
    clampOrganizerPage(state);
}

function finishOrganizerMutation(state, start, end) {
    state.dirty = true;
    if (state.rows.length) {
        const s = Math.min(Math.max(0, start), state.rows.length - 1);
        const e = Math.min(Math.max(s, end), state.rows.length - 1);
        selectOrganizerIndexes(state, s, e);
        setOrganizerPageForIndex(state, s);
    } else {
        state.selectedIds.clear();
        state.lastSelectedIndex = null;
        state.page = 1;
    }
}

function renderOrganizerPagerHtml(state, currentCount, pageStart, pageEnd) {
    const totalPages = getOrganizerTotalPages(state);
    if (currentCount <= state.pageSize) return '';
    return `
        <div class="cv-organizer-pager">
            <div class="cv-organizer-pager-info">显示 #${pageStart} - #${Math.max(pageStart, pageEnd - 1)} / 共 ${currentCount} 楼</div>
            <div class="cv-organizer-pager-main">
                <button class="cv-organizer-page-btn" id="cv_org_first" type="button" ${state.page <= 1 ? 'disabled' : ''}>« 首页</button>
                <button class="cv-organizer-page-btn" id="cv_org_prev" type="button" ${state.page <= 1 ? 'disabled' : ''}>‹ 上一页</button>
                <span>第</span>
                <input class="cv-organizer-page-input" id="cv_org_page" type="number" min="1" max="${totalPages}" value="${state.page}" />
                <span>/ ${totalPages} 页</span>
                <button class="cv-organizer-page-btn" id="cv_org_next" type="button" ${state.page >= totalPages ? 'disabled' : ''}>下一页 ›</button>
                <button class="cv-organizer-page-btn" id="cv_org_last" type="button" ${state.page >= totalPages ? 'disabled' : ''}>末页 »</button>
            </div>
        </div>
    `;
}

function moveOrganizerBlockUp(rows, start, end) {
    if (start <= 0) return { changed: false, start, end };
    const before = rows[start - 1];
    const block = rows.slice(start, end + 1);
    rows.splice(start - 1, end - start + 2, ...block, before);
    return { changed: true, start: start - 1, end: end - 1 };
}

function moveOrganizerBlockDown(rows, start, end) {
    if (end >= rows.length - 1) return { changed: false, start, end };
    const after = rows[end + 1];
    const block = rows.slice(start, end + 1);
    rows.splice(start, end - start + 2, after, ...block);
    return { changed: true, start: start + 1, end: end + 1 };
}

function moveOrganizerBlockToTop(rows, start, end) {
    if (start <= 0) return { changed: false, start, end };
    const block = rows.splice(start, end - start + 1);
    rows.unshift(...block);
    return { changed: true, start: 0, end: block.length - 1 };
}

function moveOrganizerBlockToBottom(rows, start, end) {
    if (end >= rows.length - 1) return { changed: false, start, end };
    const block = rows.splice(start, end - start + 1);
    rows.push(...block);
    return { changed: true, start: rows.length - block.length, end: rows.length - 1 };
}

function deleteOrganizerBlock(rows, start, end) {
    if (start < 0 || end < start || end >= rows.length) return { changed: false, start, end };
    rows.splice(start, end - start + 1);
    const nextStart = Math.min(start, Math.max(0, rows.length - 1));
    return { changed: true, start: nextStart, end: nextStart };
}

function moveOrganizerBlockToFloor(rows, start, end, targetFloor) {
    const len = end - start + 1;
    const total = rows.length;
    const maxStartFloor = total - len;
    if (!Number.isInteger(targetFloor) || targetFloor < 0 || targetFloor > maxStartFloor) {
        return { changed: false, invalid: true, maxStartFloor, start, end };
    }
    const targetIndex = targetFloor;
    if (targetIndex === start) return { changed: false, start, end };
    const block = rows.splice(start, len);
    rows.splice(targetIndex, 0, ...block);
    return { changed: true, start: targetIndex, end: targetIndex + len - 1 };
}

function organizerRangeOrWarn(state) {
    const range = getSelectedContiguousRange(state);
    if (!range) {
        toastr.warning(state.selectedIds.size ? '请先选择连续楼层' : '请先选择楼层');
        return null;
    }
    return range;
}


function renderOrganizerBody(wrap, state, character, fileName) {
    const body = wrap.querySelector('#cv_org_body');
    const actions = wrap.querySelector('#cv_org_actions');
    clampOrganizerPage(state);
    const range = getSelectedContiguousRange(state);
    const selected = getSelectedIndexes(state);
    const originalCount = Math.max(0, state.originalArr.length - 1);
    const currentCount = state.rows.length;
    const deletedCount = originalCount - currentCount;
    const pageSize = Math.max(1, state.pageSize || ORGANIZER_PAGE_SIZE);
    const pageStart = (state.page - 1) * pageSize;
    const pageEnd = Math.min(currentCount, pageStart + pageSize);
    const pageRows = state.rows.slice(pageStart, pageEnd);
    const rowsHtml = pageRows.length ? pageRows.map((row, localI) => {
        const i = pageStart + localI;
        const kind = getOrganizerMessageKind(row.msg);
        const selectedClass = state.selectedIds.has(row.id) ? ' is-selected' : '';
        const draggingClass = state.draggingRange && i >= state.draggingRange.start && i <= state.draggingRange.end ? ' is-dragging' : '';
        const dropClass = state.dragOverIndex === i && state.dragOverSide ? ` is-drop-${state.dragOverSide}` : '';
        const name = getOrganizerMessageName(row.msg, character, state.meta);
        const preview = cleanOrganizerPreview(row.msg?.mes);
        return `
            <div class="cv-organizer-row${selectedClass}${draggingClass}${dropClass}" data-i="${i}" draggable="${isMobileLayout() ? 'false' : 'true'}">
                <label class="cv-organizer-check" title="选择这一楼">
                    <input type="checkbox" ${state.selectedIds.has(row.id) ? 'checked' : ''} />
                </label>
                <div class="cv-organizer-index">
                    <strong>#${i}</strong>
                    <span>原 #${row.originalIndex}</span>
                </div>
                <div class="cv-organizer-speaker">
                    <span class="cv-organizer-kind is-${kind}">${escapeHtml(kind)}</span>
                    <span>${escapeHtml(name)}</span>
                </div>
                <button class="cv-organizer-preview" type="button" aria-label="预览第 ${i} 层完整消息" title="点击查看完整消息">
                    <span class="cv-organizer-preview-text">${escapeHtml(preview)}</span>
                    <span class="cv-organizer-preview-action">预览消息</span>
                </button>
            </div>
        `;
    }).join('') : '<div class="cv-organizer-empty">没有可整理楼层</div>';
    const selectionHint = range
        ? `已选择全局 #${range.start} - #${range.end}，共 ${range.end - range.start + 1} 楼`
        : (selected.length ? `当前选择不是连续区间，共 ${selected.length} 楼；移动/删除前请选择连续楼层` : '可点击行、Shift 连选，或输入全局层数范围选择');
    const pagerHtml = renderOrganizerPagerHtml(state, currentCount, pageStart, pageEnd);

    body.innerHTML = `
        <div class="cv-organizer-head">
            <div><strong>${escapeHtml(withExt(fileName))}</strong></div>
            <div>原 ${originalCount} 楼 / 当前 ${currentCount} 楼${deletedCount > 0 ? ` / 已移除 ${deletedCount} 楼` : ''}</div>
        </div>
        <div class="cv-organizer-help-row">
            <button class="cv-organizer-help-toggle${state.helpOpen ? ' is-open' : ''}" id="cv_org_help" type="button" aria-expanded="${state.helpOpen ? 'true' : 'false'}" title="整理说明">?</button>
            <span>整理说明</span>
        </div>
        <div class="cv-organizer-warning" id="cv_org_help_body" ${state.helpOpen ? '' : 'hidden'}>整理结果只在弹窗内预览。写回前请先“备份原文件”，再点“保存更改”；保存时会二次确认并验证覆盖结果。${isMobileLayout() ? '当前页请用「上移 / 下移 / 移动到第 N 层」按钮调整顺序（手机不支持拖拽），跨页同样用「移动到第 N 层」。' : '当前页可拖拽，跨页请用“移动到第 N 层”。'}</div>
        <div class="cv-organizer-range">
            <span>选择</span>
            <input id="cv_org_start" type="number" min="0" max="${Math.max(0, currentCount - 1)}" placeholder="起始" />
            <span>到</span>
            <input id="cv_org_end" type="number" min="0" max="${Math.max(0, currentCount - 1)}" placeholder="结束" />
            <button class="cv-btn" id="cv_org_apply" type="button">选择</button>
            <button class="cv-btn" id="cv_org_clear" type="button">取消</button>
        </div>
        <div class="cv-organizer-toolbar cv-organizer-movebar">
            <button class="cv-btn" id="cv_org_up" type="button" ${!range || range.start <= 0 ? 'disabled' : ''}>上移</button>
            <button class="cv-btn" id="cv_org_down" type="button" ${!range || range.end >= currentCount - 1 ? 'disabled' : ''}>下移</button>
            <span class="cv-organizer-move-target">移动到第 <input id="cv_org_move_floor" type="number" min="0" max="${Math.max(0, currentCount - 1)}" placeholder="层数" /> 层 <button class="cv-btn" id="cv_org_move_to" type="button" ${!range ? 'disabled' : ''}>移动</button></span>
        </div>
        <div class="cv-organizer-toolbar cv-organizer-editbar">
            <button class="cv-btn cv-btn-danger" id="cv_org_delete" type="button" ${!range ? 'disabled' : ''}>删除选中</button>
            <button class="cv-btn" id="cv_org_reset" type="button" ${!state.dirty ? 'disabled' : ''}>重置修改</button>
        </div>
        <div class="cv-field-hint cv-organizer-selection">${selectionHint}</div>
        <div class="cv-organizer-list">${rowsHtml}</div>
        ${pagerHtml}
    `;

    actions.innerHTML = `
        <label class="cv-organizer-skip-backup"><input id="cv_org_skip_backup" type="checkbox" ${state.skipBackup ? 'checked' : ''} /> 我理解风险，跳过备份</label>
        <button class="cv-btn" id="cv_org_close" type="button">关闭</button>
        <button class="cv-btn" id="cv_org_backup" type="button">备份原文件</button>
        <button class="cv-btn cv-btn-primary" id="cv_org_write" type="button" ${!state.dirty || (!state.backupDownloaded && !state.skipBackup) ? 'disabled' : ''}>保存更改</button>
    `;

    const rerender = (opts = {}) => {
        const list = body.querySelector('.cv-organizer-list');
        const keepScrollTop = opts.keepScroll && list ? list.scrollTop : null;
        renderOrganizerBody(wrap, state, character, fileName);
        if (keepScrollTop != null) {
            const nextList = wrap.querySelector('.cv-organizer-list');
            if (nextList) nextList.scrollTop = keepScrollTop;
        }
    };
    const applyMove = (fn) => {
        const r = organizerRangeOrWarn(state);
        if (!r) return;
        const res = fn(state.rows, r.start, r.end);
        if (!res.changed) return;
        finishOrganizerMutation(state, res.start, res.end);
        rerender();
    };

    body.querySelectorAll('.cv-organizer-row').forEach(rowEl => {
        rowEl.onclick = (e) => {
            if (e.target.closest('input, button')) return;
            const i = Number(rowEl.dataset.i);
            if (e.shiftKey && state.lastSelectedIndex != null) {
                selectOrganizerIndexes(state, Math.min(state.lastSelectedIndex, i), Math.max(state.lastSelectedIndex, i));
            } else {
                const id = state.rows[i]?.id;
                if (!id) return;
                if (state.selectedIds.has(id)) state.selectedIds.delete(id);
                else state.selectedIds.add(id);
                state.lastSelectedIndex = i;
            }
            rerender({ keepScroll: true });
        };
        const check = rowEl.querySelector('input');
        if (check) check.onchange = () => rowEl.click();
        const previewEl = rowEl.querySelector('.cv-organizer-preview');
        if (previewEl) {
            const openOrganizerPreview = () => openTextPreviewTip(previewEl, state.rows[Number(rowEl.dataset.i)]?.msg?.mes, '（空消息）');
            previewEl.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openOrganizerPreview();
            };
            bindTextPreviewTipEvents(previewEl, openOrganizerPreview);
        }
        rowEl.ondragstart = (e) => {
            const i = Number(rowEl.dataset.i);
            if (!state.selectedIds.has(state.rows[i]?.id)) selectOrganizerIndexes(state, i, i);
            const r = organizerRangeOrWarn(state);
            if (!r) { e.preventDefault(); return; }
            state.draggingRange = r;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
            rowEl.classList.add('is-dragging');
        };
        rowEl.ondragover = (e) => {
            if (!state.draggingRange) return;
            e.preventDefault();
            const rect = rowEl.getBoundingClientRect();
            state.dragOverIndex = Number(rowEl.dataset.i);
            state.dragOverSide = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            rowEl.classList.toggle('is-drop-before', state.dragOverSide === 'before');
            rowEl.classList.toggle('is-drop-after', state.dragOverSide === 'after');
        };
        rowEl.ondragleave = () => {
            rowEl.classList.remove('is-drop-before', 'is-drop-after');
        };
        rowEl.ondrop = (e) => {
            e.preventDefault();
            const r = state.draggingRange || organizerRangeOrWarn(state);
            const targetIndex = Number(rowEl.dataset.i);
            const side = state.dragOverSide || 'before';
            state.draggingRange = null;
            state.dragOverIndex = null;
            state.dragOverSide = '';
            if (!r) { rerender(); return; }
            if (targetIndex >= r.start && targetIndex <= r.end) { rerender(); return; }
            const len = r.end - r.start + 1;
            let targetFloor = targetIndex + (side === 'after' ? 1 : 0);
            if (targetIndex > r.end) targetFloor -= len;
            const maxStartFloor = state.rows.length - len;
            targetFloor = Math.min(Math.max(0, targetFloor), maxStartFloor);
            const res = moveOrganizerBlockToFloor(state.rows, r.start, r.end, targetFloor);
            if (res.invalid) { toastr.warning(`目标层数无效，最大可移动到第 ${res.maxStartFloor} 层`); rerender(); return; }
            if (!res.changed) { rerender(); return; }
            finishOrganizerMutation(state, res.start, res.end);
            rerender();
        };
        rowEl.ondragend = () => {
            state.draggingRange = null;
            state.dragOverIndex = null;
            state.dragOverSide = '';
            rerender();
        };
    });

    body.querySelector('#cv_org_apply').onclick = () => {
        const start = Number(body.querySelector('#cv_org_start').value);
        const end = Number(body.querySelector('#cv_org_end').value || start);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= state.rows.length) {
            toastr.warning('请输入有效层数范围');
            return;
        }
        selectOrganizerIndexes(state, start, end);
        setOrganizerPageForIndex(state, start);
        rerender();
    };
    body.querySelector('#cv_org_clear').onclick = () => { state.selectedIds.clear(); state.lastSelectedIndex = null; rerender(); };
    body.querySelector('#cv_org_up').onclick = () => applyMove(moveOrganizerBlockUp);
    body.querySelector('#cv_org_down').onclick = () => applyMove(moveOrganizerBlockDown);
    body.querySelector('#cv_org_move_to').onclick = () => {
        const r = organizerRangeOrWarn(state);
        if (!r) return;
        const targetFloor = Number(body.querySelector('#cv_org_move_floor').value);
        const res = moveOrganizerBlockToFloor(state.rows, r.start, r.end, targetFloor);
        if (res.invalid) { toastr.warning(`请输入 0-${res.maxStartFloor} 之间的目标层数`); return; }
        if (!res.changed) return;
        finishOrganizerMutation(state, res.start, res.end);
        rerender();
    };
    body.querySelector('#cv_org_delete').onclick = () => {
        const r = organizerRangeOrWarn(state);
        if (!r) return;
        const count = r.end - r.start + 1;
        if (!confirm(`先从整理预览中移除全局 #${r.start} - #${r.end}，共 ${count} 楼？\n\n这一步还不会写回服务器，可用“重置修改”恢复。`)) return;
        const res = deleteOrganizerBlock(state.rows, r.start, r.end);
        if (!res.changed) return;
        finishOrganizerMutation(state, res.start, res.end);
        rerender();
    };
    body.querySelector('#cv_org_reset').onclick = () => {
        if (!state.dirty) return;
        if (!confirm('放弃当前整理修改，恢复到刚打开时的楼层顺序？')) return;
        const fresh = buildOrganizerState(state.originalArr, character);
        Object.assign(state, fresh);
        rerender();
    };

    const jumpPage = (page) => { state.page = page; clampOrganizerPage(state); rerender(); };
    const first = body.querySelector('#cv_org_first');
    const prev = body.querySelector('#cv_org_prev');
    const next = body.querySelector('#cv_org_next');
    const last = body.querySelector('#cv_org_last');
    const pageInput = body.querySelector('#cv_org_page');
    if (first) first.onclick = () => jumpPage(1);
    if (prev) prev.onclick = () => jumpPage(state.page - 1);
    if (next) next.onclick = () => jumpPage(state.page + 1);
    if (last) last.onclick = () => jumpPage(getOrganizerTotalPages(state));
    if (pageInput) pageInput.onkeydown = (e) => {
        if (e.key === 'Enter') jumpPage(Number(pageInput.value));
    };
    if (pageInput) pageInput.onchange = () => jumpPage(Number(pageInput.value));

    const helpBtn = body.querySelector('#cv_org_help');
    if (helpBtn) helpBtn.onclick = () => { state.helpOpen = !state.helpOpen; rerender({ keepScroll: true }); };

    const skipBackup = actions.querySelector('#cv_org_skip_backup');
    if (skipBackup) skipBackup.onchange = () => { state.skipBackup = skipBackup.checked; rerender(); };
    actions.querySelector('#cv_org_close').onclick = () => closeOrganizerModal(state);
    actions.querySelector('#cv_org_backup').onclick = () => {
        downloadChatArrayJsonl(state.originalArr, fileName, `cvbak-${timestampForFileName()}`);
        state.backupDownloaded = true;
        setStatus('✓ 已备份原文件');
        toastr.success('已备份原文件');
        rerender();
    };
    actions.querySelector('#cv_org_write').onclick = async () => {
        if (!state.backupDownloaded && !state.skipBackup) {
            toastr.warning('请先备份原文件，或勾选“我理解风险，跳过备份”');
            return;
        }
        try { await saveArrangedChatToOriginal(character, fileName, state); }
        catch (e) {
            console.error('[ChatVault] 整理写回失败', e);
            setStatus(`❌ 整理写回失败: ${e.message}`);
            toastr.error(`整理写回失败: ${e.message}`);
        }
    };
}

function closeOrganizerModal(state) {
    if (state?.dirty && !confirm('整理结果尚未写回。确定关闭整理器？')) return;
    closeModal();
}

async function saveArrangedChatToOriginal(character, fileName, state) {
    if (!state.dirty) { toastr.info('没有需要写回的整理修改'); return; }
    const arranged = buildArrangedChatArray(state);
    const originalCount = Math.max(0, state.originalArr.length - 1);
    const newCount = Math.max(0, arranged.length - 1);
    const deletedCount = originalCount - newCount;

    if (!state.backupDownloaded && !state.skipBackup) {
        toastr.warning('请先备份原文件，或勾选“我理解风险，跳过备份”');
        return;
    }
    const emptyWarn = newCount === 0 ? '\n\n注意：整理后聊天将没有任何消息楼层。' : '';
    const skipWarn = state.skipBackup && !state.backupDownloaded ? '\n\n你选择跳过备份。如果保存后发现问题，ChatVault 无法帮你恢复原聊天。' : '';
    if (!confirm(`${formatOrganizerSaveSummary(fileName, state)}${emptyWarn}${skipWarn}\n\n确认保存？`)) return;

    setStatus('正在写回整理后的聊天…');
    await postSaveChatArray(character, fileName, arranged);
    await reloadCharacterChats(character);

    const expectedJsonl = chatArrayToJsonl(arranged);
    let lastReadError = null;
    let verified = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 250 : 600));
        try {
            const readBack = await fetchFullChat(character, fileName);
            if (chatArrayToJsonl(readBack) === expectedJsonl) {
                verified = true;
                break;
            }
            lastReadError = null;
        } catch (e) {
            lastReadError = e;
        }
    }
    if (!verified) {
        if (lastReadError) throw new Error(`写回后读取校验失败: ${lastReadError.message}`);
        throw new Error('写回后读取结果与整理内容不一致，请检查聊天列表和刚下载的备份');
    }

    previewCache.delete(metaKey(character.avatar, fileName));
    setStatus('✓ 已整理并写回');
    toastr.success('整理完成，已写回聊天文件');
    render();
    closeModal();
}

function openChatOrganizerModal(character, fileName) {
    closeModal();
    const wrap = document.createElement('div');
    wrap.className = 'cv-modal-backdrop';
    wrap.id = 'cv_modal';
    wrap.innerHTML = `
        <div class="cv-modal cv-modal-wide cv-organizer-modal" onclick="event.stopPropagation()">
            <button class="cv-modal-close" id="cv_org_x" type="button" title="关闭">${ICONS.close}</button>
            <h3>整理聊天楼层</h3>
            <div class="cv-modal-body" id="cv_org_body">
                <div class="cv-organizer-empty">正在读取聊天楼层…</div>
            </div>
            <div class="cv-modal-actions" id="cv_org_actions">
                <button class="cv-btn" id="cv_org_loading_close" type="button">关闭</button>
            </div>
        </div>
    `;
    wrap.onclick = closeModal;
    document.getElementById('chatvault_panel').appendChild(wrap);
    wrap.querySelector('#cv_org_x').onclick = closeModal;
    wrap.querySelector('#cv_org_loading_close').onclick = closeModal;

    fetchFullChat(character, fileName).then(arr => {
        const state = buildOrganizerState(arr, character);
        wrap.querySelector('#cv_org_x').onclick = () => closeOrganizerModal(state);
        wrap.onclick = () => closeOrganizerModal(state);
        renderOrganizerBody(wrap, state, character, fileName);
    }).catch(e => {
        wrap.querySelector('#cv_org_body').innerHTML = `<div class="cv-organizer-empty">读取失败：${escapeHtml(e.message)}</div>`;
        setStatus(`❌ 读取聊天失败: ${e.message}`);
        toastr.error(`读取聊天失败: ${e.message}`);
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
                <div class="cv-section-divider"></div>
                <div class="cv-edit-tool-row">
                    <div>
                        <div class="cv-edit-tool-title">聊天楼层整理</div>
                        <div class="cv-field-hint">移动或删除聊天楼层，写回前会先备份并确认。</div>
                    </div>
                    <button class="cv-btn" id="cv_m_organize" type="button">整理楼层</button>
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
    // v0.6.0：手机端不自动聚焦——否则一打开弹窗软键盘就弹出来，
    // 把刚变成底部抽屉的弹窗顶掉一半，用户还得先收键盘才能看清内容。
    if (!isMobileLayout()) setTimeout(() => document.getElementById('cv_m_title')?.focus(), 0);

    document.getElementById('cv_m_close').onclick = closeModal;
    document.getElementById('cv_m_cancel').onclick = closeModal;
    document.getElementById('cv_m_organize').onclick = () => openChatOrganizerModal(character, fileName);
    document.getElementById('cv_m_save').onclick = async () => {
        const newTitle = document.getElementById('cv_m_title').value.trim();
        const newTags = document.getElementById('cv_m_tags').value
            .split(',').map(s => s.trim()).filter(Boolean);
        const newFile = document.getElementById('cv_m_file').value.trim();

        // 1. 文件重命名（如改了）
        let curFile = fileName;
        if (newFile !== fileName) {
            // 校验：空字符串、路径分隔符、控制字符、相对路径段一律拒绝
            // 白名单：中英文数字 + 常见标点；服务端会再校验一次，这里只是给用户即时反馈
            const FILENAME_RE = /^[\w.\u4e00-\u9fa5 \-()【】\[\]·、，,]+$/;
            if (!newFile) {
                toastr.warning('文件名不能为空');
                return;
            }
            if (newFile.includes('/') || newFile.includes('\\') || newFile.includes('..')) {
                toastr.error('文件名不能包含路径分隔符或 ..');
                return;
            }
            if (!FILENAME_RE.test(stripExt(newFile))) {
                toastr.error('文件名包含不允许的字符（仅允许字母数字中文及常见标点）');
                return;
            }
            const newBase = stripExt(newFile).toLowerCase();
            const oldBase = stripExt(fileName).toLowerCase();
            const exists = (chatsByAvatar[character.avatar] || []).some(c => {
                const base = stripExt(c.file_name || '').toLowerCase();
                return base === newBase && base !== oldBase;
            });
            if (exists) {
                toastr.error('同一角色下已存在同名聊天文件');
                return;
            }
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
                    previewCacheSet(newKey, previewCache.get(oldKey));
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
    // v0.5.17: repaint 改为真重渲染 —— 自定义正则等改动需要立刻反映到主列表/阅读器
    // render() 内部判断：阅读模式走 renderReader（cfgSig 变了重算），主列表重画卡片
    // modal 在 chatvault_panel 子节点而非 cv_body，render 不会误关 modal
    mountRulesEditor(document.getElementById('cv_rules_holder'), {
        prefix: 'cv_rules',
        stripPath: ['strip'],
        extractPath: ['extract'],
        userPath: ['userRules'],
        repaint: () => render(),
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
        // 该角色已经空了，连带清理错误记录，避免角色卡上残留过时报错
        if (chatsByAvatar[character.avatar].length === 0) {
            delete errorsByAvatar[character.avatar];
        }
        // 反幽灵：ST 内存里所有同名同 avatar 角色的 character.chat 如果还指向刚删的文件，
        // 还有剩余聊天 → 换成最新一条（避免 ST "找不到 → 自动建空聊天" 产生 ~100B 幽灵）
        // 已 0 聊天 → 用 delete 移除字段；不能设 ''，否则 ST 后续 selectCharacterById 会
        // 拿空字符串调 /api/chats/get 报 "Invalid character chat tail request"（v0.5.10 修复）
        try {
            const ctx = SillyTavern.getContext();
            const remaining = chatsByAvatar[character.avatar];
            const fallback = remaining.length > 0 ? stripExt(remaining[0].file_name) : null;
            const stripped = stripExt(fileName);
            ctx.characters.forEach(c => {
                if (c.avatar === character.avatar && stripExt(c.chat || '') === stripped) {
                    if (fallback) c.chat = fallback;
                    else delete c.chat;
                }
            });
        } catch (e) {
            console.warn('[ChatVault] 删除后同步 ST 当前聊天字段失败，已忽略', e);
        }
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

function clampDockTabTop(v) {
    return _clamp(_num(v, 0.34), 0, 1);
}

function getDockTabMaxTop(tab) {
    return Math.max(0, (window.innerHeight || 1) - (tab?.offsetHeight || 1));
}

function applyDockTabTop(tab, topRatio = loadSettings().dockTabTop) {
    const maxTop = getDockTabMaxTop(tab);
    tab.style.top = `${Math.round(clampDockTabTop(topRatio) * maxTop)}px`;
}

function bindDockTabDrag(tab) {
    tab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startPx = tab.getBoundingClientRect().top;
        let moved = false;
        tab.setPointerCapture?.(e.pointerId);
        tab.classList.add('is-dragging');
        const move = (ev) => {
            const dy = ev.clientY - startY;
            if (Math.abs(dy) > 3) moved = true;
            const maxTop = getDockTabMaxTop(tab);
            const nextPx = _clamp(startPx + dy, 0, maxTop);
            const next = maxTop > 0 ? nextPx / maxTop : 0;
            tab.style.top = `${Math.round(nextPx)}px`;
            tab.dataset.nextTop = String(next);
        };
        const up = (ev) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            tab.releasePointerCapture?.(ev.pointerId);
            tab.classList.remove('is-dragging');
            const next = clampDockTabTop(tab.dataset.nextTop || loadSettings().dockTabTop);
            const cur = loadSettings();
            saveSettings({ ...cur, dockTabTop: next });
            delete tab.dataset.nextTop;
            if (!moved) openPanel('dock');
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

function injectDockTab() {
    if (isMobileLayout()) return;
    if (document.getElementById('chatvault_dock_tab')) return;
    const s = loadSettings();
    if (!s.leftDockButton) return;
    const tab = document.createElement('button');
    tab.id = 'chatvault_dock_tab';
    tab.type = 'button';
    tab.title = '打开聊天档案侧栏（可上下拖动）';
    tab.innerHTML = `<i class="fa-solid fa-book"></i><span>档案</span>`;
    bindDockTabDrag(tab);
    document.body.appendChild(tab);
    applyDockTabTop(tab, s.dockTabTop);
}

function removeDockTab() {
    document.getElementById('chatvault_dock_tab')?.remove();
}

function applyDockTabState() {
    const s = loadSettings();
    if (s.leftDockButton) {
        injectDockTab();
        const tab = document.getElementById('chatvault_dock_tab');
        if (tab) applyDockTabTop(tab);
    } else removeDockTab();
}

function applyEnabledState() {
    const s = loadSettings();
    if (s.enabled) injectButton();
    else {
        removeButton();
        if (panelEl && !s.welcomeButton && !s.leftDockButton) closePanel();
    }
    applyWelcomeButtonState();
    applyDockTabState();
}

/* ============================================================
 *  欢迎页快捷入口
 *  在酒馆欢迎消息底部那排官方按钮（API 连接 / 角色管理 / 扩展程序）
 *  末尾追加一个"聊天档案"按钮，外观沿用官方 .menu_button 样式。
 *  - 用 MutationObserver 监听 #chat，欢迎消息每次重渲都会自动补回按钮
 *  - 用 data-cv-welcome-btn 标记防重复注入
 *  - 总开关 enabled 关闭 / 单独开关 welcomeButton 关闭时都会移除并停掉 observer
 * ============================================================ */

let _cvWelcomeObserver = null;

function injectWelcomeButton() {
    const s = loadSettings();
    if (!s.welcomeButton) return;
    // 多套选择器逐级回退，兼容不同版本的酒馆欢迎消息 DOM
    // 1) 已知 ID（ST 主流欢迎页常见）：API/角色/扩展按钮
    // 2) 系统消息 mes_text 里的 menu_button（含 is_system 属性 / class 两种写法）
    // 3) 兜底：#chat 内任意 mes_text 里的 menu_button（欢迎页一般只有这一处有 menu_button）
    // 注意：不再向 #chat 下任意 .menu_button 兜底——避免别的扩展往消息体里塞按钮时被误命中
    const candidates = [];
    const knownIds = ['#api_button', '#api_button_main', '#advanced_div', '#extensionsMenuButton'];
    knownIds.forEach(id => { const el = document.querySelector(`#chat ${id}, ${id}`); if (el && el.closest('#chat')) candidates.push(el); });
    if (candidates.length === 0) {
        document.querySelectorAll('#chat .mes[is_system="true"] .mes_text .menu_button, '
                               + '#chat .mes.is_system .mes_text .menu_button').forEach(el => candidates.push(el));
    }
    if (candidates.length === 0) {
        document.querySelectorAll('#chat .mes_text .menu_button').forEach(el => candidates.push(el));
    }
    if (candidates.length === 0) {
        if (!injectWelcomeButton._warned) {
            console.warn('[ChatVault] 欢迎页按钮：未找到官方按钮容器，可能酒馆欢迎页 DOM 结构变了。'
                + '可在控制台运行 window._cvDebugWelcome() 查看实际结构。');
            injectWelcomeButton._warned = true;
        }
        return;
    }
    const seenRows = new Set();
    candidates.forEach((official) => {
        const row = official.parentElement;
        if (!row || seenRows.has(row)) return;
        seenRows.add(row);
        if (row.querySelector('[data-cv-welcome-btn]')) return;
        // 复用官方按钮的 className，外观/hover/间距完全一致
        const tag = (official.tagName || 'div').toLowerCase();
        const btn = document.createElement(tag);
        btn.className = official.className;
        btn.setAttribute('data-cv-welcome-btn', '1');
        btn.title = '打开聊天档案';
        btn.innerHTML = '<i class="fa-solid fa-book"></i><span>聊天档案</span>';
        btn.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
        row.appendChild(btn);
        if (!injectWelcomeButton._loggedOnce) {
            console.log('[ChatVault] 欢迎页按钮已注入，参考节点：', official, '父容器：', row);
            injectWelcomeButton._loggedOnce = true;
        }
    });
}

// 控制台诊断助手：让用户能告诉我实际 DOM 结构
window._cvDebugWelcome = function() {
    const chat = document.getElementById('chat');
    if (!chat) { console.log('[CV-DEBUG] #chat 不存在'); return; }
    const mes = chat.querySelectorAll('.mes');
    console.log(`[CV-DEBUG] #chat 内有 ${mes.length} 条消息`);
    mes.forEach((m, i) => {
        console.log(`  [${i}] is_system=`, m.getAttribute('is_system'),
            ' classes=', m.className,
            ' menu_buttons=', m.querySelectorAll('.menu_button').length);
    });
    const allBtns = chat.querySelectorAll('.menu_button');
    console.log(`[CV-DEBUG] #chat 内总共 ${allBtns.length} 个 .menu_button:`);
    allBtns.forEach((b, i) => console.log(`  btn[${i}]`, b, '父：', b.parentElement));
    return { messageCount: mes.length, buttonCount: allBtns.length };
};

function removeWelcomeButton() {
    document.querySelectorAll('[data-cv-welcome-btn]').forEach(el => el.remove());
}

function startWelcomeObserver() {
    if (_cvWelcomeObserver) { injectWelcomeButton(); return; }
    const chat = document.getElementById('chat');
    if (!chat) return;
    const obs = new MutationObserver(() => {
        // 节流：合并同一帧内的多次变更，避免每条 mutation 都跑一次 querySelectorAll
        if (obs._raf) return;
        obs._raf = requestAnimationFrame(() => { obs._raf = 0; injectWelcomeButton(); });
    });
    // 欢迎消息是 #chat 的直接子元素，只需观察直接子节点的增删
    // 不要 subtree:true——开了之后流式回复每个 token 都会触发回调，长会话下白白吃 CPU
    obs.observe(chat, { childList: true });
    _cvWelcomeObserver = obs;
    injectWelcomeButton();
}

function stopWelcomeObserver() {
    if (_cvWelcomeObserver) {
        if (_cvWelcomeObserver._raf) cancelAnimationFrame(_cvWelcomeObserver._raf);
        _cvWelcomeObserver.disconnect();
        _cvWelcomeObserver = null;
    }
    removeWelcomeButton();
}

function applyWelcomeButtonState() {
    const s = loadSettings();
    if (s.welcomeButton) startWelcomeObserver();
    else stopWelcomeObserver();
}

/* ============================================================
 *  自定义字体（注入 <style>，全局作用于 ChatVault 面板）
 * ============================================================ */

/* ============================================================
 *  桌面窗口模式（v0.3.27 起）
 *  - 默认仍是模态居中卡片
 *  - 桌面端额外允许：拖标题栏移动 / 拉边缘改大小 / 双击最大化 / 复位
 *  - 自由模式：去掉遮罩，可同时操作酒馆
 *  - 手机端（≤720px）完全跳过，保留原有满屏体验
 * ============================================================ */

let _cvSuppressOverlayClick = false;

/* v0.6.0 手机判定
 * 旧版只认 matchMedia('(max-width: 720px)')，导致横屏手机（如 844x390）被当成桌面：
 * 会装上拖拽/拉伸把手、左侧停靠条、还原成 1100px 桌面弹窗 —— 在手机上没法用。
 * 现在与 style.css 的断点严格保持一致（两处必须同步改）：
 *      (max-width: 720px)  或  (orientation: landscape) and (max-height: 560px)
 * 「触屏专用」的视觉补丁不在这里判断，交给 CSS 的 @media (hover: none), (pointer: coarse)。
 */
function isMobileLayout() {
    if (!window.matchMedia) return false;
    if (window.matchMedia('(max-width: 720px)').matches) return true;
    if (window.matchMedia('(orientation: landscape) and (max-height: 560px)').matches) return true;
    return false;
}

/* ----- 桌面尺寸模式：用真实宽高替代 transform: scale ----- */
const CV_PANEL_MIN_W = 340;
const CV_PANEL_MIN_H = 520;
const CV_PANEL_WIDE_AT = 760;
const CV_PANEL_MARGIN = 12;
const CV_PANEL_DOCK_W = 420;
const CV_PANEL_MODAL_W = 1100;
const CV_PANEL_MODAL_H = 800;
const CV_PANEL_READER_W = 1180;
const CV_PANEL_READER_H = 900;

function _num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function getDesktopPanelMode(s = loadSettings(), overrideMode = '') {
    const raw = overrideMode || s.desktopPanelMode;
    return raw === 'dock' ? 'dock' : 'modal';
}

function getDefaultPanelBox(mode = getDesktopPanelMode()) {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    // v0.6.0 fix: 视口比最小尺寸还小时，原来 Math.max(MIN, ...) 会把 max 抬高到 MIN，
    // 结果面板比屏幕还大（矮窗口/分屏/平板上下分屏时底部按钮点不到）。这里以“视口”为硬上限。
    const maxW = Math.max(1, vw - CV_PANEL_MARGIN * 2);
    const maxH = Math.max(1, vh - CV_PANEL_MARGIN * 2);
    const minW = Math.min(CV_PANEL_MIN_W, maxW);
    const minH = Math.min(CV_PANEL_MIN_H, maxH);
    if (mode === 'dock') {
        const w = _clamp(Math.min(CV_PANEL_DOCK_W, maxW), minW, maxW);
        const h = _clamp(maxH, minH, maxH);
        return { x: CV_PANEL_MARGIN, y: CV_PANEL_MARGIN, w, h };
    }
    const w = Math.min(CV_PANEL_MODAL_W, Math.round(vw * 0.95), maxW);
    const h = Math.min(CV_PANEL_MODAL_H, Math.round(vh * 0.92), maxH);
    return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

function getLayoutForWidth(width, s = loadSettings()) {
    if (s.desktopCardLayout === 'narrow') return 'narrow';
    if (s.desktopCardLayout === 'wide') return 'wide';
    return width >= CV_PANEL_WIDE_AT ? 'wide' : 'narrow';
}

function applyPanelLayoutClass(panel, layout) {
    const l = layout === 'wide' ? 'wide' : 'narrow';
    panel.classList.toggle('cv-layout-wide', l === 'wide');
    panel.classList.toggle('cv-layout-narrow', l !== 'wide');
    return l;
}

function applyPanelModeClasses(overlay, panel, mode) {
    const m = mode === 'dock' ? 'dock' : 'modal';
    overlay.classList.toggle('cv-mode-dock', m === 'dock');
    overlay.classList.toggle('cv-mode-modal', m !== 'dock');
    panel.classList.toggle('cv-mode-dock', m === 'dock');
    panel.classList.toggle('cv-mode-modal', m !== 'dock');
    return m;
}

function clampPanelBox(box) {
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    // v0.6.0 fix: 视口比最小尺寸还小时，min 不能大于上限，否则面板会超出屏幕（矮窗口/分屏）
    const maxW = Math.max(1, vw - CV_PANEL_MARGIN * 2);
    const maxH = Math.max(1, vh - CV_PANEL_MARGIN * 2);
    const minW = Math.min(CV_PANEL_MIN_W, maxW);
    const minH = Math.min(CV_PANEL_MIN_H, maxH);
    const w = _clamp(Math.round(_num(box.w, CV_PANEL_MODAL_W)), minW, maxW);
    const h = _clamp(Math.round(_num(box.h, CV_PANEL_MODAL_H)), minH, maxH);
    const xMax = Math.max(CV_PANEL_MARGIN, vw - w - CV_PANEL_MARGIN);
    const yMax = Math.max(CV_PANEL_MARGIN, vh - h - CV_PANEL_MARGIN);
    const x = _clamp(Math.round(_num(box.x, CV_PANEL_MARGIN)), CV_PANEL_MARGIN, xMax);
    const y = _clamp(Math.round(_num(box.y, CV_PANEL_MARGIN)), CV_PANEL_MARGIN, yMax);
    return { x, y, w, h };
}

function applyPanelBox(panel, overlay, box, persistLayout = true) {
    const mode = panel.classList.contains('cv-mode-dock') ? 'dock' : 'modal';
    const fallback = getDefaultPanelBox(mode);
    const c = clampPanelBox({ ...fallback, ...(box || {}) });
    overlay.classList.add('cv-window-positioned');
    panel.style.setProperty('left', c.x + 'px', 'important');
    panel.style.setProperty('top', c.y + 'px', 'important');
    panel.style.setProperty('width', c.w + 'px', 'important');
    panel.style.setProperty('height', c.h + 'px', 'important');
    panel.style.removeProperty('transform');
    panel.style.removeProperty('transform-origin');
    const layout = applyPanelLayoutClass(panel, getLayoutForWidth(c.w));
    updatePaginationAutoHideMode();
    if (persistLayout) panel.dataset.cvLayout = layout;
    return { ...c, layout };
}

function getCurrentState(panel) {
    const r = panel.getBoundingClientRect();
    const x = Number.isFinite(parseFloat(panel.style.left)) ? parseFloat(panel.style.left) : r.left;
    const y = Number.isFinite(parseFloat(panel.style.top)) ? parseFloat(panel.style.top) : r.top;
    const w = Number.isFinite(parseFloat(panel.style.width)) ? parseFloat(panel.style.width) : r.width;
    const h = Number.isFinite(parseFloat(panel.style.height)) ? parseFloat(panel.style.height) : r.height;
    const layout = getLayoutForWidth(w);
    const mode = panel.classList.contains('cv-mode-dock') ? 'dock' : 'modal';
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), layout, mode };
}

function saveWindowStatePartial(patch) {
    const s = loadSettings();
    const cur = { ...(s.windowState || {}) };
    delete cur.scale; delete cur.maximized;
    saveSettings({ ...s, windowState: { ...cur, ...patch } });
}

function normalizeWindowState(st, mode) {
    if (!st || typeof st !== 'object') return null;
    const box = getDefaultPanelBox(mode);
    // 兼容旧版 {x,y,scale}：只用它估一个尺寸，不再写 transform。
    if (typeof st.scale === 'number' && typeof st.w !== 'number') {
        const sc = _clamp(st.scale, 0.4, 3);
        return clampPanelBox({
            x: _num(st.x, box.x),
            y: _num(st.y, box.y),
            w: box.w * sc,
            h: box.h * sc,
        });
    }
    if (typeof st.w !== 'number' || typeof st.h !== 'number') return null;
    return clampPanelBox({
        x: _num(st.x, box.x),
        y: _num(st.y, box.y),
        w: st.w,
        h: st.h,
    });
}

function applyWindowState(overlay, panel, modeOverride = '') {
    if (isMobileLayout()) return;
    const s = loadSettings();
    const mode = applyPanelModeClasses(overlay, panel, getDesktopPanelMode(s, modeOverride));
    if (s.windowFreeMode || mode === 'dock') overlay.classList.add('cv-window-free');
    else overlay.classList.remove('cv-window-free');

    const st = s.windowState;
    const usableSavedState = st && (!st.mode || st.mode === mode);
    const box = usableSavedState ? normalizeWindowState(st, mode) : null;
    if (box || mode === 'dock') {
        applyPanelBox(panel, overlay, box || getDefaultPanelBox(mode));
    } else {
        applyPanelLayoutClass(panel, getLayoutForWidth(getDefaultPanelBox(mode).w, s));
    }
}

function _ensurePositioned(overlay, panel) {
    if (overlay.classList.contains('cv-window-positioned')) return;
    const r = panel.getBoundingClientRect();
    applyPanelBox(panel, overlay, { x: r.left, y: r.top, w: r.width, h: r.height });
}

function _onPointerEnd(panel, cleanup) {
    cleanup();
    saveWindowStatePartial(getCurrentState(panel));
    _cvSuppressOverlayClick = true;
    setTimeout(() => { _cvSuppressOverlayClick = false; }, 50);
}

function _bindDrag(panel, overlay, handle) {
    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('input, button, select, textarea, a')) return;
        if (e.button !== 0) return;
        e.preventDefault();
        _ensurePositioned(overlay, panel);
        const startX = e.clientX, startY = e.clientY;
        const startState = getCurrentState(panel);
        const move = (ev) => {
            applyPanelBox(panel, overlay, {
                ...startState,
                x: startState.x + (ev.clientX - startX),
                y: startState.y + (ev.clientY - startY),
            });
        };
        const up = () => _onPointerEnd(panel, () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        });
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

function _bindPanelResize(panel, overlay, handle, dir) {
    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        _ensurePositioned(overlay, panel);
        const startX = e.clientX, startY = e.clientY;
        const start = getCurrentState(panel);
        const move = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            const next = { ...start };
            if (dir.includes('e')) next.w = start.w + dx;
            if (dir.includes('w')) { next.w = start.w - dx; next.x = start.x + dx; }
            if (dir.includes('s')) next.h = start.h + dy;
            applyPanelBox(panel, overlay, next);
        };
        const up = () => _onPointerEnd(panel, () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        });
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

function initWindowChrome(overlay, panel) {
    if (isMobileLayout()) return;

    ['w', 'e', 'se'].forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `cv-resize-handle cv-rh-${dir}`;
        handle.dataset.dir = dir;
        panel.appendChild(handle);
        _bindPanelResize(panel, overlay, handle, dir);
    });

    // 阅读模式下顶部一条窄拖动条（普通模式靠 header）
    const dragStrip = document.createElement('div');
    dragStrip.className = 'cv-drag-strip';
    panel.appendChild(dragStrip);
    _bindDrag(panel, overlay, dragStrip);

    // 标题栏拖动（不再绑 dblclick；双击最大化已移除以避免误触发）
    const header = panel.querySelector('.cv-header');
    if (header) _bindDrag(panel, overlay, header);

    // 视口尺寸变化：重新夹回
    const onWinResize = () => {
        if (isMobileLayout()) return;
        if (!overlay.classList.contains('cv-window-positioned')) return;
        applyPanelBox(panel, overlay, getCurrentState(panel), false);
    };
    window.addEventListener('resize', onWinResize);
    // v0.5.16 fix: 必须挂在 overlay（= panelEl）上，因为 closePanel 用 panelEl._cvOnResize 查找；
    // 之前挂在 inner panel 节点上 → closePanel 永远找不到 → 反复开关面板 resize 监听器无限堆积
    overlay._cvOnResize = onWinResize;
}

function resetWindow() {
    const s = loadSettings();
    delete s.windowState;
    saveSettings(s);
    if (!panelEl) return;
    const panel = document.getElementById('chatvault_panel');
    if (!panel) return;
    panelEl.classList.remove('cv-window-positioned');
    panel.style.removeProperty('left');
    panel.style.removeProperty('top');
    panel.style.removeProperty('transform');
    panel.style.removeProperty('transform-origin');
    panel.style.removeProperty('width');
    panel.style.removeProperty('height');
    panel.classList.remove('cv-reader-expanded');
    panel.dataset.cvLayout = '';
    applyWindowState(panelEl, panel);
}

function parseHotkeyCombo(str) {
    if (!str) return null;
    const parts = String(str).split('+').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const key = parts.pop().toLowerCase();
    const mods = new Set(parts.map(s => s.toLowerCase()));
    return { key, ctrl: mods.has('ctrl'), alt: mods.has('alt'),
             shift: mods.has('shift'), meta: mods.has('meta') || mods.has('cmd') };
}

function matchHotkey(e, combo) {
    if (!combo) return false;
    const k = (e.key || '').toLowerCase();
    return k === combo.key
        && !!e.ctrlKey  === combo.ctrl
        && !!e.altKey   === combo.alt
        && !!e.shiftKey === combo.shift
        && !!e.metaKey  === combo.meta;
}

function _cvHotkeyHandler(e) {
    const s = loadSettings();
    if (!s.windowHotkey) return;
    const combo = parseHotkeyCombo(s.windowHotkeyCombo || 'Alt+V');
    if (!matchHotkey(e, combo)) return;
    const t = e.target;
    const tag = (t?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
    e.preventDefault();
    if (panelEl) closePanel(); else openPanel();
}
function setupHotkey() {
    // 用命名函数引用，支持热重载/再次 setup 时清掉旧监听器，避免老 handler 残留
    if (window._cvHotkeyHandler) {
        document.removeEventListener('keydown', window._cvHotkeyHandler);
    }
    window._cvHotkeyHandler = _cvHotkeyHandler;
    document.addEventListener('keydown', window._cvHotkeyHandler);
}

/* ============================================================
 *  自定义字体
 * ============================================================ */

function applyCustomFont() {
    const s = loadSettings();
    let style = document.getElementById('cv-custom-font-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'cv-custom-font-style';
        document.head.appendChild(style);
    }
    const fonts = Array.isArray(s.customFonts) ? s.customFonts : [];
    // 消毒：去掉可能用来注入额外 CSS 规则的字符
    const sanitize = (v) => String(v || '').replace(/['"\\;{}<>]/g, '').trim();
    // 字体 URL 消毒：除了引号/反斜杠/分号/尖括号外，还要剔除空白(含换行)、花括号、圆括号
    // 防止攻击者通过换行符 + } 逃出 @font-face 块注入任意 CSS 规则
    const sanitizeUrl = (v) => String(v || '').replace(/[\s'"\\;<>{}()]/g, '').trim();
    // 仅允许 https:// 开头的 URL；http / data / blob / 相对路径都拒绝
    const isAllowedUrl = (u) => /^https:\/\/[^\s]+$/i.test(u);
    const cleaned = fonts.map(f => {
        const family = sanitize(f && f.family);
        const rawUrl = sanitizeUrl(f && f.url);
        const url = (rawUrl && isAllowedUrl(rawUrl)) ? rawUrl : '';
        // 用户填了 URL 但不合法时静默丢弃，避免污染样式表
        if (rawUrl && !url) {
            console.warn('[ChatVault] 字体 URL 未通过校验（仅允许 https://），已忽略:', rawUrl.slice(0, 80));
        }
        return { family, url };
    }).filter(f => f.family || f.url);
    if (cleaned.length === 0) { style.textContent = ''; return; }
    // 关键：每条 URL 字体都用独立的内部固定名注册，避免污染酒馆全局命名
    // 优先级：第 1 条 URL 字体 → 第 1 条 family → 第 2 条 URL → 第 2 条 family → ... → 系统兜底
    // 浏览器逐字符回退，所以 [英文, 日文, 中文] 这种排列会自动按字符找第一个有该字形的字体
    let css = '';
    const stack = [];
    cleaned.forEach((f, i) => {
        const internal = `__cv_user_font_${i}__`;
        if (f.url) {
            css += `@font-face { font-family: '${internal}'; src: url('${f.url}'); font-display: swap; }\n`;
            stack.push(`'${internal}'`);
        }
        if (f.family) stack.push(`'${f.family}'`);
    });
    stack.push('system-ui', '-apple-system', '"Segoe UI"', '"PingFang SC"',
               '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif');
    // 只在面板根上覆盖 font-family，靠 CSS 继承生效；不动 monospace 等显式声明
    css += `#chatvault_panel { font-family: ${stack.join(', ')}; }`;
    style.textContent = css;
}

/* ============================================================
 *  自定义配色（覆盖当前主题的 CSS 变量）
 *  - 选择器用 #chatvault_panel（特异性 1,0,0），稳定胜过 .cv-theme-*（0,1,0）
 *  - 每项独立可清除；未填的字段保持主题原值
 *  - accent-muted / bgCard-hover 用 color-mix 自动派生，避免手动配错
 * ============================================================ */
const CV_COLOR_DEFAULTS = {
    accent: '#34d399',
    bgPanel: '#212327',
    bgCard: '#2a2d32',
    text: '#e4e5e7',
    overlayAlpha: 0.55,
};
function applyCustomColors() {
    const s = loadSettings();
    let style = document.getElementById('cv-custom-colors-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'cv-custom-colors-style';
        document.head.appendChild(style);
    }
    // 仅当主题 = 自定义 时才注入覆盖；切回内置主题立刻清空，主题原色 100% 还原
    if (s.theme !== 'custom') { style.textContent = ''; return; }
    const c = s.customColors || {};
    const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());
    const accent  = isHex(c.accent)  ? c.accent.trim()  : '';
    const bgPanel = isHex(c.bgPanel) ? c.bgPanel.trim() : '';
    const bgCard  = isHex(c.bgCard)  ? c.bgCard.trim()  : '';
    const text    = isHex(c.text)    ? c.text.trim()    : '';
    const overlayAlpha = (typeof c.overlayAlpha === 'number' && c.overlayAlpha >= 0 && c.overlayAlpha <= 1)
        ? c.overlayAlpha : null;
    const rules = [];
    if (accent) {
        rules.push(`--cv-accent: ${accent};`);
        rules.push(`--cv-accent-muted: color-mix(in srgb, ${accent} 15%, transparent);`);
    }
    if (bgPanel) {
        rules.push(`--cv-bg-panel: ${bgPanel};`);
        // 派生边框 / 输入框背景，避免 light 自定义出现"黑边"或"暗色搜索框"
        // 用文字色按 20%/8% 混入，自动适配深浅
        rules.push(`--cv-border: color-mix(in srgb, ${bgPanel} 80%, var(--cv-text-primary, #888) 20%);`);
        rules.push(`--cv-border-soft: color-mix(in srgb, ${bgPanel} 94%, var(--cv-text-primary, #888) 6%);`);
        rules.push(`--cv-bg-input: color-mix(in srgb, ${bgPanel} 92%, var(--cv-text-primary, #888) 8%);`);
    }
    if (bgCard) {
        rules.push(`--cv-bg-card: ${bgCard};`);
        rules.push(`--cv-bg-card-hover: color-mix(in srgb, ${bgCard} 88%, var(--cv-text-primary, #888) 12%);`);
    }
    if (text) {
        rules.push(`--cv-text-primary: ${text};`);
        // 二级文字按主文字混 50% 派生，保持层次
        rules.push(`--cv-text-secondary: color-mix(in srgb, ${text} 65%, transparent);`);
        rules.push(`--cv-text-tertiary: color-mix(in srgb, ${text} 42%, transparent);`);
    }
    if (overlayAlpha !== null) rules.push(`--cv-bg-overlay: rgba(0,0,0,${overlayAlpha});`);
    style.textContent = rules.length ? `#chatvault_panel { ${rules.join(' ')} }` : '';
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
              <span>启用魔法棒菜单入口按钮</span>
            </label>
          </div>
          <div class="cv-settings-row">
            <label class="checkbox_label" for="cv_set_welcome_btn">
              <input type="checkbox" id="cv_set_welcome_btn" ${s.welcomeButton ? 'checked' : ''}>
              <span>在欢迎页底部显示快捷按钮（与 API 连接 / 角色管理 / 扩展程序 同排）</span>
            </label>
          </div>
          <div class="cv-settings-row cv-pc-only">
            <label class="checkbox_label" for="cv_set_left_dock_btn">
              <input type="checkbox" id="cv_set_left_dock_btn" ${s.leftDockButton !== false ? 'checked' : ''}>
              <span>启用侧边栏入口按钮（仅 PC 端）</span>
            </label>
          </div>
          <div class="cv-settings-row">
            <label for="cv_set_theme">配色方案：</label>
            <select id="cv_set_theme">
              ${THEMES.map(t => `<option value="${t.id}" ${s.theme === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="cv-settings-row">
            <label class="checkbox_label" for="cv_set_rich_render">
              <input type="checkbox" id="cv_set_rich_render" ${s.readerRichRender !== false ? 'checked' : ''}>
              <span>阅读模式增强渲染（表格 / 代码块 / 列表 / 引用 / AI 内联 HTML 如 &lt;img&gt;）</span>
            </label>
          </div>
          <div class="cv-settings-hint" style="margin:-4px 0 6px; opacity:0.75;">
            💡 关掉后仅识别 *斜体* 和 **粗体**，遇到大图 / 超长表格卡顿时可临时关闭。
          </div>
          <hr style="border:none; border-top:1px solid var(--cv-border, rgba(127,127,127,0.25)); margin:10px 0;">

          <!-- 字体设置（折叠） -->
          <div class="inline-drawer cv-sub-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>字体设置（多字体优先级）</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <div class="cv-settings-hint" style="margin-bottom:8px;">
                💡 按上下顺序排优先级；浏览器会逐字符回退到第一个有该字形的字体。<br>
                例如想英/日/中混排都好看：英文字体放第一，日文字体放第二，中文字体放第三。<br>
                ⚠️ URL 字体由浏览器直接请求该地址，请确认来源可信；只在 ChatVault 内生效，不影响酒馆其它界面。
              </div>
              <div id="cv_font_list" class="cv-font-list"></div>
              <div class="cv-settings-row">
                <button id="cv_font_add" class="menu_button cv-inline-btn">＋ 添加一条字体</button>
              </div>
            </div>
          </div>

          <!-- 自定义配色（折叠；仅当配色方案 = 自定义 时显示） -->
          <div id="cv_color_drawer_wrap" class="inline-drawer cv-sub-drawer" style="display:${s.theme === 'custom' ? 'block' : 'none'};">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>自定义配色面板</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <div id="cv_color_grid" class="cv-color-grid"></div>
              <div class="cv-settings-row" style="margin-top:8px;">
                <button id="cv_color_reset_all" class="menu_button cv-inline-btn">⟲ 全部恢复基准</button>
              </div>
            </div>
          </div>

          <!-- PC 端窗口设置（折叠，默认收起防止手机端误触） -->
          <div class="inline-drawer cv-sub-drawer cv-pc-only">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>PC 端窗口设置（手机端无效）</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <div class="cv-settings-row">
                <label for="cv_set_desktop_mode">桌面面板样式：</label>
                <select id="cv_set_desktop_mode">
                  <option value="modal" ${s.desktopPanelMode !== 'dock' ? 'selected' : ''}>经典居中弹窗</option>
                  <option value="dock" ${s.desktopPanelMode === 'dock' ? 'selected' : ''}>左侧停靠栏</option>
                </select>
              </div>
              <div class="cv-settings-row">
                <label for="cv_set_card_layout">卡片布局：</label>
                <select id="cv_set_card_layout">
                  <option value="auto" ${s.desktopCardLayout !== 'narrow' && s.desktopCardLayout !== 'wide' ? 'selected' : ''}>自动（按面板宽度）</option>
                  <option value="narrow" ${s.desktopCardLayout === 'narrow' ? 'selected' : ''}>紧凑单列</option>
                  <option value="wide" ${s.desktopCardLayout === 'wide' ? 'selected' : ''}>宽屏双列</option>
                </select>
              </div>
              <div class="cv-settings-row">
                <label class="checkbox_label" for="cv_set_reader_expand">
                  <input type="checkbox" id="cv_set_reader_expand" ${s.readerExpandMode !== 'off' ? 'checked' : ''}>
                  <span>进入阅读模式时自动展开大屏</span>
                </label>
              </div>
              <div class="cv-settings-row">
                <label class="checkbox_label" for="cv_set_window_free">
                  <input type="checkbox" id="cv_set_window_free" ${s.windowFreeMode ? 'checked' : ''}>
                  <span>桌面自由窗口模式（去掉背景遮罩，可同时操作酒馆）</span>
                </label>
              </div>
              <div class="cv-settings-row">
                <label class="checkbox_label" for="cv_set_hotkey">
                  <input type="checkbox" id="cv_set_hotkey" ${s.windowHotkey ? 'checked' : ''}>
                  <span>启用全局快捷键开关面板</span>
                </label>
              </div>
              <div class="cv-settings-row">
                <label for="cv_set_hotkey_combo">快捷键组合：</label>
                <input type="text" id="cv_set_hotkey_combo" class="text_pole" value="${escapeHtml(s.windowHotkeyCombo || 'Alt+V')}" placeholder="例：Alt+V / Ctrl+Shift+K">
              </div>
              <div class="cv-settings-row">
                <button id="cv_set_window_reset" class="menu_button cv-inline-btn">⟲ 复位窗口位置/尺寸</button>
              </div>
              <div class="cv-settings-hint">
                🖥️ 拖标题栏移动；拖左右边缘调整宽度，窄宽切换会自动改变单列/双列布局，不再等比缩放整个面板。<br>
                ⚠️ 自定义快捷键时请避开酒馆/浏览器已用组合（如 Ctrl+S、F5）；在输入框焦点时快捷键不会触发。
              </div>
            </div>
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
    wrap.querySelector('#cv_set_welcome_btn').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, welcomeButton: !!e.target.checked });
        applyWelcomeButtonState();
    });
    wrap.querySelector('#cv_set_rich_render').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, readerRichRender: !!e.target.checked });
        // 若阅读模式正打开，立即重渲染当前页
        if (typeof readerState !== 'undefined' && readerState && readerState.active) {
            try { renderReader(); } catch {}
        }
    });
    wrap.querySelector('#cv_set_theme').addEventListener('change', (e) => {
        const cur = loadSettings();
        const newTheme = e.target.value;
        saveSettings({ ...cur, theme: newTheme });
        if (panelEl) applyThemeClass(panelEl);
        applyCustomColors();
        // 显隐自定义配色面板
        const cdw = wrap.querySelector('#cv_color_drawer_wrap');
        if (cdw) cdw.style.display = (newTheme === 'custom') ? 'block' : 'none';
    });

    // ----- 多字体管理 -----
    const fontList = wrap.querySelector('#cv_font_list');
    let _fontDebounce;
    const renderFontList = () => {
        const cur = loadSettings();
        const fonts = Array.isArray(cur.customFonts) ? cur.customFonts : [];
        if (fonts.length === 0) {
            fontList.innerHTML = `<div class="cv-settings-hint" style="opacity:0.7;">还没有字体，点下方「添加」试试。留空就是用酒馆默认。</div>`;
            return;
        }
        fontList.innerHTML = fonts.map((f, i) => `
          <div class="cv-font-row" data-i="${i}">
            <div class="cv-font-row-head">
              <span class="cv-font-idx">${i + 1}</span>
              <button class="cv-font-btn" data-act="up"   ${i === 0 ? 'disabled' : ''} title="上移">▲</button>
              <button class="cv-font-btn" data-act="down" ${i === fonts.length - 1 ? 'disabled' : ''} title="下移">▼</button>
              <button class="cv-font-btn cv-font-del" data-act="del" title="删除">×</button>
            </div>
            <input type="text" class="text_pole cv-font-input" data-field="family" placeholder="字体名（系统/酒馆已加载的；用作回退）" value="${escapeHtml(f.family || '')}">
            <input type="text" class="text_pole cv-font-input" data-field="url"    placeholder="字体 URL（可选，以 https:// 开头，支持 .woff2/.woff/.ttf/.otf）" value="${escapeHtml(f.url || '')}">
          </div>
        `).join('');
    };
    const saveFontsDebounced = () => {
        clearTimeout(_fontDebounce);
        _fontDebounce = setTimeout(() => {
            const cur = loadSettings();
            const fonts = [...fontList.querySelectorAll('.cv-font-row')].map(row => ({
                family: row.querySelector('[data-field="family"]').value.trim(),
                url:    row.querySelector('[data-field="url"]').value.trim(),
            }));
            saveSettings({ ...cur, customFonts: fonts });
            applyCustomFont();
        }, 300);
    };
    fontList.addEventListener('input', (e) => {
        if (e.target.matches('.cv-font-input')) saveFontsDebounced();
    });
    fontList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        e.preventDefault();
        const row = btn.closest('.cv-font-row');
        const i = Number(row.dataset.i);
        const cur = loadSettings();
        const fonts = [...(cur.customFonts || [])];
        if (btn.dataset.act === 'up' && i > 0) {
            [fonts[i - 1], fonts[i]] = [fonts[i], fonts[i - 1]];
        } else if (btn.dataset.act === 'down' && i < fonts.length - 1) {
            [fonts[i + 1], fonts[i]] = [fonts[i], fonts[i + 1]];
        } else if (btn.dataset.act === 'del') {
            fonts.splice(i, 1);
        } else return;
        saveSettings({ ...cur, customFonts: fonts });
        applyCustomFont();
        renderFontList();
    });
    wrap.querySelector('#cv_font_add').addEventListener('click', (e) => {
        e.preventDefault();
        const cur = loadSettings();
        const fonts = [...(cur.customFonts || []), { family: '', url: '' }];
        saveSettings({ ...cur, customFonts: fonts });
        renderFontList();
    });
    renderFontList();

    // ----- 自定义配色 -----
    const colorGrid = wrap.querySelector('#cv_color_grid');
    const COLOR_FIELDS = [
        { key: 'accent',  label: '主色（按钮/强调）',  type: 'color' },
        { key: 'bgPanel', label: '面板背景',           type: 'color' },
        { key: 'bgCard',  label: '卡片背景',           type: 'color' },
        { key: 'text',    label: '正文文字',           type: 'color' },
        { key: 'overlayAlpha', label: '背景遮罩不透明度', type: 'range' },
    ];
    const renderColorGrid = () => {
        const cur = loadSettings();
        const cc = cur.customColors || {};
        colorGrid.innerHTML = COLOR_FIELDS.map(f => {
            const overriding = (f.key in cc) && cc[f.key] !== undefined && cc[f.key] !== '';
            const dft = CV_COLOR_DEFAULTS[f.key];
            if (f.type === 'color') {
                const val = overriding ? cc[f.key] : dft;
                return `
                  <div class="cv-color-row ${overriding ? 'cv-cc-on' : ''}" data-cc-key="${f.key}">
                    <span class="cv-cc-dot" title="${overriding ? '覆盖中' : '跟随主题'}"></span>
                    <label>${f.label}</label>
                    <input type="color" class="cv-cc-color" data-cc-input="${f.key}" value="${val}">
                    <input type="text" class="cv-cc-hex" data-cc-hex="${f.key}" value="${val}" maxlength="7" spellcheck="false" placeholder="#rrggbb">
                    <button class="cv-cc-clear" data-cc-clear="${f.key}" title="清除（跟随基准）" ${overriding ? '' : 'disabled'}>×</button>
                  </div>
                `;
            } else {
                const pct = overriding ? Math.round(cc[f.key] * 100) : Math.round(dft * 100);
                return `
                  <div class="cv-color-row ${overriding ? 'cv-cc-on' : ''}" data-cc-key="${f.key}">
                    <span class="cv-cc-dot" title="${overriding ? '覆盖中' : '跟随主题'}"></span>
                    <label>${f.label} <span class="cv-cc-pct" data-cc-pct="${f.key}">${pct}%</span></label>
                    <input type="range" min="0" max="100" data-cc-input="${f.key}" value="${pct}">
                    <button class="cv-cc-clear" data-cc-clear="${f.key}" title="清除（跟随基准）" ${overriding ? '' : 'disabled'}>×</button>
                  </div>
                `;
            }
        }).join('');
    };
    let _colorDebounce;
    const saveColorDebounced = (key, raw) => {
        clearTimeout(_colorDebounce);
        _colorDebounce = setTimeout(() => {
            const cur = loadSettings();
            const cc = { ...(cur.customColors || {}) };
            if (key === 'overlayAlpha') {
                const n = Math.max(0, Math.min(100, Number(raw))) / 100;
                cc[key] = n;
            } else {
                cc[key] = String(raw);
            }
            saveSettings({ ...cur, customColors: cc });
            applyCustomColors();
            // 局部刷新行状态而不是全量 re-render，避免打断滑块/取色器交互
            const row = colorGrid.querySelector(`[data-cc-key="${key}"]`);
            if (row) {
                row.classList.add('cv-cc-on');
                const clearBtn = row.querySelector('[data-cc-clear]');
                if (clearBtn) clearBtn.disabled = false;
                const dot = row.querySelector('.cv-cc-dot');
                if (dot) dot.title = '覆盖中';
            }
        }, 150);
    };
    const HEX_RE = /^#[0-9a-fA-F]{6}$/;
    colorGrid.addEventListener('input', (e) => {
        // 1) 取色器或 range
        const inp = e.target.closest('[data-cc-input]');
        if (inp) {
            const key = inp.dataset.ccInput;
            if (key === 'overlayAlpha') {
                const pctEl = colorGrid.querySelector(`[data-cc-pct="${key}"]`);
                if (pctEl) pctEl.textContent = `${inp.value}%`;
            } else {
                // 取色器变化时同步 hex 文本框
                const hexEl = colorGrid.querySelector(`[data-cc-hex="${key}"]`);
                if (hexEl) { hexEl.value = inp.value; hexEl.classList.remove('cv-cc-hex-bad'); }
            }
            saveColorDebounced(key, inp.value);
            return;
        }
        // 2) hex 文本框
        const hex = e.target.closest('[data-cc-hex]');
        if (hex) {
            let v = String(hex.value || '').trim();
            // 自动补 # 前缀
            if (v && v[0] !== '#') v = '#' + v;
            const valid = HEX_RE.test(v);
            hex.classList.toggle('cv-cc-hex-bad', !!v && !valid);
            if (!valid) return;
            hex.value = v.toLowerCase();
            // 同步取色器
            const key = hex.dataset.ccHex;
            const colorEl = colorGrid.querySelector(`[data-cc-input="${key}"]`);
            if (colorEl) colorEl.value = hex.value;
            saveColorDebounced(key, hex.value);
        }
    });
    colorGrid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cc-clear]');
        if (!btn || btn.disabled) return;
        e.preventDefault();
        const key = btn.dataset.ccClear;
        const cur = loadSettings();
        const cc = { ...(cur.customColors || {}) };
        delete cc[key];
        saveSettings({ ...cur, customColors: cc });
        applyCustomColors();
        renderColorGrid();
    });
    wrap.querySelector('#cv_color_reset_all').addEventListener('click', (e) => {
        e.preventDefault();
        const cur = loadSettings();
        saveSettings({ ...cur, customColors: {} });
        applyCustomColors();
        renderColorGrid();
    });
    renderColorGrid();

    // 桌面窗口设置
    wrap.querySelector('#cv_set_desktop_mode').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, desktopPanelMode: e.target.value === 'dock' ? 'dock' : 'modal', windowState: null });
        if (panelEl) resetWindow();
    });
    wrap.querySelector('#cv_set_card_layout').addEventListener('change', (e) => {
        const cur = loadSettings();
        const val = ['auto', 'narrow', 'wide'].includes(e.target.value) ? e.target.value : 'auto';
        saveSettings({ ...cur, desktopCardLayout: val });
        const panel = document.getElementById('chatvault_panel');
        if (panel) applyPanelLayoutClass(panel, getLayoutForWidth(getCurrentState(panel).w));
    });
    wrap.querySelector('#cv_set_reader_expand').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, readerExpandMode: e.target.checked ? 'auto' : 'off' });
    });
    wrap.querySelector('#cv_set_left_dock_btn').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, leftDockButton: !!e.target.checked });
        applyDockTabState();
    });
    wrap.querySelector('#cv_set_window_free').addEventListener('change', (e) => {
        const cur = loadSettings();
        const on = !!e.target.checked;
        saveSettings({ ...cur, windowFreeMode: on });
        if (panelEl) panelEl.classList.toggle('cv-window-free', on || panelEl.classList.contains('cv-mode-dock'));
    });
    wrap.querySelector('#cv_set_hotkey').addEventListener('change', (e) => {
        const cur = loadSettings();
        saveSettings({ ...cur, windowHotkey: !!e.target.checked });
    });
    let _hkDebounce;
    wrap.querySelector('#cv_set_hotkey_combo').addEventListener('input', (e) => {
        clearTimeout(_hkDebounce);
        _hkDebounce = setTimeout(() => {
            const cur = loadSettings();
            saveSettings({ ...cur, windowHotkeyCombo: (e.target.value || '').trim() || 'Alt+V' });
        }, 300);
    });
    wrap.querySelector('#cv_set_window_reset').addEventListener('click', (e) => {
        e.preventDefault();
        resetWindow();
    });
}

jQuery(async () => {
    applyCustomFont();
    applyCustomColors();
    setupHotkey();
    // v0.5.16 fix: 给注入轮询加重试上限，避免酒馆某些定制 UI 永远不出现 #extensions_settings 时
    //              500ms 一次的 setTimeout 死循环常驻后台 CPU
    let _injectTries = 0;
    const INJECT_MAX_TRIES = 60; // 60 * 500ms = 30s 上限
    const tryInject = () => {
        if (document.getElementById('extensionsMenu')) applyEnabledState();
        if (document.getElementById('extensions_settings2')
         || document.getElementById('extensions_settings')) injectSettings();
        // 欢迎页按钮：等 #chat 就绪后挂 observer（observer 自己会重试）
        if (document.getElementById('chat')) applyWelcomeButtonState();
        applyDockTabState();

        const cur = loadSettings();
        const needBtn = cur.enabled && !document.getElementById('chatvault_open_btn');
        const needSet = !document.getElementById('chatvault_settings');
        const needWelcomeObs = cur.welcomeButton && !_cvWelcomeObserver;
        // v0.6.0: 手机上永远注入不了侧边栏按钮，旧逻辑会让 needDockTab 一直 true
        // → 空转 60 次 / 30 秒的轮询。这里直接把手机关掉。
        const needDockTab = cur.leftDockButton && !isMobileLayout() && !document.getElementById('chatvault_dock_tab');
        if (needBtn || needSet || needWelcomeObs || needDockTab) {
            if (++_injectTries < INJECT_MAX_TRIES) {
                setTimeout(tryInject, 500);
            } else {
                console.warn('[ChatVault] 注入重试已达上限（30s），放弃后台轮询。如需重试请刷新页面。');
            }
        }
    };
    tryInject();
    console.log(`[ChatVault] v${VERSION} 已加载`);
});
