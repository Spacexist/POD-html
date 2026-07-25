"use strict";

/**
 * 协调印花重绘、元素提取和套图生成之间的当前会话文件传输。
 */
class PodWorkflowManager {
  /** 初始化工作流使用的同源消息类型。 */
  constructor() {
    this.mockupMessageType = "pod-workflow-patterns";
    this.mockupAckType = "pod-workflow-patterns-ack";
    this.mockupAckTimeoutMs = 10000;
    this.requestSerial = 0;
  }

  /** 将可用 File 对象整理为稳定数组，并跳过无效条目。 */
  normalizeFiles(files) {
    const normalized = [];
    if (!files || typeof files.length !== "number") return normalized;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file instanceof File && file.size > 0) normalized.push(file);
    }
    return normalized;
  }

  /** 覆盖元素提取模块的当前图片，并自动切换到该模块。 */
  transferToElementExtraction(files) {
    const normalized = this.normalizeFiles(files);
    const module = window.elementExtractionModule;
    if (!module || typeof module.loadWorkflowFiles !== "function") {
      throw new Error("元素提取模块尚未完成初始化");
    }
    const result = module.loadWorkflowFiles(normalized, "印花重绘批量传输");
    module.switchModule("elementExtraction");
    return result;
  }

  /** 等待套图 iframe 完成文档加载，避免消息发往尚未初始化的页面。 */
  waitForMockupFrame(frame) {
    const framePath = frame.contentWindow && frame.contentWindow.location
      ? frame.contentWindow.location.pathname
      : "";
    if (framePath === "/mockup" && frame.contentDocument && frame.contentDocument.readyState === "complete") {
      return Promise.resolve();
    }
    return new Promise(function waitForMockupFrameLoad(resolve, reject) {
      let timer = null;

      /** iframe 完成加载后清理等待状态。 */
      function handleFrameLoad() {
        window.clearTimeout(timer);
        frame.removeEventListener("load", handleFrameLoad);
        resolve();
      }

      /** iframe 长时间未加载时结束本次传输。 */
      function handleFrameTimeout() {
        frame.removeEventListener("load", handleFrameLoad);
        reject(new Error("套图生成模块加载超时"));
      }

      frame.addEventListener("load", handleFrameLoad);
      timer = window.setTimeout(handleFrameTimeout, 10000);
    });
  }

  /** 发送文件并等待套图模块返回与本次 requestId 对应的真实处理结果。 */
  waitForMockupAck(frame, requestId, files, folderName) {
    const manager = this;
    return new Promise(function waitForMockupAcknowledgement(resolve, reject) {
      let timer = null;

      /** 清理当前回执监听器和超时计时器。 */
      function cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener("message", handleMockupAck);
      }

      /** 接收并校验来自目标 iframe 的工作流回执。 */
      function handleMockupAck(event) {
        if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
        const payload = event.data;
        if (!payload || payload.type !== manager.mockupAckType || payload.requestId !== requestId) return;
        cleanup();
        if (payload.error) {
          reject(new Error(payload.error));
          return;
        }
        resolve({
          accepted: Number(payload.accepted || 0),
          skipped: Number(payload.skipped || 0),
          failed: Number(payload.failed || 0)
        });
      }

      /** 未收到回执时报告明确超时，禁止提前显示成功。 */
      function handleAckTimeout() {
        cleanup();
        reject(new Error("套图生成模块处理回执超时"));
      }

      window.addEventListener("message", handleMockupAck);
      timer = window.setTimeout(handleAckTimeout, manager.mockupAckTimeoutMs);
      frame.contentWindow.postMessage({
        type: manager.mockupMessageType,
        requestId,
        files,
        folderName
      }, window.location.origin);
    });
  }

  /** 将重命名图片发送到套图 iframe，并返回模块实际载入后的统计。 */
  async transferToMockup(files, folderName) {
    const normalized = this.normalizeFiles(files);
    const frame = document.getElementById("mockupFrame");
    const module = window.elementExtractionModule;
    if (!frame || !frame.contentWindow) throw new Error("套图生成模块尚未完成初始化");
    if (module && typeof module.switchModule === "function") module.switchModule("mockup");
    await this.waitForMockupFrame(frame);
    this.requestSerial += 1;
    const requestId = `${Date.now()}-${this.requestSerial}`;
    return this.waitForMockupAck(
      frame,
      requestId,
      normalized,
      String(folderName || "Workflow 印花组")
    );
  }
}

window.podWorkflow = new PodWorkflowManager();
