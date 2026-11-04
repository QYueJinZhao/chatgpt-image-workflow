(function (root, factory) {
  const api = factory(
    root.CPQCore || (typeof require === "function" && require("./core.js")),
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQArchive = api;
})(globalThis, function (C) {
  "use strict";
  const enc = new TextEncoder(),
    dec = new TextDecoder();
  const bytes = (x) =>
    typeof x === "string" ? enc.encode(x) : new Uint8Array(x);
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }
  function crc32(data) {
    let c = 0xffffffff;
    for (const b of data) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function path(name) {
    if (
      typeof name !== "string" ||
      !name ||
      name.includes("\\") ||
      name.includes("\0") ||
      /^[/:]/.test(name) ||
      name
        .split("/")
        .some((p) => !p || p === "." || p === ".." || p.includes(":"))
    )
      throw new Error("ZIP 路径无效");
    return name;
  }
  function header(n) {
    const b = new Uint8Array(n);
    return { b, v: new DataView(b.buffer) };
  }
  function zip(entries) {
    if (entries.length > 10000) throw new Error("ZIP 文件过多");
    const local = [],
      central = [],
      seen = new Set();
    let offset = 0;
    for (const entry of entries) {
      const name = enc.encode(path(entry.name)),
        data = bytes(entry.data),
        crc = crc32(data);
      if (seen.has(entry.name) || name.length > 65535)
        throw new Error("ZIP 路径重复或过长");
      seen.add(entry.name);
      const h = header(30);
      h.v.setUint32(0, 0x04034b50, true);
      h.v.setUint16(4, 20, true);
      h.v.setUint16(6, 0x800, true);
      h.v.setUint32(14, crc, true);
      h.v.setUint32(18, data.length, true);
      h.v.setUint32(22, data.length, true);
      h.v.setUint16(26, name.length, true);
      local.push(h.b, name, data);
      const c = header(46);
      c.v.setUint32(0, 0x02014b50, true);
      c.v.setUint16(4, 20, true);
      c.v.setUint16(6, 20, true);
      c.v.setUint16(8, 0x800, true);
      c.v.setUint32(16, crc, true);
      c.v.setUint32(20, data.length, true);
      c.v.setUint32(24, data.length, true);
      c.v.setUint16(28, name.length, true);
      c.v.setUint32(42, offset, true);
      central.push(c.b, name);
      offset += 30 + name.length + data.length;
      if (offset > 300 * 1024 * 1024)
        throw new Error("ZIP 超过 300 MiB，请分批导出");
    }
    const cd = concat(central),
      end = header(22);
    end.v.setUint32(0, 0x06054b50, true);
    end.v.setUint16(8, entries.length, true);
    end.v.setUint16(10, entries.length, true);
    end.v.setUint32(12, cd.length, true);
    end.v.setUint32(16, offset, true);
    return concat([...local, cd, end.b]);
  }
  function unzip(input) {
    const data = bytes(input);
    if (data.length > 300 * 1024 * 1024) throw new Error("ZIP 过大");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength),
      out = Object.create(null);
    let p = 0,
      total = 0;
    while (p + 4 <= data.length && v.getUint32(p, true) === 0x04034b50) {
      if (p + 30 > data.length) throw new Error("ZIP 不完整");
      const flags = v.getUint16(p + 6, true),
        method = v.getUint16(p + 8, true),
        crc = v.getUint32(p + 14, true),
        size = v.getUint32(p + 18, true),
        raw = v.getUint32(p + 22, true),
        nl = v.getUint16(p + 26, true),
        xl = v.getUint16(p + 28, true),
        start = p + 30 + nl + xl,
        end = start + size;
      if ((flags & ~0x800) !== 0 || method !== 0 || raw !== size)
        throw new Error("只支持本工作台导出的未压缩 ZIP");
      if (end > data.length) throw new Error("ZIP 不完整");
      const name = path(dec.decode(data.subarray(p + 30, p + 30 + nl)));
      if (Object.hasOwn(out, name)) throw new Error("ZIP 路径重复");
      const body = data.slice(start, end);
      if (crc32(body) !== crc) throw new Error("ZIP 内容校验失败");
      out[name] = body;
      p = end;
      total += raw;
      if (total > 250 * 1024 * 1024 || Object.keys(out).length > 10000)
        throw new Error("ZIP 内容过大");
    }
    if (
      !Object.keys(out).length ||
      p + 4 > data.length ||
      v.getUint32(p, true) !== 0x02014b50
    )
      throw new Error("ZIP 结构无效");
    return out;
  }
  function conversation(chat, format = "md", assetPaths = {}) {
    const messages = chat.messages || [],
      title = String(chat.title || "会话");
    if (format === "json") return JSON.stringify(chat, null, 2);
    if (format === "html")
      return (
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>' +
        C.escapeHTML(title) +
        "</title><style>body{max-width:900px;margin:40px auto;padding:16px;font:16px/1.6 system-ui;color:#172b32}pre{white-space:pre-wrap;background:#f1f5f5;padding:16px}img{max-width:100%}article{margin:32px 0}</style><h1>" +
        C.escapeHTML(title) +
        "</h1>" +
        messages
          .map(
            (m) =>
              "<article><h2>" +
              C.escapeHTML(m.role) +
              "</h2><pre>" +
              C.escapeHTML(m.markdown || m.text) +
              "</pre>" +
              (m.assetIds || [])
                .map((id) =>
                  assetPaths[id]?.startsWith("data:image/")
                    ? '<img alt="会话图片" src="' +
                      C.escapeHTML(assetPaths[id]) +
                      '">'
                    : "",
                )
                .join("") +
              "</article>",
          )
          .join("") +
        "</html>"
      );
    return (
      (format === "txt" ? title : "# " + title) +
      "\n\n" +
      messages
        .map(
          (m) =>
            (format === "txt" ? "[" + m.role + "]" : "## " + m.role) +
            "\n\n" +
            (format === "txt" ? m.text : m.markdown || m.text) +
            "\n" +
            (m.assetIds || [])
              .map((id) =>
                format === "txt"
                  ? "[图片 " + id + "]"
                  : "![图片](" +
                    (assetPaths[id] || "images/" + id + ".png") +
                    ")",
              )
              .join("\n"),
        )
        .join("\n\n")
    );
  }
  function workspaceZip(bundle) {
    const entries = [
        { name: "workspace.json", data: JSON.stringify(bundle, null, 2) },
      ],
      paths = {};
    for (const a of bundle.assets) {
      const p =
        "images/" + a.id + "." + a.mime.split("/")[1].replace("jpeg", "jpg");
      paths[a.id] = "../../" + p;
      entries.push({ name: p, data: C.parseImageDataURL(a.dataUrl).bytes });
    }
    for (const c of bundle.conversations) {
      const prefix =
        "conversations/" +
        C.sanitizePart(c.title) +
        "-" +
        C.sanitizePart(c.id).slice(0, 16) +
        "/";
      for (const f of ["md", "txt", "json"])
        entries.push({
          name: prefix + "conversation." + f,
          data: conversation(c, f, paths),
        });
    }
    return zip(entries);
  }
  function jpegPDF(pages) {
    if (!pages.length) throw new Error("没有可导出的 PDF 页面");
    const objects = [];
    const add = (value) => {
      objects.push(bytes(value));
      return objects.length;
    };
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add("");
    const refs = [];
    for (const page of pages) {
      const imageId = objects.length + 1;
      const head = enc.encode(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      );
      add(concat([head, bytes(page.bytes), enc.encode("\nendstream")]));
      const content = `q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n`,
        contentId = add(
          `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`,
        );
      refs.push(
        add(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objects[1] = enc.encode(
      `<< /Type /Pages /Count ${refs.length} /Kids [${refs.map((i) => i + " 0 R").join(" ")}] >>`,
    );
    const parts = [enc.encode("%PDF-1.4\n% binary\n")],
      offsets = [0];
    let offset = parts[0].length;
    objects.forEach((o, i) => {
      offsets.push(offset);
      const p = concat([
        enc.encode(`${i + 1} 0 obj\n`),
        o,
        enc.encode("\nendobj\n"),
      ]);
      parts.push(p);
      offset += p.length;
    });
    const xref = offset,
      table =
        "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((x) => String(x).padStart(10, "0") + " 00000 n \n")
          .join("");
    parts.push(
      enc.encode(
        table +
          `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      ),
    );
    return concat(parts);
  }
  async function conversationPDF(chat, assets = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = 1190;
    canvas.height = 1684;
    const ctx = canvas.getContext("2d"),
      pages = [];
    let y;
    const reset = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1190, 1684);
      ctx.fillStyle = "#172b32";
      ctx.font = "26px system-ui";
      y = 72;
    };
    async function flush() {
      const blob = await new Promise((r) =>
        canvas.toBlob(r, "image/jpeg", 0.9),
      );
      pages.push({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: 1190,
        height: 1684,
      });
      if (pages.length > 100) throw new Error("PDF 超过 100 页，请分批");
      reset();
    }
    reset();
    for (const line of (
      chat.title +
      "\n\n" +
      (chat.messages || [])
        .map((m) => "[" + m.role + "]\n" + (m.markdown || m.text))
        .join("\n\n")
    ).split("\n")) {
      let row = "";
      for (const ch of line) {
        if (ctx.measureText(row + ch).width > 1046) {
          if (y > 1590) await flush();
          ctx.fillText(row, 72, y);
          y += 38;
          row = "";
        }
        row += ch;
      }
      if (y > 1590) await flush();
      ctx.fillText(row, 72, y);
      y += 38;
    }
    for (const id of [
      ...new Set((chat.messages || []).flatMap((m) => m.assetIds || [])),
    ])
      if (assets[id]) {
        const img = new Image();
        img.src = assets[id];
        await img.decode();
        const w = Math.min(1046, img.width),
          h = (img.height * w) / img.width,
          scale = Math.min(1, 1400 / h);
        if (y + h * scale > 1590) await flush();
        ctx.drawImage(img, 72, y, w * scale, h * scale);
        y += h * scale + 24;
      }
    await flush();
    return jpegPDF(pages);
  }
  return {
    zip,
    unzip,
    crc32,
    conversation,
    workspaceZip,
    jpegPDF,
    conversationPDF,
  };
});
