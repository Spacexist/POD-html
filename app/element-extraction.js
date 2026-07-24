"use strict";

/**
 * 管理“元素提取”模块的目录读取、拼图、后台请求、结果编辑和导出。
 */
class ElementExtractionModule {
  /** 初始化模块状态并绑定需要复用的事件方法。 */
  constructor() {
    this.items = [];
    this.results = new Map();
    this.running = false;
    this.nextBatchIndex = 0;
    this.completedBatchCount = 0;
    this.totalBatchCount = 0;
    this.failedBatchCount = 0;
    this.hasMoonshotKey = false;
    this.activeRequestIds = new Set();
    this.requestThreadNumbers = new Map();
    this.requestGroupNumbers = new Map();
    this.workerGroupNumbers = new Map();
    this.traceEventSource = null;
    this.config = {
      batchSize: 9,
      concurrency: 3,
      thinkingEnabled: false,
      prefix: "",
      suffix: "",
      prompt: ""
    };
    this.handlePatternTabClick = this.handlePatternTabClick.bind(this);
    this.handleElementTabClick = this.handleElementTabClick.bind(this);
    this.handleChooseFolderClick = this.handleChooseFolderClick.bind(this);
    this.handleFolderChange = this.handleFolderChange.bind(this);
    this.handleRunClick = this.handleRunClick.bind(this);
    this.handleRetryClick = this.handleRetryClick.bind(this);
    this.handleThinkingClick = this.handleThinkingClick.bind(this);
    this.handleAffixChange = this.handleAffixChange.bind(this);
    this.handleSaveClick = this.handleSaveClick.bind(this);
    this.handleRemoveSpacesClick = this.handleRemoveSpacesClick.bind(this);
    this.handleJsonClick = this.handleJsonClick.bind(this);
    this.handleExcelClick = this.handleExcelClick.bind(this);
    this.handleExportImagesClick = this.handleExportImagesClick.bind(this);
    this.handleResultActionClick = this.handleResultActionClick.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
    this.handleTraceEvent = this.handleTraceEvent.bind(this);
  }

  /** 缓存 DOM、绑定事件、加载配置并显示默认模块。 */
  init() {
    this.cacheElements();
    this.bindEvents();
    this.switchModule("patternRedraw");
    this.updateProgress(0, "等待开始");
    this.renderResults();
    this.loadConfig();
    this.connectTraceEvents();
  }

  /** 缓存元素提取模块使用的全部 DOM 节点。 */
  cacheElements() {
    this.elements = {
      patternTab: document.getElementById("patternRedrawTab"),
      elementTab: document.getElementById("elementExtractionTab"),
      patternModule: document.getElementById("patternRedrawModule"),
      elementModule: document.getElementById("elementExtractionModule"),
      patternActions: document.getElementById("patternRedrawActions"),
      chooseFolder: document.getElementById("elementChooseFolder"),
      folderInput: document.getElementById("elementFolderInput"),
      folderName: document.getElementById("elementFolderName"),
      imageCount: document.getElementById("elementImageCount"),
      empty: document.getElementById("elementEmpty"),
      imageGrid: document.getElementById("elementImageGrid"),
      providerState: document.getElementById("elementProviderState"),
      prefix: document.getElementById("elementPrefix"),
      suffix: document.getElementById("elementSuffix"),
      concurrency: document.getElementById("elementConcurrency"),
      thinkingToggle: document.getElementById("elementThinkingToggle"),
      run: document.getElementById("elementRun"),
      retry: document.getElementById("elementRetry"),
      save: document.getElementById("elementSave"),
      removeSpaces: document.getElementById("elementRemoveSpaces"),
      json: document.getElementById("elementJson"),
      excel: document.getElementById("elementExcel"),
      exportImages: document.getElementById("elementExportImages"),
      retryAll: document.getElementById("elementRetryAll"),
      progressText: document.getElementById("elementProgressText"),
      progressValue: document.getElementById("elementProgressValue"),
      progressBar: document.getElementById("elementProgressBar"),
      resultsBody: document.getElementById("elementResultsBody"),
      log: document.getElementById("elementLog")
    };
  }

