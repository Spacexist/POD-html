// content.js — 注入 Temu 列表页，添加悬停下载按钮

// ─── 工具函数 ───────────────────────────────────────────────

/** 清理文件名，去除 Windows 非法字符，限制长度 */
function sanitizeFilename(title) {
  return (title || '')
    .replace(/[\/\\:*?"<>|]/g, '') // Windows 非法字符
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

// ─── 调试日志面板 UI ──────────────────────────────────────────
const Logger = {
  panel: null,
  content: null,

  init() {
    if (this.panel) return;

    this.panel = document.createElement('div');
    this.panel.className = 'temu-dl-log-panel';
    this.panel.innerHTML = `
      <div class="temu-dl-log-header">
        <span class="temu-dl-log-title">Temu DL Logs</span>
        <div class="temu-dl-log-actions">
          <button class="temu-dl-log-btn" id="temu-dl-log-clear">Clear</button>
          <button class="temu-dl-log-btn" id="temu-dl-log-hide">Minimize</button>
        </div>
      </div>
      <div class="temu-dl-log-content"></div>
    `;

    document.body.appendChild(this.panel);
    this.content = this.panel.querySelector('.temu-dl-log-content');

    this.panel.querySelector('#temu-dl-log-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      this.content.innerHTML = '';
    });

    const minimizeBtn = this.panel.querySelector('#temu-dl-log-hide');
    let minimized = false;
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      minimized = !minimized;
      if (minimized) {
        this.content.style.display = 'none';
        this.panel.style.height = 'auto';
        this.panel.style.width = '180px';
        minimizeBtn.textContent = 'Expand';
      } else {
        this.content.style.display = 'flex';
        this.panel.style.height = '';
        this.panel.style.width = '380px';
        minimizeBtn.textContent = 'Minimize';
      }
    });
  },

  log(type, msg) {
    this.init();
    console.log(`[Temu DL] [${type}] ${msg}`);

    const time = new Date().toTimeString().split(' ')[0];
    const logLine = document.createElement('div');
    logLine.className = `temu-dl-log-line temu-dl-log-line--${type}`;
    logLine.textContent = `[${time}] ${msg}`;

    this.content.appendChild(logLine);
    this.content.scrollTop = this.content.scrollHeight;
  }
};

/** 从商品卡片中提取商品标题 */
function getTitle(card) {
  // 1. 优先使用 card 自身的 aria-label
  if (card.hasAttribute('aria-label')) {
    const label = card.getAttribute('aria-label').trim();
    if (label) return label;
  }

  // 2. 其次使用 card 内子元素的 aria-label
  const group = card.querySelector('[role="group"][aria-label]');
  if (group) {
    const label = group.getAttribute('aria-label').trim();
    if (label) return label;
  }

  // 3. 备选：h3 内的 span 文字
  const h3Span = card.querySelector('h3 span');
  if (h3Span && h3Span.innerText.trim()) return h3Span.innerText.trim();

  // 4. 备选：a 标签的 title 或 alt
  const aLink = card.querySelector('a[title]');
  if (aLink && aLink.getAttribute('title').trim()) return aLink.getAttribute('title').trim();

  // 兜底
  return `temu_${Date.now()}`;
}

