const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { RUNTIME_ROOT, atomicWriteJson } = require("./config");

const TASKS_PATH = path.join(RUNTIME_ROOT, "tasks.json");
const CACHE_ROOT = path.join(RUNTIME_ROOT, "cache");
const INPUT_DIR = path.join(CACHE_ROOT, "input");
const OUTPUT_DIR = path.join(CACHE_ROOT, "output");
// 侵权拼图与任务图统一放在 cache 下，清空 Cache 时一并删除。
const CHECK_DIR = path.join(CACHE_ROOT, "check");

// 将旧版 runtime/test/check 拼图迁移到 runtime/cache/check。
function migrateLegacyCheckDir() {
  const legacyDir = path.join(RUNTIME_ROOT, "test", "check");
  if (!fs.existsSync(legacyDir) || path.resolve(legacyDir) === path.resolve(CHECK_DIR)) return;
  try {
    const entries = fs.readdirSync(legacyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const from = path.join(legacyDir, entry.name);
      const to = path.join(CHECK_DIR, entry.name);
      if (fs.existsSync(to)) {
        fs.rmSync(from, { force: true });
        continue;
      }
      try {
        fs.renameSync(from, to);
      } catch {
        try {
          fs.copyFileSync(from, to);
          fs.rmSync(from, { force: true });
        } catch {
          // 单文件失败不阻断启动。
        }
      }
    }
  } catch {
    // ignore
  }
}

