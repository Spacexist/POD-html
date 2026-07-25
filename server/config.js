const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = path.join(ROOT, "runtime");
const ROOT_CONFIG_PATH = path.join(ROOT, "config.json");
const KEY_PATH = path.join(ROOT, "key.json");

const DEFAULT_PRODUCT_OUTPUT_PROMPT = `需要处理的货号清单如下：
{item_ids}

输出要求：
1. 必须为每个货号生成一条结果，不得遗漏或合并货号。
2. 必须严格输出 JSON 数组，不要包含 Markdown、代码块或额外解释文字。
3. 每项只允许包含 id 和 description 两个字段。

输出示例：
[
  {"id": "WT2231", "description": "完整商品 Listing"}
]`;

const DEFAULT_MAT_PRODUCT_PROMPT = `你是一个擅长撰写 Temu 或亚马逊平台电商商品标题的营销专家，深谙平台爆款标题的写作技巧。
你的任务是观察每个货号对应的商品图案，为一款【地垫/浴帘四件套】撰写极具吸引力且符合平台搜索习惯的完整商品 Listing。

商品通用信息：
- 材质：法兰绒
- 特点：防滑、可机洗、不褪色、现代家居装饰套装
- 适用场景：卫生间、浴室、洗衣房、客厅、卧室、厨房

标题要求：
1. 核心结构包含：2D flat 4pc Set、图案风格、浴帘四件套、防滑地垫、马桶盖套、U 型垫、浴帘及 12 个挂钩。
2. 根据图片随机融入主要视觉元素、节日主题、适用场景和装饰风格。
3. 适当使用柔软、舒适、全新、高级、耐用、美观、高品质、新款等修饰词。
4. 每条标题控制在 100–200 个中文字符。`;

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

const DEFAULT_INFRINGEMENT_PROMPT = "你是图片侵权风险审核助手。仅列出有明确或较高可能侵权风险的图片编号；编号来自图片左上角标签。没有风险项时返回空数组。reason 用简短中文说明依据；risk 只能是低、中、高。不要臆测无法从图中识别的信息。";

const DEFAULT_CONFIG = {
  shared: {
    moonshot: {
      model: "kimi-k2.6"
    },
    server: {
      host: "127.0.0.1",
      port: 8787
    }
  },
  patternRedraw: {
    imageApi: {
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
      similarityPrompt: "要求： {similarity}% 原图相似度（极其重要）"
    },
    infringement: {
      saveContactSheet: true,
      // 与任务图同属 runtime/cache，清空 Cache 时一并删除。
      outputDir: "runtime/cache/check",
      prompt: DEFAULT_INFRINGEMENT_PROMPT
    }
  },
  elementExtraction: {
    batchSize: 9,
    concurrency: 3,
    thinkingEnabled: false,
    prefix: "",
    suffix: "",
    prompt_prefix_model: DEFAULT_ELEMENT_PREFIX_MODEL_PROMPT,
    mode: "affix",
    product_name: "地垫",
    prompt_product_output_model: DEFAULT_PRODUCT_OUTPUT_PROMPT,
    product_prompts: {
      "地垫": DEFAULT_MAT_PRODUCT_PROMPT
    }
  },
  trans_model_pool: {
    active: "node-1",
    nodes: [
      {
        id: "node-1",
        name: "节点1-beecode",
        baseurl: "https://beeapi.ai",
        endpoint: "/v1/images/edits",
        model: "gpt-image-2",
        price: {
          "1k": 0.02,
          "2k": 0.04,
          "4K": 0.08
        }
      },
      {
        id: "node-2",
        name: "节点2-tokenx24",
        baseurl: "https://tokenx24.com",
        endpoint: "/v1/images/edits",
        model: "gpt-image-2",
        price: {
          "1k": "",
          "2k": "",
          "4K": ""
        }
      },
      {
        id: "node-3",
        name: "节点3-code2alita",
        baseurl: "https://code2alita.com",
        endpoint: "/v1/images/edits",
        model: "gpt-image-2",
        price: {
          "1k": "",
          "2k": "",
          "4K": ""
        }
      },
      {
        id: "node-4",
        name: "节点4-vectorengine",
        baseurl: "https://api.vectorengine.ai",
        endpoint: "/v1/images/edits",
        model: "gpt-image-2",
        price: {
          "1k": "",
          "2k": "",
          "4K": ""
        }
      }
    ]
  }
};

