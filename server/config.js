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
  }
};

// 默认图片中转节点模板：节点列表由 key.json 动态提供，不锁死在 config.json。
const DEFAULT_TRANS_MODEL_NODES = [
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
    },
    apikey: ""
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
    },
    apikey: ""
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
    },
    apikey: ""
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
    },
    apikey: ""
  }
];

const DEFAULT_KEY_CONFIG = {
  baseurl: "https://api.moonshot.cn/v1",
  apikey: "",
  trans_model_pool: {
    active: "node-1",
    nodes: DEFAULT_TRANS_MODEL_NODES.map((node) => ({ ...node }))
  }
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

// 规范化一个图片中转节点；includeSecrets 时保留 apikey（仅 key.json 使用）。
function normalizeTransModelNode(value, index, includeSecrets = false) {
  const node = value && typeof value === "object" ? value : {};
  const fallbackId = `node-${index + 1}`;
  const id = String(node.id || node.name || fallbackId)
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .slice(0, 80) || fallbackId;
  const defaultBaseurl = DEFAULT_TRANS_MODEL_NODES[0].baseurl;
  const normalized = {
    id,
    name: String(node.name || `节点 ${index + 1}`).trim().slice(0, 80),
    baseurl: String(node.baseurl || node.baseUrl || defaultBaseurl)
      .trim()
      .replace(/\/+$/, ""),
    endpoint: node.endpoint ? normalizeEndpoint(node.endpoint) : "",
    model: String(node.model || "").trim().slice(0, 120)
  };
  const price = normalizeNodePrice(node.price);
  if (Object.keys(price).length) normalized.price = price;
  if (includeSecrets) {
    normalized.apikey = String(node.apikey || node.apiKey || "").trim();
  }
  return normalized;
}

// 规范化图片中转节点池；allowEmpty 时允许空列表（用于判断 key 是否显式提供节点）。
function normalizeTransModelPool(value, options = {}) {
  const includeSecrets = options.includeSecrets === true;
  const allowEmpty = options.allowEmpty === true;
  const rawPool = value || {};
  let rawNodes = [];
  if (Array.isArray(rawPool)) {
    rawNodes = rawPool;
  } else if (Array.isArray(rawPool.nodes)) {
    rawNodes = rawPool.nodes;
  } else if (rawPool && typeof rawPool === "object" && (rawPool.baseUrl || rawPool.baseurl)) {
    rawNodes = [rawPool];
  }
  if (!rawNodes.length && !allowEmpty) {
    rawNodes = DEFAULT_TRANS_MODEL_NODES.map((node) => ({ ...node }));
  }
  const nodes = [];
  const usedIds = new Set();
  for (let index = 0; index < rawNodes.length && index < 50; index += 1) {
    const node = normalizeTransModelNode(rawNodes[index], index, includeSecrets);
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
  if (!activeExists && nodes.length) active = nodes[0].id;
  if (!nodes.length) active = "";
  return { active, nodes };
}

// 从旧版 trans_model_keys 映射读取节点密钥（兼容迁移）。
function readLegacyTransModelKeyMap(input) {
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
  return result;
}

// 把旧 trans_model_keys 映射合并进节点列表（按 id 填 apikey）。
function applyKeyMapToNodes(nodes, keyMap) {
  if (!keyMap || typeof keyMap !== "object") return nodes;
  for (let index = 0; index < nodes.length; index += 1) {
    const id = nodes[index].id;
    if (Object.prototype.hasOwnProperty.call(keyMap, id) && !nodes[index].apikey) {
      nodes[index].apikey = String(keyMap[id] || "").trim();
    }
  }
  return nodes;
}

// 判断输入是否显式包含图片中转节点定义或密钥。
function hasTransModelPoolInput(input) {
  if (!input || typeof input !== "object") return false;
  if (input.trans_model_pool || input.transModelPool) return true;
  if (input.trans_model_keys || input.transModelKeys) return true;
  return false;
}

// 从 key.json 输入解析完整节点池（含 apikey）；可附带 config 侧旧节点元数据做迁移。
function resolveTransModelPoolFromKeyInput(input = {}, fallbackPool = null) {
  const source = input && typeof input === "object" ? input : {};
  const keyMap = readLegacyTransModelKeyMap(source);
  const explicitPool = source.trans_model_pool || source.transModelPool || null;
  let pool;

  if (explicitPool) {
    pool = normalizeTransModelPool(explicitPool, { includeSecrets: true, allowEmpty: false });
    applyKeyMapToNodes(pool.nodes, keyMap);
    return pool;
  }

  // 旧版仅有 trans_model_keys：用 fallback（config 旧节点或默认模板）拼出完整节点。
  if (Object.keys(keyMap).length) {
    const base = fallbackPool && fallbackPool.nodes && fallbackPool.nodes.length
      ? fallbackPool
      : { active: "", nodes: DEFAULT_TRANS_MODEL_NODES.map((node) => ({ ...node })) };
    pool = normalizeTransModelPool(base, { includeSecrets: true, allowEmpty: false });
    applyKeyMapToNodes(pool.nodes, keyMap);
    // 若 key 映射里有模板中没有的 id，补空节点，保证载入可动态增加。
    const known = new Set(pool.nodes.map((node) => node.id));
    const extraIds = Object.keys(keyMap);
    for (let index = 0; index < extraIds.length && pool.nodes.length < 50; index += 1) {
      const id = extraIds[index];
      if (known.has(id)) continue;
      pool.nodes.push(
        normalizeTransModelNode(
          {
            id,
            name: id,
            baseurl: DEFAULT_TRANS_MODEL_NODES[0].baseurl,
            endpoint: "/v1/images/edits",
            model: "gpt-image-2",
            apikey: keyMap[id]
          },
          pool.nodes.length,
          true
        )
      );
      known.add(id);
    }
    if (!pool.active && pool.nodes.length) pool.active = pool.nodes[0].id;
    return pool;
  }

  if (fallbackPool && fallbackPool.nodes && fallbackPool.nodes.length) {
    return normalizeTransModelPool(fallbackPool, { includeSecrets: true, allowEmpty: false });
  }

  return normalizeTransModelPool(DEFAULT_KEY_CONFIG.trans_model_pool, {
    includeSecrets: true,
    allowEmpty: false
  });
}

// 规范化 key.json：Moonshot 凭据 + 完整图片中转节点池（含 apikey）。
function normalizeKeyConfig(input = {}, fallbackPool = null) {
  const source = input.moonshot && typeof input.moonshot === "object" ? input.moonshot : input;
  return {
    baseurl: String(
      source.baseurl || source.baseUrl || DEFAULT_KEY_CONFIG.baseurl
    ).trim().replace(/\/+$/, ""),
    apikey: String(
      source.apikey || source.apiKey || process.env.MOONSHOT_API_KEY || ""
    ).trim(),
    trans_model_pool: resolveTransModelPoolFromKeyInput(input, fallbackPool)
  };
}

// 从内存 key 配置取节点密钥映射（供代理与 publicConfig 使用）。
function transModelKeyMap(keyConfig = currentKeyConfig) {
  const result = {};
  const pool = keyConfig && keyConfig.trans_model_pool ? keyConfig.trans_model_pool : { nodes: [] };
  for (let index = 0; index < pool.nodes.length; index += 1) {
    const node = pool.nodes[index];
    result[node.id] = String(node.apikey || "").trim();
  }
  return result;
}

// 写入 key.json 的序列化形态（节点内含 apikey，不再使用 trans_model_keys）。
function serializeKeyConfig(keyConfig) {
  const pool = normalizeTransModelPool(keyConfig.trans_model_pool, {
    includeSecrets: true,
    allowEmpty: false
  });
  return {
    baseurl: String(keyConfig.baseurl || DEFAULT_KEY_CONFIG.baseurl).trim().replace(/\/+$/, ""),
    apikey: String(keyConfig.apikey || "").trim(),
    trans_model_pool: pool
  };
}

// 返回 key.json 当前选中的图片中转节点。
function activeTransModelNode(pool) {
  const nodes = pool && Array.isArray(pool.nodes) ? pool.nodes : [];
  if (!nodes.length) {
    return normalizeTransModelNode(DEFAULT_TRANS_MODEL_NODES[0], 0, true);
  }
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === pool.active) return nodes[index];
  }
  return nodes[0];
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

// 业务配置 + key 节点池合并为运行时配置；节点列表始终来自 key.json。
function normalizeConfig(input = {}, keyConfig = DEFAULT_KEY_CONFIG) {
  const shared = input.shared || {};
  const patternRedraw = input.patternRedraw || {};
  const elementExtraction = input.elementExtraction || {};
  const imageApi = patternRedraw.imageApi || input.imageApi || input.beecode || input;
  const moonshot = shared.moonshot || input.moonshot || {};
  const infringement = patternRedraw.infringement || input.infringement || {};
  const server = shared.server || input.server || {};
  const normalizedKeys = keyConfig && keyConfig.trans_model_pool
    ? {
        baseurl: String(keyConfig.baseurl || DEFAULT_KEY_CONFIG.baseurl).trim().replace(/\/+$/, ""),
        apikey: String(keyConfig.apikey || "").trim(),
        trans_model_pool: normalizeTransModelPool(keyConfig.trans_model_pool, {
          includeSecrets: true,
          allowEmpty: false
        })
      }
    : normalizeKeyConfig(keyConfig);
  // 运行时节点池不含密钥字段，密钥单独挂到 imageApi.apiKey。
  const secretPool = normalizedKeys.trans_model_pool;
  const publicPool = normalizeTransModelPool(secretPool, { includeSecrets: false, allowEmpty: false });
  publicPool.active = secretPool.active;
  const imageNode = activeTransModelNode(secretPool);
  const imageApiKey = String((imageNode && imageNode.apikey) || "").trim();

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
    // 仅内存使用；不写回 config.json。
    trans_model_pool: publicPool
  };
}

