(function (root, factory) {
  const api = factory(
    root.CPQCore || (typeof require === "function" && require("./core.js")),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQCapture = api;
})(globalThis, function (C) {
  "use strict";
  function provider(d) {
    // Local fixtures have no production origin; native elements select their DOM adapter.
    return (
      C.providerForURL(d.location?.href) ||
      (d.querySelector("rich-textarea,user-query,model-response")
        ? "gemini"
        : "chatgpt")
    );
  }
  function visibleGeminiNode(n) {
    if (n.closest('#cpq-root,[hidden],[aria-hidden="true"],[inert]'))
      return false;
    const view = n.ownerDocument.defaultView;
    for (let current = n; current; current = current.parentElement) {
      const style = view?.getComputedStyle(current);
      if (
        style?.display === "none" ||
        ["hidden", "collapse"].includes(style?.visibility)
      )
        return false;
    }
    return true;
  }
  const roles = new Set(["user", "assistant", "system", "tool"]);
  const userHeading = (n) =>
    n?.matches("h4.sr-only") &&
    /^(你说|您说|You said)\s*[:：]?$/i.test(n.textContent.trim());
  function messageRole(n) {
    if (n.matches("user-query")) return "user";
    if (n.matches("model-response")) return "assistant";
    const marker = n.matches(
      "[data-message-author-role],[data-conversation-role]",
    )
      ? n
      : [...n.children].find((c) => c.matches("h4[data-conversation-role]"));
    const role =
      marker?.getAttribute("data-message-author-role") ||
      marker?.getAttribute("data-conversation-role");
    if (roles.has(role)) return role;
    if (n.closest("[data-turn-key]") && [...n.children].some(userHeading))
      return "user";
    return undefined;
  }
  function messages(d) {
    if (provider(d) === "gemini")
      return [...d.querySelectorAll("user-query,model-response")].filter(
        visibleGeminiNode,
      );
    const markers = [
      ...d.querySelectorAll(
        "[data-message-author-role],[data-conversation-role]",
      ),
      ...[...d.querySelectorAll("[data-turn-key] h4.sr-only")].filter(
        userHeading,
      ),
    ];
    const candidates = [
      ...new Set(
        markers.map(
          (n) =>
            n.closest("[data-message-author-role]") ||
            (n.tagName === "H4" ? n.parentElement : n),
        ),
      ),
    ].filter(
      (n) =>
        n &&
        messageRole(n) &&
        !n.closest('#cpq-root,[hidden],[aria-hidden="true"],[inert]'),
    );
    return candidates
      .filter(
        (n) => !candidates.some((other) => other !== n && other.contains(n)),
      )
      .sort((a, b) => (a.compareDocumentPosition(b) & 2 ? 1 : -1));
  }
  const assistants = (d) =>
    messages(d).filter((n) => messageRole(n) === "assistant");
  const src = (img) => img.currentSrc || img.src || "";
  function responseImages(n) {
    const selector =
      provider(n.ownerDocument) === "gemini"
        ? "generated-image img,generated-image-card img"
        : "img";
    return [...n.querySelectorAll(selector)].filter((i) =>
      provider(n.ownerDocument) === "gemini"
        ? visibleGeminiNode(i)
        : !i.closest('#cpq-root,[hidden],[aria-hidden="true"],[inert]'),
    );
  }
  function markdown(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
    if (
      tag === "h4" &&
      (node.hasAttribute("data-conversation-role") ||
        (userHeading(node) && node.closest("[data-turn-key]")))
    )
      return "";
    if (["button", "script", "style", "svg", "noscript"].includes(tag))
      return "";
    const inside = () => [...node.childNodes].map(markdown).join("");
    if (tag === "pre") {
      const code = node.querySelector("code") || node,
        lang = (code.className || "").match(/language-([\w+-]+)/)?.[1] || "";
      const text = code.textContent;
      const fence = "`".repeat(
        Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      return "\n\n" + fence + lang + "\n" + text + "\n" + fence + "\n\n";
    }
    if (tag === "img") return "";
    if (tag === "br") return "\n";
    if (tag === "a") {
      const href = C.safePublicURL(node.getAttribute("href"));
      return href ? "[" + inside() + "](" + href + ")" : inside();
    }
    if (tag === "strong" || tag === "b") return "**" + inside() + "**";
    if (tag === "em" || tag === "i") return "*" + inside() + "*";
    if (tag === "code") return "`" + inside().replace(/`/g, "\\`") + "`";
    if (tag === "li") return "\n- " + inside().trim();
    if (tag === "tr")
      return (
        "| " +
        [...node.children].map((n) => markdown(n).trim()).join(" | ") +
        " |\n"
      );
    if (/^h[1-6]$/.test(tag))
      return "\n\n" + "#".repeat(Number(tag[1])) + " " + inside() + "\n\n";
    return ["p", "div", "ul", "ol", "blockquote", "table"].includes(tag)
      ? "\n" + inside() + "\n"
      : inside();
  }
  function snapshot(d) {
    // Remember hidden historical responses too: becoming visible is not a new turn.
    const nodes =
      provider(d) === "gemini"
        ? [...d.querySelectorAll("model-response")].filter(
            (n) => !n.closest("#cpq-root"),
          )
        : assistants(d);
    return {
      nodes: new Map(nodes.map((n) => [n, n.textContent])),
      images: new Set(assistants(d).flatMap((n) => responseImages(n).map(src))),
    };
  }
  function responseSince(d, before) {
    const fresh = assistants(d).filter(
      (n) =>
        !before.nodes.has(n) ||
        (provider(d) !== "gemini" &&
          (before.nodes.get(n) !== n.textContent ||
            responseImages(n).some((i) => !before.images.has(src(i))))),
    );
    const candidates = fresh
      .flatMap(responseImages)
      .filter(
        (i) => !before.images.has(src(i)) && C.isImageURL(src(i), provider(d)),
      );
    const images = candidates.filter(
      (i) => i.complete && i.naturalWidth >= 180 && i.naturalHeight >= 180,
    );
    const pendingImages = candidates.filter((i) => !i.complete);
    const failedImages = candidates.filter(
      (i) => i.complete && (!i.naturalWidth || !i.naturalHeight),
    );
    const busy =
      fresh.some((n) => {
        if (provider(d) === "gemini")
          return (
            n.matches('[aria-busy="true"]') ||
            !!n.querySelector('[aria-busy="true"],[role="progressbar"]')
          );
        const turn = n.closest("[data-talvt-turn-state]");
        return (
          turn && turn.getAttribute("data-talvt-turn-state") !== "complete"
        );
      }) ||
      !!d.querySelector(
        provider(d) === "gemini"
          ? 'button.stop-button,button[aria-label="Stop response"],button[aria-label="停止回答"],button[aria-label="停止回应"]'
          : 'button[data-testid="stop-button"],button[aria-label*="Stop streaming"],button[aria-label*="停止生成"],[data-is-streaming="true"]',
      );
    return {
      nodes: fresh,
      images,
      pendingImages,
      failedImages,
      text: fresh.map((n) => markdown(n).trim()).join("\n\n"),
      busy,
    };
  }
  function captureConversation(d) {
    const name = provider(d) === "gemini" ? "Gemini" : "ChatGPT";
    return {
      id:
        d.location.pathname.match(/\/c\/([^/]+)/)?.[1] ||
        d.location.pathname.match(/\/app\/([^/]+)/)?.[1] ||
        "local-" + crypto.randomUUID(),
      title:
        d.title.replace(/\s*[-–]\s*(ChatGPT|Gemini)$/, "") || name + " 会话",
      url: C.safePublicURL(d.location.href),
      messages: messages(d)
        .map((n) => {
          const m = markdown(n)
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          return {
            role: messageRole(n),
            text: m,
            markdown: m,
            assetIds: [],
          };
        })
        .filter((m) =>
          ["user", "assistant", "system", "tool"].includes(m.role),
        ),
    };
  }
  async function imageData(img) {
    const url = src(img);
    if (!C.isImageURL(url, provider(img.ownerDocument)))
      throw new Error("图片来源不在许可范围内");
    if (url.startsWith("data:")) {
      C.parseImageDataURL(url);
      return url;
    }
    const response = await fetch(url, {
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error("图片读取失败：HTTP " + response.status);
    const blob = await response.blob();
    if (blob.size > C.MAX_IMAGE_BYTES) throw new Error("图片超过 20 MiB");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dataUrl = C.toDataURL(bytes, C.imageMime(bytes));
    C.parseImageDataURL(dataUrl);
    return dataUrl;
  }
  async function fileAsset(file) {
    if (file.size > C.MAX_IMAGE_BYTES) throw new Error("参考图超过 20 MiB");
    const bytes = new Uint8Array(await file.arrayBuffer()),
      mime = C.imageMime(bytes);
    if (file.type && file.type !== mime)
      throw new Error("参考图格式与内容不一致");
    const blob = new Blob([bytes], { type: mime });
    const bitmap = await createImageBitmap(blob);
    if (!bitmap.width || !bitmap.height) throw new Error("参考图无法解码");
    bitmap.close();
    return {
      name: file.name,
      dataUrl: C.toDataURL(bytes, mime),
      role: "reference",
    };
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function attachReferences(d, assets, check = () => {}) {
    if (!assets.length) return;
    const inputs = [...d.querySelectorAll("input[type=file]")].filter(
      (n) => !n.closest("#cpq-root") && !n.closest("aside"),
    );
    const compatible = inputs.filter(
      (n) =>
        (assets.length === 1 || n.multiple) &&
        (/image/.test(n.accept) || !n.accept || n.accept.includes(".png")),
    );
    const input =
      compatible.find(
        (n) => /image/.test(n.accept) && !n.hasAttribute("capture"),
      ) ||
      compatible.find((n) => !n.hasAttribute("capture")) ||
      compatible[0];
    if (!input) throw new Error("找不到附件上传控件，请先展开附件功能");
    const form =
      (provider(d) === "gemini" &&
        composer(d)?.closest(
          "input-area-v2,input-area,.input-area-container",
        )) ||
      input.closest("form") ||
      d.querySelector("#prompt-textarea")?.closest("form") ||
      d.body;
    const existing = form.querySelectorAll(
      '[data-testid*="attachment"],button[aria-label*="Remove file"],button[aria-label*="移除文件"],button[aria-label*="Remove attachment"],button[aria-label*="移除附件"],button[aria-label*="移除图片"],button[aria-label*="Remove image"]',
    ).length;
    if (existing)
      throw new Error("输入区已有附件，请先核对并清空后再运行参考图任务");
    const dt = new DataTransfer();
    for (const a of assets) {
      const p = C.parseImageDataURL(a.dataUrl);
      dt.items.add(
        new File([p.bytes], a.name + "." + p.mime.split("/")[1], {
          type: p.mime,
        }),
      );
    }
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      check();
      const previews = form.querySelectorAll(
        '[data-testid*="attachment"],button[aria-label*="Remove file"],button[aria-label*="移除文件"],button[aria-label*="Remove attachment"],button[aria-label*="移除附件"],button[aria-label*="移除图片"],button[aria-label*="Remove image"]',
      );
      const loading = form.querySelector(
        '[role="progressbar"],[data-testid*="uploading"]',
      );
      if (previews.length >= assets.length && !loading) {
        await sleep(500);
        return;
      }
      await sleep(250);
    }
    throw new Error("参考图上传未得到就绪回执，已阻止发送");
  }
  function composer(d) {
    return [
      ...d.querySelectorAll(
        provider(d) === "gemini"
          ? 'rich-textarea [contenteditable="true"][role="textbox"],.ql-editor[contenteditable="true"][role="textbox"]'
          : '#prompt-textarea,textarea[data-id],textarea,[contenteditable="true"][role="textbox"]',
      ),
    ].find((n) => !n.closest("#cpq-root") && n.getClientRects().length);
  }
  function setComposer(n, text) {
    n.focus();
    if (n.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(
        n.ownerDocument.defaultView.HTMLTextAreaElement.prototype,
        "value",
      ).set.call(n, text);
    } else {
      n.textContent = text;
    }
    n.dispatchEvent(new Event("input", { bubbles: true }));
    n.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function sendButton(d) {
    const candidates = [
      ...d.querySelectorAll(
        provider(d) === "gemini"
          ? 'button.send-button,button[aria-label="Send message"],button[aria-label="发送消息"],button[aria-label="发送"],button[aria-label="Submit"],button[aria-label="提交"]'
          : 'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="发送提示"],button[aria-label="发送消息"],button[aria-label="发送"]',
      ),
    ].filter(
      (n) =>
        !n.closest("#cpq-root") &&
        !n.disabled &&
        n.getAttribute("aria-disabled") !== "true" &&
        n.getClientRects().length,
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  return {
    domSchema: "role-headings-20261021",
    provider,
    snapshot,
    responseSince,
    captureConversation,
    markdown,
    imageData,
    fileAsset,
    attachReferences,
    composer,
    setComposer,
    sendButton,
    messages,
  };
});
