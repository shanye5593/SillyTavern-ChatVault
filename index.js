/**
 * SillyTavern ChatVault — 全局聊天记录管理器
 * https://github.com/shanye5593/SillyTavern-ChatVault
 */

const MODULE_NAME = 'chatvault';
const STORAGE_KEY = 'st-chatvault-meta';

// ---------- 本地元数据（收藏/标签）----------

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

function isStarred(avatar, fileName) {
    const m = loadMeta();
    return !!(m[metaKey(avatar, fileName)]?.starred);
}

function toggleStar(avatar, fileName) {
    const m = loadMeta();
    const k = metaKey(avatar, fileName);
    m[k] = m[k] || {};
    m[k].starred = !m[k].starred;
    saveMeta(m);
    return m[k].starred;
}

// ---------- 酒馆 API 调用 ----------

// 新版酒馆把 getRequestHeaders 改成了 ESM 导出，全局不再可用
// 用动态 import 拿到它；如果失败，用 cookie 自己构造 CSRF 头
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
    // 1. 优先用 ESM 导出的官方函数
    if (typeof _getReqHeaders === 'function') return _getReqHeaders();
    // 2. 老版本酒馆的全局函数
    if (typeof globalThis.getRequestHeaders === 'function') return globalThis.getRequestHeaders();
    // 3. 自己构造（从 cookie 读 CSRF）
    const token = getCsrfTokenFromCookie();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
    };
}

async function fetchAllCharacters() {
    // 优先用 context（同步、零成本）
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.characters?.length) return ctx.characters;
    } catch (e) { /* fallback */ }

    const res = await fetch('/api/characters/all', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`角色列表请求失败: ${res.status}`);
    return await res.json();
}

async function fetchChatsFor(avatar) {
    // 完全模仿酒馆官方 getPastCharacterChats() 的实现（script.js:8446）
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
    try {
        data = await res.json();
    } catch (e) {
        throw new Error(`响应解析失败: ${e.message}`);
    }
    // {error: true} 表示该角色还没有聊天目录 → 视为空，不是错误
    if (data && typeof data === 'object' && data.error === true) {
        return [];
    }
    // 响应可能是数组也可能是对象，用 Object.values 统一处理
    return Array.isArray(data) ? data : Object.values(data || {});
}

// 规范化：file_name 在不同 ST 版本里可能带或不带 .jsonl
function stripExt(name) {
    return String(name || '').replace(/\.jsonl$/i, '');
}
function withExt(name) {
    return stripExt(name) + '.jsonl';
}

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

// ---------- 跳转到指定聊天 ----------

async function jumpToChat(character, fileName) {
    try {
        const ctx = SillyTavern.getContext();
        // 用 avatar + name 双重匹配，处理重复头像的情况
        const candidates = ctx.characters
            .map((c, idx) => ({ c, idx }))
            .filter(({ c }) => c.avatar === character.avatar);
        let target = candidates.find(({ c }) => c.name === character.name) || candidates[0];
        if (!target) throw new Error('找不到角色（可能已被删除）');
        const chid = target.idx;

        // 切换到角色
        const select = ctx.selectCharacterById || window.selectCharacterById;
        if (typeof select !== 'function') {
            throw new Error('当前 ST 版本不支持自动切换角色');
        }
        await select(chid);

        // 等待角色切换完成
        const ok = await waitFor(() => {
            const c = SillyTavern.getContext();
            return Number(c.characterId) === chid;
        }, 3000);
        if (!ok) throw new Error('角色切换超时');

        // 打开指定聊天（不带扩展名）
        const target2 = stripExt(fileName);
        const open = ctx.openCharacterChat || window.openCharacterChat;
        if (typeof open === 'function') {
            await open(target2);
        } else if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions(`/chat-jump file="${target2}"`);
        } else {
            toastr.warning('已切换角色，但当前 ST 版本无法直接打开指定聊天，请手动选择');
            return;
        }
        closePanel();
    } catch (e) {
        console.error('[ChatVault] 跳转失败', e);
        toastr.error(`跳转失败: ${e.message}`);
    }
}

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

// ---------- UI ----------

let panelEl = null;
let charactersCache = [];
let chatsByAvatar = {}; // { avatar: [{file_name, last_mes, mes, ...}] }
let errorsByAvatar = {}; // { avatar: 'error message' }
let onlyStarred = false;

