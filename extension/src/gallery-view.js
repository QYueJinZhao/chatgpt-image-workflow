/* MIT. Local gallery presentation only; persistence and downloads remain in toolkit. */
(function (root) {
  "use strict";
  const modes = ["small", "medium", "large", "list"];
  const viewChoices = [
    ["small","小图","小图标视图","快速扫描名称与小缩略图"],
    ["medium","中图","中图标视图","预览与简述，两列比较"],
    ["large","大图","大图标视图","大幅画面与完整一些的描述"],
    ["list","列表","列表视图","按名称查找，按需展开文件信息"],
  ];
  const providerNames={chatgpt:"ChatGPT",gemini:"Gemini",unknown:"未知来源"};
  function downloadState(a) {
    const state = a.download?.state;
    if (state === "complete" || state === "unknown") return state;
    if (["interrupted", "failed"].includes(state)) return "interrupted";
    if (["in_progress", "queued", "pending"].includes(state)) return "in_progress";
    return "pending";
  }
  const downloadLabel = a => ({complete:"已下载",unknown:"下载待核对",interrupted:"下载失败",in_progress:"下载中",pending:"尚未下载"})[downloadState(a)];
  function queryAssets(assets, q = {}) {
    const start = q.from ? new Date(q.from + "T00:00:00").getTime() : -Infinity;
    const end = q.to ? new Date(q.to + "T23:59:59.999").getTime() : Infinity;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end)
      throw new Error("日期范围无效，请检查开始与结束日期。");
    const search = String(q.search || "")
      .trim()
      .toLocaleLowerCase();
    return assets
      .filter((a) => {
        const providers = (a.sources || [])
          .map((s) => s.provider)
          .filter(Boolean);
        return (
          (!search ||
            [
              a.name,
              a.caption,
              ...(a.tags || []),
              ...(a.sources || []).map((s) => s.prompt),
            ]
              .join("\n")
              .toLocaleLowerCase()
              .includes(search)) &&
          (!q.provider ||
            (q.provider === "unknown"
              ? !providers.length
              : providers.includes(q.provider))) &&
          (!q.mime || a.mime === q.mime) &&
          (!q.role || a.roles?.includes(q.role)) &&
          (!q.download || downloadState(a) === q.download) &&
          ((!q.from && !q.to) ||
            (Number(a.createdAt) >= start && Number(a.createdAt) <= end))
        );
      })
      .sort(
        (a, b) =>
          (q.sort === "oldest" ? 1 : -1) *
          ((Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)),
      );
  }
  function mount(rootNode, selected, actions) {
    const pane = rootNode.querySelector('[data-pane="gallery"]');
    pane.innerHTML = `<section class="cpq-gallery-section">
      <div id="cpq-gallery-heading" class="cpq-library-heading"><div><h2>全部图片</h2><p id="cpq-gallery-count" class="cpq-help">0 张图片</p></div><div class="cpq-library-actions"><button id="cpq-gallery-refresh">刷新</button></div></div>
      <p id="cpq-gallery-status" role="status" aria-live="polite"></p>
      <section id="cpq-batch-panel" class="cpq-batch-panel" hidden><div class="cpq-actions"><button id="cpq-batch-cancel" hidden>取消后续项</button><button id="cpq-batch-retry" hidden>重试失败项</button></div><details id="cpq-batch-details"><summary>逐项结果</summary><ol id="cpq-batch-results" aria-label="批量操作逐项结果"></ol></details></section>
      <div id="cpq-gallery-gridview"><div class="cpq-gallery-controls">
      <label class="cpq-gallery-search"><span class="cpq-sr-only">搜索图片</span><input id="cpq-gallery-search" type="search" placeholder="名称、描述、提示词或标签" maxlength="500"></label>
      <fieldset id="cpq-gallery-view" role="radiogroup" aria-label="查看方式" aria-describedby="cpq-gallery-mode-note"><legend class="cpq-sr-only">查看方式</legend>${viewChoices.map(([value,label,name])=>`<label class="cpq-view-choice" for="cpq-view-${value}"><input type="radio" id="cpq-view-${value}" name="galleryView" value="${value}" aria-label="${name}" ${value==="medium"?"checked":""}><span>${label}</span></label>`).join("")}</fieldset>
      <p id="cpq-gallery-mode-note" class="cpq-help cpq-sr-only"></p>
      <div class="cpq-gallery-control-row"><label class="cpq-date-sort">日期<select id="cpq-gallery-sort" aria-label="日期排序"><option value="newest">从新到旧</option><option value="oldest">从旧到新</option></select></label><label>每页<select id="cpq-gallery-size"><option>12</option><option>24</option><option>48</option><option>96</option></select></label></div>
      <details class="cpq-gallery-filters"><summary>筛选图片</summary><div class="cpq-gallery-filter-fields"><label>来源站点<select id="cpq-gallery-provider"><option value="">全部站点</option><option value="chatgpt">ChatGPT</option><option value="gemini">Gemini</option><option value="unknown">未知来源</option></select></label><label>格式<select id="cpq-gallery-mime"><option value="">全部格式</option><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label><label>用途<select id="cpq-gallery-role"><option value="">全部用途</option><option value="generated">生成图</option><option value="reference">参考图</option><option value="captured">会话归档</option></select></label><label>下载状态<select id="cpq-gallery-download"><option value="">全部状态</option><option value="complete">已下载</option><option value="pending">尚未下载</option><option value="unknown">待核对</option><option value="interrupted">下载失败</option><option value="in_progress">下载中</option></select></label><label>开始日期<input id="cpq-gallery-from" type="date"></label><label>结束日期<input id="cpq-gallery-to" type="date"></label></div><div class="cpq-gallery-filter-actions"><button id="cpq-gallery-reset">重置筛选</button><button id="cpq-gallery-select-filtered">选择全部筛选结果</button></div></details>
      <p id="cpq-gallery-filter-error" role="alert" hidden></p><div id="cpq-active-filters" role="group" aria-label="活动筛选" hidden></div><p class="cpq-help cpq-selection-help">更改筛选会清空选择。</p>
      </div><div class="cpq-page-selection"><label class="cpq-page-check"><input id="cpq-gallery-all" type="checkbox">本页全选</label><span class="cpq-help">翻页保留选择</span></div><nav id="cpq-gallery-pagination" class="cpq-pagination" aria-label="图片分页" hidden><button id="cpq-gallery-prev">上一页</button><label><span class="cpq-sr-only">图片页码</span><select id="cpq-gallery-page"></select></label><button id="cpq-gallery-next">下一页</button></nav><div id="cpq-gallery"></div></div><div id="cpq-image-detail" hidden></div>
    </section>`;
    // Compose compact file controls without changing ids, listeners or saved query state.
    const controls = pane.querySelector(".cpq-gallery-control-row");
    const sizeLabel = pane.querySelector("#cpq-gallery-size").closest("label");
    const filters = pane.querySelector(".cpq-gallery-filters");
    controls.append(filters);
    const footerControls = document.createElement("div");
    footerControls.className = "cpq-gallery-footer";
    pane.querySelector("#cpq-gallery").after(footerControls);
    sizeLabel.classList.add("cpq-page-size");
    footerControls.append(sizeLabel, pane.querySelector("#cpq-gallery-pagination"));
    filters.append(pane.querySelector(".cpq-selection-help"));
    const bar = document.createElement("section");
    bar.id = "cpq-selection-bar";
    bar.setAttribute("aria-label", "选中图片操作");
    bar.setAttribute("data-connection-hide", "");
    bar.hidden = true;
    bar.innerHTML = `<div class="cpq-selection-heading"><span id="cpq-selected-count" role="status" aria-live="polite" aria-atomic="true"></span><button id="cpq-gallery-clear" data-variant="quiet">取消选择</button></div><div class="cpq-selection-actions"><button id="cpq-bulk-download" class="cpq-primary">批量下载</button><details class="cpq-gallery-more"><summary>更多</summary><div><button id="cpq-bulk-zip">打包 ZIP</button></div></details></div>`;
    const selectionRule = document.createElement("p");
    selectionRule.className = "cpq-help cpq-selection-rule";
    selectionRule.textContent = "更改筛选会清空选择。";
    selectionRule.hidden=true;
    const selectThisPage=document.createElement("button");selectThisPage.textContent="全选本页";selectThisPage.dataset.variant="quiet";selectThisPage.onclick=()=>selectPage(true);
    bar.querySelector(".cpq-selection-heading").insertBefore(selectThisPage,bar.querySelector("#cpq-gallery-clear"));
    const footer = rootNode.querySelector("footer");
    if (footer) footer.before(bar);
    else rootNode.append(bar);
    const heading=pane.querySelector('#cpq-gallery-heading');
    const search=pane.querySelector('.cpq-gallery-search');
    const searchRow=document.createElement('div');searchRow.className='cpq-gallery-search-row';
    searchRow.append(search);
    const primary=document.createElement('div');primary.className='cpq-gallery-primary';
    pane.querySelector('.cpq-gallery-controls').prepend(primary);
    const meta=document.createElement('div');meta.className='cpq-gallery-meta cpq-gallery-secondary';meta.append(pane.querySelector('.cpq-gallery-control-row'));
    primary.after(meta);
    const presets=document.createElement('div');presets.className='cpq-gallery-presets';presets.setAttribute('role','group');presets.setAttribute('aria-label','快捷状态与日期筛选');
    presets.innerHTML='<button data-gallery-preset="all" aria-pressed="true">全部</button><button data-gallery-preset="downloaded" aria-pressed="false">已下载</button><button data-gallery-preset="archive" aria-pressed="false">会话待归档</button><button data-gallery-preset="week" aria-pressed="false">本周</button>';
    primary.append(searchRow,presets,pane.querySelector('#cpq-gallery-view'));
    const provider=pane.querySelector('#cpq-gallery-provider').closest('label');provider.classList.add('cpq-provider-control');pane.querySelector('.cpq-gallery-control-row').prepend(provider);
    if(provider.firstChild?.nodeType===3)provider.firstChild.nodeValue='站点';
    const manage=document.createElement('button');manage.id='cpq-gallery-manage';manage.textContent='批量管理';manage.setAttribute('aria-expanded','false');
    pane.querySelector('.cpq-gallery-control-row').append(manage);
    const pageSelection=pane.querySelector('.cpq-page-selection');pageSelection.hidden=true;
    pageSelection.id='cpq-page-selection';manage.setAttribute('aria-controls',pageSelection.id);
    pageSelection.querySelector('.cpq-help').textContent='Shift+点击或空格连选；Ctrl+A 全选本页；Esc 取消选择。翻页保留已选。';
    manage.onclick=()=>{pageSelection.hidden=!pageSelection.hidden;manage.setAttribute('aria-expanded',String(!pageSelection.hidden));};
    heading.querySelector('h2').textContent='图片图库';heading.hidden=false;
    const $ = (s) => rootNode.querySelector(s),
      drafts = new Map(),
      saving = new Set(),
      previews = new Map(),
      expandedInfo = new Set();
    let selectionAnchor = null;
    let activity='all',archiveIds=new Set(),archiveSignature='',wasInteracting=false;
    let pageSize = 12,
      filtered = [],
      mode = "medium",
      touched = false;
    const fields = [
      "search",
      "sort",
      "provider",
      "mime",
      "role",
      "download",
      "from",
      "to",
    ];
    const query = () =>
      Object.fromEntries(fields.map((k) => [k, $("#cpq-gallery-" + k).value]));
    let assets = [],
      page = 1,
      gridEpoch = 0,
      detailId = null,
      detailReturn = null,
      externalBack = null,
      externalBackLabel = "返回创作",
      detailAsset = null,
      openEpoch = 0,
      busy = false,
      savedScroll = 0;
    let previewReturn = null, previewIdentity = null, previewExternal = false, previewEpoch = 0;
    const previewDialog = node("dialog", "cpq-preview-dialog");
    previewDialog.id = "cpq-preview-dialog";
    previewDialog.setAttribute("aria-label", "原图预览");
    const previewImage = node("img"),
      previewClose = button("关闭预览", "", () => previewDialog.close());
    previewClose.id = "cpq-preview-close";
    previewDialog.append(previewClose, previewImage);
    previewDialog.addEventListener("cancel", e => { e.preventDefault(); previewDialog.close(); });
    previewDialog.addEventListener("close", () => {
      previewExternal=false;previewEpoch++;
      updateSelection();
      if(!rootNode.isConnected || rootNode.hidden)return;
      const replacement=previewIdentity?.jobId
        ? [...rootNode.querySelectorAll('.cpq-queue-image')].find(b=>b.dataset.queueAssetId===previewIdentity.id && b.closest('.cpq-job')?.dataset.jobId===previewIdentity.jobId)
        : [...pane.querySelectorAll('.cpq-image-open')].find(b=>b.dataset.assetId===previewIdentity?.id);
      const target=previewReturn?.isConnected?previewReturn:replacement || rootNode.querySelector('#cpq-home,#cpq-primary-gallery,#cpq-primary-feed');
      target?.focus({preventScroll:true});
    });
    rootNode.append(previewDialog);
    const visibleAssets = () =>
      filtered.slice((page - 1) * pageSize, page * pageSize);
    function preferenceChanged(clear = false, resetPage = true) {
      if (busy) return;
      touched = true;
      if(clear || resetPage) selectionAnchor=null;
      if(resetPage) page = 1;
      if (clear) {
        const hadSelection = selected.size > 0;
        selected.clear();
        actions.status(hadSelection ? "筛选已更新，已清除原先选择。" : "");
      }
      mode = $("#cpq-gallery-view input:checked")?.value || "medium";
      pageSize = Number($("#cpq-gallery-size").value);
      renderGrid();
      Promise.resolve(
        actions.savePreferences?.({ ...query(), mode, pageSize }),
      ).catch(() => actions.status("显示偏好未保存，可继续使用图库。"));
    }
    function weekRange(){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));const end=new Date(d);end.setDate(end.getDate()+6);const format=v=>v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0')+'-'+String(v.getDate()).padStart(2,'0');return {from:format(d),to:format(end)};}
    function setTaskContext(items){
      const next=new Set(items.filter(item=>item.status==='done'&&item.lastError?.startsWith('任务已完成；会话归档未完成')).flatMap(item=>item.generatedAssetIds||[]));
      const signature=[...next].sort().join('|');if(signature===archiveSignature)return;archiveSignature=signature;archiveIds=next;if(!detailId&&!selected.size)renderGrid();
    }
    for(const button of presets.querySelectorAll('button'))button.onclick=()=>{
      if(busy)return;activity=button.dataset.galleryPreset==='archive'?'archive':'all';
      $('#cpq-gallery-download').value=button.dataset.galleryPreset==='downloaded'?'complete':'';
      const range=button.dataset.galleryPreset==='week'?weekRange():{from:'',to:''};$('#cpq-gallery-from').value=range.from;$('#cpq-gallery-to').value=range.to;preferenceChanged(true);
    };
    for (const key of fields) {
      const input = $("#cpq-gallery-" + key);
      input.addEventListener(key === "search" ? "input" : "change", () =>
        preferenceChanged(key !== "sort"),
      );
    }
    $("#cpq-gallery-view").onchange = () => preferenceChanged(false,false);
    $("#cpq-gallery-size").onchange = () => preferenceChanged();
    $("#cpq-gallery-reset").onclick = () => {
      if (busy) return;
      activity='all';
      for (const key of fields)
        $("#cpq-gallery-" + key).value = key === "sort" ? "newest" : "";
      preferenceChanged(true);
    };
    $("#cpq-gallery-select-filtered").onclick = () => {
      if (busy) return;
      for (const a of filtered) selected.add(a.id);
      updateSelection();
    };
    Promise.resolve(actions.loadPreferences?.())
      .then((prefs) => {
        if (!prefs || touched) return;
        for (const key of fields)
          if (typeof prefs[key] === "string")
            $("#cpq-gallery-" + key).value = prefs[key];
        const restoredMode=prefs.mode==='details'?'list':prefs.mode;
        if (modes.includes(restoredMode)) mode = restoredMode;
        if ([12, 24, 48, 96].includes(prefs.pageSize))
          pageSize = prefs.pageSize;
        for(const choice of $("#cpq-gallery-view").querySelectorAll('input'))choice.checked=choice.value===mode;
        $("#cpq-gallery-size").value = String(pageSize);
        renderGrid();
      })
      .catch(() => {});
    const fullAsset = (a) =>
      a?.dataUrl
        ? a
        : previews.has(a?.id)
          ? { ...previews.get(a.id), ...a }
          : detailAsset && detailAsset.id === a?.id
            ? { ...detailAsset, ...a }
            : null;
    function changePage(value) {
      selectionAnchor=null;
      page = Math.max(
        1,
        Math.min(
          Math.ceil(filtered.length / pageSize) || 1,
          Number(value) || 1,
        ),
      );
      renderGrid();
      const scroll = rootNode.querySelector(".cpq-scroll");
      if (scroll) scroll.scrollTop = 0;
    }
    $("#cpq-gallery-prev").onclick = () => changePage(page - 1);
    $("#cpq-gallery-next").onclick = () => changePage(page + 1);
    $("#cpq-gallery-page").onchange = (e) => changePage(e.target.value);
    function node(tag, className, text) {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    }
    function button(text, className, fn) {
      const b = node("button", className, text);
      b.type = "button";
      b.onclick = fn;
      return b;
    }
    function title(a, index) {
      return a.name && a.name.length <= 28
        ? a.name
        : "图片 " + String(index + 1).padStart(2, "0");
    }
    const dateLabel = (a) =>
      Number(a.createdAt) > 0
        ? new Date(Number(a.createdAt)).toLocaleString()
        : "日期未知";
    function renderActiveFilters() {
      const group=$("#cpq-active-filters");group.replaceChildren();
      const q=query(),labels={search:"搜索",provider:"站点",mime:"格式",role:"用途",download:"下载",from:"开始日期",to:"结束日期"};
      const values={provider:providerNames,mime:{"image/png":"PNG","image/jpeg":"JPG","image/webp":"WebP"},role:{generated:"生成图",reference:"参考图",captured:"会话归档"},download:{complete:"已下载",pending:"尚未下载",unknown:"待核对",interrupted:"下载失败",in_progress:"下载中"}};
      for(const [key,label] of Object.entries(labels)) {
        if(!q[key])continue;
        const value=values[key]?.[q[key]]||q[key],full=label+"："+value;
        const chip=button(full.length>32?full.slice(0,31)+"… ×":full+" ×","cpq-filter-chip",()=>{
          if(busy)return;
          $("#cpq-gallery-"+key).value="";preferenceChanged(true);
          const focus=key==="search" || $(".cpq-gallery-filters").open?$("#cpq-gallery-"+key):$(".cpq-gallery-filters > summary");focus.focus({preventScroll:true});
        });
        chip.dataset.filter=key;chip.setAttribute("aria-label","移除"+full+"筛选");chip.title=full;chip.disabled=busy;group.append(chip);
      }
      if(activity==='archive'){
        const chip=button('会话待归档 ×','cpq-filter-chip',()=>{if(busy)return;activity='all';preferenceChanged(true);$('#cpq-gallery-search').focus({preventScroll:true});});chip.dataset.filter='archive';group.append(chip);
      }
      const week=weekRange();
      for(const b of presets.querySelectorAll('button')){const key=b.dataset.galleryPreset,active=key==='archive'?activity==='archive':activity==='all'&&(key==='downloaded'?q.download==='complete'&&!q.from&&!q.to:key==='week'?!q.download&&q.from===week.from&&q.to===week.to:!q.download&&!q.from&&!q.to);b.setAttribute('aria-pressed',String(active));}
      group.hidden=!group.children.length;
      $(".cpq-gallery-filters > summary").textContent="筛选图片"+(group.children.length?" · "+group.children.length:" ");
    }
    function updateSelection() {
      if (previewDialog.open && !previewExternal && (pane.hidden || !detailId)) previewDialog.close();
      bar.hidden = pane.hidden || rootNode.dataset.connectionsOpen==="true" || !!detailId || !selected.size;
      const other =
        selected.size -
        visibleAssets().filter((a) => selected.has(a.id)).length;
      $("#cpq-selected-count").textContent =
        "已选 " +
        selected.size +
        " 张" +
        (other > 0 ? " · 含其他页 " + other + " 张" : "");
      $("#cpq-bulk-download").textContent="批量下载 "+selected.size+" 张";
      const visible = visibleAssets(), checkedOnPage = visible.filter(a => selected.has(a.id)).length;
      const pageToggle = $("#cpq-gallery-all");
      pageToggle.checked = visible.length > 0 && checkedOnPage === visible.length;
      pageToggle.indeterminate = checkedOnPage > 0 && checkedOnPage < visible.length;
      pageToggle.disabled = busy || !visible.length;
      for (const card of $("#cpq-gallery").children) {
        const checked = selected.has(card.dataset.assetId);
        card.dataset.selected = String(checked);
        const box = card.querySelector("input");
        if (box) {
          box.checked = checked;
          box.disabled = busy;
        }
      }
      const interacting=!!detailId||selected.size>0||previewDialog.open||!!pane.querySelector('.cpq-image-more[open]');
      if(wasInteracting&&!interacting)queueMicrotask(()=>{if(rootNode.isConnected)rootNode.dispatchEvent(new CustomEvent('cpq:gallery-idle'));});
      wasInteracting=interacting;
    }
    new MutationObserver(() => {
      if (pane.hidden) ++openEpoch;
      updateSelection();
    }).observe(pane, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
    function renderGrid() {
      // Read live native disclosure state before replacing rows; late toggle events
      // from disconnected rows cannot overwrite the next view's state.
      for (const info of pane.querySelectorAll('.cpq-file-info')) {
        if(info.open) expandedInfo.add(info.dataset.assetId);
        else expandedInfo.delete(info.dataset.assetId);
      }
      renderActiveFilters();
      $("#cpq-gallery-mode-note").textContent='图片预览 · 名称查看详情';
      const epoch = ++gridEpoch;
      try {
        filtered = queryAssets(assets, query()).filter(a=>activity!=='archive'||archiveIds.has(a.id));
        $("#cpq-gallery-filter-error").hidden=true;
        for(const key of ['from','to'])$("#cpq-gallery-"+key).removeAttribute('aria-invalid');
      } catch (e) {
        filtered = [];
        $("#cpq-gallery-filter-error").textContent=e.message;
        $("#cpq-gallery-filter-error").hidden=false;
        for(const key of ['from','to'])$("#cpq-gallery-"+key).setAttribute('aria-invalid','true');
        actions.status(e.message);
      }
      const pages = Math.ceil(filtered.length / pageSize) || 1;
      page = Math.min(page, pages);
      const visible = visibleAssets(),
        visibleIds = new Set(visible.map((a) => a.id));
      for (const id of previews.keys())
        if (!visibleIds.has(id)) previews.delete(id);
      const list = $("#cpq-gallery");
      const active=document.activeElement,focusSelector=['.cpq-image-more > summary','.cpq-image-name','.cpq-image-open','.cpq-image-select input'].find(selector=>active?.matches?.(selector));
      const previousFocus=list.contains(active)&&focusSelector?{id:active.closest('.cpq-asset')?.dataset.assetId,selector:focusSelector}:null;
      list.dataset.view = mode;
      list.replaceChildren();
      $("#cpq-gallery-count").textContent =
        (filtered.length === assets.length
          ? assets.length + " 张图片"
          : "筛选 " + filtered.length + " / " + assets.length + " 张图片") +
        (pages > 1
          ? " · 当前 " +
            ((page - 1) * pageSize + 1) +
            "–" +
            Math.min(page * pageSize, filtered.length) +
            " 张"
          : "");
      $("#cpq-gallery-pagination").hidden = pages <= 1;
      const pageSelect = $("#cpq-gallery-page");
      pageSelect.replaceChildren();
      for (let p = 1; p <= pages; p++) {
        const option = node("option", "", "第 " + p + " / " + pages + " 页");
        option.value = String(p);
        pageSelect.append(option);
      }
      pageSelect.value = String(page);
      $("#cpq-gallery-prev").disabled = page <= 1;
      $("#cpq-gallery-next").disabled = page >= pages;
      $("#cpq-gallery-all").disabled = busy || !filtered.length;
      $("#cpq-gallery-select-filtered").disabled = busy || !filtered.length;
      if (!filtered.length) {
        const empty = node(
          "p",
          "cpq-empty",
          assets.length
            ? "没有符合筛选条件的图片。可重置筛选后查看全部。"
            : "图库还是空的。完成图片任务或归档会话后，原图会出现在这里。",
        );
        list.append(empty);
      }
      const pendingReads = [];
      for (const [localIndex, a] of visible.entries()) {
        const index = (page - 1) * pageSize + localIndex;
        const card = node("article", "cpq-asset");
        card.dataset.assetId = a.id;
        card.dataset.downloadState=downloadState(a);
        const thumbnail = node("div", "cpq-thumbnail");
        const open = button("", "cpq-image-open", () => {
          if (fullAsset(a)) showDetail(a.id);
          else readOriginal();
        });
        open.setAttribute("aria-label", "查看 " + String(a.name || title(a,index)).slice(0,160));
        open.dataset.assetId = a.id;
        const image = node("img");
        image.alt = String(a.caption || a.name || "原图").slice(0, 100);
        image.loading = "lazy";
        const feedback = node("span", "cpq-preview-feedback", "读取中…");
        open.append(image, feedback);
        function showOriginal(full) {
          image.src = full.dataUrl;
          image.hidden = false;
          feedback.hidden = true;
          open.disabled = false;
          open.removeAttribute("aria-busy");
        }
        async function readOriginal() {
          open.disabled = true;
          open.setAttribute("aria-busy", "true");
          feedback.textContent = "读取中…";
          try {
            const full = await actions.load(a.id);
            if (epoch !== gridEpoch) return;
            if (full?.id !== a.id || !full.dataUrl)
              throw new Error("原图读取结果不完整");
            previews.set(a.id, full);
            showOriginal(full);
          } catch (e) {
            if (epoch !== gridEpoch) return;
            feedback.textContent = "重试读取";
            open.disabled = false;
            open.removeAttribute("aria-busy");
            actions.status("原图读取失败：" + e.message);
          }
        }
        const full = fullAsset(a);
        if (full) showOriginal(full);
        else {
          image.hidden = true;
          open.disabled = true;
          pendingReads.push(readOriginal);
        }
        const label = node("label", "cpq-image-select");
        const box = node("input");
        box.type = "checkbox";
        box.setAttribute("aria-label", "选择 " + title(a, index));
        let rangeRequested=false;
        box.addEventListener('keydown',event=>{if(event.key===' '&&!event.defaultPrevented)rangeRequested=event.shiftKey;});
        box.addEventListener('click',event=>{rangeRequested=event.shiftKey || (event.detail===0 && rangeRequested);});
        box.onchange = () => {
          if (busy) {
            rangeRequested=false;
            updateSelection();
            return;
          }
          touched=true;
          const visible=visibleAssets(),from=visible.findIndex(asset=>asset.id===selectionAnchor),to=visible.findIndex(asset=>asset.id===a.id);
          const range=rangeRequested&&from>=0&&to>=0?visible.slice(Math.min(from,to),Math.max(from,to)+1):[a];
          for(const asset of range){if(box.checked)selected.add(asset.id);else selected.delete(asset.id);}
          selectionAnchor=a.id;rangeRequested=false;
          updateSelection();
        };
        label.append(box);
        thumbnail.append(label,open);
        const copy = node("div", "cpq-image-copy");
        const cardHeading=node('div','cpq-image-heading');
        const name=button('','cpq-image-name',()=>openAsset(a.id,null,undefined,name).catch(e=>actions.status(e.message)));
        name.dataset.variant='quiet';name.dataset.assetId=a.id;name.setAttribute('aria-label','查看图片详情，编辑描述：'+(a.name||title(a,index)));
        name.append(node('strong','cpq-image-title',mode==='list'?a.name||title(a,index):title(a,index)));
        cardHeading.append(name,node("span", "cpq-image-sync", downloadLabel(a)));
        copy.append(cardHeading,node('p','cpq-image-excerpt',a.caption||(a.sources||[]).find(s=>s.prompt)?.prompt||a.name||'暂无描述'),node('time','cpq-image-date',dateLabel(a)));
        if(archiveIds.has(a.id))cardHeading.append(node('span','cpq-archive-flag','会话待归档'));
        const sourceNames=[...new Set((a.sources||[]).map(s=>s.provider).filter(Boolean))].map(p=>providerNames[p]||p).join(' / ')||'未知来源';
        copy.append(node('span','cpq-image-source',sourceNames));
        const format=(a.mime||'').replace('image/','').toUpperCase()||'未知格式';
        const dimensions=a.width&&a.height?a.width+' × '+a.height:'尺寸未记录';
        const sizeLabel=Number.isFinite(a.size)&&a.size>0?(a.size<1000?a.size+' B':a.size<1000000?(a.size/1000).toFixed(1)+' KB':(a.size/1000000).toFixed(1)+' MB'):'大小未记录';
        let disclosure;
        if(mode==='list') {
        disclosure=node('details','cpq-file-info');
        disclosure.dataset.assetId=a.id;
        disclosure.open=expandedInfo.has(a.id);
        disclosure.append(node('summary','','文件信息'));
        const info = node("dl", "cpq-image-columns");
        for(const [key,label,value] of [
          ['format','格式',format],['size','大小',Math.ceil((a.size||0)/1024)+' KiB'],
          ['dimensions','尺寸',dimensions],
          ['source','来源',sourceNames],['date','日期',dateLabel(a)],['download','下载',downloadLabel(a)]
        ]) {
          const term=node('dt','',label),definition=node('dd','',value);term.dataset.field=key;definition.dataset.field=key;info.append(term,definition);
        }
        disclosure.append(info);
        const file=node('div','cpq-image-file');file.append(disclosure,node('p','cpq-file-summary',[format,dimensions,sizeLabel].join(' · ')));copy.append(file);
        }
        const directState=downloadState(a),directLabel={complete:'再次下载',unknown:'核对',in_progress:'下载中',interrupted:'重试下载',pending:'下载原图'}[directState];
        const direct=button(directLabel,'cpq-image-download'+(directState==='unknown'?'':' cpq-primary'),async()=>{
          if(busy)return;direct.disabled=true;
          try {if(downloadState(a)==='unknown')await actions.reviewDownload?.(a.id,direct);else await actions.download(a.id);}catch(e){actions.status(e.message);}finally{direct.disabled=false;}
        });
        direct.disabled=busy||directState==='in_progress';
        direct.setAttribute('aria-label',downloadState(a)==='unknown'?'核对图片下载结果':'下载原图：'+(a.name||title(a,index)));
        direct.dataset.imageAction='download';
        const more=node('details','cpq-image-more'),moreSummary=node('summary','','⋯'),menu=node('div','cpq-image-menu');
        moreSummary.dataset.assetId=a.id;moreSummary.setAttribute('aria-label','更多图片操作：'+(a.name||title(a,index)));menu.setAttribute('role','group');menu.setAttribute('aria-label','图片操作');
        const edit=button('编辑描述','',()=>{more.open=false;openAsset(a.id,null,undefined,moreSummary).catch(e=>actions.status(e.message));});edit.dataset.moreAction='edit';edit.dataset.variant='quiet';
        const inspect=button('查看原图','',()=>{more.open=false;previewAsset(a.id,moreSummary).catch(e=>actions.status(e.message));});inspect.dataset.moreAction='preview';inspect.dataset.variant='quiet';
        menu.append(inspect,edit);more.append(moreSummary,menu);
        more.addEventListener('toggle',()=>{if(more.open){for(const other of pane.querySelectorAll('.cpq-image-more[open]'))if(other!==more)other.open=false;const boundary=rootNode.querySelector('.cpq-scroll')?.getBoundingClientRect()||rootNode.getBoundingClientRect();more.dataset.up=String(moreSummary.getBoundingClientRect().bottom+menu.offsetHeight+8>boundary.bottom);}updateSelection();});
        more.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();more.open=false;moreSummary.focus({preventScroll:true});}});
        more.addEventListener('focusout',event=>{if(event.relatedTarget&&more.contains(event.relatedTarget))return;queueMicrotask(()=>{if(!more.contains(document.activeElement))more.open=false;});});
        const tail=node('div','cpq-image-card-tail');tail.append(copy.querySelector('.cpq-image-date'),direct,more);copy.append(tail);
        const source=copy.querySelector('.cpq-image-source');thumbnail.append(source);
        open.onclick=()=>previewAsset(a.id,open).catch(e=>actions.status(e.message));
        card.append(thumbnail, copy);
        list.append(card);
      }
      (async () => {
        for (const read of pendingReads) {
          if (epoch !== gridEpoch) break;
          await read();
        }
      })();
      updateSelection();
      if(previousFocus&&!detailId&&!previewDialog.open&&!pane.hidden&&!rootNode.hidden){
        const row=[...list.children].find(e=>e.dataset.assetId===previousFocus.id),target=row?.querySelector(previousFocus.selector)||rootNode.querySelector('#cpq-home');
        target?.focus({preventScroll:true});
        const viewport=rootNode.querySelector('.cpq-scroll')?.getBoundingClientRect(),bounds=target?.getBoundingClientRect();
        if(row&&viewport&&bounds?.height&&(bounds.top<viewport.top||bounds.bottom>viewport.bottom))target.scrollIntoView?.({block:'nearest'});
      }
    }
    function setBusy(value) {
      busy = value;
      for (const el of pane.querySelectorAll(
        ".cpq-gallery-controls input, .cpq-gallery-controls select, .cpq-gallery-controls button",
      ))
        el.disabled = busy;
      updateSelection();
      if (detailId)
        for (const el of $("#cpq-image-detail").querySelectorAll(
          "textarea, [data-image-action]",
        ))
          el.disabled = busy || saving.has(detailId) || (el.dataset.imageAction==='download'&&downloadState(detailAsset)==='in_progress');
    }
    function showDetail(id, preserveScroll = false) {
      const a = fullAsset(assets.find((x) => x.id === id));
      if (!a) return;
      ++openEpoch;
      detailAsset = a;
      const scroll = rootNode.querySelector(".cpq-scroll");
      if (!detailId && !preserveScroll) savedScroll = scroll?.scrollTop || 0;
      detailId = id;
      $("#cpq-gallery-heading").hidden = true;
      $("#cpq-gallery-gridview").hidden = true;
      const detail = $("#cpq-image-detail");
      detail.hidden = false;
      detail.replaceChildren();
      const back = button(
        externalBack ? externalBackLabel : "返回图库",
        "cpq-detail-back",
        () => {
          detailId = null;
          detailAsset = null;
          ++openEpoch;
          detail.hidden = true;
          $("#cpq-gallery-heading").hidden = false;
          $("#cpq-gallery-gridview").hidden = false;
          updateSelection();
          if (scroll) scroll.scrollTop = savedScroll;
          const returnSelector=detailReturn?.id===id?({name:'.cpq-image-name',more:'.cpq-image-more > summary'}[detailReturn.kind]||'.cpq-image-open'):'.cpq-image-open';
          [...$("#cpq-gallery").querySelectorAll(returnSelector)]
            .find((b) => b.dataset.assetId === id)
            ?.focus({ preventScroll: true });
          const callback = externalBack;
          externalBack = null;
          callback?.();
        },
      );
      back.id = "cpq-detail-back";
      const image = node("img", "cpq-detail-preview");
      image.src = a.dataUrl;
      image.alt = String(a.caption || a.name || "原图").slice(0, 100);
      const previewOpen = button("查看大图", "cpq-preview-open", () => {
        previewReturn = previewOpen;
        previewImage.src = a.dataUrl;
        previewImage.alt = image.alt;
        previewDialog.showModal();
        updateSelection();
        previewClose.focus();
      });
      previewOpen.id = "cpq-preview-open";
      const heading = node("div", "cpq-detail-heading");
      const needsDownloadReview = downloadState(a) === "unknown";
      const download = button(needsDownloadReview ? "核对下载" : ({complete:'再次下载',in_progress:'下载中',interrupted:'重试下载',pending:'下载原图'})[downloadState(a)], "cpq-primary", async () => {
        if (busy) return;
        try {
          if (needsDownloadReview) await actions.reviewDownload?.(id);
          else await actions.download(id);
        } catch (e) {
          actions.status(e.message);
        }
      });
      download.id = "cpq-detail-download";
      download.dataset.imageAction = "download";
      download.disabled=busy||downloadState(a)==='in_progress';
      heading.append(
        node("strong", "", title(a, assets.indexOf(a))),
        node("span", "cpq-image-sync", downloadLabel(a)),
        download,
      );
      const field = node("label", "", "图片描述");
      const caption = node("textarea");
      caption.id = "cpq-image-caption";
      caption.rows = 3;
      caption.maxLength = 20000;
      caption.value = drafts.has(id) ? drafts.get(id) : a.caption || "";
      caption.placeholder = "补充画面内容，便于搜索与本机记录";
      caption.oninput = () => drafts.set(id, caption.value);
      field.append(caption);
      const save = button("保存描述", "cpq-primary", async () => {
        if (busy || saving.has(id)) return;
        const value = caption.value;
        saving.add(id);
        captionStatus.textContent='正在保存描述…';
        setBusy(busy);
        try {
          await actions.save(id, value);
          const current = assets.find((x) => x.id === id);
          if (current) current.caption = value;
          if (drafts.get(id) === value) drafts.delete(id);
          actions.status("描述已保存。");
          captionStatus.textContent='描述已保存。';
          renderGrid();
        } catch (e) {
          actions.status(e.message);
          captionStatus.textContent=e.message;
        } finally {
          saving.delete(id);
          setBusy(busy);
        }
      });
      save.id = "cpq-save-caption";
      save.dataset.imageAction = "save";
      const captionStatus=node('p','cpq-help');captionStatus.id='cpq-caption-status';captionStatus.setAttribute('role','status');
      detail.append(
        back,
        node("h2", "", "图片详情"),
        image,
        previewOpen,
        heading,
        field,
        node("p", "cpq-help", "保存在本地图库；连接本机服务后记入 SQLite。"),
        save,
        captionStatus,
      );
      const info = node("details", "cpq-image-info");
      info.open=false;
      info.append(node("summary", "", "文件信息与校验"));
      const entries = node("dl");
      for (const [key, value] of [
        ["原始名称", a.name || "图片"],
        [
          "格式与大小",
          a.mime + " · " + Math.ceil((a.size || 0) / 1024) + " KiB",
        ],
        ["文件标识", a.id],
        [
          "SHA-256",
          a.sha256 || (/^[a-f0-9]{64}$/.test(a.id) ? a.id : "未提供"),
        ],
      ])
        entries.append(node("dt", "", key), node("dd", "", value));
      const prompts = [
        ...new Set((a.sources || []).map((s) => s.prompt).filter(Boolean)),
      ];
      const promptSection = node("section", "cpq-detail-prompt");
      const originalPrompt=node('textarea');originalPrompt.id='cpq-original-prompt';originalPrompt.readOnly=true;originalPrompt.rows=3;originalPrompt.value=prompts.join('\n\n')||'此图片未记录提示词。';originalPrompt.setAttribute('aria-label','原始提示词（只读）');
      promptSection.append(node("h3", "", "原始提示词"), originalPrompt);
      detail.append(promptSection);
      info.append(entries);
      detail.append(info);
      updateSelection();
      setBusy(busy);
      if (scroll && !preserveScroll) scroll.scrollTop = 0;
    }
    function render(next) {
      assets = next;
      const count=rootNode.querySelector('#cpq-asset-count');if(count)count.textContent=' ('+assets.length+')';
      const ids = new Set(next.map((a) => a.id));
      for (const id of selected) if (!ids.has(id)) selected.delete(id);
      if (detailId && !ids.has(detailId)) {
        detailId = null;
        detailAsset = null;
        externalBack = null;
        ++openEpoch;
        $("#cpq-image-detail").hidden = true;
        $("#cpq-gallery-heading").hidden = false;
        $("#cpq-gallery-gridview").hidden = false;
      }
      renderGrid();
      if (detailId) showDetail(detailId, true);
    }
    function selectPage(checked = true) {
      if (busy) return;
      touched=true;selectionAnchor=null;
      for (const a of visibleAssets()) {
        if (checked) selected.add(a.id);
        else selected.delete(a.id);
      }
      updateSelection();
    }
    function clearSelection() {
      if(busy)return;
      const restore=bar.contains(rootNode.ownerDocument.activeElement),anchorId=selectionAnchor;
      touched=true;selected.clear();selectionAnchor=null;
      updateSelection();
      if(restore){
        const bounds=(rootNode.querySelector('.cpq-scroll')||rootNode).getBoundingClientRect();
        const inView=element=>{if(!element?.getClientRects().length)return false;const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=bounds.top&&r.bottom<=bounds.bottom&&r.left>=bounds.left&&r.right<=bounds.right;};
        const cards=[...$('#cpq-gallery').children],anchor=cards.find(card=>card.dataset.assetId===anchorId)?.querySelector('.cpq-image-select input');
        const target=inView(manage)?manage:inView(anchor)?anchor:cards.map(card=>card.querySelector('.cpq-image-select input')).find(inView)||$('#cpq-home')||$('#cpq-primary-gallery')||manage;
        target.focus({preventScroll:true});
      }
    }
    rootNode.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.isComposing||busy||rootNode.hidden||!rootNode.isConnected||pane.hidden||detailId||previewDialog.open||rootNode.dataset.connectionsOpen==='true'||!['gallery','workspace'].includes(rootNode.dataset.view))return;
      const target=event.target;
      if(target?.closest?.('.cpq-image-more[open]'))return;
      if(!pane.contains(target)&&!bar.contains(target))return;
      if(!target?.closest || target.closest('input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;
      if(String(event.key).toLowerCase()==='a'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey){
        event.preventDefault();event.stopPropagation();if(!event.repeat)selectPage(true);
      }else if(event.key==='Escape'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey&&selected.size){
        event.preventDefault();event.stopPropagation();clearSelection();
      }
    });
    async function openAsset(id, onBack, backLabel = "返回创作", trigger) {
      const token = ++openEpoch;
      const summary = assets.find((a) => a.id === id);
      if (!summary) throw new Error("原图已不存在，请刷新资料");
      const full = fullAsset(summary) || (await actions.load(id));
      if (token !== openEpoch || pane.hidden) return;
      if (full?.id !== id || !full.dataUrl) throw new Error("原图读取不完整");
      previews.set(id, full);
      detailAsset = full;
      detailReturn={id,kind:trigger?.classList.contains('cpq-image-name')?'name':trigger?.matches('.cpq-image-more > summary')?'more':'image'};
      externalBack = onBack || null;
      externalBackLabel = backLabel;
      showDetail(id);
    }
    async function previewAsset(id,trigger) {
      const token=++previewEpoch;
      const originView=rootNode.dataset.view,gridToken=gridEpoch,fromGrid=trigger?.classList.contains('cpq-image-open');
      const summary=assets.find(a=>a.id===id);
      const full=previews.get(id) || (summary && fullAsset(summary)) || await actions.load(id);
      if(token!==previewEpoch || rootNode.hidden || (trigger && !trigger.isConnected) || originView!==rootNode.dataset.view || (fromGrid && (gridToken!==gridEpoch || pane.hidden)))return;
      previews.set(id,full);
      if(full?.id!==id || !full.dataUrl?.startsWith('data:image/'))throw new Error('原图不存在或读取不完整');
      previewExternal=true;previewReturn=trigger;previewIdentity={id,jobId:trigger?.closest(".cpq-job")?.dataset.jobId};previewImage.src=full.dataUrl;previewImage.alt=full.caption || full.name || '原图';
      if(typeof previewDialog.showModal==='function')previewDialog.showModal();else previewDialog.setAttribute('open','');
      updateSelection();
      previewClose.focus();
    }
    function closeDetail() {
      $("#cpq-detail-back")?.click();
    }
    return {
      render,
      setBusy,
      updateSelection,
      selectPage,
      clearSelection,
      setTaskContext,
      interactionBusy:()=>!!detailId||selected.size>0||previewDialog.open||!!pane.querySelector('.cpq-image-more[open]'),
      openAsset,
      previewAsset,
      closePreview:()=>{previewEpoch++;if(previewDialog.open)previewDialog.close();},
      closeDetail,
      detailOpen: () => !!detailId,
    };
  }
  root.CPQGalleryView = { mount };
  if (typeof module === "object" && module.exports)
    module.exports = { mount, queryAssets, downloadState, downloadLabel };
})(globalThis);
