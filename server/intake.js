const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_CONCURRENCY = 10;
const RETRY_DELAY_MS = 3000;
const FETCH_TIMEOUT_MS = 45000;

function codeSuffix(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parts = text.split(/[_-]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

function cleanFileName(value, fallback = "image") {
  return (String(value || fallback).replace(/[\\/:*?"<>|]/g, "_").trim() || fallback).slice(0, 180);
}

function extensionFromUrl(url, contentType = "") {
  try {
    const match = new URL(url).pathname.match(/\.(png|jpe?g|webp)$/i);
    if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
  } catch {}
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  return ".jpg";
}

function contentTypeForExtension(ext) {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function logLine(message) {
  return `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`;
}

function appendLog(task, message) {
  return [logLine(message), ...(Array.isArray(task.logs) ? task.logs : [])].slice(0, 80);
}

function isRetryable(error) {
  const status = Number(error && error.status);
  return [502, 503, 504].includes(status) || error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";
}

function createIntake({ store }) {
  const queue = [];
  let running = 0;
  let queueGeneration = 0;

  // 判断当前缓存任务是否仍属于清空前未失效的队列批次。
  function isCurrentGeneration(generation) {
    return generation === queueGeneration;
  }

  async function fetchImage(imageurl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const parsed = new URL(imageurl);
      const response = await fetch(parsed.href, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
          "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "Referer": `${parsed.origin}/`
        }
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!/^image\//i.test(contentType)) throw new Error(`远程返回不是图片：${contentType || "unknown"}`);
      return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
    } finally {
      clearTimeout(timer);
    }
  }

  async function cacheQueuedTask(id, generation) {
    if (!isCurrentGeneration(generation)) return;
    let task = store.findById(id);
    if (!task || task.inputFile) return;
    task = store.upsert({
      id,
      message: "正在获取原图",
      logs: appendLog(task, "下载原图：开始")
    });

    let result;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!isCurrentGeneration(generation)) return;
      try {
        if (attempt > 0) {
          task = store.upsert({
            id,
            message: "3 秒后重试获取原图",
            logs: appendLog(task, "原图获取临时失败，3 秒后重试（仅一次）")
          });
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
        result = await fetchImage(task.imageurl || task.sourceUrl);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0 && isRetryable(error)) continue;
        break;
      }
    }

    if (!isCurrentGeneration(generation)) return;
    if (!result) {
      store.upsert({
        id,
        status: "queued",
        message: "缓存原图失败，可重新获取",
        errorLog: lastError && lastError.message ? lastError.message : String(lastError),
        logs: appendLog(task, `缓存原图失败：${lastError && lastError.message ? lastError.message : lastError}`)
      });
      return;
    }

    const ext = extensionFromUrl(task.imageurl || task.sourceUrl, result.contentType);
    const previousInputFile = task.inputFile;
    const inputFile = path.join(store.INPUT_DIR, `${id}${ext}`);
    // 只清理本任务旧输入文件，避免整目录 readdir 扫描。
    if (previousInputFile && previousInputFile !== inputFile) store.removeFile(previousInputFile);
    fs.writeFileSync(inputFile, result.buffer);
    if (!isCurrentGeneration(generation)) {
      store.removeFile(inputFile);
      return;
    }
    store.upsert({
      id,
      fileName: `${cleanFileName(task.sourceCode || task.listing || id)}${ext}`,
      inputFile,
      inputType: result.contentType || contentTypeForExtension(ext),
      status: "queued",
      message: "等待生成",
      errorLog: "",
      logs: appendLog(task, `原图缓存完成：${(result.buffer.length / 1024).toFixed(1)} KB`)
    });
  }

  function pump() {
    while (running < MAX_CONCURRENCY && queue.length) {
      const id = queue.shift();
      const generation = queueGeneration;
      running += 1;
      cacheQueuedTask(id, generation)
        .catch((error) => {
          if (!isCurrentGeneration(generation)) return;
          const task = store.findById(id);
          if (task) {
            store.upsert({
              id,
              status: "queued",
              message: "缓存原图失败，可重新获取",
              errorLog: error.message,
              logs: appendLog(task, `缓存原图异常：${error.message}`)
            });
          }
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }

  function enqueue(id) {
    if (!queue.includes(id)) queue.push(id);
    pump();
  }

  // 清空尚未处理的远程图片缓存队列，并使所有在途下载结果失效。
  function clear() {
    queueGeneration += 1;
    queue.length = 0;
  }

  function normalizeItem(input) {
    const imageurl = String(input && (input.imageurl || input.imageUrl || input.image_url || input.url) || "").trim();
    if (!/^https?:\/\//i.test(imageurl)) return null;
    const sourceCode = String(input["编号"] || input.sourceCode || input.code || input.sku || "").trim();
    return {
      imageurl,
      sourceCode,
      displayCode: String(input.displayCode || codeSuffix(sourceCode)),
      listing: String(input.listing || input.title || "").trim()
    };
  }

  function accept(input) {
    const item = normalizeItem(input);
    if (!item) return { status: "invalid" };
    const duplicate = store.findByImageUrl(item.imageurl);
    if (duplicate) return { status: "duplicate", task: store.publicTask(duplicate) };

    const id = crypto.randomUUID();
    const task = store.upsert({
      id,
      sourceCode: item.sourceCode,
      displayCode: item.displayCode,
      listing: item.listing,
      imageurl: item.imageurl,
      sourceUrl: item.imageurl,
      fileName: `${cleanFileName(item.sourceCode || item.listing || id)}${extensionFromUrl(item.imageurl)}`,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      status: "queued",
      message: "等待缓存原图",
      prompt: "",
      errorLog: "",
      retryCount: 0,
      retryAt: 0,
      logs: [logLine("POD 导入：已接收，等待缓存原图")]
    }, "task.created");
    enqueue(id);
    return { status: "accepted", task: store.publicTask(task) };
  }

  function acceptBatch(items) {
    const results = [];
    for (const item of Array.isArray(items) ? items : []) results.push(accept(item));
    return {
      ok: true,
      accepted: results.filter((result) => result.status === "accepted").length,
      duplicates: results.filter((result) => result.status === "duplicate").length,
      invalid: results.filter((result) => result.status === "invalid").length,
      results
    };
  }

  function retry(id) {
    const task = store.findById(id);
    if (!task || !(task.imageurl || task.sourceUrl)) return false;
    // 重新获取必须清空已有 inputFile，否则 cacheQueuedTask 会直接跳过。
    if (task.inputFile) store.removeFile(task.inputFile);
    store.upsert({
      id: task.id,
      inputFile: "",
      inputType: "",
      status: "queued",
      message: "等待缓存原图",
      errorLog: "",
      logs: appendLog(task, "重新获取：已清空旧原图缓存，重新下载")
    });
    enqueue(task.id);
    return true;
  }

  return { accept, acceptBatch, retry, clear };
}

module.exports = { createIntake };
