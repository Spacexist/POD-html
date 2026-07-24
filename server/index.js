const http = require("http");
const fs = require("fs");
const path = require("path");

const { ROOT, RUNTIME_ROOT, getConfig, replaceConfig, publicConfig } = require("./config");
const store = require("./task-store");
const { createSseHub } = require("./sse");
const { createIntake } = require("./intake");

const APP_PATH = path.join(ROOT, "app", "index.html");
const LOG_PATH = path.join(RUNTIME_ROOT, "logs", "server.log");
const sse = createSseHub();
const intake = createIntake({ store });
const INFRINGEMENT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "infringement_risk_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              number: { type: "string" },
              reason: { type: "string" },
              risk: { type: "string", enum: ["低", "中", "高"] }
            },
            required: ["number", "reason", "risk"],
            additionalProperties: false
          }
        }
      },
      required: ["items"],
      additionalProperties: false
    }
  }
};
for (const eventName of ["task.created", "task.updated", "task.deleted", "tasks.cleared"]) {
  store.events.on(eventName, (payload) => sse.publish(eventName, payload));
}

// 将重要后台节点同时写入运行日志和终端，便于定位长时间请求。
function appendServerLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${line}\n`, "utf8");
  console.log(line);
}

// 递归遮罩日志中的密钥、Cookie 和大型图片 Data URL，同时保留请求结构。
function sanitizeLogValue(value, keyName = "") {
  const normalizedKey = String(keyName || "").toLowerCase();
  if (
    normalizedKey === "authorization" ||
    normalizedKey === "cookie" ||
    normalizedKey === "set-cookie" ||
    normalizedKey === "apikey" ||
    normalizedKey === "api_key"
  ) {
    return "<已遮罩>";
  }
  if (normalizedKey === "reasoning_content" || normalizedKey === "reasoning") {
    return "<内部推理内容不记录>";
  }
  if (typeof value === "string") {
    const dataUrlMatch = value.match(/^(data:image\/[^;,]+;base64,)([A-Za-z0-9+/=]+)$/i);
    if (dataUrlMatch) {
      const encodedLength = dataUrlMatch[2].length;
      const estimatedBytes = Math.round(encodedLength * 0.75);
      return `${dataUrlMatch[1]}<base64 ${encodedLength} 字符，约 ${estimatedBytes} 字节>`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const sanitizedArray = [];
    for (let index = 0; index < value.length; index += 1) {
      sanitizedArray.push(sanitizeLogValue(value[index], ""));
    }
    return sanitizedArray;
  }
  if (value && typeof value === "object") {
    const sanitizedObject = {};
    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      sanitizedObject[key] = sanitizeLogValue(value[key], key);
    }
    return sanitizedObject;
  }
  return value;
}

// 将 Fetch Headers 转换为可序列化对象，便于完整记录响应头。
function headersToLogObject(headers) {
  const result = {};
  const entries = headers.entries();
  let entry = entries.next();
  while (!entry.done) {
    result[entry.value[0]] = entry.value[1];
    entry = entries.next();
  }
  return result;
}

// 将普通 JSON 响应格式化为安全日志文本，并遮罩可能存在的内部推理字段。
function responseTextForLog(raw) {
  try {
    return JSON.stringify(sanitizeLogValue(JSON.parse(raw)), null, 2);
  } catch (error) {
    return String(raw || "");
  }
}

// 通过项目现有 SSE 通道向元素提取页面推送后台实时节点。
function publishElementTrace(requestId, stage, message, details = {}) {
  sse.publish("element.extraction.trace", {
    requestId,
    stage,
    message,
    details,
    createdAt: new Date().toISOString()
  });
}

// 在 Moonshot 流式响应等待期间定时上报连接存活、事件计数和公开输出进度。
function publishMoonshotStreamHeartbeat(state) {
  if (state.finished) return;
  const now = Date.now();
  const elapsedSeconds = Math.floor((now - state.startedAt) / 1000);
  const idleSeconds = Math.floor((now - state.lastEventAt) / 1000);
  const stalled = idleSeconds >= 30;
  const stage = stalled ? "moonshot_stream_stalled" : "moonshot_stream_heartbeat";
  const prefix = stalled ? "疑似停滞" : "连接正常";
  publishElementTrace(
    state.requestId,
    stage,
    `${prefix}：已运行 ${elapsedSeconds}s，最近 SSE 事件 ${idleSeconds}s 前，累计 ${state.eventCount} 个事件，公开输出 ${state.contentCharacters} 字符`,
    {
      elapsedSeconds,
      idleSeconds,
      eventCount: state.eventCount,
      contentCharacters: state.contentCharacters,
      reasoningCharacters: state.reasoningCharacters
    }
  );
}

// 读取 Moonshot 的 SSE 响应，将每个已脱敏 data 事件和公开 content 片段实时转发给页面。
async function readMoonshotSseResponse(upstream, requestId) {
  if (!upstream.body) throw new Error("Moonshot SSE 响应缺少可读流");
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const safeFrames = [];
  let buffer = "";
  let content = "";
  let reasoningCharacters = 0;
  let reasoningStarted = false;
  let finished = false;
  const streamState = {
    requestId,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    eventCount: 0,
    contentCharacters: 0,
    reasoningCharacters: 0,
    finished: false
  };
  const heartbeatTimer = setInterval(publishMoonshotStreamHeartbeat, 5000, streamState);
  publishElementTrace(requestId, "moonshot_stream_open", "Moonshot SSE 连接已建立，开始逐条接收 data 事件");

  try {
    while (!finished) {
      const readResult = await reader.read();
      if (readResult.value) {
        buffer += decoder.decode(readResult.value, { stream: !readResult.done });
      }
      if (readResult.done) {
        buffer += decoder.decode();
        buffer += "\n";
        finished = true;
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          streamState.lastEventAt = Date.now();
          streamState.eventCount += 1;
          if (data === "[DONE]") {
            safeFrames.push("data: [DONE]");
            publishElementTrace(requestId, "moonshot_stream_done", "Moonshot SSE 已发送完成标记");
            finished = true;
          } else if (data) {
            let eventPayload;
            try {
              eventPayload = JSON.parse(data);
            } catch (error) {
              safeFrames.push(`data: ${data}`);
              publishElementTrace(requestId, "moonshot_stream_warning", `收到无法解析的 SSE 数据：${error.message}`);
              newlineIndex = buffer.indexOf("\n");
              continue;
            }
            const safeEventPayload = sanitizeLogValue(eventPayload);
            safeFrames.push(`data: ${JSON.stringify(safeEventPayload)}`);
            const choice = eventPayload.choices && eventPayload.choices[0];
            const delta = choice && choice.delta ? choice.delta : {};
            const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
            if (reasoning) {
              reasoningCharacters += reasoning.length;
              streamState.reasoningCharacters = reasoningCharacters;
              if (!reasoningStarted) {
                reasoningStarted = true;
                publishElementTrace(
                  requestId,
                  "moonshot_reasoning",
                  "模型已进入推理阶段，等待公开 content 输出"
                );
              }
            }
            if (typeof delta.content === "string" && delta.content) {
              content += delta.content;
              streamState.contentCharacters = content.length;
            }
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    streamState.finished = true;
    clearInterval(heartbeatTimer);
  }

  publishElementTrace(
    requestId,
    "moonshot_stream_closed",
    `Moonshot SSE 响应读取完成，公开答案 ${content.length} 字符，共 ${streamState.eventCount} 个事件`,
    { reasoningCharacters, eventCount: streamState.eventCount }
  );
  return {
    content,
    reasoningCharacters,
    safeResponseText: safeFrames.join("\n")
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, X-Moonshot-Thinking",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), { "Content-Type": "application/json; charset=utf-8" });
}

function readBody(req, limitBytes = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`请求体超过 ${Math.round(limitBytes / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req, limitBytes = 2 * 1024 * 1024) {
  const body = await readBody(req, limitBytes);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("请求不是合法 JSON");
  }
}

