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
      <input id="secret" type="password" placeholder="Secret (optional)" />
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
      const secretInput = document.getElementById("secret");
      const connectBtn = document.getElementById("connect");
      const disconnectBtn = document.getElementById("disconnect");
      const statusEl = document.getElementById("status");
      const logEl = document.getElementById("log");

      wsUrlInput.value = "${defaultWsUrl}";
      channelInput.value = "default";
      secretInput.value = "";

      let ws = null;
      const pending = new Map();
      let manualDisconnect = false;
      let currentChannel = "default";
      let fileKeyInfo = null;
      let fileNameInfo = null;
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
          currentChannel = channelInput.value.trim() || "default";
          try {
            ws.send(
              JSON.stringify({
                type: "join",
                channel: currentChannel,
                secret: secretInput.value.trim(),
                fileKey: fileKeyInfo,
                fileName: fileNameInfo
              })
            );
          } catch (err) {}
          log({ connectedTo: url, channel: currentChannel });
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
        if (!msg) return;
        if (msg.type === "meta") {
          fileKeyInfo = msg.fileKey || null;
          fileNameInfo = msg.fileName || null;
          return;
        }
        if (msg.type === "targetFrames") {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "update_target_frames", targetFrameIds: msg.targetFrameIds || [] }));
          }
          return;
        }
        if (msg.type === "pushEvent") {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "event", channel: currentChannel, name: msg.name, payload: msg.payload }));
          }
          return;
        }
        if (msg.type !== "result" || typeof msg.id !== "string") return;
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

figma.showUI(uiHtml, { width: 420, height: 275 });

// File identity is reported to the UI (which holds the WebSocket) so the bridge
// server can surface which file each channel is connected to (channel dashboard).
try {
  figma.ui.postMessage({
    type: "meta",
    fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
    fileName: figma.root ? String(figma.root.name) : null
  });
} catch (_err) {}

// ---------------------------------------------------------------------------
// Target-frame enforcement + push events
// ---------------------------------------------------------------------------
// pluginTargetFrameIds is kept in sync with the server's targetFrameIds via the
// sync_target_frames command. When non-empty, every node-scoped mutation is
// rejected unless the node (or one of its ancestors) is inside a target frame.
let pluginTargetFrameIds = new Set();
const activeEventSubscriptions = new Set();

try {
  figma.on("selectionchange", () => {
    if (!activeEventSubscriptions.has("selectionchange")) return;
    figma.ui.postMessage({
      type: "pushEvent",
      name: "selectionchange",
      payload: {
        selection: selectionSummary(),
        selectionCount: figma.currentPage.selection.length
      }
    });
  });
} catch (_err) {}

try {
  figma.on("documentchange", (event) => {
    if (!activeEventSubscriptions.has("documentchange")) return;
    const changes = event && Array.isArray(event.documentChanges) ? event.documentChanges : [];
    figma.ui.postMessage({
      type: "pushEvent",
      name: "documentchange",
      payload: {
        changeCount: changes.length,
        types: changes.map((c) => (c && c.type ? String(c.type) : "unknown"))
      }
    });
  });
} catch (_err) {}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

async function setFillStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setFillStyleIdAsync === "function") { await node.setFillStyleIdAsync(styleId); return; }
  if ("fillStyleId" in node) node.fillStyleId = styleId;
}

async function setStrokeStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setStrokeStyleIdAsync === "function") { await node.setStrokeStyleIdAsync(styleId); return; }
  if ("strokeStyleId" in node) node.strokeStyleId = styleId;
}

async function setEffectStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setEffectStyleIdAsync === "function") { await node.setEffectStyleIdAsync(styleId); return; }
  if ("effectStyleId" in node) node.effectStyleId = styleId;
}

async function setTextStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setTextStyleIdAsync === "function") { await node.setTextStyleIdAsync(styleId); return; }
  if ("textStyleId" in node) node.textStyleId = styleId;
}

async function setGridStyleId(node, styleId) {
  if (!node) return;
  if (typeof node.setGridStyleIdAsync === "function") { await node.setGridStyleIdAsync(styleId); return; }
  if ("gridStyleId" in node) node.gridStyleId = styleId;
}

// ---------------------------------------------------------------------------
// Local style fetchers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function clamp01(n) {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function parseHexToRgb01(hex) {
  let raw = String(hex).trim().replace(/^#/, "");
  if (raw.length === 3 || raw.length === 4) {
    raw = raw.split("").map((c) => c + c).join("");
  }
  if (raw.length !== 6 && raw.length !== 8) throw new Error("Invalid hex color: " + hex);
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (![r, g, b].every((x) => Number.isFinite(x))) throw new Error("Invalid hex color: " + hex);
  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255) };
}

function hexToRgb01(hex) {
  return parseHexToRgb01(hex);
}

function rgb01ToHex(rgb) {
  const r = Math.max(0, Math.min(255, Math.round(Number(rgb.r) * 255)));
  const g = Math.max(0, Math.min(255, Math.round(Number(rgb.g) * 255)));
  const b = Math.max(0, Math.min(255, Math.round(Number(rgb.b) * 255)));
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return "#" + to2(r) + to2(g) + to2(b);
}

function rgbaToHex(color) {
  const r = Math.round(Number(color.r) * 255);
  const g = Math.round(Number(color.g) * 255);
  const b = Math.round(Number(color.b) * 255);
  const a = color.a !== undefined ? Math.round(Number(color.a) * 255) : 255;
  function toHex2(n) { return Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0"); }
  if (a === 255) return "#" + [r, g, b].map(toHex2).join("");
  return "#" + [r, g, b, a].map(toHex2).join("");
}

function rgbaToFigmaColor(rgba) {
  const obj = rgba && typeof rgba === "object" ? rgba : {};
  const r = Number(obj.r);
  const g = Number(obj.g);
  const b = Number(obj.b);
  const a = obj.a === undefined || obj.a === null ? 1 : Number(obj.a);
  return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a: clamp01(a) };
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

function normalize01From01Or255(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n > 1) return Math.max(0, Math.min(1, n / 255));
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// Font utilities
// ---------------------------------------------------------------------------

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

async function loadTextFont(textNode) {
  const fontName = textNode.fontName;
  if (fontName !== figma.mixed) {
    await figma.loadFontAsync(fontName);
    return;
  }
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
}

// ---------------------------------------------------------------------------
// Page utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Misc utilities
// ---------------------------------------------------------------------------

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeValuesByMode(params) {
  const raw =
    params && params.valuesByMode && typeof params.valuesByMode === "object"
      ? Object.assign({}, params.valuesByMode)
      : {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.indexOf(":") >= 0) continue;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const nestedKeys = Object.keys(v);
    if (nestedKeys.length !== 1) continue;
    const nestedKey = nestedKeys[0];
    if (!/^\d+$/.test(nestedKey)) continue;
    const compound = `${k}:${nestedKey}`;
    if (raw[compound] !== undefined) continue;
    raw[compound] = v[nestedKey];
    delete raw[k];
  }
  const entries = ensureArray(params && params.valuesByModeEntries);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const modeId = entry.modeId === undefined || entry.modeId === null ? "" : String(entry.modeId);
    if (!modeId) continue;
    raw[modeId] = entry.value;
  }
  return raw;
}

function resolveModeIdFromCollection(collection, providedKey) {
  const key = providedKey === undefined || providedKey === null ? "" : String(providedKey);
  if (!key) return null;
  const modes = collection && Array.isArray(collection.modes) ? collection.modes : [];

  for (const m of modes) {
    if (m.modeId === key) return m.modeId;
  }
  for (const m of modes) {
    if (m.name === key) return m.modeId;
  }
  for (let i = 0; i < modes.length; i += 1) {
    if (String(i) === key) return modes[i].modeId;
  }
  if (key.indexOf(":") < 0) {
    const matches = [];
    for (const m of modes) {
      const mid = m && m.modeId ? String(m.modeId) : "";
      const prefix = mid.indexOf(":") >= 0 ? mid.split(":")[0] : mid;
      if (prefix === key) matches.push(m);
    }
    if (matches.length === 1) return matches[0].modeId;
  }
  if (modes.length === 1) return modes[0].modeId;
  return null;
}

function parseRgbTriplet01(value) {
  const raw = String(value).trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const r255 = Number(parts[0]);
  const g255 = Number(parts[1]);
  const b255 = Number(parts[2]);
  if (![r255, g255, b255].every((x) => Number.isFinite(x))) return null;
  return { r: clamp01(r255 / 255), g: clamp01(g255 / 255), b: clamp01(b255 / 255) };
}

function parseFloatToken(value) {
  const raw = String(value).trim();
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function coerceVariableValue(resolvedType, value) {
  const t = resolvedType === undefined || resolvedType === null ? "" : String(resolvedType);
  if (t === "COLOR") {
    if (typeof value === "string") {
      const s = value.trim();
      if (s.startsWith("#")) return parseHexToRgb01(s);
      const triplet = parseRgbTriplet01(s);
      if (triplet) return triplet;
    }
    return value;
  }
  if (t === "FLOAT") {
    if (typeof value === "string") {
      const n = parseFloatToken(value);
      if (n !== null) return n;
    }
    return value;
  }
  return value;
}

function applyValuesByModeToVariable(v, collection, valuesByMode) {
  const failures = [];
  for (const [modeKey, value] of Object.entries(valuesByMode || {})) {
    const resolvedModeId = resolveModeIdFromCollection(collection, modeKey);
    if (!resolvedModeId) {
      failures.push(String(modeKey));
      continue;
    }
    const coerced = coerceVariableValue(v && v.resolvedType, value);
    v.setValueForMode(String(resolvedModeId), coerced);
  }
  if (failures.length) {
    const modes = collection && Array.isArray(collection.modes) ? collection.modes : [];
    const available = modes.map((m) => `${m.name} (${m.modeId})`);
    throw new Error(
      `Invalid mode id(s): ${failures.join(", ")}. Available modes: ${available.join(", ")}`
    );
  }
}

function normalizeFigmaNodeId(nodeId) {
  const raw = nodeId === undefined || nodeId === null ? "" : String(nodeId);
  if (!raw) return raw;
  if (raw.indexOf(":") < 0 && raw.indexOf("-") >= 0) return raw.split("-").join(":");
  return raw;
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

function assertNodeWritable(node, params) {
  return;
}

async function resolveCreateHost(params) {
  const p = params && typeof params === "object" ? params : {};
  const parentNodeId = p.parentNodeId ? String(p.parentNodeId) : null;
  if (parentNodeId) {
    const host = await getNodeByIdAsync(parentNodeId);
    if (!("appendChild" in host)) throw new Error("Parent cannot contain children");
    if (pluginTargetFrameIds.size > 0) await assertInTarget(host.id);
    return host;
  }
  if (pluginTargetFrameIds.size > 0) {
    if (pluginTargetFrameIds.size === 1) {
      const onlyId = pluginTargetFrameIds.values().next().value;
      const host = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(onlyId)));
      if (host && host !== figma.currentPage && "appendChild" in host) return host;
    }
    throw new Error(
      "Cannot infer create host: a target frame is set. Pass parentNodeId inside the target frame, or set a single target frame with set_target_frame."
    );
  }
  return figma.currentPage;
}

// ---------------------------------------------------------------------------
// Target-frame scope helpers (real enforcement)
// ---------------------------------------------------------------------------

function isWithinTargetFrame(node) {
  let cur = node;
  while (cur) {
    if (pluginTargetFrameIds.has(cur.id)) return true;
    cur = cur.parent;
  }
  return false;
}

async function assertInTarget(id) {
  if (pluginTargetFrameIds.size === 0) return;
  const node = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(id)));
  if (!node) throw new Error("Node not found while checking target frame: " + id);
  if (isWithinTargetFrame(node)) return;
  throw new Error(
    "Blocked by target-frame scope: node " + id + " is outside the recorded target frame(s). Use set_target_frame / clear_target_frames to change scope."
  );
}

async function enforceTargetScope(action, p) {
  if (pluginTargetFrameIds.size === 0) return;
  const extractor = TARGET_SCOPED_ACTIONS[action];
  if (!extractor) return;
  const ids = extractor(p).filter(Boolean).map(String);
  for (let i = 0; i < ids.length; i += 1) await assertInTarget(ids[i]);
}

function serializeComponentPropertyDefinitions(definitions) {
  const out = {};
  const defs = definitions && typeof definitions === "object" ? definitions : {};
  for (const [propertyName, def] of Object.entries(defs)) {
    if (!def || typeof def !== "object") continue;
    const item = {
      type: def.type,
      defaultValue: def.defaultValue
    };
    if (Array.isArray(def.variantOptions)) item.variantOptions = def.variantOptions.slice();
    if (Array.isArray(def.preferredValues)) {
      item.preferredValues = def.preferredValues.map((entry) => Object.assign({}, entry));
    }
    if (def.boundVariables && typeof def.boundVariables === "object") {
      item.boundVariables = Object.assign({}, def.boundVariables);
    }
    out[propertyName] = item;
  }
  return out;
}

function serializeComponentPropertyReferences(node) {
  if (!node || !node.componentPropertyReferences || typeof node.componentPropertyReferences !== "object") {
    return {};
  }
  return Object.assign({}, node.componentPropertyReferences);
}

function normalizeComponentPropertyType(type) {
  const value = type === undefined || type === null ? "" : String(type).trim().toUpperCase();
  if (!value) throw new Error("Missing component property type");
  if (["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT", "SLOT"].indexOf(value) < 0) {
    throw new Error("Unsupported component property type: " + value);
  }
  return value;
}

function normalizeBooleanLike(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return Boolean(value);
}

function normalizeComponentPropertyDefaultValue(type, value) {
  if (type === "BOOLEAN") return normalizeBooleanLike(value, false);
  if (value === undefined || value === null) return "";
  return String(value);
}

function normalizeInstanceSwapPreferredValues(preferredValues) {
  const items = ensureArray(preferredValues);
  return items.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("preferredValues entries must be objects");
    const type = entry.type === undefined || entry.type === null ? "" : String(entry.type).trim().toUpperCase();
    const key = entry.key === undefined || entry.key === null ? "" : String(entry.key).trim();
    if (!type || !key) throw new Error("preferredValues entries require type and key");
    if (type !== "COMPONENT" && type !== "COMPONENT_SET") {
      throw new Error("preferredValues type must be COMPONENT or COMPONENT_SET");
    }
    return { type, key };
  });
}

function formatVariantComponentName(properties) {
  const entries = Object.entries(properties || {});
  if (!entries.length) throw new Error("Missing variant properties");
  return entries
    .map(([key, value]) => {
      const propertyName = String(key).trim();
      const propertyValue = value === undefined || value === null ? "" : String(value).trim();
      if (!propertyName) throw new Error("Variant property names must be non-empty");
      if (!propertyValue) throw new Error("Variant property values must be non-empty");
      return `${propertyName}=${propertyValue}`;
    })
    .join(", ");
}

function getAncestorChain(node) {
  const chain = [];
  let current = node;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  return chain;
}

async function resolveComponentAuthoringNode(params, options) {
  const opts = options && typeof options === "object" ? options : {};
  const allowComponent = opts.allowComponent !== false;
  const allowSet = opts.allowSet !== false;
  const preferSet = opts.preferSet === true;
  const id =
    params && params.componentSetId ? String(params.componentSetId)
      : params && params.componentId ? String(params.componentId)
      : params && params.nodeId ? String(params.nodeId)
      : params && params.propertyOwnerId ? String(params.propertyOwnerId)
      : "";
  if (!id) throw new Error("Missing componentId, componentSetId, nodeId, or propertyOwnerId");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(id));
  if (node.type === "COMPONENT") {
    if (preferSet && node.parent && node.parent.type === "COMPONENT_SET" && allowSet) return node.parent;
    if (!allowComponent) {
      if (node.parent && node.parent.type === "COMPONENT_SET" && allowSet) return node.parent;
      throw new Error("Expected a COMPONENT_SET node");
    }
    return node;
  }
  if (node.type === "COMPONENT_SET") {
    if (!allowSet) throw new Error("Expected a COMPONENT node");
    return node;
  }
  throw new Error("Node is not a COMPONENT or COMPONENT_SET");
}

async function resolveComponentNodeForSlot(params) {
  const id =
    params && params.componentId ? String(params.componentId)
      : params && params.nodeId ? String(params.nodeId)
      : params && params.componentSetId ? String(params.componentSetId)
      : "";
  if (!id) throw new Error("Missing componentId, componentSetId, or nodeId");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(id));
  if (node.type === "COMPONENT") return node;
  if (node.type === "COMPONENT_SET") {
    const variantId =
      params && params.variantComponentId
        ? String(params.variantComponentId)
        : node.defaultVariant
          ? node.defaultVariant.id
          : "";
    if (!variantId) throw new Error("Component set has no default variant. Pass variantComponentId.");
    const variantNode = await getNodeByIdAsync(normalizeFigmaNodeId(variantId));
    if (variantNode.type !== "COMPONENT") throw new Error("variantComponentId must reference a COMPONENT");
    return variantNode;
  }
  throw new Error("Node is not a COMPONENT or COMPONENT_SET");
}

async function resolvePropertyOwnerForBinding(node, propertyName, preferredOwnerId) {
  if (preferredOwnerId) {
    const explicit = await resolveComponentAuthoringNode({ propertyOwnerId: preferredOwnerId }, { allowComponent: true, allowSet: true });
    const defs = explicit.componentPropertyDefinitions || {};
    if (!Object.prototype.hasOwnProperty.call(defs, propertyName)) {
      throw new Error("Component property not found on propertyOwnerId: " + propertyName);
    }
    return explicit;
  }
  const ancestors = getAncestorChain(node);
  for (let i = 0; i < ancestors.length; i += 1) {
    const current = ancestors[i];
    if (!current || (current.type !== "COMPONENT" && current.type !== "COMPONENT_SET")) continue;
    const defs = current.componentPropertyDefinitions || {};
    if (Object.prototype.hasOwnProperty.call(defs, propertyName)) return current;
  }
  throw new Error("Component property not found in the node ancestry: " + propertyName);
}

// ---------------------------------------------------------------------------
// Node filtering for export
// ---------------------------------------------------------------------------

// Figma's JSON_REST_V1 export returns hundreds of fields per node (constraints,
// reactions, effects, guides, blendMode, exportSettings, prototype interactions,
// absoluteRenderBounds, etc). filterFigmaNode builds a fresh object and copies
// over only the named fields below, so anything not explicitly listed here
// (constraints, reactions, effects, guides included) is dropped by construction
// rather than requiring an explicit delete.

function roundNum(n, decimals) {
  if (typeof n !== "number" || !isFinite(n)) return n;
  const factor = Math.pow(10, decimals === undefined ? 2 : decimals);
  return Math.round(n * factor) / factor;
}

// Trims a REST-exported componentPropertyDefinitions map down to the fields
// useful for reading a node (type/defaultValue/variantOptions). Full detail
// including preferredValues and boundVariables is available via the
// dedicated get_component_property_definitions tool when actually needed.
function simplifyComponentPropertyDefinitionsForRead(definitions) {
  const out = {};
  const defs = definitions && typeof definitions === "object" ? definitions : {};
  for (const [propertyName, def] of Object.entries(defs)) {
    if (!def || typeof def !== "object") continue;
    const item = { type: def.type, defaultValue: def.defaultValue };
    if (Array.isArray(def.variantOptions)) item.variantOptions = def.variantOptions.slice();
    out[propertyName] = item;
  }
  return out;
}