const DEFAULT_KEY_CONFIG = {
  baseurl: "https://api.moonshot.cn/v1",
  apikey: "",
  trans_model_keys: {}
};

// 原子写入 JSON，避免进程中断时留下半个配置文件。
function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

// 读取根目录可提交配置，产品管理只修改其中的 elementExtraction 字段。
function readRootConfig() {
  if (!fs.existsSync(ROOT_CONFIG_PATH)) return {};
  try {
    const raw = fs.readFileSync(ROOT_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error(`[config] 读取 config.json 失败，使用空配置：${error.message}`);
    return {};
  }
}

// 清理产品名称和提示词，避免异常配置进入页面或模型请求。
function normalizeProductPrompts(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  const names = Object.keys(source);
  for (let index = 0; index < names.length && index < 100; index += 1) {
    const name = String(names[index] || "").trim().slice(0, 100);
    const prompt = String(source[names[index]] || "").trim().slice(0, 20000);
    if (name && prompt) result[name] = prompt;
  }
  return result;
}

// 从根目录配置返回 Listing 模式、默认产品、公共输出模板和产品提示词。
function getElementProductSettings() {
  const rootConfig = readRootConfig();
  const elementExtraction = rootConfig.elementExtraction || {};
  const productPrompts = normalizeProductPrompts(elementExtraction.product_prompts);
  if (!Object.keys(productPrompts).length) {
    productPrompts["地垫"] = DEFAULT_MAT_PRODUCT_PROMPT;
  }
  let productName = String(elementExtraction.product_name || "").trim();
  if (!productName || !productPrompts[productName]) {
    productName = Object.keys(productPrompts)[0] || "";
  }
  return {
    mode: elementExtraction.mode === "product" ? "product" : "affix",
    productName,
    promptProductOutputModel: String(
      elementExtraction.prompt_product_output_model || DEFAULT_PRODUCT_OUTPUT_PROMPT
    ).trim().slice(0, 20000),
    productPrompts
  };
}

// 将产品配置原子写回根目录 config.json，同时保留其他业务配置字段。
function saveElementProductSettings(settings) {
  const rootConfig = readRootConfig();
  if (!rootConfig.elementExtraction || typeof rootConfig.elementExtraction !== "object") {
    rootConfig.elementExtraction = {};
  }
  const normalized = {
    mode: settings.mode === "product" ? "product" : "affix",
    productName: String(settings.productName || "").trim().slice(0, 100),
    promptProductOutputModel: String(
      settings.promptProductOutputModel || DEFAULT_PRODUCT_OUTPUT_PROMPT
    ).trim().slice(0, 20000),
    productPrompts: normalizeProductPrompts(settings.productPrompts)
  };
  const productNames = Object.keys(normalized.productPrompts);
  if (!normalized.productName || !normalized.productPrompts[normalized.productName]) {
    normalized.productName = productNames[0] || "";
  }
  rootConfig.elementExtraction.mode = normalized.mode;
  rootConfig.elementExtraction.product_name = normalized.productName;
  rootConfig.elementExtraction.prompt_product_output_model = normalized.promptProductOutputModel;
  rootConfig.elementExtraction.product_prompts = normalized.productPrompts;
  atomicWriteJson(ROOT_CONFIG_PATH, configWithoutSecrets(rootConfig));
  return normalized;
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

// 规范化侵权拼图目录：固定在 runtime/cache/check（兼容旧配置 runtime/test/check）。
function normalizeOutputDir(value) {
  const defaultDir = DEFAULT_CONFIG.patternRedraw.infringement.outputDir;
  const configured = String(value || defaultDir).trim().replace(/\\/g, "/");
  // 旧路径自动迁移到 cache/check，保证点「清空」只清 cache 即可。
  if (
    !configured ||
    configured === "runtime/test/check" ||
    configured === "runtime/cache/contact-sheets" ||
    configured.endsWith("/test/check")
  ) {
    return defaultDir;
  }
  const resolved = path.resolve(ROOT, configured);
  const rootPrefix = `${ROOT}${path.sep}`.toLowerCase();
  if (!resolved.toLowerCase().startsWith(rootPrefix)) return defaultDir;
  const relative = path.relative(ROOT, resolved).replace(/\\/g, "/");
  // 仅允许写在 runtime/cache 下，避免拼图落到 cache 外导致清空遗漏。
  const cachePrefix = path.join("runtime", "cache").replace(/\\/g, "/").toLowerCase();
  if (!relative.toLowerCase().startsWith(cachePrefix)) return defaultDir;
  return relative || defaultDir;
}

// 将整数配置限制在明确的最小值和最大值之间。
function normalizeInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

// 规范化节点价格表，仅保留可序列化的数字或字符串价格。
function normalizeNodePrice(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  const keys = Object.keys(source);
  for (let index = 0; index < keys.length && index < 20; index += 1) {
    const key = String(keys[index] || "").trim().slice(0, 40);
    const price = source[keys[index]];
    if (key && (typeof price === "number" || typeof price === "string")) {
      result[key] = price;
    }
  }
  return result;
}

// 规范化一个图片中转节点，统一使用小写 baseurl 并移除节点内的密钥。
function normalizeTransModelNode(value, index) {
  const node = value && typeof value === "object" ? value : {};
  const fallbackId = `node-${index + 1}`;
  const id = String(node.id || node.name || fallbackId)
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 80) || fallbackId;
  const normalized = {
    id,
    name: String(node.name || `节点 ${index + 1}`).trim().slice(0, 80),
    baseurl: String(node.baseurl || node.baseUrl || DEFAULT_CONFIG.trans_model_pool.nodes[0].baseurl)
      .trim()
      .replace(/\/+$/, ""),
    endpoint: node.endpoint ? normalizeEndpoint(node.endpoint) : "",
    model: String(node.model || "").trim().slice(0, 120)
  };
  const price = normalizeNodePrice(node.price);
  if (Object.keys(price).length) normalized.price = price;
  return normalized;
}

// 规范化 config.json 中的图片中转节点池，并兼容数组或单节点对象。
function normalizeTransModelPool(value) {
  const rawPool = value || {};
  let rawNodes = [];
  if (Array.isArray(rawPool)) {
    rawNodes = rawPool;
  } else if (Array.isArray(rawPool.nodes)) {
    rawNodes = rawPool.nodes;
  } else if (rawPool && typeof rawPool === "object" && (rawPool.baseUrl || rawPool.baseurl)) {
    rawNodes = [rawPool];
  }
  if (!rawNodes.length) rawNodes = DEFAULT_CONFIG.trans_model_pool.nodes;
  const nodes = [];
  const usedIds = new Set();
  for (let index = 0; index < rawNodes.length && index < 50; index += 1) {
    const node = normalizeTransModelNode(rawNodes[index], index);
    if (usedIds.has(node.id)) {
      let fallbackId = `node-${index + 1}`;
      let suffix = 2;
      while (usedIds.has(fallbackId)) {
        fallbackId = `node-${index + 1}-${suffix}`;
        suffix += 1;
      }
      node.id = fallbackId;
    }
    usedIds.add(node.id);
    nodes.push(node);
  }
  let active = String(
    Array.isArray(rawPool) ? "" : rawPool.active || rawPool.activeNode || ""
  ).trim();
  let activeExists = false;
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === active) activeExists = true;
  }
  if (!activeExists) active = nodes[0].id;
  return { active, nodes };
}

