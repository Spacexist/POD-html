<div align="center">

# POD Image Workflow

**Temu 商品采集、印花重绘、Moonshot 元素提取、套图生成与商品导入的一体化本地工作台**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](#安装-chrome-扩展)
[![No Dependencies](https://img.shields.io/badge/npm_dependencies-0-1f883d)](#快速开始)
[![Local First](https://img.shields.io/badge/data-local_only-f97316)](#数据与安全)

[快速开始](#快速开始) · [界面预览](#界面预览) · [四模块 Workflow](#四模块-workflow) · [安装扩展](#安装-chrome-扩展) · [导入数据](#json-导入) · [接口说明](#http-与-sse) · [故障排查](#故障排查)

</div>

---

## 项目简介

POD Image Workflow 把 **Temu 图片采集 Chrome 扩展**、**印花重绘**、**元素提取**、**套图生成** 与 **商品导入** 放在同一个本地工作台中。扩展采集商品后，后台负责去重、缓存原图并通过 SSE 实时通知页面；元素提取模块可独立选择本机图片目录，通过 Moonshot 批量生成可编辑的元素清单；套图生成模块在独立画布中把印花批量合成到产品底图；商品导入模块把套图结果整理为 Listing、SKU 与妙手采集上传素材包。

> 自动导入的任务只会进入 **待生成** 状态。只有手动点击“生成”或“批量生成”才会调用 BeeCode，不会因为采集或刷新页面产生费用。

<p align="center">
  <img src="docs/images/00-architecture.svg" alt="POD architecture: extension, local server, four workflow modules, config vs key" width="920">
</p>

| 核心能力 | 行为 |
|---|---|
| 商品采集 | 获取 `imageurl`、`listing` 和编号，按完整图片 URL 精确去重 |
| 原图缓存 | JSON 导入最多 10 并发；502/503/504 或网络超时仅重试一次 |
| 批量生图 | 顶部可手动设置 1–10 并发并持久化，生成数量手输 1–4，支持取消、重发和按当前提示词重新生成 |
| 元素提取 | 每 9 张组成 3×3 标号图，默认 3 并发异步调用 Moonshot；支持停止、403 自动重试，结果可编辑并导出 |
| 登录门禁 | 打开页先认根目录 `key.json`；没有则登录页导入；顶部「修改」可覆盖换密钥 |
| 套图生成 | 配置多组产品图/蒙版模板与多个平面、圆柱曲面网格，支持 Homography 高清导出、置换、混合和按印花批量导出 |
| 商品导入 | 识别“父文件夹 / Listing / 主图”目录，配置公共信息和 SKU，预览 Listing → 图片 → SKU 分配并导出妙手上传 ZIP |
| Workflow | 模块 1 生成图传入模块 2，模块 2 完成图传入模块 3，模块 3 批量导出后自动切换并载入模块 4 |
| 状态恢复 | 输入图、生成图、提示词、日志和任务状态全部持久化 |
| 文件下载 | 使用 `listing` 商品标题命名，只保存图片，不生成 TXT |
| 联系表 | 当前页 50 张，10×5 排列，审核图保存到 `runtime/cache/check/` |
| 缓存清空 | 点「清空」删除任务列表，并清空整个 `runtime/cache/`（含 input / output / check） |

## 界面预览

真实本地界面截图（`start.cmd` 启动后打开 `http://127.0.0.1:8787/`）：

<p align="center">
  <img src="docs/images/01-pattern-redraw.png" alt="Module 1 Pattern Redraw workbench" width="920"><br>
  <sub>模块 1 · 印花重绘：原图与生成图对照、提示词、任务日志、缓存恢复和可调并发</sub>
</p>

<p align="center">
  <img src="docs/images/02-element-extraction.png" alt="Module 2 Element Extraction workbench" width="920"><br>
  <sub>模块 2 · 元素提取：目录导入、前后缀 / Listing 模式、批量提取和结果导出</sub>
</p>

<p align="center">
  <img src="docs/images/03-mockup.png" alt="Module 3 Mockup canvas" width="920"><br>
  <sub>模块 3 · 套图生成：产品图 / Mask 模板、印花组、平面与曲面网格、批量渲染导出</sub>
</p>

<p align="center">
  <img src="docs/images/04-listing-import.png" alt="Module 4 Listing and SKU import workbench" width="920"><br>
  <sub>模块 4 · 商品导入：Listing 目录识别、公共信息、SKU 组合与妙手上传包导出</sub>
</p>

### 四模块速览

| 模块 | 输入 | 核心处理 | 输出 / 下一站 |
|---|---|---|---|
| 1 · 印花重绘 | 商品原图或导入 JSON | 批量生成、重试、缓存、侵权查询 | 成功图传入模块 2 |
| 2 · 元素提取 | 模块 1 成功图或本机目录 | 3×3 分组识别、命名组合、人工校对 | 重命名图片传入模块 3 |
| 3 · 套图生成 | 印花、产品图、蒙版与网格模板 | 平面 / 曲面贴图、Homography 高清渲染 | 按 Listing 批量导出并打开模块 4 |
| 4 · 商品导入 | 模块 3 导出目录或手动目录 | Listing 预览、SKU 图片分配、商品信息补全 | 妙手可上传的 Excel 与素材 ZIP |

<p align="center">
  <img src="docs/images/06-workflow.svg" alt="Four-module POD workflow overview" width="920"><br>
  <sub>从商品图采集到妙手上传包的完整本地 Workflow</sub>
</p>

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
    H -->|批量传输，每个任务取第一张| I["模块 2：元素提取"]
    I -->|完成并按最终名称重命名| J["模块 3：套图生成印花组"]
    J -->|批量导出完成并传递目录句柄| K["模块 4：商品导入"]
    K -->|整理 Listing / SKU| L["妙手上传素材包 ZIP"]
```

- 服务在线：采集后立即同步到 POD。
- 服务离线：扩展保留数据并显示“待同步”。
- 再次打开 POD：`pod-bridge.js` 一次性提交旧缓存，不轮询页面。
- URL 重复：按钮直接显示“重复”，不会加入 JSON，也不会再次 POST。
- Workflow 传输：只在当前浏览器会话中保存，刷新页面后需要从源模块重新传输。

## 快速开始

### 环境要求

- Windows 10/11
- Google Chrome 或兼容 Chromium 的浏览器
- **不必预先安装 Node**：`start.cmd` 会优先使用系统 PATH 中的 `node`；若没有，则自动下载便携 Node 20 到 `tools/node/`（优先 npmmirror，失败再走 nodejs.org）

项目只使用 Node.js 内置模块，**不需要执行 `npm install`**。

### 一键启动（推荐：桌面图标）

1. 首次拿到项目后，双击仓库根目录的 `install-desktop.cmd`  
   → 在当前用户桌面创建快捷方式 **POD Workbench**（图标优先用本机 Chrome）  
   → **安装完成后会自动调起 `start.cmd`**，浏览器打开登录主页  
   → 项目搬家后，再双击一次该脚本即可覆盖更新快捷方式路径。
2. 以后只需双击桌面 **POD Workbench**（或仍双击根目录 `start.cmd`）。

`start.cmd` 将自动（单文件 hybrid，无独立 `.ps1`）：

1. 解析 Node：系统 `node` → 已有 `tools/node/node.exe` → 否则下载便携 Node v20.18.1。  
2. **强制释放 8787**：结束所有占用该端口的进程（不限是否本项目旧实例），再启动。  
3. 后台启动 `server/index.js`，健康检查通过后打开 `http://127.0.0.1:8787/`。  
4. 黑窗打印英文日志：成功约 2 秒后关闭；失败则 `pause` 便于查看原因。

### 登录主页（key.json 门禁）

浏览器打开后**不会立刻进入工作台**，先走登录门禁：

```text
打开页面
  → GET /api/auth 检查项目根目录是否已有可解析的 key.json
  → 有：自动登录，进入三模块工作台
  → 无 / 损坏：停留在登录主页，点击「导入 key.json 并登录」
```

| 场景 | 行为 |
|---|---|
| 根目录已有合法 `key.json` | 自动登录，无需再选文件 |
| 根目录没有 `key.json` | 登录页提示导入；导入后写入根目录并进入工作台 |
| 已登录后要换密钥 | 顶部 **「修改」**（原「载入密码」）→ 弹窗选择新的 `key.json` 覆盖导入 |
| 登录页点「重新检查根目录」 | 再次读磁盘上的 `key.json`（适合先手动拷文件再进页） |

导入成功后，后台按文件内容**动态重建**图片节点列表；顶部「选择节点」菜单随之增减。

完全离线且本机无 Node 时：把另一台机器上已下载好的整个 `tools/node/` 文件夹拷到项目里（保证存在 `tools/node/node.exe`），再启动。

也可以在项目根目录手动启动（需本机已有 Node）：

```powershell
node server/index.js
```

## 配置

业务配置与密钥配置已经分离：

```text
config.json
key.json
```

<p align="center">
  <img src="docs/images/05-config-split.png" alt="config.json vs key.json split" width="860"><br>
  <sub>公司可共享 config.json；每人自备 key.json（含动态节点与密钥）</sub>
</p>

首次使用：

1. 仓库自带可分享的 `config.json`（模型参数、侵权提示词、Listing 产品等），**不包含**图片中转节点列表与 API Key。无单独的 `config.example.json`。
2. 复制 `key.example.json` 为 `key.json`，填写 Moonshot 的 `baseurl`、`apikey`，并在 `trans_model_pool.nodes` 中按需增减节点（每个节点含 `id`、`name`、`baseurl`、`endpoint`、`model`、`price`、`apikey`）。也可不先拷文件，启动后在**登录主页**直接导入。
3. 已进入工作台后，点击顶部 **「修改」** 可随时覆盖导入新的 `key.json`（弹窗选择文件）；节点列表与 Moonshot 凭据会一并刷新。
4. 多节点时点击“选择节点”切换；当前节点 `active` 写入 `key.json`（个人偏好），不写进可分享的 `config.json`。

```json
{
  "shared": {
    "moonshot": {
      "model": "kimi-k2.6"
    },
    "server": {
      "host": "127.0.0.1",
      "port": 8787
    }
  },
  "patternRedraw": {
    "imageApi": {
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
      "outputDir": "runtime/cache/check",
      "prompt": "侵权审核系统提示词..."
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

```json
{
  "baseurl": "https://api.moonshot.cn/v1",
  "apikey": "",
  "trans_model_pool": {
    "active": "node-1",
    "nodes": [
      {
        "id": "node-1",
        "name": "节点1-beecode",
        "baseurl": "https://beeapi.ai",
        "endpoint": "/v1/images/edits",
        "model": "gpt-image-2",
        "price": {
          "1k": 0.02,
          "2k": 0.04,
          "4K": 0.08
        },
        "apikey": ""
      }
    ]
  }
}
```

`shared` 放“印花重绘”和“元素提取”共用的模型与服务配置；`patternRedraw` 对应“印花重绘”；`elementExtraction` 对应“元素提取”。图片中转节点列表在 `key.json` 的 `trans_model_pool` 中动态维护，公司可共享同一份 `config.json`，每人自备 `key.json` 增减节点与密钥。“套图生成”当前完全在浏览器内存中运行，不读取或写入配置。`prompt_prefix_model` 不显示为页面输入框，但会由前端注入当前批次货号后与图片一起发送给本地后台。Listing 产品由根目录 `config.json` 中的 `product_prompts` 管理；页面“管理产品”弹窗新增、修改或删除产品时只会原子更新根目录的这些产品字段。`n` 控制每次返回数量（1–4），`sizes` 将页面比例直接映射到 `/v1/images/edits` 的 `size`。

`key.json` 和 `runtime/` 均被 Git 忽略。Moonshot 与图片中转节点的完整 API Key、节点地址均只保存在 `key.json`；`config.json` 可安全分享业务参数。接口和页面只返回脱敏 Key。兼容旧版仅含 `trans_model_keys` 的 `key.json`：启动时会按节点 ID 合并并迁移为完整 `trans_model_pool`。

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

- 顶部“今日统计”悬停气泡实时显示成功缓存图片数、侵权审核图片数和元素提取图片数，并补充三类请求次数。
- 根目录 `log.txt` 按本机时间顺序追加简明记录；每日汇总中的生成数量只计算已经成功写入输出缓存的图片。
- 顶部“并发”输入框可在 1–10 之间调整并写回 `config.json`；新值立即用于后续队列，当前进行中的请求保持不变。长耗时图片请求由本地代理使用 5 分钟显式超时和 TCP 保活转发。

- 每页固定 50 条，避免一次渲染大量图片导致卡顿。
- 每个任务拥有独立提示词和运行日志。
- 顶部提示词可覆盖全部任务，也可以逐条修改。
- 生成请求动态读取任务当前提示词，只注入相似度强约束；比例直接映射到接口 `size`。
- 每个任务缓存接口返回的全部图片，预览区可左右轮换。
- 临时生成错误进入重试队列，等待 3 秒且最多重试一次。
- 单次图片生成请求最多等待 5 分钟；点击“停止”会取消在途请求，任务恢复为“待生成”且不会计入失败或自动重试。
- 输入图和生成图采用先写新版本、再切换任务引用的方式缓存，重新生成写入失败时保留原有图片。
- 支持单张生成、批量生成、停止、重新生成、重新获取、下载和删除。
- 顶部“批量传输”遍历全部分页中的已完成任务，每个任务只取第一张生成图；文件名优先使用 `displayCode` / `sourceCode` / 任务 id，避免跨任务同名覆盖。
- 传输失败的图片直接跳过，不阻塞其他图片；按钮旁显示成功、跳过和失败数量。
- 点右上角「清空」会先停止进行中的生成，再删除全部任务，并清空磁盘上的 `runtime/cache/`（原图、生成图、侵权拼图）。

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

浏览器不会再下载合并图。合并图缩放至 4K 以内后由后台保存到 `runtime/cache/check/`（与任务图同属 Cache，点「清空」一并删除），并发送到 Moonshot 中国区的 `kimi-k2.6` 进行侵权风险审核。审核规则读取 `patternRedraw.infringement.prompt`。审核请求超时为 **20 分钟**（本机 Node `requestTimeout` 同步覆盖）；失败卡片会显示上游 HTTP 状态、响应头和截断后的响应正文。审核结果以气泡卡片显示编号、风险等级和原因；没有发现风险项时也会显示明确结果。

## 模块 2：元素提取

- 可以独立选择本机图片目录，也可以接收模块 1 的批量传输；新批次会覆盖当前图片和提取结果。
- 按文件名自然排序，每 9 张生成一张 3×3 标号图，文件名去除扩展名后作为货号。
- 批次并发可选 1–4，默认 3；前端用多个异步 worker（`Promise.all`）并行领批，**单批失败不阻塞**其余批次。
- 侧栏进度条旁提供 **「停止」**：置停止标志、中断进行中的 `fetch`（`AbortController`），不再领取新批次；被中断批次标记为「待重试」，已完成结果保留。
- 请求链路：浏览器 `POST /api/element-extract` → 本地 Node 代理 → Moonshot `chat/completions`（SSE）。完整 API Key 只在服务端 `key.json`，不进入浏览器。
- 上游若返回 **HTTP 403**，服务端会按 **5s → 15s → 30s** 自动重试（瞬时限流常见）；仍失败则把 `HTTP 403 [moonshot_upstream_error]` 回给前端，该批可「重试未识别」。频繁 403 时可把并发降到 1–2，并确认 Moonshot Key 额度与视觉权限。
- Moonshot 使用 SSE 逐事件读取；页面不打印逐字增量，只在完成后显示最终 JSON，同时保留 5 秒心跳和 30 秒无事件告警。快速模式请求超时约 3 分钟，推理模式约 10 分钟。
- “模型模式”按钮可切换“不推理·快速”和“推理·较慢”；默认读取 `elementExtraction.thinkingEnabled`，不推理模式会发送 `thinking: {"type":"disabled"}`。
- “前后缀模式”固定读取 `prompt_prefix_model`；提取完成后可修改前缀、后缀并立即重新组合，不会再次请求模型。
- “Listing 模式”只允许从已配置产品中选择。请求会组合该产品的业务 Prompt 与 `prompt_product_output_model` 公共 JSON 规范；普通使用界面不显示 Prompt。
- “管理产品”弹窗支持新增、修改和删除 `{名称, Prompt}`，初始产品为“地垫”，配置保存到根目录 `config.json`。
- 前后缀结果和每个 Listing 产品的结果分别保存在页面内存中，切换模式或产品会恢复各自结果；重新选择图片目录时统一清空。
- 结果仅保存在当前页面内存，可编辑后导出 JSON 或 Excel；SheetJS 未加载时自动降级为 CSV。
- “导出图片文件夹”会将已完成原图按前后缀组合结果重命名并写入新目录；重名自动追加序号。
- 结果区“批量传输”使用与“导出图片文件夹”完全相同的完成条件和重命名规则，直接覆盖模块 3 的“印花组”，不弹出目录选择器；成功数量以模块 3 实际载入回执为准。
- 失败结果支持逐行“手动重试”，也可使用侧栏按钮批量重试全部未识别项。

## 模块 3：套图生成

- 使用独立 iframe 加载自包含的模块 3 静态资源。
- 可手动选择印花文件夹，也可接收模块 2 的批量传输。
- 支持多组产品图与蒙版模板，每个模板可配置多个平面或圆柱曲面网格。
- 平面交互预览使用快速三角形贴图，单张与批量高清导出使用 Homography 四点透视。
- 圆柱曲面优先使用 WebGL 投影，失败时回退至 Canvas 三角网格。
- 平面和曲面均支持扭曲置换、比例适配、混合模式和画布外裁剪。
- Workflow 传入新图片时只覆盖“印花组”，不会清除产品模板、蒙版、网格或形变参数。
- 新印花全部完成校验后才替换旧组；坏图单独计入失败，旧 Blob URL 会在替换或页面退出时释放。
- 模板配置可连同产品图和蒙版图导出；批量结果按“印花文件名/模板合成图”组织。

## 模块 4：商品导入

- 使用独立页面 `/listing-import`，并通过顶部“商品导入”标签集成到主工作台。
- 模块 3 批量导出完成后自动切换到模块 4，并直接传递已授权的导出目录句柄，无需重复选择路径。
- 也可手动选择符合“父文件夹 / Listing 文件夹 / 主图1、主图2……”结构的目录。
- 自动统计 Listing、图片和 SKU 数量；Listing 表格支持分页、标题编辑和点击切换当前商品。
- 当前 Listing 以树状结构展开类目、全部主图、每个 SKU 的图片分配、详情图和产品描述。
- SKU 图片可以由多个 SKU 共用同一个图片节点；缺图关系使用红色断线并标记“缺图”。
- 公共商品信息与 SKU 属性组合集中在同一个卡片中，最多支持两个 SKU 属性的笛卡尔组合。
- 导出按钮生成“妙手上传素材包 ZIP”，后续在妙手中使用“产品采集 → 导入采集 → 上传压缩包”。

## 四模块 Workflow

Workflow 协调逻辑集中在 `app/workflow/workflow-manager.js`，模块之间传递浏览器 `File` 对象，不需要先写入临时文件夹。

### 模块 1 → 模块 2

1. 在“印花重绘”完成所需任务。
2. 点击顶部“批量传输”。
3. 系统遍历全部任务而不是仅处理当前分页；失败、待生成或没有输出的任务会跳过。
4. 多图任务固定传第一张；文件名使用 `displayCode` / `sourceCode` / 任务 id，保证跨任务唯一。
5. 模块 2 的旧图片和旧结果被覆盖，页面自动切换到“元素提取”，但不会自动调用 Moonshot。

### 模块 2 → 模块 3

1. 完成元素提取或 Listing 生成，并按需编辑最终结果。
2. 点击结果区“批量传输”。
3. 系统只选择状态为“已完成”且最终名称非空的图片，按照图片文件夹导出规则生成合法且不重复的文件名。
4. 页面自动切换到“套图生成”，新批次覆盖“印花组”，现有产品模板和效果设置保持不变。

### 模块 3 → 模块 4

1. 在模块 3 选择导出文件夹并执行批量导出。
2. 批量渲染全部完成后，模块 3 向主页面发送导出目录句柄和目录名称。
3. 主页面自动切换到“商品导入”，模块 4 直接读取该目录中的 Listing 与图片。
4. 补充类目、描述、SKU 编码、价格、库存、重量、尺寸和 SKU 图片后，导出妙手上传 ZIP。

前三个模块的图片传输采用“成功项继续、失败项跳过”的策略，并显示本批成功、跳过或失败数量。Workflow 数据与目录句柄仅存在于当前浏览器会话；刷新页面后不会自动恢复模块 2 的结果、模块 3 的待传批次或模块 4 的目录授权，但模块 1 的持久化任务仍可重新传输。仅重启后台服务而不刷新页面时，当前页面内存不会立即丢失。

## 数据与安全

| 路径 | 内容 | 是否提交 Git |
|---|---|---|
| `config.json` | 业务配置（不含节点池） | 是 |
| `key.json` | Moonshot 凭据 + `trans_model_pool` 动态节点（含 apikey） | 否 |
| `runtime/tasks.json` | 任务状态、提示词、listing 和日志 | 否 |
| `runtime/cache/input/` | 原图缓存 | 否 |
| `runtime/cache/output/` | 已付费生成的图片 | 否 |
| `runtime/cache/check/` | 侵权查询合并图 | 否 |
| `runtime/logs/server.log` | 服务日志 | 否 |
| `log.txt` | 每日生成、侵权审核与元素提取统计 | 否 |

跨模块 Workflow 的 `File` 对象和目录句柄只存在于浏览器内存，不写入 `runtime/`。模块 1 原有任务和输出缓存仍按上表持久化；模块 2 的提取结果、模块 3 的画布状态、模块 4 的导入状态及传输批次刷新后清空。

修改前端、刷新页面或重载扩展不会重新生成图片。

**清空缓存：** 页面右上角「清空」会删除 `runtime/tasks.json` 中的任务记录，并清空整个 `runtime/cache/`（`input` / `output` / `check`）。`runtime/logs/` 与配置文件不会被删除。需要迁移或备份时，直接复制整个 `runtime/` 目录。

## HTTP 与 SSE

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/mockup` | 独立套图生成页面 |
| `GET` | `/listing-import` | 独立商品导入与妙手素材包页面 |
| `GET` | `/app/workflow/workflow-manager.js` | 四模块会话内文件与目录传输管理器 |
| `GET` | `/api/health` | 健康检查和脱敏配置 |
| `GET` | `/api/auth` | 登录状态：根目录是否已有可解析的 `key.json` |
| `GET / POST` | `/api/config` | 读取或替换业务配置 |
| `POST` | `/api/keys` | 导入并写入本机 `key.json`（登录 / 修改密钥） |
| `POST` | `/api/trans-model-node` | 切换图片中转节点 |
| `POST` | `/api/image-concurrency` | 保存顶部手动设置的图片生成并发数（1–10） |
| `GET / POST` | `/api/element-products` | 读取或管理根目录 Listing 产品配置 |
| `GET` | `/api/tasks` | 恢复全部任务 |
| `POST` | `/api/intake` | 扩展单条导入 |
| `POST` | `/api/intake/batch` | JSON 或扩展缓存批量导入 |
| `POST` | `/api/intake/retry` | 重新获取远程原图 |
| `GET` | `/api/events` | SSE 任务事件流 |
| `POST` | `/v1/images/edits` | BeeCode 图片编辑代理 |
| `POST` | `/api/infringement-check` | Moonshot 合并图侵权审核代理 |
| `POST` | `/api/element-extract` | Moonshot 3×3 元素提取代理 |
| `DELETE` | `/cache/tasks` | 清空全部任务与 `runtime/cache/`（含侵权拼图 check） |
| `DELETE` | `/cache/task?id=` | 删除单个任务及其输入/输出缓存文件 |

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
│  ├─ index.html                         四模块 POD 单页前端
│  ├─ element-extraction.js              元素提取目录、批次、编辑与导出
│  ├─ mockup-assets/                     新模块 3 自包含页面、JS、CSS 与图标
│  ├─ listing-import.html                 模块 4 Listing / SKU 整理与妙手 ZIP 导出
│  ├─ mockup.html                         旧版套图页面源码（运行时不再加载）
│  ├─ workflow/
│  │  └─ workflow-manager.js             四模块会话内 File / 目录传输协调器
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
├─ runtime/                              本机运行数据，Git 整目录忽略
│  ├─ tasks.json                         任务状态和任务日志
│  ├─ cache/
│  │  ├─ input/                          原图
│  │  ├─ output/                         生成图
│  │  └─ check/                          侵权查询合并图（随「清空」删除）
│  └─ logs/server.log                    服务日志
├─ docs/images/                          README 架构图与界面截图
├─ start.cmd                             一键启动（hybrid：Node 解析 / 杀 8787 / 起服务）
├─ install-desktop.cmd                   安装桌面快捷方式并自动启动（进登录页）
├─ tools/node/                           便携 Node（首次自动下载，gitignore）
├─ config.json                           业务配置（不含节点池，可分享）
├─ key.json                              Moonshot + 动态图片节点池（含密钥，登录依据）
├─ key.example.json                      密钥结构模板（唯一 example）
├─ update_plan.md                        整合设计与实施记录
└─ README.md
```

</details>

## 故障排查

| 现象 | 处理方式 |
|---|---|
| 页面打不开 | 运行 `start.cmd`，再访问 `http://127.0.0.1:8787/api/health` |
| 停在登录页 | 确认根目录有合法 `key.json`，或在登录页导入；可点「重新检查根目录」；`GET /api/auth` 可看状态 |
| 导入 key 失败 | 确认文件是合法 JSON，含顶层 `apikey` 与 `trans_model_pool.nodes`；参考 `key.example.json` |
| 提示找不到 Node / 下载失败 | 确认能访问 npmmirror 或 nodejs.org；或从有网机器拷贝整个 `tools/node/`（需含 `node.exe`） |
| 8787 端口被占用 | `start.cmd` **启动前会强制结束**所有占用 8787 的进程（不限是否本项目），再拉起服务并打开浏览器；若仍失败请以管理员运行一次 |
| 桌面图标失效 | 项目移动后重新双击 `install-desktop.cmd` 覆盖快捷方式 |
| 扩展显示“待同步” | 启动本机服务，然后打开或刷新 POD 页面 |
| JSON 原图返回 502 | 后台等待 3 秒重试一次，也可以点单行“重新获取” |
| BeeCode 请求失败 | 查看对应任务日志，HTTP 状态和响应正文都会保留；超过 5 分钟会按超时处理 |
| 元素提取 HTTP 403 | 多为 Moonshot 限流/权限；服务端已 5s/15s/30s 自动重试，仍失败用「重试未识别」；可降并发 |
| 侵权审核超时/空结果 | 审核最长约 20 分钟；确认 Moonshot Key 可用，并查看 `runtime/logs/server.log` |
| 点清空后图片仍在磁盘 | 确认已刷新到最新前端，且服务已重启；应清空整个 `runtime/cache/` |
| 配置不生效 | 检查 `config.json` 与 `key.json` 是否为合法 JSON；密钥只在 `key.json`；换密钥用顶部「修改」 |
| 刷新后任务缺失 | 检查 `runtime/tasks.json` 和服务日志，不要重新生成 |
| 批量传输数量为 0 | 模块 1 需至少有一个已完成且有输出的任务；模块 2 需至少有一个最终名称非空的已完成结果 |
| 模块 3 未收到印花 | 确认使用 `http://127.0.0.1:8787/` 打开主页面，并刷新一次以加载最新 workflow 脚本 |

---

<div align="center">

本项目默认仅监听 `127.0.0.1:8787`，用于本机 POD 工作流。

</div>