function filterFigmaNode(node, options, depth) {
  if (!node) return null;
  if (node.type === "VECTOR") return null;
  const opts = options && typeof options === "object" ? options : {};
  const currentDepth = depth || 0;
  if (Array.isArray(opts.excludeTypes) && opts.excludeTypes.indexOf(node.type) >= 0) return null;

  const filtered = { id: node.id, name: node.name, type: node.type };

  if (node.fills && node.fills.length > 0) {
    filtered.fills = node.fills.map((fill) => {
      const processedFill = Object.assign({}, fill);
      delete processedFill.boundVariables;
      delete processedFill.imageRef;
      delete processedFill.gifRef;
      if (processedFill.blendMode === "NORMAL") delete processedFill.blendMode;
      if (processedFill.visible === true) delete processedFill.visible;
      if (typeof processedFill.opacity === "number") processedFill.opacity = roundNum(processedFill.opacity, 3);
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
      if (processedStroke.blendMode === "NORMAL") delete processedStroke.blendMode;
      if (processedStroke.visible === true) delete processedStroke.visible;
      if (typeof processedStroke.opacity === "number") processedStroke.opacity = roundNum(processedStroke.opacity, 3);
      if (processedStroke.color) processedStroke.color = rgbaToHex(processedStroke.color);
      return processedStroke;
    });
  }

  if (node.strokeWeight !== undefined) filtered.strokeWeight = roundNum(node.strokeWeight);
  if (node.cornerRadius !== undefined) filtered.cornerRadius = roundNum(node.cornerRadius);
  if (node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox;
    filtered.absoluteBoundingBox = {
      x: roundNum(box.x), y: roundNum(box.y),
      width: roundNum(box.width), height: roundNum(box.height)
    };
  }
  if (node.characters) filtered.characters = node.characters;
  if (node.componentId !== undefined) filtered.componentId = node.componentId;
  if (node.componentSetId !== undefined) filtered.componentSetId = node.componentSetId;
  if (node.componentProperties !== undefined) filtered.componentProperties = node.componentProperties;
  if (node.componentPropertyDefinitions !== undefined) {
    filtered.componentPropertyDefinitions = simplifyComponentPropertyDefinitionsForRead(node.componentPropertyDefinitions);
  }
  if (node.variantProperties !== undefined) filtered.variantProperties = node.variantProperties;

  // A node bound to a shared text style repeats the same 7 fields on every
  // instance of that style. Emit just the style id instead of expanding it;
  // callers can resolve the id separately (e.g. via get_styles) if needed.
  if (node.styles && node.styles.text) {
    filtered.textStyleId = node.styles.text;
  } else if (node.style) {
    filtered.style = {
      fontFamily: node.style.fontFamily,
      fontStyle: node.style.fontStyle,
      fontWeight: node.style.fontWeight,
      fontSize: roundNum(node.style.fontSize),
      textAlignHorizontal: node.style.textAlignHorizontal,
      letterSpacing: roundNum(node.style.letterSpacing),
      lineHeightPx: roundNum(node.style.lineHeightPx)
    };
  }

  if (node.children) {
    const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : null;
    if (maxDepth !== null && currentDepth >= maxDepth) {
      if (node.children.length > 0) {
        filtered.childCount = node.children.length;
        filtered.childrenTruncated = true;
      }
    } else {
      filtered.children = node.children
        .map((child) => filterFigmaNode(child, opts, currentDepth + 1))
        .filter((child) => child !== null);
    }
  }

  if (Array.isArray(opts.fields) && opts.fields.length) {
    const keep = new Set(["id", "name", "type"].concat(opts.fields.map(String)));
    const projected = {};
    for (const key of Object.keys(filtered)) {
      if (keep.has(key)) projected[key] = filtered[key];
    }
    return projected;
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Read actions
// ---------------------------------------------------------------------------

async function getDocumentInfoFull() {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  return {
    name: page.name,
    id: page.id,
    type: page.type,
    fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
    children: page.children.map((node) => ({ id: node.id, name: node.name, type: node.type })),
    currentPage: { id: page.id, name: page.name, childCount: page.children.length },
    pages: [{ id: page.id, name: page.name, childCount: page.children.length }]
  };
}

async function getSelectionFull() {
  return {
    selectionCount: figma.currentPage.selection.length,
    selection: figma.currentPage.selection.map((node) => ({
      id: node.id, name: node.name, type: node.type, visible: node.visible
    }))
  };
}

async function getNodeInfo(nodeId, options) {
  const node = await figma.getNodeByIdAsync(String(nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(nodeId));
  const response = await node.exportAsync({ format: "JSON_REST_V1" });
  return filterFigmaNode(response.document, options);
}

async function getNodesInfo(nodeIds, options) {
  const ids = ensureArray(nodeIds).map((id) => String(id));
  const nodes = await Promise.all(ids.map((id) => figma.getNodeByIdAsync(id)));
  const validNodes = nodes.filter((n) => n !== null);
  const responses = await Promise.all(
    validNodes.map(async (node) => {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      return { nodeId: node.id, document: filterFigmaNode(response.document, options) };
    })
  );
  return responses;
}

async function readMyDesign(options) {
  const selection = figma.currentPage.selection;
  if (!selection || selection.length === 0) throw new Error("No selection found");
  if (selection.length === 1) return await getNodeInfo(selection[0].id, options);
  return await getNodesInfo(selection.map((n) => n.id), options);
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

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

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
  if (pluginTargetFrameIds.size === 0) {
    pluginTargetFrameIds = new Set([frame.id]);
    try {
      figma.ui.postMessage({ type: "targetFrames", targetFrameIds: Array.from(pluginTargetFrameIds) });
    } catch (_err) {}
  }
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

// ---------------------------------------------------------------------------
// Node mutation
// ---------------------------------------------------------------------------

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
  node.fills = [{ type: "SOLID", color: { r, g, b }, opacity }];
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
  node.strokes = [{ type: "SOLID", color: { r, g, b }, opacity }];
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

async function deleteNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const confirmFrameOrPageDeletion = params && typeof params === "object" ? params.confirmFrameOrPageDeletion === true : false;
  const isPage = node.type === "PAGE";
  const isTopLevelFrame = node.type === "FRAME" && node.parent && node.parent.type === "PAGE";
  if ((isPage || isTopLevelFrame) && !confirmFrameOrPageDeletion) {
    throw new Error("Confirmation required to delete a page or a top-level frame. Pass confirmFrameOrPageDeletion: true.");
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
      if (!node) { failed.push({ nodeId, error: "Node not found" }); continue; }
      const confirmFrameOrPageDeletion = p.confirmFrameOrPageDeletion === true;
      const isPage = node.type === "PAGE";
      const isTopLevelFrame = node.type === "FRAME" && node.parent && node.parent.type === "PAGE";
      if ((isPage || isTopLevelFrame) && !confirmFrameOrPageDeletion) {
        failed.push({ nodeId, error: "Confirmation required to delete a page or a top-level frame" }); continue;
      }
      assertNodeWritable(node, p);
      if (!("remove" in node)) { failed.push({ nodeId, error: "Node does not support remove" }); continue; }
      node.remove();
      deletedNodeIds.push(nodeId);
    } catch (err) {
      failed.push({ nodeId: String(id), error: err && err.message ? String(err.message) : String(err) });
    }
  }
  return { success: true, deletedNodeIds, failed };
}

// ---------------------------------------------------------------------------
// Checkpoints (best-effort undo)
// ---------------------------------------------------------------------------
// Figma's Plugin API has no programmatic undo/redo — only the user's Ctrl+Z
// stack can undo. These checkpoints are NOT true undo: they snapshot a handful
// of common mutable properties (position, size, rotation, opacity, visibility,
// fills, strokes, corner radius, text characters) on still-existing nodes and
// can reapply them. They cannot restore a deleted node or undo structural
// changes (reparenting, new children). State lives only for this plugin
// session and is lost on reload.

const checkpoints = new Map();
let checkpointSeq = 0;
const CHECKPOINT_MAX = 50;

async function captureNodeSnapshotProps(node) {
  const props = {};
  try {
    if ("name" in node) props.name = node.name;
    if ("x" in node) props.x = node.x;
    if ("y" in node) props.y = node.y;
    if ("width" in node && "height" in node && "resize" in node) {
      props.width = node.width;
      props.height = node.height;
    }
    if ("rotation" in node) props.rotation = node.rotation;
    if ("opacity" in node && typeof node.opacity === "number") props.opacity = node.opacity;
    if ("visible" in node) props.visible = node.visible;
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") props.cornerRadius = node.cornerRadius;
    if ("fills" in node && Array.isArray(node.fills)) props.fills = JSON.parse(JSON.stringify(node.fills));
    if ("strokes" in node && Array.isArray(node.strokes)) props.strokes = JSON.parse(JSON.stringify(node.strokes));
    if ("strokeWeight" in node && typeof node.strokeWeight === "number") props.strokeWeight = node.strokeWeight;
    if (node.type === "TEXT" && "characters" in node) props.characters = node.characters;
  } catch (_err) {
    // Best-effort: skip properties that throw (e.g. mixed values) rather than failing the whole capture.
  }
  return props;
}

async function applyNodeSnapshotProps(node, props) {
  if (!props || typeof props !== "object") return;
  if (props.name !== undefined && "name" in node) node.name = props.name;
  if (props.x !== undefined) node.x = props.x;
  if (props.y !== undefined) node.y = props.y;
  if (props.width !== undefined && props.height !== undefined && "resize" in node) node.resize(props.width, props.height);
  if (props.rotation !== undefined && "rotation" in node) node.rotation = props.rotation;
  if (props.opacity !== undefined && "opacity" in node) node.opacity = props.opacity;
  if (props.visible !== undefined && "visible" in node) node.visible = props.visible;
  if (props.cornerRadius !== undefined && "cornerRadius" in node) node.cornerRadius = props.cornerRadius;
  if (props.fills !== undefined && "fills" in node) node.fills = props.fills;
  if (props.strokes !== undefined && "strokes" in node) node.strokes = props.strokes;
  if (props.strokeWeight !== undefined && "strokeWeight" in node) node.strokeWeight = props.strokeWeight;
  if (props.characters !== undefined && node.type === "TEXT") {
    if (node.fontName && node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
    node.characters = props.characters;
  }
}

async function createCheckpoint(params) {
  const p = params && typeof params === "object" ? params : {};
  const ids = ensureArray(p.nodeIds).map((id) => String(id));
  if (!ids.length) throw new Error("Missing nodeIds");
  const label = p.label !== undefined && p.label !== null ? String(p.label) : "";
  const snapshot = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(normalizeFigmaNodeId(id));
    if (!node) continue;
    snapshot.push({ nodeId: node.id, name: node.name, type: node.type, props: await captureNodeSnapshotProps(node) });
  }
  if (!snapshot.length) throw new Error("None of the requested nodes were found");
  checkpointSeq += 1;
  const checkpointId = "ckpt_" + checkpointSeq + "_" + Date.now();
  checkpoints.set(checkpointId, { checkpointId, label, createdAt: Date.now(), snapshot });
  if (checkpoints.size > CHECKPOINT_MAX) {
    const oldestKey = checkpoints.keys().next().value;
    checkpoints.delete(oldestKey);
  }
  return { success: true, checkpointId, label, nodeCount: snapshot.length, nodeIds: snapshot.map((s) => s.nodeId) };
}

async function restoreCheckpoint(params) {
  const p = params && typeof params === "object" ? params : {};
  const checkpointId = p.checkpointId ? String(p.checkpointId) : "";
  if (!checkpointId) throw new Error("Missing checkpointId");
  const entry = checkpoints.get(checkpointId);
  if (!entry) throw new Error("Checkpoint not found: " + checkpointId + " (checkpoints only live for the current plugin session)");
  const results = [];
  for (const item of entry.snapshot) {
    const result = { nodeId: item.nodeId, restored: false };
    try {
      const node = await figma.getNodeByIdAsync(item.nodeId);
      if (!node) { result.error = "Node no longer exists"; results.push(result); continue; }
      assertNodeWritable(node, p);
      await applyNodeSnapshotProps(node, item.props);
      result.restored = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }
  return { success: results.every((r) => r.restored), checkpointId, label: entry.label, results };
}

async function listCheckpoints() {
  return {
    checkpoints: Array.from(checkpoints.values()).map((c) => ({
      checkpointId: c.checkpointId,
      label: c.label,
      createdAt: c.createdAt,
      nodeIds: c.snapshot.map((s) => s.nodeId)
    }))
  };
}

// ---------------------------------------------------------------------------
// Undo / Redo (best-effort snapshot stacks)
// ---------------------------------------------------------------------------
// Same limits as checkpoints: only snapshot common mutable properties on still-
// existing nodes. Cannot restore deleted nodes or structural changes. State
// lives only for this plugin session. Every mutating action in UNDOABLE_ACTIONS
// is auto-captured by handleAction (before + after) onto the undo stack.

const undoStack = [];
const redoStack = [];
const UNDO_MAX = 50;

const UNDOABLE_ACTIONS = new Set([
  "rename_node", "set_fill_color", "set_stroke_color", "set_gradient_fill", "set_image_fill",
  "set_effects", "set_text_style", "move_node", "resize_node", "set_corner_radius",
  "set_text_content", "set_multiple_text_contents", "set_layout_mode", "set_padding",
  "set_axis_align", "set_layout_sizing", "set_item_spacing", "set_auto_layout",
  "set_layout_grids", "set_overflow_direction", "set_fixed_children",
  "set_annotation", "set_multiple_annotations", "set_reactions", "clear_reactions",
  "upsert_reaction", "set_transition_reaction", "set_smart_animate_reaction",
  "apply_fill_style", "apply_stroke_style", "apply_text_style", "apply_effect_style",
  "apply_grid_style", "bind_color_variable_to_fill", "bind_color_variable_to_stroke",
  "bind_variable_to_property", "set_node_explicit_variable_mode",
  "set_vector_paths", "set_variant_properties", "set_instance_properties",
  "set_overlay_settings", "append_to_slot",
  "distribute_nodes", "arrange_children"
]);

async function collectNodeSnapshots(ids) {
  const snapshot = [];
  const seen = new Set();
  for (const rawId of ids) {
    const id = String(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = await figma.getNodeByIdAsync(normalizeFigmaNodeId(id));
    if (!node || node.removed) continue;
    snapshot.push({ nodeId: node.id, name: node.name, type: node.type, props: await captureNodeSnapshotProps(node) });
  }
  return snapshot;
}

async function collectCurrentSnapshots(snapshot) {
  return collectNodeSnapshots(snapshot.map((s) => s.nodeId));
}

function undoLabelFor(action, p) {
  const base = String(action || "");
  if (p && p.nodeId) return base + " " + String(p.nodeId);
  return base;
}

function extractUndoableIds(action, p) {
  const extractor = TARGET_SCOPED_ACTIONS[action];
  if (extractor) return extractor(p || {}).filter(Boolean);
  const candidates = p && p.nodeIds ? ensureArray(p.nodeIds) : [];
  return candidates.filter(Boolean);
}

async function collectBeforeSnapshotsForAction(action, p) {
  if (action === "arrange_children") {
    if (!p || !p.parentNodeId) return [];
    const parent = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.parentNodeId)));
    if (!parent || !("children" in parent)) return [];
    return collectNodeSnapshots(parent.children.map((c) => c.id));
  }
  const ids = extractUndoableIds(action, p);
  return ids.length ? await collectNodeSnapshots(ids) : [];
}

function recordUndoableEntry(label, before, after) {
  if ((!before || !before.length) && (!after || !after.length)) return;
  undoStack.push({ label: String(label || ""), before: before || [], after: after || [], createdAt: Date.now() });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
}

async function applySnapshotToNodes(snapshot) {
  const results = [];
  for (const item of snapshot || []) {
    const result = { nodeId: item.nodeId, restored: false };
    try {
      const node = await figma.getNodeByIdAsync(item.nodeId);
      if (!node) { result.error = "Node no longer exists"; results.push(result); continue; }
      assertNodeWritable(node, {});
      await applyNodeSnapshotProps(node, item.props);
      result.restored = true;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
  }
  return { success: results.every((r) => r.restored), results };
}

async function undoAction() {
  const entry = undoStack.pop();
  if (!entry) return { success: false, message: "Nothing to undo" };
  const current = await collectCurrentSnapshots(entry.before);
  const result = await applySnapshotToNodes(entry.before);
  redoStack.push({ label: entry.label, before: current, after: entry.after, createdAt: Date.now() });
  return { success: result.success, label: entry.label, message: entry.label || "Undo", results: result.results };
}

async function redoAction() {
  const entry = redoStack.pop();
  if (!entry) return { success: false, message: "Nothing to redo" };
  const current = await collectCurrentSnapshots(entry.after);
  const result = await applySnapshotToNodes(entry.after);
  undoStack.push({ label: entry.label, before: current, after: entry.after, createdAt: Date.now() });
  return { success: result.success, label: entry.label, message: entry.label || "Redo", results: result.results };
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
    if ("x" in cloned && "y" in cloned) { cloned.x = Number(cloned.x) + dx; cloned.y = Number(cloned.y) + dy; }
    let containingPage = parent;
    while (containingPage && containingPage.type !== "PAGE") containingPage = containingPage.parent;
    if (containingPage && figma.currentPage && containingPage.id === figma.currentPage.id) {
      figma.currentPage.selection = [cloned];
      figma.viewport.scrollAndZoomIntoView([cloned]);
    }
    return { success: true, nodeId: cloned.id, parentNodeId: parent.id };
  } catch (err) {
    if (cloned && "remove" in cloned) { try { cloned.remove(); } catch (_) {} }
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

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

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
  return { success: true, requested: updates.length, updated };
}

async function scanTextNodes(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  const chunkSize = Math.min(500, params && params.chunkSize ? Number(params.chunkSize) : 200);
  const offset = params && params.offset ? Number(params.offset) : 0;
  let root = null;
  if (rootNodeId) root = await figma.getNodeByIdAsync(rootNodeId);
  const container = root && root.type !== "DOCUMENT" ? root : figma.currentPage;
  const nodes = container.findAll((n) => n.type === "TEXT");
  const items = nodes.map((n) => ({ id: n.id, name: n.name, characters: String(n.characters || "") }));
  const slice = items.slice(offset, offset + chunkSize);
  return { total: items.length, offset, chunkSize, items: slice };
}

async function scanNodesByTypes(params) {
  await figma.currentPage.loadAsync();
  const types = ensureArray(params && params.types).map((t) => String(t).toUpperCase());
  if (!types.length) throw new Error("Missing types");
  const nodes = figma.currentPage.findAll((n) => types.indexOf(String(n.type).toUpperCase()) >= 0);
  return nodes.map((n) => ({ id: n.id, name: n.name, type: n.type }));
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

async function createPaintStyle(params) {
  const name = params && params.name ? String(params.name) : "";
  if (!name) throw new Error("Missing name");
  const styles = await getLocalPaintStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createPaintStyle();
  style.name = name;
  const hex = params && params.hex ? String(params.hex) : "";
  const paints = params && params.paints ? ensureArray(params.paints) : null;
  if (hex) { style.paints = [{ type: "SOLID", color: hexToRgb01(hex) }]; }
  else if (paints) { style.paints = paints; }
  else { throw new Error("Missing paints or hex"); }
  return { id: style.id, name: style.name };
}

async function createEffectStyle(params) {
  const name = params && params.name ? String(params.name) : "";
  if (!name) throw new Error("Missing name");
  const effects = ensureArray(params && params.effects);
  if (!effects.length) throw new Error("Missing effects");
  const styles = await getLocalEffectStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createEffectStyle();
  style.name = name;
  style.effects = effects;
  return { id: style.id, name: style.name };
}

async function createTextStyleAction(params) {
  const name = params && params.name ? String(params.name) : "";
  const fontFamily = params && params.fontFamily ? String(params.fontFamily) : "";
  const fontStyle = params && params.fontStyle ? String(params.fontStyle) : "Regular";
  if (!name) throw new Error("Missing name");
  if (!fontFamily) throw new Error("Missing fontFamily");
  const styles = await getLocalTextStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createTextStyle();
  style.name = name;
  const fontName = await safeLoadFont(fontFamily, fontStyle);
  style.fontName = fontName;
  if (params.fontSize !== undefined && params.fontSize !== null) style.fontSize = Number(params.fontSize);
  if (params.lineHeight !== undefined && params.lineHeight !== null) style.lineHeight = { unit: "PIXELS", value: Number(params.lineHeight) };
  if (params.letterSpacing !== undefined && params.letterSpacing !== null) style.letterSpacing = { unit: "PERCENT", value: Number(params.letterSpacing) };
  if (params.paragraphSpacing !== undefined && params.paragraphSpacing !== null) style.paragraphSpacing = Number(params.paragraphSpacing);
  if (params.textCase !== undefined && params.textCase !== null) style.textCase = params.textCase;
  if (params.textDecoration !== undefined && params.textDecoration !== null) style.textDecoration = params.textDecoration;
  if (params.fillsHex) { style.fills = [{ type: "SOLID", color: hexToRgb01(String(params.fillsHex)) }]; }
  else if (params.fills) { style.fills = ensureArray(params.fills); }
  return { id: style.id, name: style.name };
}

async function createGridStyle(params) {
  const name = params && params.name ? String(params.name) : "";
  if (!name) throw new Error("Missing name");
  const layoutGrids = ensureArray(params && params.layoutGrids);
  if (!layoutGrids.length) throw new Error("Missing layoutGrids");
  const styles = await getLocalGridStyles();
  const existing = styles.find((s) => s.name === name);
  const style = existing || figma.createGridStyle();
  style.name = name;
  style.layoutGrids = layoutGrids;
  return { id: style.id, name: style.name };
}

async function importStyleByKey(params) {
  const key = params && params.key ? String(params.key) : "";
  if (!key) throw new Error("Missing key");
  const style = await figma.importStyleByKeyAsync(key);
  return { id: style.id, name: style.name, type: style.type, key: style.key };
}

async function applyFillStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.styleId) throw new Error("Missing styleId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("fills" in node)) throw new Error("Node does not support fills");
  await setFillStyleId(node, String(params.styleId));
  return { success: true, nodeId: node.id, styleId: String(params.styleId) };
}

async function applyStrokeStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.styleId) throw new Error("Missing styleId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("strokes" in node)) throw new Error("Node does not support strokes");
  await setStrokeStyleId(node, String(params.styleId));
  return { success: true, nodeId: node.id, styleId: String(params.styleId) };
}

async function applyEffectStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.styleId) throw new Error("Missing styleId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("effects" in node)) throw new Error("Node does not support effects");
  await setEffectStyleId(node, String(params.styleId));
  return { success: true, nodeId: node.id, styleId: String(params.styleId) };
}

async function applyTextStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.styleId) throw new Error("Missing styleId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (node.type !== "TEXT") throw new Error("Node is not a TEXT node");
  await safeLoadFont("Inter", "Regular");
  await setTextStyleId(node, String(params.styleId));
  return { success: true, nodeId: node.id, styleId: String(params.styleId) };
}

