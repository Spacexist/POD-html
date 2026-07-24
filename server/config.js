const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = path.join(ROOT, "runtime");
const CONFIG_PATH = path.join(RUNTIME_ROOT, "config.json");

const DEFAULT_ELEMENT_PREFIX_MODEL_PROMPT = `你是一个专业的印花与图案元素分析专家。
这张拼图由多张商品小图组合而成，每张小图的左上角都有一个形如 [货号] 的醒目标签。

需要处理的货号清单如下：
{item_ids}

任务要求：
1. 仔细观察每张小图，极其细致地识别图中出现的每一个具体视觉元素、动物、植物、节日、季节背景或道具细节（例如：冬季、圣诞节、驯鹿、拐杖糖、彩球、圣诞树、雪花、小火车、兔子、花朵、刺猬、几何三角形等）。
2. 描述要全面且具体，将识别到的主要元素和细节词平铺排列在一起。
3. 必须严格以 JSON 数组格式输出结果，不要包含 markdown 外层包装以外的解释文字。

输出 JSON 格式规范示例：
[
  {"id": "WT2231", "description": "冬季圣诞节驯鹿拐杖糖彩球圣诞树雪花"},
  {"id": "WT2232", "description": "秋季驯鹿雏菊花卉"}
]`;

const DEFAULT_CONFIG = {
  shared: {
    moonshot: {
      apiKey: "",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2.6"
    },
    server: {
      host: "127.0.0.1",
      port: 8787
    }
  },
  patternRedraw: {
    imageApi: {
      apiKey: "",
      baseUrl: "https://beecode.cc",
      endpoint: "/v1/images/edits",
      model: "gpt-image-2",
      size: "1024x1024",
      concurrency: 3,
      n: 4,
      sizes: {
        "1:1": "1024x1024",
        "9:16": "1024x1824",
        "4:3": "1536x1152"
      },
      similarityPrompt: "重要约束：输出图与输入图的主体轮廓、构图和核心图案保持约 {similarity}% 视觉相似度，其余部分进行原创重绘。"
    },
    infringement: {
      saveContactSheet: true,
      outputDir: "runtime/test/check"
    }
  },
  elementExtraction: {
    batchSize: 9,
    concurrency: 3,
    thinkingEnabled: false,
    prefix: "",
    suffix: "",
    prompt_prefix_model: DEFAULT_ELEMENT_PREFIX_MODEL_PROMPT
  }
};

// 原子写入 JSON，避免进程中断时留下半个配置文件。
function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

