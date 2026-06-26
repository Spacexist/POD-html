const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LOCAL_CONFIG_PATH = path.join(ROOT, "beecode.config.local.json");
const LEGACY_SETTINGS_PATH = path.join(ROOT, "claude-custom-beecode-image2.settings.json");
const CACHE_ROOT = path.join(ROOT, "beecode-cache");
const INPUT_DIR = path.join(CACHE_ROOT, "inputs");
const OUTPUT_DIR = path.join(CACHE_ROOT, "outputs");
const META_PATH = path.join(CACHE_ROOT, "tasks.json");
const HOST = "127.0.0.1";
const PORT = Number(process.env.BEECODE_PROXY_PORT || 8787);

function ensureCache() {
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(META_PATH)) fs.writeFileSync(META_PATH, "[]", "utf8");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function readLocalConfig() {
  return readJsonFile(LOCAL_CONFIG_PATH);
}

function readLegacySettings() {
  return readJsonFile(LEGACY_SETTINGS_PATH);
}

function normalizeConfig(input) {
  const env = input.env || {};
  return {
    apiKey: String(input.apiKey || input.OPENAI_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_AUTH_TOKEN || "").trim(),
    baseUrl: String(input.baseUrl || input.OPENAI_BASE_URL || env.OPENAI_BASE_URL || env.ANTHROPIC_BASE_URL || "https://beecode.cc").replace(/\/$/, ""),
    model: String(input.model || "gpt-image-2"),
    size: String(input.size || "1024x1024"),
    concurrency: Math.max(1, Number(input.concurrency || 3))
  };
}

function pickKey(local, legacy) {
  const legacyEnv = legacy.env || {};
  const candidates = [
    ["beecode.config.local.json", local.apiKey],
    ["process.env.BEECODE_API_KEY", process.env.BEECODE_API_KEY],
    ["legacy settings.env.OPENAI_API_KEY", legacyEnv.OPENAI_API_KEY],
    ["legacy settings.env.ANTHROPIC_AUTH_TOKEN", legacyEnv.ANTHROPIC_AUTH_TOKEN],
    ["process.env.OPENAI_API_KEY", process.env.OPENAI_API_KEY]
  ];
  for (const [source, value] of candidates) {
    if (value && String(value).trim()) return { apiKey: String(value).trim(), keySource: source };
  }
  return { apiKey: "", keySource: "none" };
}

function maskKey(apiKey) {
  if (!apiKey) return "未读取到";
  return `${apiKey.slice(0, 3)}...${apiKey.slice(-6)}`;
}

function getConfig() {
  const localRaw = readLocalConfig();
  const legacyRaw = readLegacySettings();
  const local = normalizeConfig(localRaw);
  const legacy = normalizeConfig(legacyRaw);
  const { apiKey, keySource } = pickKey(local, legacyRaw);
  const env = legacyRaw.env || {};
  const baseUrl = String(process.env.BEECODE_BASE_URL || local.baseUrl || env.OPENAI_BASE_URL || env.ANTHROPIC_BASE_URL || legacy.baseUrl || "https://beecode.cc").replace(/\/$/, "");
  const model = String(local.model || legacy.model || "gpt-image-2");
  const size = String(local.size || legacy.size || "1024x1024");
  const concurrency = Math.max(1, Number(local.concurrency || legacy.concurrency || 3));
  return {
    apiKey,
    keySource,
    maskedKey: maskKey(apiKey),
    hasKey: Boolean(apiKey),
    baseUrl,
    model,
    size,
    concurrency,
    configPath: fs.existsSync(LOCAL_CONFIG_PATH) ? LOCAL_CONFIG_PATH : ""
  };
}

function publicConfig(config = getConfig()) {
  return {
    ok: true,
    hasKey: config.hasKey,
    key: config.maskedKey,
    keySource: config.keySource,
    baseUrl: config.baseUrl,
    target: `${config.baseUrl}/v1/images/edits`,
    model: config.model,
    size: config.size,
    concurrency: config.concurrency,
    configPath: config.configPath,
    cache: CACHE_ROOT
  };
}