async function applyGridStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.styleId) throw new Error("Missing styleId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("layoutGrids" in node)) throw new Error("Node does not support layoutGrids");
  await setGridStyleId(node, String(params.styleId));
  return { success: true, nodeId: node.id, styleId: String(params.styleId) };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

async function setAutoLayout(params) {
  if (!params || !params.frameId) throw new Error("Missing frameId");
  const node = await figma.getNodeByIdAsync(String(params.frameId));
  if (!node) throw new Error("Node not found with ID: " + String(params.frameId));
  assertNodeWritable(node, params);
  if (!("layoutMode" in node)) throw new Error("Node does not support auto layout");
  if (params.layoutMode !== undefined && params.layoutMode !== null) node.layoutMode = String(params.layoutMode);
  if (params.layoutWrap !== undefined && params.layoutWrap !== null && "layoutWrap" in node) node.layoutWrap = String(params.layoutWrap);
  if (params.padding && typeof params.padding === "object") {
    if (!("paddingTop" in node)) throw new Error("Node does not support auto layout padding");
    if (params.padding.top !== undefined) node.paddingTop = Number(params.padding.top);
    if (params.padding.right !== undefined) node.paddingRight = Number(params.padding.right);
    if (params.padding.bottom !== undefined) node.paddingBottom = Number(params.padding.bottom);
    if (params.padding.left !== undefined) node.paddingLeft = Number(params.padding.left);
  }
  if (params.itemSpacing !== undefined && params.itemSpacing !== null && "itemSpacing" in node) node.itemSpacing = Number(params.itemSpacing);
  if (params.primaryAxisAlignItems !== undefined && params.primaryAxisAlignItems !== null && "primaryAxisAlignItems" in node) node.primaryAxisAlignItems = String(params.primaryAxisAlignItems);
  if (params.counterAxisAlignItems !== undefined && params.counterAxisAlignItems !== null && "counterAxisAlignItems" in node) node.counterAxisAlignItems = String(params.counterAxisAlignItems);
  if (params.sizing && typeof params.sizing === "object") {
    if (params.sizing.primaryAxisSizingMode !== undefined && "primaryAxisSizingMode" in node) node.primaryAxisSizingMode = String(params.sizing.primaryAxisSizingMode);
    if (params.sizing.counterAxisSizingMode !== undefined && "counterAxisSizingMode" in node) node.counterAxisSizingMode = String(params.sizing.counterAxisSizingMode);
  }
  return { success: true, frameId: node.id, layoutMode: node.layoutMode, layoutWrap: "layoutWrap" in node ? node.layoutWrap : undefined };
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
  if ("primaryAxisSizingMode" in node && params.primaryAxisSizingMode !== undefined) node.primaryAxisSizingMode = String(params.primaryAxisSizingMode);
  if ("counterAxisSizingMode" in node && params.counterAxisSizingMode !== undefined) node.counterAxisSizingMode = String(params.counterAxisSizingMode);
  if ("layoutSizingHorizontal" in node && params.layoutSizingHorizontal !== undefined) node.layoutSizingHorizontal = String(params.layoutSizingHorizontal);
  if ("layoutSizingVertical" in node && params.layoutSizingVertical !== undefined) node.layoutSizingVertical = String(params.layoutSizingVertical);
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

async function setLayoutGrids(params) {
  if (!params || !params.frameId) throw new Error("Missing frameId");
  const node = await figma.getNodeByIdAsync(String(params.frameId));
  if (!node) throw new Error("Node not found with ID: " + String(params.frameId));
  assertNodeWritable(node, params);
  if (!("layoutGrids" in node)) throw new Error("Node does not support layoutGrids");
  const layoutGrids = ensureArray(params.layoutGrids);
  node.layoutGrids = layoutGrids;
  return { success: true, frameId: node.id, layoutGridsCount: node.layoutGrids.length };
}

async function setOverflowDirection(params) {
  if (!params || !params.frameId) throw new Error("Missing frameId");
  const node = await figma.getNodeByIdAsync(String(params.frameId));
  if (!node) throw new Error("Node not found with ID: " + String(params.frameId));
  assertNodeWritable(node, params);
  if (!("overflowDirection" in node)) throw new Error("Node does not support overflowDirection");
  node.overflowDirection = String(params.overflowDirection || "NONE");
  return { success: true, frameId: node.id, overflowDirection: node.overflowDirection };
}

async function setFixedChildren(params) {
  if (!params || !params.frameId) throw new Error("Missing frameId");
  const node = await figma.getNodeByIdAsync(String(params.frameId));
  if (!node) throw new Error("Node not found with ID: " + String(params.frameId));
  assertNodeWritable(node, params);
  if (!("children" in node) || !("numberOfFixedChildren" in node)) throw new Error("Node does not support fixed children");
  const ids = ensureArray(params.fixedChildIds).map((x) => String(x));
  const set = new Set(ids);
  const byId = new Map();
  for (let i = 0; i < node.children.length; i += 1) byId.set(node.children[i].id, node.children[i]);
  for (let i = 0; i < ids.length; i += 1) {
    if (!byId.has(ids[i])) throw new Error("fixedChildId is not a direct child of frame: " + ids[i]);
  }
  const nonFixed = [];
  for (let i = 0; i < node.children.length; i += 1) {
    if (!set.has(node.children[i].id)) nonFixed.push(node.children[i]);
  }
  const fixed = ids.map((id) => byId.get(id)).filter(Boolean);
  const next = nonFixed.concat(fixed);
  for (let i = 0; i < next.length; i += 1) node.insertChild(i, next[i]);
  node.numberOfFixedChildren = fixed.length;
  return { success: true, frameId: node.id, fixedChildrenCount: fixed.length };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

async function getLocalComponents(params) {
  await figma.currentPage.loadAsync();
  const page = figma.currentPage;
  const includeComponentSets = params && params.includeComponentSets !== undefined ? Boolean(params.includeComponentSets) : true;
  const nodes = page.findAll((n) => {
    if (n.type === "COMPONENT") {
      // A variant component is a child of a COMPONENT_SET. Reading
      // componentPropertyDefinitions on a variant throws in the Plugin API,
      // and variants are already represented by their parent COMPONENT_SET,
      // so skip them here.
      if (n.parent && n.parent.type === "COMPONENT_SET") return false;
      return true;
    }
    if (includeComponentSets && n.type === "COMPONENT_SET") return true;
    return false;
  });
  return nodes.map((n) => {
    let defs = {};
    try {
      defs = n.componentPropertyDefinitions
        ? simplifyComponentPropertyDefinitionsForRead(n.componentPropertyDefinitions)
        : {};
    } catch {
      defs = {};
    }
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      description: typeof n.description === "string" && n.description ? n.description : null,
      key: typeof n.key === "string" && n.key ? n.key : null,
      componentPropertyDefinitions: Object.keys(defs).length ? defs : null
    };
  });
}

async function createComponentNode(params) {
  const p = params && typeof params === "object" ? params : {};
  const component = figma.createComponent();
  component.resize(
    Number(p.width === undefined || p.width === null ? 100 : p.width),
    Number(p.height === undefined || p.height === null ? 100 : p.height)
  );
  component.x = Number(p.x === undefined || p.x === null ? 0 : p.x);
  component.y = Number(p.y === undefined || p.y === null ? 0 : p.y);
  component.name = p.name ? String(p.name) : "Component";
  const host = await resolveCreateHost(p);
  if (component.parent !== host) host.appendChild(component);
  figma.currentPage.selection = [component];
  figma.viewport.scrollAndZoomIntoView([component]);
  return { success: true, nodeId: component.id, name: component.name, type: component.type };
}

async function createComponentFromNodeAction(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const source = await getNodeByIdAsync(normalizeFigmaNodeId(params.nodeId));
  if (source.type === "COMPONENT" || source.type === "COMPONENT_SET" || source.type === "INSTANCE") {
    throw new Error("Node type cannot be converted into a component: " + source.type);
  }
  assertNodeWritable(source, params);
  const component = figma.createComponentFromNode(source);
  if (params.name !== undefined && params.name !== null) component.name = String(params.name);
  figma.currentPage.selection = [component];
  figma.viewport.scrollAndZoomIntoView([component]);
  return { success: true, nodeId: component.id, name: component.name, type: component.type };
}

function layoutComponentSetVariants(componentSet, params) {
  const p = params && typeof params === "object" ? params : {};
  const gapX = Number(p.gapX === undefined || p.gapX === null ? (p.gap === undefined || p.gap === null ? 80 : p.gap) : p.gapX);
  const gapY = Number(p.gapY === undefined || p.gapY === null ? (p.gap === undefined || p.gap === null ? 80 : p.gap) : p.gapY);
  const rawColumns = Number(p.columns);
  const columns = Number.isFinite(rawColumns) && rawColumns > 0 ? Math.max(1, Math.floor(rawColumns)) : componentSet.children.length;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < componentSet.children.length; i += 1) {
    const child = componentSet.children[i];
    const col = i % columns;
    const row = Math.floor(i / columns);
    child.x = col * (child.width + gapX);
    child.y = row * (child.height + gapY);
    maxX = Math.max(maxX, child.x + child.width);
    maxY = Math.max(maxY, child.y + child.height);
  }
  if (typeof componentSet.resizeWithoutConstraints === "function") {
    componentSet.resizeWithoutConstraints(maxX || componentSet.width, maxY || componentSet.height);
  }
}

async function combineAsVariantsAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const ids = ensureArray(p.componentIds).map((id) => normalizeFigmaNodeId(id));
  if (!ids.length) throw new Error("Missing componentIds");
  const nodes = [];
  for (let i = 0; i < ids.length; i += 1) {
    const node = await getNodeByIdAsync(ids[i]);
    if (node.type !== "COMPONENT") throw new Error("All componentIds must reference COMPONENT nodes");
    nodes.push(node);
  }
  const parent = p.parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(p.parentNodeId)) : nodes[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("Parent cannot contain children");
  const index = Number.isFinite(Number(p.index)) ? Math.max(0, Math.floor(Number(p.index))) : undefined;
  const componentSet = index === undefined ? figma.combineAsVariants(nodes, parent) : figma.combineAsVariants(nodes, parent, index);
  if (p.name !== undefined && p.name !== null) componentSet.name = String(p.name);
  layoutComponentSetVariants(componentSet, p);
  figma.currentPage.selection = [componentSet];
  figma.viewport.scrollAndZoomIntoView([componentSet]);
  return {
    success: true,
    componentSetId: componentSet.id,
    name: componentSet.name,
    type: componentSet.type,
    componentIds: componentSet.children.map((child) => child.id),
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(componentSet.componentPropertyDefinitions)
  };
}

async function setVariantPropertiesAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const properties = p.properties && typeof p.properties === "object" ? p.properties : null;
  if (!properties) throw new Error("Missing properties");
  const component = await resolveComponentAuthoringNode(p, { allowComponent: true, allowSet: false });
  assertNodeWritable(component, p);
  component.name = formatVariantComponentName(properties);
  return {
    success: true,
    componentId: component.id,
    componentSetId: component.parent && component.parent.type === "COMPONENT_SET" ? component.parent.id : null,
    name: component.name,
    variantProperties: component.variantProperties || {}
  };
}

async function getComponentPropertyDefinitionsAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const owner = await resolveComponentAuthoringNode(p, {
    allowComponent: true,
    allowSet: true,
    preferSet: p.preferComponentSet !== false
  });
  return {
    success: true,
    nodeId: owner.id,
    name: owner.name,
    type: owner.type,
    componentSetId: owner.type === "COMPONENT" && owner.parent && owner.parent.type === "COMPONENT_SET" ? owner.parent.id : owner.type === "COMPONENT_SET" ? owner.id : null,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions)
  };
}

async function addComponentPropertyAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const propertyName = p.name === undefined || p.name === null ? "" : String(p.name).trim();
  if (!propertyName) throw new Error("Missing property name");
  const type = normalizeComponentPropertyType(p.type);
  if (type === "SLOT") throw new Error("Use create_component_slot for SLOT properties");
  const owner = await resolveComponentAuthoringNode(p, {
    allowComponent: true,
    allowSet: true,
    preferSet: type === "VARIANT" ? true : p.preferComponentSet !== false
  });
  if (type === "VARIANT" && owner.type !== "COMPONENT_SET") {
    throw new Error("VARIANT properties must be added on a COMPONENT_SET");
  }
  assertNodeWritable(owner, p);
  const defaultValue = normalizeComponentPropertyDefaultValue(type, p.defaultValue);
  const options = {};
  if (type === "INSTANCE_SWAP" && p.preferredValues !== undefined) {
    options.preferredValues = normalizeInstanceSwapPreferredValues(p.preferredValues);
  }
  const resolvedPropertyName =
    Object.keys(options).length > 0
      ? owner.addComponentProperty(propertyName, type, defaultValue, options)
      : owner.addComponentProperty(propertyName, type, defaultValue);
  return {
    success: true,
    nodeId: owner.id,
    propertyName: resolvedPropertyName,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions)
  };
}

async function editComponentPropertyAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const propertyName = p.propertyName === undefined || p.propertyName === null ? "" : String(p.propertyName);
  if (!propertyName) throw new Error("Missing propertyName");
  const owner = await resolveComponentAuthoringNode(p, {
    allowComponent: true,
    allowSet: true,
    preferSet: p.preferComponentSet !== false
  });
  assertNodeWritable(owner, p);
  const definitions = owner.componentPropertyDefinitions || {};
  const current = definitions[propertyName];
  if (!current) throw new Error("Component property not found: " + propertyName);
  const updates = p.updates && typeof p.updates === "object" ? Object.assign({}, p.updates) : {};
  if (updates.defaultValue !== undefined) {
    updates.defaultValue = normalizeComponentPropertyDefaultValue(String(current.type), updates.defaultValue);
  }
  if (updates.preferredValues !== undefined) {
    updates.preferredValues = normalizeInstanceSwapPreferredValues(updates.preferredValues);
  }
  const nextPropertyName = owner.editComponentProperty(propertyName, updates);
  return {
    success: true,
    nodeId: owner.id,
    propertyName: nextPropertyName,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions)
  };
}

async function deleteComponentPropertyAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const propertyName = p.propertyName === undefined || p.propertyName === null ? "" : String(p.propertyName);
  if (!propertyName) throw new Error("Missing propertyName");
  const owner = await resolveComponentAuthoringNode(p, {
    allowComponent: true,
    allowSet: true,
    preferSet: p.preferComponentSet !== false
  });
  assertNodeWritable(owner, p);
  owner.deleteComponentProperty(propertyName);
  return {
    success: true,
    nodeId: owner.id,
    propertyName,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions)
  };
}

async function bindComponentPropertyAction(params) {
  const p = params && typeof params === "object" ? params : {};
  if (!p.nodeId) throw new Error("Missing nodeId");
  const field = p.field === undefined || p.field === null ? "" : String(p.field);
  if (!field) throw new Error("Missing field");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(p.nodeId));
  assertNodeWritable(node, p);
  if (!("componentPropertyReferences" in node)) {
    throw new Error("Node does not support componentPropertyReferences");
  }
  const nextRefs = serializeComponentPropertyReferences(node);
  const shouldUnbind = p.unbind === true || p.propertyName === null;
  if (shouldUnbind) {
    delete nextRefs[field];
    node.componentPropertyReferences = nextRefs;
    return { success: true, nodeId: node.id, field, propertyName: null, componentPropertyReferences: nextRefs };
  }
  const propertyName = p.propertyName === undefined || p.propertyName === null ? "" : String(p.propertyName);
  if (!propertyName) throw new Error("Missing propertyName");
  const owner = await resolvePropertyOwnerForBinding(node, propertyName, p.propertyOwnerId);
  const def = owner.componentPropertyDefinitions[propertyName];
  if (!def) throw new Error("Component property not found: " + propertyName);
  const type = String(def.type);
  if (type === "BOOLEAN" && field !== "visible") throw new Error("BOOLEAN properties can only bind to visible");
  if (type === "TEXT") {
    if (field !== "characters") throw new Error("TEXT properties can only bind to characters");
    if (node.type !== "TEXT") throw new Error("characters binding requires a TEXT node");
  }
  if (type === "INSTANCE_SWAP") {
    if (field !== "mainComponent") throw new Error("INSTANCE_SWAP properties can only bind to mainComponent");
    if (node.type !== "INSTANCE") throw new Error("mainComponent binding requires an INSTANCE node");
  }
  if (type === "VARIANT" || type === "SLOT") {
    throw new Error(type + " properties cannot be bound via componentPropertyReferences");
  }
  nextRefs[field] = propertyName;
  node.componentPropertyReferences = nextRefs;
  return {
    success: true,
    nodeId: node.id,
    field,
    propertyName,
    propertyType: type,
    propertyOwnerId: owner.id,
    componentPropertyReferences: nextRefs
  };
}

async function createComponentSlotAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const component = await resolveComponentNodeForSlot(p);
  assertNodeWritable(component, p);
  const before = new Set(Object.keys(component.componentPropertyDefinitions || {}));
  const slot = component.createSlot();
  if (p.name !== undefined && p.name !== null) slot.name = String(p.name);
  if (p.width !== undefined && p.height !== undefined && "resize" in slot) {
    slot.resize(Number(p.width), Number(p.height));
  }
  if (p.x !== undefined) slot.x = Number(p.x);
  if (p.y !== undefined) slot.y = Number(p.y);
  const defs = component.componentPropertyDefinitions || {};
  let propertyName = null;
  for (const key of Object.keys(defs)) {
    if (before.has(key)) continue;
    if (defs[key] && defs[key].type === "SLOT") {
      propertyName = key;
      break;
    }
  }
  return {
    success: true,
    componentId: component.id,
    slotNodeId: slot.id,
    propertyName,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(component.componentPropertyDefinitions)
  };
}

function walkForSlotNodes(root) {
  const slots = [];
  function walk(n) {
    if (n.type === "SLOT") slots.push(n);
    if (n.children) { for (let i = 0; i < n.children.length; i += 1) walk(n.children[i]); }
  }
  walk(root);
  return slots;
}

async function findOwningComponentForSlot(slotNode) {
  let current = slotNode.parent;
  while (current) {
    if (current.type === "COMPONENT") return current;
    current = current.parent;
  }
  throw new Error("Slot is not inside a COMPONENT");
}

async function resolveSlotNode(params) {
  const p = params && typeof params === "object" ? params : {};
  if (!p.slotNodeId) throw new Error("Missing slotNodeId");
  const slot = await getNodeByIdAsync(normalizeFigmaNodeId(String(p.slotNodeId)));
  if (slot.type !== "SLOT") throw new Error("Node is not a SLOT");
  return slot;
}

async function editComponentSlotAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const slot = await resolveSlotNode(p);
  assertNodeWritable(slot, p);
  if (p.name !== undefined && p.name !== null) slot.name = String(p.name);
  if (p.width !== undefined && p.height !== undefined && "resize" in slot) {
    slot.resize(Number(p.width), Number(p.height));
  }
  if (p.x !== undefined) slot.x = Number(p.x);
  if (p.y !== undefined) slot.y = Number(p.y);
  const owner = await findOwningComponentForSlot(slot);
  return {
    success: true,
    slotNodeId: slot.id,
    name: slot.name,
    componentId: owner.id,
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions)
  };
}

async function deleteComponentSlotAction(params) {
  const p = params && typeof params === "object" ? params : {};
  const slot = await resolveSlotNode(p);
  assertNodeWritable(slot, p);
  const owner = await findOwningComponentForSlot(slot);
  const slotNodeId = slot.id;
  const before = serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions);
  slot.remove();
  let after = serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions);
  let removedPropertyName = null;
  for (const key of Object.keys(before)) {
    if (before[key] && before[key].type === "SLOT" && !(key in after)) {
      removedPropertyName = key;
      break;
    }
  }
  if (!removedPropertyName) {
    // Figma normally removes the SLOT property automatically when its node is removed.
    // As a fallback, clean up any orphaned SLOT property left pointing at no remaining slot node.
    const remainingSlotNames = new Set(walkForSlotNodes(owner).map((n) => n.name));
    for (const key of Object.keys(after)) {
      if (!after[key] || after[key].type !== "SLOT") continue;
      const baseName = key.split("#")[0];
      if (!remainingSlotNames.has(baseName)) {
        owner.deleteComponentProperty(key);
        removedPropertyName = key;
        after = serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions);
        break;
      }
    }
  }
  return {
    success: true,
    slotNodeId,
    componentId: owner.id,
    removedPropertyName,
    componentPropertyDefinitions: after
  };
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

async function getMainComponentForInstance(instance) {
  if (!instance || instance.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  if (typeof instance.getMainComponentAsync === "function") return await instance.getMainComponentAsync();
  return instance.mainComponent;
}

async function createInstanceFromInstance(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const src = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!src) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (src.type !== "INSTANCE") throw new Error("Source node is not an INSTANCE");
  assertNodeWritable(src, params);
  const main = await getMainComponentForInstance(src);
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

async function getInstanceSource(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId parameter");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  const main = await getMainComponentForInstance(node);
  if (!main) throw new Error("Instance has no mainComponent");
  const set = main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : null;
  return {
    instanceId: node.id, instanceName: node.name,
    mainComponentId: main.id, mainComponentName: main.name,
    mainComponentKey: main.key || null, mainComponentRemote: Boolean(main.remote),
    componentSetId: set ? set.id : null, componentSetName: set ? set.name : null,
    componentSetKey: set && set.key ? set.key : null, componentSetRemote: set ? Boolean(set.remote) : null,
    componentProperties: node.componentProperties !== undefined ? node.componentProperties : null,
    variantProperties: node.variantProperties !== undefined ? node.variantProperties : null
  };
}

async function scanInstancesWithSources(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  const chunkSize = Math.min(500, params && params.chunkSize ? Number(params.chunkSize) : 200);
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
        instanceId: inst.id, instanceName: inst.name,
        mainComponentId: main ? main.id : null, mainComponentName: main ? main.name : null,
        mainComponentKey: main && main.key ? main.key : null, mainComponentRemote: main ? Boolean(main.remote) : null,
        componentSetId: set ? set.id : null, componentSetName: set ? set.name : null,
        componentSetKey: set && set.key ? set.key : null, componentSetRemote: set ? Boolean(set.remote) : null
      });
    } catch (err) {
      items.push({ instanceId: inst.id, instanceName: inst.name, error: err && err.message ? String(err.message) : String(err) });
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
    success: true, componentSetId: set.id, componentSetKey: set.key || key,
    name: set.name, remote: Boolean(set.remote),
    defaultComponentId: def ? def.id : null, defaultComponentKey: def && def.key ? def.key : null
  };
}

async function createInstanceFromComponentKey(params) {
  if (!params || !params.componentKey) throw new Error("Missing componentKey parameter");
  const component = await figma.importComponentByKeyAsync(String(params.componentKey));
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
  const set = await figma.importComponentSetByKeyAsync(String(params.componentSetKey));
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
  const componentProps = node.componentProperties || {};
  const nextProps = {};
  for (const key in props) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
    const normalizedKey = String(key).replace(/\\:/g, ":");
    let value = props[key];
    const meta = componentProps[normalizedKey];
    const t = meta && meta.type ? String(meta.type) : null;
    if (t === "BOOLEAN") {
      if (typeof value === "number") value = value !== 0;
      if (typeof value === "string") { const lowered = value.toLowerCase(); if (lowered === "true") value = true; if (lowered === "false") value = false; }
    }
    if ((t === "VARIANT" || t === "TEXT" || t === "INSTANCE_SWAP") && typeof value === "number") value = String(value);
    nextProps[normalizedKey] = value;
  }
  node.setProperties(nextProps);
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

async function getInstanceSlots(params) {
  if (!params || !params.instanceId) throw new Error("Missing instanceId");
  const node = await figma.getNodeByIdAsync(String(params.instanceId));
  if (!node) throw new Error("Node not found with ID: " + String(params.instanceId));
  if (node.type !== "INSTANCE") throw new Error("Node is not an INSTANCE");
  const slots = [];
  function walk(n, path) {
    const nextPath = path.concat([n.name || n.type]);
    if (n.type === "SLOT") slots.push({ slotNodeId: n.id, name: n.name, path: nextPath.join(" / ") });
    if (n.children) { for (let i = 0; i < n.children.length; i += 1) walk(n.children[i], nextPath); }
  }
  walk(node, []);
  return { instanceId: node.id, instanceName: node.name, slots };
}

