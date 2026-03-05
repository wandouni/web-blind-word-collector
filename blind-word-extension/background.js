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

    // Truncate if over 100 chars
    let word = selectedText;
    let truncated = false;
    if (word.length > 100) {
      word = word.substring(0, 100);
      truncated = true;
    }

    const now = new Date();
    const addTime = formatDateTime(now);

    const newEntry = {
      id: Date.now().toString(),
      word: word,
      addTime: addTime,
      pageTitle: tab.title || '无标题网页',
      url: tab.url || '',
      note: '',
      status: 'pending' // 'pending' | 'done'
    };

    // Check duplicate
    const data = await getStorage();
    const words = data.blindWords || [];
    const exists = words.some(w => w.word === word);

    if (exists) {
      // Send message to content script
      chrome.tabs.sendMessage(tab.id, {
        type: 'SHOW_TOAST',
        message: '该盲词已存在，无需重复添加',
        style: 'warning'
      });
      return;
    }

    words.unshift(newEntry);
    await setStorage({ blindWords: words });

    chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_TOAST',
      message: truncated ? '盲词已截取至100字符并添加成功' : '盲词添加成功',
      style: 'success'
    });
  }
});

// Handle messages from content script / panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_WORDS') {
    getStorage().then(data => {
      sendResponse({ words: data.blindWords || [] });
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

async function handleAddWord(data, sendResponse) {
  const storage = await getStorage();
  const words = storage.blindWords || [];

  const exists = words.some(w => w.word === data.word);
  if (exists) {
    sendResponse({ success: false, reason: 'duplicate' });
    return;
  }

  let word = data.word;
  let truncated = false;
  if (word.length > 100) {
    word = word.substring(0, 100);
    truncated = true;
  }

  const newEntry = {
    id: Date.now().toString(),
    word: word,
    addTime: formatDateTime(new Date()),
    pageTitle: data.pageTitle || '',
    url: data.url || '',
    note: data.note || '',
    status: 'pending'
  };

  words.unshift(newEntry);
  await setStorage({ blindWords: words });
  sendResponse({ success: true, truncated, entry: newEntry });
}

async function handleUpdateWord(data, sendResponse) {
  const storage = await getStorage();
  const words = storage.blindWords || [];
  const idx = words.findIndex(w => w.id === data.id);
  if (idx === -1) {
    sendResponse({ success: false });
    return;
  }
  words[idx] = { ...words[idx], ...data.updates };
  await setStorage({ blindWords: words });
  sendResponse({ success: true, entry: words[idx] });
}

async function handleDeleteWord(id, sendResponse) {
  const storage = await getStorage();
  const words = (storage.blindWords || []).filter(w => w.id !== id);
  await setStorage({ blindWords: words });
  sendResponse({ success: true });
}

async function handleDeleteWords(ids, sendResponse) {
  const storage = await getStorage();
  const idSet = new Set(ids);
  const words = (storage.blindWords || []).filter(w => !idSet.has(w.id));
  await setStorage({ blindWords: words });
  sendResponse({ success: true });
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