const initialKeyInput = readKeyInput();
let currentKeyConfig = null;

// 从业务配置副本中移除全部密钥与节点池（节点只属于 key.json）。
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
  // 节点池改由 key.json 动态提供，config 不再保存。
  delete safe.trans_model_pool;
  delete safe.transModelPool;
  return safe;
}

// 判断 key.json 是否需要迁移为「完整节点池」结构。
function keyConfigNeedsMigration(input, normalized) {
  if (!input || typeof input !== "object") return true;
  if (input.trans_model_keys || input.transModelKeys) return true;
  if (!input.trans_model_pool && !input.transModelPool) return true;
  return JSON.stringify(input) !== JSON.stringify(normalized);
}

// 把旧 config.json 节点内的 API Key 合并进 key 节点池。
function mergeLegacyNodeSecretsIntoKeyPool(poolValue, keyConfig) {
  const rawPool = poolValue || {};
  const rawNodes = Array.isArray(rawPool) ? rawPool : rawPool.nodes;
  if (!Array.isArray(rawNodes) || !keyConfig || !keyConfig.trans_model_pool) return false;
  let changed = false;
  const byId = {};
  for (let index = 0; index < keyConfig.trans_model_pool.nodes.length; index += 1) {
    byId[keyConfig.trans_model_pool.nodes[index].id] = keyConfig.trans_model_pool.nodes[index];
  }
  for (let index = 0; index < rawNodes.length; index += 1) {
    const rawNode = rawNodes[index] && typeof rawNodes[index] === "object" ? rawNodes[index] : {};
    const id = String(rawNode.id || `node-${index + 1}`).trim().slice(0, 80);
    const apiKey = String(rawNode.apikey || rawNode.apiKey || "").trim();
    if (!id || !apiKey) continue;
    if (byId[id]) {
      if (!byId[id].apikey) {
        byId[id].apikey = apiKey;
        changed = true;
      }
    } else {
      keyConfig.trans_model_pool.nodes.push(
        normalizeTransModelNode({ ...rawNode, apikey: apiKey }, keyConfig.trans_model_pool.nodes.length, true)
      );
      changed = true;
    }
  }
  return changed;
}