async function appendToSlot(params) {
  if (!params || !params.slotNodeId) throw new Error("Missing slotNodeId");
  const slot = await figma.getNodeByIdAsync(String(params.slotNodeId));
  if (!slot) throw new Error("Node not found with ID: " + String(params.slotNodeId));
  if (slot.type !== "SLOT") throw new Error("Node is not a SLOT");
  assertNodeWritable(slot, params);
  if (!("appendChild" in slot)) throw new Error("Slot does not support children");
  const nodeIds = ensureArray(params.nodeIds).map((x) => String(x));
  const moved = [];
  for (let i = 0; i < nodeIds.length; i += 1) {
    const n = await figma.getNodeByIdAsync(nodeIds[i]);
    if (!n) throw new Error("Node not found with ID: " + nodeIds[i]);
    assertNodeWritable(n, params);
    slot.appendChild(n);
    moved.push(n.id);
  }
  return { success: true, slotNodeId: slot.id, movedNodeIds: moved };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function exportNodeAsImage(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId parameter");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const format = String(params.format || "PNG").toUpperCase();
  const scale = params.scale === undefined || params.scale === null ? 1 : Number(params.scale);
  const bytes = await node.exportAsync({ format, constraint: { type: "SCALE", value: scale } });
  return { nodeId: node.id, format, scale, base64: uint8ToBase64(bytes), bytesLength: bytes.length };
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

async function getAnnotations(params) {
  const includeCategories = params && params.includeCategories !== undefined ? Boolean(params.includeCategories) : true;
  const nodeId = params && params.nodeId ? String(params.nodeId) : null;
  const categories = includeCategories ? await figma.annotations.getAnnotationCategoriesAsync() : [];
  function categoryById(id) {
    if (!includeCategories) return null;
    for (let i = 0; i < categories.length; i += 1) { if (categories[i].id === id) return categories[i]; }
    return null;
  }
  async function readNodeAnnotations(node) {
    const anns = node.annotations ? node.annotations : [];
    if (!anns || !anns.length) return null;
    const out = anns.map((a) => {
      const item = Object.assign({}, a);
      if (includeCategories && a.categoryId) { const cat = categoryById(a.categoryId); if (cat) item.category = { id: cat.id, label: cat.label, color: cat.color }; }
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
  for (let i = 0; i < nodes.length; i += 1) { const item = await readNodeAnnotations(nodes[i]); if (item) results.push(item); }
  return results;
}

async function setAnnotation(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  const labelMarkdown = params.labelMarkdown === undefined || params.labelMarkdown === null ? "" : String(params.labelMarkdown);
  const categoryId = params.categoryId ? String(params.categoryId) : undefined;
  const properties = ensureArray(params.properties);
  node.annotations = [{ labelMarkdown, categoryId, properties }];
  return { success: true, nodeId: node.id, annotationsCount: node.annotations.length };
}

async function setMultipleAnnotations(params) {
  const items = ensureArray(params && params.annotations);
  if (!items.length) throw new Error("Missing annotations");
  let updated = 0;
  for (let i = 0; i < items.length; i += 1) { const a = items[i]; if (!a || !a.nodeId) continue; await setAnnotation(a); updated += 1; }
  return { success: true, requested: items.length, updated };
}

// ---------------------------------------------------------------------------
// Reactions / Motion
// ---------------------------------------------------------------------------

const TRANSITION_TYPES = new Set(["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE", "MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]);
const DIRECTIONAL_TRANSITION_TYPES = new Set(["MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]);
const TRANSITION_DIRECTIONS = new Set(["LEFT", "RIGHT", "TOP", "BOTTOM"]);
const EASING_TYPES = new Set(["EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT", "LINEAR", "EASE_IN_BACK", "EASE_OUT_BACK", "EASE_IN_AND_OUT_BACK", "CUSTOM_CUBIC_BEZIER", "GENTLE", "QUICK", "BOUNCY", "SLOW", "CUSTOM_SPRING"]);
const MOTION_PRESETS = {
  subtle: {
    type: "SMART_ANIMATE",
    duration: 0.24,
    easing: { type: "GENTLE" }
  },
  smooth: {
    type: "SMART_ANIMATE",
    duration: 0.3,
    easing: { type: "EASE_IN_AND_OUT" }
  },
  quick: {
    type: "SMART_ANIMATE",
    duration: 0.18,
    easing: { type: "QUICK" }
  },
  bouncy: {
    type: "SMART_ANIMATE",
    duration: 0.4,
    easing: { type: "BOUNCY" }
  },
  dissolve: {
    type: "DISSOLVE",
    duration: 0.2,
    easing: { type: "EASE_OUT" }
  },
  slide_left: {
    type: "SLIDE_IN",
    direction: "LEFT",
    matchLayers: false,
    duration: 0.25,
    easing: { type: "EASE_OUT" }
  },
  slide_right: {
    type: "SLIDE_IN",
    direction: "RIGHT",
    matchLayers: false,
    duration: 0.25,
    easing: { type: "EASE_OUT" }
  }
};

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeEasing(easing, fallbackType) {
  if (typeof easing === "string") easing = { type: easing };
  const input = easing && typeof easing === "object" ? Object.assign({}, easing) : {};
  const type = input.type === undefined || input.type === null ? String(fallbackType || "EASE_OUT") : String(input.type);
  if (!EASING_TYPES.has(type)) throw new Error("Unsupported easing type: " + type);
  const out = { type };
  if (type === "CUSTOM_CUBIC_BEZIER") {
    const curve = input.easingFunctionCubicBezier && typeof input.easingFunctionCubicBezier === "object" ? input.easingFunctionCubicBezier : {};
    out.easingFunctionCubicBezier = {
      x1: Number(curve.x1),
      y1: Number(curve.y1),
      x2: Number(curve.x2),
      y2: Number(curve.y2)
    };
  }
  if (type === "CUSTOM_SPRING") {
    const spring = input.easingFunctionSpring && typeof input.easingFunctionSpring === "object" ? input.easingFunctionSpring : {};
    out.easingFunctionSpring = {
      mass: Number(spring.mass),
      stiffness: Number(spring.stiffness),
      damping: Number(spring.damping),
      initialVelocity: spring.initialVelocity === undefined || spring.initialVelocity === null ? 0 : Number(spring.initialVelocity)
    };
  }
  return out;
}

function normalizeTransition(transition) {
  if (!transition || typeof transition !== "object") throw new Error("Transition must be an object");
  const type = transition.type === undefined || transition.type === null ? "" : String(transition.type);
  if (!TRANSITION_TYPES.has(type)) throw new Error("Unsupported transition type: " + type);
  const duration = transition.duration === undefined || transition.duration === null ? 0.3 : Number(transition.duration);
  if (!Number.isFinite(duration) || duration < 0) throw new Error("Transition duration must be a non-negative number");
  const out = {
    type,
    duration,
    easing: normalizeEasing(transition.easing, "EASE_OUT")
  };
  if (DIRECTIONAL_TRANSITION_TYPES.has(type)) {
    const direction = transition.direction === undefined || transition.direction === null ? "LEFT" : String(transition.direction);
    if (!TRANSITION_DIRECTIONS.has(direction)) throw new Error("Unsupported transition direction: " + direction);
    out.direction = direction;
    out.matchLayers = transition.matchLayers === undefined || transition.matchLayers === null ? false : Boolean(transition.matchLayers);
  }
  return out;
}

function buildTransitionFromParams(params, fallbackPresetName) {
  const presetName = params && params.preset !== undefined && params.preset !== null ? String(params.preset).toLowerCase() : (fallbackPresetName || "");
  const preset = presetName && MOTION_PRESETS[presetName] ? cloneJsonValue(MOTION_PRESETS[presetName]) : null;
  const transition = params && params.transition && typeof params.transition === "object" ? Object.assign({}, params.transition) : {};
  const merged = Object.assign({}, preset || {}, transition);
  if (transition.easing !== undefined) merged.easing = transition.easing;
  if (!merged.type) merged.type = "SMART_ANIMATE";
  if (merged.duration === undefined || merged.duration === null) merged.duration = 0.3;
  if (merged.easing === undefined || merged.easing === null) merged.easing = { type: "EASE_OUT" };
  return normalizeTransition(merged);
}

function buildNodeActionFromParams(params) {
  const destinationId = params && params.destinationId ? String(params.destinationId) : "";
  if (!destinationId) throw new Error("Missing destinationId");
  const action = {
    type: "NODE",
    destinationId,
    navigation: params && params.navigation ? String(params.navigation) : "NAVIGATE",
    transition: buildTransitionFromParams(params)
  };
  if (params && params.preserveScrollPosition !== undefined) action.preserveScrollPosition = Boolean(params.preserveScrollPosition);
  if (params && params.resetVideoPosition !== undefined) action.resetVideoPosition = Boolean(params.resetVideoPosition);
  if (params && params.resetScrollPosition !== undefined) action.resetScrollPosition = Boolean(params.resetScrollPosition);
  if (params && params.resetInteractiveComponents !== undefined) action.resetInteractiveComponents = Boolean(params.resetInteractiveComponents);
  if (params && params.overlayRelativePosition && typeof params.overlayRelativePosition === "object") {
    action.overlayRelativePosition = {
      x: Number(params.overlayRelativePosition.x),
      y: Number(params.overlayRelativePosition.y)
    };
  }
  return action;
}

function buildMotionReaction(params, fallbackPresetName) {
  const triggerType = params && params.triggerType ? String(params.triggerType) : "ON_CLICK";
  const reactionParams = Object.assign({}, params);
  if (fallbackPresetName && !reactionParams.preset) reactionParams.preset = fallbackPresetName;
  return {
    trigger: { type: triggerType },
    actions: [buildNodeActionFromParams(reactionParams)]
  };
}

function firstReactionAction(r) {
  if (!r) return null;
  if (Array.isArray(r.actions) && r.actions.length) return r.actions[0];
  if (r.action) return r.action;
  return null;
}

function normalizeReactionTrigger(t) {
  if (!t || typeof t !== "object") throw new Error("Reaction trigger must be an object");
  const type = t.type === undefined || t.type === null ? "" : String(t.type);
  if (!type) throw new Error("Reaction trigger missing type");
  return Object.assign({}, t, { type });
}

function normalizeReactionAction(a) {
  if (!a || typeof a !== "object") throw new Error("Reaction action must be an object");
  const type = a.type === undefined || a.type === null ? "" : String(a.type);
  if (!type) throw new Error("Reaction action missing type");
  const out = Object.assign({}, a, { type });
  if (type === "URL") { const url = out.url === undefined || out.url === null ? "" : String(out.url); if (!url) throw new Error("URL action missing url"); out.url = url; }
  if (type === "NODE") {
    const destinationId = out.destinationId === undefined || out.destinationId === null ? "" : String(out.destinationId);
    if (!destinationId) throw new Error("NODE action missing destinationId");
    out.destinationId = destinationId;
    if (out.navigation !== undefined && out.navigation !== null) out.navigation = String(out.navigation);
    if (out.transition !== undefined && out.transition !== null) out.transition = normalizeTransition(out.transition);
    if (out.overlayRelativePosition !== undefined && out.overlayRelativePosition !== null) {
      const pos = out.overlayRelativePosition;
      if (!pos || typeof pos !== "object") throw new Error("NODE action overlayRelativePosition must be an object");
      out.overlayRelativePosition = { x: Number(pos.x), y: Number(pos.y) };
    }
    if (out.preserveScrollPosition !== undefined) out.preserveScrollPosition = Boolean(out.preserveScrollPosition);
    if (out.resetVideoPosition !== undefined) out.resetVideoPosition = Boolean(out.resetVideoPosition);
    if (out.resetScrollPosition !== undefined) out.resetScrollPosition = Boolean(out.resetScrollPosition);
    if (out.resetInteractiveComponents !== undefined) out.resetInteractiveComponents = Boolean(out.resetInteractiveComponents);
  }
  if (type === "SET_VARIABLE") {
    const variableId = out.variableId === undefined || out.variableId === null ? "" : String(out.variableId);
    if (!variableId) throw new Error("SET_VARIABLE action missing variableId");
    out.variableId = variableId;
    if (!Object.prototype.hasOwnProperty.call(out, "variableValue")) throw new Error("SET_VARIABLE action missing variableValue");
  }
  if (type === "SET_VARIABLE_MODE") {
    const variableCollectionId = out.variableCollectionId === undefined || out.variableCollectionId === null ? "" : String(out.variableCollectionId);
    const modeId = out.modeId === undefined || out.modeId === null ? "" : String(out.modeId);
    if (!variableCollectionId) throw new Error("SET_VARIABLE_MODE action missing variableCollectionId");
    if (!modeId) throw new Error("SET_VARIABLE_MODE action missing modeId");
    out.variableCollectionId = variableCollectionId;
    out.modeId = modeId;
  }
  return out;
}

function normalizeReaction(r) {
  if (!r || typeof r !== "object") throw new Error("Reaction must be an object");
  const trigger = normalizeReactionTrigger(r.trigger);
  let actions;
  if (Array.isArray(r.actions)) {
    actions = r.actions.map((a) => normalizeReactionAction(a));
  } else if (r.action !== undefined && r.action !== null) {
    actions = [normalizeReactionAction(r.action)];
  } else {
    throw new Error("Reaction must include action or actions");
  }
  if (!actions.length) throw new Error("Reaction actions must be non-empty");
  const out = { trigger, actions };
  if (actions.length === 1) out.action = actions[0];
  return out;
}

async function setReactions(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("reactions" in node)) throw new Error("Node does not support reactions");
  const reactions = ensureArray(params.reactions).map((r) => normalizeReaction(r));
  node.reactions = reactions;
  return { success: true, nodeId: node.id, reactionsCount: node.reactions.length };
}

async function clearReactions(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("reactions" in node)) throw new Error("Node does not support reactions");
  node.reactions = [];
  return { success: true, nodeId: node.id, reactionsCount: 0 };
}

async function upsertReaction(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("reactions" in node)) throw new Error("Node does not support reactions");
  const match = params.match && typeof params.match === "object" ? params.match : {};
  const triggerType = match.triggerType === undefined || match.triggerType === null ? "" : String(match.triggerType);
  const actionType = match.actionType === undefined || match.actionType === null ? "" : String(match.actionType);
  const destinationId = match.destinationId === undefined || match.destinationId === null ? "" : String(match.destinationId);
  const next = normalizeReaction(params.reaction);
  const current = ensureArray(node.reactions);
  let replaced = false;
  for (let i = 0; i < current.length; i += 1) {
    const r = current[i];
    const a = firstReactionAction(r);
    if (!r || !r.trigger || !a) continue;
    if (triggerType && String(r.trigger.type) !== triggerType) continue;
    if (actionType && String(a.type) !== actionType) continue;
    if (destinationId && String(a.destinationId || "") !== destinationId) continue;
    current[i] = next; replaced = true; break;
  }
  if (!replaced) current.push(next);
  node.reactions = current;
  return { success: true, nodeId: node.id, replaced, reactionsCount: node.reactions.length };
}

async function getReactions(params) {
  const nodeIds = ensureArray(params && params.nodeIds);
  if (!nodeIds.length) throw new Error("Missing nodeIds");
  const results = [];
  function hasReactions(node) { return node.reactions && node.reactions.length > 0; }
  function findNodesWithReactions(node, depth, out) {
    if (hasReactions(node)) out.push({ id: node.id, name: node.name, type: node.type, depth, reactions: node.reactions });
    if (node.children) { for (let i = 0; i < node.children.length; i += 1) findNodesWithReactions(node.children[i], depth + 1, out); }
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

async function setTransitionReaction(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const replaceExisting = params.replaceExisting === undefined || params.replaceExisting === null ? true : Boolean(params.replaceExisting);
  const reaction = buildMotionReaction(params);
  if (replaceExisting) {
    return await upsertReaction({
      nodeId: params.nodeId,
      match: params.match && typeof params.match === "object" ? params.match : {
        triggerType: params.triggerType ? String(params.triggerType) : "ON_CLICK",
        actionType: "NODE",
        destinationId: String(params.destinationId)
      },
      reaction
    });
  }
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("reactions" in node)) throw new Error("Node does not support reactions");
  const current = ensureArray(node.reactions);
  current.push(reaction);
  node.reactions = current;
  return { success: true, nodeId: node.id, replaced: false, reactionsCount: node.reactions.length };
}

async function setSmartAnimateReaction(params) {
  const reactionParams = Object.assign({}, params, {
    transition: Object.assign({}, params && params.transition && typeof params.transition === "object" ? params.transition : {}, {
      type: "SMART_ANIMATE"
    })
  });
  if (!reactionParams.preset) reactionParams.preset = "smooth";
  return await setTransitionReaction(reactionParams);
}

// ---------------------------------------------------------------------------
// Prototype overlay & flow settings
// ---------------------------------------------------------------------------

const OVERLAY_POSITION_TYPES = new Set(["CENTER", "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT", "MANUAL"]);
const OVERLAY_BACKGROUND_INTERACTIONS = new Set(["NONE", "CLOSE_ON_CLICK_OUTSIDE"]);

async function getOverlaySettings(params) {
  const p = params && typeof params === "object" ? params : {};
  if (!p.nodeId) throw new Error("Missing nodeId");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(String(p.nodeId)));
  if (!("overlayPositionType" in node)) throw new Error("Node does not support overlay settings");
  return {
    nodeId: node.id,
    overlayPositionType: node.overlayPositionType,
    overlayBackground: node.overlayBackground,
    overlayBackgroundInteraction: node.overlayBackgroundInteraction
  };
}

async function setOverlaySettings(params) {
  const p = params && typeof params === "object" ? params : {};
  if (!p.nodeId) throw new Error("Missing nodeId");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(String(p.nodeId)));
  assertNodeWritable(node, p);
  if (!("overlayPositionType" in node)) throw new Error("Node does not support overlay settings");
  if (p.overlayPositionType !== undefined && p.overlayPositionType !== null) {
    const value = String(p.overlayPositionType);
    if (!OVERLAY_POSITION_TYPES.has(value)) throw new Error("Unsupported overlayPositionType: " + value);
    node.overlayPositionType = value;
  }
  if (p.overlayBackgroundInteraction !== undefined && p.overlayBackgroundInteraction !== null) {
    const value = String(p.overlayBackgroundInteraction);
    if (!OVERLAY_BACKGROUND_INTERACTIONS.has(value)) throw new Error("Unsupported overlayBackgroundInteraction: " + value);
    node.overlayBackgroundInteraction = value;
  }
  if (p.overlayBackground !== undefined && p.overlayBackground !== null) {
    const bg = p.overlayBackground;
    if (!bg || typeof bg !== "object" || !bg.type) throw new Error("overlayBackground must be an object with a type");
    if (bg.type === "NONE") {
      node.overlayBackground = { type: "NONE" };
    } else if (bg.type === "SOLID_COLOR") {
      const color = bg.color && typeof bg.color === "object" ? bg.color : {};
      node.overlayBackground = {
        type: "SOLID_COLOR",
        color: {
          r: Number(color.r),
          g: Number(color.g),
          b: Number(color.b),
          a: color.a === undefined || color.a === null ? 1 : Number(color.a)
        }
      };
    } else {
      throw new Error("Unsupported overlayBackground type: " + String(bg.type));
    }
  }
  return {
    success: true,
    nodeId: node.id,
    overlayPositionType: node.overlayPositionType,
    overlayBackground: node.overlayBackground,
    overlayBackgroundInteraction: node.overlayBackgroundInteraction
  };
}

async function getPrototypeSettings() {
  const page = figma.currentPage;
  return {
    pageId: page.id,
    prototypeStartNodeId: page.prototypeStartNode ? page.prototypeStartNode.id : null,
    flowStartingPoints: ensureArray(page.flowStartingPoints).map((f) => ({ nodeId: f.nodeId, name: f.name }))
  };
}

async function setPrototypeStartNode(params) {
  const p = params && typeof params === "object" ? params : {};
  const page = figma.currentPage;
  if (p.nodeId === null) {
    page.prototypeStartNode = null;
    return { success: true, pageId: page.id, prototypeStartNodeId: null };
  }
  if (!p.nodeId) throw new Error("Missing nodeId");
  const node = await getNodeByIdAsync(normalizeFigmaNodeId(String(p.nodeId)));
  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error("prototypeStartNode must be a FRAME, COMPONENT, or COMPONENT_SET");
  }
  page.prototypeStartNode = node;
  return { success: true, pageId: page.id, prototypeStartNodeId: node.id };
}

async function setFlowStartingPoints(params) {
  const p = params && typeof params === "object" ? params : {};
  const entries = ensureArray(p.flowStartingPoints);
  const page = figma.currentPage;
  const next = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !entry.nodeId) throw new Error("Each flow starting point needs a nodeId");
    const node = await getNodeByIdAsync(normalizeFigmaNodeId(String(entry.nodeId)));
    if (node.type !== "FRAME") throw new Error("Flow starting points must reference top-level FRAME nodes");
    next.push({ nodeId: node.id, name: entry.name !== undefined && entry.name !== null ? String(entry.name) : node.name });
  }
  page.flowStartingPoints = next;
  return {
    success: true,
    pageId: page.id,
    flowStartingPoints: ensureArray(page.flowStartingPoints).map((f) => ({ nodeId: f.nodeId, name: f.name }))
  };
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

async function listVariableCollections() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  return { collections: cols.map((c) => ({ id: c.id, name: c.name, modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })), variableIdsCount: c.variableIds ? c.variableIds.length : 0 })) };
}

async function listVariables(params) {
  const resolvedType = params && params.resolvedType ? String(params.resolvedType) : undefined;
  let vars;
  try {
    vars = resolvedType ? await figma.variables.getLocalVariablesAsync(resolvedType) : await figma.variables.getLocalVariablesAsync();
  } catch (err) {
    if (resolvedType) throw err;
    const all = [];
    for (const type of ["COLOR", "FLOAT", "STRING", "BOOLEAN"]) {
      try { const part = await figma.variables.getLocalVariablesAsync(type); for (const v of part) all.push(v); } catch (_err) {}
    }
    vars = all;
  }
  return { variables: vars.map((v) => ({ id: v.id, name: v.name, key: v.key, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, remote: Boolean(v.remote), scopes: v.scopes })) };
}

async function createVariableCollection(params) {
  const name = params && params.name ? String(params.name) : "";
  if (!name) throw new Error("Missing name");
  const modes = ensureArray(params && params.modes).map((x) => String(x)).filter(Boolean);
  const collection = figma.variables.createVariableCollection(name);
  if (modes.length) {
    collection.renameMode(collection.modes[0].modeId, modes[0]);
    for (let i = 1; i < modes.length; i += 1) collection.addMode(modes[i]);
  }
  return { id: collection.id, name: collection.name, modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })) };
}

async function createVariable(params) {
  const collectionId = params && params.collectionId ? String(params.collectionId) : "";
  const name = params && params.name ? String(params.name) : "";
  const resolvedType = params && params.resolvedType ? String(params.resolvedType) : "";
  if (!collectionId) throw new Error("Missing collectionId");
  if (!name) throw new Error("Missing name");
  if (!resolvedType) throw new Error("Missing resolvedType");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error("Variable collection not found: " + collectionId);
  const v = figma.variables.createVariable(name, collection, resolvedType);
  if (params.description !== undefined && params.description !== null) v.description = String(params.description);
  if (params.scopes !== undefined && params.scopes !== null) v.scopes = ensureArray(params.scopes).map((x) => String(x));
  const valuesByMode = normalizeValuesByMode(params);
  applyValuesByModeToVariable(v, collection, valuesByMode);
  return { id: v.id, name: v.name, key: v.key, resolvedType: v.resolvedType, variableCollectionId: v.variableCollectionId, scopes: v.scopes };
}

async function setVariableValues(params) {
  const variableId = params && params.variableId ? String(params.variableId) : "";
  if (!variableId) throw new Error("Missing variableId");
  const v = await figma.variables.getVariableByIdAsync(variableId);
  if (!v) throw new Error("Variable not found: " + variableId);
  const collection = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
  if (!collection) throw new Error("Variable collection not found: " + v.variableCollectionId);
  const valuesByMode = normalizeValuesByMode(params);
  applyValuesByModeToVariable(v, collection, valuesByMode);
  return { success: true, id: v.id, name: v.name };
}

async function renameVariable(params) {
  const variableId = params && params.variableId ? String(params.variableId) : "";
  const name = params && params.name !== undefined && params.name !== null ? String(params.name) : "";
  if (!variableId) throw new Error("Missing variableId");
  if (!name) throw new Error("Missing name");
  const v = await figma.variables.getVariableByIdAsync(variableId);
  if (!v) throw new Error("Variable not found: " + variableId);
  v.name = name;
  return { success: true, id: v.id, name: v.name };
}