  /** 绑定模块切换、目录、运行、编辑和导出事件。 */
  bindEvents() {
    this.elements.patternTab.addEventListener("click", this.handlePatternTabClick);
    this.elements.elementTab.addEventListener("click", this.handleElementTabClick);
    this.elements.chooseFolder.addEventListener("click", this.handleChooseFolderClick);
    this.elements.folderInput.addEventListener("change", this.handleFolderChange);
    this.elements.run.addEventListener("click", this.handleRunClick);
    this.elements.retry.addEventListener("click", this.handleRetryClick);
    this.elements.thinkingToggle.addEventListener("click", this.handleThinkingClick);
    this.elements.prefix.addEventListener("change", this.handleAffixChange);
    this.elements.suffix.addEventListener("change", this.handleAffixChange);
    this.elements.save.addEventListener("click", this.handleSaveClick);
    this.elements.removeSpaces.addEventListener("click", this.handleRemoveSpacesClick);
    this.elements.json.addEventListener("click", this.handleJsonClick);
    this.elements.excel.addEventListener("click", this.handleExcelClick);
    this.elements.exportImages.addEventListener("click", this.handleExportImagesClick);
    this.elements.retryAll.addEventListener("click", this.handleRetryClick);
    this.elements.resultsBody.addEventListener("click", this.handleResultActionClick);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  /** 连接项目现有 SSE 通道，接收元素提取后台与 Moonshot 的实时节点。 */
  connectTraceEvents() {
    if (this.traceEventSource) this.traceEventSource.close();
    this.traceEventSource = new EventSource("/api/events");
    this.traceEventSource.addEventListener("element.extraction.trace", this.handleTraceEvent);
  }

  /** 打印当前任务的后台状态，并忽略逐字增量，只显示最终 JSON。 */
  handleTraceEvent(event) {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      this.appendLog("SSE", `无法解析后台事件：${error.message}`);
      return;
    }
    if (!payload.requestId || !this.activeRequestIds.has(payload.requestId)) return;
    const threadNumber = this.requestThreadNumbers.get(payload.requestId) || 0;
    const groupNumber = this.requestGroupNumbers.get(payload.requestId) || 0;
    if (
      payload.stage === "moonshot_sse_response" ||
      payload.stage === "moonshot_content" ||
      payload.stage === "moonshot_answer_delta" ||
      payload.stage === "moonshot_reasoning_progress"
    ) {
      return;
    }
    if (payload.stage === "moonshot_final_json") {
      const finalItems = payload.details && Array.isArray(payload.details.items)
        ? payload.details.items
        : [];
      this.appendLog(
        "FINAL JSON",
        JSON.stringify(finalItems, null, 2),
        threadNumber,
        groupNumber
      );
      return;
    }
    let detailsText = "";
    if (payload.details && Object.keys(payload.details).length) {
      detailsText = `\nDetails:\n${JSON.stringify(payload.details, null, 2)}`;
    }
    this.appendLog(
      `SSE ${payload.requestId}`,
      `${payload.stage}: ${String(payload.message || "")}${detailsText}`,
      threadNumber,
      groupNumber
    );
  }