function cleanFileName(name) {
  return String(name || "image").replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
}

function extFromNameOrType(name, type) {
  const ext = path.extname(name || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  if (/png/i.test(type || "")) return ".png";
  if (/webp/i.test(type || "")) return ".webp";
  return ".jpg";
}

function parsePrompt(value) {
  return String(value || "").slice(0, 20000);
}

function parseLogs(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.slice(0, 80).map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function parseContentDisposition(value) {
  const result = {};
  for (const part of String(value || "").split(";")) {
    const [rawKey, ...rawRest] = part.trim().split("=");
    if (!rawRest.length) continue;
    const key = rawKey.trim().toLowerCase();
    let val = rawRest.join("=").trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

function parseMultipart(buffer, contentType) {
  const match = String(contentType || "").match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!match) throw new Error("multipart 缺少 boundary");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    const dataStart = headerEnd + 4;
    const next = buffer.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon > -1) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    parts.push({
      name: disposition.name,
      filename: disposition.filename,
      contentType: headers["content-type"] || "",
      data: buffer.slice(dataStart, dataEnd)
    });
    cursor = next;
  }
  const fields = {};
  const files = {};
  for (const part of parts) {
    if (!part.name) continue;
    if (part.filename !== undefined) files[part.name] = part;
    else fields[part.name] = part.data.toString("utf8");
  }
  return { fields, files };
}

async function cacheInput(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message } }); }
  try {
    const parsed = parseMultipart(body, req.headers["content-type"]);
    const file = parsed.files.image;
    const id = store.safeId(parsed.fields.id);
    if (!id || !file) return sendJson(res, 400, { error: { message: "缺少 id 或 image" } });
    const fileName = cleanFileName(file.filename || parsed.fields.fileName || "image");
    const ext = extFromNameOrType(fileName, file.contentType);
    const inputFile = path.join(store.INPUT_DIR, `${id}${ext}`);
    for (const oldName of fs.readdirSync(store.INPUT_DIR)) {
      if (oldName.startsWith(`${id}.`)) store.removeFile(path.join(store.INPUT_DIR, oldName));
    }
    fs.writeFileSync(inputFile, file.data);
    const task = store.upsert({
      id,
      fileName,
      createdAt: parsed.fields.createdAt || new Date().toLocaleString("zh-CN", { hour12: false }),
      status: parsed.fields.status || "queued",
      message: parsed.fields.message || "等待生成",
      prompt: parsePrompt(parsed.fields.prompt),
      sourceCode: parsed.fields.sourceCode || "",
      displayCode: parsed.fields.displayCode || "",
      listing: String(parsed.fields.listing || ""),
      imageurl: parsed.fields.imageurl || parsed.fields.sourceUrl || "",
      sourceUrl: parsed.fields.sourceUrl || parsed.fields.imageurl || "",
      errorLog: parsed.fields.errorLog || "",
      retryCount: Number(parsed.fields.retryCount || 0),
      retryAt: Number(parsed.fields.retryAt || 0),
      logs: parseLogs(parsed.fields.logs),
      inputFile,
      inputType: file.contentType || "image/jpeg"
    }, store.findById(id) ? "task.updated" : "task.created");
    return sendJson(res, 200, store.publicTask(task));
  } catch (error) {
    appendServerLog(`cache input failed: ${error.message}`);
    return sendJson(res, 500, { error: { message: error.message } });
  }
}

