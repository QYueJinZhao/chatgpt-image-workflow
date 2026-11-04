(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQMCPContent = api;
})(globalThis, function () {
  "use strict";
  function normalize(input) {
    if (
      !input ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId || "") ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 20000
    )
      throw new Error("INVALID_GENERATION");
    const referenceIds = input.referenceIds || [];
    if (
      !Array.isArray(referenceIds) ||
      referenceIds.length > 10 ||
      referenceIds.some((x) => !/^[a-f0-9]{64}$/.test(x))
    )
      throw new Error("INVALID_REFERENCES");
    return {
      requestId: input.requestId,
      prompt: input.prompt,
      referenceIds: [...new Set(referenceIds)],
    };
  }
  function jobInfo(item) {
    return {
      jobId: item.id,
      provider: item.provider ?? "chatgpt",
      status: item.status,
      stage: item.stage,
      assetIds: item.generatedAssetIds || [],
      downloadIds: item.downloadIds || {},
      error: item.lastError || "",
    };
  }
  function createContentHandler({
    provider = "chatgpt",
    getState,
    reload,
    save,
    acquire,
    release,
    hasDraft,
    validateReferences,
    render,
    start,
    onStartError = () => {},
  }) {
    let tail = Promise.resolve();
    async function generate(input) {
      const job = normalize(input),
        jobId = "mcp-" + job.requestId;
      await reload();
      function existing() {
        const item = getState().items.find((x) => x.id === jobId);
        if (
          item &&
          (item.prompt !== job.prompt ||
            (item.provider ?? "chatgpt") !== provider ||
            JSON.stringify(item.referenceIds || []) !==
              JSON.stringify(job.referenceIds))
        )
          throw new Error("REQUEST_CONFLICT");
        return item;
      }
      const old = existing();
      if (old)
        return { ...jobInfo(old), requestId: job.requestId, duplicate: true };
      if (getState().running) throw new Error("QUEUE_BUSY");
      await acquire();
      let transferred = false;
      try {
        await reload();
        const found = existing();
        if (found)
          return {
            ...jobInfo(found),
            requestId: job.requestId,
            duplicate: true,
          };
        const state = getState();
        if (
          state.running ||
          state.items.some((x) => !["done", "skipped"].includes(x.status))
        )
          throw new Error("QUEUE_BUSY");
        if (state.items.length >= 2000) throw new Error("QUEUE_FULL");
        if (hasDraft()) throw new Error("DRAFT_PRESENT");
        await validateReferences(job.referenceIds);
        const item = {
          id: jobId,
          prompt: job.prompt,
          referenceIds: job.referenceIds,
          kind: "image",
          provider,
          status: "pending",
          stage: "pending",
          attempts: 0,
          createdAt: Date.now(),
        };
        state.items.push(item);
        await save();
        render();
        transferred = true;
        Promise.resolve(start()).catch(onStartError);
        return { ...jobInfo(item), requestId: job.requestId, duplicate: false };
      } finally {
        if (!transferred) await release();
      }
    }
    return {
      generate(input) {
        const call = tail.then(() => generate(input));
        tail = call.catch(() => {});
        return call;
      },
    };
  }
  return { normalize, jobInfo, createContentHandler };
});