// 统一接口路径格式，确保代理拼接后的 URL 正确。
function normalizeEndpoint(value) {
  const endpoint = String(value || DEFAULT_CONFIG.patternRedraw.imageApi.endpoint).trim();
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

// 将图片数量限制在接口支持的 1 到 4 张范围内。
function normalizeImageCount(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_CONFIG.patternRedraw.imageApi.n;
  return Math.max(1, Math.min(4, number));
}

// 合并比例尺寸配置，并为缺失比例保留默认尺寸。
function normalizeSizes(value) {
  const sizes = value && typeof value === "object" ? value : {};
  return {
    "1:1": String(sizes["1:1"] || DEFAULT_CONFIG.patternRedraw.imageApi.sizes["1:1"]).trim(),
    "9:16": String(sizes["9:16"] || DEFAULT_CONFIG.patternRedraw.imageApi.sizes["9:16"]).trim(),
    "4:3": String(sizes["4:3"] || DEFAULT_CONFIG.patternRedraw.imageApi.sizes["4:3"]).trim()
  };
}

// 规范化项目内相对目录，阻止侵权拼图写出项目目录。
function normalizeOutputDir(value) {
  const configured = String(value || DEFAULT_CONFIG.patternRedraw.infringement.outputDir).trim();
  const resolved = path.resolve(ROOT, configured);
  const rootPrefix = `${ROOT}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(rootPrefix)) return DEFAULT_CONFIG.patternRedraw.infringement.outputDir;
  return path.relative(ROOT, resolved).replace(/\\/g, "/");
}

// 将整数配置限制在明确的最小值和最大值之间。
function normalizeInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

// 兼容旧版配置并补齐本版本所需的全部字段。
function normalizeConfig(input = {}) {
  const shared = input.shared || {};
  const patternRedraw = input.patternRedraw || {};
  const elementExtraction = input.elementExtraction || {};
  const imageApi = patternRedraw.imageApi || input.imageApi || input.beecode || input;
  const moonshot = shared.moonshot || input.moonshot || {};
  const infringement = patternRedraw.infringement || input.infringement || {};
  const server = shared.server || input.server || {};
  const apiKey = String(
    imageApi.apiKey ||
    imageApi.OPENAI_API_KEY ||
    (imageApi.env && imageApi.env.OPENAI_API_KEY) ||
    ""
  ).trim();

  return {
    shared: {
      moonshot: {
        apiKey: String(moonshot.apiKey || moonshot.MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || "").trim(),
        baseUrl: String(moonshot.baseUrl || DEFAULT_CONFIG.shared.moonshot.baseUrl).trim().replace(/\/+$/, ""),
        model: String(moonshot.model || DEFAULT_CONFIG.shared.moonshot.model).trim()
      },
      server: {
        host: String(server.host || DEFAULT_CONFIG.shared.server.host).trim(),
        port: normalizeInteger(server.port, 1, 65535, DEFAULT_CONFIG.shared.server.port)
      }
    },
    patternRedraw: {
      imageApi: {
        apiKey,
        baseUrl: String(imageApi.baseUrl || imageApi.OPENAI_BASE_URL || DEFAULT_CONFIG.patternRedraw.imageApi.baseUrl)
          .trim()
          .replace(/\/+$/, ""),
        endpoint: normalizeEndpoint(imageApi.endpoint),
        model: String(imageApi.model || DEFAULT_CONFIG.patternRedraw.imageApi.model).trim(),
        size: String(imageApi.size || DEFAULT_CONFIG.patternRedraw.imageApi.size).trim(),
        concurrency: normalizeInteger(
          imageApi.concurrency,
          1,
          20,
          DEFAULT_CONFIG.patternRedraw.imageApi.concurrency
        ),
        n: normalizeImageCount(imageApi.n),
        sizes: normalizeSizes(imageApi.sizes),
        similarityPrompt: String(
          imageApi.similarityPrompt || DEFAULT_CONFIG.patternRedraw.imageApi.similarityPrompt
        ).trim()
      },
      infringement: {
        saveContactSheet: infringement.saveContactSheet !== false,
        outputDir: normalizeOutputDir(infringement.outputDir)
      }
    },
    elementExtraction: {
      batchSize: normalizeInteger(
        elementExtraction.batchSize,
        1,
        9,
        DEFAULT_CONFIG.elementExtraction.batchSize
      ),
      concurrency: normalizeInteger(
        elementExtraction.concurrency,
        1,
        4,
        DEFAULT_CONFIG.elementExtraction.concurrency
      ),
      thinkingEnabled: elementExtraction.thinkingEnabled === true,
      prefix: String(elementExtraction.prefix || DEFAULT_CONFIG.elementExtraction.prefix).slice(0, 200),
      suffix: String(elementExtraction.suffix || DEFAULT_CONFIG.elementExtraction.suffix).slice(0, 200),
      prompt_prefix_model: String(
        elementExtraction.prompt_prefix_model ||
        DEFAULT_CONFIG.elementExtraction.prompt_prefix_model
      ).slice(0, 20000)
    }
  };
}

// 首次运行创建本地配置，否则加载并规范化现有配置。
function loadInitialConfig() {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    atomicWriteJson(CONFIG_PATH, DEFAULT_CONFIG);
    return normalizeConfig(DEFAULT_CONFIG);
  }

  const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const normalized = normalizeConfig(parsed);
  const hasNestedStructure =
    parsed &&
    typeof parsed === "object" &&
    parsed.shared &&
    parsed.patternRedraw &&
    parsed.elementExtraction &&
    parsed.elementExtraction.prompt_prefix_model;
  if (!hasNestedStructure) {
    atomicWriteJson(CONFIG_PATH, normalized);
  }
  return normalized;
}

let currentConfig = loadInitialConfig();

// 返回当前内存中的规范化配置。
function getConfig() {
  return currentConfig;
}

// 校验并替换运行时配置。
function replaceConfig(input) {
  const next = normalizeConfig(input);
  if (!next.patternRedraw.imageApi.apiKey) {
    throw new Error("配置缺少 patternRedraw.imageApi.apiKey / imageApi.apiKey / OPENAI_API_KEY");
  }
  atomicWriteJson(CONFIG_PATH, next);
  currentConfig = next;
  return currentConfig;
}

// 将密钥遮罩为只显示首尾片段的摘要。
function maskKey(apiKey) {
  if (!apiKey) return "未配置";
  return `${apiKey.slice(0, 3)}...${apiKey.slice(-6)}`;
}

// 返回前端可用但不暴露完整密钥的配置。
function publicConfig(config = currentConfig) {
  const imageApi = config.patternRedraw.imageApi;
  const moonshot = config.shared.moonshot;
  const infringement = config.patternRedraw.infringement;
  const elementExtraction = config.elementExtraction;
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
    n: imageApi.n,
    sizes: imageApi.sizes,
    similarityPrompt: imageApi.similarityPrompt,
    moonshot: {
      hasKey: Boolean(moonshot.apiKey),
      key: maskKey(moonshot.apiKey),
      baseUrl: moonshot.baseUrl,
      model: moonshot.model
    },
    infringement: {
      saveContactSheet: infringement.saveContactSheet,
      outputDir: infringement.outputDir
    },
    elementExtraction: {
      batchSize: elementExtraction.batchSize,
      concurrency: elementExtraction.concurrency,
      thinkingEnabled: elementExtraction.thinkingEnabled,
      prefix: elementExtraction.prefix,
      suffix: elementExtraction.suffix,
      prompt_prefix_model: elementExtraction.prompt_prefix_model
    },
    modules: {
      patternRedraw: "印花重绘",
      elementExtraction: "元素提取"
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