// 判断缓存目录中的文件是否属于指定任务的某一张输出图。
function isTaskOutputFile(fileName, id) {
  if (fileName.startsWith(`${id}.`)) return true;
  if (!fileName.startsWith(`${id}-`)) return false;
  const remainder = fileName.slice(id.length + 1);
  return /^\d+\.[^.]+$/.test(remainder);
}

// 按字段名顺序收集 output0、output1 等多图文件，并兼容旧字段 output。
function collectOutputFiles(files) {
  const collected = [];
  const names = Object.keys(files || {});
  for (const name of names) {
    const match = name.match(/^output(\d+)$/);
    if (match) collected.push({ index: Number(match[1]), file: files[name] });
  }
  if (!collected.length && files && files.output) collected.push({ index: 0, file: files.output });
  for (let left = 0; left < collected.length; left += 1) {
    for (let right = left + 1; right < collected.length; right += 1) {
      if (collected[right].index < collected[left].index) {
        const current = collected[left];
        collected[left] = collected[right];
        collected[right] = current;
      }
    }
  }
  return collected;
}

// 更新任务状态，并在存在输出文件时一次缓存全部生成图。
async function cacheOutput(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message } }); }
  try {
    const parsed = parseMultipart(body, req.headers["content-type"]);
    const id = store.safeId(parsed.fields.id);
    if (!id) return sendJson(res, 400, { error: { message: "缺少 id" } });
    const update = {
      id,
      status: parsed.fields.status || "queued",
      message: parsed.fields.message || "",
      prompt: parsePrompt(parsed.fields.prompt),
      sourceCode: parsed.fields.sourceCode || "",
      displayCode: parsed.fields.displayCode || "",
      listing: String(parsed.fields.listing || ""),
      imageurl: parsed.fields.imageurl || parsed.fields.sourceUrl || "",
      sourceUrl: parsed.fields.sourceUrl || parsed.fields.imageurl || "",
      errorLog: parsed.fields.errorLog || "",
      retryCount: Number(parsed.fields.retryCount || 0),
      retryAt: Number(parsed.fields.retryAt || 0),
      logs: parseLogs(parsed.fields.logs)
    };
    const files = collectOutputFiles(parsed.files);
    if (files.length) {
      for (const oldName of fs.readdirSync(store.OUTPUT_DIR)) {
        if (isTaskOutputFile(oldName, id)) store.removeFile(path.join(store.OUTPUT_DIR, oldName));
      }
      const outputFiles = [];
      const outputTypes = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index].file;
        if (!file || !file.data.length) continue;
        const ext = extFromNameOrType(file.filename || `output-${index + 1}.png`, file.contentType || "image/png");
        const outputFile = path.join(store.OUTPUT_DIR, `${id}-${index + 1}${ext}`);
        fs.writeFileSync(outputFile, file.data);
        outputFiles.push(outputFile);
        outputTypes.push(file.contentType || "image/png");
      }
      if (outputFiles.length) {
        update.outputFiles = outputFiles;
        update.outputTypes = outputTypes;
        update.outputFile = outputFiles[0];
        update.outputType = outputTypes[0];
      }
    }
    return sendJson(res, 200, store.publicTask(store.upsert(update)));
  } catch (error) {
    appendServerLog(`cache output failed: ${error.message}`);
    return sendJson(res, 500, { error: { message: error.message } });
  }
}