function writeLocalConfig(input) {
  const config = normalizeConfig(input || {});
  if (!config.apiKey) throw new Error("配置缺少 apiKey / OPENAI_API_KEY");
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return getConfig();
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
        reject(new Error("请求体超过 120MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readTasks() {
  ensureCache();
  try {
    const data = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  ensureCache();
  const tmp = `${META_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), "utf8");
  fs.renameSync(tmp, META_PATH);
}

function taskUrl(kind, id) {
  return `/cache/${kind}/${encodeURIComponent(id)}?t=${Date.now()}`;
}

function publicTask(task) {
  return {
    id: task.id,
    fileName: task.fileName,
    sourceCode: task.sourceCode || "",
    displayCode: task.displayCode || "",
    listing: String(task.listing || ""),
    createdAt: task.createdAt,
    status: task.status === "running" ? "queued" : task.status,
    message: task.status === "running" ? "等待生成" : task.message,
    prompt: parsePrompt(task.prompt),
    errorLog: task.errorLog || "",
    logs: Array.isArray(task.logs) ? task.logs : [],
    inputUrl: task.inputFile ? taskUrl("input", task.id) : "",
    outputUrl: task.outputFile ? taskUrl("output", task.id) : "",
    inputType: task.inputType || "image/png",
    outputType: task.outputType || "image/png"
  };
}

function upsertTask(update) {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === update.id);
  const next = { ...(index >= 0 ? tasks[index] : {}), ...update, updatedAt: new Date().toISOString() };
  if (index >= 0) tasks[index] = next;
  else tasks.push(next);
  writeTasks(tasks);
  return next;
}

function removeFileSafe(filePath) {
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const root = path.resolve(CACHE_ROOT);
  if (!resolved.startsWith(root)) return;
  fs.rmSync(resolved, { force: true });
}

function safeId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
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
  const match = String(contentType || "").match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i);
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
    let dataStart = headerEnd + 4;
    let next = buffer.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon > -1) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    parts.push({ name: disposition.name, filename: disposition.filename, contentType: headers["content-type"] || "", data: buffer.slice(dataStart, dataEnd) });
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
    const id = safeId(parsed.fields.id);
    if (!id || !file) return sendJson(res, 400, { error: { message: "缺少 id 或 image" } });
    const fileName = cleanFileName(file.filename || parsed.fields.fileName || "image");
    const ext = extFromNameOrType(fileName, file.contentType);
    const inputFile = path.join(INPUT_DIR, `${id}${ext}`);
    ensureCache();
    for (const old of fs.readdirSync(INPUT_DIR).filter((name) => name.startsWith(`${id}.`))) removeFileSafe(path.join(INPUT_DIR, old));
    fs.writeFileSync(inputFile, file.data);
    const task = upsertTask({
      id,
      fileName,
      createdAt: parsed.fields.createdAt || new Date().toLocaleString("zh-CN", { hour12: false }),
      status: parsed.fields.status || "queued",
      message: parsed.fields.message || "等待生成",
      prompt: parsePrompt(parsed.fields.prompt),
      sourceCode: parsed.fields.sourceCode || "",
      displayCode: parsed.fields.displayCode || "",
      listing: String(parsed.fields.listing || ""),
      errorLog: parsed.fields.errorLog || "",
      logs: parseLogs(parsed.fields.logs),
      inputFile,
      inputType: file.contentType || "image/jpeg"
    });
    sendJson(res, 200, publicTask(task));
  } catch (error) {
    sendJson(res, 500, { error: { message: error.message } });
  }
}

async function cacheOutput(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message } }); }

  try {
    const parsed = parseMultipart(body, req.headers["content-type"]);
    const id = safeId(parsed.fields.id);
    if (!id) return sendJson(res, 400, { error: { message: "缺少 id" } });
    const update = {
      id,
      status: parsed.fields.status || "queued",
      message: parsed.fields.message || "",
      prompt: parsePrompt(parsed.fields.prompt),
      sourceCode: parsed.fields.sourceCode || "",
      displayCode: parsed.fields.displayCode || "",
      listing: String(parsed.fields.listing || ""),
      errorLog: parsed.fields.errorLog || "",
      logs: parseLogs(parsed.fields.logs)
    };
    const file = parsed.files.output;
    if (file && file.data.length) {
      const ext = extFromNameOrType(file.filename || "output.png", file.contentType || "image/png");
      const outputFile = path.join(OUTPUT_DIR, `${id}${ext}`);
      ensureCache();
      for (const old of fs.readdirSync(OUTPUT_DIR).filter((name) => name.startsWith(`${id}.`))) removeFileSafe(path.join(OUTPUT_DIR, old));
      fs.writeFileSync(outputFile, file.data);
      update.outputFile = outputFile;
      update.outputType = file.contentType || "image/png";
    }
    const task = upsertTask(update);
    sendJson(res, 200, publicTask(task));
  } catch (error) {
    sendJson(res, 500, { error: { message: error.message } });
  }
}

function sendCachedFile(res, kind, id) {
  const task = readTasks().find((entry) => entry.id === safeId(id));
  if (!task) return sendJson(res, 404, { error: { message: "缓存任务不存在" } });
  const filePath = kind === "input" ? task.inputFile : task.outputFile;
  const type = kind === "input" ? task.inputType : task.outputType;
  if (!filePath || !fs.existsSync(filePath)) return sendJson(res, 404, { error: { message: "缓存文件不存在" } });
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": type || "application/octet-stream" });
}

function deleteTask(req, res, url) {
  const id = safeId(url.searchParams.get("id"));
  if (!id) return sendJson(res, 400, { error: { message: "缺少 id" } });
  const tasks = readTasks();
  const task = tasks.find((entry) => entry.id === id);
  if (task) {
    removeFileSafe(task.inputFile);
    removeFileSafe(task.outputFile);
  }
  writeTasks(tasks.filter((entry) => entry.id !== id));
  sendJson(res, 200, { ok: true });
}

function clearTasks(res) {
  ensureCache();
  fs.rmSync(INPUT_DIR, { recursive: true, force: true });
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  ensureCache();
  writeTasks([]);
  sendJson(res, 200, { ok: true });
}

async function proxyImageEdit(req, res) {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) {
    sendJson(res, 500, { error: { message: "本地代理没有读到 API Key，请点击页面左上角 配置文件 导入 beecode.config.local.json", type: "proxy_config_error" } });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 413, { error: { message: error.message, type: "proxy_body_error" } });
    return;
  }

  const target = `${baseUrl}/v1/images/edits`;
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": req.headers["content-type"] || "application/octet-stream"
      },
      body
    });
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, upstreamBody, {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "X-BeeCode-Target": target
    });
  } catch (error) {
    sendJson(res, 502, {
      error: {
        message: error && error.message ? error.message : String(error),
        type: error && error.name ? error.name : "ProxyFetchError"
      },
      proxy: { target }
    });
  }
}

async function proxyImageDownload(req, res, url) {
  const remoteUrl = url.searchParams.get("url") || "";
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    sendJson(res, 400, { error: { message: "proxy-image 缺少合法 url", type: "bad_url" } });
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    sendJson(res, 400, { error: { message: "只允许代理 http/https 图片", type: "bad_url" } });
    return;
  }
  try {
    const upstream = await fetch(parsed.href, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": `${parsed.origin}/`
      }
    });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await upstream.arrayBuffer());
    if (!upstream.ok) {
      send(res, upstream.status, body, {
        "Content-Type": contentType,
        "X-Proxy-Image-Target": parsed.origin
      });
      return;
    }
    if (!/^image\//i.test(contentType)) {
      const snippet = body.toString("utf8", 0, Math.min(body.length, 500));
      sendJson(res, 502, {
        error: {
          message: `远程地址返回的不是图片：${contentType} | ${snippet}`,
          type: "not_image_response"
        },
        proxy: { target: parsed.href }
      });
      return;
    }
    send(res, upstream.status, body, { "Content-Type": contentType, "X-Proxy-Image-Target": parsed.origin });
  } catch (error) {
    sendJson(res, 502, { error: { message: error.message, type: error.name || "ProxyFetchError" }, proxy: { target: parsed.href } });
  }
}


function extractGoogleTranslateText(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return "";
  return payload[0]
    .map((part) => Array.isArray(part) ? String(part[0] || "") : "")
    .join("")
    .trim();
}

async function proxyTranslateListing(req, res) {
  let body;
  try { body = await readBody(req, 2 * 1024 * 1024); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message, type: "translate_body_error" } }); }

  let payload;
  try { payload = JSON.parse(body.toString("utf8")); }
  catch { return sendJson(res, 400, { error: { message: "请求不是合法 JSON", type: "bad_json" } }); }

  const text = String(payload.text || "").trim();
  if (!text) return sendJson(res, 400, { error: { message: "缺少 text", type: "missing_text" } });

  const target = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const upstream = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
    const raw = await upstream.text();
    if (!upstream.ok) {
      send(res, upstream.status, raw, {
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "X-Translate-Target": "google"
      });
      return;
    }

    let data;
    try { data = JSON.parse(raw); }
    catch { return sendJson(res, 502, { error: { message: `Google Translate 返回不是 JSON：${raw.slice(0, 300)}`, type: "bad_google_json" } }); }

    const translated = extractGoogleTranslateText(data);
    if (!translated) return sendJson(res, 502, { error: { message: "Google Translate 没有返回文本", type: "empty_translation" }, raw: data });
    sendJson(res, 200, { ok: true, provider: "google", text: translated });
  } catch (error) {
    sendJson(res, 502, { error: { message: error.message, type: error.name || "GoogleTranslateFetchError" }, proxy: { target: "google_translate" } });
  }
}
async function handleConfig(req, res) {
  if (req.method === "GET") return sendJson(res, 200, publicConfig());
  let body;
  try { body = await readBody(req, 512 * 1024); }
  catch (error) { return sendJson(res, 413, { error: { message: error.message, type: "config_body_error" } }); }
  try {
    const config = writeLocalConfig(JSON.parse(body.toString("utf8")));
    return sendJson(res, 200, publicConfig(config));
  } catch (error) {
    return sendJson(res, 400, { error: { message: error.message, type: "config_error" } });
  }
}

function serveHtml(res) {
  const file = path.join(ROOT, "beecode-image-batch.html");
  fs.readFile(file, (error, data) => {
    if (error) return sendJson(res, 404, { error: { message: "找不到 beecode-image-batch.html", type: "not_found" } });
    send(res, 200, data, { "Content-Type": "text/html; charset=utf-8" });
  });
}

ensureCache();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === "OPTIONS") return send(res, 204, "");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/beecode-image-batch.html")) return serveHtml(res);
  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/config") return handleConfig(req, res);
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, publicConfig());
  if (req.method === "GET" && url.pathname === "/proxy-image") return proxyImageDownload(req, res, url);
  if (req.method === "POST" && url.pathname === "/translate-listing") return proxyTranslateListing(req, res);
  if (req.method === "GET" && url.pathname === "/cache/tasks") return sendJson(res, 200, readTasks().map(publicTask));
  if (req.method === "POST" && url.pathname === "/cache/input") return cacheInput(req, res);
  if (req.method === "POST" && url.pathname === "/cache/output") return cacheOutput(req, res);
  if (req.method === "DELETE" && url.pathname === "/cache/task") return deleteTask(req, res, url);
  if (req.method === "DELETE" && url.pathname === "/cache/tasks") return clearTasks(res);
  const inputMatch = url.pathname.match(/^\/cache\/input\/([^/]+)$/);
  if (req.method === "GET" && inputMatch) return sendCachedFile(res, "input", decodeURIComponent(inputMatch[1]));
  const outputMatch = url.pathname.match(/^\/cache\/output\/([^/]+)$/);
  if (req.method === "GET" && outputMatch) return sendCachedFile(res, "output", decodeURIComponent(outputMatch[1]));
  if (req.method === "POST" && url.pathname === "/v1/images/edits") return proxyImageEdit(req, res);
  sendJson(res, 404, { error: { message: "Not found", type: "not_found" } });
});

server.listen(PORT, HOST, () => {
  console.log(`BeeCode local proxy: http://${HOST}:${PORT}/beecode-image-batch.html`);
  console.log(`Cache folder: ${CACHE_ROOT}`);
});








