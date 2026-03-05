// background.js

// Handle extension icon click - open side panel
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
  } catch (e) {
    // Content script not ready, inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content.css']
    });
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
      } catch(e2) {}
    }, 300);
  }
});

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'addBlindWord',
    title: '添加至盲词',
    contexts: ['selection']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'addBlindWord') {
    const selectedText = info.selectionText?.trim();
    if (!selectedText) return;

    // 截断放在重复检测前，保证比较的是最终存入的文本
    let word = selectedText.trim();
    let truncated = false;
    if (word.length > 100) {
      word = word.substring(0, 100);
      truncated = true;
    }
    if (!word) return;

    await enqueueWrite(async () => {
      const words = await getWords();
      const exists = words.some(w => w.word === word);

      if (exists) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SHOW_TOAST',
          message: '该盲词已存在，无需重复添加',
          style: 'warning'
        });
        return;
      }

      const newEntry = {
        id: Date.now().toString(),
        word,
        addTime: formatDateTime(new Date()),
        pageTitle: tab.title || '无标题网页',
        url: tab.url || '',
        note: '',
        status: 'pending'
      };

      words.unshift(newEntry);
      await saveWords(words);

      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_TOAST',
        message: truncated ? '盲词已截取至100字符并添加成功' : '盲词添加成功',
        style: 'success'
      });
      chrome.tabs.sendMessage(tab.id, { type: 'REFRESH_PANEL' });
    });
  }
});

// Handle messages from content script / panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_WORDS') {
    getWords().then(words => {
      sendResponse({ words });
    });
    return true;
  }

  if (message.type === 'ADD_WORD') {
    handleAddWord(message.data, sendResponse);
    return true;
  }

  if (message.type === 'UPDATE_WORD') {
    handleUpdateWord(message.data, sendResponse);
    return true;
  }

  if (message.type === 'DELETE_WORD') {
    handleDeleteWord(message.id, sendResponse);
    return true;
  }

  if (message.type === 'DELETE_WORDS') {
    handleDeleteWords(message.ids, sendResponse);
    return true;
  }

  if (message.type === 'EXPORT_WORDS') {
    getStorage().then(data => {
      sendResponse({ words: data.blindWords || [] });
    });
    return true;
  }

  if (message.type === 'IMPORT_WORDS') {
    handleImportWords(message.entries, sendResponse);
    return true;
  }

  if (message.type === 'GET_THEME') {
    getStorage().then(data => {
      sendResponse({ theme: data.theme || 'light' });
    });
    return true;
  }

  if (message.type === 'SET_THEME') {
    setStorage({ theme: message.theme }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_SYNC_SETTING') {
    getStorage().then(data => {
      sendResponse({ syncEnabled: data.syncEnabled || false });
    });
    return true;
  }

  if (message.type === 'SET_SYNC_SETTING') {
    setStorage({ syncEnabled: message.enabled }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── 串行写操作队列，防止并发竞态导致数据丢失 ──────────────────
let _writeQueue = Promise.resolve();
function enqueueWrite(fn) {
  _writeQueue = _writeQueue.then(() => fn()).catch(err => console.error('write error', err));
  return _writeQueue;
}

function getWords() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('blindWords', data => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(data.blindWords || []);
    });
  });
}

function saveWords(words) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ blindWords: words }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function handleAddWord(data, sendResponse) {
  await enqueueWrite(async () => {
    // 截断逻辑在重复检测之前，保证比较的是最终存入的文本
    let word = (data.word || '').trim();
    let truncated = false;
    if (word.length > 100) {
      word = word.substring(0, 100);
      truncated = true;
    }
    if (!word) {
      sendResponse({ success: false, reason: 'empty' });
      return;
    }

    const words = await getWords();
    const exists = words.some(w => w.word === word);
    if (exists) {
      sendResponse({ success: false, reason: 'duplicate' });
      return;
    }

    const newEntry = {
      id: Date.now().toString(),
      word,
      addTime: formatDateTime(new Date()),
      pageTitle: data.pageTitle || '',
      url: data.url || '',
      note: data.note || '',
      status: 'pending'
    };

    words.unshift(newEntry);
    await saveWords(words);
    sendResponse({ success: true, truncated, entry: newEntry });
  });
}

async function handleUpdateWord(data, sendResponse) {
  await enqueueWrite(async () => {
    const words = await getWords();
    const idx = words.findIndex(w => w.id === data.id);
    if (idx === -1) {
      sendResponse({ success: false, reason: 'not_found' });
      return;
    }

    // 如果更新了 word 文本，做截断 + 重复检测（排除自身）
    const updates = { ...data.updates };
    if (updates.word !== undefined) {
      let newWord = (updates.word || '').trim();
      let truncated = false;
      if (newWord.length > 100) { newWord = newWord.substring(0, 100); truncated = true; }
      if (!newWord) {
        sendResponse({ success: false, reason: 'empty' });
        return;
      }
      const duplicate = words.some((w, i) => i !== idx && w.word === newWord);
      if (duplicate) {
        sendResponse({ success: false, reason: 'duplicate' });
        return;
      }
      updates.word = newWord;
      if (truncated) updates._truncated = true;
    }

    words[idx] = { ...words[idx], ...updates };
    await saveWords(words);
    sendResponse({ success: true, entry: words[idx], truncated: !!updates._truncated });
  });
}

async function handleDeleteWord(id, sendResponse) {
  await enqueueWrite(async () => {
    const words = await getWords();
    await saveWords(words.filter(w => w.id !== id));
    sendResponse({ success: true });
  });
}

async function handleImportWords(entries, sendResponse) {
  await enqueueWrite(async () => {
    const words = await getWords();
    const existingSet = new Set(words.map(w => w.word));
    let added = 0, skipped = 0;

    // 先收集所有新条目，保持导入文件中的顺序
    const newEntries = [];
    for (const entry of entries) {
      if (!entry.word) continue;
      if (existingSet.has(entry.word)) {
        skipped++;
        continue;
      }
      newEntries.push({
        id: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
        word:      entry.word,
        addTime:   entry.addTime || formatDateTime(new Date()),
        pageTitle: entry.pageTitle || '',
        url:       entry.url || '',
        note:      entry.note || '',
        status:    entry.status === 'done' ? 'done' : 'pending',
      });
      existingSet.add(entry.word);
      added++;
    }
    // 整体插到列表头部，顺序与导出文件保持一致
    words.unshift(...newEntries);

    await saveWords(words);
    sendResponse({ success: true, added, skipped });
  });
}

async function handleDeleteWords(ids, sendResponse) {
  await enqueueWrite(async () => {
    const idSet = new Set(ids);
    const words = await getWords();
    await saveWords(words.filter(w => !idSet.has(w.id)));
    sendResponse({ success: true });
  });
}

function getStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, data => resolve(data));
  });
}

function setStorage(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

function formatDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