// 发送任务的输入图或指定索引的输出图。
function sendCachedFile(res, kind, id, url) {
  const task = store.findById(id);
  if (!task) return sendJson(res, 404, { error: { message: "缓存任务不存在" } });
  let filePath = task.inputFile;
  let type = task.inputType;
  if (kind === "output") {
    const index = Number(url && url.searchParams.get("index") || 0);
    if (!Number.isInteger(index) || index < 0) return sendJson(res, 400, { error: { message: "输出图片索引无效" } });
    const outputFiles = store.outputFilesForTask(task);
    const outputTypes = store.outputTypesForTask(task, outputFiles.length);
    filePath = outputFiles[index];
    type = outputTypes[index];
  }
  if (!filePath || !fs.existsSync(filePath)) return sendJson(res, 404, { error: { message: "缓存文件不存在" } });
  return send(res, 200, fs.readFileSync(filePath), { "Content-Type": type || "application/octet-stream" });
}

// 删除一个任务及其全部输入、输出缓存文件。
function deleteTask(res, url) {
  const id = store.safeId(url.searchParams.get("id"));
  if (!id) return sendJson(res, 400, { error: { message: "缺少 id" } });
  const task = store.remove(id);
  if (task) {
    store.removeFile(task.inputFile);
    const outputFiles = store.outputFilesForTask(task);
    for (const outputFile of outputFiles) store.removeFile(outputFile);
  }
  return sendJson(res, 200, { ok: true });
}

// 清空任务列表及全部输入、输出缓存文件。
function clearTasks(res) {
  for (const task of store.list()) {
    store.removeFile(task.inputFile);
    const outputFiles = store.outputFilesForTask(task);
    for (const outputFile of outputFiles) store.removeFile(outputFile);
  }
  store.clear();
  return sendJson(res, 200, { ok: true });
}

async function proxyImageEdit(req, res) {
  const config = getConfig().patternRedraw.imageApi;
  if (!config.apiKey) {
    return sendJson(res, 500, { error: { message: "runtime/config.json 未配置图片中转 API Key，请点击左上角配置文件导入", type: "proxy_config_error" } });
  }
  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message, type: "proxy_body_error" } }); }
  const target = `${config.baseUrl}${config.endpoint}`;
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": req.headers["content-type"] || "application/octet-stream"
      },
      body
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    return send(res, upstream.status, upstreamBody, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "X-Image-Api-Target": target
    });
  } catch (error) {
    appendServerLog(`image API proxy failed: ${error.message}`);
    return sendJson(res, 502, {
      error: { message: error.message || String(error), type: error.name || "ProxyFetchError" },
      proxy: { target }
    });
  }
}

function normalizeInfringementItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    number: String(item && item.number || "").trim().slice(0, 80),
    reason: String(item && item.reason || "").trim().slice(0, 500),
    risk: ["低", "中", "高"].includes(item && item.risk) ? item.risk : "低"
  })).filter((item) => item.number && item.reason);
}

