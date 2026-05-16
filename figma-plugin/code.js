const defaultWsUrl = "ws://127.0.0.1:8787";

const uiHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        margin: 12px;
        color: #111;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      input {
        flex: 1;
        padding: 8px 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 12px;
      }
      button {
        padding: 8px 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        background: #fff;
        font-size: 12px;
        cursor: pointer;
      }
      button.primary {
        background: #111;
        border-color: #111;
        color: #fff;
      }
      .status {
        font-size: 12px;
        padding: 6px 8px;
        border: 1px solid #eee;
        border-radius: 6px;
        background: #fafafa;
      }
      pre {
        font-size: 11px;
        line-height: 1.3;
        padding: 8px;
        border-radius: 6px;
        border: 1px solid #eee;
        background: #fafafa;
        overflow: auto;
        max-height: 130px;
      }
    </style>
  </head>
  <body>
    <div class="row">
      <input id="wsUrl" />
      <input id="channel" placeholder="Channel" />
    </div>
    <div class="row">
      <button id="connect" class="primary">Connect</button>
      <button id="disconnect">Disconnect</button>
    </div>
    <div class="row">
      <div id="status" class="status">Disconnected</div>
    </div>
    <pre id="log"></pre>
    <script>
      const wsUrlInput = document.getElementById("wsUrl");
      const channelInput = document.getElementById("channel");
      const connectBtn = document.getElementById("connect");
      const disconnectBtn = document.getElementById("disconnect");
      const statusEl = document.getElementById("status");
      const logEl = document.getElementById("log");

      wsUrlInput.value = "${defaultWsUrl}";
      channelInput.value = "default";

      let ws = null;
      const pending = new Map();
      let manualDisconnect = false;
      let reconnectDelayMs = 800;
      let reconnectTimer = null;

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function log(data) {
        const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        logEl.textContent = text;
      }

      function safeJsonParse(str) {
        try { return JSON.parse(str); } catch (err) { return null; }
      }

      function connect() {
        const url = wsUrlInput.value.trim();
        const channel = channelInput.value.trim() || "default";
        if (!url) return;
        manualDisconnect = false;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        if (ws) ws.close();
        setStatus("Connecting...");
        ws = new WebSocket(url);

        ws.onopen = () => {
          setStatus("Connected");
          reconnectDelayMs = 800;
          try {
            ws.send(JSON.stringify({ type: "join", channel }));
          } catch (err) {}
          log({ connectedTo: url, channel });
        };

        ws.onclose = () => {
          if (manualDisconnect) {
            setStatus("Disconnected");
          } else {
            setStatus("Reconnecting...");
            const nextDelay = reconnectDelayMs;
            reconnectDelayMs = Math.min(5000, reconnectDelayMs * 2);
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              connect();
            }, nextDelay);
          }
          ws = null;
        };

        ws.onerror = () => {
          setStatus("Error");
        };

        ws.onmessage = (event) => {
          const msg = safeJsonParse(String(event.data));
          if (!msg || msg.type !== "command" || typeof msg.id !== "string") return;
          pending.set(msg.id, true);
          parent.postMessage({ pluginMessage: { type: "exec", id: msg.id, action: msg.action, payload: msg.payload } }, "*");
        };
      }

      function disconnect() {
        if (!ws) return;
        manualDisconnect = true;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        ws.close();
      }

      window.onmessage = (event) => {
        const msg = event.data && event.data.pluginMessage;
        if (!msg || msg.type !== "result" || typeof msg.id !== "string") return;
        if (!pending.has(msg.id)) return;
        pending.delete(msg.id);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "result", id: msg.id, ok: msg.ok, result: msg.result, error: msg.error }));
        }
        log(msg);
      };

      connectBtn.onclick = connect;
      disconnectBtn.onclick = disconnect;
      connect();
    </script>
  </body>
