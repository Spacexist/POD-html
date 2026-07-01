// popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const modeVal = document.getElementById('current-mode');
  const folderSec = document.getElementById('folder-section');
  const folderVal = document.getElementById('current-folder');
  const cacheSec = document.getElementById('cache-section');
  const cacheCountVal = document.getElementById('cache-count');
  const btnExport = document.getElementById('btn-export');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnResetLocalCount = document.getElementById('btn-reset-local-count');
  const localCountVal = document.getElementById('local-count-val');

  const btnSelectJson = document.getElementById('btn-select-json');
  const inputFileJson = document.getElementById('input-file-json');
  const boundStatus = document.getElementById('bound-status');
  const boundFilenameVal = document.getElementById('bound-filename');

  // 读取并更新显示状态
  async function updateUI() {
    const { mode = 'cache', subfolder = 'Temu' } = await chrome.storage.sync.get(['mode', 'subfolder']);
    const { cached_items = [], bound_filename = '', local_download_count = 0 } = await chrome.storage.local.get(['cached_items', 'bound_filename', 'local_download_count']);

    if (mode === 'local') {
      modeVal.textContent = '本地模式 (直接下载)';
      folderSec.style.display = 'block';
      folderVal.textContent = subfolder;
      cacheSec.style.display = 'none';
      if (localCountVal) {
        localCountVal.textContent = local_download_count;
      }
    } else {
      modeVal.textContent = 'POD 模式 (自动同步)';
      folderSec.style.display = 'none';
      cacheSec.style.display = 'block';
      cacheCountVal.textContent = `已缓存商品: ${cached_items.length} 个`;

      if (bound_filename) {
        boundStatus.style.display = 'block';
        boundFilenameVal.textContent = bound_filename;
      } else {
        boundStatus.style.display = 'none';
      }
    }
  }

  // 初始载入
  await updateUI();

  // 重置本地计数器
  if (btnResetLocalCount) {
    btnResetLocalCount.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('确定要将本地下载序号计数器重置为 0 吗？')) {
        await chrome.storage.local.set({ local_download_count: 0 });
        await updateUI();
      }
    });
  }

  // 触发 file input
  btnSelectJson.addEventListener('click', () => {
    inputFileJson.click();
  });

  // 读取并解析文件内容，绑定至本地存储
  inputFileJson.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const rawData = JSON.parse(event.target.result);
        if (!Array.isArray(rawData)) {
          alert('解析失败：JSON 文件内容必须是数组格式！');
          return;
        }

        // 规范化字段：1.编号【时间+序号】2.listing 3.imageurl
        const normalizedItems = rawData.map((item, index) => {
          return {
            "编号": item["编号"] || item["id"] || `imported_${Date.now()}_${index}`,
            "listing": item["listing"] || item["title"] || '未命名商品',
            "imageurl": item["imageurl"] || item["imageUrl"] || item["url"] || ''
          };
        }).filter(item => item.imageurl);

        // 保存至 storage
        await chrome.storage.local.set({
          cached_items: normalizedItems,
          bound_filename: file.name
        });

        alert(`成功绑定 JSON！已载入 ${normalizedItems.length} 个商品数据。接下来捕获的商品将追加至此文件中。`);
        await updateUI();
      } catch (err) {
        alert('解析 JSON 失败，请检查文件格式是否正确！\n' + err.message);
      }
    };
    reader.readAsText(file);
    inputFileJson.value = ''; // 清除 value 以便重新选择
  });

  // 导出更新后的 JSON
  btnExport.addEventListener('click', async () => {
    const { cached_items = [], bound_filename = '' } = await chrome.storage.local.get(['cached_items', 'bound_filename']);
    if (cached_items.length === 0) {
      alert('当前缓存为空，无可导出的数据！');
      return;
    }

    const dataStr = JSON.stringify(cached_items, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    let exportName = '';
    if (bound_filename) {
      const baseName = bound_filename.replace(/\.json$/i, '');
      exportName = `${baseName}-updated.json`;
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      exportName = `temu-cache-${timestamp}.json`;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = exportName;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 清空缓存与绑定
  btnClearCache.addEventListener('click', async () => {
    if (confirm('确定要清空所有已缓存的商品数据以及绑定的 JSON 文件名吗？此操作不可撤销。')) {
      await chrome.storage.local.set({ cached_items: [], bound_filename: '' });
      await updateUI();
    }
  });

  // 打开设置页
  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