// 从根目录 config.json 读取业务配置，节点池完全来自 key.json（可动态增减）。
function loadInitialConfig() {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  const rootConfig = readRootConfig();
  const businessConfig = Object.keys(rootConfig).length
    ? JSON.parse(JSON.stringify(rootConfig))
    : JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 迁移：config 里若仍有旧节点列表，仅作元数据回填，之后从 config 剥离。
  const legacyConfigPool = rootConfig.trans_model_pool || rootConfig.transModelPool || null;
  const fallbackMeta = legacyConfigPool
    ? normalizeTransModelPool(legacyConfigPool, { includeSecrets: true, allowEmpty: true })
    : null;

  currentKeyConfig = normalizeKeyConfig(initialKeyInput, fallbackMeta);
  if (legacyConfigPool) {
    mergeLegacyNodeSecretsIntoKeyPool(legacyConfigPool, currentKeyConfig);
  }

  // 若 config 仍含节点池，写回时剥离，避免继续锁死节点。
  const safeBusiness = configWithoutSecrets(businessConfig);
  if (rootConfig.trans_model_pool || rootConfig.transModelPool) {
    atomicWriteJson(ROOT_CONFIG_PATH, safeBusiness);
  } else if (!Object.keys(rootConfig).length) {
    atomicWriteJson(ROOT_CONFIG_PATH, safeBusiness);
  }

  const serializedKey = serializeKeyConfig(currentKeyConfig);
  if (keyConfigNeedsMigration(initialKeyInput, serializedKey)) {
    atomicWriteJson(KEY_PATH, serializedKey);
    currentKeyConfig = serializedKey;
  }

  return normalizeConfig(safeBusiness, currentKeyConfig);
}