async function deleteVariable(params) {
  const variableId = params && params.variableId ? String(params.variableId) : "";
  const confirmDelete = Boolean(params && params.confirmDelete);
  if (!variableId) throw new Error("Missing variableId");
  if (!confirmDelete) throw new Error("confirmDelete must be true");
  const v = await figma.variables.getVariableByIdAsync(variableId);
  if (!v) throw new Error("Variable not found: " + variableId);
  if (typeof v.remove !== "function") throw new Error("Variable.remove() is not available in this Figma environment");
  v.remove();
  return { success: true, variableId };
}

async function importVariableByKey(params) {
  const key = params && params.key ? String(params.key) : "";
  if (!key) throw new Error("Missing key");
  const v = await figma.variables.importVariableByKeyAsync(key);
  return { id: v.id, name: v.name, key: v.key, resolvedType: v.resolvedType, remote: Boolean(v.remote) };
}

async function bindColorVariableToFill(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.variableId) throw new Error("Missing variableId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("fills" in node)) throw new Error("Node does not support fills");
  const v = await figma.variables.getVariableByIdAsync(String(params.variableId));
  if (!v) throw new Error("Variable not found: " + String(params.variableId));
  const paintIndex = params.paintIndex === undefined || params.paintIndex === null ? 0 : Number(params.paintIndex);
  const fills = Array.isArray(node.fills) ? node.fills.slice() : [];
  while (fills.length <= paintIndex) fills.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
  fills[paintIndex] = figma.variables.setBoundVariableForPaint(Object.assign({}, fills[paintIndex]), "color", v);
  node.fills = fills;
  return { success: true, nodeId: node.id, variableId: v.id, paintIndex };
}

async function bindColorVariableToStroke(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.variableId) throw new Error("Missing variableId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("strokes" in node)) throw new Error("Node does not support strokes");
  const v = await figma.variables.getVariableByIdAsync(String(params.variableId));
  if (!v) throw new Error("Variable not found: " + String(params.variableId));
  const paintIndex = params.paintIndex === undefined || params.paintIndex === null ? 0 : Number(params.paintIndex);
  const strokes = Array.isArray(node.strokes) ? node.strokes.slice() : [];
  while (strokes.length <= paintIndex) strokes.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
  strokes[paintIndex] = figma.variables.setBoundVariableForPaint(Object.assign({}, strokes[paintIndex]), "color", v);
  node.strokes = strokes;
  return { success: true, nodeId: node.id, variableId: v.id, paintIndex };
}

async function bindVariableToProperty(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.variableId) throw new Error("Missing variableId");
  const property = params.property === undefined || params.property === null ? "" : String(params.property);
  if (!property) throw new Error("Missing property");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  const v = await figma.variables.getVariableByIdAsync(String(params.variableId));
  if (!v) throw new Error("Variable not found: " + String(params.variableId));
  if (!("setBoundVariable" in node)) throw new Error("Node does not support bound variables");
  node.setBoundVariable(property, v);
  return { success: true, nodeId: node.id, variableId: v.id, property };
}

async function setNodeExplicitVariableMode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  if (!params.collectionId) throw new Error("Missing collectionId");
  if (!params.modeId) throw new Error("Missing modeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("setExplicitVariableModeForCollection" in node)) throw new Error("Node does not support explicit variable modes");
  const collection = await figma.variables.getVariableCollectionByIdAsync(String(params.collectionId));
  if (!collection) throw new Error("Variable collection not found: " + String(params.collectionId));
  node.setExplicitVariableModeForCollection(collection, String(params.modeId));
  return { success: true, nodeId: node.id, collectionId: collection.id, modeId: String(params.modeId) };
}

// ---------------------------------------------------------------------------
// Batch execution
// ---------------------------------------------------------------------------
// Runs multiple actions in one WebSocket round trip instead of one per action.
// This is sequential execution with per-step error capture, NOT a transaction:
// steps that already succeeded are not rolled back if a later step fails.

async function runBatch(params) {
  const p = params && typeof params === "object" ? params : {};
  const items = ensureArray(p.actions);
  if (!items.length) throw new Error("Missing actions");
  const stopOnError = p.stopOnError === undefined || p.stopOnError === null ? true : Boolean(p.stopOnError);
  const results = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] && typeof items[i] === "object" ? items[i] : {};
    const action = item.action === undefined || item.action === null ? "" : String(item.action);
    if (!action) {
      results.push({ index: i, action, success: false, error: "Missing action" });
      if (stopOnError) break;
      continue;
    }
    if (action === "run_batch") {
      results.push({ index: i, action, success: false, error: "run_batch cannot be nested" });
      if (stopOnError) break;
      continue;
    }
    try {
      const result = await handleAction(action, item.payload);
      results.push({ index: i, action, success: true, result });
    } catch (err) {
      results.push({ index: i, action, success: false, error: err instanceof Error ? err.message : String(err) });
      if (stopOnError) break;
    }
  }
  const completedCount = results.filter((r) => r.success).length;
  return { success: results.length === items.length && results.every((r) => r.success), completedCount, totalCount: items.length, results };
}

// ---------------------------------------------------------------------------
// Find and replace
// ---------------------------------------------------------------------------

async function findAndReplaceText(params) {
  const p = params && typeof params === "object" ? params : {};
  const query = p.query === undefined || p.query === null ? "" : String(p.query);
  if (!query) throw new Error("Missing query");
  const replacement = p.replacement === undefined || p.replacement === null ? "" : String(p.replacement);
  const useRegex = Boolean(p.useRegex);
  const matchCase = p.matchCase === undefined || p.matchCase === null ? false : Boolean(p.matchCase);
  const wholeWord = Boolean(p.wholeWord);
  const dryRun = Boolean(p.dryRun);
  const allPages = Boolean(p.allPages);
  const rootNodeId = p.rootNodeId ? String(p.rootNodeId) : null;

  let pattern;
  if (useRegex) {
    pattern = query;
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = wholeWord ? "\\b" + escaped + "\\b" : escaped;
  }
  const matcher = new RegExp(pattern, matchCase ? "g" : "gi");

  const pages = [];
  if (allPages) {
    await figma.loadAllPagesAsync();
    for (const pg of figma.root.children) pages.push(pg);
  } else {
    await figma.currentPage.loadAsync();
    pages.push(figma.currentPage);
  }

  const changes = [];
  for (const page of pages) {
    let root = page;
    if (rootNodeId && page.id === figma.currentPage.id) {
      const explicit = await figma.getNodeByIdAsync(rootNodeId);
      if (explicit) root = explicit;
    }
    const textNodes = "findAll" in root ? root.findAll((n) => n.type === "TEXT") : [];
    for (const node of textNodes) {
      const current = String(node.characters || "");
      matcher.lastIndex = 0;
      if (!matcher.test(current)) continue;
      matcher.lastIndex = 0;
      const next = current.replace(matcher, replacement);
      if (next === current) continue;
      changes.push({ nodeId: node.id, pageId: page.id, pageName: page.name, name: node.name, before: current, after: next });
      if (!dryRun) {
        if (node.fontName !== figma.mixed) {
          await figma.loadFontAsync(node.fontName);
        } else {
          const fonts = new Set();
          for (let i = 0; i < current.length; i += 1) {
            fonts.add(JSON.stringify(node.getRangeFontName(i, i + 1)));
          }
          for (const f of fonts) await figma.loadFontAsync(JSON.parse(f));
        }
        node.characters = next;
      }
    }
  }
  return { success: true, dryRun, matchCount: changes.length, changes };
}

// ---------------------------------------------------------------------------
// Selection context (bundled read)
// ---------------------------------------------------------------------------

async function getSelectionContext(params) {
  const p = params && typeof params === "object" ? params : {};
  const selection = figma.currentPage.selection;
  if (!selection.length) return { selectionCount: 0, nodes: [] };
  const readOptions = Object.assign({ maxDepth: 0 }, p);
  const nodes = [];
  for (const node of selection) {
    const entry = { id: node.id, name: node.name, type: node.type, visible: node.visible };
    try {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      entry.info = filterFigmaNode(response.document, readOptions);
    } catch (_err) {
      // Best-effort: some node types (e.g. VECTOR) are intentionally excluded by filterFigmaNode.
    }
    if ("componentPropertyReferences" in node) {
      entry.componentPropertyReferences = serializeComponentPropertyReferences(node);
    }
    if (node.type === "INSTANCE") {
      try {
        const main = await getMainComponentForInstance(node);
        entry.mainComponentId = main ? main.id : null;
        const owner = main && main.parent && main.parent.type === "COMPONENT_SET" ? main.parent : main;
        if (owner) entry.componentPropertyDefinitions = serializeComponentPropertyDefinitions(owner.componentPropertyDefinitions);
        entry.componentProperties = node.componentProperties || {};
        entry.slots = walkForSlotNodes(node).map((n) => ({ slotNodeId: n.id, name: n.name }));
      } catch (_err) {
        // Best-effort: instance may reference a missing/remote main component.
      }
    }
    nodes.push(entry);
  }
  return { selectionCount: selection.length, nodes };
}

// ---------------------------------------------------------------------------
// Document tree / full-context reads
// ---------------------------------------------------------------------------
// These serialize the live scene graph directly (no exportAsync round trip) so
// an AI agent can read the whole open file's structure in one call without
// paying the token cost of full REST-style node dumps. Compact by design:
// every node is {id, name, type}; TEXT nodes include their characters by
// default; extra fields are opt-in via `fields`.

function countCompactTreeNodes(node) {
  let count = 1;
  if (node && node.children) {
    for (let i = 0; i < node.children.length; i += 1) count += countCompactTreeNodes(node.children[i]);
  }
  return count;
}

function serializePaintLight(paint) {
  const item = { type: paint.type };
  if (paint.color) item.color = rgbaToHex(paint.color);
  if (paint.opacity !== undefined && paint.opacity !== 1) item.opacity = roundNum(paint.opacity, 3);
  if (
    paint.type === "GRADIENT_LINEAR" ||
    paint.type === "GRADIENT_RADIAL" ||
    paint.type === "GRADIENT_ANGULAR" ||
    paint.type === "GRADIENT_DIAMOND"
  ) {
    if (Array.isArray(paint.gradientStops) && paint.gradientStops.length) {
      item.gradientStops = paint.gradientStops.map((stop) => ({
        position: roundNum(stop.position, 3),
        color: rgbaToHex(stop.color)
      }));
    }
  }
  if (paint.imageRef) item.imageRef = paint.imageRef;
  if (paint.scaleMode) item.scaleMode = paint.scaleMode;
  return item;
}

const TREE_FIELD_READERS = {
  characters: (node) => (node.type === "TEXT" ? String(node.characters || "") : undefined),
  fills: (node) => {
    if (!("fills" in node) || !Array.isArray(node.fills) || !node.fills.length) return undefined;
    return node.fills.map(serializePaintLight);
  },
  strokes: (node) => {
    if (!("strokes" in node) || !Array.isArray(node.strokes) || !node.strokes.length) return undefined;
    return node.strokes.map(serializePaintLight);
  },
  strokeWeight: (node) => ("strokeWeight" in node && typeof node.strokeWeight === "number" ? roundNum(node.strokeWeight) : undefined),
  cornerRadius: (node) => ("cornerRadius" in node && typeof node.cornerRadius === "number" ? roundNum(node.cornerRadius) : undefined),
  absoluteBoundingBox: (node) => ("x" in node ? { x: roundNum(node.x), y: roundNum(node.y), width: roundNum(node.width), height: roundNum(node.height) } : undefined),
  fillStyleId: (node) => ("fillStyleId" in node && node.fillStyleId ? node.fillStyleId : undefined),
  strokeStyleId: (node) => ("strokeStyleId" in node && node.strokeStyleId ? node.strokeStyleId : undefined),
  textStyleId: (node) => ("textStyleId" in node && node.textStyleId ? node.textStyleId : undefined),
  layoutMode: (node) => ("layoutMode" in node && node.layoutMode !== "NONE" ? node.layoutMode : undefined),
  itemSpacing: (node) => ("itemSpacing" in node && typeof node.itemSpacing === "number" ? roundNum(node.itemSpacing) : undefined),
  padding: (node) => {
    if (!("paddingTop" in node)) return undefined;
    const p = {};
    if (node.paddingTop) p.top = roundNum(node.paddingTop);
    if (node.paddingRight) p.right = roundNum(node.paddingRight);
    if (node.paddingBottom) p.bottom = roundNum(node.paddingBottom);
    if (node.paddingLeft) p.left = roundNum(node.paddingLeft);
    return p;
  },
  visible: (node) => ("visible" in node && node.visible === false ? false : undefined),
  opacity: (node) => ("opacity" in node && typeof node.opacity === "number" && node.opacity !== 1 ? roundNum(node.opacity, 3) : undefined)
};

function buildCompactTree(node, options, depth) {
  if (!node) return null;
  const opts = options && typeof options === "object" ? options : {};
  const excludeTypes = Array.isArray(opts.excludeTypes) ? opts.excludeTypes : [];
  if (excludeTypes.indexOf(node.type) >= 0) return null;
  if (opts.includeHidden === false && "visible" in node && node.visible === false) return null;

  const item = { id: node.id, name: node.name, type: node.type };
  const fields = Array.isArray(opts.fields) ? opts.fields : [];
  const includeCharacters = fields.indexOf("characters") >= 0 || (fields.length === 0 && node.type === "TEXT");
  if (includeCharacters) item.characters = String(node.characters || "");

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === "characters") continue;
    const reader = TREE_FIELD_READERS[field];
    if (!reader) continue;
    const value = reader(node);
    if (value !== undefined) item[field] = value;
  }

  if (node.children) {
    const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : null;
    if (maxDepth !== null && depth >= maxDepth) {
      if (node.children.length) {
        item.childCount = node.children.length;
        item.childrenTruncated = true;
      }
    } else {
      const children = [];
      let dropped = 0;
      for (let i = 0; i < node.children.length; i += 1) {
        const child = buildCompactTree(node.children[i], opts, depth + 1);
        if (child) children.push(child);
        else dropped += 1;
      }
      if (children.length) item.children = children;
      if (dropped > 0) item.childCount = node.children.length;
    }
  }

  return item;
}

async function getAllPages() {
  await figma.loadAllPagesAsync();
  const pages = figma.root.children.map((page) => ({
    id: page.id,
    name: page.name,
    childCount: page.children.length,
    topLevel: page.children.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      childCount: n.children ? n.children.length : 0
    }))
  }));
  return { success: true, totalPages: pages.length, currentPageId: figma.currentPage.id, pages };
}

async function getDocumentTree(options) {
  const opts = options && typeof options === "object" ? options : {};
  const rootNodeId = opts.rootNodeId ? String(opts.rootNodeId) : null;
  let root = null;
  if (rootNodeId) {
    root = await figma.getNodeByIdAsync(normalizeFigmaNodeId(rootNodeId));
    if (!root) throw new Error("Node not found with ID: " + rootNodeId);
  } else {
    await figma.loadAllPagesAsync();
    root = figma.root;
  }
  const tree = buildCompactTree(root, opts, 0);
  return {
    success: true,
    rootNodeId: root.id,
    nodeCount: tree ? countCompactTreeNodes(tree) : 0,
    tree
  };
}

// ---------------------------------------------------------------------------
// Action dispatcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// New feature handlers: fills/images, effects, vectors, sections, text styles,
// pages, layout generators, bulk ops, theme modes, events, target sync
// ---------------------------------------------------------------------------

const GRADIENT_TYPES = {
  LINEAR: "GRADIENT_LINEAR",
  RADIAL: "GRADIENT_RADIAL",
  ANGULAR: "GRADIENT_ANGULAR",
  DIAMOND: "GRADIENT_DIAMOND"
};

const IMAGE_SCALE_MODES = new Set(["FILL", "FIT", "CROP", "TILE"]);

function base64ToBytes(b64) {
  const raw = String(b64).replace(/\s+/g, "");
  const comma = raw.indexOf(",");
  const payload = comma >= 0 && raw.slice(0, comma).indexOf(";base64") >= 0 ? raw.slice(comma + 1) : raw;
  const binary = atob(payload);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function normalizeColorParts(color) {
  const c = color && typeof color === "object" ? color : {};
  return {
    r: normalize01From01Or255(c.r),
    g: normalize01From01Or255(c.g),
    b: normalize01From01Or255(c.b),
    a: c.a === undefined || c.a === null ? 1 : normalize01From01Or255(c.a)
  };
}

async function resolveVariableRef(ref) {
  if (typeof figma.variables === "undefined" || !figma.variables) return null;
  const id = typeof ref === "string" ? ref : ref && ref.id ? String(ref.id) : "";
  if (!id) return null;
  try {
    return await figma.variables.getVariableByIdAsync(id);
  } catch (_err) {
    return null;
  }
}

async function setImageFill(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("fills" in node)) throw new Error("Node does not support fills");
  const image = params.imageBytes
    ? figma.createImage(base64ToBytes(String(params.imageBytes)))
    : params.url
      ? await figma.createImageAsync(String(params.url))
      : null;
  if (!image) throw new Error("Missing url or imageBytes");
  const scaleMode = params.scaleMode ? String(params.scaleMode).toUpperCase() : "FILL";
  if (!IMAGE_SCALE_MODES.has(scaleMode)) throw new Error("Unsupported scaleMode: " + scaleMode);
  const paintIndex = params.paintIndex === undefined || params.paintIndex === null ? 0 : Number(params.paintIndex);
  const fills = Array.isArray(node.fills) ? node.fills.slice() : [];
  while (fills.length <= paintIndex) fills.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
  const fill = { type: "IMAGE", imageHash: image.hash, scaleMode };
  if (params.rotation !== undefined && params.rotation !== null) fill.rotation = Number(params.rotation);
  fills[paintIndex] = fill;
  node.fills = fills;
  return { success: true, nodeId: node.id, imageHash: image.hash, scaleMode, paintIndex };
}

function buildGradientTransform(type, from, to) {
  const f = from && typeof from === "object" ? { x: Number(from.x || 0), y: Number(from.y || 0) } : { x: 0, y: 0 };
  const t = to && typeof to === "object" ? { x: Number(to.x || 0), y: Number(to.y || 0) } : { x: 1, y: 0 };
  if (type === "GRADIENT_LINEAR") {
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const len = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
    const px = -dy / len;
    const py = dx / len;
    return [[dx, px, f.x], [dy, py, f.y]];
  }
  const dx = t.x - f.x;
  const dy = t.y - f.y;
  const radius = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
  return [[radius, 0, f.x], [0, radius, f.y]];
}

function normalizeGradientStops(stops) {
  const arr = ensureArray(stops);
  if (!arr.length) throw new Error("Missing gradient stops");
  return arr.map((s, i) => {
    const color = s && s.color ? s.color : {};
    const position = s && s.position !== undefined && s.position !== null ? Number(s.position) : i / Math.max(arr.length - 1, 1);
    return {
      color: normalizeColorParts(color),
      position: clamp01(position)
    };
  });
}

async function setGradientFill(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("fills" in node)) throw new Error("Node does not support fills");
  const gradientType = params.gradientType ? String(params.gradientType).toUpperCase() : "LINEAR";
  const figmaType = GRADIENT_TYPES[gradientType];
  if (!figmaType) throw new Error("Unsupported gradientType: " + gradientType);
  const fill = {
    type: figmaType,
    gradientStops: normalizeGradientStops(params.stops),
    gradientTransform: buildGradientTransform(figmaType, params.from, params.to)
  };
  if (params.opacity !== undefined && params.opacity !== null) fill.opacity = normalize01From01Or255(params.opacity);
  const paintIndex = params.paintIndex === undefined || params.paintIndex === null ? 0 : Number(params.paintIndex);
  const fills = Array.isArray(node.fills) ? node.fills.slice() : [];
  while (fills.length <= paintIndex) fills.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
  fills[paintIndex] = fill;
  node.fills = fills;
  return { success: true, nodeId: node.id, gradientType: figmaType, paintIndex, stopCount: fill.gradientStops.length };
}

function normalizeEffect(e) {
  if (!e || typeof e !== "object") throw new Error("Effect must be an object");
  const type = e.type === undefined || e.type === null ? "" : String(e.type).toUpperCase();
  const out = { type };
  if (type === "DROP_SHADOW" || type === "INNER_SHADOW") {
    out.color = normalizeColorParts(e.color);
    const offset = e.offset && typeof e.offset === "object" ? e.offset : {};
    out.offset = { x: Number(offset.x || 0), y: Number(offset.y || 0) };
    out.radius = Number(e.radius === undefined || e.radius === null ? 0 : e.radius);
    out.spread = Number(e.spread === undefined || e.spread === null ? 0 : e.spread);
    if (e.visible !== undefined && e.visible !== null) out.visible = Boolean(e.visible);
    if (e.blendMode !== undefined && e.blendMode !== null) out.blendMode = String(e.blendMode);
    if (e.boundVariables && typeof e.boundVariables === "object" && e.boundVariables.color) {
      out.boundVariables = { color: e.boundVariables.color };
    }
  } else if (type === "LAYER_BLUR" || type === "BACKGROUND_BLUR") {
    out.radius = Number(e.radius === undefined || e.radius === null ? 0 : e.radius);
    if (e.visible !== undefined && e.visible !== null) out.visible = Boolean(e.visible);
  } else {
    throw new Error("Unsupported effect type: " + type);
  }
  return out;
}

async function setEffects(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("effects" in node)) throw new Error("Node does not support effects");
  if (params.effectStyleId) {
    node.effects = [];
    await setEffectStyleId(node, String(params.effectStyleId));
    return { success: true, nodeId: node.id, effectStyleId: String(params.effectStyleId) };
  }
  const raw = ensureArray(params.effects);
  if (!raw.length) throw new Error("Missing effects or effectStyleId");
  const effects = raw.map((e) => normalizeEffect(e));
  node.effects = effects;
  if (params.boundVariables && typeof params.boundVariables === "object") {
    for (const key of Object.keys(params.boundVariables)) {
      if (key !== "color") continue;
      const v = await resolveVariableRef(params.boundVariables[key]);
      if (v && typeof figma.variables !== "undefined" && typeof figma.variables.setBoundVariableForEffect === "function") {
        try {
          if (effects.length) {
            const bound = figma.variables.setBoundVariableForEffect(effects[0], "color", v);
            node.effects = [bound].concat(effects.slice(1));
          }
        } catch (_err) {}
      }
    }
  }
  return { success: true, nodeId: node.id, effectsCount: node.effects.length, effectStyleId: node.effectStyleId || null };
}

function normalizeVectorPaths(paths) {
  const arr = ensureArray(paths);
  if (!arr.length) throw new Error("Missing vectorPaths");
  return arr.map((p) => {
    if (!p || !p.data) throw new Error("Each vectorPath needs a data string");
    const windingRule = p.windingRule ? String(p.windingRule) : "NONZERO";
    if (windingRule !== "NONZERO" && windingRule !== "EVENODD") throw new Error("Unsupported windingRule: " + windingRule);
    return { windingRule, data: String(p.data) };
  });
}