// 将浏览器生成的侵权审核拼图保存到项目配置的后台目录。
function saveInfringementContactSheet(image, page) {
  const config = getConfig().patternRedraw.infringement;
  if (!config.saveContactSheet) return "";
  const match = image.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("缺少合法的合并图片");
  const extension = /^jpe?g$/i.test(match[1]) ? ".jpg" : `.${match[1].toLowerCase()}`;
  const outputDir = path.resolve(ROOT, config.outputDir);
  const rootPrefix = `${ROOT}${path.sep}`.toLowerCase();
  if (!outputDir.toLowerCase().startsWith(rootPrefix)) throw new Error("侵权拼图输出目录必须位于项目内");
  fs.mkdirSync(outputDir, { recursive: true });
  const pageNumber = Math.max(1, Math.floor(Number(page || 1)));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `contact-sheet-page-${pageNumber}-${timestamp}${extension}`;
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

// 保存侵权拼图并代理 Moonshot 结构化审核请求。
async function checkInfringement(req, res) {
  const fullConfig = getConfig();
  const config = fullConfig.shared.moonshot;
  let payload;
  try { payload = await readJsonBody(req, 35 * 1024 * 1024); }
  catch (error) { return sendJson(res, 400, { error: { message: error.message, type: "bad_json" } }); }
  const image = String(payload.image || "");
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    return sendJson(res, 400, { error: { message: "缺少合法的合并图片", type: "invalid_image" } });
  }
  let savedContactSheet = "";
  try {
    savedContactSheet = saveInfringementContactSheet(image, payload.page);
  } catch (error) {
    appendServerLog(`save infringement contact sheet failed: ${error.message}`);
    return sendJson(res, 500, { error: { message: error.message, type: "contact_sheet_save_error" } });
  }
  if (!config.apiKey) {
    return sendJson(res, 500, {
      error: { message: "runtime/config.json 未配置 Moonshot API Key", type: "moonshot_config_error" },
      savedContactSheet
    });
  }
  const target = `${config.baseUrl}/chat/completions`;
  const requestBody = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: "你是图片侵权风险审核助手。仅列出有明确或较高可能侵权风险的图片编号；编号来自图片左上角标签。没有风险项时返回空数组。reason 用简短中文说明依据；risk 只能是低、中、高。不要臆测无法从图中识别的信息。"
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: "请审核这张合并图，并按既定 JSON Schema 返回。" }
        ]
      }
    ],
    response_format: INFRINGEMENT_RESPONSE_FORMAT,
    max_tokens: 2048
  };
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      return sendJson(res, upstream.status, {
        error: { message: raw.slice(0, 1000), type: "moonshot_upstream_error" },
        savedContactSheet
      });
    }
    const response = JSON.parse(raw);
    const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    if (!content) throw new Error("Moonshot 未返回审核结果");
    const result = JSON.parse(content);
    return sendJson(res, 200, { ok: true, items: normalizeInfringementItems(result.items), savedContactSheet });
  } catch (error) {
    appendServerLog(`Moonshot infringement check failed: ${error.message}`);
    return sendJson(res, 502, {
      error: { message: error.message, type: error.name || "MoonshotProxyError" },
      savedContactSheet
    });
  }
}

// 从模型响应文本中解析结构化 JSON，并兼容 Markdown 代码块。
function parseElementModelJson(content) {
  let cleaned = String(content || "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  const parsed = JSON.parse(cleaned.trim());
  return Array.isArray(parsed) ? { items: parsed } : parsed;
}

// 清理模型返回的元素结果，并限制单次最多接收九条。
function normalizeElementItems(value) {
  const rows = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const row of rows) {
    const id = String(row && row.id || "").trim().replace(/^\[|\]$/g, "").slice(0, 120);
    const description = String(row && row.description || "").trim().slice(0, 2000);
    if (id && description) normalized.push({ id, description });
    if (normalized.length >= 9) break;
  }
  return normalized;
}

