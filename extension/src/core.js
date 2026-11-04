/* MIT-derived ChatGPT Automation Workbench. Original queue: aleixmedina9-gif. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQCore = api;
})(globalThis, function () {
  "use strict";
  const MAX_IMPORT_CHARS = 1024 * 1024;
  const MAX_CHECKPOINT_BYTES = 64 * 1024 * 1024;
  const MAX_JOBS = 2000;
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const JOB_KINDS = new Set(["image", "text"]);
  const PROVIDERS = new Set(["chatgpt", "gemini"]);
  const CHAT_MATCHES = [
    "https://chatgpt.com/*",
    "https://www.chatgpt.com/*",
    "https://gemini.google.com/*",
  ];
  function providerForURL(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" || u.username || u.password) return null;
      if (["https://chatgpt.com", "https://www.chatgpt.com"].includes(u.origin))
        return "chatgpt";
      return u.origin === "https://gemini.google.com" ? "gemini" : null;
    } catch {
      return null;
    }
  }
  const taskProvider = (item) =>
    item.provider === undefined ? "chatgpt" : item.provider;
  const submittedStages = new Set([
    "submitting",
    "submitted",
    "generating",
    "downloading",
  ]);

  function csvRows(text) {
    const rows = [];
    let row = [],
      cell = "",
      quoted = false,
      closed = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
          closed = true;
        } else cell += ch;
      } else if (ch === '"' && !cell && !closed) quoted = true;
      else if (ch === ",") {
        row.push(cell);
        cell = "";
        closed = false;
      } else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        cell = "";
        closed = false;
      } else {
        if (closed && !/\s/.test(ch)) throw new Error("CSV 引号后有无效内容");
        if (!closed) cell += ch;
      }
    }
    if (quoted) throw new Error("CSV 引号没有闭合");
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push(row);
    return rows;
  }

  function parsePrompts(input, options = {}) {
    const text = String(input ?? "").replace(/^\uFEFF/, "");
    if (text.length > MAX_IMPORT_CHARS)
      throw new Error("导入内容过大，最多 1 MiB 文本");
    const kind = options.kind || "image";
    let entries;
    if (options.format === "json") {
      try {
        entries = JSON.parse(text);
      } catch {
        throw new Error("JSON 无法解析");
      }
      if (!Array.isArray(entries)) throw new Error("JSON 必须是提示词数组");
    } else if (options.format === "csv") {
      const rows = csvRows(text);
      if (!rows.length) return [];
      const headers = rows.shift().map((x) => x.trim().toLowerCase());
      const pi = headers.findIndex((x) => x === "prompt" || x === "提示词");
      const ki = headers.indexOf("kind");
      if (pi < 0) throw new Error("CSV 需要 prompt 或 提示词 列");
      entries = rows.map((row) => ({
        prompt: row[pi],
        kind: ki >= 0 ? row[ki] || kind : kind,
      }));
    } else {
      entries = text
        .split(options.splitMode === "lines" ? /\r?\n/ : /\r?\n[\t ]*\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
    if (entries.length > MAX_JOBS)
      throw new Error("提示词过多，一次最多 2000 项");
    return entries.map((entry, i) => {
      const value = typeof entry === "string" ? { prompt: entry } : entry;
      if (!value || typeof value.prompt !== "string" || !value.prompt.trim())
        throw new Error(`第 ${i + 1} 项提示词为空`);
      if (value.prompt.length > 20000)
        throw new Error(`第 ${i + 1} 项提示词过长`);
      const jobKind = value.kind || kind;
      if (!JOB_KINDS.has(jobKind)) throw new Error("不支持的任务类型");
      const referenceIds = value.referenceIds ?? options.referenceIds ?? [];
      const provider =
        value.provider === undefined ? options.provider : value.provider;
      if (provider !== undefined && !PROVIDERS.has(provider))
        throw new Error("不支持的任务站点 provider");
      if (
        !Array.isArray(referenceIds) ||
        referenceIds.length > 8 ||
        referenceIds.some((x) => typeof x !== "string" || x.length > 160)
      )
        throw new Error("参考图关联无效");
      return {
        prompt: value.prompt.trim(),
        kind: jobKind,
        referenceIds: [...new Set(referenceIds)],
        ...(provider !== undefined ? { provider } : {}),
      };
    });
  }

  function buildPrompt(raw, settings = {}, kind = "image") {
    const parts = [settings.promptPrefix, raw, settings.promptSuffix]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (kind === "image") {
      if (/^(1:1|16:9|9:16|4:3|3:4)$/.test(settings.aspectRatio || ""))
        parts.push(`画幅要求：${settings.aspectRatio}。`);
      if (settings.imageQuality === "high")
        parts.push("偏好高质量、清晰细节。");
      if (settings.imageQuality === "fast") parts.push("优先简洁、快速完成。");
    }
    return parts.join("\n\n");
  }

  function sanitizePart(value, fallback = "untitled") {
    let result = String(value || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1F\x7F\u202A-\u202E\u2066-\u2069]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "");
    result = Array.from(result).slice(0, 80).join("") || fallback;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result))
      result = "_" + result;
    return result;
  }

  function sanitizeFolder(value = "ChatGPT 工作台") {
    const text = String(value).trim();
    if (/^(?:[a-z]:|[\\/])/i.test(text))
      throw new Error("只能使用下载目录内的相对路径");
    const parts = text.split(/[\\/]+/).filter(Boolean);
    if (parts.length > 4 || parts.some((p) => p === "." || p === ".."))
      throw new Error("下载路径层级或目录名无效");
    return parts.map((x) => sanitizePart(x)).join("/") || "ChatGPT 工作台";
  }
  function browserDownloadFolder(value) {
    if(typeof value!=="string" || !value.trim() || value.length>160 || /[\\<>:"|?*\x00-\x1f]/.test(value))throw new Error("BROWSER_FOLDER_INVALID");
    const result=value.trim(),parts=result.split("/");
    if(parts.length>8 || parts.some(p=>!p || p==="." || p===".." || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error("BROWSER_FOLDER_INVALID");
    return result;
  }

  function failureAction(item) {
    if (item.generatedAssetIds?.length)
      return ["downloading", "done"].includes(item.stage)
        ? "download"
        : "review";
    if (item.submittedAt || submittedStages.has(item.stage)) return "review";
    return "retry";
  }

  function recoverItem(item) {
    const result = { ...item };
    if (result.status !== "running") return result;
    result.status =
      failureAction(result) === "retry" ? "pending" : "needs_review";
    if (result.status === "needs_review")
      result.lastError =
        "页面曾中断，提交或下载结果需要核对；不会自动重新生成。";
    return result;
  }

  function isImageURL(value, provider = "chatgpt") {
    try {
      if (!PROVIDERS.has(provider)) return false;
      if (String(value).startsWith("data:")) {
        parseImageDataURL(value);
        return true;
      }
      const url = new URL(value);
      if (url.protocol === "blob:")
        return providerForURL(url.origin) === provider;
      if (url.protocol !== "https:" || url.username || url.password || url.port)
        return false;
      if (provider === "gemini")
        return url.hostname === "lh3.googleusercontent.com";
      return [
        "chatgpt.com",
        "www.chatgpt.com",
        "oaistatic.com",
        "oaiusercontent.com",
        "oausercontent.com",
      ].some(
        (host) =>
          url.hostname === host ||
          (host !== "chatgpt.com" &&
            host !== "www.chatgpt.com" &&
            url.hostname.endsWith("." + host)),
      );
    } catch {
      return false;
    }
  }

  function safePublicURL(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:" && u.protocol !== "http:") return "";
      u.username = "";
      u.password = "";
      u.search = "";
      u.hash = "";
      return u.href;
    } catch {
      return "";
    }
  }

  function loopbackBase(value) {
    try {
      const u = new URL(value);
      if (
        u.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(u.hostname) ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== "/"
      )
        throw new Error();
      return u.origin;
    } catch {
      throw new Error(
        "知识库地址只允许 HTTP 本机 localhost 或 127.0.0.1，不能包含账号、路径或查询参数",
      );
    }
  }

  function toDataURL(input, mime) {
    const bytes = new Uint8Array(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 16384)
      binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return `data:${mime};base64,${btoa(binary)}`;
  }

  function imageMime(bytes) {
    if (
      bytes.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)
    )
      return "image/png";
    if (
      bytes.length >= 4 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255 &&
      bytes.at(-2) === 255 &&
      bytes.at(-1) === 217
    )
      return "image/jpeg";
    if (
      bytes.length >= 16 &&
      new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
    )
      return "image/webp";
    throw new Error("图片格式无效，仅接受 PNG/JPEG/WebP");
  }

  function parseImageDataURL(value) {
    if (
      typeof value !== "string" ||
      value.length > (MAX_IMAGE_BYTES * 4) / 3 + 128
    )
      throw new Error("图片过大或格式无效");
    const match = value.match(
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/,
    );
    if (!match) throw new Error("图片格式无效，仅接受 PNG/JPEG/WebP");
    let bytes;
    try {
      bytes = Uint8Array.from(atob(match[2]), (ch) => ch.charCodeAt(0));
    } catch {
      throw new Error("图片编码格式无效");
    }
    if (bytes.length > MAX_IMAGE_BYTES || imageMime(bytes) !== match[1])
      throw new Error("图片格式与内容不一致");
    return { mime: match[1], bytes };
  }

  function publicSettings(settings = {}) {
    const allowed = [
      "waitSeconds",
      "maxAttempts",
      "retryDelaySeconds",
      "generationTimeoutSeconds",
      "downloadStartTimeoutSeconds",
      "downloadFolder",
      "checkpointOnStop",
      "promptPrefix",
      "promptSuffix",
      "imageMode",
      "aspectRatio",
      "imageQuality",
      "language",
      "outputKind",
      "splitMode",
      "referenceIds",
      "owuiEndpoint",
      "knowledgeId",
    ];
    return Object.fromEntries(
      allowed
        .filter((k) => Object.hasOwn(settings, k))
        .map((k) => [k, structuredClone(settings[k])]),
    );
  }

  function checkpointRows(items) {
    if (!Array.isArray(items) || items.length > MAX_JOBS)
      throw new Error("检查点任务数量无效");
    const seen = new Set();
    return items.map((raw) => {
      if (
        !raw ||
        typeof raw.id !== "string" ||
        !raw.id ||
        raw.id.length > 160 ||
        seen.has(raw.id)
      )
        throw new Error("检查点任务 ID 无效或重复");
      seen.add(raw.id);
      const base = parsePrompts(
        JSON.stringify([
          {
            prompt: raw.prompt,
            kind: raw.kind,
            referenceIds: raw.referenceIds || [],
            ...(raw.provider !== undefined ? { provider: raw.provider } : {}),
          },
        ]),
        { format: "json" },
      )[0];
      if (
        ![
          "pending",
          "running",
          "done",
          "failed",
          "needs_review",
          "skipped",
        ].includes(raw.status)
      )
        throw new Error("检查点任务状态无效");
      const stage = raw.stage || "pending";
      if (
        ![
          "pending",
          "preparing",
          "submitting",
          "submitted",
          "generating",
          "downloading",
          "done",
        ].includes(stage)
      )
        throw new Error("检查点任务阶段无效");
      const generatedAssetIds = raw.generatedAssetIds || [];
      if (
        !Array.isArray(generatedAssetIds) ||
        generatedAssetIds.length > 200 ||
        generatedAssetIds.some(
          (x) => typeof x !== "string" || !x || x.length > 160,
        )
      )
        throw new Error("检查点图片关联无效");
      return {
        ...base,
        id: raw.id,
        status: raw.status,
        stage,
        attempts: Math.max(0, Math.min(10000, Number(raw.attempts) || 0)),
        submittedAt:
          Number(raw.submittedAt) > 0 ? Number(raw.submittedAt) : null,
        generatedAssetIds: [...new Set(generatedAssetIds)],
        lastError: String(raw.lastError || "").slice(0, 2000),
      };
    });
  }
  function checkpointSettings(settings) {
    return Object.fromEntries(
      Object.entries(publicSettings(settings)).filter(
        ([, v]) =>
          typeof v === "string" ||
          (typeof v === "number" && Number.isFinite(v)) ||
          typeof v === "boolean",
      ),
    );
  }
  function createCheckpoint(state) {
    const checkpoint = {
      format: "cpq-queue",
      version: 1,
      state: {
        items: checkpointRows(state?.items),
        settings: checkpointSettings(state?.settings),
        running: false,
      },
    };
    if (
      new TextEncoder().encode(JSON.stringify(checkpoint)).length >
      MAX_CHECKPOINT_BYTES
    )
      throw new Error("检查点超过 64 MiB，请分批保留任务");
    return checkpoint;
  }
  function restoreCheckpoint(input) {
    let value = input;
    if (typeof input === "string") {
      if (new TextEncoder().encode(input).length > MAX_CHECKPOINT_BYTES)
        throw new Error("检查点超过 64 MiB");
      try {
        value = JSON.parse(input);
      } catch {
        throw new Error("检查点 JSON 无法解析");
      }
    }
    if (value?.format !== "cpq-queue" || value.version !== 1)
      throw new Error("检查点格式或版本无效");
    const checked = createCheckpoint(value.state);
    return {
      settings: checked.state.settings,
      items: checked.state.items.map((x) => {
        const uncertain =
          x.status === "needs_review" || failureAction(x) !== "retry";
        const status = ["done", "skipped"].includes(x.status)
          ? "skipped"
          : uncertain
            ? "needs_review"
            : "pending";
        return {
          ...x,
          id: crypto.randomUUID(),
          status,
          downloadIds: {},
          downloadedAssetIds: [],
          lastError:
            status === "needs_review"
              ? "来自检查点：提交或下载结果需核对，不会自动生成。"
              : "",
        };
      }),
    };
  }
  async function validateAssetReferences(items, getAsset) {
    const ids = new Set(
      items.flatMap((x) => [
        ...(x.referenceIds || []),
        ...(x.generatedAssetIds || []),
      ]),
    );
    for (const id of ids)
      if (!(await getAsset(id)))
        throw new Error(
          "检查点图片 " + id.slice(0, 12) + " 缺失，请先恢复对应工作区",
        );
  }
  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }

  return {
    MAX_IMPORT_CHARS,
    CHAT_MATCHES,
    providerForURL,
    taskProvider,
    MAX_CHECKPOINT_BYTES,
    createCheckpoint,
    restoreCheckpoint,
    validateAssetReferences,
    MAX_JOBS,
    MAX_IMAGE_BYTES,
    csvRows,
    parsePrompts,
    buildPrompt,
    sanitizePart,
    sanitizeFolder,
    browserDownloadFolder,
    failureAction,
    recoverItem,
    isImageURL,
    safePublicURL,
    loopbackBase,
    toDataURL,
    parseImageDataURL,
    imageMime,
    publicSettings,
    escapeHTML,
  };
});
