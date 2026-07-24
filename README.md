<div align="center">

# POD Image Workflow

**Temu 商品采集、印花重绘、Moonshot 元素提取与套图生成的一体化本地工作台**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](#安装-chrome-扩展)
[![No Dependencies](https://img.shields.io/badge/npm_dependencies-0-1f883d)](#快速开始)
[![Local First](https://img.shields.io/badge/data-local_only-f97316)](#数据与安全)

[快速开始](#快速开始) · [安装扩展](#安装-chrome-扩展) · [导入数据](#json-导入) · [接口说明](#http-与-sse) · [故障排查](#故障排查)

</div>

---

## 项目简介

POD Image Workflow 把 **Temu 图片采集 Chrome 扩展**、**印花重绘**、**元素提取** 与 **套图生成** 放在同一个本地工作台中。扩展采集商品后，后台负责去重、缓存原图并通过 SSE 实时通知页面；元素提取模块可独立选择本机图片目录，通过 Moonshot 批量生成可编辑的元素清单；套图生成模块在独立画布中把印花批量合成到产品底图。

> 自动导入的任务只会进入 **待生成** 状态。只有手动点击“生成”或“批量生成”才会调用 BeeCode，不会因为采集或刷新页面产生费用。

| 核心能力 | 行为 |
|---|---|
| 商品采集 | 获取 `imageurl`、`listing` 和编号，按完整图片 URL 精确去重 |
| 原图缓存 | JSON 导入最多 10 并发；502/503/504 或网络超时仅重试一次 |
| 批量生图 | 默认 3 并发、每次返回 4 张，支持停止、重发和按当前提示词重新生成 |
| 元素提取 | 每 9 张组成 3×3 标号图，默认 3 并发调用 Moonshot，结果可编辑并导出 |
| 套图生成 | 单工作区配置印花文件夹与多组底图/Mask，支持位置、缩放、旋转、混合、置换和曲线后导出 ZIP |
| 状态恢复 | 输入图、生成图、提示词、日志和任务状态全部持久化 |
| 文件下载 | 使用 `listing` 商品标题命名，只保存图片，不生成 TXT |
| 联系表 | 当前页 50 张，10×5 排列，审核图由后台保存到 `runtime/test/check/` |

## 工作流程

```mermaid
flowchart LR
    A["Temu 商品页"] -->|点击采集| B["Chrome 扩展"]
    B -->|imageurl 精确去重| C["扩展本地缓存"]
    C -->|POST /api/intake| D["POD 后台"]
    D -->|再次去重并缓存原图| E["runtime/cache/input"]
    D -->|SSE 实时推送| F["POD 工作台"]
    F -->|手动生成| G["BeeCode"]
    G -->|返回图片| H["runtime/cache/output"]
```

- 服务在线：采集后立即同步到 POD。
- 服务离线：扩展保留数据并显示“待同步”。
- 再次打开 POD：`pod-bridge.js` 一次性提交旧缓存，不轮询页面。
- URL 重复：按钮直接显示“重复”，不会加入 JSON，也不会再次 POST。

## 快速开始

### 环境要求

- Windows 10/11
- Node.js 18 或更高版本
- Google Chrome 或兼容 Chromium 的浏览器

项目只使用 Node.js 内置模块，**不需要执行 `npm install`**。

### 一键启动

双击仓库根目录的：

```text
start.cmd
```

脚本将自动：

1. 检查 `http://127.0.0.1:8787/api/health`。
2. 服务未运行时，在后台启动 `node server/index.js`。
3. 等待健康检查通过。
4. 打开 `http://127.0.0.1:8787/`。

也可以在项目根目录手动启动：

```powershell
node server/index.js
```

## 配置

运行时只读取这一份实际配置：

```text
runtime/config.json
```

首次使用：

1. 参考 `config/config.example.json` 创建配置文件。
2. 填入 BeeCode 与 Moonshot API Key。
3. 在 POD 页面点击“配置文件”并导入。
4. 后台校验后原子写入 `runtime/config.json`，以后刷新或重启不需要重复选择。

```json
{
  "shared": {
    "moonshot": {
      "apiKey": "",
      "baseUrl": "https://api.moonshot.cn/v1",
      "model": "kimi-k2.6"
    },
    "server": {
      "host": "127.0.0.1",
      "port": 8787
    }
  },
  "patternRedraw": {
    "imageApi": {
      "apiKey": "",
      "baseUrl": "https://beecode.cc",
      "endpoint": "/v1/images/edits",
      "model": "gpt-image-2",
      "size": "1024x1024",
      "concurrency": 3,
      "n": 4,
      "sizes": {
        "1:1": "1024x1024",
        "9:16": "1024x1824",
        "4:3": "1536x1152"
      },
      "similarityPrompt": "重要约束：输出图与输入图的主体轮廓、构图和核心图案保持约 {similarity}% 视觉相似度，其余部分进行原创重绘。"
    },
    "infringement": {
      "saveContactSheet": true,
      "outputDir": "runtime/test/check"
    }
  },
  "elementExtraction": {
    "batchSize": 9,
    "concurrency": 3,
    "thinkingEnabled": false,
    "prefix": "",
    "suffix": "",
    "mode": "affix",
    "product_name": "地垫",
    "prompt_product_output_model": "Listing 模式公共货号与 JSON 输出规范...",
    "product_prompts": {
      "地垫": "地垫 Listing 的业务规则..."
    },
    "prompt_prefix_model": "前后缀模式使用的固定后台提示词..."
  }
}
```

`shared` 放“印花重绘”和“元素提取”共用的 Moonshot 与服务配置；`patternRedraw` 对应“印花重绘”；`elementExtraction` 对应“元素提取”。“套图生成”当前完全在浏览器内存中运行，不读取或写入配置。`prompt_prefix_model` 不显示为页面输入框，但会由前端注入当前批次货号后与图片一起发送给本地后台。Listing 产品由根目录 `config.json` 中的 `product_prompts` 管理；页面“管理产品”弹窗新增、修改或删除产品时只会原子更新根目录的这些产品字段，API Key 仍由 `runtime/config.json` 管理。`n` 控制每次返回数量（1–4），`sizes` 将页面比例直接映射到 `/v1/images/edits` 的 `size`。旧版顶层 `imageApi`、`moonshot`、`infringement`、`server` 和 `beecode` 字段仍可读取；模块 2 的旧 `prompt` 字段会在启动时替换为新的固定模板。

`runtime/` 已被 Git 整目录忽略。接口和页面只返回脱敏 Key，完整 Key 不会出现在仓库或浏览器响应中。

## 安装 Chrome 扩展

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `extension/temu-image-downloader/`。
5. 保留默认的“POD 模式”。

修改扩展代码后，在扩展管理页点击一次“重新加载”。扩展仍保留独立的本地下载模式，可在设置页切换。

## JSON 导入

支持顶层数组，也支持对象中的 `data`、`items` 或 `list` 数组。

```json
[
  {
    "imageurl": "https://img.kwcdn.com/example.jpg",
    "listing": "Product title",
    "编号": "20260623194641_0001"
  }
]
```

| 字段 | 用途 |
|---|---|
| `imageurl` | 原图地址和精确去重键 |
| `listing` | 图片下方标题，也是生成图下载文件名 |
| `编号` | 完整保存；页面和合并图显示最后的后缀，如 `0001` |

JSON 导入只缓存原图，不会自动进入付费生图队列。

## 模块 1：印花重绘

### 任务与生成

- 每页固定 50 条，避免一次渲染大量图片导致卡顿。
- 每个任务拥有独立提示词和运行日志。
- 顶部提示词可覆盖全部任务，也可以逐条修改。
- 生成请求动态读取任务当前提示词，只注入相似度强约束；比例直接映射到接口 `size`。
- 每个任务缓存接口返回的全部图片，预览区可左右轮换。
- 临时生成错误进入重试队列，等待 3 秒且最多重试一次。
- 支持单张生成、批量生成、停止、重新生成、重新获取、下载和删除。

### 下载

- 生成图使用 `listing` 商品标题命名。
- 不添加 `-beecode` 后缀。
- 不创建配套 TXT 文件。
- 单行“下载”只保存当前预览图；“下载本页”保存全部返回图，并添加 `-01`、`-02` 等序号。
- 可提前选择下载文件夹，浏览器允许时直接写入该目录。

### 合并本页

合并功能完全由浏览器 Canvas 完成，不调用 BeeCode：

```text
50 张 / 页
10 列 × 5 行
600 × 600 px / 格
浏览器画布：6000 × 3000 px
后台审核图：最长边不超过 4096 px，JPEG quality 0.86
```

每张图片等比铺满并居中裁切；左上角使用约 52px 白色粗体编号，编号读取任务 `displayCode` 或 JSON `编号` 后缀。缺图会写入任务日志，但不会阻塞其他图片输出。

浏览器不会再下载合并图。合并图缩放至 4K 以内后由后台保存到 `patternRedraw.infringement.outputDir`（默认 `runtime/test/check/`），并发送到 Moonshot 中国区的 `kimi-k2.6` 进行侵权风险审核。审核结果以气泡卡片显示编号、风险等级和原因；没有发现风险项时也会显示明确结果。

## 模块 2：元素提取

- 独立选择本机图片目录，不复用印花重绘任务缓存。
- 按文件名自然排序，每 9 张生成一张 3×3 标号图，文件名去除扩展名后作为货号。
- 批次并发可选 1–4，默认 3；单批失败会标记为可重试，不阻塞其余批次。
- 请求由后台使用 `shared.moonshot` 配置发起，完整 API Key 不进入浏览器。
- Moonshot 使用 SSE 逐事件读取；页面不打印逐字增量，只在完成后显示最终 JSON，同时保留 5 秒心跳和 30 秒无事件告警。快速模式请求超时为 180 秒，深度推理模式为 300 秒。
- “模型模式”按钮可切换“不推理·快速”和“推理·较慢”；默认读取 `elementExtraction.thinkingEnabled`，不推理模式会发送 `thinking: {"type":"disabled"}`。
- “前后缀模式”固定读取 `prompt_prefix_model`；提取完成后可修改前缀、后缀并立即重新组合，不会再次请求模型。
- “Listing 模式”只允许从已配置产品中选择。请求会组合该产品的业务 Prompt 与 `prompt_product_output_model` 公共 JSON 规范；普通使用界面不显示 Prompt。
- “管理产品”弹窗支持新增、修改和删除 `{名称, Prompt}`，初始产品为“地垫”，配置保存到根目录 `config.json`。
- 前后缀结果和每个 Listing 产品的结果分别保存在页面内存中，切换模式或产品会恢复各自结果；重新选择图片目录时统一清空。
- 结果仅保存在当前页面内存，可编辑后导出 JSON 或 Excel；SheetJS 未加载时自动降级为 CSV。
- “导出图片文件夹”会将已完成原图按前后缀组合结果重命名并写入新目录；重名自动追加序号。
- 失败结果支持逐行“手动重试”，也可使用侧栏按钮批量重试全部未识别项。

## 数据与安全

| 路径 | 内容 | 是否提交 Git |
|---|---|---|
| `runtime/config.json` | 唯一实际配置和 API Key | 否 |
| `runtime/tasks.json` | 任务状态、提示词、listing 和日志 | 否 |
| `runtime/cache/input/` | 原图缓存 | 否 |
| `runtime/cache/output/` | 已付费生成的图片 | 否 |
| `runtime/test/check/` | 侵权查询合并图 | 否 |
| `runtime/logs/server.log` | 服务日志 | 否 |

修改前端、刷新页面或重载扩展不会重新生成图片。不要删除 `runtime/`；需要迁移或备份时，直接复制整个目录。

旧 `beecode-cache/` 暂时保留为迁移备份，但当前程序不再读取它。

## HTTP 与 SSE

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/mockup` | 独立套图生成页面 |
| `GET` | `/api/health` | 健康检查和脱敏配置 |
| `GET / POST` | `/api/config` | 读取或替换唯一配置 |
| `GET / POST` | `/api/element-products` | 读取或管理根目录 Listing 产品配置 |
| `GET` | `/api/tasks` | 恢复全部任务 |
| `POST` | `/api/intake` | 扩展单条导入 |
| `POST` | `/api/intake/batch` | JSON 或扩展缓存批量导入 |
| `POST` | `/api/intake/retry` | 重新获取远程原图 |
| `GET` | `/api/events` | SSE 任务事件流 |
| `POST` | `/v1/images/edits` | BeeCode 图片编辑代理 |
| `POST` | `/api/infringement-check` | Moonshot 合并图侵权审核代理 |
| `POST` | `/api/element-extract` | Moonshot 3×3 元素提取代理 |

SSE 事件包括：

- `task.created`
- `task.updated`
- `task.deleted`
- `tasks.cleared`
- `element.extraction.trace`：元素提取后台节点，以及 Moonshot 每个已脱敏 `data:` 响应事件的实时转发。

浏览器使用原生 `EventSource` 自动重连，页面不需要持续轮询。

## 项目结构

<details>
<summary>展开查看目录树</summary>

```text
POD-html/
├─ app/
│  ├─ index.html                         三模块 POD 单页前端
│  ├─ element-extraction.js              元素提取目录、批次、编辑与导出
│  ├─ mockup.html                         独立套图画布与 ZIP 导出
│  └─ vendor/jszip.min.js                 本地 ZIP 压缩依赖
├─ server/
│  ├─ index.js                           HTTP 路由、BeeCode 代理、缓存接口
│  ├─ config.js                          唯一配置读取与原子写入
│  ├─ task-store.js                      任务存储、去重和 SSE 事件源
│  ├─ intake.js                          扩展及 JSON 导入、10 并发原图缓存
│  └─ sse.js                             实时事件推送
├─ extension/
│  └─ temu-image-downloader/
│     ├─ manifest.json
│     ├─ background.js                   去重、缓存、POST 和本地下载
│     ├─ content.js                      Temu 页面采集按钮
│     ├─ pod-bridge.js                   打开 POD 时同步扩展旧缓存
│     └─ popup.* / options.* / icons/
├─ config/
│  └─ config.example.json                可提交的无 Key 配置模板
├─ runtime/                              本机运行数据，Git 整目录忽略
│  ├─ config.json                        唯一实际配置
│  ├─ tasks.json                         任务状态和任务日志
│  ├─ cache/input/                       原图
│  ├─ cache/output/                      生成图
│  ├─ test/check/                        侵权查询合并图
│  └─ logs/server.log                    服务日志
├─ start.cmd                             Windows 一键启动
├─ update_plan.md                        整合设计与实施记录
└─ README.md
```

</details>

## 故障排查

| 现象 | 处理方式 |
|---|---|
| 页面打不开 | 运行 `start.cmd`，再访问 `http://127.0.0.1:8787/api/health` |
| 扩展显示“待同步” | 启动本机服务，然后打开或刷新 POD 页面 |
| JSON 原图返回 502 | 后台等待 3 秒重试一次，也可以点单行“重新获取” |
| BeeCode 请求失败 | 查看对应任务日志，HTTP 状态和响应正文都会保留 |
| 配置不生效 | 确认 JSON 合法，并检查页面顶部配置来源是否为 `runtime/config.json` |
| 刷新后任务缺失 | 检查 `runtime/tasks.json` 和服务日志，不要重新生成 |

---

<div align="center">

本项目默认仅监听 `127.0.0.1:8787`，用于本机 POD 工作流。

</div>