/** 从商品卡片中提取主图 URL（最高清版本） */
function getImageUrl(card) {
  // 辅助函数：将任何相对路径/绝对路径转为完整URL，并过滤掉 base64
  const resolveUrl = (src) => {
    if (!src || src.includes('data:image')) return null;
    try {
      return new URL(src, document.baseURI).href;
    } catch (_) {
      return src;
    }
  };

  // ① 优先从 data-js-main-img="true" 的图片中提取
  let mainImg = card.querySelector('img[data-js-main-img="true"]');
  if (mainImg) {
    const src = resolveUrl(mainImg.src || mainImg.getAttribute('src'));
    if (src) return upgradeImageQuality(src);
  }

  // ② 其次尝试其它可能是商品大图的 img（类名为 lazy-image 或 wxWpAMbp 等）
  const imgSelectors = [
    'img.lazy-image',
    'img.wxWpAMbp',
    'img[src*="product/"]',
    'img[src*="local-goods-image/"]',
    'img[src*="fancy/"]',
    'img[src*="kwcdn"]'
  ];
  for (const sel of imgSelectors) {
    const img = card.querySelector(sel);
    if (img) {
      const src = resolveUrl(img.src || img.getAttribute('src'));
      if (src) return upgradeImageQuality(src);
    }
  }

  // ③ 尝试从商品链接的 URL query 参数中抓取 top_gallery_url
  const goodsLink = card.querySelector('a[href*="goods.html"], a[href*="-g-"], a[href*="goods_id"]');
  if (goodsLink) {
    try {
      const href = goodsLink.getAttribute('href');
      const resolvedHref = resolveUrl(href);
      if (resolvedHref) {
        const url = new URL(resolvedHref);
        const galleryUrl = url.searchParams.get('top_gallery_url');
        if (galleryUrl) {
          return upgradeImageQuality(decodeURIComponent(galleryUrl));
        }
      }
    } catch (_) {}
  }

  // ④ 兜底：获取卡片中任何有效 img
  const anyImg = card.querySelector('img');
  if (anyImg) {
    const src = resolveUrl(anyImg.src || anyImg.getAttribute('src'));
    if (src) return upgradeImageQuality(src);
  }

  return null;
}

/** 将图片 URL 升级为原图最高质量 */
function upgradeImageQuality(url) {
  if (!url) return '';
  // 如果是本地测试的 file:// url，不修改，避免 404
  if (url.startsWith('file://')) {
    return url;
  }
  try {
    const u = new URL(url);

    // ① 去掉所有 query 参数
    //    Temu CDN 通过 ?imageView2/2/w/238/q/70/format/webp 限制尺寸
    //    去掉后直接返回原图
    u.search = '';

    // ② 去掉路径里的 _NNNxNNN 尺寸后缀（部分 URL 用这种方式）
    u.pathname = u.pathname.replace(/_\d+x\d+[^./]*/g, '');

    // ③ 把 .webp 换成 .jpg，保证下载后能直接打开
    if (u.pathname.toLowerCase().endsWith('.webp')) {
      u.pathname = u.pathname.slice(0, -5) + '.jpg';
    }

    return u.toString();
  } catch (_) {
    // URL 解析失败时兜底：至少去掉 query string
    return url.split('?')[0];
  }
}

// ─── 注入下载按钮 ───────────────────────────────────────────

