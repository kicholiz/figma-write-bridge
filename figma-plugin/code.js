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
  const raw = String(hex).trim().replace(/^#/, "");
  if (raw.length !== 6) throw new Error("Invalid hex color: " + hex);
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
    return host;
  }
  return figma.currentPage;
}

// ---------------------------------------------------------------------------
// Node filtering for export
// ---------------------------------------------------------------------------

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
  const chunkSize = params && params.chunkSize ? Number(params.chunkSize) : 200;
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
// Reactions
// ---------------------------------------------------------------------------

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
  const action = normalizeReactionAction(r.action);
  const out = { trigger, action };
  if (r.transition !== undefined) out.transition = r.transition;
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
    if (!r || !r.trigger || !r.action) continue;
    if (triggerType && String(r.trigger.type) !== triggerType) continue;
    if (actionType && String(r.action.type) !== actionType) continue;
    if (destinationId && String(r.action.destinationId || "") !== destinationId) continue;
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
// Action dispatcher
// ---------------------------------------------------------------------------

const ALLOWED_ACTIONS = new Set([
  "ping",
  "get_document_info", "get_selection", "read_my_design",
  "get_node_info", "get_nodes_info",
  "get_instance_source", "scan_instances_with_sources",
  "set_focus", "set_selections",
  "get_styles",
  "get_local_components",
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
  "get_instance_slots", "append_to_slot",
  "list_variable_collections", "list_variables",
  "create_variable_collection", "create_variable", "set_variable_values",
  "import_variable_by_key",
  "bind_color_variable_to_fill", "bind_color_variable_to_stroke",
  "bind_variable_to_property", "set_node_explicit_variable_mode",
  "getDocumentInfo", "getSelection", "renameNode", "setText",
  "createFrame", "createRectangle", "createText", "setSolidFill"
]);

async function handleAction(action, payload) {
  const p = payload && typeof payload === "object" ? payload : {};

  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Action not allowed: ${action}`);

  if (/delete|remove|reset|clear/i.test(String(action))) {
    if (action !== "delete_node" && action !== "delete_multiple_nodes" && action !== "clear_reactions") {
      throw new Error(`Blocked action: ${action}`);
    }
  }

  switch (action) {
    case "ping": return { pong: true };

    case "get_document_info": case "getDocumentInfo":
      return action === "getDocumentInfo"
        ? { document: { name: figma.root.name, currentPage: { id: figma.currentPage.id, name: figma.currentPage.name } } }
        : await getDocumentInfoFull();

    case "get_selection": case "getSelection":
      return action === "getSelection"
        ? { selection: selectionSummary() }
        : await getSelectionFull();

    case "read_my_design": return await readMyDesign();
    case "get_node_info": return await getNodeInfo(p.nodeId);
    case "get_nodes_info": return await getNodesInfo(p.nodeIds);
    case "get_instance_source": return await getInstanceSource(p);
    case "scan_instances_with_sources": return await scanInstancesWithSources(p);
    case "set_focus": return await setFocus(p);
    case "set_selections": return await setSelections(p);
    case "get_styles": return await getStyles();
    case "get_local_components": return await getLocalComponents(p);
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
    case "get_instance_slots": return await getInstanceSlots(p);
    case "append_to_slot": return await appendToSlot(p);
    case "list_variable_collections": return await listVariableCollections(p);
    case "list_variables": return await listVariables(p);
    case "create_variable_collection": return await createVariableCollection(p);
    case "create_variable": return await createVariable(p);
    case "set_variable_values": return await setVariableValues(p);
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
