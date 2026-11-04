"use strict";
(function () {
  const $ = (s) => document.querySelector(s),
    form = $("#library-settings");
  let busy = false, browserBusy = false, browserTouched = false, modeEpoch = 0, configurationLoaded = false;
  function showMode(value) {
    $(".browser-settings-card").dataset.selected=String(value!=="native");
    $("#native-enhancement").dataset.selected=String(value==="native");
    $("#download-mode").value = value === "native" ? "native" : "browser";
    const summary = $("#current-download-mode");
    if (summary) summary.textContent = "当前图片保存方式：" + (value === "native" ? "指定本机目录" : "浏览器下载");
  }
  const errors = {
    SETTINGS_READ_TIMEOUT:
      "读取本机设置超时。请点击“刷新状态”重新读取；读取成功前不会覆盖保存未知配置，浏览器下载仍可使用。",
    LIBRARY_OFFLINE:
      "本机增强未连接或版本较旧。请连接或升级本机服务；浏览器下载仍可使用。",
    LIBRARY_OUTCOME_UNKNOWN:
      "操作结果待核对，请先刷新状态，不要重复保存或下载。",
    DIRECTORY_INVALID: "请填写完整的本机目录，例如 D:\\图片库。",
    DIRECTORY_ROOT_FORBIDDEN: "请选择具体的图片文件夹，不能使用磁盘根目录。",
    DIRECTORY_MISSING_OR_LINK: "目录不存在或包含链接。请先创建普通文件夹。",
    WEBHOOK_URL_INVALID:
      "Webhook 需要 HTTPS 地址；本机测试可用 127.0.0.1 的 HTTP 地址。",
    WEBHOOK_URL_REQUIRED: "开启通知前请填写 Webhook 地址。",
    BROWSER_FOLDER_INVALID: "子目录需使用 / 分隔，不能包含 .. 或绝对路径。",
  };
  const status = (message, state = "idle") => {
    $("#library-status").textContent = message;
    $("#library-status").dataset.state = state;
  };
  async function request(type, extra = {}) {
    let timer;
    const reply = chrome.runtime.sendMessage({ type, ...extra });
    const reading = ["LIBRARY_SETTINGS", "BROWSER_DOWNLOAD_SETTINGS_GET"].includes(type);
    let r;
    try {
      r = await (reading ? Promise.race([reply, new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("SETTINGS_READ_TIMEOUT")), 10000);
      })]) : reply);
    } finally { clearTimeout(timer); }
    if (!r?.ok) throw new Error(r?.error || "LIBRARY_OFFLINE");
    return r;
  }
  const browserStatus = (message, state = "idle") => {
    const el = $("#browser-download-status");
    el.textContent = message;
    el.dataset.state = state;
  };
  $("#browser-folder").addEventListener("input", () => { browserTouched = true; });
  $("#browser-download-settings").onsubmit = async (e) => {
    e.preventDefault();
    if (browserBusy) return;
    browserBusy = true;
    browserTouched = true;
    ++modeEpoch;
    $("#browser-download-save").disabled = true;
    $("#browser-download-settings").setAttribute("aria-busy", "true");
    browserStatus("正在保存…", "pending");
    try {
      const r = await request("BROWSER_DOWNLOAD_SETTINGS_SET", { browserFolder: $("#browser-folder").value.trim() });
      $("#browser-folder").value = r.preferences.browserFolder;
      showMode(r.preferences.mode || "browser");
      mode();
      browserStatus("已保存。后续图片使用 Chrome 下载。", "success");
    } catch (e) {
      browserStatus(errors[e.message] || "目录未保存，请稍后重试。", "error");
    } finally {
      browserBusy = false;
      $("#browser-download-save").disabled = false;
      $("#browser-download-settings").setAttribute("aria-busy", "false");
    }
  };
  request("BROWSER_DOWNLOAD_SETTINGS_GET").then(r => {
    if (!browserTouched) {$("#browser-folder").value = r.preferences?.browserFolder || "ChatGPT 工作台/图库";showMode(r.preferences?.mode || "browser");mode();}
    if (!browserTouched) browserStatus(r.preferences?.mode === "native" ? "当前使用本机目录；保存此项可切换为浏览器下载。" : "浏览器下载已就绪。");
  }).catch(() => { if (!browserTouched) browserStatus("暂时无法读取目录，可重新保存。", "error"); });
  function pending(value) {
    busy = value;
    form.setAttribute("aria-busy", String(value));
    for (const control of document.querySelectorAll(
      "#library-settings input,#library-settings select,#library-settings button,.library-maintenance button",
    ))
      control.disabled = value || (!configurationLoaded && control.id !== "library-refresh");
  }
  function mode() {
    $("#native-directory-field").hidden =
      $("#download-mode").value !== "native";
    $("#browser-directory-field").hidden =
      $("#download-mode").value !== "browser";
  }
  function receipt(info, pendingRecords = false) {
    const n = info?.notifications || {};
    $("#library-counts").textContent = info?.connected
      ? `SQLite：${info.assets || 0} 张图片 · ${info.jobs || 0} 项任务 · ${info.downloads || 0} 次成功下载${pendingRecords ? " · 有资料待补录" : ""}`
      : "本机记录状态暂不可用";
    $("#notification-counts").textContent =
      `下载通知：已送达 ${n.delivered || 0} · 待发送 ${n.pending || 0} · 发送中 ${n.sending || 0} · 失败 ${n.failed || 0} · 结果未知 ${n.unknown || 0} · 地址变更已停止 ${n.cancelled || 0}`;
  }
  async function refresh() {
    configurationLoaded = false;
    const readEpoch = modeEpoch;
    const r = await request("LIBRARY_SETTINGS"),
      s = r.settings || {};
    if (readEpoch === modeEpoch) showMode(s.mode || "browser");
    $("#download-directory").value = s.downloadDirectory || "";
    $("#webhook-enabled").checked = !!s.webhookEnabled;
    $("#webhook-descriptions").checked = !!s.includeDescriptions;
    $("#webhook-url").value = "";
    $("#webhook-clear").checked = false;
    $("#webhook-url").placeholder = s.webhookConfigured ? "输入新地址以替换" : "https://…";
    $("#webhook-configured").textContent = s.webhookConfigured
      ? "已保存地址；留空保留原地址。"
      : "尚未保存地址。";
    $("#sqlite-path").textContent = s.sqlitePath || "连接本机服务后显示";
    receipt(r.status, r.pending);
    $("#native-state").textContent = "已连接";
    configurationLoaded = true;
    mode();
  }
  async function run(fn) {
    if (busy) return;
    pending(true);
    try {
      await fn();
    } catch (e) {
      if (e.message === "SETTINGS_READ_TIMEOUT") $("#native-state").textContent = "读取超时";
      if (e.message === "LIBRARY_OFFLINE") $("#native-state").textContent = "未连接";
      status(
        errors[e.message] ||
          "操作未完成，请检查本机目录、服务连接与通知配置后重试。",
        "error",
      );
    } finally {
      pending(false);
      $("#webhook-url").value = "";
    }
  }
  $("#download-mode").onchange = mode;
  form.onsubmit = (e) => {
    e.preventDefault();
    if (busy || !configurationLoaded) return;
    ++modeEpoch;
    run(async () => {
      status("正在保存…", "pending");
      await request("LIBRARY_CONFIGURE", {
        settings: {
          mode: $("#download-mode").value,
          downloadDirectory: $("#download-directory").value.trim(),
          browserFolder: $("#browser-folder").value.trim(),
          webhookEnabled: $("#webhook-enabled").checked,
          webhookURL: $("#webhook-url").value.trim(),
          clearWebhook: $("#webhook-clear").checked,
          includeDescriptions: $("#webhook-descriptions").checked,
        },
      });
      await refresh();
      status("设置已保存。当前图片使用" + ($("#download-mode").value === "native" ? "指定本机目录" : "浏览器下载") + "；通知只在下载成功后发送。", "success");
    });
  };
  $("#library-refresh").onclick = () =>
    run(async () => {
      await refresh();
      status("状态已刷新。");
    });
  $("#library-reindex").onclick = () =>
    run(async () => {
      status("正在补录现有图片和任务…", "pending");
      await request("LIBRARY_REINDEX");
      await refresh();
      status("SQLite 补录完成，未重新下载或发送历史通知。", "success");
    });
  $("#download-reconcile").onclick = () =>
    run(async () => {
      const r = await request("LIBRARY_RECONCILE_DOWNLOADS");
      await refresh();
      status(
        `下载核对完成：确认成功 ${r.complete} 项，仍待核对 ${r.unknown} 项；未重新下载。`,
        "success",
      );
    });
  $("#notification-retry").onclick = () =>
    run(async () => {
      await request("LIBRARY_RETRY_NOTIFICATIONS");
      await refresh();
      status(
        "已提交通知重试；不会重新下载文件。请稍后刷新查看回执。",
        "success",
      );
    });
  window.addEventListener(
    "pagehide",
    () => {
      $("#webhook-url").value = "";
    },
    { once: true },
  );
  mode();
  run(async () => {
    await refresh();
    status("本机服务已连接，可配置图片目录与下载通知。");
  });
})();
