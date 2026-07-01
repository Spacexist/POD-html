# POD + Temu Chrome Extension 合并实施记录

## 1. 目标

将当前 BeeCode POD 生图工具与 Temu 图片采集 Chrome 扩展合并到同一个仓库，形成一条完整链路：

```text
Temu 商品页采集
  -> Chrome 扩展本地缓存
  -> HTTP POST 到本机 POD 后台
  -> 后台按 imageurl 去重并缓存原图
  -> SSE 通知已打开的 POD 页面
  -> POD 新任务保持“待生成”
  -> 用户确认后再进入付费生图队列
```

实施过程中未触发新的 BeeCode 生图请求；现有任务、输入图、生成图和日志已迁移到 `runtime/` 并保留原缓存目录作为备份。

## 2. 最终目录结构

```text
POD-html/
├─ app/
│  └─ index.html                       # POD 单页前端
├─ server/
│  ├─ index.js                         # HTTP 服务入口与路由
│  ├─ config.js                        # 统一配置读取、校验与写入
│  ├─ task-store.js                    # 任务读取、去重、原子写入
│  ├─ intake.js                        # 扩展单条/批量导入
│  └─ sse.js                           # POD 页面实时事件推送
├─ extension/
│  └─ temu-image-downloader/
│     ├─ manifest.json
│     ├─ background.js                 # 缓存、下载、自动 POST
│     ├─ content.js                    # Temu DOM 采集与按钮反馈
│     ├─ pod-bridge.js                 # 打开 POD 页面时同步旧缓存
│     ├─ content.css
│     ├─ popup.html
│     ├─ popup.js
│     ├─ options.html
│     ├─ options.js
│     └─ icons/
├─ config/
│  └─ config.example.json              # 可提交，不包含真实 Key
├─ runtime/                            # 全部本机运行数据，Git 忽略
│  ├─ config.json                      # 唯一实际配置文件
│  ├─ tasks.json                       # 任务元数据与任务日志
│  ├─ cache/
│  │  ├─ input/                        # 原图缓存
│  │  ├─ output/                       # BeeCode 生成图
│  │  └─ contact-sheets/               # 合并本页输出
│  └─ logs/
│     └─ server.log                    # 服务启动、接口与异常日志
├─ start.cmd                           # 启动服务并打开 POD 页面
├─ README.md
└─ .gitignore
```

## 3. 配置方案

### 3.1 唯一配置文件

程序只读取：

```text
runtime/config.json
```

配置结构：

```json
{
  "beecode": {
    "apiKey": "",
    "baseUrl": "https://beecode.cc",
    "model": "gpt-image-2",
    "size": "1024x1024",
    "concurrency": 3
  },
  "server": {
    "host": "127.0.0.1",
    "port": 8787
  }
}
```

### 3.2 读取和写入规则

- 后台启动时只读取一次 `runtime/config.json` 并保存在内存。
- 页面首次选择配置文件后，后台校验并原子写入 `runtime/config.json`。
- 写入成功后立即更新后台内存配置，不要求重启。
- 以后打开页面自动读取后台公开配置，不再要求重复选择文件。
- “配置文件”按钮继续保留，用于以后更换 API Key 或模型。
- 页面只显示脱敏 Key，不向浏览器返回完整 Key。
- `runtime/` 全目录加入 `.gitignore`。
- GitHub 只保留 `config/config.example.json`。
- 旧配置文件不再参与运行逻辑。

## 4. Chrome 扩展行为

### 4.1 默认模式

- 默认使用 `POD 模式`。
- 保留 `本地下载模式`。
- POD 模式负责缓存商品并同步到 POD。
- 本地下载模式只下载原图，不创建 POD 任务。

### 4.2 采集与去重

- 点击商品下载/采集按钮时读取 `imageurl`、`listing`、`编号`。
- 扩展缓存按完整 `imageurl` 字符串去重。
- 如果 JSON 缓存已有相同 `imageurl`：
  - 显示“重复”；
  - 不再次加入；
  - 不发送重复任务。
- 不额外清理查询参数，不转换 URL 后再比较。

### 4.3 实时同步

新商品写入扩展缓存后：

```http
POST http://127.0.0.1:8787/api/intake
Content-Type: application/json
```

请求数据：

```json
{
  "编号": "20260623194641_0001",
  "listing": "Product title",
  "imageurl": "https://img.kwcdn.com/example.jpg"
}
```

- 服务在线：立即导入 POD。
- 服务离线：扩展仍保存缓存，并显示“已缓存，待同步”。
- 服务离线不视为采集失败。
- 已同步商品继续保留在扩展缓存，不自动删除。

### 4.4 旧缓存自动导入

扩展新增独立的 `pod-bridge.js`：

- 只在 `http://127.0.0.1:8787/*` 页面运行。
- POD 页面打开时读取 `chrome.storage.local.cached_items`。
- 将未同步缓存批量提交到 `/api/intake/batch`。
- 服务端再次按 `imageurl` 去重。
- 不使用页面定时轮询。

扩展需要增加本机服务权限：

```json
{
  "host_permissions": [
    "http://127.0.0.1:8787/*"
  ]
}
```

## 5. POD 后台导入

### 5.1 接口

```text
POST /api/intake          单条商品导入
POST /api/intake/batch    扩展旧缓存批量导入
GET  /api/events          SSE 实时事件
GET  /api/tasks           获取完整任务状态
GET  /api/config          获取脱敏后的运行配置
POST /api/config          导入并持久化配置
GET  /health              服务健康检查
```

### 5.2 去重与任务字段

后台同样按完整 `imageurl` 字符串去重。

`编号` 不直接作为内部任务 ID：

