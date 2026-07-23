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

function appendServerLog(message) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    const file = parsed.files.output;
    if (file && file.data.length) {
      const ext = extFromNameOrType(file.filename || "output.png", file.contentType || "image/png");
      const outputFile = path.join(store.OUTPUT_DIR, `${id}${ext}`);
      for (const oldName of fs.readdirSync(store.OUTPUT_DIR)) {
        if (oldName.startsWith(`${id}.`)) store.removeFile(path.join(store.OUTPUT_DIR, oldName));
      }
      fs.writeFileSync(outputFile, file.data);
      update.outputFile = outputFile;
      update.outputType = file.contentType || "image/png";
    }
    return sendJson(res, 200, store.publicTask(store.upsert(update)));
  } catch (error) {
    appendServerLog(`cache output failed: ${error.message}`);
    return sendJson(res, 500, { error: { message: error.message } });
  }
}

function sendCachedFile(res, kind, id) {
  const task = store.findById(id);
  if (!task) return sendJson(res, 404, { error: { message: "缓存任务不存在" } });
  const filePath = kind === "input" ? task.inputFile : task.outputFile;
  const type = kind === "input" ? task.inputType : task.outputType;
  if (!filePath || !fs.existsSync(filePath)) return sendJson(res, 404, { error: { message: "缓存文件不存在" } });
  return send(res, 200, fs.readFileSync(filePath), { "Content-Type": type || "application/octet-stream" });
}

function deleteTask(res, url) {
  const id = store.safeId(url.searchParams.get("id"));
  if (!id) return sendJson(res, 400, { error: { message: "缺少 id" } });
  const task = store.remove(id);
  if (task) {
    store.removeFile(task.inputFile);
    store.removeFile(task.outputFile);
  }
  return sendJson(res, 200, { ok: true });
}

function clearTasks(res) {
  for (const task of store.list()) {
    store.removeFile(task.inputFile);
    store.removeFile(task.outputFile);
  }
  store.clear();
  return sendJson(res, 200, { ok: true });
}

async function proxyImageEdit(req, res) {
  const config = getConfig().imageApi;
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

async function checkInfringement(req, res) {
  const config = getConfig().moonshot;
  if (!config.apiKey) {
    return sendJson(res, 500, { error: { message: "runtime/config.json 未配置 Moonshot API Key", type: "moonshot_config_error" } });
  }
  let payload;
  try { payload = await readJsonBody(req, 35 * 1024 * 1024); }
  catch (error) { return sendJson(res, 400, { error: { message: error.message, type: "bad_json" } }); }
  const image = String(payload.image || "");
  if (!/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) {
    return sendJson(res, 400, { error: { message: "缺少合法的合并图片", type: "invalid_image" } });
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
    if (!upstream.ok) return send(res, upstream.status, raw, { "Content-Type": "application/json; charset=utf-8" });
    const response = JSON.parse(raw);
    const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
    if (!content) throw new Error("Moonshot 未返回审核结果");
    const result = JSON.parse(content);
    return sendJson(res, 200, { ok: true, items: normalizeInfringementItems(result.items) });
  } catch (error) {
    appendServerLog(`Moonshot infringement check failed: ${error.message}`);
    return sendJson(res, 502, { error: { message: error.message, type: error.name || "MoonshotProxyError" } });
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

const startupConfig = getConfig();
const host = startupConfig.server.host;
const port = startupConfig.server.port;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/beecode-image-batch.html")) return serveHtml(res);
  if ((req.method === "GET" || req.method === "POST") && ["/config", "/api/config"].includes(url.pathname)) return handleConfig(req, res);
  if (req.method === "GET" && ["/health", "/api/health"].includes(url.pathname)) return sendJson(res, 200, publicConfig());
  if (req.method === "GET" && url.pathname === "/api/events") return sse.connect(req, res);
  if (req.method === "POST" && url.pathname === "/api/intake") return handleIntake(req, res, false);
  if (req.method === "POST" && url.pathname === "/api/intake/batch") return handleIntake(req, res, true);
  if (req.method === "POST" && url.pathname === "/api/intake/retry") return retryIntake(req, res);
  if (req.method === "GET" && url.pathname === "/proxy-image") return proxyImageDownload(req, res, url);
  if (req.method === "POST" && url.pathname === "/translate-listing") return proxyTranslateListing(req, res);
  if (req.method === "POST" && url.pathname === "/api/infringement-check") return checkInfringement(req, res);
  if (req.method === "GET" && ["/cache/tasks", "/api/tasks"].includes(url.pathname)) return sendJson(res, 200, store.list().map(store.publicTask));
  if (req.method === "POST" && url.pathname === "/cache/input") return cacheInput(req, res);
  if (req.method === "POST" && url.pathname === "/cache/output") return cacheOutput(req, res);
  if (req.method === "DELETE" && url.pathname === "/cache/task") return deleteTask(res, url);
  if (req.method === "DELETE" && url.pathname === "/cache/tasks") return clearTasks(res);
  const inputMatch = url.pathname.match(/^\/cache\/input\/([^/]+)$/);
  if (req.method === "GET" && inputMatch) return sendCachedFile(res, "input", decodeURIComponent(inputMatch[1]));
  const outputMatch = url.pathname.match(/^\/cache\/output\/([^/]+)$/);
  if (req.method === "GET" && outputMatch) return sendCachedFile(res, "output", decodeURIComponent(outputMatch[1]));
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