// 从新旧 key.json 结构读取各图片中转节点的独立 API Key。
function normalizeTransModelKeys(input) {
  const result = {};
  const source = input && typeof input === "object" ? input : {};
  const configuredKeys = source.trans_model_keys || source.transModelKeys || {};
  const keyNames = Object.keys(configuredKeys);
  for (let index = 0; index < keyNames.length && index < 100; index += 1) {
    const id = String(keyNames[index] || "").trim().slice(0, 80);
    const configuredValue = configuredKeys[keyNames[index]];
    let apiKey = "";
    if (typeof configuredValue === "string") {
      apiKey = configuredValue;
    } else if (configuredValue && typeof configuredValue === "object") {
      apiKey = configuredValue.apikey || configuredValue.apiKey || "";
    }
    if (id) result[id] = String(apiKey || "").trim();
  }
  const legacyPool = source.trans_model_pool || {};
  const legacyNodes = Array.isArray(legacyPool) ? legacyPool : legacyPool.nodes;
  if (Array.isArray(legacyNodes)) {
    for (let index = 0; index < legacyNodes.length && index < 100; index += 1) {
      const node = legacyNodes[index] && typeof legacyNodes[index] === "object" ? legacyNodes[index] : {};
      const id = String(node.id || `node-${index + 1}`).trim().slice(0, 80);
      const apiKey = String(node.apikey || node.apiKey || "").trim();
      if (id && !Object.prototype.hasOwnProperty.call(result, id)) result[id] = apiKey;
    }
  }
  return result;
}

