# 🛍️ Temu Image Downloader

> 一个 Chrome 浏览器插件，悬停 Temu 商品图片，一键下载原图并以商品标题自动命名。

![Version](https://img.shields.io/badge/version-1.0.0-orange) ![Manifest](https://img.shields.io/badge/manifest-v3-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 功能

- 🖱️ **悬停即显示** — 鼠标移到商品图片上，右上角自动出现下载按钮
- 📥 **一键下载原图** — 自动去除 CDN 压缩参数，下载完整尺寸原图（非 238px 缩略图）
- 🏷️ **商品标题命名** — 文件名自动取商品标题，方便整理
- 📁 **自定义文件夹** — 在设置页配置下载子目录，如 `Temu/项目A`
- ♾️ **无限滚动支持** — 滚动加载的新商品自动注入下载按钮
- ✅ **状态反馈** — 下载中转圈、成功变绿、失败变红

---

## 📸 使用效果

```
悬停商品图片
    ↓
右上角出现 ⬇ 按钮
    ↓
点击 → 自动下载到
[Chrome下载目录] / Temu / 商品标题.jpg
```

---

## 🚀 安装（本地开发者模式）

1. 克隆或下载本仓库
   ```bash
   git clone https://github.com/Spacexist/POD-ASSISTANT.git
   ```

2. 打开 Chrome，访问
   ```
   chrome://extensions/
   ```

3. 开启右上角 **「开发者模式」**

4. 点击 **「加载已解压的扩展程序」**，选择本项目文件夹

5. 访问 [temu.com](https://www.temu.com)，插件自动生效 🎉

---

## ⚙️ 设置

点击工具栏插件图标 → **「打开设置」**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| 下载子文件夹 | 图片保存在 Chrome 下载目录的哪个子文件夹 | `Temu` |

支持多级路径，例如填写 `Temu/2024-Q4` 后，图片保存至：
```
[Chrome下载目录]/Temu/2024-Q4/商品标题.jpg
```

---

## 📁 项目结构

```
├── manifest.json      # 插件配置（Manifest V3）
├── background.js      # Service Worker，调用 chrome.downloads API
├── content.js         # 注入页面，提取商品数据，添加悬停按钮
├── content.css        # 悬停按钮样式
├── popup.html/js      # 点击图标弹出面板（显示当前设置）
├── options.html/js    # 设置页面
└── icons/             # 插件图标
```

---

## 🔧 技术细节

**图片 URL 处理**

Temu 使用七牛云 CDN，通过 query 参数动态压缩图片：
```
# 缩略图（238px）
https://img.kwcdn.com/product/fancy/xxx.jpg?imageView2/2/w/238/q/70/format/webp

# 原图（去掉参数即可）
https://img.kwcdn.com/product/fancy/xxx.jpg
```
插件自动去除 `?` 后的所有参数，并将 `.webp` 转为 `.jpg`。

**消息架构**
```
content.js  →  background.js  →  chrome.downloads
（页面注入）    （Service Worker）   （下载 API）
```
popup 只读取 `chrome.storage`，不与 content script 通信，避免常见的 `Could not establish connection` 报错。

---

## 🛠️ 权限说明

| 权限 | 用途 |
|------|------|
| `downloads` | 下载图片文件 |
| `storage` | 保存用户设置（下载文件夹名） |
| `host: temu.com` | 在 Temu 页面注入脚本 |
| `host: kwcdn.com` | 访问 Temu 图片 CDN |

---

## 📄 License

MIT