```json
{
  "id": "后台生成的唯一任务ID",
  "sourceCode": "20260623194641_0001",
  "displayCode": "0001",
  "listing": "Product title",
  "imageurl": "https://img.kwcdn.com/example.jpg",
  "status": "pending"
}
```

- `id` 用于文件路径和内部状态更新。
- `sourceCode` 完整保存扩展传入的编号。
- `displayCode` 从编号后缀读取，不自行编造。
- 自动导入后只缓存原图，状态保持“待生成”。
- 不自动加入付费生图队列。

### 5.3 并发安全

- 保持零 npm 依赖，只使用 Node.js 内置模块。
- `tasks.json` 通过服务端串行写入队列更新。
- 每次先写临时文件，再原子替换正式文件。
- 批量导入、图片缓存和生成状态更新不能互相覆盖。

## 6. SSE 结构

POD 页面建立连接：

```http
GET /api/events
Accept: text/event-stream
```

后台响应：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

新增任务事件：

```text
event: task.created
id: internal-task-id
data: {"id":"internal-task-id","status":"pending"}

```

任务更新事件：

```text
event: task.updated
id: internal-task-id
data: {"id":"internal-task-id","status":"pending","inputUrl":"/cache/input/..."}

```

心跳：

```text
: ping

```

页面使用原生 `EventSource`，断线自动重连。SSE 只负责服务端向 POD 页面推送；扩展提交仍使用普通 HTTP POST。

## 7. POD 前端行为

- 页面启动时获取一次 `/api/tasks`，恢复已有任务。
- 随后连接 `/api/events`。
- 收到 `task.created` 时只追加新任务。
- 收到 `task.updated` 时只更新对应任务。
- 不定时轮询，不重载整页。
- 不影响正在执行的生图任务和滑动并发窗口。
- 扩展自动导入的任务提示词默认为空。
- 用户可用顶部提示词覆盖下面任务提示词。

## 8. 合并本页图片

每页固定 50 个任务时：

- 固定横向 `10 列 × 5 行`。
- 每格固定 `600×600 px`。
- 输出固定 `6000×3000 px`。
- 图片保持比例并居中铺满单元格，允许少量边缘裁切，不拉伸变形。
- 编号读取任务的 `displayCode`。
- 编号显示在左上角。
- 编号使用约 `52px` 粗体、黑色半透明底、白色文字和明显内边距。
- 保持当前合并日志、失败统计和下载目录逻辑。
- 默认使用高质量 JPEG 输出，避免文件体积失控。

## 9. 启动流程

双击根目录 `start.cmd`：

1. 检查 `http://127.0.0.1:8787/health`。
2. 如果服务未运行，启动 `node server/index.js`。
3. 等待健康检查通过。
4. 自动打开 `http://127.0.0.1:8787/`。
5. POD 页面加载后，扩展 `pod-bridge.js` 自动同步旧缓存。

建议的单实例规则：

- 服务已经运行：只打开页面，不启动第二个进程。
- 8787 被其他程序占用：明确报错，不自动更换端口。

## 10. 迁移规则

实施时先备份，再迁移，不重新生成任何图片：

1. 停止新的写入操作，但不删除现有数据。
2. 备份旧 `beecode-cache` 和任务元数据。
3. 将现有输入、输出、任务日志迁移到 `runtime/`。
4. 将当前有效配置转换为新的 `runtime/config.json`。
5. 校验迁移前后任务数、输入图数和输出图数。
6. 确认新程序能够恢复全部已生成任务后，再取消旧路径读取。
7. 删除旧配置读取逻辑，但不自动删除用户备份。

## 11. 实施顺序

1. 建立新目录，不移动运行数据。
2. 拆分并迁移后台模块。
3. 完成统一配置读写。
4. 完成任务存储的串行原子写入。
5. 添加 `/api/intake` 和 `/api/intake/batch`。
6. 添加 SSE 服务和前端事件处理。
7. 合入 Chrome 扩展。
8. 添加 `pod-bridge.js` 和默认 POD 模式。
9. 修改 50 图合并尺寸与编号样式。
10. 编写迁移脚本并只做演练检查。
11. 停止服务后执行一次正式迁移。
12. 更新 README、安装说明、接口说明和数据恢复说明。

## 12. 测试计划

### 配置

- 首次导入配置后生成 `runtime/config.json`。
- 重启后台和刷新页面均不再要求手动配置。
- 更换配置文件后后台内存配置立即更新。
- 页面和接口不会泄露完整 API Key。

### 扩展

- 默认进入 POD 模式。
- 新商品在线时立即进入 POD。
- 服务离线时显示“已缓存，待同步”。
- 相同 `imageurl` 显示“重复”且不加入缓存。
- 打开 POD 页面后旧缓存自动批量同步。
- 本地下载模式不会创建 POD 任务。

### POD

- 自动导入任务状态为“待生成”。
- 不自动产生 BeeCode 费用。
- SSE 能即时追加和更新任务。
- SSE 断线后自动恢复。
- 扩展和后台重复提交不会产生重复任务。
- 50 条并发导入不会丢任务或破坏 `tasks.json`。

### 缓存迁移

- 迁移前后任务数量一致。
- 现有输入图、生成图和任务日志均可恢复。
- 已生成图片无需重新调用 BeeCode。

### 合并本页

- 50 张输出为 `6000×3000`。
- 每格实际为 `600×600`。
- 编号来自 JSON 的编号后缀。
- 编号在 100% 缩放下清晰可读。
- 缺图任务有明确日志，不阻塞其余图片输出。

## 13. 已采用的最终决定

- 合并图使用 JPEG，质量 `0.94`。
- 服务默认使用 `8787` 端口；已有服务健康时直接复用。
- 运行配置只保存在 `runtime/config.json`，仓库仅提交无密钥示例。
- 自动导入只进入“待生成”，不会自动产生 BeeCode 费用。
