/* MIT: aleixmedina9-gif queue foundation; Workbench background and persistence. */
if (typeof importScripts === "function")
  importScripts(
    "src/core.js",
    "src/store.js",
    "src/mcp-content.js",
    "src/mcp-defaults.js",
    "src/mcp-background.js",
  );
(function (root, factory) {
  const api = factory(
    root.CPQCore || (typeof require === "function" && require("./src/core.js")),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else if (root.chrome?.runtime) {
    const controller = api.createController(
      chrome,
      root.CPQStore.createStore(indexedDB),
    );
    const mcpBridge = root.CPQMCPBackground.createMCPBackground(
      chrome,
      controller,
    );
    mcpBridge.restore().catch(() => {});
    chrome.permissions.onAdded.addListener(() =>
      mcpBridge.restore().catch(() => {}),
    );
    chrome.permissions.onRemoved.addListener(() =>
      mcpBridge.restore().catch(() => {}),
    );
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      // The matching options document owns this read-only response. A generic
      // background reply would race and hide that document's startup status.
      if (message?.type === "SETTINGS_READINESS_PROBE") return;
      if (
        [
          "MCP_BRIDGE_SET",
          "MCP_BRIDGE_INFO",
          "MCP_BRIDGE_CLEAR",
          "MCP_BRIDGE_USE_DEFAULTS",
        ].includes(message?.type)
      ) {
        mcpBridge
          .handleMessage(message, sender)
          .then(reply, () => reply({ ok: false, error: "MCP_PAIRING_FAILED" }));
        return true;
      }
      controller
        .handle(message, sender)
        .then(reply, () => reply({ ok: false, error: "后台操作失败" }));
      return true;
    });
    chrome.downloads.onChanged.addListener(controller.onDownloadChanged);
    chrome.action.onClicked.addListener(async (tab) => {
      if (!root.CPQCore.providerForURL(tab.url)) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
      } catch {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: chrome.runtime.getManifest().content_scripts[0].css,
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: chrome.runtime.getManifest().content_scripts[0].js,
        });
      }
    });
  }
})(globalThis, function (C) {
  "use strict";
  function createController(api, store, options = {}) {
    let tail = Promise.resolve(),
      ownedTail = Promise.resolve(),
      preferenceTail = Promise.resolve(),
      preferenceIntent = 0;
    let libraryRequest =
        options.libraryRequest ||
        (() => Promise.reject(new Error("LIBRARY_OFFLINE"))),
      flushing = null;
    const markLibraryPending = () => local.set({ libraryPending: true });
    async function flushLibrary() {
      if (flushing) return flushing;
      flushing = (async () => {
        const settings = await libraryRequest("settings");
        await applyLibraryPreferences(settings);
        const assets = await store.listAssets(),
          jobs = (await queue()).state.items;
        for (let n = 0; n < assets.length; n += 20)
          await libraryRequest("upsert", { assets: assets.slice(n, n + 20) });
        for (let n = 0; n < jobs.length; n += 50)
          await libraryRequest("upsert", { jobs: jobs.slice(n, n + 50) });
        await local.set({ libraryPending: false });
        const owned = await get(session, "ownedDownloads", {});
        for (const [id, d] of Object.entries(owned))
          if (
            d.assetId &&
            d.backend !== "native" &&
            d.state === "complete" &&
            !d.recorded
          )
            await recordComplete(id);
        return { assets: assets.length, jobs: jobs.length };
      })().finally(() => {
        flushing = null;
      });
      return flushing;
    }
    function mirror() {
      markLibraryPending()
        .then(async () => {
          if (flushing) await flushing;
          await flushLibrary();
        })
        .catch(() => {});
    }
    const mcpOwner = Object.freeze({});
    const session = api.storage.session,
      local = api.storage.local;
    const get = async (area, key, fallback) =>
      (await area.get(key))[key] ?? fallback;
    function preferencesRun(fn) {
      const next = preferenceTail.then(fn, fn);
      preferenceTail = next.catch(() => {});
      return next;
    }
    function applyLibraryPreferences(settings) {
      return preferencesRun(async () => {
        if(await get(local,"downloadPreferenceSource","")==="browser") {
          const current=await get(local,"libraryPreferences",{});
          return {...settings,mode:"browser",browserFolder:current.browserFolder || "ChatGPT 工作台/图库"};
        }
        await local.set({libraryPreferences:{mode:settings.mode,browserFolder:settings.browserFolder}});
        return settings;
      });
    }
    const ownPage = (s) =>
      s?.id === api.runtime.id && s.url === api.runtime.getURL("options.html");
    const allowed = (s) =>
      s === mcpOwner ||
      (s?.id === api.runtime.id && (ownPage(s) || !!C.providerForURL(s.url)));
    const owner = (s) =>
      s === mcpOwner ? "mcp" : ownPage(s) ? "options" : s.tab?.id;
    async function leaseFor(s, acquire = false) {
      const current = await get(session, "lease", null),
        now = Date.now();
      if (current && current.expiresAt > now && current.tabId !== owner(s))
        throw new Error("另一个标签页正在执行队列");
      if (acquire) {
        const lease = { tabId: owner(s), expiresAt: now + 45000 };
        await session.set({ lease });
        return lease;
      }
      return current;
    }
    async function queue() {
      return get(local, "workbenchQueue", {
        revision: 0,
        state: { items: [], settings: {} },
      });
    }
    function cleanState(state) {
      if (
        !state ||
        !Array.isArray(state.items) ||
        state.items.length > C.MAX_JOBS
      )
        throw new Error("队列无效");
      const fields = [
        "id",
        "prompt",
        "kind",
        "provider",
        "referenceIds",
        "status",
        "stage",
        "attempts",
        "submittedAt",
        "generatedAssetIds",
        "downloadIds",
        "downloadedAssetIds",
        "lastError",
        "createdAt",
        "finishedAt",
      ];
      const items = state.items.map((x) => {
        if (
          !x ||
          typeof x.id !== "string" ||
          typeof x.prompt !== "string" ||
          x.prompt.length > 20000
        )
          throw new Error("任务无效");
        if (!["chatgpt", "gemini"].includes(C.taskProvider(x)))
          throw new Error("任务站点无效");
        return Object.fromEntries(
          fields
            .filter((k) => Object.hasOwn(x, k))
            .map((k) => [k, structuredClone(x[k])]),
        );
      });
      return {
        ...Object.fromEntries(
          [
            "running",
            "paused",
            "currentId",
            "panelVisible",
            "activeTab",
            "sessionSerial",
            "status",
            "statusKind",
            "originalFileName",
          ]
            .filter((k) => Object.hasOwn(state, k))
            .map((k) => [k, state[k]]),
        ),
        items,
        settings: C.publicSettings(state.settings),
      };
    }
    async function download(dataUrl, filename, s, assetId) {
      const preferences = await get(local, "libraryPreferences", {
        mode: "browser",
        browserFolder: "ChatGPT 工作台/图库",
      });
      if (assetId && preferences.mode === "native") {
        const previous = await store.getAsset(assetId);
        if (previous?.download?.state === "unknown")
          throw new Error("DOWNLOAD_OUTCOME_UNKNOWN");
        const requestId = crypto.randomUUID(),
          id = "local-" + requestId;
        await store.updateAsset(assetId, {
          download: { state: "unknown", backend: "native", requestId },
        });
        await changeOwned((owned) => {
          owned[id] = {
            tabId: owner(s),
            assetId,
            backend: "native",
            requestId,
            state: "in_progress",
            createdAt: Date.now(),
          };
        });
        try {
          const { dataUrl: omitted, ...asset } = await store.getAsset(assetId);
          const result = await libraryRequest("download", {
            requestId,
            asset,
            dataUrl,
            filename: filename.split("/").at(-1),
          });
          await changeOwned((owned) => {
            owned[id].state = result.state;
            owned[id].error = result.error || "";
          });
          if (result.state === "complete")
            await store.updateAsset(assetId, {
              download: { state: "complete", completedAt: Date.now() },
            });
        } catch (e) {
          const unknown = [
            "LIBRARY_OUTCOME_UNKNOWN",
            "DOWNLOAD_OUTCOME_UNKNOWN",
          ].includes(e.message);
          await changeOwned((owned) => {
            owned[id].state = unknown ? "unknown" : "interrupted";
            owned[id].error = e.message;
          });
          if (!unknown) throw e;
        } finally {
          const d = (await get(session, "ownedDownloads", {}))[id];
          if (d?.state === "interrupted")
            await store.updateAsset(assetId, {
              download: { state: "interrupted" },
            });
        }
        return { ok: true, downloadId: id };
      }
      if (assetId)
        filename = preferences.browserFolder + "/" + filename.split("/").at(-1);
      const id = await api.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      });
      await changeOwned((owned) => {
        owned[id] = {
          tabId: owner(s),
          assetId: assetId || "",
          state: "in_progress",
          filename,
          createdAt: Date.now(),
        };
      });
      await reconcile(id);
      return { ok: true, downloadId: id };
    }
    function changeOwned(fn) {
      const result = ownedTail.then(async () => {
        const owned = await get(session, "ownedDownloads", {});
        const value = await fn(owned);
        await session.set({
          ownedDownloads: Object.fromEntries(
            Object.entries(owned)
              .sort((a, b) => b[1].createdAt - a[1].createdAt)
              .slice(0, 2000),
          ),
        });
        return value;
      });
      ownedTail = result.catch(() => {});
      return result;
    }
    async function reconcile(id) {
      const saved = (await get(session, "ownedDownloads", {}))[id];
      if (saved?.backend === "native") {
        if (["in_progress", "unknown"].includes(saved.state)) {
          try {
            const result = await libraryRequest("get_download", {
              requestId: saved.requestId,
            });
            await changeOwned((owned) => {
              owned[id].state = result.state;
              owned[id].error = result.error || "";
            });
            if (result.state === "complete")
              await store.updateAsset(saved.assetId, {
                download: { state: "complete", completedAt: Date.now() },
              });
          } catch {
            return { ...saved, state: "unknown" };
          }
        }
        return (await get(session, "ownedDownloads", {}))[id];
      }
      const actual = (await api.downloads.search({ id }))[0];
      const current = await changeOwned((owned) => {
        const d = owned[id];
        if (!d) return null;
        d.state = actual?.state || "missing";
        d.error = actual?.error || "";
        if (d.state === "complete")
          d.completedAt =
            d.completedAt || Date.parse(actual?.endTime) || d.createdAt;
        return { ...d };
      });
      if (current?.state === "complete") await recordComplete(id);
      return current;
    }
    async function recordComplete(id) {
      const d = (await get(session, "ownedDownloads", {}))[id];
      if (
        !d?.assetId ||
        d.state !== "complete" ||
        d.backend === "native" ||
        d.recorded
      )
        return;
      const asset = await store.getAsset(d.assetId);
      if (!asset) return;
      await store.updateAsset(asset.id, {
        download: { state: "complete", completedAt: Date.now() },
      });
      try {
        await libraryRequest("browser_complete", {
          requestId: "chrome-" + api.runtime.id + "-" + id,
          asset,
          filename: d.filename,
          completedAt: d.completedAt || d.createdAt,
        });
        await changeOwned((owned) => {
          if (owned[id]) owned[id].recorded = true;
        });
      } catch {
        await markLibraryPending();
      }
    }
    async function dispatch(m, s) {
      if (!allowed(s)) throw new Error("消息来源未授权");
      if (!m || typeof m.type !== "string") throw new Error("消息无效");
      switch (m.type) {
        case "LEASE_ACQUIRE":
        case "LEASE_HEARTBEAT":
          return { ok: true, lease: await leaseFor(s, true) };
        case "LEASE_RELEASE":
          await leaseFor(s);
          await session.remove("lease");
          return { ok: true };
        case "QUEUE_GET": {
          const q = await queue();
          return { ok: true, ...q, lease: await get(session, "lease", null) };
        }
        case "QUEUE_SAVE": {
          await leaseFor(s);
          const q = await queue();
          if (m.revision !== q.revision)
            throw new Error("队列已在其他页面更新，请重新载入");
          const value = {
            revision: q.revision + 1,
            state: cleanState(m.state),
          };
          await local.set({ workbenchQueue: value });
          mirror();
          return { ok: true, revision: value.revision };
        }
        case "ASSET_PUT": {
          const provider = C.providerForURL(s.url);
          const input = { ...m.asset };
          if (provider) {
            if (Array.isArray(input.sources))
              input.sources = input.sources.map((source) => ({
                ...source,
                provider,
              }));
            else input.provider = provider;
          }
          const asset = await store.putAsset(input);
          mirror();
          return { ok: true, asset };
        }
        case "ASSET_UPDATE": {
          const asset = await store.updateAsset(m.assetId, {
            caption: m.caption,
            tags: m.tags,
          });
          mirror();
          return { ok: true, asset };
        }
        case "ASSET_LIST":
          return { ok: true, assets: await store.listAssets() };
        case "ASSET_GET":
          return { ok: true, asset: await store.getAsset(m.assetId) };
        case "CONVERSATION_PUT":
          return {
            ok: true,
            conversation: await store.putConversation(m.conversation),
          };
        case "CONVERSATION_LIST":
          return { ok: true, conversations: await store.listConversations() };
        case "WORKSPACE_EXPORT":
          return { ok: true, bundle: await store.exportWorkspace() };
        case "WORKSPACE_RESTORE": {
          const result = await store.restoreWorkspace(m.bundle);
          mirror();
          return { ok: true, result };
        }
        case "ASSET_DOWNLOAD": {
          const a = await store.getAsset(m.assetId);
          if (!a) throw new Error("图片不存在");
          const ext = a.mime.split("/")[1].replace("jpeg", "jpg");
          return download(
            a.dataUrl,
            C.sanitizeFolder(m.folder) +
              "/" +
              C.sanitizePart(m.name || a.name) +
              "-" +
              a.id.slice(0, 8) +
              "." +
              ext,
            s,
            a.id,
          );
        }
        case "FILE_DOWNLOAD": {
          const supported = [
            "application/zip",
            "application/json",
            "text/plain",
            "text/markdown",
            "text/html",
            "application/pdf",
          ];
          if (
            !supported.includes(m.mime) ||
            typeof m.base64 !== "string" ||
            m.base64.length > 350 * 1024 * 1024 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(m.base64)
          )
            throw new Error("导出文件无效");
          return download(
            `data:${m.mime};base64,${m.base64}`,
            C.sanitizeFolder(m.folder) + "/" + C.sanitizePart(m.name),
            s,
          );
        }
        case "DOWNLOAD_STATUS":
        case "DOWNLOAD_CANCEL": {
          const owned = await get(session, "ownedDownloads", {}),
            d = owned[m.downloadId];
          const mcpJobDownload =
            d &&
            s === mcpOwner &&
            m.type === "DOWNLOAD_STATUS" &&
            (await queue()).state.items.some(
              (item) =>
                /^mcp-[A-Za-z0-9]/.test(item.id || "") &&
                item.generatedAssetIds?.includes(d.assetId) &&
                Object.values(item.downloadIds || {}).includes(m.downloadId),
            );
          if (!d || (d.tabId !== owner(s) && !mcpJobDownload))
            throw new Error("下载不属于当前标签页");
          if (m.type === "DOWNLOAD_CANCEL") {
            if (d.backend === "native")
              throw new Error("本机文件已进入写入阶段，仅取消后续项");
            await api.downloads.cancel(m.downloadId);
          }
          const current = await reconcile(m.downloadId);
          return {
            ok: true,
            downloadId: m.downloadId,
            state: current.state,
            error: current.error,
          };
        }
        case "CONNECTION_SET":
          throw new Error("KNOWLEDGE_SYNC_RETIRED");
        case "CONNECTION_CLEAR":
          if (!ownPage(s)) throw new Error("请在扩展设置页清除凭据");
          await session.remove("connection");
          return { ok: true };
        case "CONNECTION_INFO":
          return { ok: true, connected: false, retired: true };
        case "GALLERY_PREFERENCES_GET":
          return {
            ok: true,
            preferences: await get(local, "galleryPreferences", {}),
          };
        case "GALLERY_PREFERENCES_SET": {
          const preferences = {};
          for (const key of [
            "search",
            "sort",
            "provider",
            "mime",
            "role",
            "download",
            "from",
            "to",
            "mode",
          ])
            if (typeof m.preferences?.[key] === "string")
              preferences[key] = m.preferences[key].slice(0, 500);
          if ([12, 24, 48, 96].includes(m.preferences?.pageSize))
            preferences.pageSize = m.preferences.pageSize;
          if(preferences.mode==='details')preferences.mode='list';
          if(preferences.mode&&!['small','medium','large','list'].includes(preferences.mode))preferences.mode='medium';
          await local.set({ galleryPreferences: preferences });
          return { ok: true };
        }
        case "BROWSER_DOWNLOAD_SETTINGS_GET":
        case "BROWSER_DOWNLOAD_SETTINGS_SET": {
          if(!ownPage(s))throw new Error("SETTINGS_PAGE_REQUIRED");
          if(m.type==="BROWSER_DOWNLOAD_SETTINGS_SET") {
            const browserFolder=C.browserDownloadFolder(m.browserFolder);
            ++preferenceIntent;
            await preferencesRun(() => local.set({libraryPreferences:{mode:"browser",browserFolder},downloadPreferenceSource:"browser"}));
          }
          return {ok:true,preferences:await preferencesRun(() => get(local,"libraryPreferences",{mode:"browser",browserFolder:"ChatGPT 工作台/图库"}))};
        }
        case "LIBRARY_SETTINGS":
        case "LIBRARY_CONFIGURE":
        case "LIBRARY_REINDEX":
        case "LIBRARY_RECONCILE_DOWNLOADS":
        case "LIBRARY_RETRY_NOTIFICATIONS": {
          if (!ownPage(s)) throw new Error("SETTINGS_PAGE_REQUIRED");
          if (m.type === "LIBRARY_SETTINGS") {
            const settings = await applyLibraryPreferences(await libraryRequest("settings"));
            return {
              ok: true,
              settings,
              status: await libraryRequest("status"),
              pending: await get(local, "libraryPending", false),
            };
          }
          if (m.type === "LIBRARY_REINDEX")
            return { ok: true, result: await flushLibrary() };
          if (m.type === "LIBRARY_RECONCILE_DOWNLOADS") {
            let complete = 0,
              unknown = 0;
            for (const asset of await store.listAssets())
              if (
                asset.download?.backend === "native" &&
                asset.download.state === "unknown"
              ) {
                const result = await libraryRequest("get_download", {
                  requestId: asset.download.requestId,
                });
                if (result.state === "complete") {
                  await store.updateAsset(asset.id, {
                    download: { state: "complete", completedAt: Date.now() },
                  });
                  complete++;
                } else if (result.state === "failed")
                  await store.updateAsset(asset.id, {
                    download: { state: "interrupted" },
                  });
                else unknown++;
              }
            return { ok: true, complete, unknown };
          }
          if (m.type === "LIBRARY_RETRY_NOTIFICATIONS")
            return {
              ok: true,
              status: await libraryRequest("retry_notifications"),
            };
          const intent = ++preferenceIntent;
          const settings = await libraryRequest("configure", m.settings);
          await preferencesRun(async () => {
            if (intent !== preferenceIntent) return;
            await local.set({
            downloadPreferenceSource:"service",
            libraryPreferences: {
              mode: settings.mode,
              browserFolder: settings.browserFolder,
            },
            });
          });
          return { ok: true };
        }
        case "LIBRARY_INFO": {
          try {
            const info = await libraryRequest("status");
            return {
              ok: true,
              ...info,
              pending: await get(local, "libraryPending", false),
            };
          } catch {
            return {
              ok: true,
              connected: false,
              pending: await get(local, "libraryPending", false),
            };
          }
        }
        case "SETTINGS_DRAWER_CLOSE": {
          if(!ownPage(s) || !Number.isInteger(s.tab?.id) || !Number.isInteger(s.frameId) || s.frameId<=0 ||
              typeof m.requestId!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(m.requestId))throw new Error("SETTINGS_PAGE_REQUIRED");
          await api.tabs.sendMessage(s.tab.id,{type:"SETTINGS_DRAWER_CLOSE",requestId:m.requestId},{frameId:0});
          return {ok:true};
        }
        case "OPEN_OPTIONS":
          await api.runtime.openOptionsPage();
          return { ok: true };
        case "ASSET_SYNC":
        case "ASSET_RECONCILE": {
          throw new Error("KNOWLEDGE_SYNC_RETIRED");
        }
        default:
          throw new Error("不支持的操作");
      }
    }
    function handle(m, s) {
      const call = () =>
        dispatch(m, s).catch((e) => ({
          ok: false,
          error: String(e.message || "操作失败"),
        }));
      // Native writes/settings may outlive a heartbeat. Queue CAS stays serialized.
      if (
        [
          "ASSET_DOWNLOAD",
          "DOWNLOAD_STATUS",
          "DOWNLOAD_CANCEL",
          "LIBRARY_SETTINGS",
          "LIBRARY_CONFIGURE",
          "LIBRARY_REINDEX",
          "LIBRARY_RECONCILE_DOWNLOADS",
          "LIBRARY_RETRY_NOTIFICATIONS",
          "LIBRARY_INFO",
          "SETTINGS_DRAWER_CLOSE",
        ].includes(m?.type)
      )
        return call();
      const result = tail.then(call, call);
      tail = result.then(() => {});
      return result;
    }
    async function onDownloadChanged(delta) {
      if (!delta.state && !delta.error) return;
      const d = await changeOwned((owned) => {
        const d = owned[delta.id];
        if (!d) return null;
        if (delta.state) d.state = delta.state.current;
        if (d.state === "complete") d.completedAt = d.completedAt || Date.now();
        if (delta.error) d.error = delta.error.current;
        return { ...d };
      });
      if (!d) return;
      if (d.state === "complete") await recordComplete(delta.id);
      try {
        if (typeof d.tabId === "number")
          await api.tabs.sendMessage(d.tabId, {
            type: "OWNED_DOWNLOAD_CHANGED",
            downloadId: delta.id,
            state: d.state,
          });
      } catch {
        /* closed tab; downloads.search reconciles */
      }
    }
    const mcpTypes = new Set([
      "QUEUE_GET",
      "ASSET_LIST",
      "ASSET_GET",
      "ASSET_PUT",
      "ASSET_UPDATE",
      "ASSET_DOWNLOAD",
      "DOWNLOAD_STATUS",
    ]);
    function handleMCP(message) {
      if (!mcpTypes.has(message?.type))
        return Promise.resolve({
          ok: false,
          error: "MCP_OPERATION_NOT_ALLOWED",
        });
      return handle(message, mcpOwner);
    }
    return {
      handle,
      handleMCP,
      onDownloadChanged,
      flushLibrary,
      setLibraryTransport(fn) {
        libraryRequest = fn;
      },
    };
  }
  return { createController };
});
