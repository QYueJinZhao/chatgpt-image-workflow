/* MIT. Presentation only: preserve native controls and existing business handlers. */
(function (root) {
  "use strict";
  const mounted = new WeakMap();
  const quiet = /(?:close|back|fold|expand|resources|refresh|prev|next)$/;
  function mount(container) {
    if (mounted.has(container)) return mounted.get(container);
    container.classList.add("cpq-design-v4");
    function decorate(element) {
      if (element.matches("button")) {
        if (element.matches(".cpq-image-open,.cpq-queue-image")) return;
        element.classList.add("cpq-btn");
        if (!element.dataset.variant) element.dataset.variant = element.matches(".cpq-primary") ? "primary"
          : element.matches(".cpq-quiet-danger,.danger") || /(?:stop|clear)$/.test(element.id) ? "danger"
          : element.closest("#cpq-primary-nav") || quiet.test(element.id) ? "quiet" : "secondary";
        if (element.closest("#cpq-primary-nav")) element.classList.add("cpq-nav-tab");
      }
      if (element.matches("summary")) element.classList.add("cpq-disclosure");
      if (element.matches('input[type="checkbox"],input[type="radio"]')) {
        element.closest("label")?.classList.add("cpq-choice");
      } else if (element.matches("textarea")) {
        element.classList.add("cpq-textarea");
      } else if (element.matches('select,input:not([type="hidden"]):not([type="button"]):not([type="submit"])')) {
        if (!element.parentElement?.classList.contains("cpq-control")) {
          const active = element.ownerDocument.activeElement === element;
          let selection;
          try { selection = [element.selectionStart, element.selectionEnd, element.selectionDirection]; } catch { /* Native non-text field. */ }
          const wrapper = element.ownerDocument.createElement("span");
          wrapper.className = "cpq-control";
          element.before(wrapper);
          wrapper.append(element);
          if (active) {
            element.focus({preventScroll:true});
            if (selection?.[0] !== null) try { element.setSelectionRange(...selection); } catch { /* Native non-text field. */ }
          }
        }
      }
    }
    function refresh(node = container) {
      if (node.nodeType !== 1) return;
      decorate(node);
      node.querySelectorAll("button,input,select,textarea,summary").forEach(decorate);
    }
    refresh();
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (container.contains(node)) refresh(node);
    });
    observer.observe(container, {childList:true, subtree:true});
    const controller = {refresh:() => refresh(), dispose() {observer.disconnect(); mounted.delete(container);}};
    mounted.set(container, controller);
    return controller;
  }
  root.CPQControls = {mount};
})(globalThis);