// 使用 shared.moonshot 配置代理一组 3×3 拼图的元素提取请求。
async function extractElements(req, res) {
  const requestStartedAt = Date.now();
  const serverTraceId = `element-server-${requestStartedAt}-${Math.floor(Math.random() * 10000)}`;
  appendServerLog(
    `[element-extract][${serverTraceId}] HTTP REQUEST\n${req.method} ${req.url}\nHeaders:\n${JSON.stringify(sanitizeLogValue(req.headers), null, 2)}\nBody: <正在读取>`
  );
  let payload;
  try {
    payload = await readJsonBody(req, 35 * 1024 * 1024);
  } catch (error) {
    appendServerLog(`[element-extract][${serverTraceId}] JSON 正文读取失败：${error.message}`);
    return sendJson(res, 400, { error: { message: error.message, type: "bad_json" }, requestId: serverTraceId });
  }

  const requestId = String(req.headers["x-request-id"] || serverTraceId)
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 120) || serverTraceId;
  const image = String(payload.image || "");
  appendServerLog(
    `[element-extract][${requestId}] HTTP REQUEST BODY\n${JSON.stringify(sanitizeLogValue(payload), null, 2)}`
  );
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    appendServerLog(`[element-extract][${requestId}] 校验失败：缺少合法的 3×3 拼图`);
    return sendJson(res, 400, {
      error: { message: "缺少合法的 3×3 拼图", type: "invalid_image" },
      requestId
    });
  }
  const prompt = String(payload.prompt || "").trim().slice(0, 20000);
  if (!prompt) {
    appendServerLog(`[element-extract][${requestId}] 校验失败：缺少提示词`);
    return sendJson(res, 400, {
      error: { message: "缺少提示词", type: "missing_prompt" },
      requestId
    });
  }

  const moonshot = getConfig().shared.moonshot;
  if (!moonshot.apiKey) {
    appendServerLog(`[element-extract][${requestId}] 配置校验失败：shared.moonshot.apiKey 未配置`);
    return sendJson(res, 500, {
      error: { message: "runtime/config.json 未配置 shared.moonshot.apiKey", type: "moonshot_config_error" },
      requestId
    });
  }
  const thinkingEnabled = String(req.headers["x-moonshot-thinking"] || "").toLowerCase() === "enabled";
  const target = `${moonshot.baseUrl}/chat/completions`;
  const requestBody = {
    model: moonshot.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ],
    temperature: 0.6,
    stream: true
  };
  if (!thinkingEnabled) requestBody.thinking = { type: "disabled" };
  const upstreamBody = JSON.stringify(requestBody);
  const upstreamHeaders = {
    "Authorization": `Bearer ${moonshot.apiKey}`,
    "Content-Type": "application/json"
  };
  appendServerLog(
    `[element-extract][${requestId}] MOONSHOT HTTP REQUEST\nPOST ${target}\nHeaders:\n${JSON.stringify(sanitizeLogValue(upstreamHeaders), null, 2)}\nBody:\n${JSON.stringify(sanitizeLogValue(requestBody), null, 2)}\n实际正文: ${Buffer.byteLength(upstreamBody)} 字节`
  );
  publishElementTrace(
    requestId,
    "moonshot_http_request",
    `Moonshot 请求已组装：模型 ${moonshot.model}，${thinkingEnabled ? "推理模式" : "不推理快速模式"}，正文 ${Buffer.byteLength(upstreamBody)} 字节`,
    {
      method: "POST",
      url: target,
      headers: sanitizeLogValue(upstreamHeaders),
      body: {
        model: moonshot.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: sanitizeLogValue(image) } }
            ]
          }
        ],
        temperature: requestBody.temperature,
        thinking: requestBody.thinking || { type: "enabled_by_default" },
        stream: requestBody.stream
      }
    }
  );

  try {
    const fetchStartedAt = Date.now();
    appendServerLog(`[element-extract][${requestId}] 开始请求 Moonshot：${moonshot.baseUrl}/chat/completions`);
    publishElementTrace(requestId, "moonshot_request_sent", "Moonshot POST 请求已发送，等待 SSE 响应头，超时上限 180 秒");
    const upstream = await fetch(target, {
      method: "POST",
      headers: upstreamHeaders,
      body: upstreamBody,
      signal: AbortSignal.timeout(180000)
    });
    const upstreamResponseHeaders = headersToLogObject(upstream.headers);
    publishElementTrace(
      requestId,
      "moonshot_response_headers",
      `收到 Moonshot HTTP ${upstream.status} 响应头`,
      sanitizeLogValue(upstreamResponseHeaders)
    );
    if (!upstream.ok) {
      const errorRaw = await upstream.text();
      appendServerLog(
        `[element-extract][${requestId}] MOONSHOT HTTP RESPONSE\nStatus: ${upstream.status} ${upstream.statusText}\nHeaders:\n${JSON.stringify(sanitizeLogValue(upstreamResponseHeaders), null, 2)}\nBody:\n${responseTextForLog(errorRaw)}\n正文: ${Buffer.byteLength(errorRaw)} 字节 / 耗时: ${Date.now() - fetchStartedAt}ms`
      );
      appendServerLog(`[element-extract][${requestId}] Moonshot 返回失败状态 HTTP ${upstream.status}`);
      publishElementTrace(requestId, "moonshot_response_error", `Moonshot 返回 HTTP ${upstream.status}`);
      return sendJson(res, upstream.status, {
        error: { message: errorRaw.slice(0, 1200), type: "moonshot_upstream_error" },
        requestId,
        elapsedMs: Date.now() - requestStartedAt
      });
    }
    const contentType = upstream.headers.get("content-type") || "";
    let content = "";
    let safeResponseText = "";
    if (contentType.toLowerCase().includes("text/event-stream")) {
      const streamResult = await readMoonshotSseResponse(upstream, requestId);
      content = streamResult.content;
      safeResponseText = streamResult.safeResponseText;
    } else {
      const raw = await upstream.text();
      safeResponseText = responseTextForLog(raw);
      const response = JSON.parse(raw);
      appendServerLog(`[element-extract][${requestId}] Moonshot 使用非 SSE 响应，外层 JSON 解析完成`);
      content = response && response.choices && response.choices[0] &&
        response.choices[0].message && response.choices[0].message.content;
      publishElementTrace(requestId, "moonshot_non_stream_response", "Moonshot 返回非 SSE 响应，已按普通 JSON 处理");
    }
    appendServerLog(
      `[element-extract][${requestId}] MOONSHOT HTTP RESPONSE\nStatus: ${upstream.status} ${upstream.statusText}\nHeaders:\n${JSON.stringify(sanitizeLogValue(upstreamResponseHeaders), null, 2)}\nBody:\n${safeResponseText}\n耗时: ${Date.now() - fetchStartedAt}ms`
    );
    if (!content) throw new Error("Moonshot 未返回元素提取结果");
    appendServerLog(`[element-extract][${requestId}] 模型内容已取得：${String(content).length} 字符，开始解析结构化结果`);
    publishElementTrace(requestId, "result_parse_started", `公开答案接收完成，共 ${String(content).length} 字符，开始解析 JSON`);
    const parsed = parseElementModelJson(content);
    appendServerLog(`[element-extract][${requestId}] 模型结构化 JSON 解析完成`);
    const items = normalizeElementItems(parsed && parsed.items);
    const elapsedMs = Date.now() - requestStartedAt;
    publishElementTrace(
      requestId,
      "moonshot_final_json",
      "Moonshot 最终 JSON",
      { items }
    );
    appendServerLog(
      `[element-extract][${requestId}] 结果规范化完成：返回 ${items.length} 条，总耗时 ${elapsedMs}ms`
    );
    publishElementTrace(
      requestId,
      "result_complete",
      `结果处理完成：${items.length} 条，总耗时 ${elapsedMs}ms`
    );
    return sendJson(res, 200, { ok: true, items, model: moonshot.model, requestId, elapsedMs });
  } catch (error) {
    const elapsedMs = Date.now() - requestStartedAt;
    appendServerLog(
      `[element-extract][${requestId}] 请求失败：${error.name || "Error"} ${error.message}，总耗时 ${elapsedMs}ms`
    );
    publishElementTrace(requestId, "request_failed", `${error.name || "Error"}：${error.message}`);
    return sendJson(res, 502, {
      error: { message: error.message, type: error.name || "MoonshotElementExtractionError" },
      requestId,
      elapsedMs
    });
  }
}