async function createVector(params) {
  if (typeof figma.createVector !== "function") {
    throw new Error("figma.createVector() is not available in this Figma version. Update Figma Desktop to the latest version.");
  }
  const vector = figma.createVector();
  vector.vectorPaths = normalizeVectorPaths(params && params.vectorPaths);
  vector.name = params && params.name ? String(params.name) : "Vector";
  if (params && params.fills !== undefined) vector.fills = ensureArray(params.fills);
  else vector.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
  if (params && params.strokes !== undefined) vector.strokes = ensureArray(params.strokes);
  if (params && params.strokeWeight !== undefined) vector.strokeWeight = Number(params.strokeWeight);
  const host = await resolveCreateHost(params);
  host.appendChild(vector);
  if (params && params.x !== undefined) vector.x = Number(params.x);
  if (params && params.y !== undefined) vector.y = Number(params.y);
  figma.currentPage.selection = [vector];
  figma.viewport.scrollAndZoomIntoView([vector]);
  return { nodeId: vector.id, name: vector.name, type: vector.type };
}

async function setVectorPaths(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  assertNodeWritable(node, params);
  if (!("vectorPaths" in node)) throw new Error("Node does not support vectorPaths");
  node.vectorPaths = normalizeVectorPaths(params.vectorPaths);
  return { success: true, nodeId: node.id, pathCount: node.vectorPaths.length };
}

const BOOLEAN_OPS = {
  UNION: "union",
  SUBTRACT: "subtract",
  INTERSECT: "intersect",
  EXCLUDE: "exclude"
};

async function booleanGroup(params) {
  const op = params && params.op ? String(params.op).toUpperCase() : "UNION";
  const fn = BOOLEAN_OPS[op];
  if (!fn) throw new Error("Unsupported boolean op: " + op);
  const ids = ensureArray(params && params.nodeIds).map((id) => normalizeFigmaNodeId(id));
  if (ids.length < 2) throw new Error("Need at least 2 nodeIds for a boolean group");
  const nodes = [];
  for (let i = 0; i < ids.length; i += 1) nodes.push(await getNodeByIdAsync(ids[i]));
  const parent = params && params.parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(String(params.parentNodeId))) : nodes[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("Parent cannot contain children");
  const result = figma[fn](nodes, parent);
  if (params && params.name !== undefined && params.name !== null) result.name = String(params.name);
  figma.currentPage.selection = [result];
  figma.viewport.scrollAndZoomIntoView([result]);
  return { success: true, nodeId: result.id, name: result.name, type: result.type };
}

async function groupNodes(params) {
  const ids = ensureArray(params && params.nodeIds).map((id) => normalizeFigmaNodeId(id));
  if (!ids.length) throw new Error("Missing nodeIds");
  const nodes = [];
  for (let i = 0; i < ids.length; i += 1) nodes.push(await getNodeByIdAsync(ids[i]));
  const parent = params && params.parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(String(params.parentNodeId))) : nodes[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("Parent cannot contain children");
  const group = figma.group(nodes, parent);
  if (params && params.name !== undefined && params.name !== null) group.name = String(params.name);
  figma.currentPage.selection = [group];
  return { success: true, nodeId: group.id, name: group.name, childCount: group.children.length };
}

async function ungroupNode(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  if (node.type !== "GROUP") throw new Error("Node is not a GROUP");
  const parent = node.parent;
  if (!parent || !("appendChild" in parent)) throw new Error("Group parent cannot contain children");
  const children = node.children.slice();
  node.remove();
  for (let i = 0; i < children.length; i += 1) parent.appendChild(children[i]);
  return { success: true, nodeId: node.id, childCount: children.length };
}

async function createSection(params) {
  const p = params && typeof params === "object" ? params : {};
  if (typeof figma.createSection !== "function") {
    throw new Error("figma.createSection() is not available in this Figma version. Update Figma Desktop to the latest version.");
  }
  const section = figma.createSection();
  section.resize(Number(p.width === undefined || p.width === null ? 800 : p.width), Number(p.height === undefined || p.height === null ? 600 : p.height));
  section.x = Number(p.x === undefined || p.x === null ? 0 : p.x);
  section.y = Number(p.y === undefined || p.y === null ? 0 : p.y);
  section.name = p.name ? String(p.name) : "Section";
  if (p.fillColor && typeof p.fillColor === "object") {
    section.fills = [{ type: "SOLID", color: { r: normalize01From01Or255(p.fillColor.r), g: normalize01From01Or255(p.fillColor.g), b: normalize01From01Or255(p.fillColor.b) }, opacity: p.fillColor.a === undefined ? 1 : normalize01From01Or255(p.fillColor.a) }];
  } else {
    section.fills = [];
  }
  if (p.sectionProperties && typeof p.sectionProperties === "object" && "sectionProperties" in section) {
    section.sectionProperties = p.sectionProperties;
  }
  const host = await resolveCreateHost(p);
  host.appendChild(section);
  figma.currentPage.selection = [section];
  figma.viewport.scrollAndZoomIntoView([section]);
  return { nodeId: section.id, name: section.name, type: section.type };
}

async function setTextStyle(params) {
  if (!params || !params.nodeId) throw new Error("Missing nodeId");
  const node = await figma.getNodeByIdAsync(String(params.nodeId));
  if (!node) throw new Error("Node not found with ID: " + String(params.nodeId));
  if (node.type !== "TEXT") throw new Error("Node is not a TEXT node");
  assertNodeWritable(node, params);
  await loadTextFont(node);
  if (params.textStyleId) await setTextStyleId(node, String(params.textStyleId));
  if (params.fontFamily !== undefined || params.fontStyle !== undefined) {
    const current = node.fontName && node.fontName !== figma.mixed ? node.fontName : { family: "Inter", style: "Regular" };
    const family = params.fontFamily !== undefined && params.fontFamily !== null ? String(params.fontFamily) : current.family;
    const style = params.fontStyle !== undefined && params.fontStyle !== null ? String(params.fontStyle) : current.style;
    node.fontName = await safeLoadFont(family, style);
  }
  if (params.fontSize !== undefined && params.fontSize !== null) node.fontSize = Number(params.fontSize);
  if (params.lineHeight !== undefined && params.lineHeight !== null) {
    if (typeof params.lineHeight === "number") node.lineHeight = { unit: "PIXELS", value: Number(params.lineHeight) };
    else if (params.lineHeight === "AUTO") node.lineHeight = { unit: "AUTO" };
    else if (params.lineHeight && typeof params.lineHeight === "object") node.lineHeight = { unit: String(params.lineHeight.unit || "PIXELS"), value: Number(params.lineHeight.value) };
  }
  if (params.letterSpacing !== undefined && params.letterSpacing !== null) {
    if (typeof params.letterSpacing === "number") node.letterSpacing = { unit: "PERCENT", value: Number(params.letterSpacing) };
    else if (params.letterSpacing && typeof params.letterSpacing === "object") node.letterSpacing = { unit: String(params.letterSpacing.unit || "PERCENT"), value: Number(params.letterSpacing.value) };
  }
  if (params.textCase !== undefined && params.textCase !== null) node.textCase = String(params.textCase);
  if (params.textDecoration !== undefined && params.textDecoration !== null) node.textDecoration = String(params.textDecoration);
  if (params.textAlignHorizontal !== undefined && params.textAlignHorizontal !== null) node.textAlignHorizontal = String(params.textAlignHorizontal);
  if (params.textAlignVertical !== undefined && params.textAlignVertical !== null) node.textAlignVertical = String(params.textAlignVertical);
  if (params.paragraphIndent !== undefined && params.paragraphIndent !== null) node.paragraphIndent = Number(params.paragraphIndent);
  if (params.paragraphSpacing !== undefined && params.paragraphSpacing !== null) node.paragraphSpacing = Number(params.paragraphSpacing);
  if (params.fillsHex) node.fills = [{ type: "SOLID", color: hexToRgb01(String(params.fillsHex)) }];
  else if (params.fills !== undefined) node.fills = ensureArray(params.fills);
  if (params.fillStyleId) await setFillStyleId(node, String(params.fillStyleId));
  if (params.boundVariables && typeof params.boundVariables === "object" && "setBoundVariable" in node) {
    for (const prop of Object.keys(params.boundVariables)) {
      const v = await resolveVariableRef(params.boundVariables[prop]);
      if (v) node.setBoundVariable(prop, v);
    }
  }
  return { success: true, nodeId: node.id };
}

async function createPage(params) {
  const name = params && params.name ? String(params.name) : "Page";
  const page = figma.createPage();
  page.name = name;
  figma.root.appendChild(page);
  return { success: true, pageId: page.id, name: page.name };
}

async function renamePage(params) {
  if (!params || !params.pageId) throw new Error("Missing pageId");
  const node = await getNodeByIdAsync(String(params.pageId));
  if (node.type !== "PAGE") throw new Error("Node is not a PAGE");
  node.name = params.name === undefined || params.name === null ? "" : String(params.name);
  return { success: true, pageId: node.id, name: node.name };
}

async function deletePage(params) {
  if (!params || !params.pageId) throw new Error("Missing pageId");
  if (!params.confirmDelete) throw new Error("confirmDelete must be true");
  const node = await getNodeByIdAsync(String(params.pageId));
  if (node.type !== "PAGE") throw new Error("Node is not a PAGE");
  const pageId = node.id;
  node.remove();
  return { success: true, pageId };
}

async function duplicatePage(params) {
  if (!params || !params.pageId) throw new Error("Missing pageId");
  const node = await getNodeByIdAsync(String(params.pageId));
  if (node.type !== "PAGE") throw new Error("Node is not a PAGE");
  const clone = node.clone();
  const parent = node.parent || figma.root;
  if (parent && parent !== clone.parent && "appendChild" in parent) parent.appendChild(clone);
  return { success: true, pageId: node.id, newPageId: clone.id, name: clone.name };
}

async function setCurrentPage(params) {
  if (!params || !params.pageId) throw new Error("Missing pageId");
  const node = await getNodeByIdAsync(String(params.pageId));
  if (node.type !== "PAGE") throw new Error("Node is not a PAGE");
  figma.currentPage = node;
  return { success: true, pageId: node.id, name: node.name };
}

async function reorderPage(params) {
  if (!params || !params.pageId) throw new Error("Missing pageId");
  if (params.index === undefined || params.index === null) throw new Error("Missing index");
  const node = await getNodeByIdAsync(String(params.pageId));
  if (node.type !== "PAGE") throw new Error("Node is not a PAGE");
  const index = Math.max(0, Math.floor(Number(params.index)));
  figma.root.insertChild(index, node);
  return { success: true, pageId: node.id, index };
}

async function generateGrid(params) {
  const p = params && typeof params === "object" ? params : {};
  const columns = Math.max(1, Math.floor(Number(p.columns || 1)));
  const rows = Math.max(1, Math.floor(Number(p.rows || 1)));
  const host = await resolveCreateHost(p);
  if (!host || !("appendChild" in host)) throw new Error("Parent cannot contain children");
  const seed = p.itemNodeId ? await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.itemNodeId))) : null;
  if (seed && !("clone" in seed)) throw new Error("itemNodeId node cannot be cloned");
  const gapX = Number(p.spacingX === undefined || p.spacingX === null ? 0 : p.spacingX);
  const gapY = Number(p.spacingY === undefined || p.spacingY === null ? 0 : p.spacingY);
  const itemW = Number(p.itemWidth === undefined || p.itemWidth === null ? (seed ? seed.width : 100) : p.itemWidth);
  const itemH = Number(p.itemHeight === undefined || p.itemHeight === null ? (seed ? seed.height : 60) : p.itemHeight);
  const created = [];
  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      let item;
      if (seed) {
        item = seed.clone();
      } else {
        item = figma.createRectangle();
        item.resize(itemW, itemH);
      }
      if (p.name && typeof p.name === "string") item.name = p.name.replace(/\{i\}/g, String(index));
      host.appendChild(item);
      item.x = c * (itemW + gapX);
      item.y = r * (itemH + gapY);
      created.push(item.id);
      index += 1;
    }
  }
  const last = created.length ? await figma.getNodeByIdAsync(created[created.length - 1]) : null;
  if (last) { figma.currentPage.selection = [last]; figma.viewport.scrollAndZoomIntoView([last]); }
  return { success: true, columns, rows, createdNodeIds: created };
}

async function bulkRename(params) {
  const p = params && typeof params === "object" ? params : {};
  const find = p.find === undefined || p.find === null ? "" : String(p.find);
  if (!find) throw new Error("Missing find");
  const replace = p.replace === undefined || p.replace === null ? "" : String(p.replace);
  const useRegex = Boolean(p.useRegex);
  const dryRun = Boolean(p.dryRun);
  let matcher;
  try {
    matcher = useRegex ? new RegExp(find, "g") : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  } catch (err) {
    throw new Error("Invalid find pattern: " + (err && err.message ? err.message : String(err)));
  }
  let root = figma.currentPage;
  await figma.currentPage.loadAsync();
  if (p.rootNodeId) {
    const n = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.rootNodeId)));
    if (n) root = n;
  }
  const targets = "findAll" in root ? root.findAll(() => true) : [];
  const changes = [];
  for (const node of targets) {
    matcher.lastIndex = 0;
    const current = String(node.name || "");
    const next = current.replace(matcher, replace);
    if (next === current) continue;
    changes.push({ nodeId: node.id, type: node.type, before: current, after: next });
    if (!dryRun) node.name = next;
  }
  return { success: true, dryRun, matchCount: changes.length, changes };
}

async function applyBulkUpdate(node, property, value) {
  switch (property) {
    case "fillColor": {
      if (!("fills" in node)) throw new Error("Node does not support fills");
      const c = value && typeof value === "object" ? value : {};
      node.fills = [{ type: "SOLID", color: { r: normalize01From01Or255(c.r), g: normalize01From01Or255(c.g), b: normalize01From01Or255(c.b) }, opacity: c.a === undefined ? 1 : normalize01From01Or255(c.a) }];
      return;
    }
    case "cornerRadius": {
      if (!("cornerRadius" in node)) throw new Error("Node does not support cornerRadius");
      node.cornerRadius = Number(value);
      return;
    }
    case "opacity": {
      if (!("opacity" in node)) throw new Error("Node does not support opacity");
      node.opacity = normalize01From01Or255(value);
      return;
    }
    case "visible": {
      if (!("visible" in node)) throw new Error("Node does not support visible");
      node.visible = Boolean(value);
      return;
    }
    case "name": {
      node.name = String(value);
      return;
    }
    case "fillStyle": {
      if (!("fills" in node)) throw new Error("Node does not support fills");
      node.fills = [];
      await setFillStyleId(node, String(value));
      return;
    }
    case "textStyle": {
      if (node.type !== "TEXT") throw new Error("Node is not a TEXT node");
      await setTextStyleId(node, String(value));
      return;
    }
    case "cornerRadii": {
      if (!("cornerRadius" in node)) throw new Error("Node does not support cornerRadius");
      const c = value && typeof value === "object" ? value : {};
      if (c.topLeft !== undefined && "topLeftRadius" in node) node.topLeftRadius = Number(c.topLeft);
      if (c.topRight !== undefined && "topRightRadius" in node) node.topRightRadius = Number(c.topRight);
      if (c.bottomLeft !== undefined && "bottomLeftRadius" in node) node.bottomLeftRadius = Number(c.bottomLeft);
      if (c.bottomRight !== undefined && "bottomRightRadius" in node) node.bottomRightRadius = Number(c.bottomRight);
      return;
    }
    default:
      throw new Error("Unsupported bulk property: " + property);
  }
}

async function bulkUpdate(params) {
  const p = params && typeof params === "object" ? params : {};
  const property = p.property === undefined || p.property === null ? "" : String(p.property);
  if (!property) throw new Error("Missing property");
  const nodeIds = ensureArray(p.nodeIds).map((x) => String(x));
  const nodeTypes = ensureArray(p.nodeTypes).map((t) => String(t).toUpperCase());
  let targets = [];
  if (nodeIds.length) {
    for (const id of nodeIds) {
      const n = await figma.getNodeByIdAsync(normalizeFigmaNodeId(id));
      if (n) targets.push(n);
    }
  } else {
    let root = figma.currentPage;
    await figma.currentPage.loadAsync();
    if (p.rootNodeId) {
      const n = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.rootNodeId)));
      if (n) root = n;
    }
    targets = "findAll" in root ? root.findAll(() => true) : [];
  }
  const updated = [];
  const failed = [];
  for (const node of targets) {
    if (nodeTypes.length && nodeTypes.indexOf(node.type) < 0) continue;
    try {
      await applyBulkUpdate(node, property, p.value);
      updated.push(node.id);
    } catch (err) {
      failed.push({ nodeId: node.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { success: true, property, updatedCount: updated.length, failedCount: failed.length, updated, failed };
}

async function resolveComponentByKey(key) {
  const local = figma.root.findAll((n) => (n.type === "COMPONENT" || n.type === "COMPONENT_SET") && String(n.key || "") === key);
  if (local.length) return local[0];
  try {
    return await figma.importComponentByKeyAsync(key);
  } catch (_err) {
    return null;
  }
}

async function replaceAllInstances(params) {
  const p = params && typeof params === "object" ? params : {};
  const sourceKey = p.sourceComponentKey ? String(p.sourceComponentKey) : "";
  const targetKey = p.targetComponentKey ? String(p.targetComponentKey) : "";
  if (!sourceKey || !targetKey) throw new Error("Missing sourceComponentKey/targetComponentKey");
  const dryRun = Boolean(p.dryRun);
  let root = figma.currentPage;
  await figma.currentPage.loadAsync();
  if (p.rootNodeId) {
    const n = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.rootNodeId)));
    if (n) root = n;
  }
  const instances = "findAll" in root ? root.findAll((n) => n.type === "INSTANCE") : [];
  let target = await resolveComponentByKey(targetKey);
  if (!target) throw new Error("Target component not found by key: " + targetKey);
  if (target.type === "COMPONENT_SET") target = target.defaultVariant || target;
  const swapped = [];
  const skipped = [];
  for (const inst of instances) {
    const main = await getMainComponentForInstance(inst);
    if (!main || String(main.key || "") !== sourceKey) { skipped.push({ instanceId: inst.id }); continue; }
    if (dryRun) { swapped.push({ instanceId: inst.id }); continue; }
    const props = inst.componentProperties || {};
    inst.swapComponent(target);
    if (Object.keys(props).length) { try { inst.setProperties(props); } catch (_err) {} }
    swapped.push({ instanceId: inst.id });
  }
  return { success: true, dryRun, sourceComponentKey: sourceKey, targetComponentKey: targetKey, swappedCount: swapped.length, skippedCount: skipped.length, swapped };
}

async function setVariableMode(params) {
  const p = params && typeof params === "object" ? params : {};
  const nodeIds = ensureArray(p.nodeIds).map((x) => String(x));
  const rootNodeId = p.rootNodeId ? String(p.rootNodeId) : null;
  let targets = [];
  if (nodeIds.length) {
    for (const id of nodeIds) {
      const n = await figma.getNodeByIdAsync(normalizeFigmaNodeId(id));
      if (n) targets.push(n);
    }
  } else if (rootNodeId) {
    const root = await figma.getNodeByIdAsync(normalizeFigmaNodeId(rootNodeId));
    if (root) {
      targets = p.recurse === false ? [root] : [root].concat("findAll" in root ? root.findAll(() => true) : []);
    }
  } else {
    await figma.currentPage.loadAsync();
    targets = [figma.currentPage].concat(figma.currentPage.findAll(() => true));
  }
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const selected = p.collectionId ? collections.filter((c) => c.id === p.collectionId || c.name === p.collectionId) : collections;
  const results = [];
  let appliedCount = 0;
  for (const node of targets) {
    for (const collection of selected) {
      const modeId = resolveModeIdFromCollection(collection, p.modeId);
      if (!modeId) continue;
      try {
        node.setVariableMode(collection.id, modeId);
        appliedCount += 1;
        results.push({ nodeId: node.id, collectionId: collection.id, modeId });
      } catch (_err) {}
    }
  }
  return {
    success: true,
    modeId: p.modeId,
    collectionIds: selected.map((c) => c.id),
    targetCount: targets.length,
    appliedCount,
    results: results.slice(0, 50),
    resultsTruncated: results.length > 50
  };
}

async function createVariableMode(params) {
  const collectionId = params && params.collectionId ? String(params.collectionId) : "";
  const name = params && params.name ? String(params.name) : "";
  if (!collectionId || !name) throw new Error("Missing collectionId/name");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error("Variable collection not found: " + collectionId);
  const mode = collection.addMode(name);
  return { success: true, collectionId: collection.id, modeId: mode.modeId, name: mode.name };
}

async function renameVariableMode(params) {
  const collectionId = params && params.collectionId ? String(params.collectionId) : "";
  const name = params && params.name ? String(params.name) : "";
  if (!collectionId || !name) throw new Error("Missing collectionId/name");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error("Variable collection not found: " + collectionId);
  const modeId = resolveModeIdFromCollection(collection, params && params.modeId);
  if (!modeId) throw new Error("Mode not found: " + String(params && params.modeId));
  collection.renameMode(modeId, name);
  return { success: true, collectionId: collection.id, modeId, name };
}

async function deleteVariableMode(params) {
  const collectionId = params && params.collectionId ? String(params.collectionId) : "";
  if (!collectionId) throw new Error("Missing collectionId");
  if (!params.confirmDelete) throw new Error("confirmDelete must be true");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error("Variable collection not found: " + collectionId);
  const modeId = resolveModeIdFromCollection(collection, params && params.modeId);
  if (!modeId) throw new Error("Mode not found: " + String(params && params.modeId));
  collection.removeMode(modeId);
  return { success: true, collectionId: collection.id, modeId };
}

async function renameVariableCollection(params) {
  const collectionId = params && params.collectionId ? String(params.collectionId) : "";
  const name = params && params.name ? String(params.name) : "";
  if (!collectionId || !name) throw new Error("Missing collectionId/name");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error("Variable collection not found: " + collectionId);
  collection.name = name;
  return { success: true, collectionId: collection.id, name: collection.name };
}

async function subscribeEvents(params) {
  const events = ensureArray(params && params.events).map((e) => String(e));
  for (const e of events) activeEventSubscriptions.add(e);
  return { success: true, subscribed: Array.from(activeEventSubscriptions) };
}

async function unsubscribeEvents(params) {
  const events = ensureArray(params && params.events).map((e) => String(e));
  for (const e of events) activeEventSubscriptions.delete(e);
  return { success: true, subscribed: Array.from(activeEventSubscriptions) };
}

async function syncTargetFrames(params) {
  const ids = ensureArray(params && params.targetFrameIds).map((x) => String(x));
  pluginTargetFrameIds = new Set(ids);
  return { success: true, targetFrameIds: Array.from(pluginTargetFrameIds) };
}