  /** 从公开配置接口读取模块 2 默认值和共享 Moonshot 状态。 */
  async loadConfig() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const raw = await response.text();
      if (!response.ok) throw new Error(raw.slice(0, 300));
      const payload = JSON.parse(raw);
      const moduleConfig = payload.elementExtraction || {};
      this.config.batchSize = this.clampInteger(moduleConfig.batchSize, 1, 9, 9);
      this.config.concurrency = this.clampInteger(moduleConfig.concurrency, 1, 4, 3);
      this.config.thinkingEnabled = moduleConfig.thinkingEnabled === true;
      this.config.prefix = String(moduleConfig.prefix || "");
      this.config.suffix = String(moduleConfig.suffix || "");
      this.config.prompt = String(moduleConfig.prompt_prefix_model || "");
      this.elements.prefix.value = this.config.prefix;
      this.elements.suffix.value = this.config.suffix;
      this.elements.concurrency.value = String(this.config.concurrency);
      this.renderThinkingToggle();
      this.hasMoonshotKey = Boolean(payload.moonshot && payload.moonshot.hasKey);
      const model = payload.moonshot && payload.moonshot.model ? payload.moonshot.model : "未配置模型";
      this.elements.providerState.textContent = this.hasMoonshotKey
        ? `shared.moonshot · ${model}`
        : "shared.moonshot 未配置 Key";
      this.appendLog("CONFIG", `元素提取配置已读取，模型 ${model}`);
    } catch (error) {
      this.hasMoonshotKey = false;
      this.elements.providerState.textContent = `配置读取失败：${error.message}`;
      this.appendLog("ERROR", `配置读取失败：${error.message}`);
    }
  }

  /** 将数值限制在指定整数范围内。 */
  clampInteger(value, minimum, maximum, fallback) {
    const number = Math.floor(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  /** 切换回印花重绘模块。 */
  handlePatternTabClick() {
    this.switchModule("patternRedraw");
  }

  /** 切换到元素提取模块。 */
  handleElementTabClick() {
    this.switchModule("elementExtraction");
  }

  /** 切换模块视图，同时保留各模块当前内存状态。 */
  switchModule(moduleName) {
    const showElement = moduleName === "elementExtraction";
    this.elements.patternTab.classList.toggle("active", !showElement);
    this.elements.elementTab.classList.toggle("active", showElement);
    this.elements.patternModule.classList.toggle("hidden", showElement);
    this.elements.elementModule.classList.toggle("hidden", !showElement);
    this.elements.patternActions.classList.toggle("hidden", showElement);
    document.title = showElement ? "元素提取 · POD 图像工作台" : "印花重绘 · POD 图像工作台";
  }

  /** 打开浏览器目录选择器。 */
  handleChooseFolderClick() {
    this.elements.folderInput.click();
  }

  /** 接收目录文件并建立去重后的图片条目。 */
  handleFolderChange(event) {
    this.releaseImageUrls();
    this.items = [];
    this.results.clear();
    const seenIds = new Set();
    const files = event.target.files;
    let duplicateCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!this.isSupportedImage(file.name)) continue;
      const itemId = this.getItemId(file.name);
      if (seenIds.has(itemId)) {
        duplicateCount += 1;
        continue;
      }
      seenIds.add(itemId);
      this.items.push({
        id: itemId,
        file,
        url: URL.createObjectURL(file)
      });
    }
    this.sortItems();
    this.elements.folderName.textContent = this.getFolderName(files) || "已选择图片目录";
    this.elements.imageCount.textContent = `${this.items.length} 张`;
    this.renderImageGrid();
    this.renderResults();
    this.updateProgress(0, "等待开始");
    this.clearLog();
    this.appendLog("LOAD", `已载入 ${this.items.length} 张图片`);
    if (duplicateCount) this.appendLog("WARN", `跳过 ${duplicateCount} 个重复货号`);
  }

  /** 使用稳定的自然排序整理图片货号。 */
  sortItems() {
    for (let left = 0; left < this.items.length; left += 1) {
      for (let right = left + 1; right < this.items.length; right += 1) {
        const comparison = this.items[left].id.localeCompare(this.items[right].id, "zh-CN", {
          numeric: true,
          sensitivity: "base"
        });
        if (comparison > 0) {
          const current = this.items[left];
          this.items[left] = this.items[right];
          this.items[right] = current;
        }
      }
    }
  }

  /** 判断文件名是否为模块支持的图片格式。 */
  isSupportedImage(fileName) {
    const dotIndex = String(fileName || "").lastIndexOf(".");
    if (dotIndex < 0) return false;
    const extension = fileName.slice(dotIndex).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp", ".bmp"].includes(extension);
  }

  /** 从文件名提取不带扩展名的货号。 */
  getItemId(fileName) {
    const dotIndex = String(fileName || "").lastIndexOf(".");
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : String(fileName || "");
  }

  /** 从目录选择器的相对路径提取顶层目录名。 */
  getFolderName(fileList) {
    if (!fileList || !fileList.length) return "";
    const relativePath = fileList[0].webkitRelativePath || "";
    const parts = relativePath.split("/");
    return parts.length > 1 ? parts[0] : "已选择图片目录";
  }

  /** 释放此前目录图片使用的对象 URL。 */
  releaseImageUrls() {
    for (let index = 0; index < this.items.length; index += 1) {
      URL.revokeObjectURL(this.items[index].url);
    }
  }

  /** 页面关闭前释放全部对象 URL。 */
  handleBeforeUnload() {
    this.releaseImageUrls();
    if (this.traceEventSource) this.traceEventSource.close();
  }

  /** 渲染当前目录中的图片缩略图。 */
  renderImageGrid() {
    this.elements.imageGrid.replaceChildren();
    if (!this.items.length) {
      this.elements.empty.classList.remove("hidden");
      this.elements.imageGrid.classList.add("hidden");
      return;
    }
    this.elements.empty.classList.add("hidden");
    this.elements.imageGrid.classList.remove("hidden");
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const figure = document.createElement("figure");
      figure.className = "element-image-card";
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = `${item.id} 商品图片`;
      image.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = item.id;
      figure.appendChild(image);
      figure.appendChild(caption);
      this.elements.imageGrid.appendChild(figure);
    }
  }

  /** 校验后开始一次全量元素提取。 */
  async handleRunClick() {
    if (this.running) return;
    if (!this.items.length) {
      window.alert("请先选择包含商品图片的目录。");
      return;
    }
    if (!this.hasMoonshotKey) {
      window.alert("请先通过左上角配置文件设置 shared.moonshot.apiKey。");
      return;
    }
    this.results.clear();
    this.renderResults();
    await this.runExtraction(this.items, false);
  }

  /** 仅重试当前未识别或请求失败的图片。 */
  async handleRetryClick() {
    if (this.running) return;
    const failedItems = [];
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const result = this.results.get(item.id);
      if (!result || result.status !== "已完成") failedItems.push(item);
    }
    if (!failedItems.length) {
      window.alert("当前没有需要重试的图片。");
      return;
    }
    if (!this.hasMoonshotKey) {
      window.alert("请先配置 shared.moonshot.apiKey。");
      return;
    }
    await this.runExtraction(failedItems, true);
  }

  /** 切换当前元素提取任务是否启用 Moonshot 推理模式。 */
  handleThinkingClick() {
    if (this.running) return;
    this.config.thinkingEnabled = !this.config.thinkingEnabled;
    this.renderThinkingToggle();
    this.appendLog(
      "MODE",
      this.config.thinkingEnabled ? "已切换为推理模式" : "已切换为不推理快速模式"
    );
  }

  /** 根据当前配置刷新推理模式按钮的文字和选中状态。 */
  renderThinkingToggle() {
    this.elements.thinkingToggle.setAttribute(
      "aria-pressed",
      this.config.thinkingEnabled ? "true" : "false"
    );
    this.elements.thinkingToggle.textContent = this.config.thinkingEnabled
      ? "推理 · 较慢"
      : "不推理 · 快速";
  }

  /** 在提取完成后将当前前后缀重新应用到全部内存结果。 */
  handleAffixChange() {
    if (!this.results.size) return;
    this.syncEdits();
    this.applyAffixesToResults();
    this.renderResults();
    this.appendLog(
      "AFFIX",
      `已重新应用前后缀：前缀 ${this.elements.prefix.value.length} 字符 / 后缀 ${this.elements.suffix.value.length} 字符`
    );
  }

  /** 根据当前前后缀重新计算全部组合结果，不重新请求模型。 */
  applyAffixesToResults() {
    const entries = this.results.entries();
    let next = entries.next();
    while (!next.done) {
      const result = next.value[1];
      result.fullName = this.combineResult(result.element);
      this.results.set(next.value[0], result);
      next = entries.next();
    }
  }

  /** 创建批次和并发工作线程，并保证单批失败不阻塞其他批次。 */
  async runExtraction(itemsToProcess, isRetry) {
    const extractionStartedAt = performance.now();
    this.running = true;
    this.setBusyState(true);
    if (!isRetry) this.clearLog();
    this.appendLog("START", isRetry ? "开始重试未识别图片" : "开始批量提取元素");
    const batches = this.createBatches(itemsToProcess, this.config.batchSize);
    this.nextBatchIndex = 0;
    this.completedBatchCount = 0;
    this.failedBatchCount = 0;
    this.totalBatchCount = batches.length;
    this.activeRequestIds.clear();
    this.requestThreadNumbers.clear();
    this.requestGroupNumbers.clear();
    this.workerGroupNumbers.clear();
    this.updateProgress(5, "准备 3×3 拼图");
    const requestedConcurrency = this.clampInteger(this.elements.concurrency.value, 1, 4, 3);
    const workerCount = Math.min(requestedConcurrency, batches.length);
    this.appendLog(
      "PLAN",
      `图片 ${itemsToProcess.length} 张 / 批次 ${batches.length} 组 / 每组最多 ${this.config.batchSize} 张 / 工作线程 ${workerCount}`
    );
    this.appendLog(
      "PLAN",
      `固定后台提示词 / ${this.config.thinkingEnabled ? "推理模式" : "不推理快速模式"} / 前缀 ${this.elements.prefix.value.length} 字符 / 后缀 ${this.elements.suffix.value.length} 字符`
    );
    const workers = [];
    for (let index = 0; index < workerCount; index += 1) {
      this.appendLog(`W${index + 1}`, "工作线程已创建");
      workers.push(this.runBatchWorker(batches, index + 1));
    }
    try {
      await Promise.all(workers);
      this.updateProgress(100, this.failedBatchCount ? "部分完成" : "处理完成");
      this.appendLog(
        "DONE",
        `处理结束：${itemsToProcess.length} 张，失败批次 ${this.failedBatchCount}，总耗时 ${Math.round(performance.now() - extractionStartedAt)}ms`
      );
    } finally {
      this.running = false;
      this.setBusyState(false);
      this.renderResults();
      this.appendLog("STATE", "运行状态已释放，操作按钮已恢复");
    }
  }

  /** 将图片条目按配置数量拆成连续批次。 */
  createBatches(items, batchSize) {
    const batches = [];
    for (let index = 0; index < items.length; index += batchSize) {
      batches.push(items.slice(index, index + batchSize));
    }
    return batches;
  }

  /** 持续领取批次，捕获单批错误并更新总体进度。 */
  async runBatchWorker(batches, workerNumber) {
    this.appendLog(`W${workerNumber}`, "工作线程开始领取批次");
    while (this.nextBatchIndex < batches.length) {
      const batchIndex = this.nextBatchIndex;
      this.nextBatchIndex += 1;
      const batch = batches[batchIndex];
      this.workerGroupNumbers.set(workerNumber, batchIndex + 1);
      this.appendLog(
        `W${workerNumber}`,
        `已领取第 ${batchIndex + 1}/${batches.length} 组，共 ${batch.length} 张`
      );
      try {
        await this.processBatch(batch, batchIndex, workerNumber);
      } catch (error) {
        this.failedBatchCount += 1;
        this.markBatchFailed(batch, error.message);
        this.appendLog(`W${workerNumber}`, `第 ${batchIndex + 1} 组失败：${error.message}`);
      }
      this.completedBatchCount += 1;
      const progress = 10 + Math.round((this.completedBatchCount / this.totalBatchCount) * 85);
      this.updateProgress(
        progress,
        `处理中 ${this.completedBatchCount}/${this.totalBatchCount}`
      );
      this.renderResults();
      this.appendLog(
        `W${workerNumber}`,
        `第 ${batchIndex + 1} 组已结束，总进度 ${this.completedBatchCount}/${this.totalBatchCount}`
      );
      this.workerGroupNumbers.delete(workerNumber);
    }
    this.appendLog(`W${workerNumber}`, "没有剩余批次，工作线程结束");
  }

  /** 生成一个 3×3 拼图并合并后台返回的结构化结果。 */
  async processBatch(batch, batchIndex, workerNumber) {
    const batchStartedAt = performance.now();
    const batchNumber = batchIndex + 1;
    const logTag = `W${workerNumber}`;
    const requestId = `element-${Date.now()}-${workerNumber}-${batchNumber}`;
    this.activeRequestIds.add(requestId);
    this.requestThreadNumbers.set(requestId, workerNumber);
    this.requestGroupNumbers.set(requestId, batchNumber);
    const itemIds = [];
    for (let index = 0; index < batch.length; index += 1) itemIds.push(batch[index].id);
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组开始，请求编号 ${requestId}，货号：${itemIds.join(", ")}`
    );
    this.appendLog(logTag, `第 ${batchNumber} 组开始生成 3×3 拼图`);
    const collage = await this.createGridCollage(batch, logTag, batchNumber);
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组拼图完成，Data URL ${collage.length} 字符，准备请求后台`
    );
    const rows = await this.callElementApi(collage, itemIds, requestId, logTag, batchNumber);
    this.appendLog(logTag, `第 ${batchNumber} 组开始合并 ${rows.length} 条模型结果`);
    const returnedIds = new Set();
    const allowedIds = new Set(itemIds);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row || !row.id || !row.description) continue;
      const itemId = String(row.id).trim();
      const description = String(row.description).trim();
      if (!allowedIds.has(itemId)) continue;
      returnedIds.add(itemId);
      this.results.set(itemId, {
        element: description,
        fullName: this.combineResult(description),
        status: "已完成",
        error: ""
      });
    }
    for (let index = 0; index < itemIds.length; index += 1) {
      const itemId = itemIds[index];
      if (!returnedIds.has(itemId)) {
        this.results.set(itemId, {
          element: "未识别/图片无显著印花",
          fullName: this.combineResult("未识别/图片无显著印花"),
          status: "待重试",
          error: "模型未返回该货号"
        });
      }
    }
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组合并完成：返回 ${rows.length} 条 / 请求 ${itemIds.length} 条 / 耗时 ${Math.round(performance.now() - batchStartedAt)}ms`
    );
  }

  /** 将失败批次的全部图片标记为待重试。 */
  markBatchFailed(batch, message) {
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      this.results.set(item.id, {
        element: "提取失败",
        fullName: this.combineResult("提取失败"),
        status: "待重试",
        error: message
      });
    }
  }

  /** 使用 Canvas 生成最多九张图片的红底标签 3×3 JPEG。 */
  async createGridCollage(batch, logTag, batchNumber) {
    const collageStartedAt = performance.now();
    const decodeSummaries = [];
    const tileSize = 500;
    const columns = 3;
    const rows = 3;
    const canvas = document.createElement("canvas");
    canvas.width = columns * tileSize;
    canvas.height = rows * tileSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建 Canvas 2D 上下文");
    context.fillStyle = "#eef1f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组 Canvas ${canvas.width}×${canvas.height}，开始解码并绘制 ${batch.length} 张图片`
    );
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      const decodeStartedAt = performance.now();
      let bitmap;
      try {
        bitmap = await createImageBitmap(item.file);
      } catch (error) {
        throw new Error(`第 ${index + 1}/${batch.length} 张 ${item.id} 解码失败：${error.message}`);
      }
      const bitmapWidth = bitmap.width;
      const bitmapHeight = bitmap.height;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = column * tileSize;
      const y = row * tileSize;
      this.drawCoverImage(context, bitmap, x, y, tileSize, tileSize);
      bitmap.close();
      this.drawItemLabel(context, item.id, x, y);
      context.strokeStyle = "rgba(30, 38, 52, 0.35)";
      context.lineWidth = 2;
      context.strokeRect(x, y, tileSize, tileSize);
      decodeSummaries.push(
        `${index + 1}/${batch.length} ${item.id} ${bitmapWidth}×${bitmapHeight} ${this.formatBytes(item.file.size)} ${Math.round(performance.now() - decodeStartedAt)}ms`
      );
    }
    this.appendLog(logTag, `第 ${batchNumber} 组解码与绘制完成：${decodeSummaries.join(" | ")}`);
    this.appendLog(logTag, `第 ${batchNumber} 组开始编码 JPEG`);
    const collage = canvas.toDataURL("image/jpeg", 0.86);
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组 JPEG 编码完成，约 ${this.formatBytes(Math.round(collage.length * 0.75))}，${Math.round(performance.now() - collageStartedAt)}ms`
    );
    return collage;
  }

  /** 按 cover 规则绘制图片，避免非等比拉伸。 */
  drawCoverImage(context, bitmap, x, y, width, height) {
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (bitmap.width - sourceWidth) / 2;
    const sourceY = (bitmap.height - sourceHeight) / 2;
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height
    );
  }

  /** 在拼图左上角绘制红底、金边、白字货号。 */
  drawItemLabel(context, itemId, x, y) {
    const label = ` [${itemId}] `;
    context.font = "bold 36px Microsoft YaHei, sans-serif";
    const width = Math.ceil(context.measureText(label).width) + 24;
    const height = 58;
    context.fillStyle = "rgb(220, 0, 0)";
    context.fillRect(x, y, width, height);
    context.strokeStyle = "rgb(255, 215, 0)";
    context.lineWidth = 4;
    context.strokeRect(x + 2, y + 2, width - 4, height - 4);
    context.fillStyle = "#ffffff";
    context.textBaseline = "middle";
    context.fillText(label, x + 10, y + height / 2 + 1);
  }

  /** 将拼图和当前提示词发送给本地元素提取代理。 */
  async callElementApi(collage, itemIds, requestId, logTag, batchNumber) {
    const requestStartedAt = performance.now();
    const prompt = this.buildPrompt(itemIds);
    const requestHeaders = {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      "X-Moonshot-Thinking": this.config.thinkingEnabled ? "enabled" : "disabled"
    };
    const requestPayload = {
      image: collage,
      prompt
    };
    const requestBody = JSON.stringify(requestPayload);
    const requestLogPayload = {
      image: this.summarizeDataUrl(collage),
      prompt
    };
    this.appendLog(
      logTag,
      `HTTP REQUEST\nPOST /api/element-extract\nHeaders:\n${JSON.stringify(requestHeaders, null, 2)}\nBody（图片 Base64 已折叠，实际正文 ${this.formatBytes(new Blob([requestBody]).size)}）:\n${JSON.stringify(requestLogPayload, null, 2)}`
    );
    this.appendLog(logTag, `第 ${batchNumber} 组请求 ${requestId} 已发送，等待后台与 Moonshot 响应`);
    const response = await fetch("/api/element-extract", {
      method: "POST",
      headers: requestHeaders,
      body: requestBody
    });
    const responseHeaders = {};
    const headerEntries = response.headers.entries();
    let headerEntry = headerEntries.next();
    while (!headerEntry.done) {
      responseHeaders[headerEntry.value[0]] = headerEntry.value[1];
      headerEntry = headerEntries.next();
    }
    const raw = await response.text();
    this.appendLog(
      logTag,
      `HTTP RESPONSE\nStatus: ${response.status} ${response.statusText}\nHeaders:\n${JSON.stringify(responseHeaders, null, 2)}\nBody:\n${raw}\n耗时: ${Math.round(performance.now() - requestStartedAt)}ms`
    );
    let payload;
    try {
      payload = JSON.parse(raw);
      this.appendLog(logTag, `第 ${batchNumber} 组响应 JSON 解析完成`);
    } catch (error) {
      throw new Error(`接口返回不是 JSON：${raw.slice(0, 300)}`);
    }
    if (!response.ok) {
      const message = payload.error && payload.error.message
        ? payload.error.message
        : raw.slice(0, 300);
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    const rows = Array.isArray(payload.items) ? payload.items : [];
    const serverElapsed = Number(payload.elapsedMs);
    const serverElapsedText = Number.isFinite(serverElapsed) ? `，后台耗时 ${serverElapsed}ms` : "";
    this.appendLog(
      logTag,
      `第 ${batchNumber} 组接口成功：${rows.length} 条结果${serverElapsedText}，请求编号 ${payload.requestId || requestId}`
    );
    return rows;
  }

  /** 将当前批次货号注入配置提示词，生成直接发送给后台的 prompt。 */
  buildPrompt(itemIds) {
    const template = String(this.config.prompt || "").trim();
    if (!template) throw new Error("elementExtraction.prompt_prefix_model 未配置");
    return template.replace(/\{item_ids\}/g, itemIds.join(", "));
  }

  /** 将大型图片 Data URL 折叠为可读摘要，避免日志渲染数十万字符。 */
  summarizeDataUrl(value) {
    const text = String(value || "");
    const commaIndex = text.indexOf(",");
    const prefix = commaIndex >= 0 ? text.slice(0, commaIndex + 1) : "data:image";
    const encodedLength = commaIndex >= 0 ? text.length - commaIndex - 1 : text.length;
    return `${prefix}<base64 ${encodedLength} 字符，约 ${this.formatBytes(Math.round(encodedLength * 0.75))}>`;
  }

  /** 将字节数格式化为便于运行日志阅读的文本。 */
  formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${Math.round(value)} B`;
  }

  /** 把元素描述与当前前后缀组合为完整结果。 */
  combineResult(description) {
    return `${this.elements.prefix.value}${description}${this.elements.suffix.value}`;
  }

  /** 渲染结果表，并允许编辑元素和组合结果。 */
  renderResults() {
    this.elements.resultsBody.replaceChildren();
    if (!this.items.length) {
      this.renderPlaceholder("运行提取任务后，结果会显示在这里。");
      this.updateButtons();
      return;
    }
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const result = this.results.get(item.id);
      const row = document.createElement("tr");
      row.dataset.itemId = item.id;
      const idCell = document.createElement("td");
      idCell.textContent = item.id;
      const elementCell = document.createElement("td");
      elementCell.dataset.field = "element";
      elementCell.contentEditable = result ? "true" : "false";
      elementCell.textContent = result ? result.element : "等待提取";
      const fullNameCell = document.createElement("td");
      fullNameCell.dataset.field = "fullName";
      fullNameCell.contentEditable = result ? "true" : "false";
      fullNameCell.textContent = result ? result.fullName : "—";
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = result && result.status === "已完成"
        ? "element-status"
        : "element-status pending";
      status.textContent = result ? result.status : "待处理";
      if (result && result.error) status.title = result.error;
      statusCell.appendChild(status);
      const actionCell = document.createElement("td");
      if (result && result.status !== "已完成") {
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.dataset.retryItem = item.id;
        retryButton.textContent = "手动重试";
        retryButton.disabled = this.running;
        actionCell.appendChild(retryButton);
      } else {
        actionCell.textContent = "—";
      }
      row.appendChild(idCell);
      row.appendChild(elementCell);
      row.appendChild(fullNameCell);
      row.appendChild(statusCell);
      row.appendChild(actionCell);
      this.elements.resultsBody.appendChild(row);
    }
    this.updateButtons();
  }

  /** 渲染结果表占位行。 */
  renderPlaceholder(message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = message;
    row.appendChild(cell);
    this.elements.resultsBody.appendChild(row);
  }

  /** 根据结果数量和运行状态更新按钮可用性。 */
  updateButtons() {
    const hasResults = this.results.size > 0;
    let hasPending = false;
    let hasCompleted = false;
    const values = this.results.values();
    let next = values.next();
    while (!next.done) {
      if (next.value.status !== "已完成") {
        hasPending = true;
      } else {
        hasCompleted = true;
      }
      next = values.next();
    }
    this.elements.save.disabled = !hasResults || this.running;
    this.elements.removeSpaces.disabled = !hasResults || this.running;
    this.elements.json.disabled = !hasResults || this.running;
    this.elements.excel.disabled = !hasResults || this.running;
    this.elements.exportImages.disabled = !hasCompleted || this.running;
    this.elements.retry.disabled = !hasPending || this.running;
    this.elements.retryAll.disabled = !hasPending || this.running;
    const manualRetryButtons = this.elements.resultsBody.querySelectorAll("[data-retry-item]");
    for (let index = 0; index < manualRetryButtons.length; index += 1) {
      manualRetryButtons[index].disabled = this.running;
    }
  }

  /** 只重试用户点击的单个失败图片。 */
  async handleResultActionClick(event) {
    const button = event.target.closest("button[data-retry-item]");
    if (!button || this.running) return;
    const itemId = String(button.dataset.retryItem || "");
    let targetItem = null;
    for (let index = 0; index < this.items.length; index += 1) {
      if (this.items[index].id === itemId) {
        targetItem = this.items[index];
        break;
      }
    }
    if (!targetItem) return;
    this.appendLog("RETRY", `手动重试 ${itemId}`);
    await this.runExtraction([targetItem], true);
  }

  /** 将表格中的人工修改同步回内存结果。 */
  syncEdits() {
    const rows = this.elements.resultsBody.querySelectorAll("tr[data-item-id]");
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const result = this.results.get(row.dataset.itemId);
      if (!result) continue;
      const elementCell = row.querySelector('[data-field="element"]');
      const fullNameCell = row.querySelector('[data-field="fullName"]');
      if (elementCell) result.element = elementCell.textContent.trim();
      if (fullNameCell) result.fullName = fullNameCell.textContent.trim();
      result.status = result.element && !result.element.startsWith("未识别") &&
        result.element !== "提取失败" ? "已完成" : "待重试";
      this.results.set(row.dataset.itemId, result);
    }
  }

  /** 保存当前表格编辑并重新渲染状态。 */
  handleSaveClick() {
    this.syncEdits();
    this.renderResults();
    this.appendLog("SAVE", "人工修改已保存到当前页面内存");
  }

  /** 批量删除提取元素和前后缀组合结果中的全部空白字符。 */
  handleRemoveSpacesClick() {
    if (this.running) return;
    this.syncEdits();
    let changedCount = 0;
    const values = this.results.values();
    let next = values.next();
    while (!next.done) {
      const result = next.value;
      const elementText = String(result.element || "").replace(/\s+/g, "");
      const fullNameText = String(result.fullName || "").replace(/\s+/g, "");
      if (elementText !== result.element || fullNameText !== result.fullName) {
        changedCount += 1;
      }
      result.element = elementText;
      result.fullName = fullNameText;
      next = values.next();
    }
    this.renderResults();
    this.appendLog("CLEAN", `批量去除空格完成：处理 ${this.results.size} 条，修改 ${changedCount} 条`);
  }

  /** 生成用于 JSON、Excel 和 CSV 的三列结果。 */
  buildExportRows() {
    const rows = [];
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const result = this.results.get(item.id);
      rows.push({
        "原本编号 (A列)": item.id,
        "提取元素 (B列)": result ? result.element : "未识别/图片无显著印花",
        "加上前后缀组合结果 (C列)": result
          ? result.fullName
          : this.combineResult("未识别/图片无显著印花")
      });
    }
    return rows;
  }

  /** 导出兼容原工具结构的 JSON 文件。 */
  handleJsonClick() {
    this.syncEdits();
    const rows = this.buildExportRows();
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    this.downloadBlob(blob, `${this.safeFolderName()}_提取结果.json`);
    this.appendLog("EXPORT", "JSON 文件已导出");
  }

  /** 优先导出 Excel，组件不可用时自动回退 CSV。 */
  handleExcelClick() {
    this.syncEdits();
    const rows = this.buildExportRows();
    const baseName = `${this.safeFolderName()}_提取结果`;
    if (window.XLSX) {
      const worksheet = window.XLSX.utils.json_to_sheet(rows);
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, "提取结果");
      window.XLSX.writeFile(workbook, `${baseName}.xlsx`);
      this.appendLog("EXPORT", "Excel 文件已导出");
      return;
    }
    this.downloadCsv(rows, `${baseName}.csv`);
    this.appendLog("WARN", "Excel 组件不可用，已回退导出 CSV");
  }

  /** 选择目标目录，将已完成图片按前后缀组合结果重命名后导出。 */
  async handleExportImagesClick() {
    if (this.running) return;
    this.syncEdits();
    const completedItems = [];
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      const result = this.results.get(item.id);
      if (result && result.status === "已完成" && result.fullName) {
        completedItems.push({ item, result });
      }
    }
    if (!completedItems.length) {
      window.alert("当前没有可导出的已完成图片。");
      return;
    }
    if (typeof window.showDirectoryPicker !== "function") {
      this.downloadRenamedImages(completedItems);
      window.alert("当前浏览器不支持文件夹写入，已改为逐张下载重命名图片。");
      return;
    }
    try {
      const rootDirectory = await window.showDirectoryPicker({ mode: "readwrite" });
      const exportDirectory = await rootDirectory.getDirectoryHandle(
        this.buildExportFolderName(),
        { create: true }
      );
      const usedNames = new Set();
      for (let index = 0; index < completedItems.length; index += 1) {
        const entry = completedItems[index];
        const fileName = this.buildExportImageFileName(
          entry.result.fullName,
          entry.item.file.name,
          usedNames
        );
        const fileHandle = await exportDirectory.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(entry.item.file);
        await writable.close();
      }
      this.appendLog(
        "EXPORT",
        `图片文件夹导出完成：${completedItems.length} 张，文件名使用前后缀组合结果`
      );
      window.alert(`导出完成，共 ${completedItems.length} 张图片。`);
    } catch (error) {
      if (error && error.name === "AbortError") {
        this.appendLog("EXPORT", "已取消选择导出文件夹");
        return;
      }
      this.appendLog("ERROR", `导出图片文件夹失败：${error.message}`);
      window.alert(`导出失败：${error.message}`);
    }
  }

  /** 为一次图片导出生成不重复的目标文件夹名称。 */
  buildExportFolderName() {
    const now = new Date();
    const parts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ];
    return `${this.safeFolderName()}_重命名图片_${parts.join("")}`;
  }

  /** 将组合结果清理为 Windows 合法文件名，并为重复名称追加序号。 */
  buildExportImageFileName(fullName, originalName, usedNames) {
    const extensionMatch = String(originalName || "").match(/\.[A-Za-z0-9]+$/);
    const extension = extensionMatch ? extensionMatch[0].toLowerCase() : ".jpg";
    let baseName = String(fullName || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim();
    if (!baseName) baseName = "未命名图片";
    baseName = baseName.slice(0, Math.max(1, 180 - extension.length));
    let fileName = `${baseName}${extension}`;
    let duplicateIndex = 2;
    while (usedNames.has(fileName.toLowerCase())) {
      const suffix = `-${duplicateIndex}`;
      const limitedBaseName = baseName.slice(
        0,
        Math.max(1, 180 - extension.length - suffix.length)
      );
      fileName = `${limitedBaseName}${suffix}${extension}`;
      duplicateIndex += 1;
    }
    usedNames.add(fileName.toLowerCase());
    return fileName;
  }

  /** 在不支持文件夹写入时逐张下载重命名后的图片。 */
  downloadRenamedImages(completedItems) {
    const usedNames = new Set();
    for (let index = 0; index < completedItems.length; index += 1) {
      const entry = completedItems[index];
      const fileName = this.buildExportImageFileName(
        entry.result.fullName,
        entry.item.file.name,
        usedNames
      );
      this.downloadBlob(entry.item.file, fileName);
    }
    this.appendLog("EXPORT", `已逐张下载 ${completedItems.length} 张重命名图片`);
  }

  /** 返回适合文件名使用的当前目录名称。 */
  safeFolderName() {
    const value = this.elements.folderName.textContent || "元素提取";
    return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  }

  /** 将结果编码为带 BOM 的 CSV 文件。 */
  downloadCsv(rows, fileName) {
    const headers = ["原本编号 (A列)", "提取元素 (B列)", "加上前后缀组合结果 (C列)"];
    const lines = [];
    lines.push(headers.join(","));
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const cells = [];
      for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
        const value = String(rows[rowIndex][headers[columnIndex]] || "");
        cells.push(`"${value.replace(/"/g, '""')}"`);
      }
      lines.push(cells.join(","));
    }
    const blob = new Blob(["\ufeff", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8"
    });
    this.downloadBlob(blob, fileName);
  }

  /** 使用临时链接下载 Blob 文件。 */
  downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(URL.revokeObjectURL.bind(URL, url), 1000);
  }

  /** 更新模块 2 的进度文本和进度条。 */
  updateProgress(value, message) {
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
    this.elements.progressBar.style.width = `${safeValue}%`;
    this.elements.progressValue.textContent = `${safeValue}%`;
    this.elements.progressText.textContent = message;
  }

  /** 切换运行期间的控件禁用状态。 */
  setBusyState(isBusy) {
    this.elements.chooseFolder.disabled = isBusy;
    this.elements.folderInput.disabled = isBusy;
    this.elements.prefix.disabled = isBusy;
    this.elements.suffix.disabled = isBusy;
    this.elements.concurrency.disabled = isBusy;
    this.elements.thinkingToggle.disabled = isBusy;
    this.elements.run.disabled = isBusy;
    this.elements.run.textContent = isBusy ? "正在提取…" : "开始提取";
    this.updateButtons();
  }

  /** 清空日志面板。 */
  clearLog() {
    this.elements.log.textContent = "";
  }

  /** 按 [time][thread][group] 格式追加日志，并自动映射工作线程当前处理的批次。 */
  appendLog(tag, message, threadNumber = 0, groupNumber = 0) {
    const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const workerMatch = String(tag || "").match(/^W(\d+)$/);
    const inferredThreadNumber = workerMatch ? Number(workerMatch[1]) : threadNumber;
    const inferredGroupNumber = workerMatch
      ? Number(this.workerGroupNumbers.get(inferredThreadNumber) || groupNumber)
      : groupNumber;
    const safeThreadNumber = Math.max(0, Math.floor(Number(inferredThreadNumber) || 0));
    const safeGroupNumber = Math.max(0, Math.floor(Number(inferredGroupNumber) || 0));
    const line = `[${now}][thread-${safeThreadNumber}][group-${safeGroupNumber}] ${tag}  ${String(message)}`;
    console.log(`[element-extraction] ${line}`);
    this.elements.log.textContent = this.elements.log.textContent
      ? `${this.elements.log.textContent}\n${line}`
      : line;
    this.elements.log.scrollTop = this.elements.log.scrollHeight;
  }
}

/** 在 DOM 就绪后启动元素提取模块。 */
function startElementExtractionModule() {
  const module = new ElementExtractionModule();
  module.init();
  window.elementExtractionModule = module;
}

document.addEventListener("DOMContentLoaded", startElementExtractionModule);