</html>`;

figma.showUI(uiHtml, { width: 420, height: 250 });

let activeTheme = null;

function normalizeHex(hex) {
  const h = String(hex || "").trim().toLowerCase();
  if (!h) return "";
  if (h[0] === "#") return h;
  return "#" + h;
}

async function setFillStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setFillStyleIdAsync === "function") {
    await node.setFillStyleIdAsync(styleId);
    return;
  }
  if ("fillStyleId" in node) node.fillStyleId = styleId;
}

async function setEffectStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setEffectStyleIdAsync === "function") {
    await node.setEffectStyleIdAsync(styleId);
    return;
  }
  if ("effectStyleId" in node) node.effectStyleId = styleId;
}

async function setTextStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setTextStyleIdAsync === "function") {
    await node.setTextStyleIdAsync(styleId);
    return;
  }
  if ("textStyleId" in node) node.textStyleId = styleId;
}

async function getLocalPaintStyles() {
  if (typeof figma.getLocalPaintStylesAsync === "function") return await figma.getLocalPaintStylesAsync();
  if (typeof figma.getLocalPaintStyles === "function") return figma.getLocalPaintStyles();
  return [];
}

async function getLocalTextStyles() {
  if (typeof figma.getLocalTextStylesAsync === "function") return await figma.getLocalTextStylesAsync();
  if (typeof figma.getLocalTextStyles === "function") return figma.getLocalTextStyles();
  return [];
}

async function getLocalEffectStyles() {
  if (typeof figma.getLocalEffectStylesAsync === "function") return await figma.getLocalEffectStylesAsync();
  if (typeof figma.getLocalEffectStyles === "function") return figma.getLocalEffectStyles();
  return [];
}

async function getLocalGridStyles() {
  if (typeof figma.getLocalGridStylesAsync === "function") return await figma.getLocalGridStylesAsync();
  if (typeof figma.getLocalGridStyles === "function") return figma.getLocalGridStyles();
  return [];
}

function rgb01ToHex(rgb) {
  const r = Math.max(0, Math.min(255, Math.round(Number(rgb.r) * 255)));
  const g = Math.max(0, Math.min(255, Math.round(Number(rgb.g) * 255)));
  const b = Math.max(0, Math.min(255, Math.round(Number(rgb.b) * 255)));
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

function paintToHex(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  return rgb01ToHex(paint.color);
}

function firstSolidPaint(paints) {
  const arr = Array.isArray(paints) ? paints : [];
  for (let i = 0; i < arr.length; i += 1) {
    const p = arr[i];
    if (!p || p.type !== "SOLID") continue;
    if (p.visible === false) continue;
    return p;
  }
  return null;
}

function paintStyleToHex(style) {
  const p = firstSolidPaint(style && style.paints);
  return p ? paintToHex(p) : null;
}

function createDefaultTheme() {
  return {
    roles: {
      surface: { hex: "#FFFFFF", fillStyleId: null },
      muted: { hex: "#F3F4F6", fillStyleId: null },
      border: { hex: "#E5E7EB", strokeStyleId: null },
      text: { hex: "#111827", fillStyleId: null },
      textMuted: { hex: "#374151", fillStyleId: null },
      textSubtle: { hex: "#6B7280", fillStyleId: null },
      primary: { hex: "#2563EB", fillStyleId: null },
      accent: { hex: "#F59E0B", fillStyleId: null },
      danger: { hex: "#DC2626", fillStyleId: null },
      warning: { hex: "#D97706", fillStyleId: null }
    },
    typography: {
      headingTextStyleId: null,
      bodyTextStyleId: null,
      monoTextStyleId: null,
      headingFontName: { family: "Inter", style: "Semi Bold" },
      bodyFontName: { family: "Inter", style: "Regular" },
      monoFontName: { family: "IBM Plex Mono", style: "Regular" }
    }
  };
}

const legacyHexToRole = new Map([
  ["#fbf7ee", "surface"],
  ["#f5edd8", "muted"],
  ["#d4c9b8", "border"],
  ["#a8987e", "border"],
  ["#cc2020", "primary"],
  ["#a81a1a", "primary"],
  ["#f4c417", "accent"],
  ["#1a1a1a", "text"],
  ["#3a3530", "text"],
  ["#6b5e52", "textMuted"],
  ["#a89882", "textSubtle"],
  ["#c0392b", "danger"],
  ["#e07a2a", "warning"]
]);

function resolveHexWithTheme(hex) {
  const normalized = normalizeHex(hex);
  const role = legacyHexToRole.get(normalized);
  if (!role || !activeTheme || !activeTheme.roles || !activeTheme.roles[role]) return normalized;
  const themed = activeTheme.roles[role].hex;
  return themed ? normalizeHex(themed) : normalized;
}

function findTextStyleByPatterns(textStyles, patterns) {
  const styles = Array.isArray(textStyles) ? textStyles : [];
  const pats = Array.isArray(patterns) ? patterns : [patterns];
  for (let p = 0; p < pats.length; p += 1) {
    const re = pats[p];
    for (let i = 0; i < styles.length; i += 1) {
      const s = styles[i];
      if (!s || !s.name) continue;
      if (!re.test(String(s.name))) continue;
      return s;
    }
  }
  return null;
}

function pickMostCommonFontFromPage() {
  const nodes = figma.currentPage.findAll((n) => n && n.type === "TEXT");
  const counts = new Map();
  for (let i = 0; i < nodes.length && i < 200; i += 1) {
    const n = nodes[i];
    const fn = n.fontName;
    if (!fn || fn === figma.mixed) continue;
    const fam = String(fn.family);
    const sty = String(fn.style);
    const key = fam + "\u0000" + sty;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null;
  let bestCount = 0;
  for (const [k, c] of counts.entries()) {
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }
  if (!bestKey) return null;
  const [family, style] = bestKey.split("\u0000");
  return { family, style };
}

function hexToRgb255(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  if (raw.length !== 6) return null;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) return null;
  return { r, g, b };
}

function isGrayishHex(hex) {
  const rgb = hexToRgb255(hex);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max - min <= 18;
}

function pickTopKeyByNumber(map) {
  let bestKey = null;
  let bestVal = -Infinity;
  for (const [k, v] of map.entries()) {
    const n = Number(v);
    if (n > bestVal) {
      bestKey = k;
      bestVal = n;
    }
  }
  return bestKey;
}

function sampleThemeFromCurrentPage() {
  const nodes = figma.currentPage.findAll(
    (n) => n && (n.type === "TEXT" || "fills" in n || "strokes" in n)
  );
  const fillAreaByHex = new Map();
  const fillCountByHex = new Map();
  const strokeCountByHex = new Map();
  const textCountByHex = new Map();

  for (let i = 0; i < nodes.length && i < 400; i += 1) {
    const n = nodes[i];
    if (!n) continue;

    if ("fills" in n) {
      const fp = firstSolidPaint(n.fills);
      const hex = fp ? paintToHex(fp) : null;
      if (hex) {
        const w = "width" in n ? Number(n.width) : 1;
        const h = "height" in n ? Number(n.height) : 1;
        const area = Number.isFinite(w) && Number.isFinite(h) ? Math.max(1, w * h) : 1;
        fillAreaByHex.set(hex, (fillAreaByHex.get(hex) || 0) + area);
        fillCountByHex.set(hex, (fillCountByHex.get(hex) || 0) + 1);
      }
    }

    if ("strokes" in n) {
      const sp = firstSolidPaint(n.strokes);
      const hex = sp ? paintToHex(sp) : null;
      if (hex) strokeCountByHex.set(hex, (strokeCountByHex.get(hex) || 0) + 1);
    }

    if (n.type === "TEXT") {
      const tp = firstSolidPaint(n.fills);
      const hex = tp ? paintToHex(tp) : null;
      if (hex) textCountByHex.set(hex, (textCountByHex.get(hex) || 0) + 1);
    }
  }

  const surface = pickTopKeyByNumber(fillAreaByHex);
  const text = pickTopKeyByNumber(textCountByHex);
  const border = pickTopKeyByNumber(strokeCountByHex);

  const nonGrayFills = new Map();
  for (const [hex, count] of fillCountByHex.entries()) {
    if (!isGrayishHex(hex)) nonGrayFills.set(hex, count);
  }
  let primary = pickTopKeyByNumber(nonGrayFills);
  if (primary && surface && normalizeHex(primary) === normalizeHex(surface)) primary = null;

  return {
    surface,
    text,
    border,
    primary
  };
}

async function buildThemeFromDocument() {
  const theme = createDefaultTheme();

  const paintStyles = await getLocalPaintStyles();
  const textStyles = await getLocalTextStyles();

  function applyPaintRole(role, patterns, styleIdField) {
    const pats = Array.isArray(patterns) ? patterns : [patterns];
    for (let p = 0; p < pats.length; p += 1) {
      const re = pats[p];
      for (let i = 0; i < paintStyles.length; i += 1) {
        const s = paintStyles[i];
        if (!s || !s.name) continue;
        if (!re.test(String(s.name))) continue;
        const hex = paintStyleToHex(s);
        if (!hex) continue;
        theme.roles[role] = theme.roles[role] || {};
        theme.roles[role].hex = hex;
        theme.roles[role][styleIdField] = s.id;
        return;
      }
    }
  }

  applyPaintRole("surface", [/(^|\/|\s)(surface|background|bg)(\/|$|\s)/i, /canvas/i], "fillStyleId");
  applyPaintRole("muted", [/(^|\/|\s)(muted|subtle|secondary)(\/|$|\s)/i], "fillStyleId");
  applyPaintRole("border", [/(^|\/|\s)(border|stroke|outline)(\/|$|\s)/i], "strokeStyleId");
  applyPaintRole("primary", [/(^|\/|\s)(primary|brand)(\/|$|\s)/i, /accent/i], "fillStyleId");
  applyPaintRole("accent", [/(^|\/|\s)(accent|highlight)(\/|$|\s)/i, /(warning|yellow)/i], "fillStyleId");
  applyPaintRole("text", [/(^|\/|\s)(text|foreground|fg)(\/|$|\s)/i, /txt\/900/i], "fillStyleId");
  applyPaintRole("textMuted", [/(^|\/|\s)(muted|secondary|subtle|placeholder)(\/|$|\s)/i, /txt\/500/i, /txt\/300/i], "fillStyleId");
  applyPaintRole("danger", [/(^|\/|\s)(danger|error)(\/|$|\s)/i], "fillStyleId");
  applyPaintRole("warning", [/(^|\/|\s)(warning)(\/|$|\s)/i], "fillStyleId");

  if (!paintStyles.length) {
    const sampled = sampleThemeFromCurrentPage();
    if (sampled.surface) theme.roles.surface.hex = sampled.surface;
    if (sampled.text) theme.roles.text.hex = sampled.text;
    if (sampled.border) theme.roles.border.hex = sampled.border;
    if (sampled.primary) theme.roles.primary.hex = sampled.primary;
  }

  const headingStyle =
    findTextStyleByPatterns(textStyles, [/head/i, /heading/i, /title/i, /h1/i, /display/i]) || textStyles[0] || null;
  const bodyStyle =
    findTextStyleByPatterns(textStyles, [/body/i, /paragraph/i, /text/i]) || textStyles[0] || null;
  const monoStyle =
    findTextStyleByPatterns(textStyles, [/mono/i, /code/i]) || null;

  if (headingStyle) {
    theme.typography.headingTextStyleId = headingStyle.id;
    if (headingStyle.fontName && headingStyle.fontName !== figma.mixed) {
      theme.typography.headingFontName = { family: String(headingStyle.fontName.family), style: String(headingStyle.fontName.style) };
    }
  }
  if (bodyStyle) {
    theme.typography.bodyTextStyleId = bodyStyle.id;
    if (bodyStyle.fontName && bodyStyle.fontName !== figma.mixed) {
      theme.typography.bodyFontName = { family: String(bodyStyle.fontName.family), style: String(bodyStyle.fontName.style) };
    }
  } else {
    const pageFont = pickMostCommonFontFromPage();
    if (pageFont) theme.typography.bodyFontName = pageFont;
  }
  if (monoStyle) {
    theme.typography.monoTextStyleId = monoStyle.id;
    if (monoStyle.fontName && monoStyle.fontName !== figma.mixed) {
      theme.typography.monoFontName = { family: String(monoStyle.fontName.family), style: String(monoStyle.fontName.style) };
    }
  }

  return theme;
}

function clamp01(n) {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function parseHexToRgb01(hex) {
  const raw = String(hex).trim().replace(/^#/, "");
  if (raw.length !== 6) throw new Error("Invalid hex color");
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) throw new Error("Invalid hex color");
  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255) };
}

function hexToRgb01(hex) {
  return parseHexToRgb01(resolveHexWithTheme(hex));
}

function rgbaToFigmaColor(rgba) {
  const obj = rgba && typeof rgba === "object" ? rgba : {};
  const r = Number(obj.r);
  const g = Number(obj.g);
  const b = Number(obj.b);
  const a = obj.a === undefined || obj.a === null ? 1 : Number(obj.a);
  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
    a: clamp01(a)
  };
}

function upsertPageByName(name) {
  const existing = figma.root.children.find((p) => p.name === name);
  if (existing) return existing;
  const page = figma.createPage();
  page.name = name;
  return page;
}

async function upsertPaintStyle(name, hex) {
  const styles = await getLocalPaintStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createPaintStyle();
  style.name = name;
  style.paints = [{ type: "SOLID", color: hexToRgb01(hex) }];
  return style;
}

async function upsertEffectStyleShadow(name, x, y, blur, colorRgba) {
  const styles = await getLocalEffectStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createEffectStyle();
  style.name = name;
  style.effects = [
    {
      type: "DROP_SHADOW",
      color: rgbaToFigmaColor(colorRgba),
      offset: { x: Number(x), y: Number(y) },
      radius: Number(blur),
      spread: 0,
      visible: true,
      blendMode: "NORMAL"
    }
  ];
  return style;
}

const fontCache = new Map();

async function safeLoadFont(family, style) {
  const fam = String(family);
  const sty = String(style);
  const key = fam + "\u0000" + sty;
  const cached = fontCache.get(key);
  if (cached) return cached;
  try {
    await figma.loadFontAsync({ family: fam, style: sty });
    const fontName = { family: fam, style: sty };
    fontCache.set(key, fontName);
    return fontName;
  } catch (err) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const fontName = { family: "Inter", style: "Regular" };
    fontCache.set(key, fontName);
    return fontName;
  }
}

async function upsertTextStyle(spec) {
  const styles = await getLocalTextStyles();
  const existing = styles.find((s) => s.name === spec.name);
  const style = existing || figma.createTextStyle();
  style.name = spec.name;

  const fontName = await safeLoadFont(spec.fontFamily, spec.fontStyle || "Regular");
  style.fontName = fontName;

  if (spec.fontSize !== undefined) style.fontSize = Number(spec.fontSize);
  if (spec.lineHeight !== undefined) {
    style.lineHeight = { unit: "PIXELS", value: Number(spec.lineHeight) };
  }
  if (spec.letterSpacing !== undefined) {
    style.letterSpacing = { unit: "PERCENT", value: Number(spec.letterSpacing) };
  }
  if (spec.textCase !== undefined) style.textCase = spec.textCase;
  return style;
}

function findPageByName(name) {
  const pages = figma.root.children;
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i].name === name) return pages[i];
  }
  return null;
}

function ensurePage(name) {
  const existing = findPageByName(name);
  if (existing) return existing;
  const page = figma.createPage();
  page.name = name;
  return page;
}

function deletePagesExcept(allowedNames) {
  const pages = figma.root.children.slice();
  for (let i = 0; i < pages.length; i += 1) {
    const p = pages[i];
    if (allowedNames.indexOf(p.name) >= 0) continue;
    try {
      p.remove();
    } catch (err) {}
  }
}

function createHeadingFrame(title, subtitle) {
  const frame = figma.createFrame();
  frame.name = title;
  frame.resize(960, 220);
  frame.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
  frame.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
  frame.strokeWeight = 1;

  const titleNode = figma.createText();
  const subtitleNode = figma.createText();
  frame.appendChild(titleNode);
  frame.appendChild(subtitleNode);

  titleNode.x = 24;
  titleNode.y = 20;
  subtitleNode.x = 24;
  subtitleNode.y = 90;

  return { frame, titleNode, subtitleNode };
}

async function styleHeadingFrame(titleNode, subtitleNode, titleText, subtitleText) {
  const theme = activeTheme || createDefaultTheme();
  const headingFont = theme.typography && theme.typography.headingFontName ? theme.typography.headingFontName : { family: "Inter", style: "Semi Bold" };
  const bodyFont = theme.typography && theme.typography.bodyFontName ? theme.typography.bodyFontName : { family: "Inter", style: "Regular" };
  const headingStyleId = theme.typography ? theme.typography.headingTextStyleId : null;
  const bodyStyleId = theme.typography ? theme.typography.bodyTextStyleId : null;

  try {
    await safeLoadFont(headingFont.family, headingFont.style);
  } catch (err) {}
  try {
    await safeLoadFont(bodyFont.family, bodyFont.style);
  } catch (err) {}

  if (headingStyleId) {
    try {
      await setTextStyleId(titleNode, headingStyleId);
    } catch (err) {
      titleNode.fontName = await safeLoadFont(headingFont.family, headingFont.style);
      titleNode.fontSize = 28;
    }
  } else {
    titleNode.fontName = await safeLoadFont(headingFont.family, headingFont.style);
    titleNode.fontSize = 28;
  }
  titleNode.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];

  if (bodyStyleId) {
    try {
      await setTextStyleId(subtitleNode, bodyStyleId);
    } catch (err) {
      subtitleNode.fontName = await safeLoadFont(bodyFont.family, bodyFont.style);
      subtitleNode.fontSize = 16;
    }
  } else {
    subtitleNode.fontName = await safeLoadFont(bodyFont.family, bodyFont.style);
    subtitleNode.fontSize = 16;
  }
  subtitleNode.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
  if (titleText !== undefined) titleNode.characters = String(titleText);
  if (subtitleText !== undefined) subtitleNode.characters = String(subtitleText);
}

function createComponentPlaceholder(name, x, y) {
  const frame = figma.createFrame();
  frame.name = name;
  frame.resize(320, 240);
  frame.x = x;
  frame.y = y;
  frame.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
  frame.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
  frame.strokeWeight = 1;
  frame.cornerRadius = 8;

  const label = figma.createText();
  label.x = 16;
  label.y = 14;
  frame.appendChild(label);

  return { frame, label };
}

function setSolidPaint(node, hex, opacity) {
  const o = opacity === undefined || opacity === null ? 1 : Number(opacity);
  const normalized = normalizeHex(hex);
  const role = legacyHexToRole.get(normalized);
  const themeRole = role && activeTheme && activeTheme.roles ? activeTheme.roles[role] : null;
  if (themeRole && themeRole.fillStyleId && o === 1 && "fillStyleId" in node) {
    try {
      node.fillStyleId = themeRole.fillStyleId;
      return;
    } catch (err) {}
  }
  if ("fillStyleId" in node) {
    try {
      node.fillStyleId = "";
    } catch (err) {}
  }
  node.fills = [{ type: "SOLID", color: parseHexToRgb01(resolveHexWithTheme(hex)), opacity: clamp01(o) }];
}

function setStrokePaint(node, hex, weight, opacity) {
  const o = opacity === undefined || opacity === null ? 1 : Number(opacity);
  const normalized = normalizeHex(hex);
  const role = legacyHexToRole.get(normalized);
  const themeRole = role && activeTheme && activeTheme.roles ? activeTheme.roles[role] : null;
  if (themeRole && themeRole.strokeStyleId && o === 1 && "strokeStyleId" in node) {
    try {
      node.strokeStyleId = themeRole.strokeStyleId;
    } catch (err) {}
  } else if ("strokeStyleId" in node) {
    try {
      node.strokeStyleId = "";
    } catch (err) {}
  }
  node.strokes = [{ type: "SOLID", color: parseHexToRgb01(resolveHexWithTheme(hex)), opacity: clamp01(o) }];
  node.strokeWeight = Number(weight === undefined || weight === null ? 1 : weight);
}

async function buildTextNode(text, fontName, fontSize, hex, name) {
  const node = figma.createText();
  node.fontName = fontName;
  node.fontSize = Number(fontSize);
  node.fills = [{ type: "SOLID", color: hexToRgb01(hex) }];
  node.characters = text === undefined || text === null ? "" : String(text);
  node.name = name ? String(name) : "Text";
  return node;
}

async function buildComponentPreviewComponent(componentName, fontBody, fontMono) {
  const n = String(componentName).toLowerCase();

  async function makeComponentSet(name, variants) {
    const set = figma.combineAsVariants(variants, figma.currentPage);
    set.name = name;
    set.fills = [];
    set.strokes = [];
    return set;
  }

  if (n === "button") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `Type=Primary, State=${state}`;
      component.resize(280, 56);
      component.cornerRadius = 6;
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.paddingLeft = 16;
      component.paddingRight = 16;
      component.itemSpacing = 8;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Hover") {
        setSolidPaint(component, "#A81A1A", 1);
        component.strokes = [];
      } else {
        setSolidPaint(component, "#CC2020", 1);
        component.strokes = [];
      }

      if (state === "Focus") {
        setStrokePaint(component, "#F4C417", 2, 1);
      }

      const labelColor = state === "Disabled" ? "#6B5E52" : "#FBF7EE";
      const t = await buildTextNode(state === "Loading" ? "Loading…" : "Save", fontBody, 16, labelColor, "Label");
      component.appendChild(t);

      if (state === "Loading") {
        const dot = figma.createEllipse();
        dot.name = "SpinnerDot";
        dot.resize(10, 10);
        setSolidPaint(dot, state === "Disabled" ? "#A89882" : "#F4C417", 1);
        dot.strokes = [];
        component.insertChild(0, dot);
      }

      return component;
    }

    return await makeComponentSet("Button", [
      await variant("Default"),
      await variant("Hover"),
      await variant("Focus"),
      await variant("Disabled"),
      await variant("Loading")
    ]);
  }

  if (n === "text input") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 56);
      component.cornerRadius = 6;
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.paddingLeft = 12;
      component.paddingRight = 12;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const text = await buildTextNode(state === "Error" ? "Invalid value" : "Enter text…", fontBody, 14, "#A89882", "Value");
      if (state === "Disabled") text.fills = [{ type: "SOLID", color: hexToRgb01("#A89882") }];
      component.appendChild(text);
      return component;
    }

    return await makeComponentSet("Text Input", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "textarea") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 120);
      component.cornerRadius = 6;
      component.paddingLeft = 12;
      component.paddingRight = 12;
      component.paddingTop = 12;
      component.paddingBottom = 12;
      component.layoutMode = "VERTICAL";
      component.primaryAxisAlignItems = "MIN";
      component.counterAxisAlignItems = "MIN";
      component.itemSpacing = 8;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const t = await buildTextNode("Enter details…", fontBody, 14, "#A89882", "Value");
      component.appendChild(t);
      return component;
    }

    return await makeComponentSet("Textarea", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "select") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 56);
      component.cornerRadius = 6;
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.paddingLeft = 12;
      component.paddingRight = 12;
      component.itemSpacing = 8;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const label = await buildTextNode("Select an option…", fontBody, 14, "#A89882", "Value");
      component.appendChild(label);

      const chevron = figma.createPolygon();
      chevron.name = "Chevron";
      chevron.pointCount = 3;
      chevron.resize(10, 8);
      setSolidPaint(chevron, "#6B5E52", state === "Disabled" ? 0.5 : 1);
      chevron.strokes = [];
      component.appendChild(chevron);

      return component;
    }

    return await makeComponentSet("Select", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "date input") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 56);
      component.cornerRadius = 6;
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.paddingLeft = 12;
      component.paddingRight = 12;
      component.itemSpacing = 10;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const value = await buildTextNode("DD/MM/YYYY", fontBody, 14, "#A89882", "Value");
      component.appendChild(value);

      const cal = figma.createRectangle();
      cal.name = "CalendarIcon";
      cal.resize(18, 18);
      cal.cornerRadius = 3;
      setSolidPaint(cal, "#F5EDD8", 1);
      setStrokePaint(cal, "#D4C9B8", 1, 1);
      component.appendChild(cal);

      return component;
    }

    return await makeComponentSet("Date Input", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "number input") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 56);
      component.cornerRadius = 6;
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.paddingLeft = 12;
      component.paddingRight = 12;
      component.itemSpacing = 10;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const value = await buildTextNode("0", fontBody, 14, "#1A1A1A", "Value");
      component.appendChild(value);
      return component;
    }

    return await makeComponentSet("Number Input", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "file upload") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 120);
      component.cornerRadius = 8;

      if (state === "Disabled") {
        setSolidPaint(component, "#F5EDD8", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      } else if (state === "Error") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#C0392B", 2, 1);
      } else if (state === "Focus") {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#F4C417", 2, 1);
      } else {
        setSolidPaint(component, "#FBF7EE", 1);
        setStrokePaint(component, "#D4C9B8", 1, 1);
      }

      const title = await buildTextNode("Upload a file", fontBody, 14, "#1A1A1A", "Title");
      title.x = 16;
      title.y = 18;
      component.appendChild(title);
      const hint = await buildTextNode("PDF, JPG, PNG (max 10MB)", fontBody, 12, "#6B5E52", "Hint");
      hint.x = 16;
      hint.y = 44;
      component.appendChild(hint);

      const btn = figma.createRectangle();
      btn.name = "Button";
      btn.resize(120, 32);
      btn.x = 16;
      btn.y = 72;
      btn.cornerRadius = 6;
      setSolidPaint(btn, "#CC2020", state === "Disabled" ? 0.3 : 1);
      btn.strokes = [];
      component.appendChild(btn);

      const btxt = await buildTextNode("Choose file", fontBody, 12, "#FBF7EE", "ButtonLabel");
      btxt.x = 26;
      btxt.y = 80;
      component.appendChild(btxt);

      return component;
    }

    return await makeComponentSet("File Upload", [
      await variant("Default"),
      await variant("Focus"),
      await variant("Error"),
      await variant("Disabled")
    ]);
  }

  if (n === "tag / pill") {
    const component = figma.createComponent();
    component.name = "Tag";
    component.resize(160, 36);
    component.cornerRadius = 9999;
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 12;
    component.paddingRight = 12;
    setSolidPaint(component, "#F5EDD8", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const t = await buildTextNode("Draft", fontMono, 12, "#3A3530", "Label");
    component.appendChild(t);
    return component;
  }

  if (n === "checkbox") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 40);
      component.fills = [];
      component.strokes = [];
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.itemSpacing = 10;

      const iconWrap = figma.createFrame();
      iconWrap.name = "Icon";
      iconWrap.resize(20, 20);
      iconWrap.fills = [];
      iconWrap.strokes = [];

      const box = figma.createRectangle();
      box.resize(20, 20);
      box.cornerRadius = 4;
      setSolidPaint(box, "#FBF7EE", 1);
      setStrokePaint(box, "#D4C9B8", state === "Focus" ? 2 : 1, 1);
      if (state === "Focus") box.strokes = [{ type: "SOLID", color: hexToRgb01("#F4C417") }];
      iconWrap.appendChild(box);

      if (state === "Checked") {
        const inner = figma.createRectangle();
        inner.resize(10, 10);
        inner.x = 5;
        inner.y = 5;
        inner.cornerRadius = 2;
        setSolidPaint(inner, "#CC2020", 1);
        inner.strokes = [];
        iconWrap.appendChild(inner);
      } else if (state === "Indeterminate") {
        const dash = figma.createRectangle();
        dash.resize(12, 3);
        dash.x = 4;
        dash.y = 8.5;
        dash.cornerRadius = 2;
        setSolidPaint(dash, "#CC2020", 1);
        dash.strokes = [];
        iconWrap.appendChild(dash);
      }

      const label = await buildTextNode("Checkbox", fontBody, 14, "#1A1A1A", "Label");
      if (state === "Disabled") {
        label.fills = [{ type: "SOLID", color: hexToRgb01("#A89882") }];
        setSolidPaint(box, "#F5EDD8", 1);
      }
      component.appendChild(iconWrap);
      component.appendChild(label);
      return component;
    }

    return await makeComponentSet("Checkbox", [
      await variant("Unchecked"),
      await variant("Checked"),
      await variant("Indeterminate"),
      await variant("Focus"),
      await variant("Disabled")
    ]);
  }

  if (n === "radio") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 40);
      component.fills = [];
      component.strokes = [];
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.itemSpacing = 10;

      const iconWrap = figma.createFrame();
      iconWrap.name = "Icon";
      iconWrap.resize(20, 20);
      iconWrap.fills = [];
      iconWrap.strokes = [];

      const ring = figma.createEllipse();
      ring.resize(20, 20);
      setSolidPaint(ring, "#FBF7EE", 1);
      setStrokePaint(ring, state === "Focus" ? "#F4C417" : "#D4C9B8", state === "Focus" ? 2 : 1, 1);
      iconWrap.appendChild(ring);

      if (state === "Selected") {
        const dot = figma.createEllipse();
        dot.resize(10, 10);
        dot.x = 5;
        dot.y = 5;
        setSolidPaint(dot, "#CC2020", 1);
        dot.strokes = [];
        iconWrap.appendChild(dot);
      }

      const label = await buildTextNode("Radio", fontBody, 14, "#1A1A1A", "Label");
      if (state === "Disabled") {
        label.fills = [{ type: "SOLID", color: hexToRgb01("#A89882") }];
        setSolidPaint(ring, "#F5EDD8", 1);
      }
      component.appendChild(iconWrap);
      component.appendChild(label);
      return component;
    }

    return await makeComponentSet("Radio", [
      await variant("Unselected"),
      await variant("Selected"),
      await variant("Focus"),
      await variant("Disabled")
    ]);
  }

  if (n === "toggle / switch") {
    async function variant(state) {
      const component = figma.createComponent();
      component.name = `State=${state}`;
      component.resize(280, 40);
      component.fills = [];
      component.strokes = [];
      component.layoutMode = "HORIZONTAL";
      component.primaryAxisAlignItems = "CENTER";
      component.counterAxisAlignItems = "CENTER";
      component.itemSpacing = 10;

      const track = figma.createFrame();
      track.name = "Track";
      track.resize(44, 24);
      track.cornerRadius = 9999;
      track.strokes = [];

      const on = state === "On";
      const disabled = state === "Disabled";

      setSolidPaint(track, on ? "#CC2020" : "#D4C9B8", disabled ? 0.5 : 1);
      if (state === "Focus") setStrokePaint(track, "#F4C417", 2, 1);

      const knob = figma.createEllipse();
      knob.resize(18, 18);
      knob.x = on ? 22 : 4;
      knob.y = 3;
      setSolidPaint(knob, "#FBF7EE", 1);
      knob.strokes = [];
      track.appendChild(knob);

      const t = await buildTextNode(on ? "On" : "Off", fontBody, 14, disabled ? "#A89882" : "#1A1A1A", "Label");
      component.appendChild(track);
      component.appendChild(t);
      return component;
    }

    return await makeComponentSet("Switch", [
      await variant("Off"),
      await variant("On"),
      await variant("Focus"),
      await variant("Disabled")
    ]);
  }

  if (n === "phase banner") {
    const component = figma.createComponent();
    component.name = "Phase Banner";
    component.resize(280, 56);
    component.cornerRadius = 6;
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 12;
    component.paddingRight = 12;
    component.itemSpacing = 10;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const tag = figma.createFrame();
    tag.name = "BETA";
    tag.layoutMode = "HORIZONTAL";
    tag.primaryAxisAlignItems = "CENTER";
    tag.counterAxisAlignItems = "CENTER";
    tag.paddingLeft = 8;
    tag.paddingRight = 8;
    tag.paddingTop = 4;
    tag.paddingBottom = 4;
    tag.cornerRadius = 9999;
    setSolidPaint(tag, "#F4C417", 1);
    tag.strokes = [];
    const tagText = await buildTextNode("BETA", fontMono, 11, "#1A1A1A", "Label");
    tag.appendChild(tagText);

    const body = await buildTextNode("Try this new feature.", fontBody, 14, "#1A1A1A", "Text");
    component.appendChild(tag);
    component.appendChild(body);
    return component;
  }

  if (n === "skip link") {
    const component = figma.createComponent();
    component.name = "Skip Link";
    component.resize(280, 44);
    component.cornerRadius = 6;
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 12;
    component.paddingRight = 12;
    setSolidPaint(component, "#CC2020", 1);
    component.strokes = [];
    const t = await buildTextNode("Skip to content", fontBody, 14, "#FBF7EE", "Label");
    component.appendChild(t);
    return component;
  }

  if (n === "brand stripe") {
    const component = figma.createComponent();
    component.name = "Brand Stripe";
    component.resize(280, 20);
    component.fills = [];
    component.strokes = [];

    const red = figma.createRectangle();
    red.resize(120, 4);
    red.x = 0;
    red.y = 8;
    setSolidPaint(red, "#CC2020", 1);
    red.strokes = [];
    component.appendChild(red);

    const yellow = figma.createRectangle();
    yellow.resize(60, 4);
    yellow.x = 120;
    yellow.y = 8;
    setSolidPaint(yellow, "#F4C417", 1);
    yellow.strokes = [];
    component.appendChild(yellow);

    const black = figma.createRectangle();
    black.resize(100, 4);
    black.x = 180;
    black.y = 8;
    setSolidPaint(black, "#1A1A1A", 1);
    black.strokes = [];
    component.appendChild(black);

    return component;
  }

  if (n === "icon") {
    const component = figma.createComponent();
    component.name = "Icon";
    component.resize(280, 56);
    component.cornerRadius = 6;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 12;
    component.itemSpacing = 12;

    const mark = figma.createPolygon();
    mark.pointCount = 5;
    mark.resize(20, 20);
    setSolidPaint(mark, "#CC2020", 1);
    mark.strokes = [];
    component.appendChild(mark);
    const t = await buildTextNode("Icon", fontBody, 14, "#1A1A1A", "Label");
    component.appendChild(t);
    return component;
  }

  if (n === "search bar") {
    const component = figma.createComponent();
    component.name = "Search Bar";
    component.resize(280, 56);
    component.fills = [];
    component.strokes = [];
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.itemSpacing = 10;

    const input = figma.createFrame();
    input.name = "Input";
    input.resize(190, 56);
    input.cornerRadius = 6;
    input.layoutMode = "HORIZONTAL";
    input.primaryAxisAlignItems = "CENTER";
    input.counterAxisAlignItems = "CENTER";
    input.paddingLeft = 12;
    input.paddingRight = 12;
    setSolidPaint(input, "#FBF7EE", 1);
    setStrokePaint(input, "#D4C9B8", 1, 1);
    const t = await buildTextNode("Search…", fontBody, 14, "#A89882", "Placeholder");
    input.appendChild(t);

    const btn = figma.createFrame();
    btn.name = "Button";
    btn.resize(80, 56);
    btn.cornerRadius = 6;
    btn.layoutMode = "HORIZONTAL";
    btn.primaryAxisAlignItems = "CENTER";
    btn.counterAxisAlignItems = "CENTER";
    setSolidPaint(btn, "#CC2020", 1);
    btn.strokes = [];
    const btxt = await buildTextNode("Search", fontBody, 14, "#FBF7EE", "Label");
    btn.appendChild(btxt);

    component.appendChild(input);
    component.appendChild(btn);
    return component;
  }

  if (n === "breadcrumb") {
    const component = figma.createComponent();
    component.name = "Breadcrumb";
    component.resize(280, 40);
    component.fills = [];
    component.strokes = [];
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.itemSpacing = 8;
    const a = await buildTextNode("Home", fontBody, 12, "#3A6EA8", "Link");
    const sep = await buildTextNode("›", fontBody, 12, "#A89882", "Sep");
    const b = await buildTextNode("Services", fontBody, 12, "#3A6EA8", "Link");
    const sep2 = await buildTextNode("›", fontBody, 12, "#A89882", "Sep");
    const c = await buildTextNode("Application", fontBody, 12, "#CC2020", "Current");
    component.appendChild(a);
    component.appendChild(sep);
    component.appendChild(b);
    component.appendChild(sep2);
    component.appendChild(c);
    return component;
  }

  if (n === "pagination") {
    const component = figma.createComponent();
    component.name = "Pagination";
    component.resize(280, 44);
    component.fills = [];
    component.strokes = [];
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.itemSpacing = 8;

    async function pill(text, active) {
      const p = figma.createFrame();
      p.name = text;
      p.layoutMode = "HORIZONTAL";
      p.primaryAxisAlignItems = "CENTER";
      p.counterAxisAlignItems = "CENTER";
      p.paddingLeft = 10;
      p.paddingRight = 10;
      p.paddingTop = 6;
      p.paddingBottom = 6;
      p.cornerRadius = 6;
      if (active) {
        setSolidPaint(p, "#CC2020", 1);
        p.strokes = [];
      } else {
        setSolidPaint(p, "#FBF7EE", 1);
        setStrokePaint(p, "#D4C9B8", 1, 1);
      }
      const t = await buildTextNode(text, fontBody, 12, active ? "#FBF7EE" : "#1A1A1A", "Label");
      p.appendChild(t);
      return p;
    }

    component.appendChild(await pill("1", true));
    component.appendChild(await pill("2", false));
    component.appendChild(await pill("3", false));
    return component;
  }

  if (n === "callout") {
    const component = figma.createComponent();
    component.name = "Callout";
    component.resize(280, 68);
    component.cornerRadius = 6;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const bar = figma.createRectangle();
    bar.resize(4, 68);
    bar.x = 0;
    bar.y = 0;
    setSolidPaint(bar, "#3A6EA8", 1);
    bar.strokes = [];
    component.appendChild(bar);

    const title = await buildTextNode("Notice", fontBody, 13, "#1A1A1A", "Title");
    title.x = 12;
    title.y = 10;
    const body = await buildTextNode("This is a sample callout.", fontBody, 12, "#3A3530", "Body");
    body.x = 12;
    body.y = 32;
    component.appendChild(title);
    component.appendChild(body);
    return component;
  }

  if (n === "inset text") {
    const component = figma.createComponent();
    component.name = "Inset Text";
    component.resize(280, 68);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 6;

    const bar = figma.createRectangle();
    bar.resize(4, 68);
    bar.x = 0;
    bar.y = 0;
    setSolidPaint(bar, "#CC2020", 1);
    bar.strokes = [];
    component.appendChild(bar);

    const body = await buildTextNode("Inset text for emphasis.", fontBody, 12, "#3A3530", "Body");
    body.x = 12;
    body.y = 24;
    component.appendChild(body);
    return component;
  }

  if (n === "summary list") {
    const component = figma.createComponent();
    component.name = "Summary List";
    component.resize(280, 72);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 6;

    const key = figma.createRectangle();
    key.resize(100, 72);
    key.x = 0;
    key.y = 0;
    setSolidPaint(key, "#F5EDD8", 1);
    key.strokes = [];
    component.appendChild(key);

    const k = await buildTextNode("Name", fontBody, 12, "#1A1A1A", "Key");
    k.x = 12;
    k.y = 10;
    const v = await buildTextNode("Alex Tan", fontBody, 12, "#1A1A1A", "Value");
    v.x = 112;
    v.y = 10;
    component.appendChild(k);
    component.appendChild(v);
    return component;
  }

  if (n === "task list (progress steps)") {
    const component = figma.createComponent();
    component.name = "Task List";
    component.resize(280, 76);
    component.fills = [];
    component.strokes = [];

    for (let i = 0; i < 3; i += 1) {
      const row = figma.createFrame();
      row.name = "Step " + String(i + 1);
      row.resize(280, 24);
      row.x = 0;
      row.y = i * 26;
      row.layoutMode = "HORIZONTAL";
      row.primaryAxisAlignItems = "CENTER";
      row.counterAxisAlignItems = "CENTER";
      row.itemSpacing = 8;
      row.fills = [];
      row.strokes = [];

      const dot = figma.createEllipse();
      dot.resize(10, 10);
      setSolidPaint(dot, i === 0 ? "#CC2020" : i === 1 ? "#2D6A3F" : "#A89882", 1);
      dot.strokes = [];
      row.appendChild(dot);

      const t = await buildTextNode(i === 0 ? "Active" : i === 1 ? "Complete" : "Pending", fontBody, 12, "#1A1A1A", "Label");
      row.appendChild(t);
      component.appendChild(row);
    }
    return component;
  }

  if (n === "tooltip") {
    const component = figma.createComponent();
    component.name = "Tooltip";
    component.resize(200, 44);
    component.cornerRadius = 6;
    setSolidPaint(component, "#1A1A1A", 1);
    component.strokes = [];
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 12;
    component.paddingRight = 12;
    const t = await buildTextNode("Quick tip", fontBody, 12, "#FBF7EE", "Label");
    component.appendChild(t);
    return component;
  }

  if (n === "table") {
    const component = figma.createComponent();
    component.name = "Table";
    component.resize(280, 86);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 6;

    const head = figma.createRectangle();
    head.resize(280, 26);
    head.x = 0;
    head.y = 0;
    setSolidPaint(head, "#F5EDD8", 1);
    head.strokes = [];
    component.appendChild(head);

    const h = await buildTextNode("Header", fontBody, 12, "#1A1A1A", "Header");
    h.x = 12;
    h.y = 6;
    component.appendChild(h);
    return component;
  }

  if (n === "accordion") {
    const component = figma.createComponent();
    component.name = "Accordion";
    component.resize(280, 56);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 6;
    const t = await buildTextNode("Section", fontBody, 14, "#1A1A1A", "Title");
    t.x = 12;
    t.y = 18;
    component.appendChild(t);
    return component;
  }

  if (n === "alert dialog") {
    const component = figma.createComponent();
    component.name = "Alert Dialog";
    component.resize(280, 86);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 10;
    const t = await buildTextNode("Confirmation", fontBody, 14, "#1A1A1A", "Title");
    t.x = 12;
    t.y = 10;
    const b = await buildTextNode("Are you sure?", fontBody, 12, "#3A3530", "Body");
    b.x = 12;
    b.y = 34;
    component.appendChild(t);
    component.appendChild(b);
    return component;
  }

  if (n === "tabs") {
    const component = figma.createComponent();
    component.name = "Tabs";
    component.resize(280, 56);
    component.fills = [];
    component.strokes = [];

    const row = figma.createFrame();
    row.name = "TabRow";
    row.resize(280, 30);
    row.x = 0;
    row.y = 0;
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisAlignItems = "CENTER";
    row.counterAxisAlignItems = "CENTER";
    row.itemSpacing = 16;
    row.fills = [];
    row.strokes = [];

    const a = await buildTextNode("Tab 1", fontBody, 12, "#CC2020", "Active");
    const b = await buildTextNode("Tab 2", fontBody, 12, "#3A3530", "Tab");
    row.appendChild(a);
    row.appendChild(b);
    component.appendChild(row);
    return component;
  }

  if (n === "cookies banner") {
    const component = figma.createComponent();
    component.name = "Cookies Banner";
    component.resize(280, 86);
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.cornerRadius = 6;
    const t = await buildTextNode("We use cookies.", fontBody, 12, "#1A1A1A", "Text");
    t.x = 12;
    t.y = 12;
    component.appendChild(t);
    return component;
  }

  if (n === "header") {
    const component = figma.createComponent();
    component.name = "Header";
    component.resize(280, 86);
    component.fills = [];
    component.strokes = [];

    const stripe = figma.createRectangle();
    stripe.resize(280, 4);
    stripe.x = 0;
    stripe.y = 0;
    setSolidPaint(stripe, "#CC2020", 1);
    stripe.strokes = [];
    component.appendChild(stripe);

    const bar = figma.createRectangle();
    bar.resize(280, 38);
    bar.x = 0;
    bar.y = 10;
    setSolidPaint(bar, "#1A1A1A", 1);
    bar.strokes = [];
    component.appendChild(bar);

    const t = await buildTextNode("Brand", fontBody, 14, "#FBF7EE", "Brand");
    t.x = 12;
    t.y = 20;
    component.appendChild(t);
    return component;
  }

  return null;
}

async function buildAiSurfaceComponent(surfaceName, fontBody, fontMono) {
  const n = String(surfaceName).toLowerCase();

  if (n === "streamingtext") {
    const component = figma.createComponent();
    component.name = "StreamingText";
    component.resize(280, 72);
    component.cornerRadius = 8;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const row = figma.createFrame();
    row.name = "Row";
    row.resize(256, 40);
    row.x = 12;
    row.y = 16;
    row.fills = [];
    row.strokes = [];
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisAlignItems = "CENTER";
    row.counterAxisAlignItems = "CENTER";
    row.itemSpacing = 6;

    const t = await buildTextNode("Generating response", fontBody, 14, "#1A1A1A", "Text");
    row.appendChild(t);

    const cursor = figma.createRectangle();
    cursor.name = "Cursor";
    cursor.resize(10, 18);
    cursor.cornerRadius = 2;
    setSolidPaint(cursor, "#CC2020", 1);
    cursor.strokes = [];
    row.appendChild(cursor);

    component.appendChild(row);
    return component;
  }

  if (n === "chatbubble") {
    const mk = async (variantName, bgHex, fgHex, label) => {
      const comp = figma.createComponent();
      comp.name = `ChatBubble/${variantName}`;
      comp.resize(280, 72);
      comp.cornerRadius = 12;
      setSolidPaint(comp, bgHex, 1);
      comp.strokes = [];

      const text = await buildTextNode(label, fontBody, 14, fgHex, "Text");
      text.x = 14;
      text.y = 14;
      comp.appendChild(text);

      return comp;
    };

    const user = await mk("User", "#F4C417", "#1A1A1A", "User message");
    const assistant = await mk("Assistant", "#FBF7EE", "#1A1A1A", "Assistant response");
    const system = await mk("System", "#F5EDD8", "#3A3530", "System notice");

    const set = figma.combineAsVariants([user, assistant, system], figma.currentPage);
    set.name = "ChatBubble";
    set.layoutMode = "VERTICAL";
    set.fills = [];
    set.strokes = [];
    return set;
  }

  if (n === "tooluseindicator") {
    const component = figma.createComponent();
    component.name = "ToolUseIndicator";
    component.resize(280, 88);
    component.cornerRadius = 8;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const header = figma.createFrame();
    header.name = "Header";
    header.resize(256, 28);
    header.x = 12;
    header.y = 12;
    header.fills = [];
    header.strokes = [];
    header.layoutMode = "HORIZONTAL";
    header.primaryAxisAlignItems = "CENTER";
    header.counterAxisAlignItems = "CENTER";
    header.itemSpacing = 8;

    const dot = figma.createEllipse();
    dot.name = "Active Dot";
    dot.resize(10, 10);
    setSolidPaint(dot, "#CC2020", 1);
    dot.strokes = [];
    header.appendChild(dot);

    const title = await buildTextNode("Tool: Search", fontMono, 12, "#1A1A1A", "Title");
    header.appendChild(title);
    component.appendChild(header);

    const body = figma.createFrame();
    body.name = "Output";
    body.resize(256, 36);
    body.x = 12;
    body.y = 44;
    body.cornerRadius = 6;
    setSolidPaint(body, "#F5EDD8", 1);
    body.strokes = [];
    component.appendChild(body);

    const out = await buildTextNode("Running…", fontBody, 13, "#3A3530", "Output Text");
    out.x = 10;
    out.y = 10;
    body.appendChild(out);

    return component;
  }

  if (n === "citationbadge") {
    const component = figma.createComponent();
    component.name = "CitationBadge";
    component.resize(120, 32);
    component.cornerRadius = 9999;
    setSolidPaint(component, "#F5EDD8", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);
    component.layoutMode = "HORIZONTAL";
    component.primaryAxisAlignItems = "CENTER";
    component.counterAxisAlignItems = "CENTER";
    component.paddingLeft = 10;
    component.paddingRight = 10;
    component.itemSpacing = 8;

    const num = await buildTextNode("[1]", fontMono, 12, "#CC2020", "Number");
    component.appendChild(num);
    const label = await buildTextNode("Citation", fontBody, 12, "#1A1A1A", "Label");
    component.appendChild(label);

    return component;
  }

  if (n === "conversationthread") {
    const component = figma.createComponent();
    component.name = "ConversationThread";
    component.resize(280, 156);
    component.cornerRadius = 10;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const stripe = figma.createRectangle();
    stripe.name = "Brand Stripe";
    stripe.resize(280, 4);
    stripe.x = 0;
    stripe.y = 0;
    setSolidPaint(stripe, "#CC2020", 1);
    stripe.strokes = [];
    component.appendChild(stripe);

    const bubbleSet = await buildAiSurfaceComponent("ChatBubble", fontBody, fontMono);
    let assistantVariant = null;
    if (bubbleSet && bubbleSet.type === "COMPONENT_SET") {
      assistantVariant = bubbleSet.children.find((c) => c.type === "COMPONENT" && c.name.indexOf("Assistant") >= 0) || null;
    }
    if (assistantVariant && assistantVariant.type === "COMPONENT") {
      const b1 = assistantVariant.createInstance();
      b1.x = 10;
      b1.y = 16;
      b1.resize(260, 56);
      component.appendChild(b1);
    }

    const userVariant = bubbleSet && bubbleSet.type === "COMPONENT_SET"
      ? bubbleSet.children.find((c) => c.type === "COMPONENT" && c.name.indexOf("User") >= 0) || null
      : null;
    if (userVariant && userVariant.type === "COMPONENT") {
      const b2 = userVariant.createInstance();
      b2.x = 10;
      b2.y = 78;
      b2.resize(220, 56);
      component.appendChild(b2);
    }

    return component;
  }

  if (n === "agentstatusbar") {
    const component = figma.createComponent();
    component.name = "AgentStatusBar";
    component.resize(280, 56);
    component.cornerRadius = 8;
    setSolidPaint(component, "#FBF7EE", 1);
    setStrokePaint(component, "#D4C9B8", 1, 1);

    const title = await buildTextNode("Agent status", fontMono, 12, "#1A1A1A", "Title");
    title.x = 12;
    title.y = 10;
    component.appendChild(title);

    const row = figma.createFrame();
    row.name = "Steps";
    row.resize(256, 16);
    row.x = 12;
    row.y = 32;
    row.fills = [];
    row.strokes = [];
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisAlignItems = "CENTER";
    row.counterAxisAlignItems = "CENTER";
    row.itemSpacing = 8;

    const colors = ["#CC2020", "#2D6A3F", "#A89882", "#A89882"];
    for (let i = 0; i < colors.length; i += 1) {
      const dot = figma.createEllipse();
      dot.name = `Step ${i + 1}`;
      dot.resize(10, 10);
      setSolidPaint(dot, colors[i], 1);
      dot.strokes = [];
      row.appendChild(dot);
    }
    component.appendChild(row);

    return component;
  }

  return null;
}

function selectionSummary() {
  return figma.currentPage.selection.map((n) => ({ id: n.id, name: n.name, type: n.type }));
}

async function getNodeByIdAsync(id) {
  const node = await figma.getNodeByIdAsync(String(id));
  if (!node) throw new Error("Node not found");
  if (node.removed) throw new Error("Node has been removed");
  return node;
}

function rgbaToHex(color) {
  const r = Math.round(Number(color.r) * 255);
  const g = Math.round(Number(color.g) * 255);
  const b = Math.round(Number(color.b) * 255);
  const a = color.a !== undefined ? Math.round(Number(color.a) * 255) : 255;
  function toHex2(n) {
    const v = Math.max(0, Math.min(255, Number(n)));
    return v.toString(16).padStart(2, "0");
  }
  if (a === 255) return "#" + [r, g, b].map(toHex2).join("");
  return "#" + [r, g, b, a].map(toHex2).join("");
}

function filterFigmaNode(node) {
  if (!node) return null;
  if (node.type === "VECTOR") return null;
  const filtered = { id: node.id, name: node.name, type: node.type };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      const processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;
      delete processedFill.gifRef;
      if (processedFill.gradientStops) {
        processedFill.gradientStops = processedFill.gradientStops.map((stop) => {
          const processedStop = Object.assign({}, stop);
          if (processedStop.color) processedStop.color = rgbaToHex(processedStop.color);
          delete processedStop.boundVariables;
          return processedStop;
        });
      }
      if (processedFill.color) processedFill.color = rgbaToHex(processedFill.color);
      return processedFill;
    });
  }

  if (node.strokes && node.strokes.length > 0) {
    filtered.strokes = node.strokes.map((stroke) => {
      const processedStroke = Object.assign({}, stroke);
      delete processedStroke.boundVariables;
      if (processedStroke.color) processedStroke.color = rgbaToHex(processedStroke.color);
      return processedStroke;
    });
  }

  if (node.strokeWeight !== undefined) filtered.strokeWeight = node.strokeWeight;
  if (node.cornerRadius !== undefined) filtered.cornerRadius = node.cornerRadius;
  if (node.absoluteBoundingBox) filtered.absoluteBoundingBox = node.absoluteBoundingBox;
  if (node.characters) filtered.characters = node.characters;
  if (node.componentId !== undefined) filtered.componentId = node.componentId;
  if (node.componentSetId !== undefined) filtered.componentSetId = node.componentSetId;
  if (node.componentProperties !== undefined) filtered.componentProperties = node.componentProperties;
  if (node.variantProperties !== undefined) filtered.variantProperties = node.variantProperties;

  if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: node.style.fontSize,
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: node.style.letterSpacing,
      lineHeightPx: node.style.lineHeightPx
    };
  }

  if (node.children) {
    filtered.children = node.children
      .map((child) => filterFigmaNode(child))
      .filter((child) => child !== null);
  }

  return filtered;
}

function normalize01From01Or255(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n > 1) return Math.max(0, Math.min(1, n / 255));
  return Math.max(0, Math.min(1, n));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

async function getDocumentInfoFull() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    children: page.children.map((node) => ({ id: node.id, name: node.name, type: node.type })),
    currentPage: {
      id: page.id,
      name: page.name,
      childCount: page.children.length
    },
    pages: [
      {
        id: page.id,
        name: page.name,
        childCount: page.children.length
      }
    ]
  };
}

async function getSelectionFull() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible
    }))
  };
}

async function getNodeInfo(nodeId) {
  const node = await figma.getNodeByIdAsync(String(nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(nodeId));
  const response = await node.exportAsync({ format: "JSON_REST_V1" });
  return filterFigmaNode(response.document);
}

async function getNodesInfo(nodeIds) {
  const ids = ensureArray(nodeIds).map((id) => String(id));
  const nodes = await Promise.all(ids.map((id) => figma.getNodeByIdAsync(id)));
  const validNodes = nodes.filter((n) => n !== null);
  const responses = await Promise.all(
    validNodes.map(async (node) => {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      return { nodeId: node.id, document: filterFigmaNode(response.document) };
    })
  );
  return responses;
}

async function readMyDesign() {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) throw new Error("No selection found");
  if (selection.length === 1) return await getNodeInfo(selection[0].id);
  return await getNodesInfo(selection.map((n) => n.id));
}

async function setFocus(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
  return { success: true, nodeId: node.id };
}

async function setSelections(params) {
  const ids = ensureArray(params && params.nodeIds);
  if (!ids.length) throw new Error("Missing or invalid nodeIds parameter");
  const nodes = await Promise.all(ids.map((id) => figma.getNodeByIdAsync(String(id))));
  const validNodes = nodes.filter((n) => n !== null);
  if (!validNodes.length) throw new Error("No valid nodes found");
  figma.currentPage.selection = validNodes;
  figma.viewport.scrollAndZoomIntoView(validNodes);
  return { success: true, selectionCount: validNodes.length, nodeIds: validNodes.map((n) => n.id) };
}

async function setFillColor(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("fills" in node)) throw new Error("Node does not support fills");
  const r = normalize01From01Or255(params.r);
  const g = normalize01From01Or255(params.g);
  const b = normalize01From01Or255(params.b);
  const opacity = params.opacity === undefined || params.opacity === null ? 1 : normalize01From01Or255(params.opacity);
  node.fills = [{ type: "SOLID", color: { r, g, b }, opacity: opacity }];
  return { success: true, nodeId: node.id };
}

async function setStrokeColor(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("strokes" in node)) throw new Error("Node does not support strokes");
  const r = normalize01From01Or255(params.r);
  const g = normalize01From01Or255(params.g);
  const b = normalize01From01Or255(params.b);
  const opacity = params.opacity === undefined || params.opacity === null ? 1 : normalize01From01Or255(params.opacity);
  const strokeWeight = params.strokeWeight === undefined || params.strokeWeight === null ? node.strokeWeight || 1 : Number(params.strokeWeight);
  node.strokes = [{ type: "SOLID", color: { r, g, b }, opacity: opacity }];
  if ("strokeWeight" in node) node.strokeWeight = strokeWeight;
  return { success: true, nodeId: node.id };
}

async function moveNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  node.x = Number(params.x === undefined || params.x === null ? node.x : params.x);
  node.y = Number(params.y === undefined || params.y === null ? node.y : params.y);
  return { success: true, nodeId: node.id, x: node.x, y: node.y };
}

async function reparentNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  if (!params || !params.newParentId) throw new Error("Missing newParentId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const nextParent = await figma.getNodeByIdAsync(String(params.newParentId));
  if (!nextParent) throw new Error("Parent not found with ID: " + String(params.newParentId));
  assertNodeWritable(node, params);
  assertNodeWritable(nextParent, params);
  if (!("appendChild" in nextParent)) throw new Error("Parent cannot contain children");
  nextParent.appendChild(node);
  if (params.x !== undefined || params.y !== undefined) {
    if ("x" in node && "y" in node) {
      if (params.x !== undefined) node.x = Number(params.x);
      if (params.y !== undefined) node.y = Number(params.y);
    }
  }
  return { success: true, nodeId: node.id, newParentId: nextParent.id };
}

async function getParentChain(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  const stopId = params.stopAtId ? String(params.stopAtId) : null;
  const maxDepth = Number.isFinite(Number(params.maxDepth)) ? Math.max(1, Number(params.maxDepth)) : 50;
  const chain = [];
  let cur = node;
  let depth = 0;
  while (cur && depth < maxDepth) {
    chain.push({ id: cur.id, name: cur.name, type: cur.type });
    if (stopId && cur.id === stopId) break;
    cur = cur.parent;
    depth += 1;
  }
  return { success: true, nodeId: node.id, chain };
}

async function insertChild(params) {
  if (!params || !params.parentId) throw new Error("Missing parentId parameter");
  if (!params || !params.childId) throw new Error("Missing childId parameter");
  const parent = await figma.getNodeByIdAsync(String(params.parentId));
  if (!parent) throw new Error("Parent not found with ID: " + String(params.parentId));
  const child = await figma.getNodeByIdAsync(String(params.childId));
  if (!child) throw new Error("Child not found with ID: " + String(params.childId));
  assertNodeWritable(parent, params);
  assertNodeWritable(child, params);
  if (!("insertChild" in parent)) throw new Error("Parent does not support insertChild");
  const rawIndex = Number(params.index);
  const index = Number.isFinite(rawIndex) ? Math.max(0, Math.floor(rawIndex)) : 0;
  parent.insertChild(index, child);
  return { success: true, parentId: parent.id, childId: child.id, index };
}

async function resizeNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  const w = Number(params.width);
  const h = Number(params.height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error("Missing or invalid width/height");
  if (!("resize" in node)) throw new Error("Node does not support resize");
  node.resize(w, h);
  return { success: true, nodeId: node.id, width: w, height: h };
}

async function deleteNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const confirmFrameOrPageDeletion =
    params && typeof params === "object" ? params.confirmFrameOrPageDeletion === true : false;
  if ((node.type === "FRAME" || node.type === "PAGE") && !confirmFrameOrPageDeletion) {
    throw new Error("Confirmation required to delete a frame/page. Pass confirmFrameOrPageDeletion: true.");
  }
  assertNodeWritable(node, params);
  if (!("remove" in node)) throw new Error("Node does not support remove");
  node.remove();
  return { success: true, nodeId: String(params.nodeId) };
}

async function deleteMultipleNodes(params) {
  const p = params && typeof params === "object" ? params : {};
  const raw = Array.isArray(p.nodeIds) ? p.nodeIds : null;
  if (!raw || raw.length === 0) throw new Error("Missing nodeIds parameter");
  const deletedNodeIds = [];
  const failed = [];
  for (const id of raw) {
    try {
      const nodeId = String(id);
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        failed.push({ nodeId, error: "Node not found" });
        continue;
      }
      const confirmFrameOrPageDeletion = p.confirmFrameOrPageDeletion === true;
      if ((node.type === "FRAME" || node.type === "PAGE") && !confirmFrameOrPageDeletion) {
        failed.push({ nodeId, error: "Confirmation required to delete a frame/page" });
        continue;
      }
      assertNodeWritable(node, p);
      if (!("remove" in node)) {
        failed.push({ nodeId, error: "Node does not support remove" });
        continue;
      }
      node.remove();
      deletedNodeIds.push(nodeId);
    } catch (err) {
      failed.push({ nodeId: String(id), error: err && err.message ? String(err.message) : String(err) });
    }
  }
  return { success: true, deletedNodeIds, failed };
}

async function cloneNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("clone" in node)) throw new Error("Node does not support clone");
  const cloned = node.clone();
  const dx = Number(params.dx === undefined || params.dx === null ? 20 : params.dx);
  const dy = Number(params.dy === undefined || params.dy === null ? 20 : params.dy);
  cloned.x = Number(cloned.x) + dx;
  cloned.y = Number(cloned.y) + dy;
  figma.currentPage.selection = [cloned];
  figma.viewport.scrollAndZoomIntoView([cloned]);
  return { success: true, nodeId: cloned.id };
}

async function cloneNodeIntoParent(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  if (!params || !params.parentNodeId) throw new Error("Missing parentNodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("clone" in node)) throw new Error("Node does not support clone");
  const parent = await figma.getNodeByIdAsync(String(params.parentNodeId));
  if (!parent) throw new Error("Parent not found with ID: " + String(params.parentNodeId));
  assertNodeWritable(parent, params);
  if (!("appendChild" in parent)) throw new Error("Parent cannot contain children");
  const cloned = node.clone();
  try {
    parent.appendChild(cloned);
    const dx = Number(params.dx === undefined || params.dx === null ? 0 : params.dx);
    const dy = Number(params.dy === undefined || params.dy === null ? 0 : params.dy);
    if ("x" in cloned && "y" in cloned) {
      cloned.x = Number(cloned.x) + dx;
      cloned.y = Number(cloned.y) + dy;
    }
    figma.currentPage.selection = [cloned];
    figma.viewport.scrollAndZoomIntoView([cloned]);
    return { success: true, nodeId: cloned.id, parentNodeId: parent.id };
  } catch (err) {
    if (cloned && "remove" in cloned) {
      try {
        cloned.remove();
      } catch (_) {}
    }
    throw err;
  }
}

async function setCornerRadius(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  const radius = Number(params.radius);
  if (!Number.isFinite(radius)) throw new Error("Missing or invalid radius");
  if (!("cornerRadius" in node)) throw new Error("Node does not support cornerRadius");
  if (params.corners && typeof params.corners === "object") {
    if ("topLeftRadius" in node) node.topLeftRadius = Number(params.corners.topLeft);
    if ("topRightRadius" in node) node.topRightRadius = Number(params.corners.topRight);
    if ("bottomLeftRadius" in node) node.bottomLeftRadius = Number(params.corners.bottomLeft);
    if ("bottomRightRadius" in node) node.bottomRightRadius = Number(params.corners.bottomRight);
  } else {
    node.cornerRadius = radius;
  }
  return { success: true, nodeId: node.id };
}

async function getStyles() {
  const paintStyles = await getLocalPaintStyles();
  const textStyles = await getLocalTextStyles();
  const effectStyles = await getLocalEffectStyles();
  const gridStyles = await getLocalGridStyles();
  return {
    paintStyles: paintStyles.map((s) => ({ id: s.id, name: s.name })),
    textStyles: textStyles.map((s) => ({ id: s.id, name: s.name })),
    effectStyles: effectStyles.map((s) => ({ id: s.id, name: s.name })),
    gridStyles: gridStyles.map((s) => ({ id: s.id, name: s.name }))
  };
}

async function getLocalComponents(params) {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  const includeComponentSets = params && params.includeComponentSets !== undefined ? Boolean(params.includeComponentSets) : true;
  const nodes = page.findAll((n) => {
    if (n.type === "COMPONENT") return true;
    if (includeComponentSets && n.type === "COMPONENT_SET") return true;
    return false;
  });
  return nodes.map((n) => ({ id: n.id, name: n.name, type: n.type }));
}

async function createComponentInstance(params) {
  if (!params || !params.componentId) throw new Error("Missing componentId parameter");
  const node = await figma.getNodeByIdAsync(String(params.componentId));
  if (!node) throw new Error("Component not found with ID: " + String(params.componentId));
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") throw new Error("Node is not a component/component set");
  let component = node;
  if (node.type === "COMPONENT_SET") {
    if (!node.defaultVariant) throw new Error("Component set has no defaultVariant");
    component = node.defaultVariant;
  }
  const instance = component.createInstance();
  instance.x = Number(params.x === undefined || params.x === null ? 0 : params.x);
  instance.y = Number(params.y === undefined || params.y === null ? 0 : params.y);
  const host = await resolveCreateHost(params);
  host.appendChild(instance);
  figma.currentPage.selection = [instance];
  figma.viewport.scrollAndZoomIntoView([instance]);
  return { success: true, nodeId: instance.id };
}

async function createInstanceFromInstance(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const src = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!src) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (src.type !== "INSTANCE") throw new Error("Source node is not an INSTANCE");
  assertNodeWritable(src, params);
  let main = null;
  if (typeof src.getMainComponentAsync === "function") {
    main = await src.getMainComponentAsync();
  } else {
    main = src.mainComponent;
  }
  if (!main) throw new Error("Instance has no mainComponent");
  const instance = main.createInstance();
  instance.x = Number(params.x === undefined || params.x === null ? 0 : params.x);
  instance.y = Number(params.y === undefined || params.y === null ? 0 : params.y);
  const host = await resolveCreateHost(params);
  host.appendChild(instance);
  figma.currentPage.selection = [instance];
  figma.viewport.scrollAndZoomIntoView([instance]);
  return { success: true, nodeId: instance.id };
}

async function getMainComponentForInstance(instance) {
  if (!instance || instance.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  if (typeof instance.getMainComponentAsync === "function") return await instance.getMainComponentAsync();
  return instance.mainComponent;
}

async function getInstanceSource(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  const main = await getMainComponentForInstance(node);
  if (!main) throw new Error("Instance has no mainComponent");
  const set = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
  const out = {
    instanceId: node.id,
    instanceName: node.name,
    mainComponentId: main.id,
    mainComponentName: main.name,
    mainComponentKey: main.key || null,
    mainComponentRemote: Boolean(main.remote),
    componentSetId: set ? set.id : null,
    componentSetName: set ? set.name : null,
    componentSetKey: set && set.key ? set.key : null,
    componentSetRemote: set ? Boolean(set.remote) : null,
    componentProperties: node.componentProperties !== undefined ? node.componentProperties : null,
    variantProperties: node.variantProperties !== undefined ? node.variantProperties : null
  };
  return out;
}

async function scanInstancesWithSources(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  const chunkSize = params && params.chunkSize ? Number(params.chunkSize) : 200;
  const offset = params && params.offset ? Number(params.offset) : 0;
  let root = null;
  if (rootNodeId) root = await figma.getNodeByIdAsync(rootNodeId);
  const container = root && root.type !== "DOCUMENT" ? root : figma.currentPage;
  const nodes = container.findAll((n) => n.type === "INSTANCE");
  const total = nodes.length;
  const slice = nodes.slice(offset, offset + chunkSize);
  const items = [];
  for (const inst of slice) {
    try {
      const main = await getMainComponentForInstance(inst);
      const set = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
      items.push({
        instanceId: inst.id,
        instanceName: inst.name,
        mainComponentId: main ? main.id : null,
        mainComponentName: main ? main.name : null,
        mainComponentKey: main && main.key ? main.key : null,
        mainComponentRemote: main ? Boolean(main.remote) : null,
        componentSetId: set ? set.id : null,
        componentSetName: set ? set.name : null,
        componentSetKey: set && set.key ? set.key : null,
        componentSetRemote: set ? Boolean(set.remote) : null
      });
    } catch (err) {
      items.push({
        instanceId: inst.id,
        instanceName: inst.name,
        error: err && err.message ? String(err.message) : String(err)
      });
    }
  }
  return { success: true, total, offset, chunkSize, items };
}

async function importComponentByKey(params) {
  if (!params || !params.componentKey) throw new Error("Missing componentKey parameter");
  const key = String(params.componentKey);
  const component = await figma.importComponentByKeyAsync(key);
  return { success: true, componentId: component.id, componentKey: component.key || key, name: component.name, remote: Boolean(component.remote) };
}

async function importComponentSetByKey(params) {
  if (!params || !params.componentSetKey) throw new Error("Missing componentSetKey parameter");
  const key = String(params.componentSetKey);
  const set = await figma.importComponentSetByKeyAsync(key);
  const def = set.defaultVariant || null;
  return {
    success: true,
    componentSetId: set.id,
    componentSetKey: set.key || key,
    name: set.name,
    remote: Boolean(set.remote),
    defaultComponentId: def ? def.id : null,
    defaultComponentKey: def && def.key ? def.key : null
  };
}

async function createInstanceFromComponentKey(params) {
  if (!params || !params.componentKey) throw new Error("Missing componentKey parameter");
  const key = String(params.componentKey);
  const component = await figma.importComponentByKeyAsync(key);
  const instance = component.createInstance();
  instance.x = Number(params.x === undefined || params.x === null ? 0 : params.x);
  instance.y = Number(params.y === undefined || params.y === null ? 0 : params.y);
  const host = await resolveCreateHost(params);
  host.appendChild(instance);
  figma.currentPage.selection = [instance];
  figma.viewport.scrollAndZoomIntoView([instance]);
  return { success: true, nodeId: instance.id };
}

async function createInstanceFromComponentSetKey(params) {
  if (!params || !params.componentSetKey) throw new Error("Missing componentSetKey parameter");
  const key = String(params.componentSetKey);
  const set = await figma.importComponentSetByKeyAsync(key);
  if (!set.defaultVariant) throw new Error("Component set has no defaultVariant");
  const instance = set.defaultVariant.createInstance();
  instance.x = Number(params.x === undefined || params.x === null ? 0 : params.x);
  instance.y = Number(params.y === undefined || params.y === null ? 0 : params.y);
  const host = await resolveCreateHost(params);
  host.appendChild(instance);
  figma.currentPage.selection = [instance];
  figma.viewport.scrollAndZoomIntoView([instance]);
  return { success: true, nodeId: instance.id };
}

async function getInstanceProperties(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  return { success: true, instanceId: node.id, componentProperties: node.componentProperties || {} };
}

async function setInstanceProperties(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const props = params && params.properties && typeof params.properties === "object" ? params.properties : null;
  if (!props) throw new Error("Missing properties parameter");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  assertNodeWritable(node, params);
  node.setProperties(props);
  return { success: true, instanceId: node.id };
}

async function swapInstanceComponent(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  if (!params || !params.newComponentKey) throw new Error("Missing newComponentKey parameter");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  assertNodeWritable(node, params);
  const component = await figma.importComponentByKeyAsync(String(params.newComponentKey));
  node.swapComponent(component);
  return { success: true, instanceId: node.id, newComponentId: component.id };
}

function uint8ToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function exportNodeAsImage(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const format = String(params.format || "PNG").toUpperCase();
  const scale = params.scale === undefined || params.scale === null ? 1 : Number(params.scale);
  const bytes = await node.exportAsync({ format: format, constraint: { type: "SCALE", value: scale } });
  return { nodeId: node.id, format: format, scale: scale, base64: uint8ToBase64(bytes), bytesLength: bytes.length };
}

async function setTextContent(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node || node.type !== "TEXT") throw new Error("Node not found or not a TEXT node");
  assertNodeWritable(node, params);
  await loadTextFont(node);
  node.characters = params.characters === undefined || params.characters === null ? "" : String(params.characters);
  return { success: true, nodeId: node.id, characters: node.characters };
}

async function setMultipleTextContents(params) {
  const updates = ensureArray(params && params.updates);
  if (!updates.length) throw new Error("Missing updates");
  let updated = 0;
  for (let i = 0; i < updates.length; i += 1) {
    const u = updates[i];
    if (!u || !u.nodeId) continue;
    const node = await figma.getNodeByIdAsync(String(u.nodeId));
    if (!node || node.type !== "TEXT") continue;
    assertNodeWritable(node, params);
    await loadTextFont(node);
    node.characters = u.characters === undefined || u.characters === null ? "" : String(u.characters);
    updated += 1;
  }
  return { success: true, requested: updates.length, updated: updated };
}

async function scanTextNodes(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  const chunkSize = params && params.chunkSize ? Number(params.chunkSize) : 200;
  const offset = params && params.offset ? Number(params.offset) : 0;
  let root = null;
  if (rootNodeId) root = await figma.getNodeByIdAsync(rootNodeId);
  const container = root && root.type !== "DOCUMENT" ? root : figma.currentPage;
  const nodes = container.findAll((n) => n.type === "TEXT");
  const items = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    characters: String(n.characters || "")
  }));
  const slice = items.slice(offset, offset + chunkSize);
  return {
    total: items.length,
    offset: offset,
    chunkSize: chunkSize,
    items: slice
  };
}

async function scanNodesByTypes(params) {
  await figma.currentPage.loadAsync();
  const types = ensureArray(params && params.types).map((t) => String(t).toUpperCase());
  if (!types.length) throw new Error("Missing types");
  const nodes = figma.currentPage.findAll((n) => types.indexOf(String(n.type).toUpperCase()) >= 0);
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type
  }));
}

async function getAnnotations(params) {
  const includeCategories = params && params.includeCategories !== undefined ? Boolean(params.includeCategories) : true;
  const nodeId = params && params.nodeId ? String(params.nodeId) : null;
  const categories = includeCategories ? await figma.annotations.getAnnotationCategoriesAsync() : [];
  function categoryById(id) {
    if (!includeCategories) return null;
    for (let i = 0; i < categories.length; i += 1) {
      if (categories[i].id === id) return categories[i];
    }
    return null;
  }

  async function readNodeAnnotations(node) {
    const anns = node.annotations ? node.annotations : [];
    if (!anns || !anns.length) return null;
    const out = anns.map((a) => {
      const item = Object.assign({}, a);
      if (includeCategories && a.categoryId) {
        const cat = categoryById(a.categoryId);
        if (cat) item.category = { id: cat.id, label: cat.label, color: cat.color };
      }
      return item;
    });
    return { nodeId: node.id, nodeName: node.name, nodeType: node.type, annotations: out };
  }

  if (nodeId) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) throw new Error("Node not found with ID: " + nodeId);
    const single = await readNodeAnnotations(node);
    return single ? [single] : [];
  }

  await figma.currentPage.loadAsync();
  const nodes = figma.currentPage.findAll((n) => n.annotations && n.annotations.length > 0);
  const results = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const item = await readNodeAnnotations(nodes[i]);
    if (item) results.push(item);
  }
  return results;
}

async function setAnnotation(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const labelMarkdown = params.labelMarkdown === undefined || params.labelMarkdown === null ? "" : String(params.labelMarkdown);
  const categoryId = params.categoryId ? String(params.categoryId) : undefined;
  const properties = ensureArray(params.properties);
  const next = {
    labelMarkdown: labelMarkdown,
    categoryId: categoryId,
    properties: properties
  };
  node.annotations = [next];
  return { success: true, nodeId: node.id, annotationsCount: node.annotations.length };
}

async function setMultipleAnnotations(params) {
  const items = ensureArray(params && params.annotations);
  if (!items.length) throw new Error("Missing annotations");
  let updated = 0;
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (!a || !a.nodeId) continue;
    await setAnnotation(a);
    updated += 1;
  }
  return { success: true, requested: items.length, updated: updated };
}

async function getReactions(params) {
  const nodeIds = ensureArray(params && params.nodeIds);
  if (!nodeIds.length) throw new Error("Missing nodeIds");
  const results = [];

  function hasReactions(node) {
    return node.reactions && node.reactions.length > 0;
  }

  function findNodesWithReactions(node, depth, out) {
    if (hasReactions(node)) {
      out.push({
        id: node.id,
        name: node.name,
        type: node.type,
        depth: depth,
        reactions: node.reactions
      });
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i += 1) {
        findNodesWithReactions(node.children[i], depth + 1, out);
      }
    }
  }

  for (let i = 0; i < nodeIds.length; i += 1) {
    const node = await figma.getNodeByIdAsync(String(nodeIds[i]));
    if (!node) continue;
    const out = [];
    findNodesWithReactions(node, 0, out);
    results.push({ rootNodeId: node.id, nodes: out });
  }

  return results;
}

async function setLayoutMode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("layoutMode" in node)) throw new Error("Node does not support auto layout");
  node.layoutMode = String(params.layoutMode || "NONE");
  if (params.layoutWrap !== undefined && "layoutWrap" in node) node.layoutWrap = String(params.layoutWrap);
  return { success: true, nodeId: node.id, layoutMode: node.layoutMode };
}

async function setPadding(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("paddingTop" in node)) throw new Error("Node does not support auto layout padding");
  if (params.top !== undefined) node.paddingTop = Number(params.top);
  if (params.right !== undefined) node.paddingRight = Number(params.right);
  if (params.bottom !== undefined) node.paddingBottom = Number(params.bottom);
  if (params.left !== undefined) node.paddingLeft = Number(params.left);
  return { success: true, nodeId: node.id };
}

async function setAxisAlign(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("primaryAxisAlignItems" in node)) throw new Error("Node does not support auto layout alignment");
  if (params.primaryAxisAlignItems !== undefined) node.primaryAxisAlignItems = String(params.primaryAxisAlignItems);
  if (params.counterAxisAlignItems !== undefined) node.counterAxisAlignItems = String(params.counterAxisAlignItems);
  return { success: true, nodeId: node.id };
}

async function setLayoutSizing(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if ("primaryAxisSizingMode" in node && params.primaryAxisSizingMode !== undefined) {
    node.primaryAxisSizingMode = String(params.primaryAxisSizingMode);
  }
  if ("counterAxisSizingMode" in node && params.counterAxisSizingMode !== undefined) {
    node.counterAxisSizingMode = String(params.counterAxisSizingMode);
  }
  if ("layoutSizingHorizontal" in node && params.layoutSizingHorizontal !== undefined) {
    node.layoutSizingHorizontal = String(params.layoutSizingHorizontal);
  }
  if ("layoutSizingVertical" in node && params.layoutSizingVertical !== undefined) {
    node.layoutSizingVertical = String(params.layoutSizingVertical);
  }
  return { success: true, nodeId: node.id };
}

async function setItemSpacing(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("itemSpacing" in node)) throw new Error("Node does not support auto layout itemSpacing");
  node.itemSpacing = Number(params.itemSpacing);
  return { success: true, nodeId: node.id, itemSpacing: node.itemSpacing };
}

async function loadTextFont(textNode) {
  const fontName = textNode.fontName;
  if (fontName !== figma.mixed) {
    await figma.loadFontAsync(fontName);
    return;
  }
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
}

const ALLOWED_ACTIONS = new Set([
  "ping",
  "get_document_info",
  "get_selection",
  "read_my_design",
  "get_node_info",
  "get_nodes_info",
  "get_instance_source",
  "scan_instances_with_sources",
  "set_focus",
  "set_selections",
  "get_styles",
  "get_local_components",
  "create_component_instance",
  "create_instance_from_instance",
  "import_component_by_key",
  "import_component_set_by_key",
  "create_instance_from_component_key",
  "create_instance_from_component_set_key",
  "get_instance_properties",
  "set_instance_properties",
  "swap_instance_component",
  "export_node_as_image",
  "scan_text_nodes",
  "create_rectangle",
  "create_frame",
  "create_text",
  "set_fill_color",
  "set_stroke_color",
  "set_layout_mode",
  "set_padding",
  "set_axis_align",
  "set_layout_sizing",
  "set_item_spacing",
  "move_node",
  "reparent_node",
  "get_parent_chain",
  "insert_child",
  "resize_node",
  "delete_node",
  "delete_multiple_nodes",
  "clone_node",
  "clone_node_into_parent",
  "set_corner_radius",
  "set_text_content",
  "set_multiple_text_contents",
  "getDocumentInfo",
  "getSelection",
  "renameNode",
  "setText",
  "createFrame",
  "createRectangle",
  "createText",
  "setSolidFill"
]);

function getPolicyTargetFrameIds(params) {
  return new Set();
}

function isNodeInTargetFrames(node, targetFrameIds) {
  if (!targetFrameIds || targetFrameIds.size === 0) return true;
  let cur = node;
  while (cur) {
    if (targetFrameIds.has(cur.id)) return true;
    cur = cur.parent;
  }
  return false;
}

function assertNodeWritable(node, params) {
  return;
}

async function resolveCreateHost(params) {
  const p = params && typeof params === "object" ? params : {};
  const parentNodeId = p.parentNodeId ? String(p.parentNodeId) : null;
  if (parentNodeId) {
    const host = await getNodeByIdAsync(parentNodeId);
    if (!("appendChild" in host)) throw new Error("Parent cannot contain children");
    return host;
  }
  return figma.currentPage;
}

async function createFrameNode(p) {
  const frame = figma.createFrame();
  frame.resize(
    Number(p.width === undefined || p.width === null ? 320 : p.width),
    Number(p.height === undefined || p.height === null ? 200 : p.height)
  );
  frame.x = Number(p.x === undefined || p.x === null ? 0 : p.x);
  frame.y = Number(p.y === undefined || p.y === null ? 0 : p.y);
  frame.name = p.name ? String(p.name) : "Frame";
  const host = await resolveCreateHost(p);
  host.appendChild(frame);
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  return { nodeId: frame.id, name: frame.name, type: frame.type };
}

async function createRectangleNode(p) {
  const rect = figma.createRectangle();
  rect.resize(
    Number(p.width === undefined || p.width === null ? 240 : p.width),
    Number(p.height === undefined || p.height === null ? 160 : p.height)
  );
  rect.x = Number(p.x === undefined || p.x === null ? 0 : p.x);
  rect.y = Number(p.y === undefined || p.y === null ? 0 : p.y);
  rect.name = p.name ? String(p.name) : "Rectangle";
  const host = await resolveCreateHost(p);
  host.appendChild(rect);
  figma.currentPage.selection = [rect];
  figma.viewport.scrollAndZoomIntoView([rect]);
  return { nodeId: rect.id, name: rect.name, type: rect.type };
}

async function createTextNode(p) {
  const text = figma.createText();
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  text.fontName = { family: "Inter", style: "Regular" };
  text.fontSize = Number(p.fontSize === undefined || p.fontSize === null ? 16 : p.fontSize);
  text.x = Number(p.x === undefined || p.x === null ? 0 : p.x);
  text.y = Number(p.y === undefined || p.y === null ? 0 : p.y);
  text.characters = p.characters === undefined || p.characters === null ? "" : String(p.characters);
  text.name = p.name ? String(p.name) : "Text";
  const host = await resolveCreateHost(p);
  host.appendChild(text);
  figma.currentPage.selection = [text];
  figma.viewport.scrollAndZoomIntoView([text]);
  return { nodeId: text.id, name: text.name, type: text.type };
}

function normalizeFigmaNodeId(nodeId) {
  const raw = nodeId === undefined || nodeId === null ? "" : String(nodeId);
  if (!raw) return raw;
  if (raw.indexOf(":") < 0 && raw.indexOf("-") >= 0) return raw.split("-").join(":");
  return raw;
}

async function addRenewalInfoPanel(params) {
  const p = params && typeof params === "object" ? params : {};
  const targetNodeId = normalizeFigmaNodeId(p.targetNodeId || p.nodeId);
  if (!targetNodeId) throw new Error("Missing targetNodeId");

  const target = await figma.getNodeByIdAsync(String(targetNodeId));
  if (!target) throw new Error("Node not found with ID: " + String(targetNodeId));

  const baseHost = target && "appendChild" in target ? target : target.parent;
  if (!baseHost || !("appendChild" in baseHost)) throw new Error("Target has no valid host container");

  const panelName = String(p.name || "Renewal info");
  const titleText = String(p.title || "Renewal information");
  const expiryDate = p.expiryDate === undefined || p.expiryDate === null ? "—" : String(p.expiryDate);
  const timesRenewed =
    p.timesRenewed === undefined || p.timesRenewed === null ? "—" : String(p.timesRenewed);
  const maxRenewals =
    p.maxRenewals === undefined || p.maxRenewals === null ? "—" : String(p.maxRenewals);

  const panelWidth = Number(p.width === undefined || p.width === null ? 320 : p.width);
  const margin = Number(p.margin === undefined || p.margin === null ? 40 : p.margin);
  const topOffset = Number(p.topOffset === undefined || p.topOffset === null ? 120 : p.topOffset);

  const fontTitle = await safeLoadFont("Inter", "Semi Bold");
  const fontLabel = await safeLoadFont("Inter", "Regular");
  const fontValue = await safeLoadFont("Inter", "Semi Bold");

  function findRightColumn(host) {
    if (!host || !("children" in host)) return null;
    const children = host.children || [];
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < children.length; i += 1) {
      const c = children[i];
      if (!c) continue;
      if (!("width" in c) || !("height" in c) || !("x" in c) || !("y" in c)) continue;
      const name = String(c.name || "").toLowerCase();
      const isFrameish = c.type === "FRAME" || c.type === "INSTANCE" || c.type === "COMPONENT";
      if (!isFrameish) continue;
      const w = Number(c.width);
      const h = Number(c.height);
      const x = Number(c.x);
      const hostW = "width" in host ? Number(host.width) : 0;
      const onRight = hostW ? x >= hostW * 0.6 : false;
      const sizeOk = w >= 280 && w <= 560 && h >= 200;
      if (!onRight || !sizeOk) continue;
      const nameBoost = /assistant|sidebar|summary|aside|right/.test(name) ? 1000 : 0;
      const score = nameBoost + x + h - Math.abs(400 - w);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  const rightColumn = findRightColumn(baseHost);
  const host = rightColumn || baseHost;

  if ("children" in host) {
    const existing = (host.children || []).find((c) => c && c.name === panelName);
    if (existing && "remove" in existing) {
      try {
        existing.remove();
      } catch (err) {}
    }
  }

  const panel = figma.createFrame();
  panel.name = panelName;
  panel.layoutMode = "VERTICAL";
  panel.primaryAxisSizingMode = "AUTO";
  panel.counterAxisSizingMode = "FIXED";
  panel.resize(panelWidth, 1);
  panel.primaryAxisAlignItems = "MIN";
  panel.counterAxisAlignItems = "MIN";
  panel.paddingTop = 16;
  panel.paddingRight = 16;
  panel.paddingBottom = 16;
  panel.paddingLeft = 16;
  panel.itemSpacing = 12;
  panel.cornerRadius = 8;
  setSolidPaint(panel, "#FBF7EE", 1);
  setStrokePaint(panel, "#D4C9B8", 1, 1);

  const title = await buildTextNode(titleText, fontTitle, 14, "#1A1A1A", "Title");
  panel.appendChild(title);

  const divider = figma.createRectangle();
  divider.name = "Divider";
  divider.resize(Math.max(1, panelWidth - 32), 1);
  setSolidPaint(divider, "#D4C9B8", 1);
  divider.strokes = [];
  panel.appendChild(divider);

  async function addField(label, value) {
    const field = figma.createFrame();
    field.name = label;
    field.fills = [];
    field.strokes = [];
    field.layoutMode = "VERTICAL";
    field.primaryAxisSizingMode = "AUTO";
    field.counterAxisSizingMode = "AUTO";
    field.primaryAxisAlignItems = "MIN";
    field.counterAxisAlignItems = "MIN";
    field.itemSpacing = 4;

    const labelNode = await buildTextNode(label, fontLabel, 12, "#6B5E52", "Label");
    const valueNode = await buildTextNode(value, fontValue, 14, "#1A1A1A", "Value");
    field.appendChild(labelNode);
    field.appendChild(valueNode);
    panel.appendChild(field);
  }

  await addField("Labour licence expiry date", expiryDate);
  await addField("Times renewed", timesRenewed);
  await addField("Max renewals", maxRenewals);

  host.appendChild(panel);

  if ("layoutMode" in host && host.layoutMode && host.layoutMode !== "NONE") {
    if ("layoutPositioning" in panel) panel.layoutPositioning = "ABSOLUTE";
  }

  if (rightColumn) {
    let y = 16;
    if ("children" in host) {
      const kids = host.children || [];
      let bottom = 0;
      for (let i = 0; i < kids.length; i += 1) {
        const c = kids[i];
        if (!c || c === panel) continue;
        if (!("x" in c) || !("y" in c) || !("width" in c) || !("height" in c)) continue;
        const b = Number(c.y) + Number(c.height);
        if (b > bottom) bottom = b;
      }
      if (bottom > 0) y = bottom + 16;
    }
    panel.x = 16;
    panel.y = y;
  } else {
    const hostW = "width" in host ? Number(host.width) : 0;
    const x = hostW ? Math.max(0, hostW - panelWidth - margin) : 0;
    panel.x = x;
    panel.y = topOffset;
  }

  figma.currentPage.selection = [panel];
  figma.viewport.scrollAndZoomIntoView([panel]);
  return {
    success: true,
    targetNodeId: target.id,
    hostNodeId: host.id,
    nodeId: panel.id
  };
}

function getAbsXY(node) {
  const t = node && node.absoluteTransform;
  if (!t || !Array.isArray(t) || !Array.isArray(t[0]) || !Array.isArray(t[1])) return { x: 0, y: 0 };
  return { x: Number(t[0][2]) || 0, y: Number(t[1][2]) || 0 };
}

function findAllTextNodes(root) {
  if (!root || typeof root.findAll !== "function") return [];
  return root.findAll((n) => n && n.type === "TEXT");
}

async function createRenewalTabScreen(params) {
  const p = params && typeof params === "object" ? params : {};
  function extractNodeIdFromUrl(url) {
    const s = String(url || "");
    const m = s.match(/[?&]node-id=([^&]+)/i);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (err) {
      return m[1];
    }
  }

  const fromUrl = p.url ? extractNodeIdFromUrl(p.url) : null;
  const fromSelection =
    !p.sourceNodeId && !p.nodeId && !p.frameNodeId && !fromUrl && figma.currentPage.selection.length
      ? figma.currentPage.selection[0].id
      : null;

  const sourceNodeId = normalizeFigmaNodeId(p.sourceNodeId || p.nodeId || p.frameNodeId || fromUrl || fromSelection);
  if (!sourceNodeId) throw new Error("Missing sourceNodeId");

  const source = await figma.getNodeByIdAsync(String(sourceNodeId));
  if (!source) throw new Error("Node not found with ID: " + String(sourceNodeId));
  if (!("clone" in source) || typeof source.clone !== "function") throw new Error("Target node is not cloneable");

  const spacing = Number(p.spacing === undefined || p.spacing === null ? 120 : p.spacing);
  const sourceX = "x" in source ? Number(source.x) : 0;
  const sourceY = "y" in source ? Number(source.y) : 0;
  const sourceH = "height" in source ? Number(source.height) : 0;

  const cloned = source.clone();
  const host = source.parent && "appendChild" in source.parent ? source.parent : figma.currentPage;
  host.appendChild(cloned);

  if ("x" in cloned) cloned.x = sourceX;
  if ("y" in cloned) cloned.y = sourceY + sourceH + spacing;
  cloned.name = p.name ? String(p.name) : String(source.name || "Screen") + " — Renewal";

  const cloneAbs = getAbsXY(cloned);
  const texts = findAllTextNodes(cloned);

  const renewalTexts = [];
  const tabCandidates = [];

  for (let i = 0; i < texts.length; i += 1) {
    const t = texts[i];
    const chars = String(t.characters || "");
    const abs = getAbsXY(t);
    if (/renewal/i.test(chars)) renewalTexts.push(t);

    const looksLikeTabLabel = chars.length > 0 && chars.length <= 24;
    const nearTop = abs.y >= cloneAbs.y && abs.y <= cloneAbs.y + 160;
    if (looksLikeTabLabel && nearTop) tabCandidates.push(t);
  }

  if (tabCandidates.length) {
    for (let i = 0; i < tabCandidates.length; i += 1) {
      const t = tabCandidates[i];
      const chars = String(t.characters || "");
      t.fills = [{ type: "SOLID", color: hexToRgb01(/renewal/i.test(chars) ? "#CC2020" : "#6B5E52") }];
    }
  }

  let header = null;
  let headerScore = -Infinity;
  for (let i = 0; i < texts.length; i += 1) {
    const t = texts[i];
    const abs = getAbsXY(t);
    const nearTop = abs.y >= cloneAbs.y && abs.y <= cloneAbs.y + 220;
    const fs = t.fontSize !== figma.mixed ? Number(t.fontSize) : NaN;
    if (!nearTop || !Number.isFinite(fs)) continue;
    const score = fs * 1000 - abs.y;
    if (score > headerScore) {
      header = t;
      headerScore = score;
    }
  }
  if (header) {
    try {
      await loadTextFont(header);
    } catch (err) {}
    header.characters = "Renewal";
  }

  try {
    await addRenewalInfoPanel({
      targetNodeId: cloned.id,
      name: "Renewal info",
      title: "Renewal information",
      expiryDate: p.expiryDate,
      timesRenewed: p.timesRenewed,
      maxRenewals: p.maxRenewals
    });
  } catch (err) {}

  figma.currentPage.selection = [cloned];
  figma.viewport.scrollAndZoomIntoView([cloned]);
  return { success: true, sourceNodeId: source.id, nodeId: cloned.id, name: cloned.name };
}

async function handleAction(action, payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (!activeTheme) {
    try {
      activeTheme = await buildThemeFromDocument();
    } catch (err) {
      activeTheme = createDefaultTheme();
    }
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error(`Action not allowed: ${action}`);
  }

  if (/delete|remove|reset|clear/i.test(String(action))) {
    if (action !== "delete_node" && action !== "delete_multiple_nodes") {
      throw new Error(`Blocked action: ${action}`);
    }
  }
  const isReadAction =
    action === "ping" ||
    /^(get_|scan_|export_|read_|import_)/.test(action) ||
    action === "getDocumentInfo" ||
    action === "getSelection";

  if (action === "ping") {
    return { pong: true };
  }

  if (action === "create_renewal_tab_screen") {
    return await createRenewalTabScreen(p);
  }

  if (action === "build_design_system_from_file") {
    const pageNames = ["🎨 Foundations", "🧱 Components", "🔄 Patterns", "✦ AI Surfaces", "🪶 Identity", "How to Use", "Test", "Test2"];
    const pages = pageNames.map((n) => ensurePage(n));
    await figma.setCurrentPageAsync(pages[0]);
    await Promise.all(pages.map((pg) => pg.loadAsync()));

    const theme = activeTheme || createDefaultTheme();
    const foundationBodyFont = await safeLoadFont(theme.typography.bodyFontName.family, theme.typography.bodyFontName.style);
    const foundationMonoFont = await safeLoadFont(theme.typography.monoFontName.family, theme.typography.monoFontName.style);

    const localPaintStyles = await getLocalPaintStyles();
    const paintStyleSpecs = localPaintStyles
      .map((s) => [s.name, paintStyleToHex(s)])
      .filter((spec) => Boolean(spec[1]));

    if (!paintStyleSpecs.length) {
      paintStyleSpecs.push(
        ["bg/surface", theme.roles.surface.hex],
        ["bg/muted", theme.roles.muted.hex],
        ["bg/primary", theme.roles.primary.hex],
        ["bg/accent", theme.roles.accent.hex],
        ["txt/primary", theme.roles.text.hex],
        ["txt/muted", theme.roles.textMuted.hex],
        ["border/default", theme.roles.border.hex]
      );
    }

    let localTextStyles = await getLocalTextStyles();
    const textStyleSpecs = localTextStyles.map((s) => ({ name: s.name }));

    pages[0].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[1].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[2].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[3].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[4].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[5].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[6].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });
    pages[7].children.slice().forEach((n) => {
      try {
        n.remove();
      } catch (err) {}
    });

    await figma.setCurrentPageAsync(pages[0]);
    const f0 = createHeadingFrame("Design System", "Foundations: local styles, tokens, spacing, shadows.");
    pages[0].appendChild(f0.frame);
    await styleHeadingFrame(
      f0.titleNode,
      f0.subtitleNode,
      "Design System",
      "Foundations: local styles, tokens, spacing, shadows."
    );

    const paintStyles = await getLocalPaintStyles();
    const effectStyles = await getLocalEffectStyles();
    localTextStyles = await getLocalTextStyles();

    const paintByName = new Map(paintStyles.map((s) => [s.name, s]));
    const effectByName = new Map(effectStyles.map((s) => [s.name, s]));
    const textByName = new Map(localTextStyles.map((s) => [s.name, s]));

    function createSectionHeader(title, x, y) {
      const t = figma.createText();
      t.fontName = foundationMonoFont;
      t.fontSize = 12;
      t.letterSpacing = { unit: "PERCENT", value: 10 };
      t.textCase = "UPPER";
      t.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      t.characters = title;
      t.x = x;
      t.y = y;
      return t;
    }

    async function applyPaintStyle(node, styleName, fallbackHex) {
      const style = paintByName.get(styleName);
      if (style) {
        await setFillStyleId(node, style.id);
        return;
      }
      node.fills = [{ type: "SOLID", color: hexToRgb01(fallbackHex) }];
    }

    async function applyEffectStyle(node, styleName) {
      const style = effectByName.get(styleName);
      if (style) await setEffectStyleId(node, style.id);
    }

    let yFound = 252;

    {
      pages[0].appendChild(createSectionHeader("Color Styles", 0, yFound));
      yFound += 22;

      const grid = figma.createFrame();
      grid.name = "Color Styles";
      grid.x = 0;
      grid.y = yFound;
      grid.fills = [];
      grid.strokes = [];

      const cols = 5;
      const cellW = 184;
      const cellH = 128;
      const swatchW = 168;
      const swatchH = 72;

      for (let i = 0; i < paintStyleSpecs.length; i += 1) {
        const name = paintStyleSpecs[i][0];
        const hex = paintStyleSpecs[i][1];
        const col = i % cols;
        const row = Math.floor(i / cols);

        const card = figma.createFrame();
        card.name = name;
        card.resize(cellW, cellH);
        card.x = col * cellW;
        card.y = row * cellH;
        card.fills = [];
        card.strokes = [];

        const swatch = figma.createRectangle();
        swatch.name = "Swatch";
        swatch.resize(swatchW, swatchH);
        swatch.x = 0;
        swatch.y = 0;
        swatch.cornerRadius = 8;
        await applyPaintStyle(swatch, name, hex);
        swatch.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
        swatch.strokeWeight = 1;
        card.appendChild(swatch);

        const label = figma.createText();
        label.name = "Name";
        label.fontName = foundationMonoFont;
        label.fontSize = 11;
        label.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
        label.characters = name;
        label.x = 0;
        label.y = 82;
        card.appendChild(label);

        const hexNode = figma.createText();
        hexNode.name = "Hex";
        hexNode.fontName = foundationMonoFont;
        hexNode.fontSize = 10;
        hexNode.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
        hexNode.characters = hex;
        hexNode.x = 0;
        hexNode.y = 102;
        card.appendChild(hexNode);

        grid.appendChild(card);
      }

      const rows = Math.ceil(paintStyleSpecs.length / cols);
      grid.resize(960, rows * cellH);
      pages[0].appendChild(grid);
      yFound += rows * cellH + 32;
    }

    {
      pages[0].appendChild(createSectionHeader("Text Styles", 0, yFound));
      yFound += 22;

      const list = figma.createFrame();
      list.name = "Text Styles";
      list.x = 0;
      list.y = yFound;
      list.fills = [];
      list.strokes = [];

      const rowH = 68;
      const nameW = 240;
      for (let i = 0; i < textStyleSpecs.length; i += 1) {
        const spec = textStyleSpecs[i];
        const row = figma.createFrame();
        row.name = spec.name;
        row.resize(960, rowH);
        row.x = 0;
        row.y = i * rowH;
        row.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
        row.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
        row.strokeWeight = 1;
        row.cornerRadius = 8;

        const nameNode = figma.createText();
        nameNode.name = "Style Name";
        nameNode.fontName = foundationMonoFont;
        nameNode.fontSize = 11;
        nameNode.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
        nameNode.characters = spec.name;
        nameNode.x = 16;
        nameNode.y = 16;
        row.appendChild(nameNode);

        const sample = figma.createText();
        sample.name = "Sample";
        sample.x = nameW;
        sample.y = 16;
        sample.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
        sample.fontName = foundationBodyFont;
        sample.fontSize = 16;
        sample.characters = "The quick brown fox jumps over the lazy dog.";

        const style = textByName.get(spec.name);
        if (style) {
          try {
            await safeLoadFont(style.fontName.family, style.fontName.style);
          } catch (err) {}
          await setTextStyleId(sample, style.id);
          sample.characters = "The quick brown fox jumps over the lazy dog.";
        }

        row.appendChild(sample);
        list.appendChild(row);
      }

      list.resize(960, textStyleSpecs.length * rowH);
      pages[0].appendChild(list);
      yFound += textStyleSpecs.length * rowH + 32;
    }

    {
      pages[0].appendChild(createSectionHeader("Effect Styles", 0, yFound));
      yFound += 22;

      const effectGrid = figma.createFrame();
      effectGrid.name = "Effect Styles";
      effectGrid.x = 0;
      effectGrid.y = yFound;
      effectGrid.fills = [];
      effectGrid.strokes = [];

      const effects = effectStyles.map((s) => s.name).slice(0, 3);
      if (!effects.length) effects.push("sh-sm", "sh-md", "sh-lg");
      for (let i = 0; i < effects.length; i += 1) {
        const name = effects[i];
        const card = figma.createFrame();
        card.name = name;
        card.resize(300, 140);
        card.x = i * 320;
        card.y = 0;
        card.fills = [];
        card.strokes = [];

        const rect = figma.createRectangle();
        rect.name = "Shadow Card";
        rect.resize(300, 96);
        rect.x = 0;
        rect.y = 0;
        rect.cornerRadius = 12;
        rect.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
        rect.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
        rect.strokeWeight = 1;
        await applyEffectStyle(rect, name);
        card.appendChild(rect);

        const label = figma.createText();
        label.name = "Name";
        label.fontName = foundationMonoFont;
        label.fontSize = 11;
        label.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
        label.characters = name;
        label.x = 0;
        label.y = 110;
        card.appendChild(label);

        effectGrid.appendChild(card);
      }

      effectGrid.resize(960, 140);
      pages[0].appendChild(effectGrid);
      yFound += 172;
    }

    await figma.setCurrentPageAsync(pages[1]);
    const f1 = createHeadingFrame("Components", "Placeholders created. Next: build variants & properties.");
    pages[1].appendChild(f1.frame);
    await styleHeadingFrame(f1.titleNode, f1.subtitleNode, "Components", "Placeholders created. Next: build variants & properties.");

    const atoms = [
      "Button",
      "Text Input",
      "Textarea",
      "Select",
      "Date Input",
      "Number Input",
      "File Upload",
      "Tag / Pill",
      "Checkbox",
      "Radio",
      "Toggle / Switch",
      "Phase Banner",
      "Skip Link",
      "Brand Stripe",
      "Icon"
    ];
    const molecules = [
      "Search Bar",
      "Breadcrumb",
      "Pagination",
      "Callout",
      "Inset Text",
      "Summary List",
      "Task List (Progress steps)",
      "Tooltip"
    ];
    const organisms = [
      "Table",
      "Accordion",
      "Alert Dialog",
      "Tabs",
      "Cookies Banner",
      "Header"
    ];

    const aiSurfaces = [
      "StreamingText",
      "ChatBubble",
      "ToolUseIndicator",
      "CitationBadge",
      "ConversationThread",
      "AgentStatusBar"
    ];

    const labelFont = await safeLoadFont("IBM Plex Mono", "Medium");
    const componentRegistry = new Map();

    function layoutVariantSet(setNode) {
      const children = setNode.children ? setNode.children.slice() : [];
      const gap = 20;
      const colW = 300;
      const rowH = 76;
      const cols = 3;
      for (let i = 0; i < children.length; i += 1) {
        const c = children[i];
        c.x = (i % cols) * colW;
        c.y = Math.floor(i / cols) * rowH;
      }
      const rows = Math.max(1, Math.ceil(children.length / cols));
      setNode.resize(cols * colW - gap, rows * rowH - 20);
    }

    function registerComponent(name, node) {
      const key = String(name).toLowerCase();
      if (!node) return;
      if (node.type === "COMPONENT") {
        componentRegistry.set(key, node);
        componentRegistry.set(String(node.name).toLowerCase(), node);
        return;
      }
      if (node.type === "COMPONENT_SET" && node.children) {
        const children = node.children.filter((c) => c.type === "COMPONENT");
        const byDefault =
          children.find((c) => c.name.indexOf("State=Default") >= 0) ||
          children.find((c) => c.name.indexOf("State=Unchecked") >= 0) ||
          children[0] ||
          null;
        if (byDefault) {
          componentRegistry.set(key, byDefault);
          componentRegistry.set(String(node.name).toLowerCase(), byDefault);
        }
      }
    }

    async function placeSection(title, items, startY) {
      const header = figma.createText();
      header.fontName = labelFont;
      header.fontSize = 12;
      header.letterSpacing = { unit: "PERCENT", value: 10 };
      header.textCase = "UPPER";
      header.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      header.characters = title;
      header.x = 0;
      header.y = startY;
      pages[1].appendChild(header);
      let y = startY + 36;
      const itemFont = await safeLoadFont("Noto Sans", "Regular");
      for (let i = 0; i < items.length; i += 1) {
        const previewComponent = await buildComponentPreviewComponent(items[i], itemFont, labelFont);
        registerComponent(items[i], previewComponent);

        const row = figma.createFrame();
        row.name = items[i];
        row.resize(960, 220);
        row.x = 0;
        row.y = y;
        row.fills = [];
        row.strokes = [];

        const label = figma.createText();
        label.fontName = itemFont;
        label.fontSize = 14;
        label.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
        label.characters = items[i];
        label.x = 0;
        label.y = 0;
        row.appendChild(label);

        if (previewComponent) {
          previewComponent.x = 0;
          previewComponent.y = 32;
          row.appendChild(previewComponent);
          if (previewComponent.type === "COMPONENT_SET") {
            layoutVariantSet(previewComponent);
          }
          row.resize(960, 32 + previewComponent.height + 24);
        }

        pages[1].appendChild(row);
        y += row.height + 32;
      }
      return y;
    }

    let yCursor = 260;
    yCursor = await placeSection("Atoms", atoms, yCursor);
    yCursor = await placeSection("Molecules", molecules, yCursor);
    yCursor = await placeSection("Organisms", organisms, yCursor);

    await figma.setCurrentPageAsync(pages[3]);
    const f3 = createHeadingFrame("AI Surfaces", "AI interface components (2026): chat, tool use, citations, streaming, status.");
    pages[3].appendChild(f3.frame);
    await styleHeadingFrame(
      f3.titleNode,
      f3.subtitleNode,
      "AI Surfaces",
      "AI interface components (2026): chat, tool use, citations, streaming, status."
    );

    let xAi = 0;
    let yAi = 260;
    const surfaceFont = await safeLoadFont("Noto Sans", "Regular");
    for (let i = 0; i < aiSurfaces.length; i += 1) {
      const ph = createComponentPlaceholder(aiSurfaces[i], xAi, yAi);
      pages[3].appendChild(ph.frame);
      ph.label.fontName = surfaceFont;
      ph.label.fontSize = 14;
      ph.label.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
      ph.label.characters = aiSurfaces[i];
      const aiComponent = await buildAiSurfaceComponent(aiSurfaces[i], surfaceFont, labelFont);
      if (aiComponent) {
        aiComponent.x = 20;
        aiComponent.y = 44;
        ph.frame.appendChild(aiComponent);
      }
      if (xAi === 0) {
        xAi = 340;
      } else {
        xAi = 0;
        yAi += 260;
      }
    }

    await figma.setCurrentPageAsync(pages[2]);
    const f2 = createHeadingFrame("Patterns", "Reusable pattern frames (placeholders).");
    pages[2].appendChild(f2.frame);
    await styleHeadingFrame(f2.titleNode, f2.subtitleNode, "Patterns", "Reusable pattern frames (placeholders).");

    const patternNames = [
      "Single-column form with inline validation (EN labels)",
      "Multi-step wizard (Task List + Backlink + Save and continue later)",
      "Table with filters, search bar, pagination",
      "Empty state with hornbill illustration + EN heading + CTA"
    ];
    const patternFont = await safeLoadFont("Noto Sans", "Regular");
    function findComponentByKey(name) {
      const key = String(name).toLowerCase();
      const direct = componentRegistry.get(key);
      if (direct) return direct;
      if (key === "tag / pill") return componentRegistry.get("tag");
      if (key === "toggle / switch") return componentRegistry.get("switch");
      if (key === "task list (progress steps)") return componentRegistry.get("task list");
      return null;
    }

    function createInstance(name) {
      const comp = findComponentByKey(name);
      if (!comp) return null;
      return comp.createInstance();
    }

    async function addPatternHeader(frame, title) {
      const t = await buildTextNode(title, patternFont, 14, "#1A1A1A", "Pattern Title");
      t.x = 16;
      t.y = 16;
      frame.appendChild(t);
      return t;
    }

    function newPatternFrame(name, x, y, height) {
      const fr = figma.createFrame();
      fr.name = name;
      fr.resize(960, Number(height));
      fr.x = x;
      fr.y = y;
      fr.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      fr.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
      fr.strokeWeight = 1;
      return fr;
    }

    let py = 260;

    {
      const fr = newPatternFrame(patternNames[0], 0, py, 540);
      await addPatternHeader(fr, patternNames[0]);

      const heading = await buildTextNode("Application form", patternFont, 20, "#1A1A1A", "Heading");
      heading.x = 16;
      heading.y = 56;
      fr.appendChild(heading);

      const input1 = createInstance("Text Input");
      const input2 = createInstance("Text Input");
      const input3 = createInstance("Text Input");
      const callout = createInstance("Callout");
      const checkbox = createInstance("Checkbox");
      const button = createInstance("Button");

      if (input1) {
        input1.x = 16;
        input1.y = 110;
        fr.appendChild(input1);
      }
      if (input2) {
        input2.x = 16;
        input2.y = 180;
        fr.appendChild(input2);
      }
      if (callout) {
        callout.x = 16;
        callout.y = 250;
        fr.appendChild(callout);
      }
      if (input3) {
        input3.x = 16;
        input3.y = 330;
        fr.appendChild(input3);
      }
      if (checkbox) {
        checkbox.x = 16;
        checkbox.y = 405;
        fr.appendChild(checkbox);
      }
      if (button) {
        button.x = 16;
        button.y = 465;
        fr.appendChild(button);
      }

      pages[2].appendChild(fr);
      py += 564;
    }

    {
      const fr = newPatternFrame(patternNames[1], 0, py, 560);
      await addPatternHeader(fr, patternNames[1]);

      const heading = await buildTextNode("Step 2 of 4", patternFont, 20, "#1A1A1A", "Heading");
      heading.x = 16;
      heading.y = 56;
      fr.appendChild(heading);

      const back = await buildTextNode("Back", patternFont, 12, "#3A6EA8", "Backlink");
      back.x = 16;
      back.y = 92;
      fr.appendChild(back);

      const taskList = createInstance("Task List (Progress steps)");
      if (taskList) {
        taskList.x = 16;
        taskList.y = 130;
        fr.appendChild(taskList);
      }

      const input = createInstance("Text Input");
      if (input) {
        input.x = 16;
        input.y = 230;
        fr.appendChild(input);
      }

      const primary = createInstance("Button");
      if (primary) {
        primary.x = 16;
        primary.y = 310;
        fr.appendChild(primary);
      }

      const secondary = createInstance("Button");
      if (secondary) {
        secondary.x = 320;
        secondary.y = 310;
        fr.appendChild(secondary);
      }

      const saveLater = await buildTextNode("Save and continue later", patternFont, 12, "#3A6EA8", "SaveLater");
      saveLater.x = 16;
      saveLater.y = 390;
      fr.appendChild(saveLater);

      pages[2].appendChild(fr);
      py += 584;
    }

    {
      const fr = newPatternFrame(patternNames[2], 0, py, 560);
      await addPatternHeader(fr, patternNames[2]);

      const heading = await buildTextNode("Records", patternFont, 20, "#1A1A1A", "Heading");
      heading.x = 16;
      heading.y = 56;
      fr.appendChild(heading);

      const search = createInstance("Search Bar");
      if (search) {
        search.x = 16;
        search.y = 110;
        fr.appendChild(search);
      }

      const tag = createInstance("Tag / Pill");
      if (tag) {
        tag.x = 320;
        tag.y = 110;
        fr.appendChild(tag);
      }

      const table = createInstance("Table");
      if (table) {
        table.x = 16;
        table.y = 190;
        fr.appendChild(table);
      }

      const pagination = createInstance("Pagination");
      if (pagination) {
        pagination.x = 16;
        pagination.y = 300;
        fr.appendChild(pagination);
      }

      pages[2].appendChild(fr);
      py += 584;
    }

    {
      const fr = newPatternFrame(patternNames[3], 0, py, 520);
      await addPatternHeader(fr, patternNames[3]);

      const illo = figma.createFrame();
      illo.name = "Illustration (Placeholder)";
      illo.resize(220, 160);
      illo.x = 16;
      illo.y = 90;
      setSolidPaint(illo, "#F5EDD8", 1);
      setStrokePaint(illo, "#D4C9B8", 1, 1);
      illo.cornerRadius = 10;
      fr.appendChild(illo);

      const heading = await buildTextNode("No results found", patternFont, 20, "#1A1A1A", "Heading");
      heading.x = 260;
      heading.y = 110;
      fr.appendChild(heading);

      const body = await buildTextNode("Try adjusting your filters or search query.", patternFont, 14, "#3A3530", "Body");
      body.x = 260;
      body.y = 150;
      fr.appendChild(body);

      const cta = createInstance("Button");
      if (cta) {
        cta.x = 260;
        cta.y = 200;
        fr.appendChild(cta);
      }

      pages[2].appendChild(fr);
      py += 544;
    }

    await figma.setCurrentPageAsync(pages[4]);
    const f4 = createHeadingFrame("Identity", "Brand colors, typography, spacing, and reusable motifs.");
    pages[4].appendChild(f4.frame);
    await styleHeadingFrame(
      f4.titleNode,
      f4.subtitleNode,
      "Identity",
      "Brand colors, typography, spacing, and reusable motifs."
    );

    const identityFont = await safeLoadFont(theme.typography.bodyFontName.family, theme.typography.bodyFontName.style);

    const brandStripe = figma.createFrame();
    brandStripe.name = "Brand Stripe";
    brandStripe.resize(960, 160);
    brandStripe.x = 0;
    brandStripe.y = 260;
    brandStripe.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
    brandStripe.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
    brandStripe.strokeWeight = 1;

    const stripe = figma.createFrame();
    stripe.name = "Stripe";
    stripe.resize(920, 24);
    stripe.x = 20;
    stripe.y = 70;
    stripe.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
    stripe.strokes = [];
    brandStripe.appendChild(stripe);

    const red = figma.createRectangle();
    red.resize(360, 24);
    red.x = 0;
    red.y = 0;
    red.fills = [{ type: "SOLID", color: hexToRgb01("#CC2020") }];
    stripe.appendChild(red);

    const yellow = figma.createRectangle();
    yellow.resize(220, 24);
    yellow.x = 360;
    yellow.y = 0;
    yellow.fills = [{ type: "SOLID", color: hexToRgb01("#F4C417") }];
    stripe.appendChild(yellow);

    const black = figma.createRectangle();
    black.resize(340, 24);
    black.x = 580;
    black.y = 0;
    black.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    stripe.appendChild(black);

    const stripeLabel = figma.createText();
    stripeLabel.fontName = identityFont;
    stripeLabel.fontSize = 14;
    stripeLabel.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    stripeLabel.characters = "Decorative only — never functional";
    stripeLabel.x = 20;
    stripeLabel.y = 24;
    brandStripe.appendChild(stripeLabel);
    pages[4].appendChild(brandStripe);

    const motif = figma.createFrame();
    motif.name = "Motif (Placeholder)";
    motif.resize(960, 260);
    motif.x = 0;
    motif.y = 440;
    motif.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    motif.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
    motif.strokeWeight = 1;

    const motifText = figma.createText();
    motifText.fontName = identityFont;
    motifText.fontSize = 14;
    motifText.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
    motifText.characters = "Replace with approved pattern assets.\nOpacity guidance: 7–12% over dark surfaces.";
    motifText.x = 20;
    motifText.y = 20;
    motif.appendChild(motifText);
    pages[4].appendChild(motif);

    const illustration = figma.createFrame();
    illustration.name = "Illustration (Placeholder)";
    illustration.resize(960, 260);
    illustration.x = 0;
    illustration.y = 720;
    illustration.fills = [{ type: "SOLID", color: hexToRgb01("#F5EDD8") }];
    illustration.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
    illustration.strokeWeight = 1;

    const illustrationText = figma.createText();
    illustrationText.fontName = identityFont;
    illustrationText.fontSize = 14;
    illustrationText.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    illustrationText.characters = "Illustration placeholder.\nUse approved brand assets.";
    illustrationText.x = 20;
    illustrationText.y = 20;
    illustration.appendChild(illustrationText);
    pages[4].appendChild(illustration);

    await figma.setCurrentPageAsync(pages[5]);
    const f5 = createHeadingFrame(
      "How to Use",
      "Quick guide for designers: use semantic tokens, component properties, and modes to stay consistent."
    );
    pages[5].appendChild(f5.frame);
    await styleHeadingFrame(
      f5.titleNode,
      f5.subtitleNode,
      "How to Use",
      "Quick guide for designers: use semantic tokens, component properties, and modes to stay consistent."
    );

    const howToBodyFont = await safeLoadFont("Noto Sans", "Regular");
    const howToMonoFont = await safeLoadFont("IBM Plex Mono", "Medium");

    function addHowToSection(title, body, y) {
      const t = figma.createText();
      t.fontName = howToMonoFont;
      t.fontSize = 12;
      t.letterSpacing = { unit: "PERCENT", value: 10 };
      t.textCase = "UPPER";
      t.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      t.characters = title;
      t.x = 0;
      t.y = y;
      pages[5].appendChild(t);

      const b = figma.createText();
      b.fontName = howToBodyFont;
      b.fontSize = 14;
      b.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
      b.characters = body;
      b.x = 0;
      b.y = y + 22;
      pages[5].appendChild(b);

      return y + 22 + 140;
    }

    let yHow = 260;
    yHow = addHowToSection(
      "Start Here",
      "1) Use Components from the Library (don’t detach).\n2) Use component properties/variants for state (hover, focus, disabled).\n3) Use Tokens (variables/styles) instead of hard-coded colors and effects.\n4) Validate contrast and focus visibility before handoff.",
      yHow
    );

    yHow = addHowToSection(
      "Variables (Tokens)",
      "A typical variable setup has three layers:\n• Primitive tokens: raw values (brand reds, neutrals, spacing steps).\n• Semantic tokens: meaning-based aliases (bg/primary, txt/900, fr/primary).\n• Component tokens: per-component hooks (Button/bg, Input/border, Focus/ring).\nDesigners should apply semantic/component tokens so the UI adapts if the theme changes.",
      yHow
    );

    yHow = addHowToSection(
      "Collections & Modes",
      "Create token collections per theme scope (e.g., product or brand). Add modes for UI contexts:\n• Light (default)\n• Dark (optional)\n• High Contrast (accessibility)\nSemantic tokens should switch values per mode. Components should reference semantic tokens so mode switching is automatic.",
      yHow
    );

    yHow = addHowToSection(
      "How Tokens Are Used",
      "In Figma, tokens can be applied through:\n• Styles (Paint/Text/Effect) for consistent application across layers.\n• Variables (color/number/string/boolean) for mode-aware values.\nBest practice: define variables first, then bind styles/components to variables.\nIf you must choose one: bind components directly to semantic variables, and keep styles as convenient presets.",
      yHow
    );

    yHow = addHowToSection(
      "Component Usage",
      "Keep components publishable:\n• Don’t detach instances.\n• Use instance swaps for icons.\n• Use auto-layout for responsive resizing.\n• Prefer properties/variants over manual overrides.\nWhen customizing, override text content and spacing, not core color tokens.",
      yHow
    );

    yHow = addHowToSection(
      "Naming & Consistency",
      "Recommended conventions:\n• Tokens: category/name (bg/primary, txt/700, otl/default)\n• Components: Component/Variant (Button/Primary)\n• Patterns: Frame titles describe intent (e.g., “Table with filters, search, pagination”).\nIf you need a new token, add it as a semantic alias instead of adding a one-off color.",
      yHow
    );

    await figma.setCurrentPageAsync(pages[6]);
    const f6 = createHeadingFrame(
      "Test",
      "End-to-end mockup: Labour License submission inside an Approval in Principle workflow (employer applying on behalf of employees)."
    );
    pages[6].appendChild(f6.frame);
    await styleHeadingFrame(
      f6.titleNode,
      f6.subtitleNode,
      "Test",
      "End-to-end mockup: Labour License submission inside an Approval in Principle workflow (employer applying on behalf of employees)."
    );

    const testBodyFont = await safeLoadFont("Noto Sans", "Regular");
    const testMonoFont = await safeLoadFont("IBM Plex Mono", "Medium");

    function createDsInstance(name) {
      const key = String(name).toLowerCase();
      const comp = componentRegistry.get(key);
      return comp ? comp.createInstance() : null;
    }

    function createScreenFrame(name, x, y, width, height) {
      const fr = figma.createFrame();
      fr.name = name;
      fr.resize(Number(width), Number(height));
      fr.x = Number(x);
      fr.y = Number(y);
      fr.cornerRadius = 12;
      fr.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      fr.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
      fr.strokeWeight = 1;
      return fr;
    }

    async function setFirstText(instanceNode, text) {
      const nodes = instanceNode && "findAll" in instanceNode ? instanceNode.findAll((n) => n.type === "TEXT") : [];
      if (!nodes.length) return false;
      const t = nodes[0];
      await loadTextFont(t);
      t.characters = String(text);
      return true;
    }

    function findComponentSet(setName) {
      const matches = pages[1].findAll((n) => n.type === "COMPONENT_SET" && n.name === String(setName));
      return matches.length ? matches[0] : null;
    }

    function findVariantComponent(setName, includes) {
      const set = findComponentSet(setName);
      if (!set || !set.children) return null;
      const kids = set.children.filter((n) => n.type === "COMPONENT");
      const match = kids.find((c) => c.name.indexOf(includes) >= 0);
      return match || null;
    }

    function createVariantInstance(setName, includes) {
      const c = findVariantComponent(setName, includes);
      return c ? c.createInstance() : null;
    }

    function addPrototypeLink(node, destination) {
      try {
        node.reactions = [
          {
            trigger: { type: "ON_CLICK" },
            action: { type: "NODE", destinationId: destination.id, navigation: "NAVIGATE" }
          }
        ];
      } catch (err) {}
    }

    function addTopNav(container, width) {
      const stripe = figma.createFrame();
      stripe.name = "Brand Stripe";
      stripe.resize(width, 4);
      stripe.x = 0;
      stripe.y = 0;
      stripe.fills = [];
      stripe.strokes = [];

      const red = figma.createRectangle();
      red.resize(Math.floor(width * 0.4), 4);
      red.x = 0;
      red.y = 0;
      setSolidPaint(red, "#CC2020", 1);
      red.strokes = [];
      stripe.appendChild(red);

      const yellow = figma.createRectangle();
      yellow.resize(Math.floor(width * 0.2), 4);
      yellow.x = Math.floor(width * 0.4);
      yellow.y = 0;
      setSolidPaint(yellow, "#F4C417", 1);
      yellow.strokes = [];
      stripe.appendChild(yellow);

      const black = figma.createRectangle();
      black.resize(width - Math.floor(width * 0.6), 4);
      black.x = Math.floor(width * 0.6);
      black.y = 0;
      setSolidPaint(black, "#1A1A1A", 1);
      black.strokes = [];
      stripe.appendChild(black);

      const bar = figma.createRectangle();
      bar.name = "Top Bar";
      bar.resize(width, 64);
      bar.x = 0;
      bar.y = 4;
      setSolidPaint(bar, "#1A1A1A", 1);
      bar.strokes = [];

      const title = figma.createText();
      title.fontName = testBodyFont;
      title.fontSize = 16;
      title.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      title.characters = "Approval in Principle · Labour License";
      title.x = 16;
      title.y = 24;

      const nav = figma.createText();
      nav.fontName = testMonoFont;
      nav.fontSize = 11;
      nav.fills = [{ type: "SOLID", color: hexToRgb01("#F4C417") }];
      nav.characters = "AI Surfaces";
      nav.x = width - 100;
      nav.y = 26;

      container.appendChild(stripe);
      container.appendChild(bar);
      container.appendChild(title);
      container.appendChild(nav);
    }

    function addPanel(container, x, y, w, h, name) {
      const panel = figma.createFrame();
      panel.name = name;
      panel.resize(w, h);
      panel.x = x;
      panel.y = y;
      panel.cornerRadius = 12;
      panel.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      panel.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
      panel.strokeWeight = 1;
      container.appendChild(panel);
      return panel;
    }

    function addSectionLabel(container, text, x, y) {
      const t = figma.createText();
      t.fontName = testMonoFont;
      t.fontSize = 12;
      t.letterSpacing = { unit: "PERCENT", value: 10 };
      t.textCase = "UPPER";
      t.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      t.characters = text;
      t.x = x;
      t.y = y;
      container.appendChild(t);
      return t;
    }

    const screenW = 1440;
    const screenH = 900;
    const startX = 0;
    let sy = 260;

    const overview = createScreenFrame("01 Overview", startX, sy, screenW, screenH);
    pages[6].appendChild(overview);
    addTopNav(overview, screenW);

    const main = addPanel(overview, 40, 92, 920, 760, "Main");
    const ai = addPanel(overview, 1000, 92, 400, 760, "AI Assistant");

    addSectionLabel(main, "Application summary", 20, 20);
    const h = figma.createText();
    h.fontName = testBodyFont;
    h.fontSize = 24;
    h.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    h.characters = "Submit Labour License (Approval in Principle)";
    h.x = 20;
    h.y = 44;
    main.appendChild(h);

    const sub = figma.createText();
    sub.fontName = testBodyFont;
    sub.fontSize = 14;
    sub.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    sub.characters = "Employer flow: provide employee details, licence information, and supporting documents, then submit for processing.";
    sub.x = 20;
    sub.y = 80;
    main.appendChild(sub);

    const taskList = createDsInstance("Task List");
    if (taskList) {
      taskList.x = 20;
      taskList.y = 120;
      main.appendChild(taskList);
    }

    const startBtn = createDsInstance("Button");
    if (startBtn) {
      startBtn.x = 20;
      startBtn.y = 220;
      main.appendChild(startBtn);
      await setFirstText(startBtn, "Start labour license submission");
    }

    const convMaster = await buildAiSurfaceComponent("ConversationThread", testBodyFont, testMonoFont);
    if (convMaster) {
      convMaster.x = -4000;
      convMaster.y = 300;
      pages[6].appendChild(convMaster);
    }
    const statusMaster = await buildAiSurfaceComponent("AgentStatusBar", testBodyFont, testMonoFont);
    if (statusMaster) {
      statusMaster.x = -4000;
      statusMaster.y = 520;
      pages[6].appendChild(statusMaster);
    }
    const threadInstance = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (threadInstance) {
      threadInstance.x = 20;
      threadInstance.y = 20;
      ai.appendChild(threadInstance);
    }

    const mobile = createScreenFrame("Mobile · Step 1 (stacked)", 1520, 260, 375, 812);
    pages[6].appendChild(mobile);
    addTopNav(mobile, 375);
    const mMain = addPanel(mobile, 16, 92, 343, 560, "Main");
    addSectionLabel(mMain, "Step 1 of 5", 16, 16);
    const mH = figma.createText();
    mH.fontName = testBodyFont;
    mH.fontSize = 18;
    mH.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    mH.characters = "Employer details";
    mH.x = 16;
    mH.y = 40;
    mMain.appendChild(mH);

    const mCompany = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const mReg = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const mSector = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    await addField(mMain, "Company name *", mCompany, 16, 78);
    await addField(mMain, "Registration no. *", mReg, 16, 168);
    await addField(mMain, "Sector *", mSector, 16, 258);

    const mNext = createDsInstance("Button");
    if (mNext) {
      mNext.x = 16;
      mNext.y = 380;
      mMain.appendChild(mNext);
      await setFirstText(mNext, "Next");
    }

    const mAi = addPanel(mobile, 16, 670, 343, 126, "AI Assistant (collapsed)");
    const mAiLabel = figma.createText();
    mAiLabel.fontName = testMonoFont;
    mAiLabel.fontSize = 11;
    mAiLabel.letterSpacing = { unit: "PERCENT", value: 10 };
    mAiLabel.textCase = "UPPER";
    mAiLabel.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
    mAiLabel.characters = "AI Assistant";
    mAiLabel.x = 16;
    mAiLabel.y = 16;
    mAi.appendChild(mAiLabel);
    const mAiBody = figma.createText();
    mAiBody.fontName = testBodyFont;
    mAiBody.fontSize = 12;
    mAiBody.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    mAiBody.characters = "Mobile layout stacks assistance below the form.";
    mAiBody.x = 16;
    mAiBody.y = 40;
    mAi.appendChild(mAiBody);

    sy += screenH + 80;

    const step1 = createScreenFrame("02 Step 1 · Employer & application details", startX, sy, screenW, screenH);
    pages[6].appendChild(step1);
    addTopNav(step1, screenW);
    const main1 = addPanel(step1, 40, 92, 920, 760, "Main");
    const ai1 = addPanel(step1, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main1, "Step 1 of 5", 20, 20);

    const s1h = figma.createText();
    s1h.fontName = testBodyFont;
    s1h.fontSize = 22;
    s1h.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    s1h.characters = "Employer and application details";
    s1h.x = 20;
    s1h.y = 44;
    main1.appendChild(s1h);

    const s1hint = figma.createText();
    s1hint.fontName = testBodyFont;
    s1hint.fontSize = 13;
    s1hint.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    s1hint.characters = "Fields marked required must be completed before you can continue.";
    s1hint.x = 20;
    s1hint.y = 78;
    main1.appendChild(s1hint);

    function addFieldLabel(container, text, x, y) {
      const t = figma.createText();
      t.fontName = testBodyFont;
      t.fontSize = 12;
      t.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
      t.characters = text;
      t.x = x;
      t.y = y;
      container.appendChild(t);
      return t;
    }

    async function addField(container, label, instance, x, y) {
      addFieldLabel(container, label, x, y);
      if (!instance) return null;
      instance.x = x;
      instance.y = y + 18;
      container.appendChild(instance);
      return instance;
    }

    const fieldCompanyName = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const fieldRegNo = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const fieldSector = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    const fieldState = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    const fieldContact = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const fieldEmail = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const fieldPhone = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const fieldStartDate = createVariantInstance("Date Input", "State=Default") || createDsInstance("Date Input");

    await addField(main1, "Company name *", fieldCompanyName, 20, 120);
    await addField(main1, "Business registration no. *", fieldRegNo, 340, 120);
    await addField(main1, "Sector *", fieldSector, 20, 210);
    await addField(main1, "State *", fieldState, 340, 210);
    await addField(main1, "Contact person *", fieldContact, 20, 300);
    await addField(main1, "Email *", fieldEmail, 340, 300);
    await addField(main1, "Phone", fieldPhone, 20, 390);
    await addField(main1, "Intended start date *", fieldStartDate, 340, 390);

    const next1 = createDsInstance("Button");
    if (next1) {
      next1.x = 20;
      next1.y = 500;
      main1.appendChild(next1);
      await setFirstText(next1, "Next");
    }

    const thread1 = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread1) {
      thread1.x = 20;
      thread1.y = 20;
      ai1.appendChild(thread1);
    }

    sy += screenH + 80;

    const step1Error = createScreenFrame("02a Step 1 · Validation errors", startX, sy, screenW, screenH);
    pages[6].appendChild(step1Error);
    addTopNav(step1Error, screenW);
    const main1e = addPanel(step1Error, 40, 92, 920, 760, "Main");
    const ai1e = addPanel(step1Error, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main1e, "Validation", 20, 20);
    const eH = figma.createText();
    eH.fontName = testBodyFont;
    eH.fontSize = 22;
    eH.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    eH.characters = "Please fix the required fields";
    eH.x = 20;
    eH.y = 44;
    main1e.appendChild(eH);

    const callout = figma.createFrame();
    callout.name = "Error callout";
    callout.resize(880, 70);
    callout.x = 20;
    callout.y = 90;
    callout.cornerRadius = 10;
    callout.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
    callout.strokes = [{ type: "SOLID", color: hexToRgb01("#C0392B") }];
    callout.strokeWeight = 2;
    main1e.appendChild(callout);

    const cTxt = figma.createText();
    cTxt.fontName = testBodyFont;
    cTxt.fontSize = 13;
    cTxt.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    cTxt.characters = "Missing required information. Check highlighted fields and provide the required documents before continuing.";
    cTxt.x = 16;
    cTxt.y = 16;
    callout.appendChild(cTxt);

    const errCompany = createVariantInstance("Text Input", "State=Error") || createDsInstance("Text Input");
    const errRegNo = createVariantInstance("Text Input", "State=Error") || createDsInstance("Text Input");
    const errSector = createVariantInstance("Select", "State=Error") || createDsInstance("Select");
    const errState = createVariantInstance("Select", "State=Error") || createDsInstance("Select");

    await addField(main1e, "Company name *", errCompany, 20, 180);
    await addField(main1e, "Business registration no. *", errRegNo, 340, 180);
    await addField(main1e, "Sector *", errSector, 20, 270);
    await addField(main1e, "State *", errState, 340, 270);

    const fixBtn = createDsInstance("Button");
    if (fixBtn) {
      fixBtn.x = 20;
      fixBtn.y = 390;
      main1e.appendChild(fixBtn);
      await setFirstText(fixBtn, "Continue");
    }

    const thread1e = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread1e) {
      thread1e.x = 20;
      thread1e.y = 20;
      ai1e.appendChild(thread1e);
    }

    sy += screenH + 80;

    const step2 = createScreenFrame("03 Step 2 · Employees", startX, sy, screenW, screenH);
    pages[6].appendChild(step2);
    addTopNav(step2, screenW);
    const main2 = addPanel(step2, 40, 92, 920, 760, "Main");
    const ai2 = addPanel(step2, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main2, "Step 2 of 5", 20, 20);
    const s2h = figma.createText();
    s2h.fontName = testBodyFont;
    s2h.fontSize = 22;
    s2h.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    s2h.characters = "Employees included in this labour license";
    s2h.x = 20;
    s2h.y = 44;
    main2.appendChild(s2h);

    const search = createDsInstance("Search Bar");
    if (search) {
      search.x = 20;
      search.y = 90;
      main2.appendChild(search);
    }

    const tbl = createDsInstance("Table");
    if (tbl) {
      tbl.x = 20;
      tbl.y = 150;
      main2.appendChild(tbl);
    }

    const addEmp = createDsInstance("Button");
    if (addEmp) {
      addEmp.x = 20;
      addEmp.y = 310;
      main2.appendChild(addEmp);
      await setFirstText(addEmp, "Add employee");
    }

    const next2 = createDsInstance("Button");
    if (next2) {
      next2.x = 20;
      next2.y = 390;
      main2.appendChild(next2);
      await setFirstText(next2, "Next");
    }

    const thread2 = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread2) {
      thread2.x = 20;
      thread2.y = 20;
      ai2.appendChild(thread2);
    }

    sy += screenH + 80;

    const licence = createScreenFrame("04 Step 3 · Labour license details", startX, sy, screenW, screenH);
    pages[6].appendChild(licence);
    addTopNav(licence, screenW);
    const mainL = addPanel(licence, 40, 92, 920, 760, "Main");
    const aiL = addPanel(licence, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(mainL, "Step 3 of 5", 20, 20);
    const lH = figma.createText();
    lH.fontName = testBodyFont;
    lH.fontSize = 22;
    lH.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    lH.characters = "Labour license details";
    lH.x = 20;
    lH.y = 44;
    mainL.appendChild(lH);

    const jobCat = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    const location = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const duration = createVariantInstance("Number Input", "State=Default") || createDsInstance("Number Input");
    const notes = createVariantInstance("Textarea", "State=Default") || createDsInstance("Textarea");

    await addField(mainL, "Job category *", jobCat, 20, 110);
    await addField(mainL, "Work location *", location, 340, 110);
    await addField(mainL, "Duration (months) *", duration, 20, 200);
    await addField(mainL, "Additional notes", notes, 20, 290);

    const nextL = createDsInstance("Button");
    if (nextL) {
      nextL.x = 20;
      nextL.y = 520;
      mainL.appendChild(nextL);
      await setFirstText(nextL, "Next");
    }

    const threadL = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (threadL) {
      threadL.x = 20;
      threadL.y = 20;
      aiL.appendChild(threadL);
    }

    sy += screenH + 80;

    const uploads = createScreenFrame("05 Step 4 · Upload documents", startX, sy, screenW, screenH);
    pages[6].appendChild(uploads);
    addTopNav(uploads, screenW);
    const main3 = addPanel(uploads, 40, 92, 920, 760, "Main");
    const ai3 = addPanel(uploads, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main3, "Step 4 of 5", 20, 20);
    const s3h = figma.createText();
    s3h.fontName = testBodyFont;
    s3h.fontSize = 22;
    s3h.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    s3h.characters = "Upload supporting documents";
    s3h.x = 20;
    s3h.y = 44;
    main3.appendChild(s3h);

    const up1 = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    const up2 = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    const up3 = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    const up4 = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    const up5 = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    if (up1) {
      up1.x = 20;
      up1.y = 100;
      main3.appendChild(up1);
    }
    if (up2) {
      up2.x = 20;
      up2.y = 240;
      main3.appendChild(up2);
    }
    if (up3) {
      up3.x = 320;
      up3.y = 100;
      main3.appendChild(up3);
    }
    if (up4) {
      up4.x = 320;
      up4.y = 240;
      main3.appendChild(up4);
    }
    if (up5) {
      up5.x = 20;
      up5.y = 380;
      main3.appendChild(up5);
    }

    const next3 = createDsInstance("Button");
    if (next3) {
      next3.x = 20;
      next3.y = 540;
      main3.appendChild(next3);
      await setFirstText(next3, "Review submission");
    }

    const thread3 = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread3) {
      thread3.x = 20;
      thread3.y = 20;
      ai3.appendChild(thread3);
    }

    sy += screenH + 80;

    const review = createScreenFrame("06 Step 5 · Review & submit", startX, sy, screenW, screenH);
    pages[6].appendChild(review);
    addTopNav(review, screenW);
    const main4 = addPanel(review, 40, 92, 920, 760, "Main");
    const ai4 = addPanel(review, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main4, "Step 5 of 5", 20, 20);
    const s4h = figma.createText();
    s4h.fontName = testBodyFont;
    s4h.fontSize = 22;
    s4h.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    s4h.characters = "Review and submit";
    s4h.x = 20;
    s4h.y = 44;
    main4.appendChild(s4h);

    const summary = createDsInstance("Summary List");
    if (summary) {
      summary.x = 20;
      summary.y = 100;
      main4.appendChild(summary);
    }

    const agree = createVariantInstance("Checkbox", "State=Unchecked") || createDsInstance("Checkbox");
    if (agree) {
      agree.x = 20;
      agree.y = 200;
      main4.appendChild(agree);
    }

    const submit = createDsInstance("Button");
    if (submit) {
      submit.x = 20;
      submit.y = 260;
      main4.appendChild(submit);
      await setFirstText(submit, "Submit labour license");
    }

    const thread4 = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread4) {
      thread4.x = 20;
      thread4.y = 20;
      ai4.appendChild(thread4);
    }

    sy += screenH + 80;

    const submitted = createScreenFrame("07 Submitted · Tracking", startX, sy, screenW, screenH);
    pages[6].appendChild(submitted);
    addTopNav(submitted, screenW);
    const main5 = addPanel(submitted, 40, 92, 920, 760, "Main");
    const ai5 = addPanel(submitted, 1000, 92, 400, 760, "AI Assistant");
    addSectionLabel(main5, "Status", 20, 20);

    const ok = createDsInstance("Callout");
    if (ok) {
      ok.x = 20;
      ok.y = 60;
      main5.appendChild(ok);
    }
    const statusBar = statusMaster && statusMaster.type === "COMPONENT" ? statusMaster.createInstance() : null;
    if (statusBar) {
      statusBar.x = 20;
      statusBar.y = 150;
      main5.appendChild(statusBar);
    }

    const follow = figma.createText();
    follow.fontName = testBodyFont;
    follow.fontSize = 14;
    follow.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    follow.characters =
      "Submitted. You can track progress here. If an officer requests additional information, you will receive a notification and can upload missing documents.";
    follow.x = 20;
    follow.y = 220;
    main5.appendChild(follow);

    const thread5 = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
    if (thread5) {
      thread5.x = 20;
      thread5.y = 20;
      ai5.appendChild(thread5);
    }

    const qa = figma.createFrame();
    qa.name = "QA Checklist (Accessibility & Responsive)";
    qa.resize(960, 220);
    qa.x = 0;
    qa.y = sy + screenH + 80;
    qa.cornerRadius = 12;
    qa.fills = [{ type: "SOLID", color: hexToRgb01("#F5EDD8") }];
    qa.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
    qa.strokeWeight = 1;
    pages[6].appendChild(qa);

    const qaTitle = figma.createText();
    qaTitle.fontName = testMonoFont;
    qaTitle.fontSize = 12;
    qaTitle.letterSpacing = { unit: "PERCENT", value: 10 };
    qaTitle.textCase = "UPPER";
    qaTitle.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
    qaTitle.characters = "Testing notes";
    qaTitle.x = 16;
    qaTitle.y = 16;
    qa.appendChild(qaTitle);

    const qaBody = figma.createText();
    qaBody.fontName = testBodyFont;
    qaBody.fontSize = 13;
    qaBody.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
    qaBody.characters =
      "Accessibility:\n• All inputs have visible labels.\n• Error state shows message + error styling.\n• Touch targets aim for 44px.\n• Focus uses gold ring + sufficient contrast.\n\nResponsive:\n• Desktop layout includes AI assistant side panel.\n• Mobile layout stacks the AI panel below content.\n\nFlow:\n• Prototype links connect: Overview → Step 1 → Validation → Employees → Licence details → Uploads → Review → Submitted.";
    qaBody.x = 16;
    qaBody.y = 44;
    qa.appendChild(qaBody);

    if (startBtn) addPrototypeLink(startBtn, step1);
    if (next1) addPrototypeLink(next1, step1Error);
    if (fixBtn) addPrototypeLink(fixBtn, step2);
    if (next2) addPrototypeLink(next2, licence);
    if (nextL) addPrototypeLink(nextL, uploads);
    if (next3) addPrototypeLink(next3, review);
    if (submit) addPrototypeLink(submit, submitted);

    await figma.setCurrentPageAsync(pages[7]);
    const f7 = createHeadingFrame(
      "Test2",
      "Full-screen web mockups (1920×1080): company management, subsidiaries, shareholding/equity, and hiring foreign workers."
    );
    pages[7].appendChild(f7.frame);
    await styleHeadingFrame(
      f7.titleNode,
      f7.subtitleNode,
      "Test2",
      "Full-screen web mockups (1920×1080): company management, subsidiaries, shareholding/equity, and hiring foreign workers."
    );

    function createCard(name, x, y, w, h) {
      const card = figma.createFrame();
      card.name = name;
      card.resize(w, h);
      card.x = x;
      card.y = y;
      card.cornerRadius = 12;
      card.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      card.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
      card.strokeWeight = 1;
      return card;
    }

    function addSidebar(screen, activeLabel) {
      const sidebar = figma.createFrame();
      sidebar.name = "Sidebar";
      sidebar.resize(280, 1016);
      sidebar.x = 0;
      sidebar.y = 64;
      setSolidPaint(sidebar, "#1A1A1A", 1);
      sidebar.strokes = [];
      sidebar.cornerRadius = 0;

      const brand = figma.createText();
      brand.fontName = testBodyFont;
      brand.fontSize = 16;
      brand.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      brand.characters = "Employer Portal";
      brand.x = 20;
      brand.y = 20;
      sidebar.appendChild(brand);

      const items = [
        "Dashboard",
        "Companies",
        "Subsidiaries",
        "Shareholding & equity",
        "Foreign workers",
        "Applications",
        "Documents"
      ];
      for (let i = 0; i < items.length; i += 1) {
        const row = figma.createFrame();
        row.name = items[i];
        row.resize(240, 40);
        row.x = 20;
        row.y = 70 + i * 48;
        row.cornerRadius = 10;
        row.strokes = [];
        if (items[i] === activeLabel) {
          setSolidPaint(row, "#2A3F6B", 1);
        } else {
          row.fills = [];
        }
        sidebar.appendChild(row);

        const t = figma.createText();
        t.fontName = testBodyFont;
        t.fontSize = 13;
        t.fills = [{ type: "SOLID", color: hexToRgb01(items[i] === activeLabel ? "#FBF7EE" : "#F5EDD8") }];
        t.characters = items[i];
        t.x = 14;
        t.y = 12;
        row.appendChild(t);
      }

      screen.appendChild(sidebar);
      return sidebar;
    }

    function addShellHeader(screen, titleText) {
      addTopNav(screen, 1920);
      const title = figma.createText();
      title.fontName = testBodyFont;
      title.fontSize = 16;
      title.fills = [{ type: "SOLID", color: hexToRgb01("#FBF7EE") }];
      title.characters = titleText;
      title.x = 16;
      title.y = 24;
      screen.appendChild(title);
    }

    function addAiPanel(screen) {
      const aiPanel = createCard("AI Assistant", 1520, 96, 360, 920);
      screen.appendChild(aiPanel);
      const t = figma.createText();
      t.fontName = testMonoFont;
      t.fontSize = 11;
      t.letterSpacing = { unit: "PERCENT", value: 10 };
      t.textCase = "UPPER";
      t.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      t.characters = "AI Assistant";
      t.x = 16;
      t.y = 16;
      aiPanel.appendChild(t);

      const thread = convMaster && convMaster.type === "COMPONENT" ? convMaster.createInstance() : null;
      if (thread) {
        thread.x = 16;
        thread.y = 44;
        aiPanel.appendChild(thread);
      }

      return aiPanel;
    }

    function addPageTitle(container, text) {
      const t = figma.createText();
      t.fontName = testBodyFont;
      t.fontSize = 26;
      t.fills = [{ type: "SOLID", color: hexToRgb01("#1A1A1A") }];
      t.characters = text;
      t.x = 0;
      t.y = 0;
      container.appendChild(t);
      return t;
    }

    function addHelperText(container, text, x, y) {
      const t = figma.createText();
      t.fontName = testBodyFont;
      t.fontSize = 13;
      t.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
      t.characters = text;
      t.x = x;
      t.y = y;
      container.appendChild(t);
      return t;
    }

    function ensureInstanceOrPlaceholder(name, x, y, w, h) {
      const inst = createDsInstance(name);
      if (inst) {
        inst.x = x;
        inst.y = y;
        return { node: inst, ok: true };
      }
      const ph = figma.createFrame();
      ph.name = name;
      ph.resize(w, h);
      ph.x = x;
      ph.y = y;
      ph.cornerRadius = 10;
      ph.fills = [{ type: "SOLID", color: hexToRgb01("#F5EDD8") }];
      ph.strokes = [{ type: "SOLID", color: hexToRgb01("#D4C9B8") }];
      ph.strokeWeight = 1;
      const t = figma.createText();
      t.fontName = testBodyFont;
      t.fontSize = 12;
      t.fills = [{ type: "SOLID", color: hexToRgb01("#6B5E52") }];
      t.characters = name;
      t.x = 12;
      t.y = 12;
      ph.appendChild(t);
      return { node: ph, ok: false };
    }

    const t2W = 1920;
    const t2H = 1080;
    const t2X = 0;
    let t2Y = 260;

    const dash = createScreenFrame("01 Dashboard", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(dash);
    addShellHeader(dash, "Employer Portal");
    addSidebar(dash, "Dashboard");
    addAiPanel(dash);

    const dashMain = figma.createFrame();
    dashMain.name = "Main";
    dashMain.resize(1200, 920);
    dashMain.x = 300;
    dashMain.y = 96;
    dashMain.fills = [];
    dashMain.strokes = [];
    dash.appendChild(dashMain);

    addPageTitle(dashMain, "Dashboard");
    addHelperText(dashMain, "Quick actions and current status for your companies and applications.", 0, 40);

    const cardA = createCard("Company management", 0, 90, 380, 180);
    dashMain.appendChild(cardA);
    addSectionLabel(cardA, "Companies", 16, 16);
    addHelperText(cardA, "Manage company profiles and subsidiaries.\nKeep details updated for faster approvals.", 16, 44);
    const goCompanies = createDsInstance("Button");
    if (goCompanies) {
      goCompanies.x = 16;
      goCompanies.y = 120;
      cardA.appendChild(goCompanies);
      await setFirstText(goCompanies, "Manage companies");
    }

    const cardB = createCard("Shareholding & equity", 410, 90, 380, 180);
    dashMain.appendChild(cardB);
    addSectionLabel(cardB, "Shareholding", 16, 16);
    addHelperText(cardB, "View cap table and record equity changes.\nUpload supporting documents.", 16, 44);
    const goEquity = createDsInstance("Button");
    if (goEquity) {
      goEquity.x = 16;
      goEquity.y = 120;
      cardB.appendChild(goEquity);
      await setFirstText(goEquity, "View cap table");
    }

    const cardC = createCard("Foreign workers", 820, 90, 380, 180);
    dashMain.appendChild(cardC);
    addSectionLabel(cardC, "Foreign workers", 16, 16);
    addHelperText(cardC, "Create worker rosters and submit applications.\nTrack progress and respond to requests.", 16, 44);
    const goHire = createDsInstance("Button");
    if (goHire) {
      goHire.x = 16;
      goHire.y = 120;
      cardC.appendChild(goHire);
      await setFirstText(goHire, "Hire foreign worker");
    }

    const statusArea = createCard("Status overview", 0, 300, 1200, 560);
    dashMain.appendChild(statusArea);
    addSectionLabel(statusArea, "In progress", 16, 16);
    const tbl1 = ensureInstanceOrPlaceholder("Table", 16, 48, 1168, 300);
    statusArea.appendChild(tbl1.node);
    const callout1 = ensureInstanceOrPlaceholder("Callout", 16, 370, 1168, 120);
    statusArea.appendChild(callout1.node);

    t2Y += t2H + 100;

    const companies = createScreenFrame("02 Companies", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(companies);
    addShellHeader(companies, "Employer Portal");
    addSidebar(companies, "Companies");
    addAiPanel(companies);

    const cMain = figma.createFrame();
    cMain.name = "Main";
    cMain.resize(1200, 920);
    cMain.x = 300;
    cMain.y = 96;
    cMain.fills = [];
    cMain.strokes = [];
    companies.appendChild(cMain);

    addPageTitle(cMain, "Companies");
    addHelperText(cMain, "Add subsidiaries and keep your company profile consistent across applications.", 0, 40);

    const search1 = ensureInstanceOrPlaceholder("Search Bar", 0, 90, 560, 56);
    cMain.appendChild(search1.node);

    const addSubs = createDsInstance("Button");
    if (addSubs) {
      addSubs.x = 820;
      addSubs.y = 90;
      cMain.appendChild(addSubs);
      await setFirstText(addSubs, "Add subsidiary");
    }

    const cTable = ensureInstanceOrPlaceholder("Table", 0, 170, 1200, 560);
    cMain.appendChild(cTable.node);

    const hintBox = createCard("Tip", 0, 760, 1200, 140);
    cMain.appendChild(hintBox);
    addSectionLabel(hintBox, "Tip", 16, 16);
    addHelperText(hintBox, "For faster processing, ensure registration numbers, directors, and addresses match your official documents.", 16, 44);

    t2Y += t2H + 100;

    const companyDetail = createScreenFrame("03 Company details", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(companyDetail);
    addShellHeader(companyDetail, "Employer Portal");
    addSidebar(companyDetail, "Companies");
    addAiPanel(companyDetail);

    const dMain = figma.createFrame();
    dMain.name = "Main";
    dMain.resize(1200, 920);
    dMain.x = 300;
    dMain.y = 96;
    dMain.fills = [];
    dMain.strokes = [];
    companyDetail.appendChild(dMain);

    addPageTitle(dMain, "Company details");
    addHelperText(dMain, "This information is used across subsidiaries and foreign worker applications.", 0, 40);

    const profile = createCard("Company profile", 0, 90, 1200, 360);
    dMain.appendChild(profile);
    addSectionLabel(profile, "Profile", 16, 16);
    const p1 = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const p2 = createVariantInstance("Text Input", "State=Default") || createDsInstance("Text Input");
    const p3 = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    await addField(profile, "Registered name *", p1, 16, 52);
    await addField(profile, "Registration no. *", p2, 420, 52);
    await addField(profile, "Industry *", p3, 16, 140);
    const saveProfile = createDsInstance("Button");
    if (saveProfile) {
      saveProfile.x = 16;
      saveProfile.y = 260;
      profile.appendChild(saveProfile);
      await setFirstText(saveProfile, "Save changes");
    }

    const subs = createCard("Subsidiaries", 0, 470, 700, 430);
    dMain.appendChild(subs);
    addSectionLabel(subs, "Subsidiaries", 16, 16);
    const subsTable = ensureInstanceOrPlaceholder("Table", 16, 48, 668, 260);
    subs.appendChild(subsTable.node);
    const addSubs2 = createDsInstance("Button");
    if (addSubs2) {
      addSubs2.x = 16;
      addSubs2.y = 330;
      subs.appendChild(addSubs2);
      await setFirstText(addSubs2, "Add subsidiary");
    }

    const equitySnap = createCard("Shareholding snapshot", 720, 470, 480, 430);
    dMain.appendChild(equitySnap);
    addSectionLabel(equitySnap, "Shareholding", 16, 16);
    const sum = ensureInstanceOrPlaceholder("Summary List", 16, 48, 448, 220);
    equitySnap.appendChild(sum.node);
    const goCap = createDsInstance("Button");
    if (goCap) {
      goCap.x = 16;
      goCap.y = 300;
      equitySnap.appendChild(goCap);
      await setFirstText(goCap, "Open cap table");
    }

    t2Y += t2H + 100;

    const cap = createScreenFrame("04 Shareholding & equity", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(cap);
    addShellHeader(cap, "Employer Portal");
    addSidebar(cap, "Shareholding & equity");
    addAiPanel(cap);

    const eMain = figma.createFrame();
    eMain.name = "Main";
    eMain.resize(1200, 920);
    eMain.x = 300;
    eMain.y = 96;
    eMain.fills = [];
    eMain.strokes = [];
    cap.appendChild(eMain);

    addPageTitle(eMain, "Shareholding & equity");
    addHelperText(eMain, "Maintain a clear record of shareholders and equity changes for compliance and application evidence.", 0, 40);

    const equityTable = ensureInstanceOrPlaceholder("Table", 0, 90, 1200, 560);
    eMain.appendChild(equityTable.node);

    const recordChange = createDsInstance("Button");
    if (recordChange) {
      recordChange.x = 0;
      recordChange.y = 680;
      eMain.appendChild(recordChange);
      await setFirstText(recordChange, "Record equity change");
    }
    const uploadProof = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    if (uploadProof) {
      uploadProof.x = 410;
      uploadProof.y = 660;
      eMain.appendChild(uploadProof);
    }

    t2Y += t2H + 100;

    const workers = createScreenFrame("05 Foreign workers", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(workers);
    addShellHeader(workers, "Employer Portal");
    addSidebar(workers, "Foreign workers");
    addAiPanel(workers);

    const wMain = figma.createFrame();
    wMain.name = "Main";
    wMain.resize(1200, 920);
    wMain.x = 300;
    wMain.y = 96;
    wMain.fills = [];
    wMain.strokes = [];
    workers.appendChild(wMain);

    addPageTitle(wMain, "Foreign workers");
    addHelperText(wMain, "Build an employee roster and submit applications for work permits.", 0, 40);

    const quota = createCard("Quota", 0, 90, 1200, 140);
    wMain.appendChild(quota);
    addSectionLabel(quota, "Quota", 16, 16);
    addHelperText(quota, "Available slots: 12 · Pending: 3 · Approved: 5", 16, 44);

    const rosterSearch = ensureInstanceOrPlaceholder("Search Bar", 0, 260, 560, 56);
    wMain.appendChild(rosterSearch.node);
    const newApp = createDsInstance("Button");
    if (newApp) {
      newApp.x = 820;
      newApp.y = 260;
      wMain.appendChild(newApp);
      await setFirstText(newApp, "Start application");
    }
    const rosterTable = ensureInstanceOrPlaceholder("Table", 0, 340, 1200, 520);
    wMain.appendChild(rosterTable.node);

    t2Y += t2H + 100;

    const wizard = createScreenFrame("06 Start application · Step 1", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(wizard);
    addShellHeader(wizard, "Employer Portal");
    addSidebar(wizard, "Applications");
    const aiW = addAiPanel(wizard);

    const zMain = figma.createFrame();
    zMain.name = "Main";
    zMain.resize(1200, 920);
    zMain.x = 300;
    zMain.y = 96;
    zMain.fills = [];
    zMain.strokes = [];
    wizard.appendChild(zMain);

    addPageTitle(zMain, "Start work permit application");
    addHelperText(zMain, "Step 1 of 3: choose company and provide a summary. Required fields must be complete.", 0, 40);

    const selCompany = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    const selSubsidiary = createVariantInstance("Select", "State=Default") || createDsInstance("Select");
    const numWorkers = createVariantInstance("Number Input", "State=Default") || createDsInstance("Number Input");
    const desc = createVariantInstance("Textarea", "State=Default") || createDsInstance("Textarea");
    await addField(zMain, "Company *", selCompany, 0, 90);
    await addField(zMain, "Subsidiary (optional)", selSubsidiary, 420, 90);
    await addField(zMain, "Number of workers *", numWorkers, 0, 180);
    await addField(zMain, "Business justification *", desc, 0, 270);

    const continueBtn = createDsInstance("Button");
    if (continueBtn) {
      continueBtn.x = 0;
      continueBtn.y = 520;
      zMain.appendChild(continueBtn);
      await setFirstText(continueBtn, "Continue");
    }

    const validateNote = figma.createText();
    validateNote.fontName = testBodyFont;
    validateNote.fontSize = 13;
    validateNote.fills = [{ type: "SOLID", color: hexToRgb01("#3A3530") }];
    validateNote.characters = "Validation simulation: if required fields are missing, the next screen shows error states.";
    validateNote.x = 0;
    validateNote.y = 590;
    zMain.appendChild(validateNote);

    const aiStatus = statusMaster && statusMaster.type === "COMPONENT" ? statusMaster.createInstance() : null;
    if (aiStatus) {
      aiStatus.x = 16;
      aiStatus.y = 380;
      aiW.appendChild(aiStatus);
    }

    t2Y += t2H + 100;

    const wizardErr = createScreenFrame("06a Start application · Validation errors", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(wizardErr);
    addShellHeader(wizardErr, "Employer Portal");
    addSidebar(wizardErr, "Applications");
    addAiPanel(wizardErr);

    const zeMain = figma.createFrame();
    zeMain.name = "Main";
    zeMain.resize(1200, 920);
    zeMain.x = 300;
    zeMain.y = 96;
    zeMain.fills = [];
    zeMain.strokes = [];
    wizardErr.appendChild(zeMain);

    addPageTitle(zeMain, "Start work permit application");
    addHelperText(zeMain, "Please fix the required fields before continuing.", 0, 40);
    const errCompany2 = createVariantInstance("Select", "State=Error") || createDsInstance("Select");
    const errNum = createVariantInstance("Number Input", "State=Error") || createDsInstance("Number Input");
    const errDesc = createVariantInstance("Textarea", "State=Error") || createDsInstance("Textarea");
    await addField(zeMain, "Company *", errCompany2, 0, 90);
    await addField(zeMain, "Number of workers *", errNum, 0, 180);
    await addField(zeMain, "Business justification *", errDesc, 0, 270);
    const fixContinue = createDsInstance("Button");
    if (fixContinue) {
      fixContinue.x = 0;
      fixContinue.y = 520;
      zeMain.appendChild(fixContinue);
      await setFirstText(fixContinue, "Continue");
    }

    t2Y += t2H + 100;

    const tracking = createScreenFrame("07 Application tracking", t2X, t2Y, t2W, t2H);
    pages[7].appendChild(tracking);
    addShellHeader(tracking, "Employer Portal");
    addSidebar(tracking, "Applications");
    addAiPanel(tracking);

    const trMain = figma.createFrame();
    trMain.name = "Main";
    trMain.resize(1200, 920);
    trMain.x = 300;
    trMain.y = 96;
    trMain.fills = [];
    trMain.strokes = [];
    tracking.appendChild(trMain);

    addPageTitle(trMain, "Application tracking");
    addHelperText(trMain, "Track progress and respond to requests for additional information.", 0, 40);

    const status = createCard("Status", 0, 90, 1200, 200);
    trMain.appendChild(status);
    addSectionLabel(status, "Status", 16, 16);
    const st = statusMaster && statusMaster.type === "COMPONENT" ? statusMaster.createInstance() : null;
    if (st) {
      st.x = 16;
      st.y = 52;
      status.appendChild(st);
    } else {
      addHelperText(status, "Submitted → Under review → Decision", 16, 60);
    }

    const req = createCard("Requests", 0, 310, 1200, 290);
    trMain.appendChild(req);
    addSectionLabel(req, "Requests", 16, 16);
    const reqCallout = ensureInstanceOrPlaceholder("Callout", 16, 48, 1168, 110);
    req.appendChild(reqCallout.node);
    const reqUpload = createVariantInstance("File Upload", "State=Default") || createDsInstance("File Upload");
    if (reqUpload) {
      reqUpload.x = 16;
      reqUpload.y = 180;
      req.appendChild(reqUpload);
    }

    const history = createCard("History", 0, 620, 1200, 280);
    trMain.appendChild(history);
    addSectionLabel(history, "History", 16, 16);
    const histTable = ensureInstanceOrPlaceholder("Table", 16, 48, 1168, 200);
    history.appendChild(histTable.node);

    const qa2 = createCard("QA Checklist", 0, t2Y + t2H + 100, 1200, 240);
    pages[7].appendChild(qa2);
    addSectionLabel(qa2, "Testing notes", 16, 16);
    addHelperText(
      qa2,
      "Accessibility:\n• Labels are visible above inputs.\n• Error screens use error variants and clear guidance.\n• Primary actions are consistent and easy to find.\n\nBeginner UX:\n• Guided dashboard cards.\n• Inline tips and plain language.\n• Clear progression and status visibility.\n\nPrototype:\n• Buttons link between screens to simulate flow.",
      16,
      44
    );

    if (goCompanies) addPrototypeLink(goCompanies, companies);
    if (goEquity) addPrototypeLink(goEquity, cap);
    if (goHire) addPrototypeLink(goHire, workers);
    if (goCap) addPrototypeLink(goCap, cap);
    if (newApp) addPrototypeLink(newApp, wizard);
    if (continueBtn) addPrototypeLink(continueBtn, wizardErr);
    if (fixContinue) addPrototypeLink(fixContinue, tracking);

    await figma.setCurrentPageAsync(pages[0]);
    figma.viewport.scrollAndZoomIntoView([f0.frame]);
    return {
      ok: true,
      fileName: figma.root.name,
      pages: pageNames
    };
  }

  if (action === "get_document_info") {
    return await getDocumentInfoFull();
  }

  if (action === "get_selection") {
    return await getSelectionFull();
  }

  if (action === "read_my_design") {
    return await readMyDesign();
  }

  if (action === "get_node_info") {
    return await getNodeInfo(p.nodeId);
  }

  if (action === "get_nodes_info") {
    return await getNodesInfo(p.nodeIds);
  }

  if (action === "get_instance_source") {
    return await getInstanceSource(p);
  }

  if (action === "scan_instances_with_sources") {
    return await scanInstancesWithSources(p);
  }

  if (action === "set_focus") {
    return await setFocus(p);
  }

  if (action === "set_selections") {
    return await setSelections(p);
  }

  if (action === "create_rectangle") {
    return await createRectangleNode(p);
  }

  if (action === "create_frame") {
    return await createFrameNode(p);
  }

  if (action === "create_text") {
    return await createTextNode(p);
  }

  if (action === "set_fill_color") {
    return await setFillColor(p);
  }

  if (action === "set_stroke_color") {
    return await setStrokeColor(p);
  }

  if (action === "move_node") {
    return await moveNode(p);
  }

  if (action === "reparent_node") {
    return await reparentNode(p);
  }

  if (action === "get_parent_chain") {
    return await getParentChain(p);
  }

  if (action === "insert_child") {
    return await insertChild(p);
  }

  if (action === "resize_node") {
    return await resizeNode(p);
  }

  if (action === "delete_node") {
    return await deleteNode(p);
  }

  if (action === "delete_multiple_nodes") {
    return await deleteMultipleNodes(p);
  }

  if (action === "clone_node") {
    return await cloneNode(p);
  }

  if (action === "clone_node_into_parent") {
    return await cloneNodeIntoParent(p);
  }

  if (action === "set_corner_radius") {
    return await setCornerRadius(p);
  }

  if (action === "set_text_content") {
    return await setTextContent(p);
  }

  if (action === "scan_text_nodes") {
    return await scanTextNodes(p);
  }

  if (action === "set_multiple_text_contents") {
    return await setMultipleTextContents(p);
  }

  if (action === "get_styles") {
    return await getStyles();
  }

  if (action === "get_local_components") {
    return await getLocalComponents(p);
  }

  if (action === "create_component_instance") {
    return await createComponentInstance(p);
  }

  if (action === "create_instance_from_instance") {
    return await createInstanceFromInstance(p);
  }

  if (action === "import_component_by_key") {
    return await importComponentByKey(p);
  }

  if (action === "import_component_set_by_key") {
    return await importComponentSetByKey(p);
  }

  if (action === "create_instance_from_component_key") {
    return await createInstanceFromComponentKey(p);
  }

  if (action === "create_instance_from_component_set_key") {
    return await createInstanceFromComponentSetKey(p);
  }

  if (action === "get_instance_properties") {
    return await getInstanceProperties(p);
  }

  if (action === "set_instance_properties") {
    return await setInstanceProperties(p);
  }

  if (action === "swap_instance_component") {
    return await swapInstanceComponent(p);
  }

  if (action === "export_node_as_image") {
    return await exportNodeAsImage(p);
  }
  
  if (action === "scan_nodes_by_types") {
    return await scanNodesByTypes(p);
  }

  if (action === "get_annotations") {
    return await getAnnotations(p);
  }

  if (action === "set_annotation") {
    return await setAnnotation(p);
  }

  if (action === "set_multiple_annotations") {
    return await setMultipleAnnotations(p);
  }

  if (action === "get_reactions") {
    return await getReactions(p);
  }

  if (action === "set_layout_mode") {
    return await setLayoutMode(p);
  }

  if (action === "set_padding") {
    return await setPadding(p);
  }

  if (action === "set_axis_align") {
    return await setAxisAlign(p);
  }

  if (action === "set_layout_sizing") {
    return await setLayoutSizing(p);
  }

  if (action === "set_item_spacing") {
    return await setItemSpacing(p);
  }

  if (action === "add_renewal_info_panel") {
    return await addRenewalInfoPanel(p);
  }

  if (action === "create_renewal_tab_screen" || action === "createRenewalTabScreen") {
    return await createRenewalTabScreen(p);
  }

  if (action === "getDocumentInfo") {
    return {
      document: {
        name: figma.root.name,
        currentPage: {
          id: figma.currentPage.id,
          name: figma.currentPage.name
        }
      }
    };
  }

  if (action === "getSelection") {
    return { selection: selectionSummary() };
  }

  if (action === "renameNode") {
    const node = await getNodeByIdAsync(String(p.nodeId));
    assertNodeWritable(node, p);
    node.name = p.name === undefined || p.name === null ? "" : String(p.name);
    return { nodeId: node.id, name: node.name };
  }

  if (action === "setText") {
    const nodeId = p.nodeId ? String(p.nodeId) : null;
    const target = nodeId ? await getNodeByIdAsync(nodeId) : figma.currentPage.selection[0];
    if (!target || target.type !== "TEXT") throw new Error("Select a TEXT node or pass nodeId");
    assertNodeWritable(target, p);
    await loadTextFont(target);
    target.characters = p.characters === undefined || p.characters === null ? "" : String(p.characters);
    return { nodeId: target.id, characters: target.characters };
  }

  if (action === "createFrame") {
    return await createFrameNode(p);
  }

  if (action === "createRectangle") {
    return await createRectangleNode(p);
  }

  if (action === "get_file_theme") {
    const paintStyles = await getLocalPaintStyles();
    const effectStyles = await getLocalEffectStyles();
    const textStyles = await getLocalTextStyles();
    return {
      theme: activeTheme || null,
      existing: {
        paintStyles: paintStyles.length,
        effectStyles: effectStyles.length,
        textStyles: textStyles.length
      }
    };
  }

  if (action === "createText") {
    return await createTextNode(p);
  }

  if (action === "setSolidFill") {
    const node = await getNodeByIdAsync(String(p.nodeId));
    assertNodeWritable(node, p);
    if (!("fills" in node)) throw new Error("Node does not support fills");
    const r = Number(p.r);
    const g = Number(p.g);
    const b = Number(p.b);
    const opacity = p.opacity === undefined || p.opacity === null ? 1 : Number(p.opacity);
    node.fills = [{ type: "SOLID", color: { r, g, b }, opacity }];
    return { nodeId: node.id };
  }

  throw new Error(`Unknown action: ${action}`);
}

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== "exec" || typeof msg.id !== "string") return;
  try {
    const result = await handleAction(String(msg.action), msg.payload || {});
    figma.ui.postMessage({ type: "result", id: msg.id, ok: true, result });
  } catch (err) {
    figma.ui.postMessage({
      type: "result",
      id: msg.id,
      ok: false,
      error: err && err.message ? String(err.message) : String(err)
    });
  }
};