// 规范化扁平 key.json，并兼容旧版 moonshot 与 trans_model_pool 嵌套结构。
function normalizeKeyConfig(input = {}) {
  const source = input.moonshot && typeof input.moonshot === "object" ? input.moonshot : input;
  return {
    baseurl: String(
      source.baseurl || source.baseUrl || DEFAULT_KEY_CONFIG.baseurl
    ).trim().replace(/\/+$/, ""),
    apikey: String(
      source.apikey || source.apiKey || process.env.MOONSHOT_API_KEY || ""
    ).trim(),
    trans_model_keys: normalizeTransModelKeys(input)
  };
}

// 返回 config.json 当前选中的图片中转节点。
function activeTransModelNode(pool) {
  for (let index = 0; index < pool.nodes.length; index += 1) {
    if (pool.nodes[index].id === pool.active) return pool.nodes[index];
  }
  return pool.nodes[0];
}

// 读取本地 key.json 原始对象，供旧配置迁移和扁平密钥规范化使用。
function readKeyInput() {
  if (!fs.existsSync(KEY_PATH)) return DEFAULT_KEY_CONFIG;
  try {
    const raw = fs.readFileSync(KEY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : DEFAULT_KEY_CONFIG;
  } catch (error) {
    console.error(`[config] 读取 key.json 失败，使用默认密钥配置：${error.message}`);
    return DEFAULT_KEY_CONFIG;
  }
}

// 兼容旧版配置并补齐本版本所需的全部字段。
function normalizeConfig(input = {}, keyConfig = DEFAULT_KEY_CONFIG) {
  const shared = input.shared || {};
  const patternRedraw = input.patternRedraw || {};
  const elementExtraction = input.elementExtraction || {};
  const imageApi = patternRedraw.imageApi || input.imageApi || input.beecode || input;
  const moonshot = shared.moonshot || input.moonshot || {};
  const infringement = patternRedraw.infringement || input.infringement || {};
  const server = shared.server || input.server || {};
  const normalizedKeys = normalizeKeyConfig(keyConfig);
  const transModelPool = normalizeTransModelPool(
    input.trans_model_pool || input.transModelPool || DEFAULT_CONFIG.trans_model_pool
  );
  const imageNode = activeTransModelNode(transModelPool);
  const imageApiKey = normalizedKeys.trans_model_keys[imageNode.id] || "";

  return {
    shared: {
      moonshot: {
        apiKey: normalizedKeys.apikey,
        baseUrl: normalizedKeys.baseurl,
        model: String(moonshot.model || DEFAULT_CONFIG.shared.moonshot.model).trim()
      },
      server: {
        host: String(server.host || DEFAULT_CONFIG.shared.server.host).trim(),
        port: normalizeInteger(server.port, 1, 65535, DEFAULT_CONFIG.shared.server.port)
      }
    },
    patternRedraw: {
      imageApi: {
        apiKey: imageApiKey,
        baseUrl: imageNode.baseurl,
        endpoint: imageNode.endpoint || normalizeEndpoint(imageApi.endpoint),
        model: imageNode.model || String(imageApi.model || DEFAULT_CONFIG.patternRedraw.imageApi.model).trim(),
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
        outputDir: normalizeOutputDir(infringement.outputDir),
        prompt: String(infringement.prompt || DEFAULT_INFRINGEMENT_PROMPT).trim().slice(0, 20000)
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
    },
    trans_model_pool: transModelPool
  };
}

const initialKeyInput = readKeyInput();
let currentKeyConfig = normalizeKeyConfig(initialKeyInput);

// 从业务配置副本中移除全部密钥字段，保留不含凭据的图片中转节点池。
function configWithoutSecrets(input) {
  const safe = JSON.parse(JSON.stringify(input && typeof input === "object" ? input : {}));
  if (safe.shared && safe.shared.moonshot) {
    delete safe.shared.moonshot.apiKey;
    delete safe.shared.moonshot.apikey;
    delete safe.shared.moonshot.baseUrl;
    delete safe.shared.moonshot.baseurl;
  }
  if (safe.patternRedraw && safe.patternRedraw.imageApi) {
    delete safe.patternRedraw.imageApi.apiKey;
    delete safe.patternRedraw.imageApi.apikey;
    delete safe.patternRedraw.imageApi.baseUrl;
    delete safe.patternRedraw.imageApi.baseurl;
  }
  if (safe.imageApi && typeof safe.imageApi === "object") {
    delete safe.imageApi.apiKey;
    delete safe.imageApi.apikey;
    delete safe.imageApi.baseUrl;
    delete safe.imageApi.baseurl;
  }
  if (safe.beecode && typeof safe.beecode === "object") {
    delete safe.beecode.apiKey;
    delete safe.beecode.apikey;
    delete safe.beecode.baseUrl;
    delete safe.beecode.baseurl;
  }
  delete safe.apiKey;
  delete safe.apikey;
  delete safe.baseUrl;
  delete safe.baseurl;
  delete safe.moonshot;
  if (safe.trans_model_pool && Array.isArray(safe.trans_model_pool.nodes)) {
    for (let index = 0; index < safe.trans_model_pool.nodes.length; index += 1) {
      const node = safe.trans_model_pool.nodes[index];
      if (node && typeof node === "object") {
        delete node.apiKey;
        delete node.apikey;
      }
    }
  }
  return safe;
}

// 判断 key.json 是否已经使用小写凭据和节点密钥映射的新结构。
function keyConfigNeedsMigration(input, normalized) {
  const keys = Object.keys(input && typeof input === "object" ? input : {});
  if (
    keys.length !== 3 ||
    !keys.includes("baseurl") ||
    !keys.includes("apikey") ||
    !keys.includes("trans_model_keys")
  ) {
    return true;
  }
  return JSON.stringify(input) !== JSON.stringify(normalized);
}

// 从旧 key.json 提取图片中转节点池，供首次迁移到 config.json 使用。
function legacyTransModelPool(input) {
  if (!input || typeof input !== "object" || !input.trans_model_pool) return null;
  return normalizeTransModelPool(input.trans_model_pool);
}

// 把旧 config.json 节点内的 API Key 迁移到 key.json 节点映射。
function mergeLegacyTransModelKeys(poolValue, keyConfig) {
  const rawPool = poolValue || {};
  const rawNodes = Array.isArray(rawPool) ? rawPool : rawPool.nodes;
  if (!Array.isArray(rawNodes)) return false;
  const normalizedPool = normalizeTransModelPool(rawPool);
  let changed = false;
  for (let index = 0; index < rawNodes.length && index < normalizedPool.nodes.length; index += 1) {
    const rawNode = rawNodes[index] && typeof rawNodes[index] === "object" ? rawNodes[index] : {};
    const apiKey = String(rawNode.apikey || rawNode.apiKey || "").trim();
    const id = normalizedPool.nodes[index].id;
    if (apiKey && !keyConfig.trans_model_keys[id]) {
      keyConfig.trans_model_keys[id] = apiKey;
      changed = true;
    }
  }
  return changed;
}

// 为 config.json 的每个节点补齐一个独立的 key.json 密钥槽位。
function ensureTransModelKeySlots(keyConfig, pool) {
  let changed = false;
  for (let index = 0; index < pool.nodes.length; index += 1) {
    const id = pool.nodes[index].id;
    if (!Object.prototype.hasOwnProperty.call(keyConfig.trans_model_keys, id)) {
      keyConfig.trans_model_keys[id] = "";
      changed = true;
    }
  }
  return changed;
}

// 判断导入的 key.json 是否显式包含图片中转节点密钥。
function hasTransModelKeyInput(input) {
  return Boolean(
    input &&
    typeof input === "object" &&
    (input.trans_model_keys || input.transModelKeys || input.trans_model_pool)
  );
}

// 从根目录 config.json 读取完整业务配置，并合并 key.json 中的 Moonshot 与节点凭据。
function loadInitialConfig() {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  const rootConfig = readRootConfig();
  const businessConfig = Object.keys(rootConfig).length
    ? JSON.parse(JSON.stringify(rootConfig))
    : JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const legacyPool = legacyTransModelPool(initialKeyInput);
  const poolSource = rootConfig.trans_model_pool || legacyPool || DEFAULT_CONFIG.trans_model_pool;
  mergeLegacyTransModelKeys(poolSource, currentKeyConfig);
  businessConfig.trans_model_pool = normalizeTransModelPool(poolSource);
  ensureTransModelKeySlots(currentKeyConfig, businessConfig.trans_model_pool);
  if (
    !rootConfig.trans_model_pool ||
    JSON.stringify(rootConfig.trans_model_pool) !== JSON.stringify(businessConfig.trans_model_pool)
  ) {
    atomicWriteJson(ROOT_CONFIG_PATH, configWithoutSecrets(businessConfig));
  }
  if (keyConfigNeedsMigration(initialKeyInput, currentKeyConfig)) {
    atomicWriteJson(KEY_PATH, currentKeyConfig);
  }
  return normalizeConfig(businessConfig, currentKeyConfig);
}

let currentConfig = loadInitialConfig();

// 返回当前内存中的规范化配置。
function getConfig() {
  return currentConfig;
}

// 保存不含密钥的业务配置，并重新合并当前 key.json。
function replaceConfig(input) {
  const poolInput = input && (input.trans_model_pool || input.transModelPool);
  if (poolInput) mergeLegacyTransModelKeys(poolInput, currentKeyConfig);
  const safeInput = configWithoutSecrets(input);
  if (!safeInput.trans_model_pool) {
    safeInput.trans_model_pool = currentConfig.trans_model_pool;
  } else {
    safeInput.trans_model_pool = normalizeTransModelPool(safeInput.trans_model_pool);
  }
  ensureTransModelKeySlots(currentKeyConfig, safeInput.trans_model_pool);
  atomicWriteJson(KEY_PATH, currentKeyConfig);
  atomicWriteJson(ROOT_CONFIG_PATH, safeInput);
  currentConfig = normalizeConfig(safeInput, currentKeyConfig);
  return currentConfig;
}

// 保存并载入小写凭据与节点密钥映射，未提供节点密钥时保留现有映射。
function replaceKeyConfig(input) {
  const nextKeys = normalizeKeyConfig(input);
  if (!hasTransModelKeyInput(input)) {
    nextKeys.trans_model_keys = currentKeyConfig.trans_model_keys;
  }
  ensureTransModelKeySlots(nextKeys, currentConfig.trans_model_pool);
  atomicWriteJson(KEY_PATH, nextKeys);
  currentKeyConfig = nextKeys;
  currentConfig = normalizeConfig(readRootConfig(), currentKeyConfig);
  return currentConfig;
}

// 切换当前图片中转节点并把选择持久化到 config.json。
function selectTransModelNode(nodeId) {
  const requestedId = String(nodeId || "").trim();
  const rootConfig = readRootConfig();
  const pool = normalizeTransModelPool(
    rootConfig.trans_model_pool || currentConfig.trans_model_pool
  );
  let matched = false;
  for (let index = 0; index < pool.nodes.length; index += 1) {
    if (pool.nodes[index].id === requestedId) matched = true;
  }
  if (!matched) throw new Error(`找不到图片中转节点：${requestedId}`);
  pool.active = requestedId;
  rootConfig.trans_model_pool = pool;
  atomicWriteJson(ROOT_CONFIG_PATH, configWithoutSecrets(rootConfig));
  currentConfig = normalizeConfig(rootConfig, currentKeyConfig);
  return currentConfig;
}

// 根据后台当前激活节点选择下一项，到列表末尾后循环回第一项。
function selectNextTransModelNode() {
  const pool = currentConfig.trans_model_pool;
  let currentIndex = -1;
  for (let index = 0; index < pool.nodes.length; index += 1) {
    if (pool.nodes[index].id === pool.active) currentIndex = index;
  }
  const nextIndex = (currentIndex + 1) % pool.nodes.length;
  return selectTransModelNode(pool.nodes[nextIndex].id);
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
  const productSettings = getElementProductSettings();
  const productNames = Object.keys(productSettings.productPrompts);
  const publicNodes = [];
  for (let index = 0; index < config.trans_model_pool.nodes.length; index += 1) {
    const node = config.trans_model_pool.nodes[index];
    const nodeApiKey = currentKeyConfig.trans_model_keys[node.id] || "";
    publicNodes.push({
      id: node.id,
      name: node.name,
      hasKey: Boolean(nodeApiKey),
      key: maskKey(nodeApiKey),
      endpoint: node.endpoint || imageApi.endpoint,
      model: node.model || imageApi.model,
      price: node.price || {}
    });
  }
  return {
    ok: true,
    hasKey: Boolean(imageApi.apiKey),
    key: maskKey(imageApi.apiKey),
    keySource: KEY_PATH,
    endpoint: imageApi.endpoint,
    model: imageApi.model,
    size: imageApi.size,
    concurrency: imageApi.concurrency,
    n: imageApi.n,
    sizes: imageApi.sizes,
    similarityPrompt: imageApi.similarityPrompt,
    transModelPool: {
      active: config.trans_model_pool.active,
      nodes: publicNodes
    },
    moonshot: {
      hasKey: Boolean(moonshot.apiKey),
      key: maskKey(moonshot.apiKey),
      model: moonshot.model
    },
    infringement: {
      saveContactSheet: infringement.saveContactSheet,
      outputDir: infringement.outputDir,
      prompt: infringement.prompt
    },
    elementExtraction: {
      batchSize: elementExtraction.batchSize,
      concurrency: elementExtraction.concurrency,
      thinkingEnabled: elementExtraction.thinkingEnabled,
      prefix: elementExtraction.prefix,
      suffix: elementExtraction.suffix,
      prompt_prefix_model: elementExtraction.prompt_prefix_model,
      mode: productSettings.mode,
      productName: productSettings.productName,
      productNames
    },
    modules: {
      patternRedraw: "印花重绘",
      elementExtraction: "元素提取"
    },
    configPath: ROOT_CONFIG_PATH,
    cache: path.join(RUNTIME_ROOT, "cache")
  };
}

module.exports = {
  ROOT,
  RUNTIME_ROOT,
  ROOT_CONFIG_PATH,
  KEY_PATH,
  getConfig,
  getElementProductSettings,
  replaceConfig,
  replaceKeyConfig,
  selectNextTransModelNode,
  selectTransModelNode,
  saveElementProductSettings,
  publicConfig,
  atomicWriteJson
};