function openPanel() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.id = 'chatvault_overlay';
    panelEl.innerHTML = `
        <div id="chatvault_panel" onclick="event.stopPropagation()">
            <div class="chatvault-header">
                <h2>📚 聊天记录管理器</h2>
                <input type="text" class="chatvault-search" id="cv_search" placeholder="搜索角色名或聊天名…" />
                <div class="chatvault-toolbar">
                    <button id="cv_only_starred">⭐ 仅看收藏</button>
                    <button id="cv_expand_all">展开全部</button>
                    <button id="cv_collapse_all">收起全部</button>
                    <button id="cv_refresh">🔄 刷新</button>
                    <button id="chatvault_close">✕</button>
                </div>
            </div>
            <div class="chatvault-status" id="cv_status">准备就绪</div>
            <div class="chatvault-body" id="cv_body">
                <div class="cv-loading">正在加载…</div>
            </div>
        </div>
    `;
    panelEl.addEventListener('click', closePanel);
    document.body.appendChild(panelEl);

    document.getElementById('chatvault_close').onclick = closePanel;
    document.getElementById('cv_search').oninput = (e) => render(e.target.value.trim());
    document.getElementById('cv_only_starred').onclick = (e) => {
        onlyStarred = !onlyStarred;
        e.target.classList.toggle('active', onlyStarred);
        render(document.getElementById('cv_search').value.trim());
    };
    document.getElementById('cv_expand_all').onclick = () =>
        document.querySelectorAll('.cv-char').forEach(el => el.classList.add('expanded'));
    document.getElementById('cv_collapse_all').onclick = () =>
        document.querySelectorAll('.cv-char').forEach(el => el.classList.remove('expanded'));
    document.getElementById('cv_refresh').onclick = loadAll;

    // ESC 关闭
    document.addEventListener('keydown', escHandler);

    loadAll();
}

function escHandler(e) {
    if (e.key === 'Escape') closePanel();
}

function closePanel() {
    if (panelEl) {
        panelEl.remove();
        panelEl = null;
    }
    document.removeEventListener('keydown', escHandler);
}

function setStatus(text) {
    const el = document.getElementById('cv_status');
    if (el) el.textContent = text;
}

async function loadAll() {
    setStatus('正在初始化…');
    document.getElementById('cv_body').innerHTML = '<div class="cv-loading">正在加载…</div>';
    try {
        // 等待 getRequestHeaders 动态加载完成（避免竞态）
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
                    // 统一去掉 .jsonl 后缀，避免不同版本返回不一致
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

        const totalChats = Object.values(chatsByAvatar).reduce((s, a) => s + a.length, 0);
        const errCount = Object.keys(errorsByAvatar).length;
        const errSuffix = errCount ? `，⚠️ ${errCount} 个角色加载失败` : '';
        setStatus(`✅ 共 ${charactersCache.length} 个角色，${totalChats} 条聊天档案${errSuffix}`);
        render('');
    } catch (e) {
        console.error('[ChatVault] 加载失败', e);
        setStatus(`❌ 加载失败: ${e.message}`);
        document.getElementById('cv_body').innerHTML = `<div class="cv-empty">加载失败：${e.message}</div>`;
    }
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    return safe.replace(re, m => `<span class="cv-highlight">${m}</span>`);
}

function formatChatMeta(chat) {
    const parts = [];
    if (chat.mes !== undefined) parts.push(`${chat.mes} 条`);
    if (chat.last_mes) {
        const d = new Date(chat.last_mes);
        if (!isNaN(d)) parts.push(d.toLocaleDateString());
    } else if (chat.file_size) {
        parts.push(chat.file_size);
    }
    return parts.join(' · ');
}

function render(query) {
    const body = document.getElementById('cv_body');
    if (!body) return;
    const q = (query || '').toLowerCase();

    let html = '';
    let visibleCharCount = 0;

    // 排序：有聊天的角色在前，按聊天数倒序
    const sorted = [...charactersCache].sort((a, b) => {
        const ca = (chatsByAvatar[a.avatar] || []).length;
        const cb = (chatsByAvatar[b.avatar] || []).length;
        return cb - ca;
    });

    for (const c of sorted) {
        const chats = chatsByAvatar[c.avatar] || [];

        const filteredChats = chats.filter(ch => {
            const name = ch.file_name || '';
            if (onlyStarred && !isStarred(c.avatar, name)) return false;
            if (!q) return true;
            return name.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q);
        });

        // 角色名匹配但没聊天 → 也显示
        const charMatches = !q || (c.name || '').toLowerCase().includes(q);

        if (filteredChats.length === 0 && (!charMatches || onlyStarred)) continue;
        if (filteredChats.length === 0 && q && !charMatches) continue;

        visibleCharCount++;
        const expanded = q ? 'expanded' : '';
        const avatarUrl = c.avatar
            ? `/thumbnail?type=avatar&file=${encodeURIComponent(c.avatar)}`
            : '';

        const errMsg = errorsByAvatar[c.avatar];
        const errBadge = errMsg
            ? `<span class="cv-char-count" style="color:#e57373" title="${escapeHtml(errMsg)}">⚠️ 加载失败</span>`
            : `<span class="cv-char-count">${filteredChats.length} / ${chats.length} 条聊天</span>`;

        html += `
            <div class="cv-char ${expanded}" data-avatar="${escapeHtml(c.avatar)}">
                <div class="cv-char-header">
                    <span class="cv-char-toggle">▶</span>
                    <img class="cv-char-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" />
                    <span class="cv-char-name">${highlight(c.name || '(无名)', q)}</span>
                    ${errBadge}
                </div>
                <div class="cv-chats">
                    ${filteredChats.map(ch => {
                        const name = ch.file_name || '';
                        const starred = isStarred(c.avatar, name);
                        return `
                            <div class="cv-chat" data-file="${escapeHtml(name)}">
                                <span class="cv-chat-star ${starred ? 'starred' : ''}" title="收藏">${starred ? '★' : '☆'}</span>
                                <span class="cv-chat-name">${highlight(name, q)}</span>
                                <span class="cv-chat-meta">${escapeHtml(formatChatMeta(ch))}</span>
                                <span class="cv-chat-actions">
                                    <button data-act="open">打开</button>
                                    <button data-act="rename">重命名</button>
                                    <button data-act="delete" class="danger">删除</button>
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    if (visibleCharCount === 0) {
        body.innerHTML = `<div class="cv-empty">${q ? '没有匹配的结果' : (onlyStarred ? '还没有收藏的聊天' : '没有任何聊天记录')}</div>`;
    } else {
        body.innerHTML = html;
        bindEvents();
    }
}

