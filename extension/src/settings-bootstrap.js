// Only fixed startup metadata crosses this extension-internal boundary.
(function () {
  "use strict";
  const requestId = window.name.startsWith("cpq-settings:") ? window.name.slice(13) : "";
  const validId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const manifest = chrome.runtime.getManifest();
  const origins = new Set((manifest.content_scripts || []).flatMap(entry => entry.matches || [])
    .filter(match => /^https?:\/\/[^/*]+\/\*$/.test(match)).map(match => new URL(match).origin));
  let state = "booting", code = "";
  document.documentElement.dataset.settingsStartup = state;
  function renderError() {
    if (!document.body || document.querySelector("#settings-startup-error")) return;
    const alert = document.createElement("p");
    alert.id = "settings-startup-error";
    alert.className = "notice";
    alert.setAttribute("role", "alert");
    alert.textContent = "设置脚本启动失败（" + code + "）。请重新加载扩展，再刷新网站页面；也可关闭此页后重新打开设置。";
    document.body.prepend(alert);
  }
  function fail(value) {
    if (state !== "booting") return;
    state = "failed"; code = value;
    document.documentElement.dataset.settingsStartup = state;
    if (document.body) renderError();
    else document.addEventListener("DOMContentLoaded", renderError, {once:true});
  }
  window.addEventListener("error", event => {
    if (event.target?.tagName === "SCRIPT") fail("SCRIPT_RESOURCE");
    else if (event.target === window) fail("SCRIPT_ERROR");
  }, true);
  if (validId(requestId)) chrome.runtime.onMessage?.addListener((message, sender, reply) => {
    if (message?.type !== "SETTINGS_READINESS_PROBE" || message.requestId !== requestId ||
        sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return;
    try { if (!origins.has(new URL(sender.url).origin)) return; } catch { return; }
    reply({type:"CPQ_SETTINGS_STATUS", requestId, state, code, version:manifest.version});
  });
  window.addEventListener("keydown",event=>{
    if(event.key!=="Escape" || event.defaultPrevented || window.parent===window || !validId(requestId))return;
    event.preventDefault();
    chrome.runtime.sendMessage({type:"SETTINGS_DRAWER_CLOSE",requestId}).catch(()=>{});
  });
  window.CPQSettingsBoot = Object.freeze({ready() {
    if (state !== "booting") return;
    state = "ready";
    document.documentElement.dataset.settingsStartup = state;
  }});
})();