function injectDownloadButton(card) {
  // 找到图片容器，用于相对定位，并带有多种类名兜底，最后以 card 本身为兜底
  const imgContainer = card.querySelector(
    '[class*="goods-image-container"], [class*="goods-img"], .OdRhMCvs, ._1UrrHYym'
  ) || card;

  // 确保容器有相对定位
  const containerStyle = getComputedStyle(imgContainer);
  if (containerStyle.position === 'static') {
    imgContainer.style.position = 'relative';
  }

  // 创建按钮
  const btn = document.createElement('button');
  btn.className = 'temu-dl-btn';
  btn.title = '下载图片';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16">
      <path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/>
    </svg>
  `;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    Logger.log('info', '点击下载按钮，开始分析商品卡片...');
    const title = getTitle(card);
    const imageUrl = getImageUrl(card);

    Logger.log('info', `提取商品标题: "${title}"`);
    Logger.log('info', `提取图片 URL: ${imageUrl || '未找到'}`);

    if (!imageUrl) {
      Logger.log('error', '获取商品图片 URL 失败！请联系开发者更新。');
      setButtonState(btn, 'error', '无法获取图片');
      return;
    }

    setButtonState(btn, 'loading');

    try {
      // 兼容性检查：如果 chrome 相关的 API 未定义（非插件上下文中运行，如直接本地引入 JS 或控制台运行）
      let subfolder = 'Temu';
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        try {
          const res = await chrome.storage.sync.get('subfolder');
          if (res && res.subfolder) subfolder = res.subfolder;
        } catch (_) {}
      }

      const filename = sanitizeFilename(title);

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // 发消息给 background.js 执行下载/缓存
        chrome.runtime.sendMessage(
          {
            action: 'downloadImage',
            url: imageUrl,
            filename: filename,
            subfolder: subfolder,
            listing: title
          },
          (response) => {
            if (chrome.runtime.lastError) {
              const errMsg = chrome.runtime.lastError.message;
              Logger.log('error', `后台通讯失败: ${errMsg}`);
              if (location.protocol === 'file:') {
                Logger.log('warn', '提示：检测到当前为本地静态页面 (file://)，若要正常下载，请务必在 chrome://extensions 页面勾选本扩展的【允许访问文件网址】。');
              }
              setButtonState(btn, 'error', '下载失败');
            } else if (response && !response.success) {
              Logger.log('error', `后台执行失败: ${response.error}`);
              setButtonState(btn, 'error', '下载失败');
            } else {
              if (response && response.alreadyExists) {
                Logger.log('warn', `重复商品，JSON 中已存在该图片: ${imageUrl}`);
                setButtonState(btn, 'duplicate', '重复');
              } else if (response && response.pendingSync) {
                Logger.log('warn', `已保存到扩展缓存，POD 服务恢复后自动同步: ${response.warning || ''}`);
                setButtonState(btn, 'pending', '待同步');
              } else if (response && response.cachedCount !== undefined) {
                Logger.log('success', `商品已同步到 POD！扩展缓存共 ${response.cachedCount} 个商品。`);
                setButtonState(btn, 'success', `已同步 (${response.cachedCount})`);
              } else {
                Logger.log('success', `本地下载任务已成功启动，文件将存为: ${filename}.jpg`);
                setButtonState(btn, 'success');
              }
            }
          }
        );
      } else {
        Logger.log('warn', '检测到未运行在扩展上下文（例如直接注入网页中）。将尝试新标签页打开图片直接进行预览下载：');
        Logger.log('success', `大图地址: ${imageUrl}`);
        window.open(imageUrl, '_blank');
        setButtonState(btn, 'success');
      }
    } catch (err) {
      Logger.log('error', `任务触发异常: ${err.message}`);
      console.error('[Temu DL]', err);
      setButtonState(btn, 'error', '下载失败');
    }
  });

  imgContainer.appendChild(btn);
}

/** 设置按钮状态 */
function setButtonState(btn, state, tooltip) {
  btn.className = `temu-dl-btn temu-dl-btn--${state}`;
  if (tooltip) btn.title = tooltip;

  if (state === 'loading') {
    btn.innerHTML = `<span class="temu-dl-spinner"></span>`;
    return;
  }

  if (state === 'success') {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`;
    setTimeout(() => {
      btn.className = 'temu-dl-btn';
      btn.title = '下载图片';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg>`;
    }, 1800);
    return;
  }

  if (state === 'pending') {
    btn.textContent = '待同步';
    setTimeout(() => {
      btn.className = 'temu-dl-btn';
      btn.title = '下载图片';
      btn.textContent = '下载';
    }, 2500);
    return;
  }

  if (state === 'duplicate') {
    btn.className = 'temu-dl-btn temu-dl-btn--error';
    btn.textContent = '重复';
    setTimeout(() => {
      btn.className = 'temu-dl-btn';
      btn.title = '下载图片';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg>`;
    }, 2000);
    return;
  }

  if (state === 'error') {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
    setTimeout(() => {
      btn.className = 'temu-dl-btn';
      btn.title = '下载图片';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="16" height="16"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5v-2z"/></svg>`;
    }, 2000);
  }
}

// ─── 扫描并注入 ─────────────────────────────────────────────

function scanAndInject() {
  // Temu 商品卡片：基于 role="group" 或特殊的 Ois68FAW 类名
  const cards = document.querySelectorAll(
    'div[role="group"][aria-label]:not([data-temu-dl-inited]), div.Ois68FAW:not([data-temu-dl-inited])'
  );
  cards.forEach((card) => {
    card.setAttribute('data-temu-dl-inited', '1');
    injectDownloadButton(card);
  });
}

// 初始扫描
scanAndInject();

// MutationObserver 处理无限滚动动态加载的商品
const observer = new MutationObserver(() => {
  scanAndInject();
});

observer.observe(document.body, { childList: true, subtree: true });