function bindEvents() {
    // 角色折叠
    document.querySelectorAll('.cv-char-header').forEach(el => {
        el.onclick = () => el.parentElement.classList.toggle('expanded');
    });

    // 聊天行点击
    document.querySelectorAll('.cv-chat').forEach(row => {
        const charEl = row.closest('.cv-char');
        const avatar = charEl.dataset.avatar;
        const fileName = row.dataset.file;
        const character = charactersCache.find(c => c.avatar === avatar);

        // 收藏
        row.querySelector('.cv-chat-star').onclick = (e) => {
            e.stopPropagation();
            const starred = toggleStar(avatar, fileName);
            e.target.classList.toggle('starred', starred);
            e.target.textContent = starred ? '★' : '☆';
        };

        // 双击聊天名 → 打开
        row.querySelector('.cv-chat-name').ondblclick = (e) => {
            e.stopPropagation();
            jumpToChat(character, fileName);
        };

        // 操作按钮
        row.querySelectorAll('.cv-chat-actions button').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const act = btn.dataset.act;
                if (act === 'open') {
                    jumpToChat(character, fileName);
                } else if (act === 'rename') {
                    handleRename(row, character, fileName);
                } else if (act === 'delete') {
                    handleDelete(character, fileName);
                }
            };
        });
    });
}

async function handleRename(row, character, oldName) {
    const nameSpan = row.querySelector('.cv-chat-name');
    const original = oldName;
    nameSpan.innerHTML = `<input type="text" value="${escapeHtml(original)}" />`;
    const input = nameSpan.querySelector('input');
    input.focus();
    input.select();

    const finish = async (commit) => {
        const newName = input.value.trim();
        if (!commit || !newName || newName === original) {
            nameSpan.textContent = original;
            return;
        }
        try {
            setStatus('正在重命名…');
            await renameChat(character.avatar, original, newName);
            // 更新本地缓存
            const list = chatsByAvatar[character.avatar] || [];
            const item = list.find(c => c.file_name === original);
            if (item) item.file_name = newName;
            setStatus('✅ 已重命名');
            render(document.getElementById('cv_search').value.trim());
        } catch (e) {
            setStatus(`❌ 重命名失败: ${e.message}`);
            nameSpan.textContent = original;
        }
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
}

async function handleDelete(character, fileName) {
    if (!confirm(`确定删除「${character.name}」的聊天「${fileName}」吗？\n此操作无法撤销。`)) return;
    try {
        setStatus('正在删除…');
        await deleteChat(character.avatar, fileName);
        chatsByAvatar[character.avatar] = (chatsByAvatar[character.avatar] || [])
            .filter(c => c.file_name !== fileName);
        setStatus('✅ 已删除');
        render(document.getElementById('cv_search').value.trim());
    } catch (e) {
        setStatus(`❌ 删除失败: ${e.message}`);
    }
}

// ---------- 注入入口按钮 ----------

function injectButton() {
    // 优先放在 #extensionsMenu，再退到 #top-bar
    if (document.getElementById('chatvault_open_btn')) return;

    const btn = document.createElement('div');
    btn.id = 'chatvault_open_btn';
    btn.className = 'list-group-item flex-container flexGap5 interactable';
    btn.title = '打开聊天记录管理器';
    btn.innerHTML = `<div class="fa-solid fa-book"></div><span>聊天记录管理器</span>`;
    btn.onclick = openPanel;

    const extMenu = document.getElementById('extensionsMenu');
    if (extMenu) {
        extMenu.appendChild(btn);
        return;
    }

    // 退路：浮动按钮
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#333;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;';
    document.body.appendChild(btn);
}

// ---------- 初始化 ----------

jQuery(async () => {
    // 等待酒馆完全加载
    const tryInject = () => {
        if (document.getElementById('extensionsMenu')) {
            injectButton();
        } else {
            setTimeout(tryInject, 500);
        }
    };
    tryInject();

    console.log('[ChatVault] 已加载');
});