// ---------------------------------------------------------------------------
// Style guide extraction
// ---------------------------------------------------------------------------

function bumpCount(map, key) {
  const k = key === undefined || key === null ? "(none)" : String(key);
  map.set(k, (map.get(k) || 0) + 1);
}

function countsToSortedArray(map) {
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), undefined, { numeric: true }));
}

async function getStyleGuide(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  let root = null;
  if (rootNodeId) root = await figma.getNodeByIdAsync(rootNodeId);
  const container = root && root.type !== "DOCUMENT" ? root : figma.currentPage;
  const nodes = "findAll" in container ? container.findAll(() => true) : root ? [root] : [];
  const colors = new Map();
  const colorVariables = new Map();
  const fonts = new Map();
  const fontSizes = new Map();
  const lineHeights = new Map();
  const spacing = new Map();
  const cornerRadii = new Map();
  const strokeWeights = new Map();
  const opacities = new Map();

  const collectSolidPaints = (paints, colorMap, varMap) => {
    if (!Array.isArray(paints)) return;
    for (const paint of paints) {
      if (!paint || paint.type !== "SOLID" || paint.visible === false || !paint.color) continue;
      bumpCount(colorMap, rgbaToHex(Object.assign({}, paint.color, paint.opacity !== undefined && paint.opacity !== null ? { a: paint.opacity } : {})));
      if (paint.boundVariables && paint.boundVariables.color) bumpCount(varMap, String(paint.boundVariables.color));
    }
  };

  for (const node of nodes) {
    if ("fills" in node) collectSolidPaints(node.fills, colors, colorVariables);
    if ("strokes" in node) collectSolidPaints(node.strokes, colors, colorVariables);
    if (node.type === "TEXT" && node.fontName && node.fontName !== figma.mixed) {
      bumpCount(fonts, String(node.fontName.family) + " / " + String(node.fontName.style));
      if (typeof node.fontSize === "number") bumpCount(fontSizes, node.fontSize);
      if (node.lineHeight && node.lineHeight.unit === "PIXELS" && typeof node.lineHeight.value === "number") bumpCount(lineHeights, node.lineHeight.value);
    }
    if ("paddingTop" in node && typeof node.paddingTop === "number") {
      bumpCount(spacing, "padding " + node.paddingTop);
      bumpCount(spacing, "padding " + node.paddingRight);
      bumpCount(spacing, "padding " + node.paddingBottom);
      bumpCount(spacing, "padding " + node.paddingLeft);
    }
    if ("itemSpacing" in node && typeof node.itemSpacing === "number") bumpCount(spacing, "gap " + node.itemSpacing);
    if ("cornerRadius" in node && typeof node.cornerRadius === "number") bumpCount(cornerRadii, node.cornerRadius);
    if ("strokeWeight" in node && typeof node.strokeWeight === "number") bumpCount(strokeWeights, node.strokeWeight);
    if ("opacity" in node && typeof node.opacity === "number") bumpCount(opacities, node.opacity);
  }

  return {
    success: true,
    nodeCount: nodes.length,
    colors: countsToSortedArray(colors),
    colorVariables: countsToSortedArray(colorVariables),
    fonts: countsToSortedArray(fonts),
    fontSizes: countsToSortedArray(fontSizes),
    lineHeights: countsToSortedArray(lineHeights),
    spacing: countsToSortedArray(spacing),
    cornerRadii: countsToSortedArray(cornerRadii),
    strokeWeights: countsToSortedArray(strokeWeights),
    opacities: countsToSortedArray(opacities)
  };
}

// ---------------------------------------------------------------------------
// Font list
// ---------------------------------------------------------------------------

async function getFontList(params) {
  await figma.currentPage.loadAsync();
  const rootNodeId = params && params.rootNodeId ? String(params.rootNodeId) : null;
  let root = null;
  if (rootNodeId) root = await figma.getNodeByIdAsync(rootNodeId);
  const container = root && root.type !== "DOCUMENT" ? root : figma.currentPage;
  const textNodes = "findAll" in container
    ? container.findAll((n) => n.type === "TEXT")
    : root && root.type === "TEXT" ? [root] : [];
  const counts = new Map();
  let mixedCount = 0;
  for (const t of textNodes) {
    if (!t.fontName) continue;
    if (t.fontName === figma.mixed) { mixedCount += 1; continue; }
    bumpCount(counts, String(t.fontName.family) + "\u0000" + String(t.fontName.style));
  }
  const fonts = countsToSortedArray(counts)
    .map((entry) => {
      const sep = entry.value.indexOf("\u0000");
      const family = sep >= 0 ? entry.value.slice(0, sep) : entry.value;
      const style = sep >= 0 ? entry.value.slice(sep + 1) : "";
      return { family, style, count: entry.count };
    });
  return { success: true, total: textNodes.length, mixedFontCount: mixedCount, fonts };
}

// ---------------------------------------------------------------------------
// Distribute / arrange
// ---------------------------------------------------------------------------

async function distributeNodes(params) {
  const p = params && typeof params === "object" ? params : {};
  const ids = ensureArray(p.nodeIds).map((id) => normalizeFigmaNodeId(id));
  if (ids.length < 2) throw new Error("Need at least 2 nodeIds");
  const nodes = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error("Node not found: " + id);
    assertNodeWritable(node, p);
    nodes.push(node);
  }
  const axis = String(p.axis || "horizontal").toLowerCase() === "vertical" ? "vertical" : "horizontal";
  const mode = String(p.mode || "gap").toLowerCase();
  const crossAlign = String(p.crossAlign || "none").toLowerCase();
  const gap = Number(p.gap === undefined || p.gap === null ? 0 : p.gap);

  const getMain = (n) => (axis === "horizontal" ? n.x : n.y);
  const getCross = (n) => (axis === "horizontal" ? n.y : n.x);
  const getMainSize = (n) => (axis === "horizontal" ? n.width : n.height);
  const getCrossSize = (n) => (axis === "horizontal" ? n.height : n.width);

  let bounds = null;
  if (p.bounds && typeof p.bounds === "object") {
    const b = p.bounds;
    const bx1 = Number(b.x1);
    const by1 = Number(b.y1);
    const bx2 = Number(b.x2);
    const by2 = Number(b.y2);
    if (![bx1, by1, bx2, by2].every((v) => Number.isFinite(v))) {
      throw new Error("bounds must include numeric x1, y1, x2, y2");
    }
    bounds = axis === "horizontal"
      ? { minMain: bx1, maxMain: bx2, minCross: by1, maxCross: by2 }
      : { minMain: by1, maxMain: by2, minCross: bx1, maxCross: bx2 };
  } else {
    const parent = nodes[0].parent;
    if (parent && parent !== figma.currentPage && typeof parent.width === "number" && typeof parent.height === "number" && "x" in parent) {
      bounds = axis === "horizontal"
        ? { minMain: parent.x, maxMain: parent.x + parent.width, minCross: parent.y, maxCross: parent.y + parent.height }
        : { minMain: parent.y, maxMain: parent.y + parent.height, minCross: parent.x, maxCross: parent.x + parent.width };
    } else {
      bounds = {
        minMain: Math.min(...nodes.map((n) => getMain(n))),
        maxMain: Math.max(...nodes.map((n) => getMain(n) + getMainSize(n))),
        minCross: Math.min(...nodes.map((n) => getCross(n))),
        maxCross: Math.max(...nodes.map((n) => getCross(n) + getCrossSize(n)))
      };
    }
  }
  if (!(bounds.maxMain > bounds.minMain)) bounds.maxMain = bounds.minMain + 1;
  if (!(bounds.maxCross > bounds.minCross)) bounds.maxCross = bounds.minCross + 1;

  const sorted = nodes.slice().sort((a, b) => getMain(a) - getMain(b));
  const totalSize = sorted.reduce((sum, n) => sum + getMainSize(n), 0);
  const available = bounds.maxMain - bounds.minMain;
  const positions = new Map();

  if (mode === "spaceBetween" || mode === "evenly" || mode === "space-evenly") {
    const gapsCount = sorted.length - 1;
    const gapSize = gapsCount > 0 ? Math.max(0, (available - totalSize) / gapsCount) : 0;
    let cursor = bounds.minMain;
    for (const n of sorted) { positions.set(n.id, cursor); cursor += getMainSize(n) + gapSize; }
  } else if (mode === "center") {
    const start = bounds.minMain + Math.max(0, (available - totalSize - (sorted.length - 1) * gap) / 2);
    let cursor = start;
    for (const n of sorted) { positions.set(n.id, cursor); cursor += getMainSize(n) + gap; }
  } else {
    let cursor = bounds.minMain;
    for (const n of sorted) { positions.set(n.id, cursor); cursor += getMainSize(n) + gap; }
  }

  const results = [];
  for (const n of sorted) {
    let cross = getCross(n);
    if (crossAlign === "start") cross = bounds.minCross;
    else if (crossAlign === "center") cross = bounds.minCross + Math.max(0, (bounds.maxCross - bounds.minCross - getCrossSize(n)) / 2);
    else if (crossAlign === "end") cross = bounds.maxCross - getCrossSize(n);
    if (axis === "horizontal") { n.x = positions.get(n.id); n.y = cross; }
    else { n.y = positions.get(n.id); n.x = cross; }
    results.push({ nodeId: n.id, x: n.x, y: n.y });
  }
  figma.currentPage.selection = nodes;
  return { success: true, axis, mode, crossAlign, distributedNodeIds: nodes.map((n) => n.id), results };
}

async function arrangeChildren(params) {
  const p = params && typeof params === "object" ? params : {};
  if (!p.parentNodeId) throw new Error("Missing parentNodeId");
  const parent = await figma.getNodeByIdAsync(normalizeFigmaNodeId(String(p.parentNodeId)));
  if (!parent) throw new Error("Parent not found: " + p.parentNodeId);
  assertNodeWritable(parent, p);
  if (!("children" in parent) || !parent.children.length) throw new Error("Parent has no children");
  if (parent.children.length < 2) throw new Error("Parent needs at least 2 children");
  const sub = Object.assign({}, p, { nodeIds: parent.children.map((c) => c.id), parentNodeId: undefined });
  const result = await distributeNodes(sub);
  result.arrangedParentNodeId = parent.id;
  return result;
}

// ---------------------------------------------------------------------------
// Design tokens (W3C-style) import / export
// ---------------------------------------------------------------------------

function mapVariableTypeToW3C(type) {
  switch (String(type)) {
    case "COLOR": return "color";
    case "FLOAT": return "number";
    case "STRING": return "string";
    case "BOOLEAN": return "boolean";
    default: return undefined;
  }
}

function setTokenPath(root, pathParts, value, type) {
  let cur = root;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const part = pathParts[i];
    if (!part) continue;
    if (!cur[part] || typeof cur[part] !== "object" || Array.isArray(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  const last = pathParts[pathParts.length - 1];
  if (!last) return;
  cur[last] = type ? { $type: type, $value: value } : value;
}

function rgbaToHex01(color) {
  return rgbaToHex(color);
}

async function exportTokens(params) {
  const p = params && typeof params === "object" ? params : {};
  const includeModes = p.includeModes !== false;
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let variables;
  try {
    variables = await figma.variables.getLocalVariablesAsync();
  } catch (_err) {
    variables = [];
    for (const t of ["COLOR", "FLOAT", "STRING", "BOOLEAN"]) {
      try { const part = await figma.variables.getLocalVariablesAsync(t); for (const v of part) variables.push(v); } catch (_e) {}
    }
  }
  const varById = new Map();
  for (const v of variables) varById.set(v.id, v);

  const tokens = {};
  const tokensByMode = {};
  const flat = [];

  for (const col of collections) {
    for (const varId of col.variableIds || []) {
      const v = varById.get(varId);
      if (!v) continue;
      const path = String(v.name || "").split("/");
      const w3cType = mapVariableTypeToW3C(v.resolvedType);
      const val = v.valuesByMode || {};
      let value = null;
      if (col.modes.length) {
        const firstModeId = col.modes[0].modeId;
        value = val[firstModeId] !== undefined ? val[firstModeId] : Object.values(val)[0];
      }
      if (value === undefined || value === null) value = null;
      const tokenValue = w3cType === "color" && value && typeof value === "object" ? rgbaToHex01(value) : value;
      setTokenPath(tokens, path, tokenValue, w3cType);
      flat.push({ name: String(v.name), collection: col.name, type: w3cType, value: tokenValue, mode: col.modes.length ? col.modes[0].name : null });
      if (includeModes) {
        for (const mode of col.modes) {
          const modeVal = val[mode.modeId];
          if (modeVal === undefined) continue;
          const key = col.name + "/" + mode.name;
          if (!tokensByMode[key]) tokensByMode[key] = {};
          const mv = w3cType === "color" && modeVal && typeof modeVal === "object" ? rgbaToHex01(modeVal) : modeVal;
          setTokenPath(tokensByMode[key], path, mv, w3cType);
          flat.push({ name: String(v.name), collection: col.name, type: w3cType, value: mv, mode: mode.name });
        }
      }
    }
  }

  return {
    success: true,
    collectionCount: collections.length,
    variableCount: variables.length,
    tokens,
    tokensByMode: includeModes ? tokensByMode : undefined,
    variables: flat
  };
}

function flattenTokens(obj) {
  const out = [];
  const walk = (cur, prefix) => {
    if (cur === null || cur === undefined) return;
    if (typeof cur !== "object" || Array.isArray(cur)) {
      if (prefix) out.push({ name: prefix, type: null, value: cur });
      return;
    }
    if (cur.$value !== undefined) {
      out.push({ name: prefix, type: cur.$type || null, value: cur.$value });
      return;
    }
    if (cur.$type !== undefined && !cur.$value) return;
    for (const [key, val] of Object.entries(cur)) {
      if (String(key).startsWith("$")) continue;
      const nextPrefix = prefix ? prefix + "/" + key : key;
      walk(val, nextPrefix);
    }
  };
  walk(obj, "");
  return out;
}

function w3cTypeToVariableType(type, value) {
  const t = String(type || "").toLowerCase();
  if (t === "color") return "COLOR";
  if (t === "dimension" || t === "number" || t === "float") return "FLOAT";
  if (t === "string") return "STRING";
  if (t === "boolean") return "BOOLEAN";
  if (typeof value === "string") {
    const hexish = String(value).trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(hexish) || /^[0-9a-f]{3,4}$/i.test(hexish)) return "COLOR";
  }
  if (typeof value === "number") return "FLOAT";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "string") return "STRING";
  return null;
}

function findVariableInCollection(collection, name) {
  for (const vid of collection.variableIds || []) {
    const existing = figma.variables.getVariableById(vid);
    if (existing && existing.name === name) return existing;
  }
  return null;
}

async function importTokens(params) {
  const p = params && typeof params === "object" ? params : {};
  const raw = p.tokens;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Missing tokens object");
  const createStyles = p.createStyles !== false;
  const modeName = p.modeName ? String(p.modeName) : "Default";
  const collectionName = p.collectionName ? String(p.collectionName) : "Design Tokens";
  const entries = flattenTokens(raw);
  if (!entries.length) throw new Error("No tokens found in the provided object");

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find((c) => c.name === collectionName) || null;
  if (!collection) collection = figma.variables.createVariableCollection(collectionName);
  const mode = collection.modes.find((m) => m.name === modeName) || collection.modes[0];
  if (collection.modes.length === 0) throw new Error("Variable collection has no modes");

  const paintStyles = await getLocalPaintStyles();
  const results = [];
  for (const entry of entries) {
    const resolvedType = w3cTypeToVariableType(entry.type, entry.value);
    if (!resolvedType) {
      results.push({ name: entry.name, status: "skipped", reason: "Unsupported token type: " + String(entry.type) });
      continue;
    }
    let variable = findVariableInCollection(collection, entry.name);
    if (!variable) variable = figma.variables.createVariable(entry.name, collection, resolvedType);
    const coerced = coerceVariableValue(resolvedType, entry.value);
    if (resolvedType === "COLOR" && coerced && typeof coerced === "object" && coerced.a === undefined) coerced.a = 1;
    try { variable.setValueForMode(mode.modeId, coerced); } catch (err) {
      results.push({ name: entry.name, status: "error", reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    results.push({ name: entry.name, status: "ok", variableId: variable.id, resolvedType });
    if (createStyles && resolvedType === "COLOR") {
      const style = paintStyles.find((s) => s.name === entry.name) || figma.createPaintStyle();
      style.name = entry.name;
      style.paints = [{ type: "SOLID", color: coerced && typeof coerced === "object" && coerced.r !== undefined ? { r: coerced.r, g: coerced.g, b: coerced.b } : { r: 0, g: 0, b: 0 } }];
    }
  }
  return { success: true, collectionId: collection.id, collectionName: collection.name, modeId: mode.modeId, modeName: mode.name, results };
}

// ---------------------------------------------------------------------------
// Typography scale
// ---------------------------------------------------------------------------

async function createTypographyScale(params) {
  const p = params && typeof params === "object" ? params : {};
  const baseSize = Number(p.baseSize === undefined || p.baseSize === null ? 16 : p.baseSize);
  const ratio = Number(p.ratio === undefined || p.ratio === null ? 1.25 : p.ratio);
  if (!(baseSize > 0)) throw new Error("baseSize must be > 0");
  if (!(ratio > 0)) throw new Error("ratio must be > 0");
  const fontFamily = p.fontFamily ? String(p.fontFamily) : "Inter";
  const fontStyle = p.fontStyle ? String(p.fontStyle) : "Regular";
  const prefix = p.prefix !== undefined && p.prefix !== null ? String(p.prefix) : "type/";
  const lineHeightRatio = p.lineHeightRatio !== undefined && p.lineHeightRatio !== null ? Number(p.lineHeightRatio) : null;
  const lineHeight = p.lineHeight !== undefined && p.lineHeight !== null ? Number(p.lineHeight) : null;
  const letterSpacing = p.letterSpacing !== undefined && p.letterSpacing !== null ? Number(p.letterSpacing) : null;
  const createSampleFrame = Boolean(p.createSampleFrame);
  const parentNodeId = p.parentNodeId ? String(p.parentNodeId) : null;
  const steps = ensureArray(p.steps && p.steps.length ? p.steps : ["caption", "body", "h3", "h2", "h1", "display"]);

  const offsetFor = { caption: -1, small: -0.5, body: 0, h3: 1, h2: 2, h1: 3, display: 4 };

  const fontName = await safeLoadFont(fontFamily, fontStyle);
  const textStyles = await getLocalTextStyles();
  let host = null;
  if (createSampleFrame) {
    host = parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(parentNodeId)) : await resolveCreateHost(p);
    if (!host || !("appendChild" in host)) throw new Error("Parent cannot contain children");
  }

  const results = [];
  for (const step of steps) {
    const lower = String(step).toLowerCase();
    const offset = offsetFor[lower];
    const fontSize = offset === undefined ? baseSize : baseSize * Math.pow(ratio, offset);
    const name = prefix + lower;
    let style = textStyles.find((s) => s.name === name) || figma.createTextStyle();
    style.name = name;
    style.fontName = fontName;
    style.fontSize = fontSize;
    if (lineHeightRatio !== null) style.lineHeight = { unit: "PIXELS", value: Number((fontSize * lineHeightRatio).toFixed(2)) };
    else if (lineHeight !== null) style.lineHeight = { unit: "PIXELS", value: lineHeight };
    if (letterSpacing !== null) style.letterSpacing = { unit: "PERCENT", value: letterSpacing };
    const sample = { styleId: style.id, name: style.name, fontSize: Number(fontSize.toFixed(2)) };
    if (createSampleFrame && host) {
      const text = figma.createText();
      await safeLoadFont(fontFamily, fontStyle);
      text.fontName = fontName;
      text.characters = lower === "body" ? "The quick brown fox jumps over the lazy dog" : "Heading " + lower.toUpperCase();
      text.fontSize = fontSize;
      text.name = name;
      host.appendChild(text);
      try { text.textStyleId = style.id; } catch (_e) {}
      sample.textNodeId = text.id;
    }
    results.push(sample);
  }

  if (createSampleFrame && host) {
    let y = 0;
    for (const r of results) {
      if (!r.textNodeId) continue;
      const t = await figma.getNodeByIdAsync(r.textNodeId);
      if (!t) continue;
      t.x = 0;
      t.y = y;
      y += t.height + 12;
    }
  }

  return { success: true, baseSize, ratio, fontFamily, fontStyle, prefix, createdStyles: results, sampleFrameCreated: Boolean(createSampleFrame) };
}

// ---------------------------------------------------------------------------
// Palette generation
// ---------------------------------------------------------------------------

function mixColor01(c1, c2, t) {
  const mix = (a, b) => a + (b - a) * t;
  return { r: mix(c1.r, c2.r), g: mix(c1.g, c2.g), b: mix(c1.b, c2.b) };
}

async function generatePalette(params) {
  const p = params && typeof params === "object" ? params : {};
  const hex = p.hex ? String(p.hex) : "";
  if (!hex) throw new Error("Missing hex");
  const seed = parseHexToRgb01(hex);
  const count = p.steps ? Math.max(2, Math.floor(Number(p.steps))) : 10;
  const name = p.name ? String(p.name) : "Palette";
  const createStyles = p.createStyles !== false;
  const createVariables = Boolean(p.createVariables);
  const createFrame = p.createFrame !== false;
  const swatchWidth = Number(p.swatchWidth === undefined || p.swatchWidth === null ? 120 : p.swatchWidth);
  const swatchHeight = Number(p.swatchHeight === undefined || p.swatchHeight === null ? 80 : p.swatchHeight);
  const gap = Number(p.gap === undefined || p.gap === null ? 8 : p.gap);
  const prefix = p.prefix !== undefined && p.prefix !== null ? String(p.prefix) : "color/";

  const names = count === 10
    ? ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]
    : Array.from({ length: count }, (_v, i) => String(i + 1));

  const colors = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const u = (t - 0.5) * 2;
    let mixed;
    if (u <= 0) mixed = mixColor01(seed, { r: 1, g: 1, b: 1 }, Math.min(0.9, -u * 0.9));
    else mixed = mixColor01(seed, { r: 0, g: 0, b: 0 }, Math.min(0.9, u * 0.9));
    colors.push({ r: clamp01(mixed.r), g: clamp01(mixed.g), b: clamp01(mixed.b) });
  }

  const paintStyles = await getLocalPaintStyles();
  let collection = null;
  if (createVariables) {
    const cols = await figma.variables.getLocalVariableCollectionsAsync();
    collection = cols.find((c) => c.name === name + " Tokens") || figma.variables.createVariableCollection(name + " Tokens");
  }

  let host = null;
  if (createFrame) {
    host = p.parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(String(p.parentNodeId))) : await resolveCreateHost(p);
    if (!host || !("appendChild" in host)) throw new Error("Parent cannot contain children");
  }

  const swatches = [];
  for (let i = 0; i < count; i += 1) {
    const c = colors[i];
    const stepName = names[i];
    const fullName = name + "/" + stepName;
    const hexStr = rgb01ToHex(c).toUpperCase();

    if (createStyles) {
      let style = paintStyles.find((s) => s.name === fullName) || figma.createPaintStyle();
      style.name = fullName;
      style.paints = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b } }];
    }

    if (createVariables && collection) {
      let variable = findVariableInCollection(collection, prefix + stepName);
      if (!variable) variable = figma.variables.createVariable(prefix + stepName, collection, "COLOR");
      if (collection.modes.length) variable.setValueForMode(collection.modes[0].modeId, { r: c.r, g: c.g, b: c.b, a: 1 });
    }

    if (createFrame && host) {
      const rect = figma.createRectangle();
      rect.resize(swatchWidth, swatchHeight);
      rect.fills = [{ type: "SOLID", color: { r: c.r, g: c.g, b: c.b } }];
      rect.cornerRadius = 4;
      rect.name = fullName;
      const label = figma.createText();
      await safeLoadFont("Inter", "Regular");
      label.fontName = { family: "Inter", style: "Regular" };
      label.characters = stepName + "  " + hexStr;
      label.fontSize = 12;
      label.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
      label.name = fullName + " label";
      host.appendChild(rect);
      host.appendChild(label);
      label.y = swatchHeight + 2;
      swatches.push({ stepName, hex: hexStr, rectNodeId: rect.id, labelNodeId: label.id });
    }
  }

  if (createFrame && host && swatches.length) {
    for (let i = 0; i < swatches.length; i += 1) {
      const rect = await figma.getNodeByIdAsync(swatches[i].rectNodeId);
      const label = await figma.getNodeByIdAsync(swatches[i].labelNodeId);
      const x = i * (swatchWidth + gap);
      if (rect) rect.x = x;
      if (label) label.x = x;
    }
    try { figma.viewport.scrollAndZoomIntoView([host]); } catch (_e) {}
  }

  return {
    success: true,
    name,
    stepCount: count,
    colors: colors.map((c, i) => ({ step: names[i], hex: rgb01ToHex(c).toUpperCase() })),
    swatchCount: swatches.length,
    frameCreated: Boolean(createFrame),
    paintStylesCreated: createStyles,
    variableCollectionId: createVariables && collection ? collection.id : null
  };
}