async function proxyImageDownload(req, res, url) {
  const remoteUrl = url.searchParams.get("url") || "";
  let parsed;
  try { parsed = new URL(remoteUrl); }
  catch { return sendJson(res, 400, { error: { message: "proxy-image 缺少合法 url", type: "bad_url" } }); }
  if (!["http:", "https:"].includes(parsed.protocol)) return sendJson(res, 400, { error: { message: "只允许代理 http/https 图片" } });
  try {
    const upstream = await fetch(parsed.href, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Referer": `${parsed.origin}/`
      }
    });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok) return send(res, upstream.status, body, { "Content-Type": contentType });
    if (!/^image\//i.test(contentType)) {
      return sendJson(res, 502, { error: { message: `远程地址返回的不是图片：${contentType} | ${body.toString("utf8", 0, 300)}`, type: "not_image_response" } });
    }
    return send(res, 200, body, { "Content-Type": contentType, "X-Proxy-Image-Target": parsed.origin });
  } catch (error) {
    return sendJson(res, 502, { error: { message: error.message, type: error.name || "ProxyFetchError" }, proxy: { target: remoteUrl } });
  }
}

function extractGoogleTranslateText(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";
  return payload[0].map((part) => Array.isArray(part) ? String(part[0] || "") : "").join("").trim();
}

async function proxyTranslateListing(req, res) {
  let payload;
  try { payload = await readJsonBody(req); }
  catch (error) { return sendJson(res, 400, { error: { message: error.message, type: "bad_json" } }); }
  const text = String(payload.text || "").trim();
  if (!text) return sendJson(res, 400, { error: { message: "缺少 text", type: "missing_text" } });
  const target = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
    const raw = await upstream.text();
    if (!upstream.ok) return send(res, upstream.status, raw, { "Content-Type": "text/plain; charset=utf-8" });
    const translated = extractGoogleTranslateText(JSON.parse(raw));
    if (!translated) throw new Error("Google Translate 没有返回文本");
    return sendJson(res, 200, { ok: true, provider: "google", text: translated });
  } catch (error) {
    return sendJson(res, 502, { error: { message: error.message, type: error.name || "GoogleTranslateFetchError" } });
  }
}

async function handleConfig(req, res) {
  if (req.method === "GET") return sendJson(res, 200, publicConfig());
  try {
    const config = replaceConfig(await readJsonBody(req, 512 * 1024));
    appendServerLog("runtime/config.json updated from UI");
    return sendJson(res, 200, publicConfig(config));
  } catch (error) {
    return sendJson(res, 400, { error: { message: error.message, type: "config_error" } });
  }
}

