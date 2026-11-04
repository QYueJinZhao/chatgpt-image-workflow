/* MIT. Single-workspace presentation; execution and persistence stay in existing controllers. */
(function(root){
  'use strict';
  const archivePending=item=>item.status==='done'&&item.lastError?.startsWith('任务已完成；会话归档未完成');
  const isAttention=item=>['pending','running','failed','needs_review'].includes(item.status)||archivePending(item);
  const orderedItems=items=>items.slice();
  let panelSaveTail=Promise.resolve(),panelMountGeneration=0;
  // Presentation preferences deliberately bypass the queue revision and lease.
  async function mountPanel(panel,{onVisibilityChange=()=>{},onError=()=>{}}={}){
    const generation=++panelMountGeneration;
    root.__CPQPanelLayout?.dispose();
    panel.hidden=true;
    const doc=panel.ownerDocument,html=doc.documentElement,storage=root.chrome?.storage?.local;
    const key='cpqPanelPreferences',defaults={visible:true,width:1168,mode:'floating'};
    const minimum=320,maximum=1800,owner=root.crypto.randomUUID();
    let prefs={...defaults},drag=null,disposed=false,readFailed=false;
    const validWidth=value=>typeof value==='number'&&Number.isFinite(value)?Math.round(Math.max(minimum,Math.min(maximum,value))):defaults.width;
    try{
      // A replacement must read after the outgoing controller's final writes.
      await panelSaveTail;
      const saved=(await storage?.get?.(key))?.[key];
      prefs={visible:typeof saved?.visible==='boolean'?saved.visible:defaults.visible,width:validWidth(saved?.width),mode:saved?.mode==='embedded'?'embedded':'floating'};
    }catch{readFailed=true;}
    if(generation!==panelMountGeneration||!panel.isConnected){
      return {setVisible(){},toggle(){},dispose(){}};
    }
    const listeners=new root.AbortController(),listen=(target,type,handler)=>target.addEventListener(type,handler,{signal:listeners.signal});
    const menu=doc.createElement('details');menu.id='cpq-panel-layout';
    menu.innerHTML='<summary aria-label="工作台布局">布局</summary><div class="cpq-panel-popover"><label for="cpq-panel-mode">显示方式</label><select id="cpq-panel-mode"><option value="floating">悬浮 · 保持页面宽度</option><option value="embedded">嵌入 · 为面板留出空间</option></select><label for="cpq-panel-width">面板宽度（像素）</label><input id="cpq-panel-width" type="number" min="320" max="1800" step="20" inputmode="numeric"><button id="cpq-panel-reset" type="button">恢复默认宽度</button><p id="cpq-panel-size-note" class="cpq-help"></p><p id="cpq-panel-status" role="status" aria-live="polite" class="cpq-help">更改后自动保存</p></div>';
    panel.querySelector('#cpq-close').before(menu);
    const handle=doc.createElement('div');handle.id='cpq-panel-resize';handle.tabIndex=0;
    handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
    handle.setAttribute('aria-label','调整工作台宽度');handle.title='拖拽调整宽度；也可使用左右方向键或“布局”菜单';panel.append(handle);
    const mode=menu.querySelector('#cpq-panel-mode'),widthInput=menu.querySelector('#cpq-panel-width'),note=menu.querySelector('#cpq-panel-size-note'),status=menu.querySelector('#cpq-panel-status');
    const bounds=()=>{
      const viewport=Math.max(1,root.innerWidth||html.clientWidth||minimum);
      const embedded=prefs.mode==='embedded'&&viewport>=minimum*2;
      const max=Math.min(maximum,embedded?viewport-minimum:viewport);
      return {max,min:Math.min(minimum,max),embedded};
    };
    function releaseSpace(){
      if(html.dataset.cpqPanelOwner!==owner)return;
      delete html.dataset.cpqPanelEmbedded;delete html.dataset.cpqPanelOwner;
      html.style.removeProperty('--cpq-panel-reserved-width');
    }
    function apply(){
      if(disposed)return;
      const {min,max,embedded}=bounds(),width=Math.max(min,Math.min(max,prefs.width));
      panel.hidden=!prefs.visible;panel.dataset.panelMode=prefs.mode;panel.dataset.panelEffectiveMode=embedded?'embedded':'floating';
      panel.style.setProperty('--cpq-panel-width',width+'px');
      mode.value=prefs.mode;widthInput.value=String(prefs.width);
      handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(width));
      handle.setAttribute('aria-valuetext',width+' 像素');
      note.textContent=(prefs.mode==='embedded'&&!embedded?'窗口较窄，暂以悬浮显示。':'')+'当前 '+width+' px'+(width!==prefs.width?'，窗口变宽后恢复 '+prefs.width+' px':'')+'。可拖拽左边缘调整。';
      if(prefs.visible&&embedded){
        html.dataset.cpqPanelOwner=owner;html.dataset.cpqPanelEmbedded='true';html.style.setProperty('--cpq-panel-reserved-width',width+'px');
      }else releaseSpace();
    }
    function report(message){status.textContent=message;onError(message);}
    function save(){
      const snapshot={...prefs};panel.dataset.panelSaveState='saving';status.textContent='正在保存布局…';
      panelSaveTail=panelSaveTail.then(async()=>{
        try{
          if(!storage?.set)throw new Error('Storage unavailable');
          await storage.set({[key]:snapshot});
          if(!disposed){panel.dataset.panelSaveState='saved';status.textContent='布局已自动保存';}
        }catch{
          if(!disposed){panel.dataset.panelSaveState='error';report('布局未保存，请重新调整后重试。');}
        }
      });
      return panelSaveTail;
    }
    function finishDrag(cancel=false){
      if(!drag)return;
      const previous=drag;drag=null;delete panel.dataset.panelResizing;
      try{if(handle.hasPointerCapture?.(previous.id))handle.releasePointerCapture(previous.id);}catch{/* Pointer may already have been released. */}
      if(cancel){prefs.width=previous.savedWidth;apply();}else if(prefs.width!==previous.savedWidth)void save();
    }
    function setWidth(value){finishDrag(true);prefs.width=validWidth(value);apply();void save();}
    function setVisible(value){
      if(disposed)return;
      finishDrag();prefs.visible=!!value;menu.open=false;apply();onVisibilityChange(prefs.visible);void save();
    }
    listen(mode,'change',()=>{finishDrag(true);prefs.mode=mode.value==='embedded'?'embedded':'floating';apply();void save();});
    listen(widthInput,'change',()=>setWidth(widthInput.valueAsNumber));
    listen(menu.querySelector('#cpq-panel-reset'),'click',()=>setWidth(defaults.width));
    listen(handle,'pointerdown',event=>{
      if(event.button!==0||drag)return;
      event.preventDefault();handle.focus({preventScroll:true});
      drag={id:event.pointerId,x:event.clientX,width:Number(handle.getAttribute('aria-valuenow')),savedWidth:prefs.width};
      panel.dataset.panelResizing='true';
      try{handle.setPointerCapture?.(event.pointerId);}catch{/* Window listeners also handle a released pointer. */}
    });
    listen(root,'pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const {min,max}=bounds();prefs.width=Math.round(Math.max(min,Math.min(max,drag.width+drag.x-event.clientX)));apply();
    });
    listen(root,'pointerup',event=>{if(drag&&event.pointerId===drag.id)finishDrag();});
    listen(root,'pointercancel',event=>{if(drag&&event.pointerId===drag.id)finishDrag(true);});
    listen(handle,'lostpointercapture',()=>finishDrag());
    listen(handle,'keydown',event=>{
      const {min,max}=bounds(),width=Number(handle.getAttribute('aria-valuenow')),step=event.shiftKey?100:20;
      const next={ArrowLeft:width+step,ArrowRight:width-step,Home:min,End:max}[event.key];
      if(next===undefined)return;event.preventDefault();setWidth(Math.max(min,Math.min(max,next)));
    });
    listen(doc,'keydown',event=>{
      if(event.key!=='Escape')return;
      if(drag){event.preventDefault();finishDrag(true);}
      if(menu.open){menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}
    });
    listen(doc,'pointerdown',event=>{if(menu.open&&!menu.contains(event.target))menu.open=false;});
    listen(root,'blur',()=>finishDrag());
    listen(root,'resize',()=>{finishDrag(true);apply();});
    const observer=new root.MutationObserver(()=>{if(!panel.isConnected)dispose();});
    function dispose(){
      if(disposed)return;
      finishDrag(true);disposed=true;listeners.abort();observer.disconnect();releaseSpace();
      menu.remove();handle.remove();if(root.__CPQPanelLayout===controller)delete root.__CPQPanelLayout;
    }
    const controller={setVisible,toggle:()=>setVisible(panel.hidden),dispose};root.__CPQPanelLayout=controller;
    if(!panel.isConnected){dispose();return controller;}
    observer.observe(doc.body,{childList:true,subtree:true});apply();
    if(readFailed)report('未能读取已保存布局，暂用默认设置；重新调整后可保存。');
    return controller;
  }
  function mount(panel,tools,actions={}){
    const $=s=>panel.querySelector(s),scroll=$('.cpq-scroll'),positions=new Map(),focusTargets=new Map(),history=[];
    const version=root.chrome?.runtime?.getManifest?.()?.version||'开发版';
    const names={workspace:'工作台与图库',tools:'资料与帮助',preferences:'生成参数',references:'参考图',conversation:'当前会话',archives:'会话归档',backup:'备份与恢复',privacy:'关于与隐私','queue-tools':'队列工具',import:'导入任务',batch:'图片操作回执'};
    let active='workspace',state,navEpoch=0,folded=true,viewTouched=false,queueCollapsed=null,lastRunning=false,gallerySignature=null,galleryDirty=true,refreshing=false;
    panel.dataset.layout='task-library-regions';
    const canonical=view=>['feed','gallery','queue'].includes(view)?'workspace':view;
    function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
    function button(text,handler,className){const e=node('button',className,text);e.type='button';e.onclick=handler;return e;}
    function report(error){$('#cpq-status').textContent=error?.message||String(error);}
    function move(selector,destination){const e=$(selector),pane=$('[data-pane="'+destination+'"]');if(!e||!pane)return;if(e.tagName==='DETAILS'){e.open=true;e.classList.add('cpq-context-group');}pane.append(e);}
    move('.cpq-current-card','conversation');move('#cpq-reference-group','references');move('#cpq-conversations-group','archives');move('#cpq-backup-group','backup');move('.cpq-manager-groups > details:last-child','privacy');move('#cpq-batch-panel','batch');
    const archiveBody=$('#cpq-conversations-group .cpq-manager-body');if(archiveBody)archiveBody.prepend($('#cpq-conversation-pagination'));
    if($('#cpq-tool-status'))$('.cpq-feedback').append($('#cpq-tool-status'));
    const gallery=$('[data-pane="gallery"]');$('[data-pane="workspace"]').append(gallery);
    const directory=$('[data-pane="tools"]'),connection=$('.cpq-connection-row');directory.replaceChildren();
    directory.append(node('h2','cpq-directory-heading','下载与本机增强'));
    if(connection){connection.querySelector('strong').textContent='下载设置';connection.querySelector('button').textContent='配置 ›';directory.append(connection);}
    const entries=[['gallery','全部图片','原图、描述、筛选与批量下载'],['conversation','当前会话','归档当前已加载的消息与图片 · 五种导出'],['archives','会话归档','本地记录与 Markdown 导出'],['backup','备份与恢复','工作区 ZIP · 追加恢复，不自动运行'],['batch','图片操作回执','逐项结果、取消后续与重试失败项'],['privacy','关于与隐私',version+' · MIT · 数据保存在本地']];
    for(const [route,title,detail] of entries){
      const e=button('',()=>navigate(route),'cpq-directory-entry'),copy=node('span');copy.append(node('strong','',title),node('small','',detail));e.dataset.open=route;e.append(copy,node('span','cpq-directory-arrow','›'));directory.append(e);
    }
    const batchEmpty=node('p','cpq-help','还没有图片操作记录。下载图片后，可在这里查看逐项结果。');batchEmpty.id='cpq-batch-empty';batchEmpty.hidden=$('#cpq-batch-panel')?.hidden===false;$('[data-pane="batch"]').append(batchEmpty);
    function saveView(){const result=root.chrome?.storage?.local?.set?.({cpqView:{composerFolded:folded}});result?.catch?.(()=>{});}
    function updateComposer(){
      $('.cpq-composer').hidden=active!=='workspace'||folded;$('#cpq-composer-body').hidden=folded;$('#cpq-compose-collapsed').hidden=!folded;
      $('#cpq-compose-expand').textContent=$('#cpq-manual').value.trim()?'继续草稿':'新建任务';
      $('#cpq-reference-entry').textContent='参考图 '+tools.selectedReferenceIds().length+' 张';
      $('#cpq-preference-entry').textContent=($('#cpq-output-kind').value==='text'?'文字':'图片')+' · '+$('#cpq-ratio').value;
      $('#cpq-manual').placeholder=$('#cpq-split-mode').value==='lines'?'描述你想创作的内容，多项逐行分隔':'描述你想创作的内容，多项用空行分隔';
      $('#cpq-compose-fold').setAttribute('aria-expanded',String(!folded));
    }
    function updateQueue(){
      const items=state?.items||[],attention=items.filter(i=>['pending','failed','needs_review'].includes(i.status)).length,archive=items.filter(archivePending).length,collapsed=queueCollapsed===null?!state?.running:queueCollapsed;
      $('#cpq-queue-body').hidden=collapsed;$('#cpq-queue-toggle').setAttribute('aria-expanded',String(!collapsed));panel.dataset.queueCollapsed=String(collapsed);
      $('#cpq-task-count').textContent=String(attention);$('.cpq-queue-pending-count').hidden=!attention;
      $('#cpq-queue-archive-count').textContent='待归档 '+archive;$('#cpq-queue-archive-count').hidden=!archive;
      $('#cpq-queue-title-status').textContent=state?.running?'执行中':!items.length?'暂无任务':'';
    }
    async function flushGallery(){
      if(!galleryDirty||refreshing||active!=='workspace'||panel.hidden||!panel.isConnected)return;
      if(tools.galleryInteractionBusy?.()){const b=$('#cpq-gallery-refresh');if(b){b.textContent='有更新';b.setAttribute('aria-label','图库有更新，点击刷新');}return;}
      galleryDirty=false;refreshing=true;
      try{await tools.refreshGallery?.();const b=$('#cpq-gallery-refresh');if(b){b.textContent='刷新';b.setAttribute('aria-label','刷新图片');}}
      catch{report(new Error('图片库暂未更新，可点击刷新重试。'));}
      finally{refreshing=false;if(galleryDirty)void flushGallery();}
    }
    async function navigate(requested,options={}){
      const view=canonical(requested);if(!names[view])return;
      tools.closeConnections?.();if(requested==='gallery')tools.closeDetail?.();
      const token=++navEpoch,changed=view!==active;positions.set(active,scroll.scrollTop);
      if(panel.contains(document.activeElement))focusTargets.set(active,document.activeElement);
      if(changed&&options.remember!==false)history.push(active);active=view;panel.dataset.view=view;
      for(const pane of [...scroll.children].filter(e=>e.matches('[data-pane]')))pane.hidden=pane.dataset.pane!==view;
      gallery.hidden=view!=='workspace';$('.cpq-context-bar').hidden=view==='workspace';$('.cpq-header').hidden=false;
      $('#cpq-view-title').textContent=names[view];$('#cpq-back').textContent='返回'+(names[history.at(-1)]||names.workspace);$('#cpq-home').setAttribute('aria-label',view==='workspace'?'资料与帮助':'返回工作台');
      updateComposer();updateQueue();scroll.scrollTop=positions.get(view)||0;
      if(changed){const target=focusTargets.get(view);(target?.isConnected&&target.getClientRects().length?target:$(view==='workspace'?'#cpq-home':'#cpq-back'))?.focus({preventScroll:true});}
      try{
        if(options.refresh!==false){if(view==='workspace')await flushGallery();else if(['tools','references','archives','conversation','backup'].includes(view))await tools.refresh();}
        if(token===navEpoch){scroll.scrollTop=positions.get(view)||0;if(requested==='gallery')gallery.scrollIntoView?.({block:'start'});if(requested==='queue'){queueCollapsed=false;updateQueue();$('.cpq-queue-console').scrollIntoView?.({block:'start'});}}
        if(view==='workspace')void flushGallery();
      }catch(e){report(e);}
    }
    function back(){const previous=history.pop()||'workspace';return navigate(previous,{remember:false,refresh:false}).then(()=>flushGallery());}
    $('#cpq-back').onclick=back;
    $('#cpq-home').onclick=()=>active==='workspace'?navigate('tools'):navigate('workspace',{remember:false,refresh:false});
    panel.addEventListener('click',e=>{const entry=e.target.closest('[data-open]');if(entry&&panel.contains(entry)&&!entry.classList.contains('cpq-directory-entry'))void navigate(entry.dataset.open);});
    panel.addEventListener('cpq:navigate',e=>void navigate(e.detail));
    panel.addEventListener('cpq:gallery-idle',()=>void flushGallery());
    panel.addEventListener('cpq:assets-changed',()=>refresh());
    $('#cpq-queue-toggle').onclick=()=>{queueCollapsed=!$('#cpq-queue-body').hidden;updateQueue();};
    $('#cpq-compose-fold').onclick=()=>{viewTouched=true;folded=true;updateComposer();saveView();$('#cpq-compose-expand').focus({preventScroll:true});};
    $('#cpq-compose-expand').onclick=()=>{tools.closeDetail?.();if(active!=='workspace')void navigate('workspace',{refresh:false});viewTouched=true;folded=false;updateComposer();saveView();$('.cpq-composer').scrollIntoView?.({block:'start'});$('#cpq-manual').focus({preventScroll:true});};
    $('#cpq-manual').addEventListener('input',updateComposer);panel.addEventListener('change',updateComposer);panel.addEventListener('cpq:references-changed',updateComposer);
    panel.addEventListener('cpq:task-added',()=>{viewTouched=true;folded=true;queueCollapsed=false;updateComposer();updateQueue();saveView();$('.cpq-queue-console').scrollIntoView?.({block:'start'});$('#cpq-queue-toggle').focus({preventScroll:true});});
    const stored=root.chrome?.storage?.local?.get?.('cpqView');stored?.then?.(value=>{const prefs=value?.cpqView;if(!viewTouched)folded=typeof prefs?.composerFolded==='boolean'?prefs.composerFolded:!$('#cpq-manual').value.trim();updateComposer();updateQueue();}).catch(()=>{});
    function prepareRender(next){state=next;}
    function render(next){
      if(!next)return;const running=!!next.running;if(running!==lastRunning)queueCollapsed=!running;lastRunning=running;state=next;updateComposer();updateQueue();
      const pending=next.items.filter(i=>i.status==='pending').length,archive=next.items.filter(archivePending).length,attention=next.items.filter(isAttention).length;
      for(const b of panel.querySelectorAll('#cpq-task-filters button')){const key=b.dataset.taskFilter,n=key==='attention'?attention:key==='archive'?archive:key==='pending'?pending:next.items.length;b.querySelector('span').textContent=String(n);b.setAttribute('aria-pressed',String($('#cpq-queue-filter').value===key));}
      tools.setTaskContext?.(next.items);
      const signature=JSON.stringify(next.items.filter(i=>i.generatedAssetIds?.length).map(i=>[i.id,i.generatedAssetIds,i.downloadedAssetIds||[],i.downloadIds||{},!!archivePending(i)]));
      if(signature!==gallerySignature){gallerySignature=signature;galleryDirty=true;}
      void flushGallery();
    }
    function refresh(){galleryDirty=true;void flushGallery();}
    void navigate('workspace',{remember:false,refresh:false});updateComposer();
    return {navigate,back,render,prepareRender,refresh,resume:()=>void flushGallery(),updateComposer,queuePreview:()=>null};
  }
  root.CPQWorkbenchView={mount,mountPanel,orderedItems,isAttention};
})(globalThis);
