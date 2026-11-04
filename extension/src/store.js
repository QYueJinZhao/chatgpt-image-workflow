(function (root, factory) {
  const api = factory(
    root.CPQCore || (typeof require === "function" && require("./core.js")),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQStore = api;
})(globalThis, function (C) {
  "use strict";
  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const complete = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () =>
        reject(tx.error || new Error("数据库事务失败"));
    });
  const digest = async (bytes) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  const cleanSource = (x) => ({
    prompt: String(x.prompt || "").slice(0, 20000),
    taskId: String(x.taskId || "").slice(0, 160),
    conversationId: String(x.conversationId || "").slice(0, 160),
    provider: ["chatgpt", "gemini"].includes(x.provider) ? x.provider : "",
  });
  function conversation(x) {
    if (
      !x ||
      typeof x.id !== "string" ||
      !x.id ||
      x.id.length > 160 ||
      !Array.isArray(x.messages) ||
      x.messages.length > 5000
    )
      throw new Error("会话数据无效");
    return {
      id: x.id,
      title: String(x.title || "未命名会话").slice(0, 300),
      url: C.safePublicURL(x.url),
      updatedAt: Date.now(),
      messages: x.messages.map((m) => {
        if (
          !["user", "assistant", "system", "tool"].includes(m.role) ||
          typeof m.text !== "string" ||
          m.text.length > 1000000
        )
          throw new Error("会话消息无效");
        return {
          role: m.role,
          text: m.text,
          markdown: String(m.markdown ?? m.text).slice(0, 1000000),
          assetIds: Array.isArray(m.assetIds)
            ? m.assetIds.filter((v) => typeof v === "string").slice(0, 200)
            : [],
        };
      }),
    };
  }
  function createStore(indexedDB, options = {}) {
    const name = options.name || "cpq-workbench-v3";
    let dbPromise;
    async function db() {
      if (!dbPromise)
        dbPromise = new Promise((resolve, reject) => {
          const r = indexedDB.open(name, 1);
          r.onupgradeneeded = () => {
            for (const s of ["assets", "conversations"])
              r.result.createObjectStore(s, { keyPath: "id" });
          };
          r.onsuccess = () => {
            r.result.onversionchange = () => r.result.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
          r.onblocked = () => reject(new Error("数据库被另一个页面占用"));
        });
      return dbPromise;
    }
    async function read(table, id) {
      const tx = (await db()).transaction(table);
      return request(
        id === undefined
          ? tx.objectStore(table).getAll()
          : tx.objectStore(table).get(id),
      );
    }
    async function asset(x) {
      const { bytes, mime } = C.parseImageDataURL(x.dataUrl),
        id = await digest(bytes);
      let width = 0,
        height = 0;
      if (typeof createImageBitmap === "function") {
        let bitmap;
        try {
          bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
          width = bitmap.width;
          height = bitmap.height;
        } catch {
          throw new Error("图片无法解码");
        } finally {
          bitmap?.close();
        }
        if (!width || !height) throw new Error("图片尺寸无效");
      }
      if (x.id && x.id !== id) throw new Error("图片校验和不一致");
      return {
        id,
        dataUrl: x.dataUrl,
        mime,
        width,
        height,
        size: bytes.length,
        name: C.sanitizePart(x.name || "图片"),
        caption: String(x.caption || "").slice(0, 20000),
        roles: [
          ...new Set(
            (x.roles || [x.role || "generated"]).filter((v) =>
              ["reference", "generated", "captured"].includes(v),
            ),
          ),
        ],
        sources: Array.isArray(x.sources)
          ? x.sources.slice(0, 2000).map(cleanSource)
          : [cleanSource(x)],
        createdAt: Number(x.createdAt) || Date.now(),
        sync: {},
      };
    }
    async function mutate(table, id, fn) {
      const tx = (await db()).transaction(table, "readwrite"),
        done = complete(tx),
        s = tx.objectStore(table);
      const existing = await request(s.get(id));
      const value = fn(existing);
      if (value) s.put(value);
      await done;
      return value;
    }
    async function putAsset(x) {
      const a = await asset(x);
      return mutate("assets", a.id, (old) =>
        old
          ? {
              ...old,
              roles: [...new Set([...old.roles, ...a.roles])],
              sources: [
                ...old.sources,
                ...a.sources.filter(
                  (s) =>
                    !old.sources.some(
                      (o) => JSON.stringify(o) === JSON.stringify(s),
                    ),
                ),
              ].slice(-2000),
            }
          : a,
      );
    }
    async function updateAsset(id, changes) {
      return mutate("assets", id, (old) => {
        if (!old) throw new Error("图片不存在");
        const next = { ...old };
        if (typeof changes.caption === "string")
          next.caption = changes.caption.slice(0, 20000);
        if (Array.isArray(changes.tags))
          next.tags = changes.tags
            .map((v) => String(v).slice(0, 80))
            .slice(0, 30);
        if (
          changes.download &&
          ["complete", "interrupted", "unknown"].includes(
            changes.download.state,
          )
        )
          next.download = {
            state: changes.download.state,
            completedAt: Number(changes.download.completedAt) || 0,
            ...(changes.download.backend === "native"
              ? {
                  backend: "native",
                  requestId: String(changes.download.requestId || "").slice(
                    0,
                    100,
                  ),
                }
              : {}),
          };
        if (changes.sync && typeof changes.sync === "object")
          next.sync = Object.fromEntries(
            Object.entries(changes.sync)
              .filter(([k]) =>
                [
                  "endpoint",
                  "indexHash",
                  "verifiedSha256",
                  "knowledgeId",
                  "fileId",
                  "stage",
                  "error",
                  "updatedAt",
                ].includes(k),
              )
              .map(([k, v]) => [
                k,
                typeof v === "string" ? v.slice(0, 2000) : Number(v) || 0,
              ]),
          );
        return next;
      });
    }
    async function putConversation(x) {
      const c = conversation(x);
      return mutate("conversations", c.id, () => c);
    }
    async function exportWorkspace() {
      return {
        format: "cpq-workspace",
        version: 1,
        exportedAt: new Date().toISOString(),
        assets: await read("assets"),
        conversations: await read("conversations"),
      };
    }
    async function restoreWorkspace(bundle) {
      if (
        !bundle ||
        bundle.format !== "cpq-workspace" ||
        bundle.version !== 1 ||
        !Array.isArray(bundle.assets) ||
        !Array.isArray(bundle.conversations) ||
        bundle.assets.length > 2000 ||
        bundle.conversations.length > 2000
      )
        throw new Error("工作区版本或内容无效");
      let bytes = 0;
      const assets = [];
      for (const x of bundle.assets) {
        const a = await asset(x);
        bytes += a.size;
        if (bytes > 250 * 1024 * 1024) throw new Error("工作区超过 250 MiB");
        assets.push(a);
      }
      const chats = bundle.conversations.map(conversation);
      for (const rows of [assets, chats])
        if (new Set(rows.map((x) => x.id)).size !== rows.length)
          throw new Error("工作区存在重复 ID");
      const queue = bundle.queue ? C.restoreCheckpoint(bundle.queue).items : [];
      const references = new Set([
        ...chats.flatMap((c) => c.messages.flatMap((m) => m.assetIds)),
        ...queue.flatMap((j) => [...j.referenceIds, ...j.generatedAssetIds]),
      ]);
      const tx = (await db()).transaction(
          ["assets", "conversations"],
          "readwrite",
        ),
        done = complete(tx);
      const available = new Set(assets.map((x) => x.id));
      for (const id of references) {
        if (available.has(id)) continue;
        if (!(await request(tx.objectStore("assets").get(id)))) {
          tx.abort();
          await done.catch(() => {});
          throw new Error("工作区图片引用缺失：" + id.slice(0, 12));
        }
      }
      for (const [table, rows] of [
        ["assets", assets],
        ["conversations", chats],
      ])
        for (const row of rows) {
          const s = tx.objectStore(table);
          const r = s.get(row.id);
          r.onsuccess = () => {
            if (!r.result) s.add(row);
          };
        }
      await done;
      return { assets: assets.length, conversations: chats.length };
    }
    return {
      name,
      putAsset,
      getAsset: (id) => read("assets", id),
      listAssets: async () =>
        (await read("assets")).map(({ dataUrl, ...a }) => a),
      updateAsset,
      putConversation,
      getConversation: (id) => read("conversations", id),
      listConversations: () => read("conversations"),
      exportWorkspace,
      restoreWorkspace,
    };
  }
  return { createStore, digest };
});
