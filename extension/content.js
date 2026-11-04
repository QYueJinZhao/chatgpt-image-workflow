/* Based on MIT ChatGPT Prompt Queue by aleixmedina9-gif. Visible-DOM queue engine. */
(() => {
  "use strict";
  if (window.__CPQ_V3__) return;
  window.__CPQ_V3__ = true;
  const C = CPQCore,
    P = CPQCapture,
    T = CPQToolkit,
    request = T.request;
  const extensionManifest = globalThis.chrome?.runtime?.getManifest?.() || {},
    extensionVersion = extensionManifest.version || "开发版",
    extensionName = extensionManifest.name || "ChatGPT 自动生图与下载助手";
  const ownedPanelSelector = 'aside#cpq-root:is([data-cpq-owner="image-workflow"],[aria-label="ChatGPT 自动化工作台"],[aria-label="创作图片库 · Open"])';
  const provider = P.provider(document),
    providerName = provider === "gemini" ? "Gemini" : "ChatGPT",
    belongsHere = (item) => C.taskProvider(item) === provider;
  const defaults = {
    waitSeconds: 3,
    maxAttempts: 3,
    retryDelaySeconds: 3,
    generationTimeoutSeconds: 240,
    downloadFolder: "ChatGPT 工作台",
    promptPrefix: "",
    promptSuffix: "",
    aspectRatio: "1:1",
    imageQuality: "standard",
    outputKind: "image",
    splitMode: "paragraphs",
    language: "zh",
  };
  let state = {
      items: [],
      settings: { ...defaults },
      running: false,
      paused: false,
      panelVisible: true,
    },
    revision = 0,
    epoch = 0,
    saveTail = Promise.resolve(),
    toolkit,
    workbench,
    panelRoot,
    heartbeat,
    queuePage = 1;
  const $ = (s) => panelRoot?.querySelector(s),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function phase(value) {
    if (panelRoot) panelRoot.dataset.initPhase = value;
  }
  function notify(text) {
    const status = $("#cpq-status");
    if (status) status.textContent = text;
  }
  function save() {
    const snapshot = structuredClone(state);
    const call = async () => {
      const r = await request({
        type: "QUEUE_SAVE",
        revision,
        state: snapshot,
      });
      revision = r.revision;
      if (toolkit) render();
    };
    const result = saveTail.then(call);
    saveTail = result.catch(() => {});
    return result;
  }
  function check(token) {
    if (token !== epoch || !state.running) throw new Error("队列已暂停");
  }
  async function delay(ms, token) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      check(token);
      await sleep(Math.min(200, until - Date.now()));
    }
  }
  function settings() {
    const v = { ...state.settings };
    for (const k of [
      "outputKind",
      "splitMode",
      "aspectRatio",
      "imageQuality",
      "downloadFolder",
      "promptPrefix",
      "promptSuffix",
    ])
      v[k] = $(
        "#cpq-" +
          {
            outputKind: "output-kind",
            splitMode: "split-mode",
            aspectRatio: "ratio",
            imageQuality: "quality",
            downloadFolder: "folder",
            promptPrefix: "prefix",
            promptSuffix: "suffix",
          }[k],
      ).value;
    v.generationTimeoutSeconds = Math.min(
      1800,
      Math.max(15, Number($("#cpq-timeout").value) || 240),
    );
    v.waitSeconds = Math.min(
      600,
      Math.max(0, Number($("#cpq-wait").value) || 0),
    );
    C.sanitizeFolder(v.downloadFolder);
    state.settings = v;
    return v;
  }
  const labels = {
    pending: "待运行",
    running: "执行中",
    done: "已完成",
    failed: "失败",
    needs_review: "待核对",
    skipped: "已跳过",
  };
  const stages = {
    pending: "等待开始",
    preparing: "准备中",
    submitting: "正在提交",
    submitted: "已提交",
    generating: "等待生成",
    downloading: "核对下载中",
    done: "处理完成",
  };
  function queueViewItems() {
    const filter = $("#cpq-queue-filter")?.value || "all";
    const items = filter === "attention" ? state.items.filter(CPQWorkbenchView.isAttention) : filter === "archive" ? state.items.filter(item => item.status === "done" && item.lastError?.startsWith("任务已完成；会话归档未完成")) : filter === "all" ? state.items : state.items.filter(item => item.status === filter);
    return CPQWorkbenchView.orderedItems(items);
  }
  function render() {
    const list = $("#cpq-jobs");
    const openPrompts = new Set(
      [...list.querySelectorAll(".cpq-prompt-disclosure[open]")].map(
        (el) => el.closest(".cpq-job").dataset.jobId,
      ),
    );
    const focused = list.contains(document.activeElement)
      ? {
          jobId: document.activeElement.closest(".cpq-job")?.dataset.jobId,
          key: document.activeElement.dataset.focusKey,
        }
      : null;
    list.replaceChildren();
    workbench?.prepareRender(state);
    list.closest("#cpq-root").dataset.running=String(!!state.running);
    const displayItems = queueViewItems();
    const currentIndex = displayItems.findIndex((x) => x.status === "running");
    const pageCount = Math.ceil(displayItems.length / 20) || 1;
    queuePage = Math.min(queuePage, pageCount);
    const start = (queuePage - 1) * 20,
      shown = displayItems.slice(start, start + 20);
    $("#cpq-queue-pagination").hidden = pageCount <= 1;
    const pageSelect = $("#cpq-queue-page");
    pageSelect.replaceChildren();
    for (let p = 1; p <= pageCount; p++) {
      const option = document.createElement("option");
      option.value = String(p);
      option.textContent = "第 " + p + " / " + pageCount + " 页";
      pageSelect.append(option);
    }
    pageSelect.value = String(queuePage);
    $("#cpq-queue-prev").disabled = queuePage <= 1;
    $("#cpq-queue-next").disabled = queuePage >= pageCount;
    $("#cpq-queue-range").hidden = pageCount <= 1 && displayItems.length === state.items.length;
    $("#cpq-queue-range").textContent =
      `当前显示 ${displayItems.length ? start + 1 : 0}–${Math.min(start + 20, displayItems.length)} / ${displayItems.length} 项` +
      (displayItems.length !== state.items.length ? ` · 队列共 ${state.items.length} 项` : "");
    $("#cpq-locate-task").hidden =
      !state.items.some(x => x.status === "running") || (currentIndex >= 0 && Math.floor(currentIndex / 20) + 1 === queuePage);
    for (const item of shown) {
      const number = state.items.indexOf(item) + 1;
      const row = document.createElement("article");
      row.className = "cpq-job cpq-task-card";
      row.dataset.jobStatus = item.status;
      row.dataset.jobStage = item.stage || "pending";
      row.dataset.jobId = item.id;
      row.setAttribute("aria-label", `任务 ${number}`);
      const top = document.createElement("div");
      top.className = "cpq-job-top";
      const index = document.createElement("span");
      index.className = "cpq-job-index";
      index.textContent = String(number).padStart(2, "0");
      const kind = document.createElement("span");
      kind.className = "cpq-kind";
      kind.textContent =
        (item.kind === "text" ? "文字" : "图片") +
        " · " +
        (C.taskProvider(item) === "gemini" ? "Gemini" : "ChatGPT");
      const badge = document.createElement("span");
      badge.className = "cpq-badge " + item.status;
      badge.textContent = labels[item.status] || item.status;
      const preview = document.createElement("p");
      preview.className = "cpq-prompt-preview";
      preview.textContent = item.prompt;
      const disclosure = document.createElement("details");
      disclosure.className = "cpq-prompt-disclosure";
      disclosure.open = openPrompts.has(String(item.id));
      const summary = document.createElement("summary");
      summary.dataset.focusKey = "prompt";
      summary.setAttribute(
        "aria-label",
        `任务 ${number}：${item.prompt.slice(0, 80)}，展开完整提示词`,
      );
      const expand = document.createElement("span");
      expand.className = "cpq-disclosure-expand cpq-sr-only";
      expand.textContent = "展开提示词";
      const collapse = document.createElement("span");
      collapse.className = "cpq-disclosure-collapse cpq-sr-only";
      collapse.textContent = "收起提示词";
      index.textContent="#"+index.textContent;
      const source=document.createElement('span');source.className='cpq-task-provider';source.textContent=C.taskProvider(item)==='gemini'?'Gemini':'ChatGPT';
      const date=document.createElement('time');date.className='cpq-task-date';
      const stamp=Number(item.finishedAt||item.submittedAt||item.createdAt),dateValue=new Date(stamp);date.textContent=Number.isFinite(stamp)&&stamp>0&&!Number.isNaN(dateValue.getTime())?dateValue.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):item.status==='pending'?'尚未开始':'时间未记录';
      top.append(index,source,date,preview);
      const outcome=document.createElement('div');outcome.className='cpq-task-outcome';outcome.append(badge);
      summary.append(top, expand, collapse);
      const fullPrompt = document.createElement("p");
      fullPrompt.className = "cpq-prompt-full";
      fullPrompt.textContent = item.prompt;
      disclosure.append(summary, fullPrompt);
      row.append(disclosure,outcome);
      const originals = workbench?.queuePreview(item);
      if (originals) row.append(originals);
      const meta = document.createElement("p");
      meta.className = "cpq-help cpq-task-meta";
      meta.textContent =
        (item.status === "running"
          ? stages[item.stage] || "执行中"
          : {
              done: "处理完成",
              failed: "失败，等待处理",
              needs_review: "已暂停，等待核对",
              skipped: "已跳过",
            }[item.status] || "等待开始") +
        (item.referenceIds?.length
          ? " · " + item.referenceIds.length + " 张参考图"
          : "");
      const brief=document.createElement('span');brief.className='cpq-task-brief';brief.textContent=meta.textContent;top.append(brief);
      meta.append(document.createTextNode(" · " + kind.textContent));
      if (item.lastError) {
        if (
          item.status === "done" &&
          item.lastError.startsWith("任务已完成；会话归档未完成")
        ) {
          row.dataset.archiveState='pending';
          const label = document.createElement("span");label.className='cpq-task-archive cpq-badge';
          label.textContent = "会话待归档";
          const action = document.createElement("button");
          action.textContent = "前往处理";
          action.dataset.action = "archive-tools";
          action.dataset.focusKey = "archive";
          action.onclick = () => {
            workbench.navigate("conversation");
          };
          outcome.prepend(label);outcome.append(action);
          const explanation = document.createElement("p");
          explanation.textContent = item.lastError;
          explanation.className='cpq-task-archive-note';disclosure.append(explanation);
        } else {
          const error = document.createElement("p");
          error.className = "cpq-error";
          error.textContent = item.lastError;
          disclosure.append(error);
        }
      }
      row.append(meta);
      if(item.kind==='text' && item.status==='done'){
        const inspectText=document.createElement('button');
        inspectText.type='button';inspectText.className='cpq-task-text-result';
        inspectText.textContent='查看当前会话';inspectText.dataset.focusKey='text-result';
        inspectText.onclick=()=>workbench.navigate('conversation');outcome.append(inspectText);
      }
      if (["failed", "needs_review"].includes(item.status)) {
        const actions = document.createElement("div");
        actions.className = "cpq-actions";
        const retry = document.createElement("button");
        const action = C.failureAction(item);
        retry.textContent =
          action === "download"
            ? "重试已有图片下载"
            : action === "review"
              ? "核对后重新生成"
              : "重试准备";
        retry.disabled = state.running;
        retry.dataset.focusKey = "retry";
        retry.onclick = async () => {
          if (
            action === "review" &&
            !confirm("此任务可能已经提交。确认已核对页面，并愿意重新生成一次？")
          )
            return;
          item.status = "pending";
          item.lastError = "";
          if (action !== "download") {
            item.stage = "pending";
            item.generatedAssetIds = [];
            item.downloadIds = {};
            item.downloadedAssetIds = [];
            delete item.submittedAt;
            delete item.finishedAt;
          }
          try {
            await save();
            render();
          } catch (e) {
            notify(e.message);
          }
        };
        const skip = document.createElement("button");
        skip.textContent = "跳过";
        skip.disabled = state.running;
        skip.dataset.focusKey = "skip";
        skip.onclick = async () => {
          item.status = "skipped";
          await save();
          render();
        };
        if (action === "review") {
          const inspect = document.createElement("button");
          inspect.textContent = "查看当前会话";
          inspect.dataset.action = "review-page";
          inspect.dataset.focusKey = "review-page";
          inspect.onclick = () => $("#cpq-close").click();
          actions.append(inspect);
          const hint = document.createElement("p");
          hint.className = "cpq-help";
          hint.textContent = "请先核对当前会话及站点历史；重新生成前仍需确认。";
          disclosure.append(hint);
        }
        actions.append(retry, skip);
        outcome.append(actions);
      }
      list.append(row);
    }
    if (focused?.key) {
      const row = [...list.children].find(
        (el) => el.dataset.jobId === focused.jobId,
      );
      const control =
        row &&
        [...row.querySelectorAll("[data-focus-key]")].find(
          (el) => el.dataset.focusKey === focused.key,
        );
      control?.focus({ preventScroll: true });
    }
    if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = "cpq-queue-empty";
      const heading = document.createElement("h2"),
        help = document.createElement("p"),
        action = document.createElement("button");
      const attentionEmpty=$('#cpq-queue-filter').value==='attention'&&state.items.length;
      heading.textContent = attentionEmpty ? '暂时没有待处理任务' : state.items.length ? "没有符合状态的任务" : "还没有任务";
      help.className = "cpq-help";
      help.textContent = attentionEmpty ? '完成的图片在下方图库中，历史任务可在记录中查看。' : state.items.length ? "可切换为全部状态查看任务记录。" :
        "点击新建任务，添加提示词后手动开始队列。";
      action.textContent = state.items.length ? "查看全部记录" : "新建任务";
      if (state.items.length) action.onclick = () => { $("#cpq-queue-filter").value = "all"; queuePage = 1; render(); $("#cpq-queue-filter").focus(); };
      else action.onclick=()=>$('#cpq-compose-expand').click();
      empty.append(heading, help, action);
      list.append(empty);
    }
    const counts = state.items.reduce((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result; }, {});
    const completed = counts.done || 0;
    $("#cpq-queue-overview").textContent = [
      `需处理 ${(counts.failed || 0) + (counts.needs_review || 0)}`,
      ...(counts.running ? [`执行中 ${counts.running}`] : []),
      `待执行 ${counts.pending || 0}`, `已完成 ${completed}`,
    ].join(" · ");
    const countValue = document.createElement("span"),
      countLabel = document.createElement("span");
    countValue.className = "cpq-count-value";
    countValue.textContent = `${completed} / ${state.items.length}`;
    countLabel.className = "cpq-count-label";
    countLabel.textContent = "已完成";
    $("#cpq-count").replaceChildren(
      countValue,
      document.createTextNode(" "),
      countLabel,
    );
    const active = state.items.find((item) => item.status === "running"),
      pending = state.items.filter((item) => item.status === "pending").length,
      reviews = state.items.filter(
        (item) => item.status === "needs_review",
      ).length;
    $("#cpq-queue-stage").textContent = active
      ? stages[active.stage] || "执行中"
      : reviews
        ? reviews + " 项待核对"
        : pending
          ? "待执行 " + pending + " 项"
          : state.items.length
            ? "本轮已结束"
            : "队列为空";
    $("#cpq-progress").max = state.items.length || 1;
    $("#cpq-progress").value = completed;
    const ready = panelRoot.dataset.initState === "ready";
    $("#cpq-start").disabled =
      !ready ||
      state.running ||
      !state.items.some((x) => x.status === "pending" && belongsHere(x));
    $("#cpq-pause").disabled = !state.running;
    $("#cpq-stop").disabled = !state.running;
    $("#cpq-start").hidden = state.running;
    $("#cpq-pause").hidden = !state.running;
    $("#cpq-stop").hidden = !state.running;
    for (const id of ["#cpq-add", "#cpq-import", "#cpq-clear"])
      $(id).disabled = !ready || state.running;
    if (ready) workbench?.render(state);
  }
  async function add(text, format) {
    settings();
    const jobs = C.parsePrompts(text, {
      format,
      kind: state.settings.outputKind,
      splitMode: state.settings.splitMode,
      referenceIds: toolkit.selectedReferenceIds(),
      provider,
    });
    if (!jobs.length) throw new Error("没有可加入的提示词");
    if (state.items.length + jobs.length > C.MAX_JOBS)
      throw new Error("队列最多 2000 项");
    state.items.push(
      ...jobs.map((x) => ({
        ...x,
        id: crypto.randomUUID(),
        status: "pending",
        stage: "pending",
        attempts: 0,
        createdAt: Date.now(),
      })),
    );
    await save();
    render();
    notify("已加入 " + jobs.length + " 项，尚未开始。");
  }
  async function waitResponse(before, item, token) {
    let signature = "",
      stableAt = 0;
    const until = Date.now() + state.settings.generationTimeoutSeconds * 1000;
    while (Date.now() < until) {
      check(token);
      const result = P.responseSince(document, before),
        has = item.kind === "text" ? !!result.text : result.images.length > 0;
      if (item.kind !== "text" && result.failedImages?.length)
        throw new Error(
          "响应中有图片加载失败，已阻止将部分图片标为完成。请核对页面。",
        );
      const sig =
        result.text +
        "|" +
        result.images.map((i) => i.currentSrc || i.src).join("|");
      if (
        has &&
        !result.busy &&
        (item.kind === "text" || !result.pendingImages?.length)
      ) {
        if (sig !== signature) {
          signature = sig;
          stableAt = Date.now();
        } else if (Date.now() - stableAt >= 1600) return result;
      } else stableAt = Date.now();
      await delay(250, token);
    }
    throw new Error("生成等待超时。任务可能已提交，请核对页面后处理。");
  }
  async function downloadAssets(item, token) {
    item.downloadedAssetIds ||= [];
    item.downloadIds ||= {};
    for (const id of item.generatedAssetIds) {
      check(token);
      if (item.downloadedAssetIds.includes(id)) continue;
      let did = item.downloadIds[id];
      if (did) {
        const receipt = await request({
          type: "DOWNLOAD_STATUS",
          downloadId: did,
        });
        if (receipt.state === "complete") {
          item.downloadedAssetIds.push(id);
          await save();
          continue;
        }
        if (receipt.state === "in_progress") {
          /* reconcile below */
        } else did = null;
      }
      if (!did) {
        const started = await request({
          type: "ASSET_DOWNLOAD",
          assetId: id,
          folder: state.settings.downloadFolder,
          name: item.prompt.slice(0, 55),
        });
        did = started.downloadId;
        item.downloadIds[id] = did;
        await save();
      }
      const until = Date.now() + 120000;
      let complete = false;
      while (Date.now() < until) {
        check(token);
        const r = await request({ type: "DOWNLOAD_STATUS", downloadId: did });
        if (r.state === "complete") {
          complete = true;
          break;
        }
        if (r.state !== "in_progress")
          throw new Error("图片已保存到图库，下载失败：" + r.state);
        await delay(300, token);
      }
      if (!complete) throw new Error("下载等待超时，图片已保存在图库");
      item.downloadedAssetIds.push(id);
      await save();
    }
  }
  async function process(item, token) {
    item.status = "running";
    item.lastError = "";
    item.attempts = (item.attempts || 0) + 1;
    state.currentId = item.id;
    render();
    try {
      if (
        item.generatedAssetIds?.length &&
        C.failureAction(item) !== "download"
      )
        throw new Error(
          "图片归档未完整确认，已保存的原图仍在图库；请核对后重试或跳过。",
        );
      if (!item.generatedAssetIds?.length) {
        item.stage = "preparing";
        await save();
        check(token);
        const box = P.composer(document);
        if (!box)
          throw new Error(
            "找不到 " + providerName + " 输入框，请确认已登录并打开会话",
          );
        const draft = box.value ?? box.textContent;
        if (draft.trim())
          throw new Error("输入框已有草稿，请先核对并清空后运行");
        const assets = [];
        for (const id of item.referenceIds || []) {
          const a = (await request({ type: "ASSET_GET", assetId: id })).asset;
          if (!a) throw new Error("参考图不存在");
          assets.push(a);
        }
        await P.attachReferences(document, assets, () => check(token));
        check(token);
        const before = P.snapshot(document);
        P.setComposer(
          box,
          C.buildPrompt(item.prompt, state.settings, item.kind),
        );
        let button;
        for (let n = 0; n < 30; n++) {
          check(token);
          button = P.sendButton(document);
          if (button) break;
          await delay(100, token);
        }
        if (!button) throw new Error("发送按钮不可用，任务尚未提交");
        item.stage = "submitting";
        item.submittedAt = Date.now();
        await save();
        check(token);
        button.click();
        item.stage = "generating";
        await save();
        notify(
          "正在等待 " + (item.kind === "text" ? "文字响应" : "生成图片") + "…",
        );
        const response = await waitResponse(before, item, token);
        if (item.kind !== "text") {
          const capturedAssetIds = [];
          for (const img of response.images) {
            check(token);
            const { asset } = await request({
              type: "ASSET_PUT",
              asset: {
                dataUrl: await P.imageData(img),
                name: item.prompt.slice(0, 60),
                role: "generated",
                prompt: item.prompt,
                taskId: item.id,
                conversationId: location.pathname.split("/").pop(),
              },
            });
            capturedAssetIds.push(asset.id);
          }
          check(token);
          // Publish the full result with the downloading stage in the next save.
          // Earlier individual writes remain in the gallery if capture fails.
          item.generatedAssetIds = [...new Set(capturedAssetIds)];
        }
      }
      if (item.kind !== "text") {
        item.stage = "downloading";
        await save();
        notify("图片已归档，正在核对下载…");
        await downloadAssets(item, token);
      }
      check(token);
      item.status = "done";
      item.stage = "done";
      item.finishedAt = Date.now();
      await save();
      try {
        await toolkit.archiveCurrent();
      } catch {
        item.lastError = "任务已完成；会话归档未完成，可在工具页重试归档。";
        await save();
      }
    } catch (e) {
      if (token !== epoch) return;
      item.status =
        C.failureAction(item) === "review" ? "needs_review" : "failed";
      item.lastError = e.message;
      await save();
    }
    render();
  }
  async function start() {
    if (state.running) return;
    settings();
    await save();
    await request({ type: "LEASE_ACQUIRE" });
    const token = ++epoch;
    state.running = true;
    state.paused = false;
    heartbeat = setInterval(
      () => request({ type: "LEASE_HEARTBEAT" }).catch((e) => halt(e.message)),
      15000,
    );
    render();
    try {
      await save();
      for (const item of state.items) {
        check(token);
        if (item.status !== "pending" || !belongsHere(item)) continue;
        await process(item, token);
        check(token);
        if (item.status === "needs_review") {
          notify("任务需要核对，队列已暂停。");
          break;
        }
        await delay(state.settings.waitSeconds * 1000, token);
      }
    } catch (e) {
      if (token === epoch) notify(e.message);
    } finally {
      if (token === epoch) {
        state.running = false;
        state.currentId = null;
        clearInterval(heartbeat);
        await save().catch((e) => notify(e.message));
        await request({ type: "LEASE_RELEASE" }).catch(() => {});
        render();
        notify(
          state.items.some((x) => x.status === "needs_review")
            ? "存在待核对任务，请核对后重试或跳过。"
            : "本轮队列已结束。",
        );
      }
    }
  }
  async function halt(text = "队列已暂停。已提交任务需要核对，不会自动重发。") {
    ++epoch;
    clearInterval(heartbeat);
    state.running = false;
    state.paused = true;
    state.items = state.items.map(C.recoverItem);
    state.currentId = null;
    await save().catch((e) => notify(e.message));
    await request({ type: "LEASE_RELEASE" }).catch(() => {});
    render();
    notify(text);
  }
  async function mount() {
    const stale = [
      ...document.querySelectorAll(
        ownedPanelSelector,
      ),
    ];
    const priorDraft =
      stale
        .slice()
        .reverse()
        .map((old) => old.querySelector("#cpq-manual")?.value || "")
        .find((value) => value.trim()) || "";
    // The host DOM outlives an extension context. Never let a new controller
    // bind the first old root while the user sees the newly appended root.
    for (const old of stale) old.remove();
    const root = document.createElement("aside");
    panelRoot = root;
    root.id = "cpq-root";
    root.dataset.captureSchema = P.domSchema;
    root.setAttribute("aria-label", extensionName);
    root.dataset.cpqOwner = "image-workflow";
    root.dataset.uiBuild = "publish-ready-20261104-v393";
    root.hidden = true;
    root.dataset.extensionVersion = extensionVersion;
    root.dataset.initState = "loading";
    root.dataset.instanceId = crypto.randomUUID();
    root.dataset.replacedPanels = String(stale.length);
    root.innerHTML = `
      <header class="cpq-header">
        <button id="cpq-home" class="cpq-brand" aria-label="资料与帮助"><span class="cpq-menu-mark" aria-hidden="true"></span></button>
        <strong id="cpq-workspace-title">工作台与图库</strong>
        <button id="cpq-close" aria-label="收起工作台">收起</button>
      </header>
      <nav class="cpq-context-bar" data-connection-hide hidden aria-label="上下文导航"><button id="cpq-back">返回创作</button><strong id="cpq-view-title"></strong><button id="cpq-context-close" aria-label="收起工作台">收起</button></nav>
      <div class="cpq-scroll">
        <div data-pane="workspace"></div>
        <div class="cpq-task-initial" hidden>
          <section class="cpq-queue-summary" aria-label="队列进度与控制">
            <div class="cpq-progress-row"><strong id="cpq-count"></strong><progress id="cpq-progress" max="1" value="0" aria-label="任务完成进度"></progress></div>
            <p id="cpq-queue-overview" class="cpq-help"></p>
            <div class="cpq-queue-controls"><p id="cpq-queue-stage" class="cpq-help">正在读取队列</p>
            <div class="cpq-actions"><button id="cpq-start" class="cpq-primary" disabled>开始队列</button><button id="cpq-pause" disabled>暂停</button><button id="cpq-stop" disabled>停止</button></div>
            </div>
          </section>
          <section class="cpq-queue" aria-label="任务列表">
            <div class="cpq-queue-filter-row"><label for="cpq-queue-filter">状态筛选</label><select id="cpq-queue-filter"><option value="all">全部状态</option><option value="pending">待执行</option><option value="running">执行中</option><option value="needs_review">待核对</option><option value="failed">失败</option><option value="done">已完成</option><option value="skipped">已跳过</option></select></div>
            <div class="cpq-queue-heading"><button class="cpq-queue-tools-entry" data-open="queue-tools"><span><strong>队列工具</strong><small>导出检查点 · 从文件导入 · 清空队列</small></span><span aria-hidden="true">›</span></button></div>
            <button id="cpq-locate-task" hidden>定位执行项</button>
            <nav id="cpq-queue-pagination" class="cpq-pagination" aria-label="任务分页" hidden><button id="cpq-queue-prev">上一页</button><label><span class="cpq-sr-only">任务页码</span><select id="cpq-queue-page"></select></label><button id="cpq-queue-next">下一页</button></nav>
            <p id="cpq-queue-range" class="cpq-help" hidden></p>
            <div id="cpq-jobs"></div>
          </section>
        </div>
        <div data-pane="preferences" hidden><section class="cpq-section cpq-preferences"><h2>生成参数</h2>
            <div class="cpq-inline">
              <label>任务类型<select id="cpq-output-kind"><option value="image">生成图片</option><option value="text">文字响应</option></select></label>
              <label>文本分隔<select id="cpq-split-mode"><option value="paragraphs">空行分隔</option><option value="lines">逐行分隔</option></select></label>
            </div>
            <p class="cpq-help">画幅和质量作为提示词要求发送，实际结果由 ChatGPT 决定。</p>
            <div class="cpq-inline">
              <label>画幅<select id="cpq-ratio"><option>1:1</option><option>16:9</option><option>9:16</option><option>4:3</option><option>3:4</option></select></label>
              <label>质量偏好<select id="cpq-quality"><option value="standard">默认</option><option value="high">清晰细节</option><option value="fast">快速简洁</option></select></label>
            </div>
            <label>前缀<textarea id="cpq-prefix" rows="2"></textarea></label>
            <label>后缀<textarea id="cpq-suffix" rows="2"></textarea></label>
            <input id="cpq-folder" type="hidden" value="ChatGPT 工作台"><p class="cpq-help">图片保存位置在“设置”中配置。</p>
            <div class="cpq-inline">
              <label>生成超时（秒）<input id="cpq-timeout" type="number" min="15" max="1800" value="240"></label>
              <label>任务间隔（秒）<input id="cpq-wait" type="number" min="0" max="600" value="3"></label>
            </div>
          </section></div>
        <div data-pane="queue-tools" hidden><section class="cpq-section"><h2>队列工具</h2><p class="cpq-help">检查点导出保留恢复状态；导入只追加，不自动运行。</p><button id="cpq-checkpoint">导出检查点</button><button data-open="import">从文件导入</button><p class="cpq-help">清空只移除队列，保留原图与会话归档。</p><button id="cpq-clear" class="cpq-quiet-danger">清空队列</button></section></div>
        <div data-pane="import" hidden><section class="cpq-section"><h2>导入任务</h2><p class="cpq-help">TXT / JSON / CSV 最多 1 MiB；队列检查点最多 64 MiB。检查点将验证引用并保留待核对状态，不自动开始。</p><label class="cpq-import-control">选择任务文件<input id="cpq-import" type="file" accept=".txt,.json,.csv"></label></section></div>
        <div data-pane="gallery" hidden></div><div data-pane="tools" hidden></div>
        <div data-pane="references" hidden></div><div data-pane="conversation" hidden></div><div data-pane="archives" hidden></div><div data-pane="backup" hidden></div><div data-pane="privacy" hidden></div><div data-pane="batch" hidden><h2>图片操作回执</h2><p class="cpq-help">下载与通知分别显示结果，待核对的操作不会自动重试。</p></div>
      </div>
      <div class="cpq-feedback" data-connection-hide><p id="cpq-status" role="status" aria-live="polite"></p><button id="cpq-batch-receipt" data-open="batch" hidden>查看操作回执</button></div>
      <section class="cpq-composer" data-connection-hide aria-label="新建任务">
        <div id="cpq-compose-collapsed" hidden><span>监看模式</span><button id="cpq-compose-expand" class="cpq-primary">新建任务</button></div>
        <div id="cpq-composer-body"><div class="cpq-compose-heading"><h2>新建任务</h2><button id="cpq-compose-fold" aria-label="折叠编辑区，进入监看模式">收起输入</button></div>
          <label for="cpq-manual">提示词</label><textarea id="cpq-manual" rows="5" aria-describedby="cpq-compose-help" placeholder="描述你想创作的内容，多项用空行分隔"></textarea>
          <div class="cpq-compose-options"><button id="cpq-reference-entry" data-open="references">参考图 0 张</button><button id="cpq-preference-entry" data-open="preferences">图片 · 1:1</button></div>
          <div class="cpq-compose-actions"><button data-open="import">导入</button><button id="cpq-add" class="cpq-primary">加入队列</button></div>
          <p id="cpq-compose-help" class="cpq-help">加入后不会自动开始；确认后点击“开始”。</p>
        </div>
      </section>
      <footer class="cpq-storage-bar"><button id="cpq-storage-settings" aria-haspopup="dialog" aria-expanded="false"><span class="cpq-folder-mark" aria-hidden="true"></span><span id="cpq-storage-summary">正在读取保存方式…</span><span id="cpq-runtime-version" class="cpq-version-badge">v${extensionVersion}</span><strong>设置</strong></button></footer>`;
    document.body.append(root);
    globalThis.CPQControls?.mount(root);
    // Keep live controls and handlers; the workspace owns one todo list and gallery.
    const workspacePane=$('[data-pane="workspace"]');
    const queueConsole=document.createElement('section');queueConsole.className='cpq-queue-console';queueConsole.setAttribute('aria-label','队列与待办');
    const consoleHeader=document.createElement('div');consoleHeader.className='cpq-queue-console-header';
    consoleHeader.innerHTML='<button id="cpq-queue-toggle" type="button" data-variant="quiet" aria-expanded="false" aria-controls="cpq-queue-body"><strong>任务队列</strong><span class="cpq-queue-pending-count cpq-badge"><span id="cpq-task-count"></span> 项待处理</span><span id="cpq-queue-archive-count" class="cpq-task-archive cpq-badge"></span><span id="cpq-queue-title-status"></span><span class="cpq-fold-mark" aria-hidden="true"></span></button>';
    consoleHeader.append($('.cpq-queue-controls > .cpq-actions'));
    const queueBody=document.createElement('div');queueBody.id='cpq-queue-body';queueBody.append($('.cpq-queue'));
    queueConsole.append(consoleHeader,$('.cpq-queue-summary'),queueBody);
    workspacePane.replaceChildren($('.cpq-composer'),queueConsole);
    $('.cpq-task-initial')?.remove();
    $('.cpq-header').insertBefore($('#cpq-compose-expand'),$('#cpq-close'));
    const chips=document.createElement('div');chips.id='cpq-task-filters';chips.setAttribute('aria-label','任务快捷筛选');
    chips.innerHTML='<button data-task-filter="attention" aria-pressed="true">待处理 <span></span></button><button data-task-filter="all" aria-pressed="false">全部记录 <span></span></button><button data-task-filter="archive" aria-pressed="false">待归档 <span></span></button><button data-task-filter="pending" aria-pressed="false">待执行 <span></span></button>';
    const attentionOption=document.createElement('option');attentionOption.value='attention';attentionOption.textContent='待处理';$('#cpq-queue-filter').prepend(attentionOption);$('#cpq-queue-filter').value='attention';
    $('#cpq-queue-filter option[value="all"]').textContent='全部记录';
    const archiveOption=document.createElement('option');archiveOption.value='archive';archiveOption.textContent='会话待归档';$('#cpq-queue-filter').append(archiveOption);
    const moreFilters=document.createElement('details');moreFilters.id='cpq-queue-records';moreFilters.className='cpq-task-filter-more';moreFilters.innerHTML='<summary>任务记录与筛选</summary>';moreFilters.append(chips,$('.cpq-queue-filter-row'),$('.cpq-queue-heading'));
    $('.cpq-queue').append(moreFilters);
    moreFilters.addEventListener('keydown',event=>{if(event.key==='Escape'){moreFilters.open=false;moreFilters.querySelector('summary').focus();}});
    for(const button of chips.querySelectorAll('button'))button.onclick=()=>{$('#cpq-queue-filter').value=button.dataset.taskFilter;queuePage=1;render();};
    let panelLayout;
    const close = () => panelLayout?.setVisible(false);
    $("#cpq-close").onclick = close;
    $("#cpq-context-close").onclick = close;
    phase("tools");
    toolkit = T.mount(root, () => C.createCheckpoint(state));
    phase("navigation");
    workbench = CPQWorkbenchView.mount(root, toolkit, {
      canRunItem: belongsHere,
      revealJob: (id) => {
        $("#cpq-queue-filter").value = "all";
        const index = queueViewItems().findIndex((item) => item.id === id);
        if (index < 0) return;
        $("#cpq-queue-filter").value = "all";
        changeQueuePage(Math.floor(index / 20) + 1);
        const row = [...$("#cpq-jobs").children].find(
          (el) => el.dataset.jobId === id,
        );
        if (row) {
          revealQueueElement(row);
          row.querySelector("summary")?.focus({ preventScroll: true });
        }
      },
    });
    function changeQueuePage(value) {
      queuePage = Math.max(
        1,
        Math.min(Math.ceil(queueViewItems().length / 20) || 1, Number(value) || 1),
      );
      render();
      revealQueueElement($("#cpq-jobs"));
    }
    function revealQueueElement(element) {
      const container = $(".cpq-scroll");
      container.scrollTop +=
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        8;
    }
    $("#cpq-queue-prev").onclick = () => changeQueuePage(queuePage - 1);
    $("#cpq-queue-next").onclick = () => changeQueuePage(queuePage + 1);
    $("#cpq-queue-page").onchange = (e) => changeQueuePage(e.target.value);
    $("#cpq-queue-filter").onchange = () => { queuePage = 1; render(); };
    $("#cpq-locate-task").onclick = () => {
      $("#cpq-queue-filter").value = "all";
      const index = queueViewItems().findIndex((x) => x.status === "running");
      if (index >= 0) {
        changeQueuePage(Math.floor(index / 20) + 1);
        const row = $('[data-job-status="running"]');
        if (row) {
          revealQueueElement(row);
          row
            .querySelector(".cpq-prompt-disclosure summary")
            ?.focus({ preventScroll: true });
        }
      }
    };
    $("#cpq-add").onclick = async () => {
      try {
        await add($("#cpq-manual").value, "txt");
        $("#cpq-manual").value = "";
        workbench.updateComposer();
        root.dispatchEvent(new CustomEvent('cpq:task-added'));
      } catch (e) {
        notify(e.message);
      }
    };
    $("#cpq-import").onchange = async (e) => {
      try {
        const f = e.target.files[0];
        if (!f) return;
        const extension = f.name.split(".").pop().toLowerCase();
        if (
          f.size >
          (extension === "json" ? C.MAX_CHECKPOINT_BYTES : C.MAX_IMPORT_CHARS)
        )
          throw new Error("导入文件超过格式大小限制");
        const text = await f.text(),
          format = f.name.split(".").pop().toLowerCase();
        if (format === "json") {
          const obj = JSON.parse(text);
          if (obj.format === "cpq-queue" && obj.version === 1) {
            if (!confirm("追加检查点中的未完成任务？已提交任务将保持待核对。"))
              return;
            const restored = C.restoreCheckpoint(text).items;
            await C.validateAssetReferences(
              restored,
              async (assetId) =>
                (await request({ type: "ASSET_GET", assetId })).asset,
            );
            if (state.items.length + restored.length > C.MAX_JOBS)
              throw new Error("队列最多 2000 项");
            state.items.push(...restored);
            await save();
            render();
            notify("检查点已追加，未启动。");
            return;
          }
        }
        await add(text, format);
      } catch (err) {
        notify(err.message);
      } finally {
        e.target.value = "";
      }
    };
    $("#cpq-start").onclick = () => start().catch((e) => notify(e.message));
    $("#cpq-pause").onclick = () => halt();
    $("#cpq-stop").onclick = () =>
      halt("队列已停止。已保存图片可重试下载；提交结果不明的任务需先核对。");
    $("#cpq-clear").onclick = async () => {
      if (confirm("清空任务列表？图库和会话归档会保留。")) {
        state.items = [];
        await save();
        render();
      }
    };
    $("#cpq-checkpoint").onclick = async () => {
      try {
        settings();
        const data = C.createCheckpoint(state);
        await T.download(
          new TextEncoder().encode(JSON.stringify(data, null, 2)),
          "queue-checkpoint.json",
          "application/json",
        );
        notify("检查点下载完成。");
      } catch (e) {
        notify(e.message);
      }
    };
    for (const [key, id] of Object.entries({
      outputKind: "output-kind",
      splitMode: "split-mode",
      aspectRatio: "ratio",
      imageQuality: "quality",
      downloadFolder: "folder",
      promptPrefix: "prefix",
      promptSuffix: "suffix",
      generationTimeoutSeconds: "timeout",
      waitSeconds: "wait",
    }))
      $("#cpq-" + id).value = state.settings[key] ?? defaults[key];
    $("#cpq-manual").value = priorDraft;
    phase("initial-render");
    render();
    phase("mcp");
    panelLayout = await CPQWorkbenchView.mountPanel(root, {
      onVisibilityChange: (visible) => {
        if (visible) workbench?.resume?.();
        else { toolkit?.closeConnections?.(); toolkit?.closePreview?.(); }
      },
      onError: notify,
    });
    const mcp = CPQMCPContent.createContentHandler({
      provider,
      getState: () => state,
      reload: async () => {
        if (state.running) return;
        const q = await request({ type: "QUEUE_GET" });
        if (q.state?.running && q.lease?.expiresAt > Date.now())
          throw new Error("QUEUE_BUSY");
        revision = q.revision;
        state = {
          ...state,
          ...q.state,
          settings: { ...defaults, ...q.state.settings },
          items: (q.state.items || []).map(C.recoverItem),
          running: false,
        };
      },
      save,
      acquire: () => request({ type: "LEASE_ACQUIRE" }),
      release: () => request({ type: "LEASE_RELEASE" }),
      hasDraft: () => {
        const box = P.composer(document);
        if (!box) throw new Error("COMPOSER_UNAVAILABLE");
        return !!(box.value ?? box.textContent).trim();
      },
      validateReferences: (ids) =>
        C.validateAssetReferences(
          [{ referenceIds: ids }],
          async (assetId) =>
            (await request({ type: "ASSET_GET", assetId })).asset,
        ),
      render,
      start,
      onStartError: (e) => halt("MCP 启动失败：" + e.message),
    });
    root.dataset.mcpSchema = "mcp-20261021-v1";
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      // A replaced shell must never keep responding as a second controller.
      if (!root.isConnected) return false;
      if (message?.type === "WORKBENCH_DIAGNOSTICS") {
        if (sender?.id !== chrome.runtime.id) {
          reply({ ok: false, error: "SENDER_REJECTED" });
          return false;
        }
        reply({
          ok: true,
          build: root.dataset.uiBuild,
          instanceId: root.dataset.instanceId,
          initState: root.dataset.initState,
          phase: root.dataset.initPhase,
          replacedPanels: Number(root.dataset.replacedPanels),
          rootCount: document.querySelectorAll(
            ownedPanelSelector,
          ).length,
          renderedJobs: $("#cpq-jobs").querySelectorAll(".cpq-job").length,
          queueSize: state.items.length,
          visible: !root.hidden,
        });
        return false;
      }
      if (message?.type === "MCP_GENERATE") {
        if (sender?.id !== chrome.runtime.id) {
          reply({ ok: false, error: "MCP_SENDER_REJECTED" });
          return false;
        }
        mcp.generate(message.input).then(
          (result) => reply({ ok: true, result }),
          (e) => reply({ ok: false, error: e.message }),
        );
        return true;
      }
      if (message.type === "TOGGLE_PANEL") {
        panelLayout.toggle();
      }
      if (message.type === "SHOW_PANEL") panelLayout.setVisible(true);
    });
  }
  async function init() {
    try {
      const q = await request({ type: "QUEUE_GET" });
      revision = q.revision;
      if (q.state?.items) {
        state = {
          ...state,
          ...q.state,
          settings: { ...defaults, ...q.state.settings },
          items: q.state.items.map(C.recoverItem),
          running: false,
        };
      }
      await mount();
      panelRoot.dataset.initState = "ready";
      phase("ready");
      render();
      console.info("[CPQ UI]", {
        event: "ready",
        build: panelRoot.dataset.uiBuild,
        roots: 1,
        replacedPanels: Number(panelRoot.dataset.replacedPanels),
        tasks: state.items.length,
      });
      if (state.items.some((x) => x.status === "needs_review"))
        notify("检测到中断任务，已标为待核对，不会自动重发。");
    } catch (e) {
      if (panelRoot) {
        panelRoot.dataset.initState = "failed";
        for (const id of [
          "#cpq-start",
          "#cpq-pause",
          "#cpq-stop",
          "#cpq-add",
          "#cpq-import",
          "#cpq-clear",
          "#cpq-checkpoint",
        ])
          if ($(id)) $(id).disabled = true;
        notify(
          "工作台初始化未完成（阶段：" +
            panelRoot.dataset.initPhase +
            "）。队列数据未被清空，运行已禁用。请刷新页面后重试。",
        );
      }
      console.error("[CPQ UI]", {
        event: "initialization-failed",
        phase: panelRoot?.dataset.initPhase || "queue-read",
        errorType: e.name,
      });
      window.__CPQ_V3__ = false;
    }
  }
  init();
})();
