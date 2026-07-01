(async () => {
  if (window.__temuPodBridgeStarted) return;
  window.__temuPodBridgeStarted = true;
  try {
    const { mode = 'cache' } = await chrome.storage.sync.get(['mode']);
    if (mode === 'local') return;
    const { cached_items: items = [] } = await chrome.storage.local.get(['cached_items']);
    if (!Array.isArray(items) || !items.length) return;
    const response = await fetch('/api/intake/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    const result = JSON.parse(text);
    console.info(`[Temu POD] 自动同步完成：新增 ${result.accepted || 0}，重复 ${result.duplicates || 0}，无效 ${result.invalid || 0}`);
  } catch (error) {
    console.warn('[Temu POD] 自动同步暂未完成，扩展缓存仍保留：', error.message);
  }
})();
