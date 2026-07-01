// options.js

document.addEventListener('DOMContentLoaded', async () => {
  const input = document.getElementById('subfolder');
  const btnSave = document.getElementById('btn-save');
  const toast = document.getElementById('toast');
  const pathPreview = document.getElementById('path-preview');
  const localConfigSec = document.getElementById('local-config-sec');

  const radioLocal = document.getElementById('mode-local');
  const radioCache = document.getElementById('mode-cache');
  const labelLocal = document.getElementById('label-mode-local');
  const labelCache = document.getElementById('label-mode-cache');

  // 读取已保存的设置
  const { mode = 'cache', subfolder = 'Temu' } = await chrome.storage.sync.get(['mode', 'subfolder']);

  // 设置模式初始状态
  if (mode === 'local') {
    radioLocal.checked = true;
    labelLocal.classList.add('selected');
    labelCache.classList.remove('selected');
    localConfigSec.style.display = 'block';
  } else {
    radioCache.checked = true;
    labelCache.classList.add('selected');
    labelLocal.classList.remove('selected');
    localConfigSec.style.display = 'none';
  }

  input.value = subfolder;
  updatePreview(subfolder);

  // 模式单选切换交互
  function handleModeChange(selectedMode) {
    if (selectedMode === 'local') {
      labelLocal.classList.add('selected');
      labelCache.classList.remove('selected');
      localConfigSec.style.display = 'block';
    } else {
      labelCache.classList.add('selected');
      labelLocal.classList.remove('selected');
      localConfigSec.style.display = 'none';
    }
  }

  radioLocal.addEventListener('change', () => handleModeChange('local'));
  radioCache.addEventListener('change', () => handleModeChange('cache'));

  // 实时更新路径预览
  input.addEventListener('input', () => {
    updatePreview(input.value.trim() || 'Temu');
  });

  // 保存
  btnSave.addEventListener('click', async () => {
    const value = input.value.trim() || 'Temu';
    const selectedMode = radioLocal.checked ? 'local' : 'cache';

    await chrome.storage.sync.set({
      mode: selectedMode,
      subfolder: value
    });

    // 显示成功提示
    toast.classList.add('toast--visible');
    setTimeout(() => toast.classList.remove('toast--visible'), 2500);
  });

  function updatePreview(folder) {
    pathPreview.innerHTML = `📁 Chrome下载目录 / <strong>${escapeHtml(folder)}</strong> / 商品标题.jpg`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
});