// 创建任务和图片缓存所需的运行时目录。
function ensureRuntime() {
  fs.mkdirSync(INPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CHECK_DIR, { recursive: true });
  migrateLegacyCheckDir();
  if (!fs.existsSync(TASKS_PATH)) atomicWriteJson(TASKS_PATH, []);
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function parsePrompt(value) {
  return String(value || "").slice(0, 20000);
}

function normalizeLogs(value) {
  return Array.isArray(value) ? value.slice(0, 80).map((entry) => String(entry)) : [];
}

// 生成绑定实际缓存文件版本和可选图片索引的稳定 URL。
function taskUrl(kind, task, index) {
  let filePath = task.inputFile || "";
  if (kind === "output") {
    const outputFiles = outputFilesForTask(task);
    filePath = outputFiles[index || 0] || "";
  }
  const stamp = encodeURIComponent(path.basename(filePath) || task.createdAt || "");
  const indexQuery = Number.isInteger(index) ? `index=${index}&` : "";
  return `/cache/${kind}/${encodeURIComponent(task.id)}?${indexQuery}t=${stamp}`;
}

// 将新旧任务格式统一为输出文件数组。
function outputFilesForTask(task) {
  if (Array.isArray(task.outputFiles) && task.outputFiles.length) return task.outputFiles;
  return task.outputFile ? [task.outputFile] : [];
}

// 将新旧任务格式统一为输出类型数组。
function outputTypesForTask(task, count) {
  const types = Array.isArray(task.outputTypes) ? task.outputTypes : [];
  const normalized = [];
  for (let index = 0; index < count; index += 1) {
    normalized.push(types[index] || task.outputType || "image/png");
  }
  return normalized;
}

// 将内部任务转换为浏览器可安全消费的公开结构。
function publicTask(task) {
  const outputFiles = outputFilesForTask(task);
  const outputTypes = outputTypesForTask(task, outputFiles.length);
  const outputUrls = [];
  for (let index = 0; index < outputFiles.length; index += 1) {
    outputUrls.push(taskUrl("output", task, index));
  }
  return {
    id: task.id,
    fileName: task.fileName || "image",
    sourceCode: task.sourceCode || "",
    displayCode: task.displayCode || "",
    listing: String(task.listing || ""),
    imageurl: task.imageurl || task.sourceUrl || "",
    sourceUrl: task.sourceUrl || task.imageurl || "",
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    status: task.status || "queued",
    message: task.message || "等待生成",
    prompt: parsePrompt(task.prompt),
    errorLog: task.errorLog || "",
    logs: normalizeLogs(task.logs),
    retryCount: Number(task.retryCount || 0),
    retryAt: Number(task.retryAt || 0),
    requestedOutputCount: Math.max(1, Math.floor(Number(task.requestedOutputCount || outputFiles.length || 1))),
    inputUrl: task.inputFile ? taskUrl("input", task) : "",
    outputUrl: outputUrls[0] || "",
    outputUrls,
    inputType: task.inputType || "image/jpeg",
    outputType: outputTypes[0] || "image/png",
    outputTypes
  };
}

ensureRuntime();

let tasks;
try {
  const parsed = JSON.parse(fs.readFileSync(TASKS_PATH, "utf8"));
  tasks = Array.isArray(parsed) ? parsed : [];
} catch {
  tasks = [];
}

function nextFallbackDisplayCode() {
  const max = tasks.reduce((current, task) => {
    const match = String(task.displayCode || "").match(/^A-(\d+)$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `A-${max + 1}`;
}

let displayCodeUpdated = false;
for (const task of tasks) {
  if (!String(task.displayCode || "").trim()) {
    task.displayCode = nextFallbackDisplayCode();
    displayCodeUpdated = true;
  }
}

const events = new EventEmitter();

function persist() {
  atomicWriteJson(TASKS_PATH, tasks);
}

if (displayCodeUpdated) persist();

function list() {
  return tasks;
}

function findById(id) {
  const cleanId = safeId(id);
  return tasks.find((task) => task.id === cleanId);
}

function findByImageUrl(imageurl) {
  const target = String(imageurl || "").trim();
  if (!target) return undefined;
  return tasks.find((task) => String(task.imageurl || task.sourceUrl || "").trim() === target);
}

function upsert(update, eventName = "task.updated") {
  const id = safeId(update && update.id);
  if (!id) throw new Error("任务缺少合法 id");
  const index = tasks.findIndex((task) => task.id === id);
  const next = {
    ...(index >= 0 ? tasks[index] : {}),
    ...update,
    id,
    prompt: parsePrompt(update.prompt !== undefined ? update.prompt : (index >= 0 ? tasks[index].prompt : "")),
    logs: normalizeLogs(update.logs !== undefined ? update.logs : (index >= 0 ? tasks[index].logs : [])),
    updatedAt: new Date().toISOString()
  };
  if (!next.createdAt) next.createdAt = new Date().toLocaleString("zh-CN", { hour12: false });
  if (!String(next.displayCode || "").trim()) next.displayCode = nextFallbackDisplayCode();
  if (index >= 0) tasks[index] = next;
  else tasks.push(next);
  persist();
  events.emit(eventName, publicTask(next));
  return next;
}

function remove(id) {
  const cleanId = safeId(id);
  const index = tasks.findIndex((task) => task.id === cleanId);
  if (index < 0) return undefined;
  const [removed] = tasks.splice(index, 1);
  persist();
  events.emit("task.deleted", { id: cleanId });
  return removed;
}

function clear() {
  tasks = [];
  persist();
  events.emit("tasks.cleared", { ok: true });
}

function isInsideCache(filePath) {
  if (!filePath) return false;
  const root = `${path.resolve(CACHE_ROOT)}${path.sep}`.toLowerCase();
  return path.resolve(filePath).toLowerCase().startsWith(root);
}

function removeFile(filePath) {
  if (isInsideCache(filePath)) fs.rmSync(filePath, { force: true });
}

// 清空目录内全部文件/子目录，保留目录本身；返回删除条数。
function emptyDirectory(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let removed = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed += 1;
    } catch {
      // 单个文件失败不阻断整次清空。
    }
  }
  return removed;
}

// 清空整个 runtime/cache（input/output/check 及任意子目录/孤儿文件）。
function clearAllCacheFiles() {
  ensureRuntime();
  let removed = 0;
  try {
    const entries = fs.readdirSync(CACHE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(CACHE_ROOT, entry.name);
      if (!isInsideCache(fullPath)) continue;
      try {
        if (entry.isDirectory()) {
          removed += emptyDirectory(fullPath);
        } else {
          fs.rmSync(fullPath, { force: true });
          removed += 1;
        }
      } catch {
        // 单个路径失败不阻断整次清空。
      }
    }
  } catch {
    // ignore
  }
  // 清空后重建标准子目录，保证后续写入可用。
  ensureRuntime();
  return removed;
}

module.exports = {
  TASKS_PATH,
  CACHE_ROOT,
  INPUT_DIR,
  OUTPUT_DIR,
  CHECK_DIR,
  events,
  ensureRuntime,
  safeId,
  list,
  findById,
  findByImageUrl,
  upsert,
  remove,
  clear,
  isInsideCache,
  removeFile,
  emptyDirectory,
  clearAllCacheFiles,
  publicTask,
  outputFilesForTask,
  outputTypesForTask
};
