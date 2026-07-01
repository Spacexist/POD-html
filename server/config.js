const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = path.join(ROOT, "runtime");
const CONFIG_PATH = path.join(RUNTIME_ROOT, "config.json");

const DEFAULT_CONFIG = {
  beecode: {
    apiKey: "",
    baseUrl: "https://beecode.cc",
    model: "gpt-image-2",
    size: "1024x1024",
    concurrency: 3
  },
  server: {
    host: "127.0.0.1",
    port: 8787
  }
};

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeConfig(input = {}) {
  const beecode = input.beecode || input;
  const server = input.server || {};
  const apiKey = String(
    beecode.apiKey ||
    beecode.OPENAI_API_KEY ||
    (beecode.env && beecode.env.OPENAI_API_KEY) ||
    ""
  ).trim();

  return {
    beecode: {
      apiKey,
      baseUrl: String(beecode.baseUrl || beecode.OPENAI_BASE_URL || DEFAULT_CONFIG.beecode.baseUrl)
        .trim()
        .replace(/\/+$/, ""),
      model: String(beecode.model || DEFAULT_CONFIG.beecode.model).trim(),
      size: String(beecode.size || DEFAULT_CONFIG.beecode.size).trim(),
      concurrency: Math.max(1, Math.floor(Number(beecode.concurrency || DEFAULT_CONFIG.beecode.concurrency)))
    },
    server: {
      host: String(server.host || DEFAULT_CONFIG.server.host).trim(),
      port: Math.max(1, Math.min(65535, Math.floor(Number(server.port || DEFAULT_CONFIG.server.port))))
    }
  };
}

function loadInitialConfig() {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    atomicWriteJson(CONFIG_PATH, DEFAULT_CONFIG);
    return normalizeConfig(DEFAULT_CONFIG);
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return normalizeConfig(parsed);
}

let currentConfig = loadInitialConfig();

function getConfig() {
  return currentConfig;
}

function replaceConfig(input) {
  const next = normalizeConfig(input);
  if (!next.beecode.apiKey) {
    throw new Error("配置缺少 beecode.apiKey / apiKey / OPENAI_API_KEY");
  }
  atomicWriteJson(CONFIG_PATH, next);
  currentConfig = next;
  return currentConfig;
}

function maskKey(apiKey) {
  if (!apiKey) return "未配置";
  return `${apiKey.slice(0, 3)}...${apiKey.slice(-6)}`;
}

function publicConfig(config = currentConfig) {
  const beecode = config.beecode;
  return {
    ok: true,
    hasKey: Boolean(beecode.apiKey),
    key: maskKey(beecode.apiKey),
    keySource: "runtime/config.json",
    baseUrl: beecode.baseUrl,
    target: `${beecode.baseUrl}/v1/images/edits`,
    model: beecode.model,
    size: beecode.size,
    concurrency: beecode.concurrency,
    configPath: CONFIG_PATH,
    cache: path.join(RUNTIME_ROOT, "cache")
  };
}

module.exports = {
  ROOT,
  RUNTIME_ROOT,
  CONFIG_PATH,
  getConfig,
  replaceConfig,
  publicConfig,
  atomicWriteJson
};
