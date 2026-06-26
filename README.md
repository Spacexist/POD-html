# POD HTML

一个本地运行的 BeeCode / OpenAI 兼容图片批处理页面，主要用于 POD 印花图提取和二创。

页面负责批量任务、预览、日志、分页、下载和合图；本地 Node 代理负责读取本地配置、转发图片生成请求、缓存输入输出图片、代理远程图片下载，以及使用 Google Translate 翻译 listing。

## 功能

- 上传本地图片，或导入包含 `imageurl`、`listing`、`编号` 字段的 JSON。
- JSON 图片按 10 并发缓存原图，失败会重试一次，也可以单行重新获取。
- 默认 50 条每页，避免一次渲染几百张图卡顿。
- 每行可单独编辑提示词、生成、重新生成、下载、删除。
- 批量生成默认 3 并发滑动窗口，502/503/504/timeout 会等待 3 秒后重试一次。
- 每个任务都有独立日志，包含 base64 转换、请求发送、HTTP 返回、解析和缓存步骤。
- 支持本页下载，跳过失败任务；下载图片文件名使用当前 listing/标题，不额外生成 txt。
- 支持合并本页，把当前页已显示图片压缩为 contact sheet，左上角标注 JSON 的编号后缀。
- 支持一键把 listing 翻译成英文，走 Google Translate，不消耗 BeeCode key。

## 文件

```text
beecode-image-batch.html      单页工具界面
beecode-local-proxy.js        本地代理、缓存和下载服务
start-beecode-proxy.cmd       Windows 启动脚本
beecode.config.example.json   配置模板
```

本地运行会生成：

```text
beecode.config.local.json     本地 API 配置，已被 .gitignore 忽略
beecode-cache/                输入/输出图片缓存，已被 .gitignore 忽略
```

## 配置

复制示例配置：

```bash
copy beecode.config.example.json beecode.config.local.json
```

编辑 `beecode.config.local.json`：

```json
{
  "apiKey": "sk-your-key-here",
  "baseUrl": "https://beecode.cc",
  "model": "gpt-image-2",
  "size": "1024x1024",
  "concurrency": 3
}
```

也可以在页面左上角点 `配置文件` 导入配置，页面会写入本地 `beecode.config.local.json`。

## 运行

需要 Node.js 18+。

Windows 双击：

```text
start-beecode-proxy.cmd
```

或命令行启动：

```bash
node beecode-local-proxy.js
```

打开：

```text
http://127.0.0.1:8787/beecode-image-batch.html
```

健康检查：

```text
http://127.0.0.1:8787/health
```

## JSON 格式

支持数组，或对象里的 `data` / `items` / `list` 数组。

```json
[
  {
    "imageurl": "https://example.com/image.jpg",
    "listing": "Product title or listing text",
    "编号": "20260623194641_0001"
  }
]
```

字段说明：

- `imageurl`：远程图片地址。
- `listing`：商品标题/描述，会显示在图片下方，并用于下载文件命名。
- `编号`：任务编号，页面显示后缀，合并本页时用于图片角标。

## 注意

- 不要提交 `beecode.config.local.json`，里面有 API key。
- 不要提交 `beecode-cache/`，里面是本地缓存图。
- 如果页面提示 `Failed to fetch`，先确认本地代理是否已启动。
- 如果 JSON 图片获取失败，点单行 `重新获取`，日志会显示远程 HTTP 状态和响应片段。
