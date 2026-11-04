(function (root) {
  "use strict";
  const C = root.CPQCore,
    A = root.CPQArchive,
    P = root.CPQCapture;
  const archiveBuild = "role-headings-20261021-r2";
  async function request(message) {
    const r = await chrome.runtime.sendMessage(message);
    if (!r?.ok) {
      const code = r?.error || "";
      const error = new Error(
        code === "LIBRARY_OFFLINE"
          ? "本机服务未连接或版本较旧，请在资料 → 设置中检查连接。"
          : /OUTCOME_UNKNOWN/.test(code)
            ? "下载结果待核对，请到资料 → 设置 → 核对未完成下载处理。"
            : code || "扩展后台无响应，请重新载入页面",
      );
      if (/OUTCOME_UNKNOWN/.test(code)) error.name = "OutcomeUnknown";
      throw error;
    }
    return r;
  }
  function base64(bytes) {
    return C.toDataURL(bytes, "application/octet-stream").split(",")[1];
  }
  async function download(bytes, name, mime, folder = "ChatGPT 工作台") {
    const r = await request({
      type: "FILE_DOWNLOAD",
      base64: base64(bytes),
      name,
      mime,
      folder,
    });
    const end = Date.now() + 120000;
    while (Date.now() < end) {
      const s = await request({
        type: "DOWNLOAD_STATUS",
        downloadId: r.downloadId,
      });
      if (s.state === "complete") return r.downloadId;
      if (s.state !== "in_progress") throw new Error("下载未完成：" + s.state);
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("下载等待超时，请检查 Chrome 下载页");
  }
  async function archiveCurrent() {
    const panel = document.getElementById("cpq-root");
    if (panel) panel.dataset.archivePhase = "scan";
    const chat = P.captureConversation(document);
    if (!chat.messages.length) throw new Error("当前页面没有已加载的会话消息");
    const nodes = P.messages(document);
    if (panel) {
      panel.dataset.archiveMessages = String(chat.messages.length);
      panel.dataset.archiveNodes = String(nodes.length);
      panel.dataset.archivePhase = "assets";
    }
    console.info("[CPQ archive]", {
      build: archiveBuild,
      phase: "assets",
      messages: chat.messages.length,
      nodes: nodes.length,
    });
    for (let i = 0; i < chat.messages.length; i++)
      for (const img of nodes[i].querySelectorAll("img")) {
        if (
          img.naturalWidth < 180 ||
          img.naturalHeight < 180 ||
          !C.isImageURL(img.currentSrc || img.src, P.provider(document))
        )
          continue;
        const { asset } = await request({
          type: "ASSET_PUT",
          asset: {
            dataUrl: await P.imageData(img),
            name: chat.title + "-" + (i + 1),
            role: "captured",
            conversationId: chat.id,
          },
        });
        chat.messages[i].assetIds.push(asset.id);
      }
    if (panel) panel.dataset.archivePhase = "conversation";
    await request({ type: "CONVERSATION_PUT", conversation: chat });
    if (panel) panel.dataset.archivePhase = "complete";
    console.info("[CPQ archive]", {
      build: archiveBuild,
      phase: "complete",
      messages: chat.messages.length,
    });
    return chat;
  }
  function createConnectionView(rootNode, onClose = () => {}) {
    const view = document.createElement("dialog");
    view.className = "cpq-connections-view cpq-settings-overlay";
    view.setAttribute("aria-label", "存储与服务设置");
    view.hidden = true;
    const version=chrome.runtime.getManifest?.()?.version || "开发版";
    view.innerHTML = `<button class="cpq-settings-scrim" aria-label="关闭存储设置" tabindex="-1"></button><section class="cpq-settings-sheet"><div class="cpq-connections-bar"><strong>存储与服务设置</strong><span>v${version}</span><button id="cpq-connections-back" aria-label="关闭设置">×</button></div><div class="cpq-connections-body"><div class="cpq-settings-state"><div class="cpq-connections-loading" role="status" aria-live="polite"><h2>正在打开设置…</h2><p></p></div><div class="cpq-skeleton" aria-hidden="true"><span></span><span></span><span></span></div><div class="cpq-connections-recovery"><button id="cpq-connections-retry" class="cpq-primary" hidden>重试加载</button><button id="cpq-connections-open" type="button">独立打开设置</button><p id="cpq-connections-open-status" role="status" aria-live="polite"></p></div></div><div class="cpq-connections-frame"></div></div><div class="cpq-settings-maintenance"><button type="button" data-open="backup">备份与恢复 ›</button><button type="button" data-open="tools">资料与帮助 ›</button></div><div class="cpq-sheet-storage-bar"><span class="cpq-sheet-storage-summary">图片保存方式</span><button class="cpq-settings-collapse">收起设置</button></div></section>`;
    const footer = rootNode.querySelector("footer");
    if (footer) footer.before(view);
    else rootNode.append(view);
    const scroll = rootNode.querySelector(".cpq-scroll"),
      tabs = rootNode.querySelector(".cpq-tabs"),
      stateBox = view.querySelector(".cpq-settings-state"),
      loading = view.querySelector(".cpq-connections-loading"),
      heading = loading.querySelector("h2"),
      message = loading.querySelector("p"),
      retry = view.querySelector("#cpq-connections-retry"),
      standalone = view.querySelector("#cpq-connections-open"),
      openStatus = view.querySelector("#cpq-connections-open-status"),
      slot = view.querySelector(".cpq-connections-frame");
    let frame = null,
      timer = null,
      probeTimer = null,
      scrollTop = 0;
    let returnFocus = null;
    let attempt = 0, requestId = "";
    function stopWaiting() {
      clearTimeout(timer);
      clearInterval(probeTimer);
      probeTimer = null;
    }
    function fail(run, reason = "unavailable") {
      if (view.hidden || run !== attempt || view.dataset.state !== "loading") return;
      stopWaiting();
      view.dataset.failure = reason;
      view.dataset.state = "failed";
      view.setAttribute("aria-busy", "false");
      loading.hidden = false;
      stateBox.hidden = false;
      heading.textContent = "设置未能加载";
      const errors = {
        "context-invalid":"当前页面的扩展连接已失效。请保留未提交内容，再刷新网站页面后打开设置。",
        "resource-timeout":"设置资源在 10 秒内未加载完成。请重试，或独立打开设置检查扩展是否已重载。",
        "startup-timeout":"未在 10 秒内收到设置脚本的就绪响应。请重新加载扩展并刷新网站页面，也可独立打开设置。",
        "SCRIPT_ERROR":"设置脚本启动失败（SCRIPT_ERROR）。请重新加载扩展并刷新网站页面，也可独立打开设置。",
        "SCRIPT_RESOURCE":"设置脚本文件加载失败（SCRIPT_RESOURCE）。请重新加载扩展并刷新网站页面，也可独立打开设置。",
      };
      message.textContent = errors[reason] || "设置页未能完成加载。可以重试，或独立打开设置；返回后原页面内容仍会保留。";
      retry.hidden = false;
      if (frame) frame.hidden = true;
      if (document.activeElement === standalone || document.activeElement === retry) retry.focus();
    }
    function acceptStatus(status, run, current) {
      if (view.hidden || run !== attempt || frame !== current || view.dataset.state !== "loading" ||
          status?.type !== "CPQ_SETTINGS_STATUS" || status.requestId !== requestId ||
          !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(status.version || "")) return;
      if (status.state === "failed" && ["SCRIPT_ERROR","SCRIPT_RESOURCE"].includes(status.code)) {
        fail(run, status.code); return;
      }
      if (status.state === "booting") {view.dataset.stage = "script-booting"; return;}
      if (status.state !== "ready" || status.code) return;
      stopWaiting();
      view.dataset.state = "ready";
      view.dataset.stage = "ready";
      view.dataset.settingsVersion = status.version;
      view.setAttribute("aria-busy", "false");
      loading.hidden = true;
      stateBox.hidden = true;
      frame.hidden = false;
    }
    function load(retrying = false) {
      stopWaiting();
      const run = ++attempt;
      slot.replaceChildren();
      frame = null;
      view.dataset.state = "loading";
      view.dataset.stage = "frame-loading";
      delete view.dataset.failure;
      delete view.dataset.settingsVersion;
      view.setAttribute("aria-busy", "true");
      loading.hidden = false;
      stateBox.hidden = false;
      heading.textContent = retrying ? "正在重试打开设置…" : "正在打开设置…";
      message.textContent = "正在读取扩展设置。也可以在独立页面中打开。";
      retry.hidden = true;
      if (document.activeElement === retry) standalone.focus();
      openStatus.textContent = "";
      timer = setTimeout(() => fail(run, view.dataset.stage === "frame-loading" ? "resource-timeout" : "startup-timeout"), 10000);
      try {
        chrome.runtime.getURL(""); // Detect an invalidated content-script context before creating the frame.
        requestId = crypto.randomUUID();
        frame = document.createElement("iframe");
        frame.title = "下载设置（扩展隔离页面）";
        frame.hidden = true;
        frame.name = "cpq-settings:" + requestId;
        frame.src = chrome.runtime.getURL("options.html");
        const current = frame;
        frame.addEventListener("error", () => fail(run));
        frame.addEventListener("load", () => {
          if (!view.hidden && run === attempt && frame === current && view.dataset.state === "loading" && view.dataset.stage === "frame-loading") view.dataset.stage = "frame-loaded";
        });
        async function probe() {
          if (view.hidden || run !== attempt || frame !== current || view.dataset.state !== "loading") return;
          try {
            const status = await chrome.runtime.sendMessage({type:"SETTINGS_READINESS_PROBE",requestId});
            acceptStatus(status, run, current);
          } catch (error) {
            if (/Extension context invalidated/i.test(error?.message || "")) fail(run, "context-invalid");
          }
        }
        slot.append(frame);
        probeTimer = setInterval(probe, 350);
        probe();
      } catch (error) {
        fail(run, /Extension context invalidated/i.test(error?.message || "") ? "context-invalid" : "unavailable");
      }
    }
    function closeFromSettings(message,sender,reply) {
      if(view.hidden || !rootNode.isConnected || !chrome.runtime.id || sender?.id!==chrome.runtime.id ||
          message?.type!=="SETTINGS_DRAWER_CLOSE" || message.requestId!==requestId)return;
      close();reply({ok:true});
    }
    let resizeObserver=null;
    function syncBounds() {
      if(view.hidden)return;
      const rect=rootNode.getBoundingClientRect();
      if(rect.width && rect.height)Object.assign(view.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    }
    function open(trigger) {
      if(!view.hidden)return;
      returnFocus=trigger || (rootNode.contains(document.activeElement)?document.activeElement:(rootNode.querySelector('#cpq-storage-settings') || rootNode.querySelector('#cpq-options')));
      scrollTop=scroll?.scrollTop||0;
      rootNode.dataset.connectionsOpen='true';view.hidden=false;syncBounds();
      chrome.runtime.onMessage?.addListener(closeFromSettings);
      rootNode.querySelector('#cpq-storage-settings')?.setAttribute('aria-expanded','true');
      if(typeof view.showModal==='function')view.showModal();else view.setAttribute('open','');
      if(typeof ResizeObserver!=='undefined'){resizeObserver=new ResizeObserver(syncBounds);resizeObserver.observe(rootNode);}
      window.addEventListener('resize',syncBounds);
      load();view.querySelector('#cpq-connections-back').focus();
      rootNode.dispatchEvent(new CustomEvent('cpq:connections-changed'));
    }
    function close() {
      if(view.hidden)return;
      stopWaiting();attempt++;slot.replaceChildren();frame=null;view.hidden=true;
      chrome.runtime.onMessage?.removeListener?.(closeFromSettings);
      resizeObserver?.disconnect();resizeObserver=null;window.removeEventListener('resize',syncBounds);
      if(view.open){if(typeof view.close==='function')view.close();else view.removeAttribute('open');}
      delete rootNode.dataset.connectionsOpen;
      rootNode.querySelector('#cpq-storage-settings')?.setAttribute('aria-expanded','false');
      if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
      onClose();rootNode.dispatchEvent(new CustomEvent('cpq:connections-changed'));
    }
    view.addEventListener('cancel',event=>{event.preventDefault();close();});
    view.addEventListener('keydown',event=>{
      if(event.key!=='Tab' || event.defaultPrevented)return;
      const first=view.querySelector('#cpq-connections-back'),last=view.querySelector('.cpq-settings-collapse');
      if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      else if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
    });
    view.addEventListener('close',()=>{if(!view.hidden)close();});
    view.querySelector('.cpq-settings-scrim').onclick=close;
    view.querySelector('.cpq-settings-collapse').onclick=close;
    retry.onclick = () => load(true);
    standalone.onclick = async () => {
      if (standalone.disabled) return;
      const run = attempt;
      standalone.disabled = true;
      openStatus.textContent = "正在打开独立设置页…";
      try {
        const result = await chrome.runtime.sendMessage({type:"OPEN_OPTIONS"});
        if (!result?.ok) throw new Error("OPEN_FAILED");
        if (!view.hidden && run === attempt) openStatus.textContent = "已打开独立设置页。此处可以返回继续使用工作台。";
      } catch {
        if (!view.hidden && run === attempt) openStatus.textContent = "独立设置页未能打开。请保留未提交内容并刷新网站页面后重试。";
      } finally { standalone.disabled = false; }
    };
    view.querySelector("#cpq-connections-back").onclick = close;
    return { open, close };
  }
  function mount(rootNode, getQueue) {
    rootNode.dataset.archiveSchema = archiveBuild;
    let restoredQueue = null,
      activeBatch = null,
      batchPreparing = false,
      batchKind = "";
    const selectedReferences = new Set(),
      selectedAssets = new Set();
    const $ = (s) => rootNode.querySelector(s);
    $('[data-pane="tools"]').innerHTML =
      `<div class="cpq-manager-heading"><h2>工作区</h2></div>
      <section class="cpq-connection-row"><div><strong>本机连接</strong><p id="cpq-connection-info" class="cpq-help">图片目录、SQLite 与下载通知</p></div><button id="cpq-options">设置</button></section>
      <section class="cpq-current-card"><h2>当前会话</h2><p class="cpq-help">保存当前已加载的消息与图片。需要更早的内容时，先向上滚动加载。</p><button id="cpq-capture" class="cpq-primary">归档当前会话</button><details id="cpq-export-options"><summary>导出选项</summary><div class="cpq-inline"><label>导出格式<select id="cpq-export-format"><option value="md">Markdown</option><option value="txt">TXT</option><option value="json">JSON</option><option value="html">HTML（含图片）</option><option value="pdf">PDF（图片式）</option></select></label><button id="cpq-export-chat">导出当前会话</button></div></details></section>
      <h2 class="cpq-manager-label">资料与备份</h2>
      <div class="cpq-manager-groups">
      <details id="cpq-reference-group" class="cpq-manager-group"><summary><span>参考图<small>用于图生图</small></span><span id="cpq-reference-count" class="cpq-help"></span></summary><div class="cpq-manager-body"><p class="cpq-help">勾选后用于新加入的任务。PNG / JPG / WebP，单张最多 20 MiB。</p><label class="cpq-import-control">添加参考图<input id="cpq-ref-file" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><div id="cpq-ref-list"></div></div></details>
      <details id="cpq-conversations-group" class="cpq-manager-group"><summary><span>已归档会话<small>本地会话记录</small></span><span id="cpq-conversation-count" class="cpq-help"></span></summary><div class="cpq-manager-body"><div id="cpq-conversation-list"></div><nav id="cpq-conversation-pagination" class="cpq-pagination" aria-label="归档会话分页" hidden><button id="cpq-conversation-prev">上一页</button><label><span class="cpq-sr-only">归档会话页码</span><select id="cpq-conversation-page"></select></label><button id="cpq-conversation-next">下一页</button></nav></div></details>
      <details id="cpq-backup-group" class="cpq-manager-group"><summary><span>备份与恢复<small>ZIP 工作区备份</small></span></summary><div id="cpq-backup-body" class="cpq-manager-body"><p class="cpq-help">包含会话、原图和队列快照。恢复只追加，不覆盖已有资料，也不会启动任务。</p><button id="cpq-workspace-export">导出工作区 ZIP</button><label class="cpq-import-control">恢复工作区 ZIP<input id="cpq-workspace-restore" type="file" accept=".zip"></label></div></details>
      <details class="cpq-manager-group"><summary><span>关于与隐私<small>版本与数据保存</small></span></summary><div class="cpq-manager-body"><p class="cpq-help">MIT 开源派生。当前运行版本见底栏。原图保存在本地，可导出备份。不读取 ChatGPT 网站令牌；授权凭据仅保存在扩展会话中，不进入网站页面。</p></div></details></div>
      <p id="cpq-tool-status" role="status" aria-live="polite"></p>`;
    const referenceSlot = $("#cpq-reference-slot");
    if (referenceSlot) referenceSlot.append($("#cpq-reference-group"));
    const restoredButton = document.createElement("button");
    restoredButton.id = "cpq-restored-queue";
    restoredButton.textContent = "导出恢复队列检查点";
    restoredButton.disabled = true;
    restoredButton.hidden = true;
    $("#cpq-backup-body").append(restoredButton);
    restoredButton.onclick = async () => {
      try {
        if (!restoredQueue) return;
        await download(
          new TextEncoder().encode(JSON.stringify(restoredQueue)),
          "restored-queue.json",
          "application/json",
        );
        status("恢复队列检查点已下载；通过任务导入进行核对，未启动队列。");
      } catch (e) {
        status(e.message);
      }
    };
    let statusEpoch = 0;
    const status = (text) => {
      statusEpoch++;
      $("#cpq-tool-status").textContent = text;
      return statusEpoch;
    };
    const galleryStatus = (text) => {
      $("#cpq-gallery-status").textContent = text;
    };
    const galleryView = root.CPQGalleryView.mount(rootNode, selectedAssets, {
      load: async (assetId) =>
        (await request({ type: "ASSET_GET", assetId })).asset,
      save: async (assetId, caption) => {
        await request({ type: "ASSET_UPDATE", assetId, caption });
        const saved = (await request({ type: "ASSET_GET", assetId })).asset;
        if (saved?.caption !== caption) throw new Error("描述保存结果待核对，请重新打开图片确认。");
      },
      loadPreferences: async () =>
        (await request({ type: "GALLERY_PREFERENCES_GET" })).preferences,
      savePreferences: (preferences) =>
        request({ type: "GALLERY_PREFERENCES_SET", preferences }),
      download: (assetId) => startBatch("download", [assetId]),
      reviewDownload: (id,trigger) => connections.open(trigger || $("#cpq-detail-download")),
      status: galleryStatus,
      refresh: () => refreshGallery(),
    });
    const batchResults = $("#cpq-batch-results");
    function lockBatchButtons(busy) {
      galleryView.setBusy(busy);
      for (const id of [
        "#cpq-bulk-download",
        "#cpq-bulk-zip",
        "#cpq-gallery-all",
        "#cpq-gallery-clear",
      ])
        $(id).disabled = busy;
    }
    function renderBatch(snapshot) {
      const busy = batchPreparing || snapshot.status === "running";
      lockBatchButtons(busy);
      $("#cpq-batch-cancel").disabled = !busy;
      $("#cpq-batch-retry").disabled =
        busy || !snapshot.items.some((x) => x.status === "failed");
      $("#cpq-batch-panel").hidden = false;
      const empty = $("#cpq-batch-empty");
      if (empty) empty.hidden = true;
      $("#cpq-batch-cancel").hidden = !busy;
      $("#cpq-batch-retry").hidden =
        busy || !snapshot.items.some((x) => x.status === "failed");
      $("#cpq-batch-details").open =
        busy ||
        snapshot.items.some((x) => ["failed", "unknown"].includes(x.status));
      batchResults.replaceChildren();
      const names = {
        pending: "待执行",
        running: "执行中",
        done: "成功",
        failed: "失败",
        cancelled: "未执行/已取消",
        unknown: "结果待核对",
      };
      for (const row of snapshot.items) {
        const li = document.createElement("li");
        li.dataset.batchStatus = row.status;
        li.textContent =
          row.label +
          " · " +
          names[row.status] +
          (row.error ? "：" + row.error : "");
        batchResults.append(li);
      }
      const count = (status) =>
        snapshot.items.filter((x) => x.status === status).length;
      galleryStatus(
        "下载" +
          "批次" +
          (busy ? "执行中" : "已结算") +
          " · 成功 " +
          count("done") +
          " · 失败 " +
          count("failed") +
          " · 取消 " +
          count("cancelled") +
          " · 待核对 " +
          count("unknown"),
      );
    }
    $("#cpq-batch-cancel").onclick = () => activeBatch?.cancel();
    function action(id, fn) {
      $(id).addEventListener("click", async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await fn();
        } catch (err) {
          status(err.message);
          galleryStatus(err.message);
        } finally {
          b.disabled = false;
          if (
            activeBatch &&
            ["cpq-bulk-download", "cpq-batch-retry"].includes(b.id)
          )
            renderBatch(activeBatch.snapshot);
        }
      });
    }
    function updateReferenceCount() {
      $("#cpq-reference-count").textContent = selectedReferences.size
        ? "已选 " + selectedReferences.size + " 张"
        : "未选择";
      rootNode.dispatchEvent(new CustomEvent("cpq:references-changed"));
    }
    async function refreshReferences() {
      const { assets } = await request({ type: "ASSET_LIST" });
      const list = $("#cpq-ref-list");
      list.replaceChildren();
      updateReferenceCount();
      for (const a of assets.filter((a) => a.roles.includes("reference"))) {
        const label = document.createElement("label");
        label.className = "cpq-check";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selectedReferences.has(a.id);
        check.onchange = () => {
          if (check.checked) selectedReferences.add(a.id);
          else selectedReferences.delete(a.id);
          updateReferenceCount();
        };
        label.append(
          check,
          document.createTextNode(
            a.name + " · " + Math.ceil(a.size / 1024) + " KiB",
          ),
        );
        list.append(label);
      }
    }
    $("#cpq-ref-file").addEventListener("change", async (e) => {
      try {
        for (const f of e.target.files) {
          const { asset } = await request({
            type: "ASSET_PUT",
            asset: await P.fileAsset(f),
          });
          selectedReferences.add(asset.id);
          rootNode.dispatchEvent(new CustomEvent('cpq:assets-changed'));
        }
        await refreshReferences();
        status("参考图已保存并勾选。");
      } catch (err) {
        status(err.message);
      } finally {
        e.target.value = "";
      }
    });
    let galleryEpoch = 0;
    async function refreshGallery() {
      const token = ++galleryEpoch;
      const { assets } = await request({ type: "ASSET_LIST" });
      if (token !== galleryEpoch) return;
      galleryView.render(assets.slice().reverse());
      $('#cpq-gallery-refresh').textContent='刷新';
      if (activeBatch) renderBatch(activeBatch.snapshot);
    }
    action("#cpq-capture", async () => {
      status("正在读取当前会话…");
      const c = await archiveCurrent();
      rootNode.dispatchEvent(new CustomEvent('cpq:assets-changed'));
      status(
        "已归档 " +
          c.messages.length +
          " 条消息和 " +
          c.messages.reduce((n, m) => n + m.assetIds.length, 0) +
          " 张图片。",
      );
      await refreshConversations();
    });
    action("#cpq-export-chat", async () => {
      status("正在整理导出…");
      const c = await archiveCurrent(),
        format = $("#cpq-export-format").value,
        assets = {};
      rootNode.dispatchEvent(new CustomEvent('cpq:assets-changed'));
      for (const id of new Set(c.messages.flatMap((m) => m.assetIds)))
        assets[id] = (
          await request({ type: "ASSET_GET", assetId: id })
        ).asset.dataUrl;
      const data =
        format === "pdf"
          ? await A.conversationPDF(c, assets)
          : new TextEncoder().encode(
              A.conversation(c, format, format === "html" ? assets : {}),
            );
      await download(
        data,
        C.sanitizePart(c.title) + "." + format,
        {
          md: "text/markdown",
          txt: "text/plain",
          json: "application/json",
          html: "text/html",
          pdf: "application/pdf",
        }[format],
      );
      status("导出已完成。Markdown 图片请使用工作区 ZIP 中的相对路径文件。");
    });
    action("#cpq-workspace-export", async () => {
      const token = status("正在打包工作区…");
      const { bundle } = await request({ type: "WORKSPACE_EXPORT" });
      bundle.queue = getQueue();
      await download(
        A.workspaceZip(bundle),
        "chatgpt-workspace-" + new Date().toISOString().slice(0, 10) + ".zip",
        "application/zip",
      );
      if (token === statusEpoch) status("工作区 ZIP 下载完成。");
    });
    $("#cpq-workspace-restore").addEventListener("change", async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        status("正在校验并追加工作区资料…");
        if (file.size > 300 * 1024 * 1024)
          throw new Error("工作区 ZIP 超过 300 MiB");
        const entries = A.unzip(new Uint8Array(await file.arrayBuffer()));
        if (!entries["workspace.json"]) throw new Error("缺少 workspace.json");
        const bundle = JSON.parse(
          new TextDecoder().decode(entries["workspace.json"]),
        );
        await request({ type: "WORKSPACE_RESTORE", bundle });
        rootNode.dispatchEvent(new CustomEvent('cpq:assets-changed'));
        restoredQueue = bundle.queue
          ? C.createCheckpoint(bundle.queue.state)
          : null;
        restoredButton.disabled = !restoredQueue;
        restoredButton.hidden = !restoredQueue;
        status("工作区资料已追加；队列未启动。");
        await refreshReferences();
        await refreshConversations();
      } catch (err) {
        status(err.message);
      } finally {
        e.target.value = "";
      }
    });
    let conversations = [],
      conversationPage = 1;
    function renderConversations() {
      const pages = Math.ceil(conversations.length / 10) || 1;
      conversationPage = Math.min(conversationPage, pages);
      $("#cpq-conversation-count").textContent = conversations.length + " 个";
      const list = $("#cpq-conversation-list");
      list.replaceChildren();
      for (const c of conversations.slice(
        (conversationPage - 1) * 10,
        conversationPage * 10,
      )) {
        const b = document.createElement("button");
        b.className = "cpq-archive-item";
        b.textContent =
          c.title + " · " + c.messages.length + " 条消息 · 导出 Markdown";
        b.onclick = async () => {
          try {
            await download(
              new TextEncoder().encode(A.conversation(c, "md")),
              C.sanitizePart(c.title) + ".md",
              "text/markdown",
            );
            status("归档会话已导出。");
          } catch (e) {
            status(e.message);
          }
        };
        list.append(b);
      }
      $("#cpq-conversation-pagination").hidden = pages <= 1;
      const select = $("#cpq-conversation-page");
      select.replaceChildren();
      for (let p = 1; p <= pages; p++) {
        const option = document.createElement("option");
        option.value = String(p);
        option.textContent = "第 " + p + " / " + pages + " 页";
        select.append(option);
      }
      select.value = String(conversationPage);
      $("#cpq-conversation-prev").disabled = conversationPage <= 1;
      $("#cpq-conversation-next").disabled = conversationPage >= pages;
    }
    async function refreshConversations() {
      const response = await request({ type: "CONVERSATION_LIST" });
      conversations = response.conversations;
      renderConversations();
    }
    $("#cpq-conversation-prev").onclick = () => {
      conversationPage = Math.max(1, conversationPage - 1);
      renderConversations();
    };
    $("#cpq-conversation-next").onclick = () => {
      conversationPage++;
      renderConversations();
    };
    $("#cpq-conversation-page").onchange = (e) => {
      conversationPage = Number(e.target.value) || 1;
      renderConversations();
    };
    const connections = createConnectionView(rootNode, () => {
      galleryView.updateSelection();
      refreshConnectionInfo().catch(() => {});
    });
    action("#cpq-options", () => connections.open());
    action("#cpq-gallery-refresh", refreshGallery);
    action("#cpq-gallery-all", () => galleryView.selectPage($("#cpq-gallery-all").checked));
    const chosen = async () => {
      if (!selectedAssets.size) throw new Error("请先选择图片");
      const rows = [];
      for (const id of [...selectedAssets])
        rows.push((await request({ type: "ASSET_GET", assetId: id })).asset);
      return rows;
    };
    async function startBatch(kind, requestedIds) {
      if (kind !== "download")
        throw new Error("知识库同步已移除，请使用下载。");
      if (batchPreparing || activeBatch?.snapshot.status === "running")
        throw new Error("批次正在执行");
      batchPreparing = true;
      lockBatchButtons(true);
      try {
        const ids = requestedIds ? [...requestedIds] : [...selectedAssets];
        if (!ids.length) throw new Error("请先选择图片");
        const { assets } = await request({ type: "ASSET_LIST" }),
          map = new Map(assets.map((a) => [a.id, a]));
        const items = ids.map((id) => {
          if (!map.has(id)) throw new Error("选中图片已不存在，请刷新图库");
          return { id, label: map.get(id).name };
        });
        if(ids.some(id=>map.get(id)?.download?.state==='unknown')){
          galleryStatus('下载结果待核对，未开始本次下载。请先核对已存在的下载与文件。');
          connections.open(rootNode.contains(document.activeElement)?document.activeElement:$('#cpq-storage-settings'));
          throw new Error('下载结果待核对，请在设置中核对未完成下载；未开始本次批量下载。');
        }
        batchKind = kind;
        const receiptButton=$('#cpq-batch-receipt');if(receiptButton)receiptButton.hidden=false;
        galleryStatus('下载已开始，可在操作回执中查看逐项结果。');
        activeBatch = root.CPQBatch.createBatch({
          items,
          onChange: renderBatch,
          execute: async (item, context) => {
            const r = await request({
              type: "ASSET_DOWNLOAD",
              assetId: item.id,
              folder: "ChatGPT 工作台/图库",
            });
            context.onCancel(() =>
              request({ type: "DOWNLOAD_CANCEL", downloadId: r.downloadId }),
            );
            for (let n = 0; n < 240; n++) {
              const s = await request({
                type: "DOWNLOAD_STATUS",
                downloadId: r.downloadId,
              });
              if (s.state === "complete") return;
              context.throwIfCancelled();
              if (s.state === "unknown") {
                const error = new Error(
                  "下载结果待核对，请刷新状态后处理，不要重复下载。",
                );
                error.name = "OutcomeUnknown";
                throw error;
              }
              if (s.state !== "in_progress")
                throw new Error("图片下载失败：" + s.state);
              await new Promise((r) => setTimeout(r, 500));
            }
            throw new Error("下载超时");
          },
        });
        batchPreparing = false;
        await activeBatch.start();
        await refreshGallery();
      } finally {
        batchPreparing = false;
        if (activeBatch) renderBatch(activeBatch.snapshot);
        else lockBatchButtons(false);
      }
    }
    action("#cpq-bulk-download", () => startBatch("download"));
    $("#cpq-gallery-clear").addEventListener('click',()=>galleryView.clearSelection());
    action("#cpq-batch-retry", async () => {
      if (!activeBatch) return;
      await activeBatch.retryFailed();
      await refreshGallery();
      renderBatch(activeBatch.snapshot);
    });
    action("#cpq-bulk-zip", async () => {
      $(".cpq-gallery-more").open = false;
      const assets = await chosen(),
        entries = [];
      const manifest = assets.map(({ dataUrl, ...a }) => a);
      for (const a of assets)
        entries.push({
          name:
            C.sanitizePart(a.sources[0]?.conversationId || "未关联会话") +
            "/" +
            a.id +
            "." +
            a.mime.split("/")[1].replace("jpeg", "jpg"),
          data: C.parseImageDataURL(a.dataUrl).bytes,
        });
      entries.push({
        name: "manifest.json",
        data: JSON.stringify(
          { format: "cpq-gallery", version: 1, assets: manifest },
          null,
          2,
        ),
      });
      await download(A.zip(entries), "chatgpt-images.zip", "application/zip");
      galleryStatus("图片和清单 ZIP 下载完成。");
    });
    async function refreshStorageSummary() {
      const label=$('#cpq-storage-summary');if(!label)return;
      try {
        const saved=await chrome.storage?.local?.get('libraryPreferences');
        const prefs=saved?.libraryPreferences || {mode:'browser',browserFolder:'ChatGPT 工作台/图库'};
        label.textContent=prefs.mode==='native'?'本机下载：本机图片目录':'浏览器下载：'+(prefs.browserFolder || 'ChatGPT 工作台/图库');
        label.title=label.textContent;
      }catch{label.textContent='保存方式暂不可用';}
      const copy=$('.cpq-sheet-storage-summary');if(copy)copy.textContent=label.textContent;
    }
    const storageEntry=$('#cpq-storage-settings');
    if(storageEntry)storageEntry.onclick=()=>connections.open(storageEntry);
    rootNode.addEventListener('cpq:connections-changed',refreshStorageSummary);
    const storageChanged=changes=>{if(changes.libraryPreferences)refreshStorageSummary();};
    chrome.storage?.onChanged?.addListener(storageChanged);
    const cleanup=new MutationObserver(()=>{if(!rootNode.isConnected){chrome.storage?.onChanged?.removeListener(storageChanged);connections.close();galleryView.closePreview();cleanup.disconnect();}});
    cleanup.observe(document.body,{childList:true});
    refreshStorageSummary();
    async function refreshConnectionInfo() {
      const info = await request({ type: "LIBRARY_INFO" });
      $("#cpq-connection-info").textContent = info.connected
        ? "本机记录已连接" + (info.pending ? " · 有待补录资料" : "")
        : "配置图片目录、SQLite 与下载通知";
    }
    async function refresh() {
      await refreshReferences();
      await refreshConversations();
      await refreshConnectionInfo();
    }
    return {
      selectedReferenceIds: () => [...selectedReferences],
      refresh,
      refreshGallery,
      setTaskContext:galleryView.setTaskContext,
      galleryInteractionBusy:galleryView.interactionBusy,
      archiveCurrent,
      openConnections: connections.open,
      closeConnections: connections.close,
      loadAsset: async (assetId) =>
        (await request({ type: "ASSET_GET", assetId })).asset,
      runBatch: startBatch,
      openAsset: galleryView.openAsset,
      previewAsset: galleryView.previewAsset,
      closePreview: galleryView.closePreview,
      detailOpen: galleryView.detailOpen,
      closeDetail: galleryView.closeDetail,
    };
  }
  root.CPQToolkit = {
    request,
    download,
    archiveCurrent,
    mount,
    createConnectionView,
  };
})(globalThis);
