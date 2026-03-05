// content.js
(function() {
  'use strict';

  let panelOpen = false;
  let allWords = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedIds = new Set();
  let batchMode = false;
  let currentTheme = 'light'; // 'light' | 'dark'

  // ── Theme ──────────────────────────────────────────────────────────────
  async function loadTheme() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_THEME' });
      currentTheme = res.theme || 'light';
    } catch(e) { currentTheme = 'light'; }
  }

  async function saveTheme(theme) {
    try {
      await chrome.runtime.sendMessage({ type: 'SET_THEME', theme });
    } catch(e) {}
  }

  function applyTheme(panel) {
    if (currentTheme === 'dark') {
      panel.classList.add('theme-dark');
    } else {
      panel.classList.remove('theme-dark');
    }
  }

  async function toggleTheme() {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    const panel = document.getElementById('blind-word-panel');
    if (panel) applyTheme(panel);
    await saveTheme(currentTheme);
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  function showToast(message, style = 'success') {
    let toast = document.getElementById('blind-word-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'blind-word-toast';
      document.body.appendChild(toast);
    }
    toast.className = `${style}`;
    toast.textContent = message;
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // ── Panel ──────────────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById('blind-word-panel')) return;

    const overlay = document.createElement('div');
    overlay.id = 'blind-word-panel-overlay';

    const panel = document.createElement('div');
    panel.id = 'blind-word-panel';
    panel.innerHTML = getPanelHTML();

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    bindEvents(panel, overlay);
  }

  function getPanelHTML() {
    return `
      <div class="bw-header">
        <div class="bw-header-top">
          <div class="bw-logo">
            <div class="bw-logo-icon">📚</div>
            <span class="bw-title">盲词管理</span>
          </div>
          <div class="bw-header-controls">
            <button class="bw-theme-btn" id="bw-theme-toggle" title="切换皮肤">
              <span class="bw-icon bw-icon-sun">☀️</span>
              <span class="bw-icon bw-icon-moon">🌙</span>
            </button>
            <button class="bw-close-btn" id="bw-close">✕</button>
          </div>
        </div>
        <div class="bw-stats" id="bw-stats">
          <div class="bw-stat-item">
            <div class="bw-stat-num" id="bw-total">0</div>
            <div class="bw-stat-label">全部</div>
          </div>
          <div class="bw-stat-item">
            <div class="bw-stat-num" id="bw-pending">0</div>
            <div class="bw-stat-label">待处理</div>
          </div>
          <div class="bw-stat-item">
            <div class="bw-stat-num" id="bw-done">0</div>
            <div class="bw-stat-label">已处理</div>
          </div>
        </div>
        <div class="bw-search-wrap">
          <span class="bw-search-icon">🔍</span>
          <input class="bw-search" id="bw-search" placeholder="搜索盲词、备注..." type="text">
        </div>
        <div class="bw-filters">
          <button class="bw-filter-btn active" data-filter="all">全部</button>
          <button class="bw-filter-btn" data-filter="pending">待处理</button>
          <button class="bw-filter-btn" data-filter="done">已处理</button>
          <button class="bw-filter-btn" data-filter="nonote">无备注</button>
        </div>
        <div class="bw-toolbar">
          <button class="bw-btn bw-btn-primary" id="bw-add-btn">＋ 添加盲词</button>
          <button class="bw-btn bw-btn-ghost" id="bw-select-btn">☑ 多选</button>
          <button class="bw-btn bw-btn-danger" id="bw-batch-delete" style="display:none" disabled>🗑 删除(<span id="bw-select-count">0</span>)</button>
          <button class="bw-btn bw-btn-ghost" id="bw-select-cancel" style="display:none">取消</button>
          <button class="bw-btn bw-btn-ghost" id="bw-export-btn">↓ 导出</button>
        </div>
      </div>
      <div class="bw-list-wrap" id="bw-list-wrap">
        <div id="bw-list"></div>
      </div>
    `;
  }

  function bindEvents(panel, overlay) {
    // Close
    panel.querySelector('#bw-close').addEventListener('click', closePanel);

    // Theme toggle
    panel.querySelector('#bw-theme-toggle').addEventListener('click', toggleTheme);
    // Search
    panel.querySelector('#bw-search').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderList();
    });

    // Filters
    panel.querySelectorAll('.bw-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.bw-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        selectedIds.clear();
        renderList();
      });
    });

    // Add
    panel.querySelector('#bw-add-btn').addEventListener('click', showAddModal);

    // 进入多选模式
    panel.querySelector('#bw-select-btn').addEventListener('click', () => {
      batchMode = true;
      selectedIds.clear();
      panel.querySelector('#bw-select-btn').style.display = 'none';
      panel.querySelector('#bw-batch-delete').style.display = '';
      panel.querySelector('#bw-select-cancel').style.display = '';
      panel.classList.add('bw-select-mode');
      renderList();
    });

    // 取消多选模式
    panel.querySelector('#bw-select-cancel').addEventListener('click', () => {
      batchMode = false;
      selectedIds.clear();
      panel.querySelector('#bw-select-btn').style.display = '';
      panel.querySelector('#bw-batch-delete').style.display = 'none';
      panel.querySelector('#bw-select-cancel').style.display = 'none';
      panel.classList.remove('bw-select-mode');
      renderList();
    });

    // 批量删除
    panel.querySelector('#bw-batch-delete').addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      showConfirmModal(
        `确认删除选中的 ${selectedIds.size} 条盲词？`,
        '',
        async () => {
          const count = selectedIds.size;
          await chrome.runtime.sendMessage({ type: 'DELETE_WORDS', ids: [...selectedIds] });
          batchMode = false;
          selectedIds.clear();
          panel.querySelector('#bw-select-btn').style.display = '';
          panel.querySelector('#bw-batch-delete').style.display = 'none';
          panel.querySelector('#bw-select-cancel').style.display = 'none';
          panel.classList.remove('bw-select-mode');
          await refreshWords();
          showToast(`已删除 ${count} 条盲词`);
        }
      );
    });

    // Export
    panel.querySelector('#bw-export-btn').addEventListener('click', showExportModal);
  }

  function getFilteredWords() {
    let words = allWords;
    if (currentFilter === 'pending') words = words.filter(w => w.status === 'pending');
    if (currentFilter === 'done') words = words.filter(w => w.status === 'done');
    if (currentFilter === 'nonote') words = words.filter(w => !w.note || !w.note.trim());
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      words = words.filter(w =>
        w.word.toLowerCase().includes(q) ||
        (w.note || '').toLowerCase().includes(q)
      );
    }
    return words;
  }

  function renderList() {
    const list = document.getElementById('bw-list');
    if (!list) return;

    const words = getFilteredWords();
    updateStats();
    updateBatchBtn();

    if (words.length === 0) {
      list.innerHTML = `
        <div class="bw-empty">
          <div class="bw-empty-icon">🔍</div>
          <div class="bw-empty-text">${searchQuery ? '没有匹配的盲词' : '暂无盲词，开始添加吧'}</div>
        </div>`;
      return;
    }

    list.innerHTML = words.map(w => renderItem(w)).join('');

    // Bind item events
    // checkbox 只负责状态切换（待处理 ↔ 已处理）
    list.querySelectorAll('.bw-checkbox').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const checked = e.target.checked;
        const word = allWords.find(w => w.id === id);
        if (!word) return;
        const newStatus = checked ? 'done' : 'pending';
        await chrome.runtime.sendMessage({ type: 'UPDATE_WORD', data: { id, updates: { status: newStatus } } });
        await refreshWords();
      });
    });

    // 多选框（bw-select-box）只负责批量选中，与状态无关
    list.querySelectorAll('.bw-select-box').forEach(box => {
      box.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateBatchBtn();
      });
    });

    list.querySelectorAll('.bw-word-clickable').forEach(span => {
      span.addEventListener('click', () => {
        if (batchMode) return;
        showEditModal(span.dataset.id);
      });
    });

    list.querySelectorAll('.bw-action-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const word = allWords.find(w => w.id === btn.dataset.id);
        showConfirmModal('确认删除以下盲词？', word?.word || '', async () => {
          await chrome.runtime.sendMessage({ type: 'DELETE_WORD', id: btn.dataset.id });
          await refreshWords();
          showToast('盲词已删除');
        });
      });
    });


  }

  function renderItem(w) {
    const isDone = w.status === 'done';
    const isSelected = selectedIds.has(w.id);
    const statusLabel = isDone ? '已处理' : '待处理';
    const statusClass = isDone ? 'done' : 'pending';
    const hasNote = w.note && w.note.trim();
    return `
      <div class="bw-item ${isDone ? 'done' : ''} ${isSelected ? 'bw-selected' : ''}" data-id="${w.id}">
        <div class="bw-item-top">
          ${batchMode ? `<input type="checkbox" class="bw-select-box" data-id="${w.id}" ${isSelected ? 'checked' : ''}>` : ''}
          <input type="checkbox" class="bw-checkbox" data-id="${w.id}" ${isDone ? 'checked' : ''}>
          <span class="bw-word-text bw-word-clickable" data-id="${w.id}">${escapeHtml(w.word)}</span>
          <div class="bw-item-tags">
            <span class="bw-status-badge ${statusClass}">${statusLabel}</span>
            <span class="bw-note-badge ${hasNote ? 'has-note' : 'no-note'}">${hasNote ? '有备注' : '无备注'}</span>
          </div>
          ${!batchMode ? `<div class="bw-item-actions">
            <button class="bw-action-btn bw-action-delete" data-id="${w.id}" title="删除">🗑</button>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  function updateStats() {
    const total = allWords.length;
    const pending = allWords.filter(w => w.status === 'pending').length;
    const done = allWords.filter(w => w.status === 'done').length;
    const el = (id) => document.getElementById(id);
    if (el('bw-total')) el('bw-total').textContent = total;
    if (el('bw-pending')) el('bw-pending').textContent = pending;
    if (el('bw-done')) el('bw-done').textContent = done;
  }

  function updateBatchBtn() {
    const btn = document.getElementById('bw-batch-delete');
    const countEl = document.getElementById('bw-select-count');
    if (btn) btn.disabled = selectedIds.size === 0;
    if (countEl) countEl.textContent = selectedIds.size;
  }

  // ── Modals ─────────────────────────────────────────────────────────────
  function showModal(html, onMount, wide = false) {
    removeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'bw-modal-backdrop';
    backdrop.id = 'bw-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = wide ? 'bw-modal bw-modal-wide' : 'bw-modal';
    modal.innerHTML = html;
    backdrop.appendChild(modal);
    document.getElementById('blind-word-panel').appendChild(backdrop);
    if (onMount) onMount(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) removeModal();
    });
  }

  function removeModal() {
    document.getElementById('bw-modal-backdrop')?.remove();
  }

  function showAddModal() {
    const pageTitle = document.title || '';
    const pageUrl = window.location.href || '';

    showModal(`
      <div class="bw-modal-title">＋ 添加盲词</div>
      <div class="bw-form-group">
        <label class="bw-form-label">盲词 *</label>
        <input class="bw-form-input" id="bw-new-word" placeholder="输入盲词（最多100字符）" maxlength="100">
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">页面标题</label>
        <input class="bw-form-input" id="bw-new-title" placeholder="可选" value="${escapeHtml(pageTitle)}">
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">来源URL</label>
        <input class="bw-form-input" id="bw-new-url" placeholder="可选" value="${escapeHtml(pageUrl)}">
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">备注</label>
        <textarea class="bw-form-textarea" id="bw-new-note" placeholder="可选：释义、学习心得等"></textarea>
      </div>
      <div class="bw-modal-actions">
        <button class="bw-btn bw-btn-ghost" id="bw-modal-cancel">取消</button>
        <button class="bw-btn bw-btn-primary" id="bw-modal-confirm">添加</button>
      </div>
    `, (modal) => {
      modal.querySelector('#bw-new-word').focus();
      modal.querySelector('#bw-modal-cancel').addEventListener('click', removeModal);
      modal.querySelector('#bw-modal-confirm').addEventListener('click', async () => {
        const word = modal.querySelector('#bw-new-word').value.trim();
        if (!word) { showToast('请输入盲词', 'warning'); return; }
        const res = await chrome.runtime.sendMessage({
          type: 'ADD_WORD',
          data: {
            word,
            pageTitle: modal.querySelector('#bw-new-title').value.trim(),
            url: modal.querySelector('#bw-new-url').value.trim(),
            note: modal.querySelector('#bw-new-note').value.trim()
          }
        });
        if (res.success) {
          removeModal();
          await refreshWords();
          showToast(res.truncated ? '盲词已截取至100字符并添加成功' : '盲词添加成功');
        } else if (res.reason === 'duplicate') {
          showToast('该盲词已存在，无需重复添加', 'warning');
        }
      });
    });
  }

  function showEditModal(id) {
    const word = allWords.find(w => w.id === id);
    if (!word) return;
    showModal(`
      <div class="bw-modal-title">✏ 编辑盲词</div>
      <div class="bw-form-group">
        <label class="bw-form-label">盲词 *</label>
        <input class="bw-form-input" id="bw-edit-word" value="${escapeHtml(word.word)}" maxlength="100">
      </div>
      <div class="bw-form-row-2">
        <div class="bw-form-group">
          <label class="bw-form-label">添加时间</label>
          <input class="bw-form-input" value="${word.addTime}" disabled>
        </div>
        <div class="bw-form-group">
          <label class="bw-form-label">状态</label>
          <input class="bw-form-input" value="${word.status === 'done' ? '✓ 已处理' : '⏳ 待处理'}" disabled>
        </div>
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">页面标题</label>
        <input class="bw-form-input" value="${escapeHtml(word.pageTitle || '—')}" disabled>
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">来源URL</label>
        <input class="bw-form-input" value="${escapeHtml(word.url || '—')}" disabled title="${escapeHtml(word.url || '')}">
      </div>
      <div class="bw-form-group">
        <label class="bw-form-label">备注</label>
        <textarea class="bw-form-textarea bw-form-textarea-tall" id="bw-edit-note" placeholder="释义、学习心得、关联知识点等...">${escapeHtml(word.note || '')}</textarea>
      </div>
      <div class="bw-modal-actions">
        <button class="bw-btn bw-btn-ghost" id="bw-modal-cancel">取消</button>
        <button class="bw-btn bw-btn-primary" id="bw-modal-confirm">保存</button>
      </div>
    `, (modal) => {
      modal.querySelector('#bw-modal-cancel').addEventListener('click', removeModal);
      modal.querySelector('#bw-modal-confirm').addEventListener('click', async () => {
        const newWord = modal.querySelector('#bw-edit-word').value.trim();
        const newNote = modal.querySelector('#bw-edit-note').value.trim();
        if (!newWord) { showToast('盲词不能为空', 'warning'); return; }
        let finalWord = newWord;
        let truncated = false;
        if (finalWord.length > 100) { finalWord = finalWord.substring(0, 100); truncated = true; }
        const res = await chrome.runtime.sendMessage({
          type: 'UPDATE_WORD',
          data: { id, updates: { word: finalWord, note: newNote } }
        });
        if (!res || !res.success) {
          if (res?.reason === 'duplicate') {
            showToast('该盲词已存在，请换一个词语', 'warning');
          } else if (res?.reason === 'empty') {
            showToast('盲词不能为空', 'warning');
          } else {
            showToast('保存失败，请重试', 'warning');
          }
          return;
        }
        removeModal();
        await refreshWords();
        showToast(res.truncated ? '已截取至100字符并保存' : '已保存');
      });
    }, true);
  }

  function showConfirmModal(text, wordText, onConfirm) {
    showModal(`
      <div class="bw-modal-title">⚠ 确认删除</div>
      <p class="bw-confirm-text">${escapeHtml(text)}</p>
      ${wordText ? `<div class="bw-confirm-word">${escapeHtml(wordText)}</div>` : ''}
      <div class="bw-modal-actions" style="margin-top:20px">
        <button class="bw-btn bw-btn-ghost" id="bw-modal-cancel">取消</button>
        <button class="bw-btn bw-btn-danger" id="bw-modal-confirm">确认删除</button>
      </div>
    `, (modal) => {
      modal.querySelector('#bw-modal-cancel').addEventListener('click', removeModal);
      modal.querySelector('#bw-modal-confirm').addEventListener('click', async () => {
        removeModal();
        await onConfirm();
      });
    });
  }

  function showExportModal() {
    let exportFilter = 'all';
    showModal(`
      <div class="bw-modal-title">↓ 导出盲词</div>
      <p style="font-size:13px;color:#888;margin-bottom:14px">选择导出范围：</p>
      <div class="bw-export-opts">
        <button class="bw-export-opt active" data-val="all">全部</button>
        <button class="bw-export-opt" data-val="pending">待处理</button>
        <button class="bw-export-opt" data-val="done">已处理</button>
      </div>
      <div class="bw-modal-actions" style="margin-top:20px">
        <button class="bw-btn bw-btn-ghost" id="bw-modal-cancel">取消</button>
        <button class="bw-btn bw-btn-primary" id="bw-modal-confirm">导出 Excel</button>
      </div>
    `, (modal) => {
      modal.querySelectorAll('.bw-export-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('.bw-export-opt').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          exportFilter = btn.dataset.val;
        });
      });
      modal.querySelector('#bw-modal-cancel').addEventListener('click', removeModal);
      modal.querySelector('#bw-modal-confirm').addEventListener('click', () => {
        removeModal();
        doExport(exportFilter);
      });
    });
  }

  function doExport(filter) {
    let words = allWords;
    if (filter === 'pending') words = words.filter(w => w.status === 'pending');
    if (filter === 'done') words = words.filter(w => w.status === 'done');

    // Build CSV-style data, then convert to Excel-compatible format
    const headers = ['词语', '添加时间', '页面标题', 'URL', '状态', '备注'];
    const rows = words.map(w => [
      w.word,
      w.addTime,
      w.pageTitle || '',
      w.url || '',
      w.status === 'done' ? '已处理' : '待处理',
      w.note || ''
    ]);

    // Generate a proper XLSX using a simple XML-based format
    const xlsxContent = generateXLSX(headers, rows);
    const blob = new Blob([xlsxContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    a.download = `盲词管理_${ts}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${words.length} 条盲词`);
  }

  function generateXLSX(headers, rows) {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="header">
    <Font ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#6C63FF" ss:Pattern="Solid"/>
  </Style>
</Styles>
<Worksheet ss:Name="盲词列表">
<Table>
`;
    // Header row
    xml += '<Row>';
    headers.forEach(h => {
      xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`;
    });
    xml += '</Row>\n';

    // Data rows
    rows.forEach(row => {
      xml += '<Row>';
      row.forEach(cell => {
        xml += `<Cell><Data ss:Type="String">${esc(cell)}</Data></Cell>`;
      });
      xml += '</Row>\n';
    });

    xml += '</Table></Worksheet></Workbook>';
    return '\uFEFF' + xml;
  }

  // ── Panel open/close ───────────────────────────────────────────────────
  async function openPanel() {
    await loadTheme();
    buildPanel();
    const panel = document.getElementById('blind-word-panel');
    applyTheme(panel);
    await refreshWords();
    const overlay = document.getElementById('blind-word-panel-overlay');
    overlay.classList.add('active');
    requestAnimationFrame(() => panel.classList.add('open'));
    panelOpen = true;
  }

  function closePanel() {
    const panel = document.getElementById('blind-word-panel');
    const overlay = document.getElementById('blind-word-panel-overlay');
    if (!panel) return;
    panel.classList.remove('open');
    overlay.classList.remove('active');
    panelOpen = false;
    removeModal();
  }

  async function refreshWords() {
    const res = await chrome.runtime.sendMessage({ type: 'GET_WORDS' });
    allWords = res.words || [];
    renderList();
  }

  // ── Message listener ───────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SHOW_TOAST') {
      showToast(message.message, message.style);
    }
    if (message.type === 'REFRESH_PANEL') {
      if (panelOpen) refreshWords();
    }
    if (message.type === 'TOGGLE_PANEL') {
      if (panelOpen) closePanel();
      else openPanel();
    }
  });

  // ── Extension icon click listener via storage ──────────────────────────
  // Listen for icon click via chrome.action
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'OPEN_PANEL') {
      openPanel();
    }
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