async function handleIntake(req, res, batch) {
  try {
    const payload = await readJsonBody(req, 10 * 1024 * 1024);
    const result = batch ? intake.acceptBatch(Array.isArray(payload) ? payload : payload.items) : intake.accept(payload);
    return sendJson(res, 200, batch ? result : { ok: result.status !== "invalid", ...result });
  } catch (error) {
    return sendJson(res, 400, { error: { message: error.message, type: "intake_error" } });
  }
}

async function retryIntake(req, res) {
  try {
    const payload = await readJsonBody(req, 128 * 1024);
    const ok = intake.retry(payload.id);
    return sendJson(res, ok ? 200 : 404, { ok, error: ok ? undefined : { message: "任务不存在或没有 imageurl" } });
  } catch (error) {
    return sendJson(res, 400, { error: { message: error.message } });
  }
}

function serveHtml(res) {
  fs.readFile(path.join(ROOT, "app", "index.html"), (error, data) => {
    if (error) return sendJson(res, 404, { error: { message: "找不到 app/index.html", type: "not_found" } });
    return send(res, 200, data, { "Content-Type": "text/html; charset=utf-8" });
  });
}

// 从 app 目录发送元素提取模块脚本。
function serveElementExtractionScript(res) {
  try {
    const data = fs.readFileSync(path.join(ROOT, "app", "element-extraction.js"));
    return send(res, 200, data, { "Content-Type": "text/javascript; charset=utf-8" });
  } catch (error) {
    return sendJson(res, 404, { error: { message: "找不到元素提取模块脚本", type: "not_found" } });
  }
}

const startupConfig = getConfig();
const host = startupConfig.shared.server.host;
const port = startupConfig.shared.server.port;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/beecode-image-batch.html")) return serveHtml(res);
  if (req.method === "GET" && url.pathname === "/app/element-extraction.js") return serveElementExtractionScript(res);
  if ((req.method === "GET" || req.method === "POST") && ["/config", "/api/config"].includes(url.pathname)) return handleConfig(req, res);
  if (req.method === "GET" && ["/health", "/api/health"].includes(url.pathname)) return sendJson(res, 200, publicConfig());
  if (req.method === "GET" && url.pathname === "/api/events") return sse.connect(req, res);
  if (req.method === "POST" && url.pathname === "/api/intake") return handleIntake(req, res, false);
  if (req.method === "POST" && url.pathname === "/api/intake/batch") return handleIntake(req, res, true);
  if (req.method === "POST" && url.pathname === "/api/intake/retry") return retryIntake(req, res);
  if (req.method === "GET" && url.pathname === "/proxy-image") return proxyImageDownload(req, res, url);
  if (req.method === "POST" && url.pathname === "/translate-listing") return proxyTranslateListing(req, res);
  if (req.method === "POST" && url.pathname === "/api/infringement-check") return checkInfringement(req, res);
  if (req.method === "POST" && url.pathname === "/api/element-extract") return extractElements(req, res);
  if (req.method === "GET" && ["/cache/tasks", "/api/tasks"].includes(url.pathname)) return sendJson(res, 200, store.list().map(store.publicTask));
  if (req.method === "POST" && url.pathname === "/cache/input") return cacheInput(req, res);
  if (req.method === "POST" && url.pathname === "/cache/output") return cacheOutput(req, res);
  if (req.method === "DELETE" && url.pathname === "/cache/task") return deleteTask(res, url);
  if (req.method === "DELETE" && url.pathname === "/cache/tasks") return clearTasks(res);
  const inputMatch = url.pathname.match(/^\/cache\/input\/([^/]+)$/);
  if (req.method === "GET" && inputMatch) return sendCachedFile(res, "input", decodeURIComponent(inputMatch[1]), url);
  const outputMatch = url.pathname.match(/^\/cache\/output\/([^/]+)$/);
  if (req.method === "GET" && outputMatch) return sendCachedFile(res, "output", decodeURIComponent(outputMatch[1]), url);
  if (req.method === "POST" && url.pathname === "/v1/images/edits") return proxyImageEdit(req, res);
  return sendJson(res, 404, { error: { message: "Not found", type: "not_found" } });
});

server.on("error", (error) => {
  appendServerLog(`server error: ${error.stack || error.message}`);
  console.error(error);
});

server.listen(port, host, () => {
  appendServerLog(`started on http://${host}:${port}`);
  console.log(`POD server: http://${host}:${port}/`);
  console.log(`Runtime: ${RUNTIME_ROOT}`);
});
