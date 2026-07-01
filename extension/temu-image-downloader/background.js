const POD_INTAKE_URL = 'http://127.0.0.1:8787/api/intake';

function storageGet(area, keys) {
  return new Promise((resolve) => chrome.storage[area].get(keys, resolve));
}

function storageSet(area, values) {
  return new Promise((resolve) => chrome.storage[area].set(values, resolve));
}

function downloadImage(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(downloadId);
    });
  });
}

function buildSourceCode(sequence) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  return `${stamp}_${String(sequence).padStart(4, '0')}`;
}

async function postToPod(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(POD_INTAKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function handlePodMode({ url, listing }) {
  const { cached_items: rawItems = [] } = await storageGet('local', ['cached_items']);
  const items = Array.isArray(rawItems) ? rawItems : [];
  const exists = items.some((item) => item && item.imageurl === url);
  if (exists) return { success: true, cachedCount: items.length, alreadyExists: true };

  const item = {
    '编号': buildSourceCode(items.length + 1),
    listing: String(listing || '').trim(),
    imageurl: url
  };
  items.push(item);
  await storageSet('local', { cached_items: items });

  try {
    const pod = await postToPod(item);
    return { success: true, cachedCount: items.length, synced: true, podStatus: pod.status };
  } catch (error) {
    console.warn('[Temu POD] Server unavailable, kept in extension cache:', error.message);
    return { success: true, cachedCount: items.length, pendingSync: true, warning: error.message };
  }
}

async function handleLocalMode({ url, filename, subfolder }) {
  const { local_download_count: oldCount = 0 } = await storageGet('local', ['local_download_count']);
  const currentCount = Number(oldCount || 0) + 1;
  await storageSet('local', { local_download_count: currentCount });
  const seq = String(currentCount).padStart(3, '0');
  const folder = (subfolder || 'Temu').replace(/\\/g, '/').replace(/\/$/, '');
  const safeName = filename || `temu_${Date.now()}`;
  const finalFileName = `${seq}-${safeName}.jpg`;
  const downloadId = await downloadImage({
    url,
    filename: `${folder}/${finalFileName}`,
    conflictAction: 'uniquify',
    saveAs: false
  });
  return { success: true, downloadId, finalFileName };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'downloadImage') return false;
  (async () => {
    try {
      if (!message.url) throw new Error('没有获取到商品 imageurl');
      const { mode = 'cache' } = await storageGet('sync', ['mode']);
      const result = mode === 'local'
        ? await handleLocalMode(message)
        : await handlePodMode(message);
      sendResponse(result);
    } catch (error) {
      console.error('[Temu POD]', error);
      sendResponse({ success: false, error: error.message || String(error) });
    }
  })();
  return true;
});
