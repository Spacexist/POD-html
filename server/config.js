const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = path.join(ROOT, "runtime");
const CONFIG_PATH = path.join(RUNTIME_ROOT, "config.json");

const DEFAULT_CONFIG = {
  imageApi: {
    apiKey: "",
    baseUrl: "https://beecode.cc",
    endpoint: "/v1/images/edits",
    model: "gpt-image-2",
    size: "1024x1024",
    concurrency: 3
  },
  moonshot: {
    apiKey: "",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.6"
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

function normalizeEndpoint(value) {
  const endpoint = String(value || DEFAULT_CONFIG.imageApi.endpoint).trim();
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function normalizeConfig(input = {}) {
  const imageApi = input.imageApi || input.beecode || input;
  const moonshot = input.moonshot || {};
  const server = input.server || {};
  const apiKey = String(
    imageApi.apiKey ||
    imageApi.OPENAI_API_KEY ||
    (imageApi.env && imageApi.env.OPENAI_API_KEY) ||
    ""
  ).trim();

  return {
    imageApi: {
      apiKey,
      baseUrl: String(imageApi.baseUrl || imageApi.OPENAI_BASE_URL || DEFAULT_CONFIG.imageApi.baseUrl)
        .trim()
        .replace(/\/+$/, ""),
      endpoint: normalizeEndpoint(imageApi.endpoint),
      model: String(imageApi.model || DEFAULT_CONFIG.imageApi.model).trim(),
      size: String(imageApi.size || DEFAULT_CONFIG.imageApi.size).trim(),
      concurrency: Math.max(1, Math.floor(Number(imageApi.concurrency || DEFAULT_CONFIG.imageApi.concurrency)))
    },
    moonshot: {
      apiKey: String(moonshot.apiKey || moonshot.MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || "").trim(),
      baseUrl: String(moonshot.baseUrl || DEFAULT_CONFIG.moonshot.baseUrl).trim().replace(/\/+$/, ""),
      model: String(moonshot.model || DEFAULT_CONFIG.moonshot.model).trim()
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
  if (!next.imageApi.apiKey) {
    throw new Error("配置缺少 imageApi.apiKey / apiKey / OPENAI_API_KEY");
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
  const imageApi = config.imageApi;
  const moonshot = config.moonshot;
  return {
    ok: true,
    hasKey: Boolean(imageApi.apiKey),
    key: maskKey(imageApi.apiKey),
    keySource: "runtime/config.json",
    baseUrl: imageApi.baseUrl,
    endpoint: imageApi.endpoint,
    target: `${imageApi.baseUrl}${imageApi.endpoint}`,
    model: imageApi.model,
    size: imageApi.size,
    concurrency: imageApi.concurrency,
    moonshot: {
      hasKey: Boolean(moonshot.apiKey),
      key: maskKey(moonshot.apiKey),
      baseUrl: moonshot.baseUrl,
      model: moonshot.model
    },
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
