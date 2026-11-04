(function (root, factory) {
  const api = factory(
    root.CPQCore || (typeof require === "function" && require("./core.js")),
    root.CPQMCPContent ||
      (typeof require === "function" && require("./mcp-content.js")),
    root.CPQMCPDefaults ||
      (typeof require === "function" && require("./mcp-defaults.js")),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQMCPBackground = api;
})(globalThis, function (C, M, D) {
  "use strict";
  const requestId = (x) =>
    typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(x);
  const imageId = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  const chatURL = (url) => !!C.providerForURL(url);
  const metadata = (a) =>
    Object.fromEntries(
      [
        "id",
        "name",
        "mime",
        "width",
        "height",
        "size",
        "caption",
        "tags",
        "roles",
        "createdAt",
      ]
        .filter((k) => Object.hasOwn(a, k))
        .map((k) => [k, a[k]]),
    );
  function createMCPBackground(
    api,
    controller,
    { WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch } = {},
  ) {
    let socket = null,
      config = null,
      connected = false,
      reconnectTimer = null,
      heartbeat = null,
      epoch = 0,
      lastError = "",
      downloadTail = Promise.resolve(),
      pairingTail = Promise.resolve(),
      source = null,
      defaultsDisabled = false;
    const session = api.storage.session;
    const localPending = new Map();
    let librarySupported = false;
    function requestLocal(op, args = {}) {
      if (!connected || socket?.readyState !== 1 || !librarySupported)
        return Promise.reject(new Error("LIBRARY_OFFLINE"));
      if (localPending.size >= 100)
        return Promise.reject(new Error("LIBRARY_BUSY"));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          localPending.delete(id);
          reject(new Error("LIBRARY_OUTCOME_UNKNOWN"));
        }, 30000);
        localPending.set(id, { resolve, reject, timer });
        try {
          socket.send(JSON.stringify({ type: "local_request", id, op, args }));
        } catch {
          clearTimeout(timer);
          localPending.delete(id);
          reject(new Error("LIBRARY_OUTCOME_UNKNOWN"));
        }
      });
    }
    controller.setLibraryTransport?.(requestLocal);
    function rejectLocal() {
      for (const p of localPending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("LIBRARY_OUTCOME_UNKNOWN"));
      }
      localPending.clear();
    }
    const ownPage = (s) =>
      s?.id === api.runtime.id && s.url === api.runtime.getURL("options.html");
    function info() {
      return {
        configured: !!config,
        connected,
        port: config?.port || null,
        lastError,
        source,
        defaultsDisabled,
        defaultAddress: D.HOST + ":" + D.PORT,
        build: "mcp-defaults-20261021-v2",
        libraryAvailable: connected && librarySupported,
      };
    }
    function validate(pairing) {
      return D.validate(pairing, api.runtime.id);
    }
    const ordered = (operation) => {
      const result = pairingTail.then(operation);
      pairingTail = result.catch(() => {});
      return result;
    };
    const publicError = (error) =>
      /^MCP_(?:PAIRING_INVALID|LOOPBACK_PERMISSION_REQUIRED|DEFAULTS_(?:NOT_FOUND|UNAVAILABLE|INVALID|DISABLED))$/.test(
        error?.message || "",
      )
        ? error.message
        : "MCP_PAIRING_FAILED";
    async function permission() {
      if (
        !(await api.permissions.contains({ origins: ["http://127.0.0.1/*"] }))
      )
        throw new Error("MCP_LOOPBACK_PERMISSION_REQUIRED");
    }
    async function loadDefault() {
      let response;
      try {
        response = await fetchImpl(api.runtime.getURL(D.RESOURCE), {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
        });
      } catch {
        throw new Error("MCP_DEFAULTS_UNAVAILABLE");
      }
      if (response.status === 404) throw new Error("MCP_DEFAULTS_NOT_FOUND");
      if (!response.ok || !response.body)
        throw new Error("MCP_DEFAULTS_UNAVAILABLE");
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 4096) throw new Error("MCP_DEFAULTS_INVALID");
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return validate(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      } catch {
        throw new Error("MCP_DEFAULTS_INVALID");
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    function replaceConfig(next, nextSource) {
      const same =
        config?.token === next.token &&
        config?.port === next.port &&
        source === nextSource;
      if (!same) stopSocket();
      config = next;
      source = nextSource;
      lastError = "";
      connect();
    }
    async function saveConfig(next, nextSource) {
      await session.set({ mcpBridge: next, mcpBridgeSource: nextSource });
      await api.storage.local.set({
        mcpDefaultsDisabled: nextSource === "manual",
      });
      defaultsDisabled = nextSource === "manual";
      replaceConfig(next, nextSource);
    }
    async function internal(message) {
      const r = await controller.handleMCP(message);
      if (!r?.ok) throw new Error(r?.error || "MCP_OPERATION_FAILED");
      return r;
    }
    async function download(args) {
      if (!imageId(args.assetId) || !requestId(args.requestId))
        throw new Error("MCP_DOWNLOAD_INVALID");
      const requests =
        (await session.get("mcpDownloadRequests")).mcpDownloadRequests || {};
      let saved = Object.hasOwn(requests, args.requestId)
        ? requests[args.requestId]
        : null;
      if (saved && saved.assetId !== args.assetId)
        throw new Error("REQUEST_CONFLICT");
      if (saved && !saved.downloadId)
        throw new Error("DOWNLOAD_OUTCOME_UNKNOWN");
      if (!saved) {
        if (Object.keys(requests).length >= 2000)
          throw new Error("MCP_DOWNLOAD_LIMIT");
        requests[args.requestId] = { assetId: args.assetId, stage: "starting" };
        await session.set({ mcpDownloadRequests: requests });
        const result = await internal({
          type: "ASSET_DOWNLOAD",
          assetId: args.assetId,
          folder: "ChatGPT 工作台/MCP",
        });
        saved = { assetId: args.assetId, downloadId: result.downloadId };
        requests[args.requestId] = saved;
        await session.set({ mcpDownloadRequests: requests });
      }
      const result = await internal({
        type: "DOWNLOAD_STATUS",
        downloadId: saved.downloadId,
      });
      return {
        downloadId: saved.downloadId,
        assetId: args.assetId,
        state: result.state,
        error: result.error,
      };
    }
    async function execute(op, args = {}) {
      switch (op) {
        case "tabs":
          return (
            await api.tabs.query({
              url: C.CHAT_MATCHES,
            })
          )
            .filter((t) => chatURL(t.url))
            .map((t) => ({
              id: t.id,
              title: t.title || "",
              url: t.url,
              provider: C.providerForURL(t.url),
            }));
        case "generate": {
          M.normalize(args);
          if (!Number.isInteger(args.tabId) || args.tabId < 1)
            throw new Error("MCP_TAB_INVALID");
          const tab = await api.tabs.get(args.tabId);
          if (!chatURL(tab?.url)) throw new Error("MCP_TAB_UNSUPPORTED");
          let r;
          try {
            r = await api.tabs.sendMessage(args.tabId, {
              type: "MCP_GENERATE",
              input: {
                requestId: args.requestId,
                prompt: args.prompt,
                referenceIds: args.referenceIds || [],
              },
            });
          } catch {
            throw new Error(
              "GENERATION_OUTCOME_UNKNOWN: query the same requestId",
            );
          }
          if (!r?.ok) throw new Error(r?.error || "GENERATION_OUTCOME_UNKNOWN");
          return r.result;
        }
        case "job": {
          if (!requestId(args.requestId))
            throw new Error("MCP_REQUEST_INVALID");
          const q = await internal({ type: "QUEUE_GET" }),
            item = q.state.items.find((x) => x.id === "mcp-" + args.requestId);
          if (!item) throw new Error("JOB_NOT_FOUND");
          return { ...M.jobInfo(item), requestId: args.requestId };
        }
        case "import_reference": {
          C.parseImageDataURL(args.dataUrl);
          return metadata(
            (
              await internal({
                type: "ASSET_PUT",
                asset: {
                  dataUrl: args.dataUrl,
                  name: String(args.name || "MCP 参考图").slice(0, 100),
                  role: "reference",
                },
              })
            ).asset,
          );
        }
        case "list_images":
          return (await internal({ type: "ASSET_LIST" })).assets.map(metadata);
        case "get_image": {
          if (!imageId(args.assetId)) throw new Error("MCP_IMAGE_INVALID");
          const a = (
            await internal({ type: "ASSET_GET", assetId: args.assetId })
          ).asset;
          if (!a) throw new Error("IMAGE_NOT_FOUND");
          return a;
        }
        case "download": {
          const value = downloadTail.then(() => download(args));
          downloadTail = value.catch(() => {});
          return value;
        }
        case "download_status": {
          if (
            !(Number.isInteger(args.downloadId) && args.downloadId > 0) &&
            !(
              typeof args.downloadId === "string" &&
              /^local-[a-f0-9-]{36}$/.test(args.downloadId)
            )
          )
            throw new Error("MCP_DOWNLOAD_INVALID");
          const r = await internal({
            type: "DOWNLOAD_STATUS",
            downloadId: args.downloadId,
          });
          return { downloadId: r.downloadId, state: r.state, error: r.error };
        }
        default:
          throw new Error("MCP_OPERATION_NOT_ALLOWED");
      }
    }
    function stopSocket() {
      rejectLocal();
      ++epoch;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeat);
      reconnectTimer = null;
      heartbeat = null;
      connected = false;
      const previous = socket;
      socket = null;
      previous?.close();
    }
    function connect() {
      if (!config || socket) return;
      const current = epoch;
      try {
        socket = new WebSocketImpl(
          "ws://" + D.HOST + ":" + config.port + "/bridge",
        );
      } catch {
        lastError = "MCP_BRIDGE_OFFLINE";
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }
      const ws = socket;
      ws.addEventListener("open", () => {
        if (current === epoch && config)
          ws.send(JSON.stringify({ type: "auth", token: config.token }));
      });
      ws.addEventListener("message", async (event) => {
        if (current !== epoch) return;
        let frame;
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          ws.close();
          return;
        }
        if (frame.type === "ready") {
          connected = true;
          librarySupported = frame.capabilities?.library === true;
          lastError = "";
          if (librarySupported) controller.flushLibrary?.().catch(() => {});
          heartbeat = setInterval(() => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: "pong" }));
          }, 20000);
          return;
        }
        if (!connected) return;
        if (frame.type === "local_result") {
          const pending = localPending.get(frame.id);
          if (pending) {
            clearTimeout(pending.timer);
            localPending.delete(frame.id);
            if (frame.ok) pending.resolve(frame.result);
            else pending.reject(new Error(frame.error || "LIBRARY_FAILED"));
          }
          return;
        }
        if (frame.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (
          frame.type !== "command" ||
          typeof frame.id !== "string" ||
          frame.id.length > 100
        ) {
          ws.close();
          return;
        }
        let response;
        try {
          response = {
            type: "result",
            id: frame.id,
            ok: true,
            result: await execute(frame.op, frame.args),
          };
        } catch (e) {
          response = {
            type: "result",
            id: frame.id,
            ok: false,
            error: String(e.message || "MCP_COMMAND_FAILED")
              .replaceAll(config?.token || "\u0000", "[redacted]")
              .slice(0, 500),
          };
        }
        if (current === epoch && ws.readyState === 1)
          ws.send(JSON.stringify(response));
      });
      ws.addEventListener("error", () => {
        lastError = "MCP_BRIDGE_OFFLINE";
      });
      ws.addEventListener("close", () => {
        if (current !== epoch) return;
        connected = false;
        rejectLocal();
        socket = null;
        clearInterval(heartbeat);
        heartbeat = null;
        lastError = "MCP_BRIDGE_DISCONNECTED";
        if (config) reconnectTimer = setTimeout(connect, 5000);
      });
    }
    async function restoreImpl() {
      const local = (await api.storage.local.get("mcpDefaultsDisabled"))
        .mcpDefaultsDisabled;
      defaultsDisabled = local !== undefined && local !== false;
      const saved = (await session.get("mcpBridge")).mcpBridge;
      if (saved) {
        const next = validate(saved);
        const savedSource =
          (await session.get("mcpBridgeSource")).mcpBridgeSource === "default"
            ? "default"
            : "manual";
        if (savedSource === "default" && defaultsDisabled) {
          stopSocket();
          config = null;
          source = null;
          await session.remove("mcpBridge");
          await session.remove("mcpBridgeSource");
          lastError = "";
          return;
        }
        try {
          await permission();
        } catch (error) {
          stopSocket();
          config = next;
          source = savedSource;
          throw error;
        }
        replaceConfig(next, savedSource);
        return;
      }
      if (defaultsDisabled) {
        stopSocket();
        config = null;
        source = null;
        lastError = "";
        return;
      }
      await permission();
      const next = await loadDefault();
      await permission();
      await saveConfig(next, "default");
    }
    function restore() {
      return ordered(async () => {
        try {
          await restoreImpl();
        } catch (error) {
          lastError = publicError(error);
        }
        return info();
      });
    }
    async function disconnectImpl() {
      stopSocket();
      config = null;
      source = null;
      defaultsDisabled = true;
      await api.storage.local.set({ mcpDefaultsDisabled: true });
      await session.remove("mcpBridge");
      await session.remove("mcpBridgeSource");
      lastError = "";
    }
    function disconnect() {
      return ordered(disconnectImpl);
    }
    async function handleMessage(message, sender) {
      if (
        ![
          "MCP_BRIDGE_SET",
          "MCP_BRIDGE_INFO",
          "MCP_BRIDGE_CLEAR",
          "MCP_BRIDGE_USE_DEFAULTS",
        ].includes(message?.type)
      )
        return undefined;
      if (!ownPage(sender))
        return { ok: false, error: "MCP_SETTINGS_PAGE_REQUIRED" };
      return ordered(async () => {
        try {
          if (
            message.type === "MCP_BRIDGE_SET" ||
            message.type === "MCP_BRIDGE_USE_DEFAULTS"
          ) {
            const useDefault = message.type === "MCP_BRIDGE_USE_DEFAULTS";
            const next = useDefault
              ? await loadDefault()
              : validate(message.pairing);
            await permission();
            await saveConfig(next, useDefault ? "default" : "manual");
          }
          if (message.type === "MCP_BRIDGE_CLEAR") await disconnectImpl();
          if (message.type === "MCP_BRIDGE_INFO") await restoreImpl();
          return { ok: true, ...info() };
        } catch (error) {
          lastError = publicError(error);
          return { ok: false, ...info(), error: lastError };
        }
      });
    }
    return { handleMessage, restore, disconnect, info };
  }
  return { createMCPBackground };
});
