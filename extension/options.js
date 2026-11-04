"use strict";
window.CPQControls?.mount(document.body);
const $ = (s) => document.querySelector(s);
document.documentElement.dataset.settingsBuild = "publish-ready-settings-20261104-v393";
const extensionManifest = chrome.runtime.getManifest?.() || {},
  extensionVersion = extensionManifest.version || "开发版",
  extensionName = extensionManifest.name || "ChatGPT 自动生图与下载助手";
document.title = "设置 · " + extensionName;
$(".page-heading .eyebrow").textContent = extensionName;
document.documentElement.dataset.extensionVersion = extensionVersion;
$("#extension-version").textContent = "v" + extensionVersion;
if (window.parent !== window)
  document.documentElement.dataset.embedded = "true";
let mcpBusy = false,
  mcpConfigured = false;
const mcpErrors = {
  MCP_LOOPBACK_PERMISSION_REQUIRED: "本机访问权限未授予，可点击连接进行授权。",
  MCP_DEFAULTS_NOT_FOUND: "当前安装未附带默认配对。请先选择本机服务生成的 JSON 配对文件；浏览器生图与下载无需连接。",
  MCP_DEFAULTS_UNAVAILABLE: "暂时无法读取默认配对，可稍后重试连接。",
  MCP_DEFAULTS_INVALID: "默认配对设置无效，请核对本机服务的配对配置。",
  MCP_PAIRING_INVALID: "配对文件无效，请选择当前插件的配对文件。",
  MCP_BRIDGE_OFFLINE: "本机 MCP 服务暂时不可达，插件会在服务恢复后重连。",
  MCP_BRIDGE_DISCONNECTED: "与本机服务的连接已中断，正在等待恢复。",
  PAIRING_FILE_INVALID:
    "配对文件格式无效，请选择不超过 4 KiB 的 JSON 配对文件。",
  PERMISSION_DENIED: "本机访问权限未授予，可再次点击连接进行授权。",
};
const mcpError = (code) =>
  mcpErrors[code] || "MCP 连接未完成，请核对本机服务与配对设置后重试。";
$("#mcp-default-address").textContent =
  CPQMCPDefaults.HOST + ":" + CPQMCPDefaults.PORT;
function mcpStatus(message, label, state) {
  $("#mcp-status").textContent = message;
  $("#mcp-status").dataset.state = state;
  $("#mcp-state-label").textContent = label;
  $("#mcp-state-label").dataset.state = state;
}
async function refreshMCP() {
  const r = await chrome.runtime.sendMessage({ type: "MCP_BRIDGE_INFO" });
  if (
    !r ||
    (!r.ok &&
      !(typeof r.configured === "boolean" && typeof r.connected === "boolean"))
  )
    throw new Error("UNAVAILABLE");
  mcpConfigured = !!(r.configured || r.connected);
  $("#mcp-default-address").textContent =
    CPQMCPDefaults.HOST + ":" + (r.port || CPQMCPDefaults.PORT);
  if (r.connected) {
    mcpStatus(
      "MCP 已连接 · 127.0.0.1:" +
        r.port +
        (r.source === "default" ? " · 默认配对" : " · 文件配对"),
      "已连接",
      "success",
    );
    $("#mcp-next-step").textContent =
      "可以回到 MCP 客户端调用图片生成、下载与本机记录工具。";
  } else if (r.defaultsDisabled) {
    mcpStatus("已主动断开，自动恢复已关闭。", "已断开", "idle");
    $("#mcp-next-step").textContent = "需要恢复时，选择本机服务的配对文件并点击连接；已准备默认配对的本地安装也可直接连接。";
  } else if (mcpErrors[r.lastError]) {
    mcpStatus(mcpError(r.lastError), "需要处理", "error");
    $("#mcp-next-step").textContent =
      r.lastError === "MCP_LOOPBACK_PERMISSION_REQUIRED"
        ? "选择配对文件并点击“连接本机增强”，在 Chrome 提示中允许本机访问。"
        : "本机增强需单独安装。请使用为当前扩展生成的配对文件；公开 ZIP 不包含私有配对。";
  } else {
    mcpStatus(
      r.configured
        ? "配对已保存，正在等待本机 MCP 服务。"
        : "本机增强尚未配对；浏览器生图与下载可直接使用。",
      r.configured ? "等待服务" : "未连接",
      "idle",
    );
    $("#mcp-next-step").textContent =
      "选择本机服务生成的 JSON 配对文件后连接，无需复制密钥；本地安装已准备默认配对时可直接连接。";
  }
  $("#mcp-disconnect").disabled = mcpBusy || !mcpConfigured;
}
function mcpPending(value) {
  mcpBusy = value;
  $("#mcp-connection").setAttribute("aria-busy", String(value));
  $("#mcp-connect").disabled = value;
  $("#mcp-pairing").disabled = value;
  $("#mcp-disconnect").disabled = value || !mcpConfigured;
}
const unavailable = () =>
  mcpStatus(
    "暂时无法读取连接状态。请返回后重新打开设置。",
    "状态未知",
    "error",
  );
refreshMCP().catch(unavailable);
const poll = setInterval(() => {
  if (!mcpBusy) refreshMCP().catch(unavailable);
}, 5000);
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(poll);
    $("#webhook-url").value = "";
  },
  { once: true },
);
$("#mcp-pairing").addEventListener("change", () => {
  $("#mcp-connect").textContent = $("#mcp-pairing").files.length
    ? "使用所选文件配对"
    : "连接本机增强";
});
$("#mcp-connection").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (mcpBusy) return;
  mcpPending(true);
  mcpStatus("正在连接本机 MCP 服务…", "连接中", "pending");
  try {
    const file = $("#mcp-pairing").files[0];
    if (file && file.size > 4096) throw new Error("PAIRING_FILE_INVALID");
    const granted = await chrome.permissions.request({
      origins: ["http://127.0.0.1/*"],
    });
    if (!granted) throw new Error("PERMISSION_DENIED");
    let message = { type: "MCP_BRIDGE_USE_DEFAULTS" };
    if (file) {
      try {
        message = {
          type: "MCP_BRIDGE_SET",
          pairing: JSON.parse(await file.text()),
        };
      } catch {
        throw new Error("PAIRING_FILE_INVALID");
      }
    }
    const r = await chrome.runtime.sendMessage(message);
    if (!r?.ok)
      throw new Error(mcpErrors[r?.error] ? r.error : "PAIRING_FAILED");
    $("#mcp-pairing").value = "";
    $("#mcp-connect").textContent = "连接本机增强";
    await refreshMCP();
  } catch (error) {
    mcpStatus(mcpError(error.message), "需要处理", "error");
  } finally {
    mcpPending(false);
  }
});
$("#mcp-disconnect").addEventListener("click", async () => {
  if (mcpBusy) return;
  mcpPending(true);
  try {
    const r = await chrome.runtime.sendMessage({ type: "MCP_BRIDGE_CLEAR" });
    if (!r?.ok) throw new Error("DISCONNECT_FAILED");
    $("#mcp-pairing").value = "";
    $("#mcp-connect").textContent = "连接本机增强";
    await refreshMCP();
  } catch {
    mcpStatus("断开未完成，请重试。", "需要处理", "error");
  } finally {
    mcpPending(false);
  }
});
window.CPQSettingsBoot?.ready();