// ---------------------------------------------------------------------------
// Extract component set (frames -> components -> variants)
// ---------------------------------------------------------------------------

async function extractComponentSet(params) {
  const p = params && typeof params === "object" ? params : {};
  const ids = ensureArray(p.nodeIds).map((id) => normalizeFigmaNodeId(id));
  if (ids.length < 2) throw new Error("Need at least 2 frames to build a component set");
  const components = [];
  for (const id of ids) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error("Node not found: " + id);
    assertNodeWritable(node, p);
    if (node.type === "COMPONENT") { components.push(node); continue; }
    if (node.type === "COMPONENT_SET" || node.type === "INSTANCE") throw new Error("Cannot convert " + node.type + " into a variant: " + id);
    if (!node.parent || !("appendChild" in node.parent)) throw new Error("Node has no valid parent: " + id);
    const component = figma.createComponentFromNode(node);
    components.push(component);
  }
  const parent = p.parentNodeId ? await getNodeByIdAsync(normalizeFigmaNodeId(String(p.parentNodeId))) : components[0].parent;
  if (!parent || !("appendChild" in parent)) throw new Error("Parent cannot contain children");
  const set = figma.combineAsVariants(components, parent);
  if (p.name !== undefined && p.name !== null) set.name = String(p.name);
  layoutComponentSetVariants(set, p);
  if (p.propertyName !== undefined && p.propertyName !== null && String(p.propertyName).trim()) {
    try { set.addComponentProperty(String(p.propertyName), "VARIANT", String(components[0].name)); } catch (_err) {}
  }
  figma.currentPage.selection = [set];
  figma.viewport.scrollAndZoomIntoView([set]);
  return {
    success: true,
    componentSetId: set.id,
    name: set.name,
    type: set.type,
    componentIds: set.children.map((c) => c.id),
    componentPropertyDefinitions: serializeComponentPropertyDefinitions(set.componentPropertyDefinitions)
  };
}

// Actions that mutate a node (or its parent) must stay inside the recorded
// target frame(s). Each entry extracts the node id(s) that must be scoped.
const TARGET_SCOPED_ACTIONS = {
  rename_node: (p) => [p.nodeId],
  set_fill_color: (p) => [p.nodeId],
  set_stroke_color: (p) => [p.nodeId],
  set_gradient_fill: (p) => [p.nodeId],
  set_image_fill: (p) => [p.nodeId],
  set_effects: (p) => [p.nodeId],
  set_text_style: (p) => [p.nodeId],
  move_node: (p) => [p.nodeId],
  resize_node: (p) => [p.nodeId],
  set_corner_radius: (p) => [p.nodeId],
  set_text_content: (p) => [p.nodeId],
  set_multiple_text_contents: (p) => ensureArray(p.updates).map((u) => u && u.nodeId).filter(Boolean),
  set_layout_mode: (p) => [p.nodeId],
  set_padding: (p) => [p.nodeId],
  set_axis_align: (p) => [p.nodeId],
  set_layout_sizing: (p) => [p.nodeId],
  set_item_spacing: (p) => [p.nodeId],
  set_auto_layout: (p) => [p.frameId],
  set_layout_grids: (p) => [p.frameId],
  set_overflow_direction: (p) => [p.frameId],
  set_fixed_children: (p) => [p.frameId],
  delete_node: (p) => [p.nodeId],
  delete_multiple_nodes: (p) => ensureArray(p.nodeIds),
  clone_node: (p) => [p.nodeId],
  clone_node_into_parent: (p) => [p.nodeId, p.parentNodeId],
  reparent_node: (p) => [p.nodeId, p.newParentId],
  insert_child: (p) => [p.parentId, p.childId],
  append_to_slot: (p) => [p.slotNodeId].concat(ensureArray(p.nodeIds)),
  set_annotation: (p) => [p.nodeId],
  set_multiple_annotations: (p) => ensureArray(p.annotations).map((a) => a && a.nodeId).filter(Boolean),
  set_reactions: (p) => [p.nodeId],
  clear_reactions: (p) => [p.nodeId],
  upsert_reaction: (p) => [p.nodeId],
  set_transition_reaction: (p) => [p.nodeId],
  set_smart_animate_reaction: (p) => [p.nodeId],
  apply_fill_style: (p) => [p.nodeId],
  apply_stroke_style: (p) => [p.nodeId],
  apply_text_style: (p) => [p.nodeId],
  apply_effect_style: (p) => [p.nodeId],
  apply_grid_style: (p) => [p.nodeId],
  bind_color_variable_to_fill: (p) => [p.nodeId],
  bind_color_variable_to_stroke: (p) => [p.nodeId],
  bind_variable_to_property: (p) => [p.nodeId],
  set_node_explicit_variable_mode: (p) => [p.nodeId],
  set_variable_mode: (p) => ensureArray(p.nodeIds).concat(p.rootNodeId ? [p.rootNodeId] : []),
  bulk_rename: (p) => (p.rootNodeId ? [p.rootNodeId] : []),
  bulk_update: (p) => ensureArray(p.nodeIds).concat(p.rootNodeId ? [p.rootNodeId] : []),
  replace_all_instances: (p) => (p.rootNodeId ? [p.rootNodeId] : []),
  generate_grid: (p) => [p.parentNodeId, p.itemNodeId].filter(Boolean),
  boolean_group: (p) => ensureArray(p.nodeIds).concat(p.parentNodeId ? [p.parentNodeId] : []),
  group_nodes: (p) => ensureArray(p.nodeIds).concat(p.parentNodeId ? [p.parentNodeId] : []),
  ungroup_node: (p) => [p.nodeId],
  create_section: (p) => (p.parentNodeId ? [p.parentNodeId] : []),
  create_vector: (p) => (p.parentNodeId ? [p.parentNodeId] : []),
  set_vector_paths: (p) => [p.nodeId],
  distribute_nodes: (p) => ensureArray(p.nodeIds),
  arrange_children: (p) => [p.parentNodeId],
  generate_palette: (p) => (p.parentNodeId ? [p.parentNodeId] : []),
  create_typography_scale: (p) => (p.parentNodeId ? [p.parentNodeId] : []),
  extract_component_set: (p) => ensureArray(p.nodeIds).concat(p.parentNodeId ? [p.parentNodeId] : [])
};

const ALLOWED_ACTIONS = new Set([
  "ping",
  "run_batch", "find_and_replace_text", "get_selection_context",
  "create_checkpoint", "restore_checkpoint", "list_checkpoints",
  "get_document_info", "get_selection", "read_my_design",
  "get_node_info", "get_nodes_info",
  "get_all_pages", "get_document_tree",
  "get_instance_source", "scan_instances_with_sources",
  "set_focus", "set_selections",
  "get_styles",
  "get_local_components",
  "create_component", "create_component_from_node", "combine_as_variants", "set_variant_properties",
  "get_component_property_definitions", "add_component_property", "edit_component_property", "delete_component_property",
  "bind_component_property", "create_component_slot", "edit_component_slot", "delete_component_slot",
  "create_component_instance", "create_instance_from_instance",
  "import_component_by_key", "import_component_set_by_key",
  "create_instance_from_component_key", "create_instance_from_component_set_key",
  "get_instance_properties", "set_instance_properties", "swap_instance_component",
  "export_node_as_image",
  "scan_text_nodes", "scan_nodes_by_types",
  "create_rectangle", "create_frame", "create_text",
  "set_fill_color", "set_stroke_color",
  "set_layout_mode", "set_padding", "set_axis_align", "set_layout_sizing", "set_item_spacing",
  "set_auto_layout", "set_layout_grids", "set_overflow_direction", "set_fixed_children",
  "move_node", "reparent_node", "get_parent_chain", "insert_child", "resize_node",
  "delete_node", "delete_multiple_nodes",
  "clone_node", "clone_node_into_parent",
  "set_corner_radius",
  "set_text_content", "set_multiple_text_contents",
  "create_paint_style", "create_text_style", "create_effect_style", "create_grid_style",
  "import_style_by_key",
  "apply_fill_style", "apply_stroke_style", "apply_effect_style", "apply_text_style", "apply_grid_style",
  "get_annotations", "set_annotation", "set_multiple_annotations",
  "get_reactions", "set_reactions", "clear_reactions", "upsert_reaction",
  "set_transition_reaction", "set_smart_animate_reaction",
  "get_overlay_settings", "set_overlay_settings",
  "get_prototype_settings", "set_prototype_start_node", "set_flow_starting_points",
  "get_instance_slots", "append_to_slot",
  "list_variable_collections", "list_variables",
  "create_variable_collection", "create_variable", "set_variable_values",
  "rename_variable", "delete_variable",
  "import_variable_by_key",
  "bind_color_variable_to_fill", "bind_color_variable_to_stroke",
  "bind_variable_to_property", "set_node_explicit_variable_mode",
  "getDocumentInfo", "getSelection", "renameNode", "setText",
  "createFrame", "createRectangle", "createText", "setSolidFill",
  "set_image_fill", "set_gradient_fill", "set_effects",
  "create_vector", "set_vector_paths", "boolean_group", "group_nodes", "ungroup_node",
  "create_section",
  "set_text_style",
  "create_page", "rename_page", "delete_page", "duplicate_page", "set_current_page", "reorder_page",
  "generate_grid",
  "bulk_rename", "bulk_update", "replace_all_instances",
  "set_variable_mode", "create_variable_mode", "rename_variable_mode", "delete_variable_mode", "rename_variable_collection",
  "subscribe_events", "unsubscribe_events", "sync_target_frames",
  "undo", "redo", "get_style_guide", "get_font_list",
  "distribute_nodes", "arrange_children",
  "import_tokens", "export_tokens",
  "create_typography_scale", "generate_palette", "extract_component_set"
]);

async function handleAction(action, payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Action not allowed: ${action}`);

  await enforceTargetScope(action, p);

  const undoable = UNDOABLE_ACTIONS.has(action) && action !== "undo" && action !== "redo";
  const undoBefore = undoable ? await collectBeforeSnapshotsForAction(action, p) : [];
  const undoIds = undoBefore.map((s) => s.nodeId);

  try {
    const result = await dispatchAction(action, p);
    if (undoable) {
      const afterIds = new Set(undoIds);
      if (result && result.nodeId) afterIds.add(String(result.nodeId));
      if (result && Array.isArray(result.nodeIds)) for (const nid of result.nodeIds) afterIds.add(String(nid));
      const after = await collectNodeSnapshots(Array.from(afterIds));
      recordUndoableEntry(undoLabelFor(action, p), undoBefore, after);
    }
    return result;
  } catch (err) {
    if (undoable && undoBefore.length) {
      // roll back pre-mutation state so a failed action does not leave a half-applied change
      try { await applySnapshotToNodes(undoBefore); } catch (_e) {}
    }
    throw err;
  }
}

async function dispatchAction(action, payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Action not allowed: ${action}`);

  if (/delete|remove|reset|clear/i.test(String(action))) {
    if (
      action !== "delete_node" &&
      action !== "delete_multiple_nodes" &&
      action !== "delete_variable" &&
      action !== "delete_component_property" &&
      action !== "delete_component_slot" &&
      action !== "clear_reactions" &&
      action !== "delete_page" &&
      action !== "delete_variable_mode"
    ) {
      throw new Error(`Blocked action: ${action}`);
    }
  }

  switch (action) {
    case "ping": return { pong: true };

    case "run_batch": return await runBatch(p);
    case "find_and_replace_text": return await findAndReplaceText(p);
    case "get_selection_context": return await getSelectionContext(p);
    case "create_checkpoint": return await createCheckpoint(p);
    case "restore_checkpoint": return await restoreCheckpoint(p);
    case "list_checkpoints": return await listCheckpoints();

    case "get_document_info": case "getDocumentInfo":
      return action === "getDocumentInfo"
        ? { document: { name: figma.root.name, currentPage: { id: figma.currentPage.id, name: figma.currentPage.name } } }
        : await getDocumentInfoFull();

    case "get_selection": case "getSelection":
      return action === "getSelection"
        ? { selection: selectionSummary() }
        : await getSelectionFull();

    case "read_my_design": return await readMyDesign(p);
    case "get_node_info": return await getNodeInfo(p.nodeId, p);
    case "get_nodes_info": return await getNodesInfo(p.nodeIds, p);
    case "get_all_pages": return await getAllPages();
    case "get_document_tree": return await getDocumentTree(p);
    case "get_instance_source": return await getInstanceSource(p);
    case "scan_instances_with_sources": return await scanInstancesWithSources(p);
    case "set_focus": return await setFocus(p);
    case "set_selections": return await setSelections(p);
    case "get_styles": return await getStyles();
    case "get_local_components": return await getLocalComponents(p);
    case "create_component": return await createComponentNode(p);
    case "create_component_from_node": return await createComponentFromNodeAction(p);
    case "combine_as_variants": return await combineAsVariantsAction(p);
    case "set_variant_properties": return await setVariantPropertiesAction(p);
    case "get_component_property_definitions": return await getComponentPropertyDefinitionsAction(p);
    case "add_component_property": return await addComponentPropertyAction(p);
    case "edit_component_property": return await editComponentPropertyAction(p);
    case "delete_component_property": return await deleteComponentPropertyAction(p);
    case "bind_component_property": return await bindComponentPropertyAction(p);
    case "create_component_slot": return await createComponentSlotAction(p);
    case "edit_component_slot": return await editComponentSlotAction(p);
    case "delete_component_slot": return await deleteComponentSlotAction(p);
    case "create_component_instance": return await createComponentInstance(p);
    case "create_instance_from_instance": return await createInstanceFromInstance(p);
    case "import_component_by_key": return await importComponentByKey(p);
    case "import_component_set_by_key": return await importComponentSetByKey(p);
    case "create_instance_from_component_key": return await createInstanceFromComponentKey(p);
    case "create_instance_from_component_set_key": return await createInstanceFromComponentSetKey(p);
    case "get_instance_properties": return await getInstanceProperties(p);
    case "set_instance_properties": return await setInstanceProperties(p);
    case "swap_instance_component": return await swapInstanceComponent(p);
    case "export_node_as_image": return await exportNodeAsImage(p);
    case "scan_text_nodes": return await scanTextNodes(p);
    case "scan_nodes_by_types": return await scanNodesByTypes(p);
    case "create_rectangle": case "createRectangle": return await createRectangleNode(p);
    case "create_frame": case "createFrame": return await createFrameNode(p);
    case "create_text": case "createText": return await createTextNode(p);
    case "set_fill_color": return await setFillColor(p);
    case "set_stroke_color": return await setStrokeColor(p);
    case "move_node": return await moveNode(p);
    case "reparent_node": return await reparentNode(p);
    case "get_parent_chain": return await getParentChain(p);
    case "insert_child": return await insertChild(p);
    case "resize_node": return await resizeNode(p);
    case "delete_node": return await deleteNode(p);
    case "delete_multiple_nodes": return await deleteMultipleNodes(p);
    case "clone_node": return await cloneNode(p);
    case "clone_node_into_parent": return await cloneNodeIntoParent(p);
    case "set_corner_radius": return await setCornerRadius(p);
    case "set_text_content": return await setTextContent(p);
    case "set_multiple_text_contents": return await setMultipleTextContents(p);
    case "set_layout_mode": return await setLayoutMode(p);
    case "set_padding": return await setPadding(p);
    case "set_axis_align": return await setAxisAlign(p);
    case "set_layout_sizing": return await setLayoutSizing(p);
    case "set_item_spacing": return await setItemSpacing(p);
    case "set_auto_layout": return await setAutoLayout(p);
    case "set_layout_grids": return await setLayoutGrids(p);
    case "set_overflow_direction": return await setOverflowDirection(p);
    case "set_fixed_children": return await setFixedChildren(p);
    case "create_paint_style": return await createPaintStyle(p);
    case "create_text_style": return await createTextStyleAction(p);
    case "create_effect_style": return await createEffectStyle(p);
    case "create_grid_style": return await createGridStyle(p);
    case "import_style_by_key": return await importStyleByKey(p);
    case "apply_fill_style": return await applyFillStyle(p);
    case "apply_stroke_style": return await applyStrokeStyle(p);
    case "apply_effect_style": return await applyEffectStyle(p);
    case "apply_text_style": return await applyTextStyle(p);
    case "apply_grid_style": return await applyGridStyle(p);
    case "get_annotations": return await getAnnotations(p);
    case "set_annotation": return await setAnnotation(p);
    case "set_multiple_annotations": return await setMultipleAnnotations(p);
    case "get_reactions": return await getReactions(p);
    case "set_reactions": return await setReactions(p);
    case "clear_reactions": return await clearReactions(p);
    case "upsert_reaction": return await upsertReaction(p);
    case "set_transition_reaction": return await setTransitionReaction(p);
    case "set_smart_animate_reaction": return await setSmartAnimateReaction(p);
    case "get_overlay_settings": return await getOverlaySettings(p);
    case "set_overlay_settings": return await setOverlaySettings(p);
    case "get_prototype_settings": return await getPrototypeSettings();
    case "set_prototype_start_node": return await setPrototypeStartNode(p);
    case "set_flow_starting_points": return await setFlowStartingPoints(p);
    case "get_instance_slots": return await getInstanceSlots(p);
    case "append_to_slot": return await appendToSlot(p);
    case "list_variable_collections": return await listVariableCollections(p);
    case "list_variables": return await listVariables(p);
    case "create_variable_collection": return await createVariableCollection(p);
    case "create_variable": return await createVariable(p);
    case "set_variable_values": return await setVariableValues(p);
    case "rename_variable": return await renameVariable(p);
    case "delete_variable": return await deleteVariable(p);
    case "import_variable_by_key": return await importVariableByKey(p);
    case "bind_color_variable_to_fill": return await bindColorVariableToFill(p);
    case "bind_color_variable_to_stroke": return await bindColorVariableToStroke(p);
    case "bind_variable_to_property": return await bindVariableToProperty(p);
    case "set_node_explicit_variable_mode": return await setNodeExplicitVariableMode(p);

    case "renameNode": {
      const node = await getNodeByIdAsync(String(p.nodeId));
      assertNodeWritable(node, p);
      node.name = p.name === undefined || p.name === null ? "" : String(p.name);
      return { nodeId: node.id, name: node.name };
    }

    case "setText": {
      const nodeId = p.nodeId ? String(p.nodeId) : null;
      const target = nodeId ? await getNodeByIdAsync(nodeId) : figma.currentPage.selection[0];
      if (!target || target.type !== "TEXT") throw new Error("Select a TEXT node or pass nodeId");
      assertNodeWritable(target, p);
      await loadTextFont(target);
      target.characters = p.characters === undefined || p.characters === null ? "" : String(p.characters);
      return { nodeId: target.id, characters: target.characters };
    }

    case "setSolidFill": {
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

    case "set_image_fill": return await setImageFill(p);
    case "set_gradient_fill": return await setGradientFill(p);
    case "set_effects": return await setEffects(p);
    case "create_vector": return await createVector(p);
    case "set_vector_paths": return await setVectorPaths(p);
    case "boolean_group": return await booleanGroup(p);
    case "group_nodes": return await groupNodes(p);
    case "ungroup_node": return await ungroupNode(p);
    case "create_section": return await createSection(p);
    case "set_text_style": return await setTextStyle(p);
    case "create_page": return await createPage(p);
    case "rename_page": return await renamePage(p);
    case "delete_page": return await deletePage(p);
    case "duplicate_page": return await duplicatePage(p);
    case "set_current_page": return await setCurrentPage(p);
    case "reorder_page": return await reorderPage(p);
    case "generate_grid": return await generateGrid(p);
    case "bulk_rename": return await bulkRename(p);
    case "bulk_update": return await bulkUpdate(p);
    case "replace_all_instances": return await replaceAllInstances(p);
    case "set_variable_mode": return await setVariableMode(p);
    case "create_variable_mode": return await createVariableMode(p);
    case "rename_variable_mode": return await renameVariableMode(p);
    case "delete_variable_mode": return await deleteVariableMode(p);
    case "rename_variable_collection": return await renameVariableCollection(p);
    case "subscribe_events": return await subscribeEvents(p);
    case "unsubscribe_events": return await unsubscribeEvents(p);
    case "sync_target_frames": return await syncTargetFrames(p);
    case "undo": return await undoAction();
    case "redo": return await redoAction();
    case "get_style_guide": return await getStyleGuide(p);
    case "get_font_list": return await getFontList(p);
    case "distribute_nodes": return await distributeNodes(p);
    case "arrange_children": return await arrangeChildren(p);
    case "import_tokens": return await importTokens(p);
    case "export_tokens": return await exportTokens(p);
    case "create_typography_scale": return await createTypographyScale(p);
    case "generate_palette": return await generatePalette(p);
    case "extract_component_set": return await extractComponentSet(p);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

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
