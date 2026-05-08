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

function headers() {
    // SillyTavern 全局函数，自动处理 CSRF
    return getRequestHeaders();
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
    const res = await fetch('/api/characters/chats', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ avatar_url: avatar, simple: true }),
    });
    if (!res.ok) {
        // 兼容旧版 API
        const res2 = await fetch('/api/chats/getall', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ avatar_url: avatar }),
        });
        if (!res2.ok) return [];
        return await res2.json();
    }
    return await res.json();
}

async function renameChat(avatar, oldName, newName) {
    const res = await fetch('/api/chats/rename', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            avatar_url: avatar,
            original_file: `${oldName}.jsonl`,
            renamed_file: `${newName}.jsonl`,
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
            chatfile: `${fileName}.jsonl`,
        }),
    });
    if (!res.ok) throw new Error(`删除失败: ${res.status}`);
}

// ---------- 跳转到指定聊天 ----------

async function jumpToChat(character, fileName) {
    try {
        const ctx = SillyTavern.getContext();
        const chid = ctx.characters.findIndex(c => c.avatar === character.avatar);
        if (chid < 0) throw new Error('找不到角色');

        // 切换到角色
        if (typeof ctx.selectCharacterById === 'function') {
            await ctx.selectCharacterById(chid);
        } else if (typeof window.selectCharacterById === 'function') {
            await window.selectCharacterById(chid);
        }

        // 打开指定聊天
        const open = ctx.openCharacterChat || window.openCharacterChat;
        if (typeof open === 'function') {
            await open(fileName);
        } else if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions(`/chat-jump file="${fileName}"`);
        } else {
            toastr.warning('已切换角色，但无法直接打开该聊天，请手动选择');
            return;
        }
        closePanel();
    } catch (e) {
        console.error('[ChatVault] 跳转失败', e);
        toastr.error(`跳转失败: ${e.message}`);
    }
}

// ---------- UI ----------

let panelEl = null;
let charactersCache = [];
let chatsByAvatar = {}; // { avatar: [{file_name, last_mes, mes, ...}] }
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
    setStatus('正在加载角色列表…');
    document.getElementById('cv_body').innerHTML = '<div class="cv-loading">正在加载…</div>';
    try {
        charactersCache = await fetchAllCharacters();
        setStatus(`共 ${charactersCache.length} 个角色，正在加载聊天档案…`);

        chatsByAvatar = {};
        let done = 0;
        const concurrency = 6;
        const queue = [...charactersCache];

        async function worker() {
            while (queue.length) {
                const c = queue.shift();
                try {
                    const list = await fetchChatsFor(c.avatar);
                    chatsByAvatar[c.avatar] = Array.isArray(list) ? list : [];
                } catch (e) {
                    chatsByAvatar[c.avatar] = [];
                }
                done++;
                setStatus(`已加载 ${done} / ${charactersCache.length} 个角色的聊天档案…`);
            }
        }

        await Promise.all(Array.from({ length: concurrency }, worker));

        const totalChats = Object.values(chatsByAvatar).reduce((s, a) => s + a.length, 0);
        setStatus(`✅ 共 ${charactersCache.length} 个角色，${totalChats} 条聊天档案`);
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

        html += `
            <div class="cv-char ${expanded}" data-avatar="${escapeHtml(c.avatar)}">
                <div class="cv-char-header">
                    <span class="cv-char-toggle">▶</span>
                    <img class="cv-char-avatar" src="${avatarUrl}" onerror="this.style.visibility='hidden'" />
                    <span class="cv-char-name">${highlight(c.name || '(无名)', q)}</span>
                    <span class="cv-char-count">${filteredChats.length} / ${chats.length} 条聊天</span>
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