let currentConfig = loadInitialConfig();

// 返回当前内存中的规范化配置。
function getConfig() {
  return currentConfig;
}

// 保存不含密钥的业务配置；忽略请求体中的节点池，节点只由 key.json 控制。
function replaceConfig(input) {
  const safeInput = configWithoutSecrets(input);
  atomicWriteJson(ROOT_CONFIG_PATH, safeInput);
  currentConfig = normalizeConfig(safeInput, currentKeyConfig);
  return currentConfig;
}

// 载入 key.json：完整替换节点池（可动态增减），未提供节点时保留现有池。
function replaceKeyConfig(input) {
  const source = input && typeof input === "object" ? input : {};
  let nextKeys;
  if (hasTransModelPoolInput(source)) {
    // 载入的 key 成为节点权威来源，按文件内容动态重建列表。
    nextKeys = normalizeKeyConfig(source, null);
  } else {
    // 仅更新 Moonshot 凭据时保留当前节点池。
    nextKeys = normalizeKeyConfig(source, currentKeyConfig.trans_model_pool);
    nextKeys.trans_model_pool = currentKeyConfig.trans_model_pool;
  }
  const serialized = serializeKeyConfig(nextKeys);
  atomicWriteJson(KEY_PATH, serialized);
  currentKeyConfig = serialized;
  currentConfig = normalizeConfig(readRootConfig(), currentKeyConfig);
  return currentConfig;
}

// 切换当前图片中转节点，选择结果写入 key.json（个人偏好，不进 config）。
function selectTransModelNode(nodeId) {
  const requestedId = String(nodeId || "").trim();
  const pool = normalizeTransModelPool(currentKeyConfig.trans_model_pool, {
    includeSecrets: true,
    allowEmpty: false
  });
  let matched = false;
  for (let index = 0; index < pool.nodes.length; index += 1) {
    if (pool.nodes[index].id === requestedId) matched = true;
  }
  if (!matched) throw new Error(`找不到图片中转节点：${requestedId}`);
  pool.active = requestedId;
  currentKeyConfig.trans_model_pool = pool;
  atomicWriteJson(KEY_PATH, serializeKeyConfig(currentKeyConfig));
  currentConfig = normalizeConfig(readRootConfig(), currentKeyConfig);
  return currentConfig;
}

// 根据后台当前激活节点选择下一项，到列表末尾后循环回第一项。
function selectNextTransModelNode() {
  const pool = currentConfig.trans_model_pool;
  if (!pool.nodes.length) throw new Error("key.json 未配置任何图片中转节点");
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

// 返回前端可用但不暴露完整密钥的配置；节点列表来自 key.json。
function publicConfig(config = currentConfig) {
  const imageApi = config.patternRedraw.imageApi;
  const moonshot = config.shared.moonshot;
  const infringement = config.patternRedraw.infringement;
  const elementExtraction = config.elementExtraction;
  const productSettings = getElementProductSettings();
  const productNames = Object.keys(productSettings.productPrompts);
  const keyMap = transModelKeyMap(currentKeyConfig);
  const secretPool = currentKeyConfig.trans_model_pool || { nodes: [] };
  const publicNodes = [];
  for (let index = 0; index < secretPool.nodes.length; index += 1) {
    const node = secretPool.nodes[index];
    const nodeApiKey = keyMap[node.id] || "";
    publicNodes.push({
      id: node.id,
      name: node.name,
      hasKey: Boolean(nodeApiKey),
      key: maskKey(nodeApiKey),
      baseurl: node.baseurl,
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
      active: secretPool.active || config.trans_model_pool.active,
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
