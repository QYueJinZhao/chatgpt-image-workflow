(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQBatch = api;
})(globalThis, function () {
  "use strict";
  function createBatch({ items, execute, onChange = () => {} }) {
    if (
      !Array.isArray(items) ||
      items.length > 2000 ||
      new Set(items.map((x) => x.id)).size !== items.length ||
      items.some((x) => typeof x.id !== "string" || !x.id) ||
      typeof execute !== "function"
    )
      throw new Error("批次参数无效");
    const state = {
      status: "idle",
      items: items.map((x) => ({
        id: x.id,
        label: String(x.label || x.id).slice(0, 300),
        status: "pending",
        error: "",
      })),
    };
    let running = false,
      cancelRequested = false,
      currentCancel = null;
    const snapshot = () => structuredClone(state),
      emit = () => onChange(snapshot());
    function triggerCancel() {
      if (!currentCancel) return;
      const fn = currentCancel;
      currentCancel = null;
      Promise.resolve(fn()).catch(() => {});
    }
    async function start() {
      if (running) throw new Error("批次正在执行");
      running = true;
      cancelRequested = false;
      state.status = "running";
      emit();
      try {
        for (const item of state.items) {
          if (item.status !== "pending") continue;
          if (cancelRequested) {
            item.status = "cancelled";
            emit();
            continue;
          }
          item.status = "running";
          currentCancel = null;
          emit();
          const context = {
            isCancelled: () => cancelRequested,
            onCancel: (fn) => {
              currentCancel = fn;
              if (cancelRequested) triggerCancel();
            },
            throwIfCancelled: () => {
              if (cancelRequested) {
                const e = new Error("已取消后续操作");
                e.name = "BatchCancelled";
                throw e;
              }
            },
          };
          try {
            await execute({ ...item }, context);
            item.status = "done";
            item.error = "";
          } catch (e) {
            item.status =
              e.name === "BatchCancelled"
                ? "cancelled"
                : e.name === "OutcomeUnknown"
                  ? "unknown"
                  : "failed";
            item.error = String(e.message || "操作失败").slice(0, 2000);
          } finally {
            currentCancel = null;
            emit();
          }
        }
      } finally {
        running = false;
        state.status = cancelRequested ? "cancelled" : "completed";
        emit();
      }
      return snapshot();
    }
    async function retryFailed() {
      if (running) throw new Error("批次正在执行");
      for (const item of state.items)
        if (item.status === "failed") {
          item.status = "pending";
          item.error = "";
        }
      return start();
    }
    function cancel() {
      if (!running) return;
      cancelRequested = true;
      triggerCancel();
      emit();
    }
    return {
      get snapshot() {
        return snapshot();
      },
      start,
      retryFailed,
      cancel,
    };
  }
  return { createBatch };
});
