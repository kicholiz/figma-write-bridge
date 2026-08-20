import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const wsHost = process.env.FIGMA_BRIDGE_HOST || "127.0.0.1";
const wsPort = Number(process.env.FIGMA_BRIDGE_PORT || "8787");
const commandTimeoutMs = Number(process.env.FIGMA_BRIDGE_TIMEOUT_MS || "180000");
const defaultChannel = normalizeChannelName(process.env.FIGMA_BRIDGE_CHANNEL) || "default";
const transitionTypeSchema = z.enum(["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE", "MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]);
const directionalTransitionTypeSchema = z.enum(["MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"]);
const transitionDirectionSchema = z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM"]);
const easingTypeSchema = z.enum(["EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT", "LINEAR", "EASE_IN_BACK", "EASE_OUT_BACK", "EASE_IN_AND_OUT_BACK", "CUSTOM_CUBIC_BEZIER", "GENTLE", "QUICK", "BOUNCY", "SLOW", "CUSTOM_SPRING"]);
const motionPresetSchema = z.enum(["subtle", "smooth", "quick", "bouncy", "dissolve", "slide_left", "slide_right"]);
const componentPropertyTypeSchema = z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"]);
const instanceSwapPreferredValueSchema = z.object({
  type: z.enum(["COMPONENT", "COMPONENT_SET"]),
  key: z.string()
});

const easingSchema = z.object({
  type: easingTypeSchema,
  easingFunctionCubicBezier: z.object({
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number()
  }).optional(),
  easingFunctionSpring: z.object({
    mass: z.number(),
    stiffness: z.number(),
    damping: z.number(),
    initialVelocity: z.number().optional()
  }).optional()
});

const transitionSchema = z.object({
  type: transitionTypeSchema.optional(),
  direction: transitionDirectionSchema.optional(),
  matchLayers: z.boolean().optional(),
  duration: z.number().nonnegative().optional(),
  easing: z.union([easingTypeSchema, easingSchema]).optional()
});

const motionPresetsCatalog = {
  subtle: {
    label: "Subtle Smart Animate",
    transition: { type: "SMART_ANIMATE", duration: 0.24, easing: { type: "GENTLE" } }
  },
  smooth: {
    label: "Smooth Smart Animate",
    transition: { type: "SMART_ANIMATE", duration: 0.3, easing: { type: "EASE_IN_AND_OUT" } }
  },
  quick: {
    label: "Quick Smart Animate",
    transition: { type: "SMART_ANIMATE", duration: 0.18, easing: { type: "QUICK" } }
  },
  bouncy: {
    label: "Bouncy Smart Animate",
    transition: { type: "SMART_ANIMATE", duration: 0.4, easing: { type: "BOUNCY" } }
  },
  dissolve: {
    label: "Dissolve",
    transition: { type: "DISSOLVE", duration: 0.2, easing: { type: "EASE_OUT" } }
  },
  slide_left: {
    label: "Slide In Left",
    transition: { type: "SLIDE_IN", direction: "LEFT", matchLayers: false, duration: 0.25, easing: { type: "EASE_OUT" } }
  },
  slide_right: {
    label: "Slide In Right",
    transition: { type: "SLIDE_IN", direction: "RIGHT", matchLayers: false, duration: 0.25, easing: { type: "EASE_OUT" } }
  }
};

function getFigmaToken() {
  const token = process.env.FIGMA_TOKEN;
  return typeof token === "string" ? token.trim() : "";
}

function requireFigmaToken() {
  const token = getFigmaToken();
  if (!token) throw new Error("Missing FIGMA_TOKEN environment variable");
  return token;
}

function toQueryString(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    sp.set(String(k), String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function httpGetBuffer(url, remainingRedirects = 5) {
  const u = new URL(url);
  const options = {
    method: "GET",
    protocol: u.protocol,
    hostname: u.hostname,
    path: `${u.pathname}${u.search}`,
    port: u.port ? Number(u.port) : undefined,
    headers: {
      "User-Agent": "figma-write-bridge"
    }
  };

  return await new Promise((resolvePromise, rejectPromise) => {
    const req = httpsRequest(options, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location ? String(res.headers.location) : "";
      if (status >= 300 && status < 400 && location && remainingRedirects > 0) {
        res.resume();
        const nextUrl = location.startsWith("http") ? location : new URL(location, url).toString();
        httpGetBuffer(nextUrl, remainingRedirects - 1).then(resolvePromise, rejectPromise);
        return;
      }

      if (status < 200 || status >= 300) {
        const chunks = [];
        res.on("data", (d) => chunks.push(Buffer.from(d)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          rejectPromise(new Error(`HTTP ${status} for ${url}${body ? `: ${body}` : ""}`));
        });
        return;
      }

      const chunks = [];
      res.on("data", (d) => chunks.push(Buffer.from(d)));
      res.on("end", () => resolvePromise(Buffer.concat(chunks)));
    });
    req.on("error", rejectPromise);
    req.end();
  });
}

async function figmaApiJson(pathname, query, method, body) {
  const token = requireFigmaToken();
  const urlPath = `${pathname}${toQueryString(query)}`;
  const httpMethod = typeof method === "string" && method.trim() ? String(method).toUpperCase() : "GET";
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body), "utf8") : undefined;
  const headers = {
    "X-Figma-Token": token
  };
  if (payload) headers["Content-Type"] = "application/json";
  if (payload) headers["Content-Length"] = String(payload.length);

  const options = {
    method: httpMethod,
    hostname: "api.figma.com",
    path: urlPath,
    headers
  };

  const bodyOut = await new Promise((resolvePromise, rejectPromise) => {
    const req = httpsRequest(options, (res) => {
      const status = res.statusCode || 0;
      const chunks = [];
      res.on("data", (d) => chunks.push(Buffer.from(d)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          rejectPromise(new Error(`Figma API HTTP ${status} for ${urlPath}${raw ? `: ${raw}` : ""}`));
          return;
        }
        if (!raw) {
          resolvePromise(null);
          return;
        }
        try {
          resolvePromise(JSON.parse(raw));
        } catch {
          rejectPromise(new Error(`Invalid JSON from Figma API for ${urlPath}`));
        }
      });
    });
    req.on("error", rejectPromise);
    if (payload) req.end(payload);
    else req.end();
  });

  return bodyOut;
}

function resolveSafeOutputDir(localPath) {
  const raw = typeof localPath === "string" ? localPath.trim() : "";
  if (!raw) throw new Error("Missing localPath");
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(repoRoot, raw);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("localPath must be inside the figma-write-bridge repo");
  return abs;
}

function resolveInputPath(localPath) {
  const raw = typeof localPath === "string" ? localPath.trim() : "";
  if (!raw) throw new Error("Missing localPath");
  return isAbsolute(raw) ? resolve(raw) : resolve(repoRoot, raw);
}

async function readLocalFileAsBase64(localPath) {
  const abs = resolveInputPath(localPath);
  const buf = await readFile(abs);
  return buf.toString("base64");
}

const argv = process.argv.slice(2);
const standalone = argv.includes("--standalone") || process.env.FIGMA_BRIDGE_STANDALONE === "1";
const onceCreateFrame =
  argv.includes("--once-create-frame") ||
  argv.includes("--once-create-rect") ||
  argv.includes("--once-create-rectangle");

function readStringArg(name, fallback) {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  const value = argv[idx + 1];
  if (value === undefined) return fallback;
  return String(value);
}

function readNumberArg(name, fallback) {
  const idx = argv.indexOf(name);
  if (idx < 0) return fallback;
  const raw = argv[idx + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/health/")) {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        name: "figma-write-bridge",
        version: "0.1.0",
        wsUrl: `ws://${wsHost}:${wsPort}`,
        host: wsHost,
        port: wsPort,
        channel: defaultChannel,
        activeChannel,
        connectedChannels: connectedChannelsInfo()
      })
    );
    return;
  }
  res.statusCode = 404;
  res.end();
});

httpServer.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `[figma-write-bridge] Cannot bind WebSocket server to ${wsHost}:${wsPort}: port already in use.\n` +
        `Another figma-write-bridge instance is already running there. Stop it, or start this MCP server with a ` +
        `different FIGMA_BRIDGE_PORT and configure the plugin UI to the matching host:port (and channel).`
    );
    process.exit(1);
  }
  console.error(err?.stack ?? String(err));
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(wsPort, wsHost);

const channels = new Map();
const socketToChannel = new Map();
const socketMeta = new Map();
const unclaimedSockets = new Set();
const clientSockets = new Set();
let activeChannel = defaultChannel;
const targetFrameIds = new Set();
const pending = new Map();
let onceRan = false;

function clearPendingForSocket(socket) {
  for (const [id, entry] of pending.entries()) {
    if (entry.socket === socket) {
      clearTimeout(entry.timeout);
      pending.delete(id);
      entry.reject(new Error("Figma connection closed"));
    }
  }
}

function isOpenSocket(socket) {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function normalizeChannelName(name) {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw || raw.length > 64) return null;
  if (/[^A-Za-z0-9._-]/.test(raw)) return null;
  return raw;
}

function connectedChannelsInfo() {
  const out = [];
  for (const [name, socket] of channels.entries()) {
    if (!isOpenSocket(socket)) continue;
    const meta = socketMeta.get(socket) || {};
    out.push({ channel: name, fileKey: meta.fileKey || null, fileName: meta.fileName || null });
  }
  return out;
}

function markSocketRole(socket, role) {
  const prev = socketMeta.get(socket) || {};
  const connectedAt = prev.connectedAt ?? Date.now();
  socketMeta.set(socket, {
    connectedAt,
    role: String(role),
    fileKey: prev.fileKey || null,
    fileName: prev.fileName || null
  });
}

function getFallbackSocket() {
  const candidates = [];
  for (const socket of unclaimedSockets) {
    if (!isOpenSocket(socket)) continue;
    if (clientSockets.has(socket)) continue;
    const meta = socketMeta.get(socket);
    candidates.push({ socket, connectedAt: meta?.connectedAt ?? 0 });
  }
  candidates.sort((a, b) => b.connectedAt - a.connectedAt);
  return candidates.length ? candidates[0].socket : null;
}

function getActiveSocket() {
  const socket = channels.get(activeChannel);
  if (isOpenSocket(socket)) return socket;
  return getFallbackSocket();
}

function getSocketForChannel(channelName) {
  const name = typeof channelName === "string" && channelName.trim() ? channelName.trim() : activeChannel;
  const socket = channels.get(name);
  if (isOpenSocket(socket)) return socket;
  return getActiveSocket();
}

function sendTargetFramesSync(socket) {
  const s = socket || getActiveSocket();
  if (!isOpenSocket(s)) return;
  try {
    s.send(
      JSON.stringify({
        type: "command",
        id: randomUUID(),
        action: "sync_target_frames",
        payload: { targetFrameIds: Array.from(targetFrameIds) }
      })
    );
  } catch {}
}

let changeSeq = 0;
const CHANGE_LOG_MAX = 500;
const changeLog = [];

let eventSeq = 0;
const EVENT_LOG_MAX = 300;
const eventLog = [];

function extractChangedIds(result) {
  if (!result || typeof result !== "object") return [];
  const ids = new Set();
  const scalarKeys = [
    "nodeId", "componentId", "componentSetId", "instanceId", "slotNodeId",
    "variableId", "collectionId", "pageId", "parentId", "childId"
  ];
  for (const k of scalarKeys) if (result[k]) ids.add(String(result[k]));
  const idArrayKeys = ["nodeIds", "deletedNodeIds", "movedNodeIds", "changedNodeIds"];
  for (const k of idArrayKeys) {
    if (Array.isArray(result[k])) for (const v of result[k]) ids.add(String(v));
  }
  const objectArrayKeys = ["changes", "nodes", "results"];
  for (const k of objectArrayKeys) {
    if (Array.isArray(result[k])) {
      for (const entry of result[k]) {
        if (entry && typeof entry === "object" && entry.nodeId) ids.add(String(entry.nodeId));
      }
    }
  }
  return Array.from(ids);
}

function recordChange(action, result) {
  if (action === "run_batch" && result && Array.isArray(result.results)) {
    for (const item of result.results) {
      if (!item || !item.success) continue;
      changeSeq += 1;
      changeLog.push({ seq: changeSeq, action: item.action, nodeIds: extractChangedIds(item.result), timestamp: Date.now() });
    }
  } else {
    changeSeq += 1;
    changeLog.push({ seq: changeSeq, action, nodeIds: extractChangedIds(result), timestamp: Date.now() });
  }
  if (changeLog.length > CHANGE_LOG_MAX) changeLog.splice(0, changeLog.length - CHANGE_LOG_MAX);
}

const READ_ONLY_ACTION_RE = /^(ping|get_|list_|scan_|export_|read_)/;
const NON_MUTATING_ACTIONS = new Set([
  "create_checkpoint",
  "subscribe_events",
  "unsubscribe_events"
]);

function sendCommand(action, payload, socketOverride) {
  const socket = socketOverride || getActiveSocket();
  if (!socket) {
    throw new Error("Figma plugin not connected");
  }

  const actionName = String(action || "");
  if (!socketOverride) {
    if (!actionName) throw new Error("Missing action");
    if (/delete|remove|reset|clear/i.test(actionName)) {
      if (
        actionName !== "delete_node" &&
        actionName !== "delete_multiple_nodes" &&
        actionName !== "delete_component_property" &&
        actionName !== "delete_component_slot" &&
        actionName !== "delete_variable" &&
        actionName !== "clear_reactions" &&
        actionName !== "delete_page" &&
        actionName !== "delete_variable_mode"
      ) {
        throw new Error(`Blocked action: ${actionName}`);
      }
    }
  }

  const id = randomUUID();

  const timeout = setTimeout(() => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.reject(new Error(`Timed out waiting for Figma response (${commandTimeoutMs}ms)`));
  }, commandTimeoutMs);

  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, timeout, socket });
  });

  try {
    socket.send(JSON.stringify({ type: "command", id, action, payload }));
  } catch (err) {
    clearTimeout(timeout);
    pending.delete(id);
    throw err;
  }

  if (socketOverride || READ_ONLY_ACTION_RE.test(actionName) || NON_MUTATING_ACTIONS.has(actionName)) return promise;

  return promise.then((result) => {
    recordChange(actionName, result);
    return result;
  });
}

wss.on("connection", (socket) => {
  socketToChannel.set(socket, null);
  socketMeta.set(socket, { connectedAt: Date.now(), role: "unknown" });
  unclaimedSockets.add(socket);

  socket.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "join") {
      let channel = defaultChannel;
      if (msg.channel !== undefined && msg.channel !== null && String(msg.channel).trim() !== "") {
        const normalized = normalizeChannelName(String(msg.channel));
        if (!normalized) {
          try {
            socket.send(JSON.stringify({ type: "system", message: "Invalid channel name: must be 1-64 chars of A-Z a-z 0-9 . _ -" }));
          } catch {}
          return;
        }
        channel = normalized;
      }
      const prev = socketToChannel.get(socket);
      if (prev && channels.get(prev) === socket) channels.delete(prev);
      socketToChannel.set(socket, channel);
      channels.set(channel, socket);
      markSocketRole(socket, "plugin");
      const meta = socketMeta.get(socket) || {};
      meta.fileKey = typeof msg.fileKey === "string" && msg.fileKey ? String(msg.fileKey) : null;
      meta.fileName = typeof msg.fileName === "string" && msg.fileName ? String(msg.fileName) : null;
      socketMeta.set(socket, meta);
      clientSockets.delete(socket);
      unclaimedSockets.delete(socket);
      if (!activeChannel) activeChannel = channel;
      try {
        socket.send(JSON.stringify({ type: "system", channel, message: `Joined channel: ${channel}` }));
      } catch {}
      if (targetFrameIds.size > 0) sendTargetFramesSync(socket);
      return;
    }

    if (msg.type === "set_active_channel") {
      markSocketRole(socket, "client");
      clientSockets.add(socket);
      unclaimedSockets.delete(socket);
      let channel = defaultChannel;
      if (msg.channel !== undefined && msg.channel !== null && String(msg.channel).trim() !== "") {
        const normalized = normalizeChannelName(String(msg.channel));
        if (!normalized) {
          try {
            socket.send(JSON.stringify({ type: "system", message: "Invalid channel name: must be 1-64 chars of A-Z a-z 0-9 . _ -" }));
          } catch {}
          return;
        }
        channel = normalized;
      }
      activeChannel = channel;
      try {
        socket.send(JSON.stringify({ type: "system", channel, message: `Active channel: ${channel}` }));
      } catch {}
      return;
    }

    if (msg.type === "control" && typeof msg.id === "string" && typeof msg.action === "string") {
      markSocketRole(socket, "client");
      clientSockets.add(socket);
      unclaimedSockets.delete(socket);
      const reply = async () => {
        try {
          const pluginSocket = getSocketForChannel(msg.channel);
          if (!pluginSocket) throw new Error("Figma plugin not connected");
          const result = await sendCommand(msg.action, msg.payload || {}, pluginSocket);
          socket.send(JSON.stringify({ type: "control_result", id: msg.id, ok: true, result }));
        } catch (err) {
          socket.send(
            JSON.stringify({
              type: "control_result",
              id: msg.id,
              ok: false,
              error: err?.message ?? String(err)
            })
          );
        }
      };
      reply();
      return;
    }

    if (msg.type === "status" && typeof msg.id === "string") {
      markSocketRole(socket, "client");
      clientSockets.add(socket);
      unclaimedSockets.delete(socket);
      try {
        socket.send(
          JSON.stringify({
            type: "status_result",
            id: msg.id,
            ok: true,
            result: {
              wsUrl: `ws://${wsHost}:${wsPort}`,
              activeChannel,
              connectedChannels: connectedChannelsInfo().map((c) => c.channel),
              channels: connectedChannelsInfo()
            }
          })
        );
      } catch {}
      return;
    }

    if (msg.type === "update_target_frames") {
      const ids = Array.isArray(msg.targetFrameIds) ? msg.targetFrameIds.map(String) : [];
      targetFrameIds.clear();
      for (const id of ids) targetFrameIds.add(id);
      return;
    }

    if (msg.type === "event") {
      eventSeq += 1;
      const name = typeof msg.name === "string" && msg.name ? String(msg.name) : "unknown";
      eventLog.push({
        seq: eventSeq,
        name,
        channel: typeof msg.channel === "string" ? msg.channel : socketToChannel.get(socket) || null,
        payload: msg.payload !== undefined ? msg.payload : null,
        timestamp: Date.now()
      });
      if (eventLog.length > EVENT_LOG_MAX) eventLog.splice(0, eventLog.length - EVENT_LOG_MAX);
      return;
    }

    if (msg.type !== "result" || typeof msg.id !== "string") return;

    markSocketRole(socket, "plugin");
    clientSockets.delete(socket);
    if (socketToChannel.get(socket) === null) {
      const existing = channels.get(defaultChannel);
      if (!isOpenSocket(existing) || existing === socket || clientSockets.has(existing)) {
        socketToChannel.set(socket, defaultChannel);
        channels.set(defaultChannel, socket);
      }
    }
    unclaimedSockets.delete(socket);

    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timeout);

    if (msg.ok) {
      entry.resolve(msg.result);
      return;
    }

    entry.reject(new Error(msg.error || "Unknown error from Figma"));
  });

  socket.on("close", () => {
    const channel = socketToChannel.get(socket);
    if (channel && channels.get(channel) === socket) channels.delete(channel);
    socketToChannel.delete(socket);
    socketMeta.delete(socket);
    unclaimedSockets.delete(socket);
    clientSockets.delete(socket);
    clearPendingForSocket(socket);
  });

  if (onceCreateFrame && !onceRan) {
    onceRan = true;
    const payload = {
      name: readStringArg("--name", "Rectangle"),
      x: readNumberArg("--x", 100),
      y: readNumberArg("--y", 100),
      width: readNumberArg("--width", 240),
      height: readNumberArg("--height", 160)
    };

    (async () => {
      try {
        const created = await sendCommand("createFrame", payload, socket);
        if (created && typeof created.nodeId === "string") {
          await sendCommand("setSolidFill", { nodeId: created.nodeId, r: 0.9, g: 0.9, b: 0.9, opacity: 1 }, socket);
        }
        console.log(JSON.stringify({ ok: true, created }, null, 2));
        socket.close();
        httpServer.close(() => process.exit(0));
      } catch (err) {
        console.error(err?.stack ?? String(err));
        try {
          socket.close();
        } catch {}
        httpServer.close(() => process.exit(1));
      }
    })();
  }
});

const server = new McpServer({
  name: "figma-write-bridge",
  version: "0.1.0"
});

const ALLOWED_MCP_TOOLS = new Set([
  "figma_bridge_status",
  "join_channel",
  "get_figma_data",
  "download_figma_images",
  "set_target_frame",
  "get_target_frames",
  "clear_target_frames",
  "rename_node",
  "get_document_info",
  "get_all_pages",
  "get_document_tree",
  "get_selection",
  "get_node_info",
  "get_nodes_info",
  "get_selection_context",
  "get_changes_since",
  "run_batch",
  "create_checkpoint",
  "restore_checkpoint",
  "list_checkpoints",
  "find_and_replace_text",
  "get_instance_source",
  "scan_instances_with_sources",
  "import_component_by_key",
  "import_component_set_by_key",
  "create_instance_from_component_key",
  "create_instance_from_set_key",
  "get_instance_properties",
  "set_instance_properties",
  "swap_instance_component",
  "get_styles",
  "create_paint_style",
  "create_text_style",
  "create_effect_style",
  "create_grid_style",
  "import_style_by_key",
  "apply_fill_style",
  "apply_stroke_style",
  "apply_text_style",
  "apply_effect_style",
  "apply_grid_style",
  "set_layout_grids",
  "get_local_components",
  "create_component",
  "create_component_from_node",
  "combine_as_variants",
  "set_variant_properties",
  "get_component_property_definitions",
  "add_component_property",
  "edit_component_property",
  "delete_component_property",
  "bind_component_property",
  "create_component_slot",
  "edit_component_slot",
  "delete_component_slot",
  "create_component_instance",
  "export_node_as_image",
  "scan_text_nodes",
  "scan_nodes_by_types",
  "find_nodes",
  "get_annotations",
  "set_annotation",
  "set_multiple_annotations",
  "create_rectangle",
  "create_frame",
  "create_text",
  "set_fill_color",
  "set_stroke_color",
  "move_node",
  "reparent_node",
  "get_parent_chain",
  "insert_child",
  "resize_node",
  "resize_to_fit",
  "clone_node",
  "clone_node_into_parent",
  "move_node_to_page",
  "move_component_to_file",
  "delete_node",
  "delete_multiple_nodes",
  "set_corner_radius",
  "set_text_content",
  "set_multiple_text_contents",
  "get_reactions",
  "set_reactions",
  "clear_reactions",
  "upsert_reaction",
  "set_transition_reaction",
  "set_smart_animate_reaction",
  "get_animation_presets",
  "get_overlay_settings",
  "set_overlay_settings",
  "get_prototype_settings",
  "set_prototype_start_node",
  "set_flow_starting_points",
  "set_overflow_direction",
  "set_fixed_children",
  "list_variable_collections",
  "list_variables",
  "get_variable",
  "create_variable_collection",
  "create_variable",
  "set_variable_values",
  "rename_variable",
  "delete_variable",
  "import_variable_by_key",
  "bind_color_variable_to_fill",
  "bind_color_variable_to_stroke",
  "bind_variable_to_property",
  "set_node_explicit_variable_mode",
  "get_instance_slots",
  "append_to_slot",
  "set_auto_layout",
  "set_layout_mode",
  "set_padding",
  "set_axis_align",
  "set_layout_sizing",
  "set_item_spacing",
  "set_focus",
  "set_selections",
  "read_my_design",
  "figma_set_text",
  "figma_set_solid_fill",
  "set_image_fill",
  "set_gradient_fill",
  "set_effects",
  "create_vector",
  "set_vector_paths",
  "boolean_group",
  "group_nodes",
  "ungroup_node",
  "create_section",
  "set_section_properties",
  "set_text_style",
  "create_page",
  "rename_page",
  "delete_page",
  "duplicate_page",
  "set_current_page",
  "reorder_page",
  "generate_grid",
  "bulk_rename",
  "bulk_update",
  "replace_all_instances",
  "set_variable_mode",
  "create_variable_mode",
  "rename_variable_mode",
  "delete_variable_mode",
  "rename_variable_collection",
  "delete_variable_collection",
  "subscribe_events",
  "unsubscribe_events",
  "get_events",
  "list_channels",
  "list_comments",
  "post_comment",
  "delete_comment",
  "export_frames_to_disk",
  "undo",
  "redo",
  "get_style_guide",
  "get_font_list",
  "distribute_nodes",
  "arrange_children",
  "import_tokens",
  "export_tokens",
  "create_typography_scale",
  "generate_palette",
  "extract_component_set",
  "search_components"
]);

const MAX_RESULT_BYTES = Number(process.env.FIGMA_BRIDGE_MAX_RESULT_BYTES || "50000");

// Catalog-enumeration tools must arrive whole: the workflow enumerates every
// variable/style/component (and dumps tokens), so capping them would silently
// drop part of the catalog and hand the agent an incomplete file overview.
const NO_TRUNCATE_TOOLS = new Set([
  "list_variables",
  "list_variable_collections",
  "export_tokens",
  "get_styles",
  "get_local_components"
]);

function tryParseJson(text) {
  try { return JSON.parse(text); } catch (_err) { return undefined; }
}

function clampJsonToBudget(node, budget) {
  const size = (n) => Buffer.byteLength(JSON.stringify(n), "utf8");
  if (size(node) <= budget) return { node, truncated: false };
  if (Array.isArray(node)) {
    let arr = node;
    while (arr.length > 1 && size(arr) > budget) {
      arr = arr.slice(0, Math.max(1, Math.floor(arr.length / 2)));
    }
    return { node: arr, truncated: true };
  }
  if (node && typeof node === "object") {
    const arrayKeys = Object.keys(node).filter((k) => Array.isArray(node[k]) && node[k].length > 0);
    if (!arrayKeys.length) return { node, truncated: false };
    const clone = { ...node };
    let truncated = false;
    for (const k of arrayKeys) {
      const res = clampJsonToBudget(clone[k], Math.max(1, Math.floor(budget / arrayKeys.length)));
      clone[k] = res.node;
      truncated = truncated || res.truncated;
    }
    return { node: clone, truncated };
  }
  return { node, truncated: false };
}

function truncateResultText(text) {
  if (Buffer.byteLength(text, "utf8") <= MAX_RESULT_BYTES) return text;
  const parsed = tryParseJson(text);
  if (parsed !== undefined) {
    const clamped = clampJsonToBudget(parsed, MAX_RESULT_BYTES);
    const out = clamped.node;
    if (out && typeof out === "object" && !Array.isArray(out)) {
      out.truncated = true;
      out.truncatedNote = `Result exceeded ${MAX_RESULT_BYTES} bytes; largest arrays trimmed. Narrow the query or raise FIGMA_BRIDGE_MAX_RESULT_BYTES.`;
    }
    return JSON.stringify(out);
  }
  let slice = String(text).slice(0, MAX_RESULT_BYTES);
  while (Buffer.byteLength(slice, "utf8") > MAX_RESULT_BYTES) slice = slice.slice(0, slice.length - 100);
  return slice + `\n\n[TRUNCATED: result exceeded ${MAX_RESULT_BYTES} bytes; raise FIGMA_BRIDGE_MAX_RESULT_BYTES or narrow the query]`;
}

function toColumnar(items) {
  if (!Array.isArray(items)) return null;
  const fields = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    for (const key of Object.keys(item)) {
      if (item[key] === undefined || seen.has(key)) continue;
      seen.add(key);
      fields.push(key);
    }
  }
  return {
    fields,
    rows: items.map((item) => fields.map((field) => (item[field] === undefined ? null : item[field])))
  };
}

function flattenCompactTree(node, depth, out) {
  if (!node || typeof node !== "object") return out;
  const { children, ...rest } = node;
  out.push({ depth, ...rest });
  if (Array.isArray(children)) {
    for (const child of children) flattenCompactTree(child, depth + 1, out);
  }
  return out;
}

function slimToolListPayload(message) {
  const tools = message && message.result && message.result.tools;
  if (!Array.isArray(tools)) return message;
  const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    ...message,
    result: {
      ...message.result,
      tools: tools.map((tool) => {
        const slim = { ...tool };
        if (slim.title && normalize(slim.title) === normalize(slim.name)) delete slim.title;
        if (slim.inputSchema && typeof slim.inputSchema === "object" && "$schema" in slim.inputSchema) {
          const { $schema, ...rest } = slim.inputSchema;
          slim.inputSchema = rest;
        }
        return slim;
      })
    }
  };
}

{
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name, meta, handler) => {
    if (!ALLOWED_MCP_TOOLS.has(String(name))) return;
    const skipTruncate = NO_TRUNCATE_TOOLS.has(String(name));
    return originalRegisterTool(name, meta, async (...args) => {
      const result = await handler(...args);
      if (result && Array.isArray(result.content)) {
        return {
          ...result,
          content: result.content.map((c) => {
            if (c && c.type === "text" && typeof c.text === "string") {
              return { ...c, text: skipTruncate ? c.text : truncateResultText(c.text) };
            }
            return c;
          })
        };
      }
      return result;
    });
  };
}

server.registerTool(
  "figma_bridge_status",
  {
    title: "Figma bridge status",
    description: "Returns whether the local Figma plugin is connected, the active channel, and every connected channel with the Figma file it belongs to. The channel defaults to \"default\" and is tied to this server's FIGMA_BRIDGE_CHANNEL; the plugin UI joins that channel (one plugin = one channel/server)."
  },
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            wsUrl: `ws://${wsHost}:${wsPort}`,
            activeChannel,
            connected: Boolean(getActiveSocket()),
            connectedChannels: connectedChannelsInfo().map((c) => c.channel),
            channels: connectedChannelsInfo()
          }
        )
      }
    ]
  })
);

server.registerTool(
  "join_channel",
  {
    title: "Join channel",
    description: "Selects which connected Figma plugin channel to target for subsequent commands. Channels default to \"default\" and are configured per MCP server via FIGMA_BRIDGE_CHANNEL; the plugin UI joins that channel. Use figma_bridge_status to see which channel maps to which file.",
    inputSchema: {
      channel: z.string()
    }
  },
  async ({ channel }) => {
    activeChannel = String(channel || "").trim() || defaultChannel;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              activeChannel,
              connected: Boolean(getActiveSocket())
            }
          )
        }
      ]
    };
  }
);

server.registerTool(
  "get_figma_data",
  {
    title: "Get Figma data",
    description: "Get Figma file data via the REST API. Pass nodeId to fetch only that node (avoids pulling the whole file). depth limits recursion on file/nodes. Returns file (or nodes), plus styles/components/component_sets when no nodeId is given.",
    inputSchema: {
      fileKey: z.string(),
      nodeId: z.string().optional(),
      depth: z.number().optional()
    }
  },
  async ({ fileKey, nodeId, depth }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    const depthValue = typeof depth === "number" && Number.isFinite(depth) ? depth : undefined;
    const depthArg = depthValue !== undefined ? { depth: depthValue } : undefined;

    const nodeIdValue = typeof nodeId === "string" && nodeId.trim() ? nodeId.trim() : "";

    if (nodeIdValue) {
      const nodes = await figmaApiJson(
        `/v1/files/${key}/nodes`,
        Object.assign({ ids: nodeIdValue }, depthArg || {})
      );
      return { content: [{ type: "text", text: JSON.stringify({ nodes }) }] };
    }

    const [file, styles, components, componentSets] = await Promise.all([
      figmaApiJson(`/v1/files/${key}`, depthArg),
      figmaApiJson(`/v1/files/${key}/styles`, {}),
      figmaApiJson(`/v1/files/${key}/components`, {}),
      figmaApiJson(`/v1/files/${key}/component_sets`, {})
    ]);

    return { content: [{ type: "text", text: JSON.stringify({ file, styles, components, componentSets }) }] };
  }
);

server.registerTool(
  "download_figma_images",
  {
    title: "Download Figma images",
    description: "Download SVG/PNG/GIF images used in a Figma file via the Figma REST API.",
    inputSchema: {
      fileKey: z.string(),
      nodes: z.array(
        z.object({
          nodeId: z.string(),
          imageRef: z.string().optional(),
          gifRef: z.string().optional(),
          fileName: z.string(),
          needsCropping: z.boolean().optional(),
          cropTransform: z.array(z.array(z.number())).optional(),
          requiresImageDimensions: z.boolean().optional(),
          filenameSuffix: z.string().optional()
        })
      ),
      pngScale: z.number().optional(),
      localPath: z.string()
    }
  },
  async ({ fileKey, nodes, pngScale, localPath }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    const outDir = resolveSafeOutputDir(localPath);
    await mkdir(outDir, { recursive: true });

    const scaleValue =
      typeof pngScale === "number" && Number.isFinite(pngScale) && pngScale > 0 ? pngScale : 2;

    const imagesIndex = await figmaApiJson(`/v1/files/${key}/images`, {});
    const imageUrls =
      (imagesIndex && imagesIndex.meta && imagesIndex.meta.images) ||
      (imagesIndex && imagesIndex.images) ||
      {};

    const downloaded = [];
    const errors = [];

    for (const entry of Array.isArray(nodes) ? nodes : []) {
      const nodeId = entry && entry.nodeId ? String(entry.nodeId) : "";
      const fileName = entry && entry.fileName ? String(entry.fileName) : "";
      if (!nodeId || !fileName) {
        errors.push({ nodeId, fileName, error: "Missing nodeId/fileName" });
        continue;
      }

      const absFilePath = resolve(outDir, fileName);
      const rel = relative(outDir, absFilePath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        errors.push({ nodeId, fileName, error: "fileName escapes localPath" });
        continue;
      }

      const ext = extname(fileName).toLowerCase();
      let url = "";
      let method = "";

      try {
        if (ext === ".gif") {
          const ref = entry && entry.gifRef ? String(entry.gifRef) : "";
          url = ref ? String(imageUrls[ref] || "") : "";
          method = "gifRef";
          if (!url) throw new Error("Missing gifRef URL");
        } else if (entry && entry.needsCropping === true) {
          const exportData = await figmaApiJson(`/v1/images/${key}`, {
            ids: nodeId,
            format: "png",
            scale: scaleValue
          });
          url = exportData && exportData.images ? String(exportData.images[nodeId] || "") : "";
          method = "node-export";
          if (!url) throw new Error("Missing export URL");
        } else if (entry && entry.imageRef) {
          const ref = String(entry.imageRef);
          url = String(imageUrls[ref] || "");
          method = "imageRef";
          if (!url) {
            const fmt = ext === ".svg" ? "svg" : "png";
            const exportData = await figmaApiJson(`/v1/images/${key}`, {
              ids: nodeId,
              format: fmt,
              scale: fmt === "png" ? scaleValue : undefined
            });
            url = exportData && exportData.images ? String(exportData.images[nodeId] || "") : "";
            method = "node-export";
          }
          if (!url) throw new Error("Missing imageRef/export URL");
        } else {
          const fmt = ext === ".svg" ? "svg" : "png";
          const exportData = await figmaApiJson(`/v1/images/${key}`, {
            ids: nodeId,
            format: fmt,
            scale: fmt === "png" ? scaleValue : undefined
          });
          url = exportData && exportData.images ? String(exportData.images[nodeId] || "") : "";
          method = "node-export";
          if (!url) throw new Error("Missing export URL");
        }

        const buf = await httpGetBuffer(url);
        await writeFile(absFilePath, buf);
        downloaded.push({ nodeId, fileName, savedPath: absFilePath, method });
      } catch (e) {
        errors.push({ nodeId, fileName, url, method, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ outDir, downloaded, errors })
        }
      ]
    };
  }
);

server.registerTool(
  "rename_node",
  {
    title: "Rename node",
    description: "Renames a node by nodeId.",
    inputSchema: {
      nodeId: z.string(),
      name: z.string()
    }
  },
  async ({ nodeId, name }) => {
    const result = await sendCommand("renameNode", { nodeId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_target_frame",
  {
    title: "Set target frame",
    description: "Sets the target frame(s) that the agent is allowed to modify.",
    inputSchema: {
      frameId: z.string().optional(),
      frameIds: z.array(z.string()).optional()
    }
  },
  async ({ frameId, frameIds }) => {
    const next = [];
    if (typeof frameId === "string" && frameId.trim()) next.push(frameId.trim());
    if (Array.isArray(frameIds)) {
      for (const id of frameIds) {
        if (typeof id === "string" && id.trim()) next.push(id.trim());
      }
    }
    if (!next.length) throw new Error("Missing frameId/frameIds");
    targetFrameIds.clear();
    for (const id of next) targetFrameIds.add(id);
    sendTargetFramesSync();
    return { content: [{ type: "text", text: JSON.stringify({ targetFrameIds: Array.from(targetFrameIds), synced: true }) }] };
  }
);

server.registerTool(
  "get_target_frames",
  {
    title: "Get target frames",
    description: "Returns the current target frameIds the agent is allowed to modify."
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ targetFrameIds: Array.from(targetFrameIds) }) }]
  })
);

server.registerTool(
  "clear_target_frames",
  {
    title: "Clear target frames",
    description: "Clears the active target frameIds."
  },
  async () => {
    targetFrameIds.clear();
    sendTargetFramesSync();
    return { content: [{ type: "text", text: JSON.stringify({ targetFrameIds: [], synced: true }) }] };
  }
);

function normalize01(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return value > 1 ? Math.max(0, Math.min(1, value / 255)) : 1;
  return value;
}

server.registerTool(
  "get_document_info",
  {
    title: "Get document info",
    description: "Get information about the current Figma document."
  },
  async () => {
    const result = await sendCommand("get_document_info", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_all_pages",
  {
    title: "Get all pages",
    description: "Compact map of every page in the open file: id/name/childCount. Pass includeTopLevel: true to also list each page's top-level frames (id/name/type/childCount). Use this once to get a full-file overview before targeted reads.",
    inputSchema: {
      includeTopLevel: z.boolean().optional().describe("Include each page's top-level frames. Default false to keep output small.")
    }
  },
  async ({ includeTopLevel }) => {
    const result = await sendCommand("get_all_pages", { includeTopLevel });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_document_tree",
  {
    title: "Get document tree",
    description: "Compact structural tree of the whole document (or a subtree) for full-context reads. Returns a flattened columnar table: fields lists the column names, rows holds one array per node in pre-order, and the depth column gives nesting level (depth 0 is the root, each +1 is a child of the nearest preceding row with depth-1). Every node is {id, name, type}; no extra fields unless requested. Default maxDepth is 3 (bounded output); pass a larger maxDepth for deeper expansion and fields: [\"characters\"] to include TEXT content. Options: rootNodeId (default whole file), maxDepth, excludeTypes (e.g. [\"VECTOR\"]), fields (extra per-node fields: characters, fills, strokes, absoluteBoundingBox, strokeWeight, cornerRadius, fillStyleId, strokeStyleId, textStyleId, layoutMode, itemSpacing, padding, visible, opacity), includeHidden (default true), verbose (return the original nested tree instead).",
    inputSchema: {
      rootNodeId: z.string().optional(),
      maxDepth: z.number().int().min(0).optional().describe("Levels of children to expand. Default 3. Omit for compact overview."),
      excludeTypes: z.array(z.string()).optional(),
      fields: z.array(z.string()).optional().describe("Extra per-node fields. Add \"characters\" to include TEXT content."),
      includeHidden: z.boolean().optional(),
      verbose: z.boolean().optional().describe("Return the nested {..., children:[...]} tree instead of the flattened columnar table.")
    }
  },
  async ({ rootNodeId, maxDepth, excludeTypes, fields, includeHidden, verbose }) => {
    const result = await sendCommand("get_document_tree", { rootNodeId, maxDepth, excludeTypes, fields, includeHidden });
    if (verbose || !result || !result.tree) {
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const { tree, ...rest } = result;
    const columnar = toColumnar(flattenCompactTree(tree, 0, []));
    const payload = columnar ? { ...rest, ...columnar } : result;
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

server.registerTool(
  "get_selection",
  {
    title: "Get selection",
    description: "Get information about the current selection."
  },
  async () => {
    const result = await sendCommand("get_selection", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_rectangle",
  {
    title: "Create rectangle",
    description: "Create a new rectangle with position, size, and optional name.",
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ name, x, y, width, height }) => {
    const result = await sendCommand("create_rectangle", { name, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_frame",
  {
    title: "Create frame",
    description: "Create a new frame with position, size, and optional name.",
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ name, x, y, width, height }) => {
    const result = await sendCommand("create_frame", { name, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_text",
  {
    title: "Create text",
    description: "Create a new text node.",
    inputSchema: {
      characters: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      fontSize: z.number().optional()
    }
  },
  async ({ characters, name, x, y, fontSize }) => {
    const result = await sendCommand("create_text", { characters, name, x, y, fontSize });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_fill_color",
  {
    title: "Set fill color",
    description: "Set the fill color of a node (RGB can be 0..1 or 0..255).",
    inputSchema: {
      nodeId: z.string(),
      r: z.number(),
      g: z.number(),
      b: z.number(),
      opacity: z.number().optional()
    }
  },
  async ({ nodeId, r, g, b, opacity }) => {
    const result = await sendCommand("set_fill_color", {
      nodeId,
      r,
      g,
      b,
      opacity
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "read_my_design",
  {
    title: "Read my design",
    description: "Get detailed node information about the current selection.",
    inputSchema: {
      maxDepth: z.number().int().min(0).optional().describe("Levels of children to expand. Defaults to 0 (node itself)."),
      excludeTypes: z.array(z.string()).optional().describe("Skip these node types, e.g. [\"VECTOR\"], to cut icon/vector noise."),
      fields: z.array(z.string()).optional().describe("Only return these fields (plus id/name/type).")
    }
  },
  async ({ maxDepth, excludeTypes, fields }) => {
    const result = await sendCommand("read_my_design", { maxDepth: maxDepth ?? 0, excludeTypes, fields });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_node_info",
  {
    title: "Get node info",
    description: "Get detailed information about a specific node.",
    inputSchema: {
      nodeId: z.string(),
      maxDepth: z.number().int().min(0).optional().describe("Levels of children to expand. Defaults to 0 (node itself)."),
      excludeTypes: z.array(z.string()).optional().describe("Skip these node types, e.g. [\"VECTOR\"], to cut icon/vector noise."),
      fields: z.array(z.string()).optional().describe("Only return these fields (plus id/name/type).")
    }
  },
  async ({ nodeId, maxDepth, excludeTypes, fields }) => {
    const result = await sendCommand("get_node_info", { nodeId, maxDepth: maxDepth ?? 0, excludeTypes, fields });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_nodes_info",
  {
    title: "Get nodes info",
    description: "Get detailed information about multiple nodes by providing an array of node IDs.",
    inputSchema: {
      nodeIds: z.array(z.string()),
      maxDepth: z.number().int().min(0).optional().describe("Levels of children to expand. Defaults to 0 (node itself)."),
      excludeTypes: z.array(z.string()).optional().describe("Skip these node types, e.g. [\"VECTOR\"], to cut icon/vector noise."),
      fields: z.array(z.string()).optional().describe("Only return these fields (plus id/name/type).")
    }
  },
  async ({ nodeIds, maxDepth, excludeTypes, fields }) => {
    const result = await sendCommand("get_nodes_info", { nodeIds, maxDepth: maxDepth ?? 0, excludeTypes, fields });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_selection_context",
  {
    title: "Get selection context",
    description: "One-call bundle for the current selection: node info + (for instances) main component id, property definitions/values, slots. Use instead of chaining get_selection→get_node_info→get_component_property_definitions.",
    inputSchema: {
      maxDepth: z.number().int().min(0).optional().describe("Levels of children to expand. Defaults to 0 (node itself)."),
      excludeTypes: z.array(z.string()).optional().describe("Skip these node types, e.g. [\"VECTOR\"], to cut noise."),
      fields: z.array(z.string()).optional().describe("Only return these fields (plus id/name/type).")
    }
  },
  async ({ maxDepth, excludeTypes, fields }) => {
    const result = await sendCommand("get_selection_context", { maxDepth, excludeTypes, fields });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_changes_since",
  {
    title: "Get changes since",
    description: "Return nodes this bridge mutated since a cursor (re-read only what changed, not the whole doc). Pass prior currentSeq as sinceSeq to page. Cursor resets when the MCP server restarts.",
    inputSchema: {
      sinceSeq: z.number().int().min(0).optional()
    }
  },
  async ({ sinceSeq }) => {
    const since = Number(sinceSeq) || 0;
    const entries = changeLog.filter((c) => c.seq > since);
    const changedNodeIds = Array.from(new Set(entries.flatMap((c) => c.nodeIds)));
    const result = { currentSeq: changeSeq, sinceSeq: since, changeCount: entries.length, changedNodeIds, changes: entries };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_instance_source",
  {
    title: "Get instance source",
    description: "Get main component/component-set keys and properties for an instance (to verify design system provenance).",
    inputSchema: {
      instanceId: z.string()
    }
  },
  async ({ instanceId }) => {
    const result = await sendCommand("get_instance_source", { instanceId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "scan_instances_with_sources",
  {
    title: "Scan instances with sources",
    description: "Scan instances under a root node and return their main component/component-set keys.",
    inputSchema: {
      rootNodeId: z.string().optional(),
      chunkSize: z.number().optional(),
      offset: z.number().optional()
    }
  },
  async ({ rootNodeId, chunkSize, offset }) => {
    const result = await sendCommand("scan_instances_with_sources", { rootNodeId, chunkSize, offset });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "import_component_by_key",
  {
    title: "Import component by key",
    description: "Import a library component into the current file using its componentKey. Optionally rename the imported main component.",
    inputSchema: {
      componentKey: z.string(),
      name: z.string().optional().describe("New name for the imported main component.")
    }
  },
  async ({ componentKey, name }) => {
    const result = await sendCommand("import_component_by_key", { componentKey, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "import_component_set_by_key",
  {
    title: "Import component set by key",
    description: "Import a library component set into the current file using its componentSetKey. Optionally rename the imported main component set.",
    inputSchema: {
      componentSetKey: z.string(),
      name: z.string().optional().describe("New name for the imported main component set.")
    }
  },
  async ({ componentSetKey, name }) => {
    const result = await sendCommand("import_component_set_by_key", { componentSetKey, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_instance_from_component_key",
  {
    title: "Create instance from component key",
    description: "Create an instance from a library component key inside the target frame/parent.",
    inputSchema: {
      componentKey: z.string(),
      parentNodeId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ componentKey, parentNodeId, x, y }) => {
    const result = await sendCommand("create_instance_from_component_key", { componentKey, parentNodeId, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_instance_from_set_key",
  {
    title: "Create instance from set key",
    description: "Create an instance from a library component set key (default variant) inside the target frame/parent.",
    inputSchema: {
      componentSetKey: z.string(),
      parentNodeId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ componentSetKey, parentNodeId, x, y }) => {
    const result = await sendCommand("create_instance_from_component_set_key", { componentSetKey, parentNodeId, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_instance_properties",
  {
    title: "Get instance properties",
    description: "Get componentProperties for an instance.",
    inputSchema: {
      instanceId: z.string()
    }
  },
  async ({ instanceId }) => {
    const result = await sendCommand("get_instance_properties", { instanceId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_instance_properties",
  {
    title: "Set instance properties",
    description: "Set component properties/variants on an instance.",
    inputSchema: {
      instanceId: z.string(),
      properties: z.record(z.union([z.string(), z.number(), z.boolean()]))
    }
  },
  async ({ instanceId, properties }) => {
    const result = await sendCommand("set_instance_properties", { instanceId, properties });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "swap_instance_component",
  {
    title: "Swap instance component",
    description: "Swap an instance to a different library component key.",
    inputSchema: {
      instanceId: z.string(),
      newComponentKey: z.string()
    }
  },
  async ({ instanceId, newComponentKey }) => {
    const result = await sendCommand("swap_instance_component", { instanceId, newComponentKey });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_focus",
  {
    title: "Set focus",
    description: "Set focus on a specific node by selecting it and scrolling viewport to it.",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("set_focus", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_selections",
  {
    title: "Set selections",
    description: "Set selection to multiple nodes and scroll viewport to show them.",
    inputSchema: {
      nodeIds: z.array(z.string())
    }
  },
  async ({ nodeIds }) => {
    const result = await sendCommand("set_selections", { nodeIds });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_stroke_color",
  {
    title: "Set stroke color",
    description: "Set the stroke color and weight of a node (RGB can be 0..1 or 0..255).",
    inputSchema: {
      nodeId: z.string(),
      r: z.number(),
      g: z.number(),
      b: z.number(),
      opacity: z.number().optional(),
      strokeWeight: z.number().optional()
    }
  },
  async ({ nodeId, r, g, b, opacity, strokeWeight }) => {
    const result = await sendCommand("set_stroke_color", { nodeId, r, g, b, opacity, strokeWeight });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "reparent_node",
  {
    title: "Reparent node",
    description: "Move (cut) an existing node into a new parent container (frame, section, group, auto-layout, slot, or page). In auto-layout parents the node joins the flow unless x/y are given (then it is set to absolute positioning).",
    inputSchema: {
      nodeId: z.string(),
      newParentId: z.string(),
      index: z.number().int().min(0).optional().describe("Insert at this child index instead of appending at the end. Controls order inside auto-layout containers."),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ nodeId, newParentId, index, x, y }) => {
    const result = await sendCommand("reparent_node", { nodeId, newParentId, index, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_parent_chain",
  {
    title: "Get parent chain",
    description: "Walk up the parent chain of a node, returning id/name/type at each level.",
    inputSchema: {
      nodeId: z.string(),
      stopAtId: z.string().optional(),
      maxDepth: z.number().optional()
    }
  },
  async ({ nodeId, stopAtId, maxDepth }) => {
    const result = await sendCommand("get_parent_chain", { nodeId, stopAtId, maxDepth });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "insert_child",
  {
    title: "Insert child",
    description: "Insert an existing child node at an index inside a parent container.",
    inputSchema: {
      parentId: z.string(),
      childId: z.string(),
      index: z.number().optional()
    }
  },
  async ({ parentId, childId, index }) => {
    const result = await sendCommand("insert_child", { parentId, childId, index });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "move_node",
  {
    title: "Move node",
    description: "Move a node on the canvas. Pass absolute x/y, or relative dx/dy to nudge. Children of auto-layout containers are automatically switched to absolute positioning so they can move freely.",
    inputSchema: {
      nodeId: z.string(),
      x: z.number().optional().describe("Absolute target x. Omit to keep current and use dx instead."),
      y: z.number().optional().describe("Absolute target y. Omit to keep current and use dy instead."),
      dx: z.number().optional().describe("Relative x offset. Applied only when x is omitted."),
      dy: z.number().optional().describe("Relative y offset. Applied only when y is omitted.")
    }
  },
  async ({ nodeId, x, y, dx, dy }) => {
    const result = await sendCommand("move_node", { nodeId, x, y, dx, dy });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "resize_node",
  {
    title: "Resize node",
    description: "Resize a node with new dimensions.",
    inputSchema: {
      nodeId: z.string(),
      width: z.number(),
      height: z.number()
    }
  },
  async ({ nodeId, width, height }) => {
    const result = await sendCommand("resize_node", { nodeId, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "resize_to_fit",
  {
    title: "Resize to fit",
    description: "Fit a layer. Two modes: (1) pass targetNodeId to scale nodeId to fit inside that layer, preserving aspect ratio and centering it (fit: 'contain' letterboxes, 'cover' fills and crops); (2) omit targetNodeId to shrink-wrap nodeId to tightly fit its own children (Figma's 'Resize to Fit').",
    inputSchema: {
      nodeId: z.string().describe("The layer to resize or shrink-wrap."),
      targetNodeId: z.string().optional().describe("Scale nodeId to fit inside this layer's bounds. Omit to shrink-wrap nodeId to its own children."),
      fit: z.enum(["contain", "cover"]).optional().describe("contain = fit entirely inside the target (default); cover = fill the target, cropping overflow.")
    }
  },
  async ({ nodeId, targetNodeId, fit }) => {
    const result = await sendCommand("resize_to_fit", { nodeId, targetNodeId, fit });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "clone_node",
  {
    title: "Clone node",
    description: "Create a copy of an existing node with optional position offset and name.",
    inputSchema: {
      nodeId: z.string(),
      dx: z.number().optional(),
      dy: z.number().optional(),
      name: z.string().optional().describe("Name for the copy. Defaults to the source name.")
    }
  },
  async ({ nodeId, dx, dy, name }) => {
    const result = await sendCommand("clone_node", { nodeId, dx, dy, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "clone_node_into_parent",
  {
    title: "Clone node into parent",
    description: "Clone a node and append it into a specified parent container (frame, section, group, auto-layout, slot, or page). In auto-layout parents the copy joins the flow unless dx/dy are non-zero (then it is set to absolute positioning).",
    inputSchema: {
      nodeId: z.string(),
      parentNodeId: z.string(),
      index: z.number().int().min(0).optional().describe("Insert the copy at this child index instead of appending at the end."),
      dx: z.number().optional(),
      dy: z.number().optional(),
      name: z.string().optional().describe("Name for the copy. Defaults to the source name.")
    }
  },
  async ({ nodeId, parentNodeId, index, dx, dy, name }) => {
    const result = await sendCommand("clone_node_into_parent", { nodeId, parentNodeId, index, dx, dy, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_node",
  {
    title: "Delete node",
    description: "Delete a node by nodeId (only within the allowed target frame). Deleting a page or a top-level frame requires confirmFrameOrPageDeletion: true.",
    inputSchema: {
      nodeId: z.string(),
      confirmFrameOrPageDeletion: z.boolean().optional().describe("Required true to delete a PAGE or a top-level FRAME.")
    }
  },
  async ({ nodeId, confirmFrameOrPageDeletion }) => {
    const result = await sendCommand("delete_node", { nodeId, confirmFrameOrPageDeletion });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_multiple_nodes",
  {
    title: "Delete multiple nodes",
    description: "Delete multiple nodes by nodeIds (only within the allowed target frame). When any nodeId is a page or top-level frame, confirmFrameOrPageDeletion: true is required for that node.",
    inputSchema: {
      nodeIds: z.array(z.string()),
      confirmFrameOrPageDeletion: z.boolean().optional().describe("Required true when nodeIds include a PAGE or a top-level FRAME.")
    }
  },
  async ({ nodeIds, confirmFrameOrPageDeletion }) => {
    const result = await sendCommand("delete_multiple_nodes", { nodeIds, confirmFrameOrPageDeletion });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "run_batch",
  {
    title: "Run batch",
    description: "Execute multiple bridge actions in one round trip instead of one WebSocket call per action. Runs sequentially inside the plugin; by default stops at the first error (partial results are still returned in order). This is NOT a transaction: steps that already succeeded are not rolled back if a later step fails. Use create_checkpoint first if you need a rollback path for the nodes you're about to batch-edit.",
    inputSchema: {
      actions: z.array(
        z.object({
          action: z.string().describe("Any other bridge action name, e.g. \"set_fill_color\"."),
          payload: z.any().optional()
        })
      ),
      stopOnError: z.boolean().optional().describe("Default true: stop at the first failing step. Set false to run every step regardless of earlier failures.")
    }
  },
  async ({ actions, stopOnError }) => {
    const result = await sendCommand("run_batch", { actions, stopOnError });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_checkpoint",
  {
    title: "Create checkpoint",
    description: "Snapshot a handful of common mutable properties (position, size, rotation, opacity, visibility, fills, strokes, corner radius, text characters) on the given nodes so they can be restored later with restore_checkpoint. NOT true undo: it cannot restore a deleted node or undo structural changes (reparenting, new/removed children), and state is lost if the Figma plugin UI reloads.",
    inputSchema: {
      nodeIds: z.array(z.string()),
      label: z.string().optional()
    }
  },
  async ({ nodeIds, label }) => {
    const result = await sendCommand("create_checkpoint", { nodeIds, label });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "restore_checkpoint",
  {
    title: "Restore checkpoint",
    description: "Reapply a snapshot captured by create_checkpoint to whichever of its nodes still exist. See create_checkpoint for what is and isn't covered.",
    inputSchema: {
      checkpointId: z.string()
    }
  },
  async ({ checkpointId }) => {
    const result = await sendCommand("restore_checkpoint", { checkpointId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "list_checkpoints",
  {
    title: "List checkpoints",
    description: "List checkpoints captured so far in this plugin session.",
    inputSchema: {}
  },
  async () => {
    const result = await sendCommand("list_checkpoints", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "move_node_to_page",
  {
    title: "Move node to page",
    description: "Move (cut) a top-level node to another page, or copy it there (duplicate into page, keeping the original). Set copy: true to keep the original.",
    inputSchema: {
      nodeId: z.string(),
      targetPageId: z.string(),
      copy: z.boolean().optional().describe("Default false: cut/move the node. true: duplicate it into the target page and keep the original."),
      name: z.string().optional().describe("Name for the copied node when copy: true. Defaults to the source name.")
    }
  },
  async ({ nodeId, targetPageId, copy, name }) => {
    const result = await sendCommand("move_node_to_page", { nodeId, targetPageId, copy, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "move_component_to_file",
  {
    title: "Move component to another file",
    description: "Import a component or component-set from this file into another connected channel's file, then optionally delete the source (move). Requires the target file to be open with the plugin connected to this server on a different channel (see figma_bridge_status / list_channels). Use mode: 'copy' to keep the source. Accepts componentId, componentKey, or componentName to identify the source.",
    inputSchema: {
      targetChannel: z.string().describe("Channel name of the destination file (must be connected on this server)."),
      componentId: z.string().optional().describe("Source component/component-set node id in this file."),
      componentKey: z.string().optional().describe("Source component/component-set key (globally unique)."),
      componentName: z.string().optional().describe("Source component/component-set name in this file (must match exactly one)."),
      mode: z.enum(["move", "copy"]).optional().describe("Default 'move': delete the source after a successful import. 'copy' keeps it."),
      name: z.string().optional().describe("New name for the imported component/component-set in the target file.")
    }
  },
  async ({ targetChannel, componentId, componentKey, componentName, mode, name }) => {
    const targetName = normalizeChannelName(targetChannel);
    if (!targetName) throw new Error("Invalid targetChannel");
    const targetSocket = channels.get(targetName);
    if (!isOpenSocket(targetSocket)) {
      const known = connectedChannelsInfo().map((c) => c.channel).join(", ");
      throw new Error(`Channel "${targetName}" is not connected on this server. Connected channels: ${known || "(none)"}`);
    }
    const sourceSocket = getActiveSocket();
    if (!sourceSocket) throw new Error("Figma plugin not connected (source file)");
    if (targetSocket === sourceSocket) {
      throw new Error("targetChannel is the same file/channel as the source. Use clone_node / import tools for same-file duplication instead.");
    }
    const copy = mode === "copy";
    const renameTo = name !== undefined && name !== null ? String(name) : null;
    if (!componentId && !componentKey && !componentName) throw new Error("Provide componentId, componentKey, or componentName");

    let sourceInfo = null;
    if (componentId || componentName || componentKey) {
      const listRes = await sendCommand("get_local_components", {}, sourceSocket);
      const list = Array.isArray(listRes) ? listRes : listRes && Array.isArray(listRes.components) ? listRes.components : null;
      if (list) {
        if (componentId) {
          const found = list.find((c) => c && String(c.id) === String(componentId));
          if (!found) throw new Error(`Component not found with id ${componentId} in this file`);
          sourceInfo = found;
        } else if (componentName) {
          const found = list.filter((c) => c && String(c.name) === String(componentName));
          if (found.length === 0) throw new Error(`No component/component-set named "${componentName}" in this file`);
          if (found.length > 1) throw new Error(`Name "${componentName}" matches ${found.length} components; pass componentId instead`);
          sourceInfo = found[0];
        } else if (componentKey) {
          const found = list.find((c) => c && String(c.key) === String(componentKey));
          if (found) sourceInfo = found;
        }
      }
      if (sourceInfo && !sourceInfo.key) throw new Error(`Component "${sourceInfo.name}" has no importable key`);
    }
    const key = sourceInfo && sourceInfo.key ? sourceInfo.key : componentKey;
    if (!key) throw new Error("Could not resolve an importable key for the source component");

    let importRes;
    try {
      if (sourceInfo && sourceInfo.type === "COMPONENT_SET") {
        importRes = await sendCommand("import_component_set_by_key", { componentSetKey: key, name: renameTo }, targetSocket);
      } else {
        importRes = await sendCommand("import_component_by_key", { componentKey: key, name: renameTo }, targetSocket);
      }
    } catch (firstErr) {
      if (sourceInfo && sourceInfo.type) throw firstErr;
      try {
        importRes = await sendCommand("import_component_set_by_key", { componentSetKey: key, name: renameTo }, targetSocket);
      } catch (secondErr) {
        throw new Error(`Import failed as component and as component-set: ${firstErr && firstErr.message ? firstErr.message : String(firstErr)}`);
      }
    }

    let deletedSource = false;
    let deleteError = null;
    if (!copy && sourceInfo && sourceInfo.id) {
      try {
        const delRes = await sendCommand("delete_node", { nodeId: sourceInfo.id, confirmFrameOrPageDeletion: true }, sourceSocket);
        deletedSource = Boolean(delRes && delRes.success);
      } catch (err) {
        deleteError = err && err.message ? String(err.message) : String(err);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            targetChannel: targetName,
            imported: importRes,
            mode: copy ? "copy" : "move",
            deletedSource,
            deleteError,
            sourceNotDeletedReason: !sourceInfo && !copy ? "source not present in this file (key-only import)" : undefined
          })
        }
      ]
    };
  }
);

server.registerTool(
  "set_corner_radius",
  {
    title: "Set corner radius",
    description: "Set the corner radius of a node with optional per-corner control.",
    inputSchema: {
      nodeId: z.string(),
      radius: z.number(),
      corners: z
        .object({
          topLeft: z.number().optional(),
          topRight: z.number().optional(),
          bottomLeft: z.number().optional(),
          bottomRight: z.number().optional()
        })
        .optional()
    }
  },
  async ({ nodeId, radius, corners }) => {
    const result = await sendCommand("set_corner_radius", { nodeId, radius, corners });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_text_content",
  {
    title: "Set text content",
    description: "Set the text content of a single text node.",
    inputSchema: {
      nodeId: z.string(),
      characters: z.string()
    }
  },
  async ({ nodeId, characters }) => {
    const result = await sendCommand("set_text_content", { nodeId, characters });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "scan_text_nodes",
  {
    title: "Scan text nodes",
    description: "Scan text nodes with basic chunking support. Matches are returned as a columnar table: fields lists the column names and rows holds one array per node in the same order.",
    inputSchema: {
      rootNodeId: z.string().optional(),
      chunkSize: z.number().optional(),
      offset: z.number().optional(),
      maxChars: z.number().int().min(0).optional().describe("Truncate each returned characters string to this many chars. Default 120. Pass a large value (e.g. 100000) for full text."),
      verbose: z.boolean().optional().describe("Return items as an array of objects instead of the columnar fields/rows table.")
    }
  },
  async ({ rootNodeId, chunkSize, offset, maxChars, verbose }) => {
    const result = await sendCommand("scan_text_nodes", { rootNodeId, chunkSize, offset, maxChars });
    if (verbose || !result || !Array.isArray(result.items)) {
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const { items, ...rest } = result;
    const columnar = toColumnar(items);
    const payload = columnar ? { ...rest, ...columnar } : result;
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  }
);

server.registerTool(
  "find_and_replace_text",
  {
    title: "Find and replace text",
    description: "Search TEXT node characters for a literal string or regex and replace matches, optionally across every page in the file (not just the current one). Pass dryRun: true first to preview matches before committing.",
    inputSchema: {
      query: z.string(),
      replacement: z.string(),
      useRegex: z.boolean().optional(),
      matchCase: z.boolean().optional(),
      wholeWord: z.boolean().optional().describe("Ignored when useRegex is true."),
      allPages: z.boolean().optional().describe("Default false: only search the current page."),
      rootNodeId: z.string().optional().describe("Restrict the search to this node's subtree on the current page. Ignored on other pages when allPages is true."),
      dryRun: z.boolean().optional().describe("Preview matches without writing changes."),
      maxPreviewLength: z.number().int().min(0).optional().describe("Truncate before/after preview snippets in dryRun results. Default 200.")
    }
  },
  async ({ query, replacement, useRegex, matchCase, wholeWord, allPages, rootNodeId, dryRun, maxPreviewLength }) => {
    const result = await sendCommand("find_and_replace_text", {
      query,
      replacement,
      useRegex,
      matchCase,
      wholeWord,
      allPages,
      rootNodeId,
      dryRun,
      maxPreviewLength
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_multiple_text_contents",
  {
    title: "Set multiple text contents",
    description: "Batch update multiple text nodes efficiently.",
    inputSchema: {
      updates: z.array(
        z.object({
          nodeId: z.string(),
          characters: z.string()
        })
      )
    }
  },
  async ({ updates }) => {
    const result = await sendCommand("set_multiple_text_contents", { updates });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_styles",
  {
    title: "Get styles",
    description: "Get information about local styles. Paged per style type: pass limit/offset to bound each response (default 500); `totalPaintStyles`/`totalTextStyles`/`totalEffectStyles`/`totalGridStyles` report the full counts.",
    inputSchema: {
      limit: z.number().optional().describe("Max styles of each type (default 500)."),
      offset: z.number().optional().describe("Skip this many (default 0).")
    }
  },
  async ({ limit, offset }) => {
    const result = await sendCommand("get_styles", { limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_paint_style",
  {
    title: "Create paint style",
    description: "Create or update a local paint style.",
    inputSchema: {
      name: z.string(),
      hex: z.string().optional(),
      paints: z.array(z.any()).optional()
    }
  },
  async ({ name, hex, paints }) => {
    const result = await sendCommand("create_paint_style", { name, hex, paints });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_text_style",
  {
    title: "Create text style",
    description: "Create or update a local text style.",
    inputSchema: {
      name: z.string(),
      fontFamily: z.string(),
      fontStyle: z.string().optional(),
      fontSize: z.number().optional(),
      lineHeight: z.number().optional(),
      letterSpacing: z.number().optional(),
      paragraphSpacing: z.number().optional(),
      textCase: z.string().optional(),
      textDecoration: z.string().optional(),
      fillsHex: z.string().optional(),
      fills: z.array(z.any()).optional()
    }
  },
  async (args) => {
    const result = await sendCommand("create_text_style", args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_effect_style",
  {
    title: "Create effect style",
    description: "Create or update a local effect style.",
    inputSchema: {
      name: z.string(),
      effects: z.array(z.any())
    }
  },
  async ({ name, effects }) => {
    const result = await sendCommand("create_effect_style", { name, effects });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_grid_style",
  {
    title: "Create grid style",
    description: "Create or update a local grid style.",
    inputSchema: {
      name: z.string(),
      layoutGrids: z.array(z.any())
    }
  },
  async ({ name, layoutGrids }) => {
    const result = await sendCommand("create_grid_style", { name, layoutGrids });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "import_style_by_key",
  {
    title: "Import style by key",
    description: "Import a published library style into the file by key.",
    inputSchema: {
      key: z.string()
    }
  },
  async ({ key }) => {
    const result = await sendCommand("import_style_by_key", { key });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "apply_fill_style",
  {
    title: "Apply fill style",
    description: "Apply a paint style to a node's fills.",
    inputSchema: {
      nodeId: z.string(),
      styleId: z.string()
    }
  },
  async ({ nodeId, styleId }) => {
    const result = await sendCommand("apply_fill_style", { nodeId, styleId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "apply_stroke_style",
  {
    title: "Apply stroke style",
    description: "Apply a paint style to a node's strokes.",
    inputSchema: {
      nodeId: z.string(),
      styleId: z.string()
    }
  },
  async ({ nodeId, styleId }) => {
    const result = await sendCommand("apply_stroke_style", { nodeId, styleId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "apply_text_style",
  {
    title: "Apply text style",
    description: "Apply a text style to a TEXT node.",
    inputSchema: {
      nodeId: z.string(),
      styleId: z.string()
    }
  },
  async ({ nodeId, styleId }) => {
    const result = await sendCommand("apply_text_style", { nodeId, styleId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "apply_effect_style",
  {
    title: "Apply effect style",
    description: "Apply an effect style to a node's effects.",
    inputSchema: {
      nodeId: z.string(),
      styleId: z.string()
    }
  },
  async ({ nodeId, styleId }) => {
    const result = await sendCommand("apply_effect_style", { nodeId, styleId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "apply_grid_style",
  {
    title: "Apply grid style",
    description: "Apply a grid style to a frame's layout grids.",
    inputSchema: {
      nodeId: z.string(),
      styleId: z.string()
    }
  },
  async ({ nodeId, styleId }) => {
    const result = await sendCommand("apply_grid_style", { nodeId, styleId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_layout_grids",
  {
    title: "Set layout grids",
    description: "Set layout grids directly on a frame (layout guides).",
    inputSchema: {
      frameId: z.string(),
      layoutGrids: z.array(z.any())
    }
  },
  async ({ frameId, layoutGrids }) => {
    const result = await sendCommand("set_layout_grids", { frameId, layoutGrids });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_local_components",
  {
    title: "Get local components",
    description: "Get information about local components across all pages: id, name, type, description, publish key, and a property count, returned as { components, total, offset, limit, pageCount } so you can page every component (default limit 500). Pass includeProperties: true to also get simplified component property definitions (for building library catalogs). Pass verbose to skip compacting; the columnar format is used otherwise.",
    inputSchema: {
      includeComponentSets: z.boolean().optional(),
      includeProperties: z.boolean().optional().describe("Include full componentPropertyDefinitions. Default false (returns propertyCount only) to keep output small."),
      limit: z.number().optional().describe("Max components per page (default 500)."),
      offset: z.number().optional().describe("Skip this many (default 0)."),
      verbose: z.boolean().optional().describe("Return an array of objects instead of the columnar fields/rows table.")
    }
  },
  async ({ includeComponentSets, includeProperties, limit, offset, verbose }) => {
    const result = await sendCommand("get_local_components", { includeComponentSets, includeProperties, limit, offset });
    const columnar = verbose ? null : toColumnar(result.components || result);
    return { content: [{ type: "text", text: JSON.stringify(columnar || result) }] };
  }
);

server.registerTool(
  "create_component",
  {
    title: "Create component",
    description: "Create a new empty component node.",
    inputSchema: {
      name: z.string().optional(),
      parentNodeId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ name, parentNodeId, x, y, width, height }) => {
    const result = await sendCommand("create_component", { name, parentNodeId, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_component_from_node",
  {
    title: "Create component from node",
    description: "Convert an existing node into a main component.",
    inputSchema: {
      nodeId: z.string(),
      name: z.string().optional()
    }
  },
  async ({ nodeId, name }) => {
    const result = await sendCommand("create_component_from_node", { nodeId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "combine_as_variants",
  {
    title: "Combine as variants",
    description: "Combine existing component nodes into a component set and lay them out to avoid overlap.",
    inputSchema: {
      componentIds: z.array(z.string()),
      parentNodeId: z.string().optional(),
      index: z.number().optional(),
      name: z.string().optional(),
      gap: z.number().optional(),
      gapX: z.number().optional(),
      gapY: z.number().optional(),
      columns: z.number().optional()
    }
  },
  async ({ componentIds, parentNodeId, index, name, gap, gapX, gapY, columns }) => {
    const result = await sendCommand("combine_as_variants", {
      componentIds,
      parentNodeId,
      index,
      name,
      gap,
      gapX,
      gapY,
      columns
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_variant_properties",
  {
    title: "Set variant properties",
    description: "Rename a component using Figma's variant naming format (Property=Value, ...).",
    inputSchema: {
      componentId: z.string().optional(),
      nodeId: z.string().optional(),
      properties: z.record(z.string())
    }
  },
  async ({ componentId, nodeId, properties }) => {
    const result = await sendCommand("set_variant_properties", { componentId, nodeId, properties });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_component_property_definitions",
  {
    title: "Get component property definitions",
    description: "Inspect component or component-set property definitions for authoring and verification.",
    inputSchema: {
      componentId: z.string().optional(),
      componentSetId: z.string().optional(),
      nodeId: z.string().optional(),
      preferComponentSet: z.boolean().optional()
    }
  },
  async ({ componentId, componentSetId, nodeId, preferComponentSet }) => {
    const result = await sendCommand("get_component_property_definitions", {
      componentId,
      componentSetId,
      nodeId,
      preferComponentSet
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "add_component_property",
  {
    title: "Add component property",
    description: "Add a BOOLEAN, TEXT, INSTANCE_SWAP, or VARIANT property to a component or component set.",
    inputSchema: {
      componentId: z.string().optional(),
      componentSetId: z.string().optional(),
      nodeId: z.string().optional(),
      preferComponentSet: z.boolean().optional(),
      name: z.string(),
      type: componentPropertyTypeSchema,
      defaultValue: z.union([z.string(), z.boolean()]).optional(),
      preferredValues: z.array(instanceSwapPreferredValueSchema).optional()
    }
  },
  async ({ componentId, componentSetId, nodeId, preferComponentSet, name, type, defaultValue, preferredValues }) => {
    const result = await sendCommand("add_component_property", {
      componentId,
      componentSetId,
      nodeId,
      preferComponentSet,
      name,
      type,
      defaultValue,
      preferredValues
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "edit_component_property",
  {
    title: "Edit component property",
    description: "Rename or update the default value/preferred values of an existing component property.",
    inputSchema: {
      componentId: z.string().optional(),
      componentSetId: z.string().optional(),
      nodeId: z.string().optional(),
      preferComponentSet: z.boolean().optional(),
      propertyName: z.string(),
      updates: z.object({
        name: z.string().optional(),
        defaultValue: z.union([z.string(), z.boolean()]).optional(),
        preferredValues: z.array(instanceSwapPreferredValueSchema).optional()
      })
    }
  },
  async ({ componentId, componentSetId, nodeId, preferComponentSet, propertyName, updates }) => {
    const result = await sendCommand("edit_component_property", {
      componentId,
      componentSetId,
      nodeId,
      preferComponentSet,
      propertyName,
      updates
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_component_property",
  {
    title: "Delete component property",
    description: "Delete an existing component property from a component or component set.",
    inputSchema: {
      componentId: z.string().optional(),
      componentSetId: z.string().optional(),
      nodeId: z.string().optional(),
      preferComponentSet: z.boolean().optional(),
      propertyName: z.string()
    }
  },
  async ({ componentId, componentSetId, nodeId, preferComponentSet, propertyName }) => {
    const result = await sendCommand("delete_component_property", {
      componentId,
      componentSetId,
      nodeId,
      preferComponentSet,
      propertyName
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bind_component_property",
  {
    title: "Bind component property",
    description: "Bind a BOOLEAN/TEXT/INSTANCE_SWAP property to a node field using componentPropertyReferences.",
    inputSchema: {
      nodeId: z.string(),
      propertyName: z.string().nullable().optional(),
      propertyOwnerId: z.string().optional(),
      field: z.enum(["visible", "characters", "mainComponent"]),
      unbind: z.boolean().optional()
    }
  },
  async ({ nodeId, propertyName, propertyOwnerId, field, unbind }) => {
    const result = await sendCommand("bind_component_property", {
      nodeId,
      propertyName,
      propertyOwnerId,
      field,
      unbind
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_component_slot",
  {
    title: "Create component slot",
    description: "Create a slot inside a component variant. This also creates the corresponding SLOT property.",
    inputSchema: {
      componentId: z.string().optional(),
      componentSetId: z.string().optional(),
      nodeId: z.string().optional(),
      variantComponentId: z.string().optional(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ componentId, componentSetId, nodeId, variantComponentId, name, x, y, width, height }) => {
    const result = await sendCommand("create_component_slot", {
      componentId,
      componentSetId,
      nodeId,
      variantComponentId,
      name,
      x,
      y,
      width,
      height
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "edit_component_slot",
  {
    title: "Edit component slot",
    description: "Rename, resize, or reposition an existing SLOT node inside a component. Figma keeps the SLOT property's name in sync with the slot node's name.",
    inputSchema: {
      slotNodeId: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ slotNodeId, name, x, y, width, height }) => {
    const result = await sendCommand("edit_component_slot", { slotNodeId, name, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_component_slot",
  {
    title: "Delete component slot",
    description: "Remove a SLOT node from a component and delete its corresponding SLOT property. Any content placed in instances of that slot is discarded.",
    inputSchema: {
      slotNodeId: z.string()
    }
  },
  async ({ slotNodeId }) => {
    const result = await sendCommand("delete_component_slot", { slotNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_component_instance",
  {
    title: "Create component instance",
    description: "Create an instance of a component.",
    inputSchema: {
      componentId: z.string(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ componentId, x, y }) => {
    const result = await sendCommand("create_component_instance", { componentId, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "export_node_as_image",
  {
    title: "Export node as image",
    description: "Export a node as an image (PNG, JPG, SVG, or PDF). Returns base64, or writes the bytes to a file when localPath is given (kept inside the figma-write-bridge repo).",
    inputSchema: {
      nodeId: z.string(),
      format: z.string().optional(),
      scale: z.number().optional(),
      localPath: z.string().optional()
    }
  },
  async ({ nodeId, format, scale, localPath }) => {
    const result = await sendCommand("export_node_as_image", { nodeId, format, scale });
    if (typeof localPath === "string" && localPath.trim()) {
      const absFilePath = resolveSafeOutputDir(localPath);
      await mkdir(dirname(absFilePath), { recursive: true });
      const base64 = result && typeof result.base64 === "string" ? result.base64 : "";
      if (!base64) throw new Error("Export returned no base64 to write to disk");
      await writeFile(absFilePath, Buffer.from(base64, "base64"));
      return { content: [{ type: "text", text: JSON.stringify({ nodeId: result.nodeId, format: result.format, scale: result.scale, bytesLength: result.bytesLength, savedPath: absFilePath }) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "find_nodes",
  {
    title: "Find nodes",
    description: "Query the document for nodes matching a set of predicates, evaluated inside Figma so only matching rows come back (use this instead of reading a whole subtree and filtering). All predicates are optional and are ANDed together. Returns a columnar table: fields names the columns, rows holds one array per match, plus scanned/total/truncated counts. Examples: {types:[\"INSTANCE\"], mainComponentName:\"Button\", fillHex:\"#ff0000\"} finds red button instances; {missingFillStyle:true} finds hardcoded fills with no style or variable bound (design-system drift); {types:[\"INSTANCE\"], hasOverrides:true} finds overridden instances.",
    inputSchema: {
      types: z.array(z.string()).optional().describe("Node types to match, e.g. [\"INSTANCE\",\"TEXT\"]."),
      name: z.string().optional().describe("Glob against the node name: * and ? wildcards, anchored (e.g. \"Button/*\")."),
      nameRegex: z.string().optional().describe("Regex against the node name (unanchored). Use instead of name for complex patterns."),
      textContains: z.string().optional().describe("Substring of a TEXT node's characters. Implies types:[\"TEXT\"]."),
      fillHex: z.string().optional().describe("Match nodes with a SOLID fill of this hex, e.g. \"#ff0000\"."),
      fillTolerance: z.number().optional().describe("0-1 RGB distance allowed around fillHex. Default 0 (exact). ~0.1 catches near shades."),
      fillStyleId: z.string().optional().describe("Match nodes using this paint style id."),
      textStyleId: z.string().optional().describe("Match nodes using this text style id."),
      missingFillStyle: z.boolean().optional().describe("true = nodes with a solid fill but no paint style and no bound variable (hardcoded colors); false = the inverse."),
      hasBoundVariable: z.boolean().optional().describe("true = nodes with any bound variable; false = nodes with none."),
      boundVariableId: z.string().optional().describe("Match nodes bound to this specific variable id."),
      hasOverrides: z.boolean().optional().describe("Instances only: true = has overrides, false = clean. Implies types:[\"INSTANCE\"]."),
      mainComponentName: z.string().optional().describe("Instances only: substring of the main component's name. Implies types:[\"INSTANCE\"]."),
      visible: z.boolean().optional().describe("Filter by visibility."),
      matchCase: z.boolean().optional().describe("Case-sensitive name/text matching. Default false."),
      rootNodeId: z.string().optional().describe("Restrict to this node's subtree on the current page."),
      allPages: z.boolean().optional().describe("Search every page. Default false (current page only)."),
      fields: z.array(z.string()).optional().describe("Extra per-match columns: fillHex, characters, boundVariableIds, or any node property (e.g. opacity)."),
      limit: z.number().int().min(1).optional().describe("Max matches to return. Default 200, cap 1000."),
      offset: z.number().int().min(0).optional().describe("Skip this many matches, for paging."),
      verbose: z.boolean().optional().describe("Return an array of objects instead of the columnar fields/rows table.")
    }
  },
  async (args) => {
    const { verbose, ...query } = args || {};
    const result = await sendCommand("find_nodes", query);
    if (verbose || !result || !Array.isArray(result.items)) {
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    const { items, ...rest } = result;
    const columnar = toColumnar(items);
    return { content: [{ type: "text", text: JSON.stringify(columnar ? { ...rest, ...columnar } : result) }] };
  }
);

server.registerTool(
  "scan_nodes_by_types",
  {
    title: "Scan nodes by types",
    description: "Scan for nodes with specific types. Returns a columnar table: fields lists the column names and rows holds one array per node. For anything more selective than a type filter, prefer find_nodes.",
    inputSchema: {
      types: z.array(z.string()),
      verbose: z.boolean().optional().describe("Return an array of objects instead of the columnar fields/rows table.")
    }
  },
  async ({ types, verbose }) => {
    const result = await sendCommand("scan_nodes_by_types", { types });
    const columnar = verbose ? null : toColumnar(result);
    return { content: [{ type: "text", text: JSON.stringify(columnar || result) }] };
  }
);

server.registerTool(
  "get_annotations",
  {
    title: "Get annotations",
    description: "Get all annotations in the current document or specific node.",
    inputSchema: {
      nodeId: z.string().optional(),
      includeCategories: z.boolean().optional()
    }
  },
  async ({ nodeId, includeCategories }) => {
    const result = await sendCommand("get_annotations", { nodeId, includeCategories });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_annotation",
  {
    title: "Set annotation",
    description: "Create or update an annotation with markdown support.",
    inputSchema: {
      nodeId: z.string(),
      labelMarkdown: z.string(),
      categoryId: z.string().optional(),
      properties: z.array(z.any()).optional()
    }
  },
  async ({ nodeId, labelMarkdown, categoryId, properties }) => {
    const result = await sendCommand("set_annotation", { nodeId, labelMarkdown, categoryId, properties });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_multiple_annotations",
  {
    title: "Set multiple annotations",
    description: "Batch create/update multiple annotations efficiently.",
    inputSchema: {
      annotations: z.array(
        z.object({
          nodeId: z.string(),
          labelMarkdown: z.string(),
          categoryId: z.string().optional(),
          properties: z.array(z.any()).optional()
        })
      )
    }
  },
  async ({ annotations }) => {
    const result = await sendCommand("set_multiple_annotations", { annotations });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_reactions",
  {
    title: "Get reactions",
    description: "Get all prototype reactions from nodes.",
    inputSchema: {
      nodeIds: z.array(z.string())
    }
  },
  async ({ nodeIds }) => {
    const result = await sendCommand("get_reactions", { nodeIds });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_reactions",
  {
    title: "Set reactions",
    description: "Set prototype reactions on a node (replaces existing reactions).",
    inputSchema: {
      nodeId: z.string(),
      reactions: z.array(z.any())
    }
  },
  async ({ nodeId, reactions }) => {
    const result = await sendCommand("set_reactions", { nodeId, reactions });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "clear_reactions",
  {
    title: "Clear reactions",
    description: "Remove all prototype reactions from a node.",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("clear_reactions", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "upsert_reaction",
  {
    title: "Upsert reaction",
    description: "Replace the first matching reaction (by trigger/action/destination) or append if none match.",
    inputSchema: {
      nodeId: z.string(),
      match: z
        .object({
          triggerType: z.string().optional(),
          actionType: z.string().optional(),
          destinationId: z.string().optional()
        })
        .optional(),
      reaction: z.any()
    }
  },
  async ({ nodeId, match, reaction }) => {
    const result = await sendCommand("upsert_reaction", { nodeId, match, reaction });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_animation_presets",
  {
    title: "Get animation presets",
    description: "List curated motion presets plus the official Figma transition and easing values supported by this bridge.",
    inputSchema: {}
  },
  async () => {
    const result = {
      presets: motionPresetsCatalog,
      transitionTypes: transitionTypeSchema.options,
      directionalTransitionTypes: directionalTransitionTypeSchema.options,
      directions: transitionDirectionSchema.options,
      easingTypes: easingTypeSchema.options,
      notes: {
        durationUnit: "seconds",
        scope: "Prototype transitions, Smart Animate, multi-action reactions, and overlay/flow settings via Figma reactions.",
        limitation: "Smart Animate itself has no scriptable per-property keyframe/timeline API in Figma's Plugin API — it always auto-interpolates between the two frames/variants based on duration+easing. There is nothing to add here beyond the reaction/transition config this bridge already exposes."
      }
    };
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_transition_reaction",
  {
    title: "Set transition reaction",
    description: "Create or replace a node-to-node prototype reaction with a typed transition/easing payload.",
    inputSchema: {
      nodeId: z.string(),
      destinationId: z.string(),
      triggerType: z.string().optional(),
      navigation: z.enum(["NAVIGATE", "SWAP", "OVERLAY", "SCROLL_TO", "CHANGE_TO"]).optional(),
      preset: motionPresetSchema.optional(),
      transition: transitionSchema.optional(),
      replaceExisting: z.boolean().optional(),
      preserveScrollPosition: z.boolean().optional(),
      resetVideoPosition: z.boolean().optional(),
      resetScrollPosition: z.boolean().optional(),
      resetInteractiveComponents: z.boolean().optional(),
      overlayRelativePosition: z.object({
        x: z.number(),
        y: z.number()
      }).optional(),
      match: z.object({
        triggerType: z.string().optional(),
        actionType: z.string().optional(),
        destinationId: z.string().optional()
      }).optional()
    }
  },
  async (args) => {
    const result = await sendCommand("set_transition_reaction", args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_smart_animate_reaction",
  {
    title: "Set smart animate reaction",
    description: "Create or replace a node-to-node prototype reaction using Smart Animate with optional easing/preset overrides.",
    inputSchema: {
      nodeId: z.string(),
      destinationId: z.string(),
      triggerType: z.string().optional(),
      navigation: z.enum(["NAVIGATE", "SWAP", "OVERLAY", "SCROLL_TO", "CHANGE_TO"]).optional(),
      preset: motionPresetSchema.optional(),
      transition: z.object({
        duration: z.number().nonnegative().optional(),
        easing: z.union([easingTypeSchema, easingSchema]).optional(),
        matchLayers: z.boolean().optional(),
        direction: transitionDirectionSchema.optional()
      }).optional(),
      replaceExisting: z.boolean().optional(),
      preserveScrollPosition: z.boolean().optional(),
      resetVideoPosition: z.boolean().optional(),
      resetScrollPosition: z.boolean().optional(),
      resetInteractiveComponents: z.boolean().optional(),
      overlayRelativePosition: z.object({
        x: z.number(),
        y: z.number()
      }).optional(),
      match: z.object({
        triggerType: z.string().optional(),
        actionType: z.string().optional(),
        destinationId: z.string().optional()
      }).optional()
    }
  },
  async (args) => {
    const result = await sendCommand("set_smart_animate_reaction", args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_overlay_settings",
  {
    title: "Get overlay settings",
    description: "Read a frame/component's overlay prototype settings (position type, background, click-outside behavior). Used with NODE reactions whose navigation is OVERLAY.",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("get_overlay_settings", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_overlay_settings",
  {
    title: "Set overlay settings",
    description: "Configure how a frame/component behaves when it is shown as an OVERLAY: where it's anchored, its scrim background, and whether clicking outside closes it.",
    inputSchema: {
      nodeId: z.string(),
      overlayPositionType: z.enum(["CENTER", "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT", "MANUAL"]).optional(),
      overlayBackgroundInteraction: z.enum(["NONE", "CLOSE_ON_CLICK_OUTSIDE"]).optional(),
      overlayBackground: z
        .union([
          z.object({ type: z.literal("NONE") }),
          z.object({
            type: z.literal("SOLID_COLOR"),
            color: z.object({
              r: z.number(),
              g: z.number(),
              b: z.number(),
              a: z.number().optional()
            })
          })
        ])
        .optional()
    }
  },
  async ({ nodeId, overlayPositionType, overlayBackgroundInteraction, overlayBackground }) => {
    const result = await sendCommand("set_overlay_settings", {
      nodeId,
      overlayPositionType,
      overlayBackgroundInteraction,
      overlayBackground
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_prototype_settings",
  {
    title: "Get prototype settings",
    description: "Get the current page's prototype start node and Flows starting points.",
    inputSchema: {}
  },
  async () => {
    const result = await sendCommand("get_prototype_settings", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_prototype_start_node",
  {
    title: "Set prototype start node",
    description: "Set (or clear, by omitting nodeId) the current page's default prototype start frame — the entry point used by Present.",
    inputSchema: {
      nodeId: z.string().nullable().optional()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("set_prototype_start_node", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_flow_starting_points",
  {
    title: "Set flow starting points",
    description: "Replace the current page's Flows list (named prototype entry points), each pointing at a top-level FRAME.",
    inputSchema: {
      flowStartingPoints: z.array(
        z.object({
          nodeId: z.string(),
          name: z.string().optional()
        })
      )
    }
  },
  async ({ flowStartingPoints }) => {
    const result = await sendCommand("set_flow_starting_points", { flowStartingPoints });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_overflow_direction",
  {
    title: "Set overflow direction",
    description: "Set frame overflow direction for scrolling in prototype (NONE, HORIZONTAL, VERTICAL, BOTH).",
    inputSchema: {
      frameId: z.string(),
      overflowDirection: z.string()
    }
  },
  async ({ frameId, overflowDirection }) => {
    const result = await sendCommand("set_overflow_direction", { frameId, overflowDirection });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_fixed_children",
  {
    title: "Set fixed children",
    description: "Mark direct children of a frame as fixed in a scrolling prototype (fix position when scrolling).",
    inputSchema: {
      frameId: z.string(),
      fixedChildIds: z.array(z.string())
    }
  },
  async ({ frameId, fixedChildIds }) => {
    const result = await sendCommand("set_fixed_children", { frameId, fixedChildIds });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "list_variable_collections",
  {
    title: "List variable collections",
    description: "List local variable collections in the current file.",
    inputSchema: {}
  },
  async () => {
    const result = await sendCommand("list_variable_collections", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "list_variables",
  {
    title: "List variables",
    description: "List local variables in the current file (optionally filtered by resolvedType). Pass includeScopes: true to also return each variable's scopes, or includeValues: true to also return each variable's value in EVERY mode (valuesByMode by modeId, valuesByModeName by mode name, defaultValue from the collection's first mode, and the mode list) — use this to read theme/dark-mode values, not just the default mode. Results are paged: default limit 500 per call with `total`/`offset`/`pageCount` so you can page through every variable instead of reading them all at once.",
    inputSchema: {
      resolvedType: z.string().optional(),
      includeScopes: z.boolean().optional().describe("Include per-variable scopes arrays. Default false to keep output small."),
      includeValues: z.boolean().optional().describe("Include per-variable values for every mode (valuesByMode, valuesByModeName, defaultValue, modes). Default false."),
      limit: z.number().optional().describe("Max entries per page (default 500)."),
      offset: z.number().optional().describe("Skip this many entries (default 0). Page with offset until you reach `total`.")
    }
  },
  async ({ resolvedType, includeScopes, includeValues, limit, offset }) => {
    const result = await sendCommand("list_variables", { resolvedType, includeScopes, includeValues, limit, offset });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_variable",
  {
    title: "Get variable",
    description: "Read one variable's values in EVERY mode. Find it by variableId, by publish key, or by name (if the name is not unique, pass collectionId/collectionName to disambiguate). Returns valuesByMode / valuesByModeName (raw values, aliases as {type:\"VARIABLE_ALIAS\",id}) plus resolvedValuesByMode / resolvedValuesByModeName that follow aliases to a concrete value (colors as hex) with cycle/unresolved markers if needed.",
    inputSchema: {
      variableId: z.string().optional().describe("The variable's id (from list_variables)."),
      key: z.string().optional().describe("The variable's publish key."),
      name: z.string().optional().describe("The variable's name (exact, or unique partial)."),
      collectionId: z.string().optional().describe("Disambiguate an ambiguous name by collection id."),
      collectionName: z.string().optional().describe("Disambiguate an ambiguous name by collection name.")
    }
  },
  async ({ variableId, key, name, collectionId, collectionName }) => {
    const result = await sendCommand("get_variable", { variableId, key, name, collectionId, collectionName });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_variable_collection",
  {
    title: "Create variable collection",
    description: "Create a local variable collection, optionally naming modes.",
    inputSchema: {
      name: z.string(),
      modes: z.array(z.string()).optional()
    }
  },
  async ({ name, modes }) => {
    const result = await sendCommand("create_variable_collection", { name, modes });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_variable",
  {
    title: "Create variable",
    description: "Create a local variable in a collection and set values by mode.",
    inputSchema: {
      collectionId: z.string(),
      name: z.string(),
      resolvedType: z.string(),
      description: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      valuesByMode: z.record(z.any()).optional(),
      valuesByModeEntries: z.array(z.object({ modeId: z.string(), value: z.any() })).optional()
    }
  },
  async ({ collectionId, name, resolvedType, description, scopes, valuesByMode, valuesByModeEntries }) => {
    const result = await sendCommand("create_variable", {
      collectionId,
      name,
      resolvedType,
      description,
      scopes,
      valuesByMode,
      valuesByModeEntries
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_variable_values",
  {
    title: "Set variable values",
    description: "Update a variable's values by mode.",
    inputSchema: {
      variableId: z.string(),
      valuesByMode: z.record(z.any()),
      valuesByModeEntries: z.array(z.object({ modeId: z.string(), value: z.any() })).optional()
    }
  },
  async ({ variableId, valuesByMode, valuesByModeEntries }) => {
    const result = await sendCommand("set_variable_values", { variableId, valuesByMode, valuesByModeEntries });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "rename_variable",
  {
    title: "Rename variable",
    description: "Rename an existing variable by variableId.",
    inputSchema: {
      variableId: z.string(),
      name: z.string()
    }
  },
  async ({ variableId, name }) => {
    const result = await sendCommand("rename_variable", { variableId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_variable",
  {
    title: "Delete variable",
    description: "Delete an existing variable by variableId. Requires confirmDelete=true.",
    inputSchema: {
      variableId: z.string(),
      confirmDelete: z.boolean()
    }
  },
  async ({ variableId, confirmDelete }) => {
    const result = await sendCommand("delete_variable", { variableId, confirmDelete });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "import_variable_by_key",
  {
    title: "Import variable by key",
    description: "Import a published library variable into the file by key.",
    inputSchema: {
      key: z.string()
    }
  },
  async ({ key }) => {
    const result = await sendCommand("import_variable_by_key", { key });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bind_color_variable_to_fill",
  {
    title: "Bind color variable to fill",
    description: "Bind a COLOR variable to a node's fill paint.",
    inputSchema: {
      nodeId: z.string(),
      variableId: z.string(),
      paintIndex: z.number().optional()
    }
  },
  async ({ nodeId, variableId, paintIndex }) => {
    const result = await sendCommand("bind_color_variable_to_fill", { nodeId, variableId, paintIndex });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bind_color_variable_to_stroke",
  {
    title: "Bind color variable to stroke",
    description: "Bind a COLOR variable to a node's stroke paint.",
    inputSchema: {
      nodeId: z.string(),
      variableId: z.string(),
      paintIndex: z.number().optional()
    }
  },
  async ({ nodeId, variableId, paintIndex }) => {
    const result = await sendCommand("bind_color_variable_to_stroke", { nodeId, variableId, paintIndex });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bind_variable_to_property",
  {
    title: "Bind variable to property",
    description: "Bind a FLOAT/STRING/BOOLEAN variable to a node property via setBoundVariable(property, variable).",
    inputSchema: {
      nodeId: z.string(),
      property: z.string(),
      variableId: z.string()
    }
  },
  async ({ nodeId, property, variableId }) => {
    const result = await sendCommand("bind_variable_to_property", { nodeId, property, variableId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_node_explicit_variable_mode",
  {
    title: "Set node explicit variable mode",
    description: "Set an explicit variable mode for a node for a given collection.",
    inputSchema: {
      nodeId: z.string(),
      collectionId: z.string(),
      modeId: z.string()
    }
  },
  async ({ nodeId, collectionId, modeId }) => {
    const result = await sendCommand("set_node_explicit_variable_mode", { nodeId, collectionId, modeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_instance_slots",
  {
    title: "Get instance slots",
    description: "List SLOT nodes inside an instance (for inserting content into slots).",
    inputSchema: {
      instanceId: z.string()
    }
  },
  async ({ instanceId }) => {
    const result = await sendCommand("get_instance_slots", { instanceId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "append_to_slot",
  {
    title: "Append to slot",
    description: "Reparent existing nodes into a SLOT node.",
    inputSchema: {
      slotNodeId: z.string(),
      nodeIds: z.array(z.string())
    }
  },
  async ({ slotNodeId, nodeIds }) => {
    const result = await sendCommand("append_to_slot", { slotNodeId, nodeIds });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_auto_layout",
  {
    title: "Set auto layout",
    description: "Set multiple auto-layout properties in one call.",
    inputSchema: {
      frameId: z.string(),
      layoutMode: z.string().optional(),
      layoutWrap: z.string().optional(),
      primaryAxisAlignItems: z.string().optional(),
      counterAxisAlignItems: z.string().optional(),
      itemSpacing: z.number().optional(),
      padding: z
        .object({
          top: z.number().optional(),
          right: z.number().optional(),
          bottom: z.number().optional(),
          left: z.number().optional()
        })
        .optional(),
      sizing: z
        .object({
          primaryAxisSizingMode: z.string().optional(),
          counterAxisSizingMode: z.string().optional()
        })
        .optional()
    }
  },
  async ({ frameId, layoutMode, layoutWrap, primaryAxisAlignItems, counterAxisAlignItems, itemSpacing, padding, sizing }) => {
    const result = await sendCommand("set_auto_layout", {
      frameId,
      layoutMode,
      layoutWrap,
      primaryAxisAlignItems,
      counterAxisAlignItems,
      itemSpacing,
      padding,
      sizing
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_layout_mode",
  {
    title: "Set layout mode",
    description: "Set the layout mode and wrap behavior of a frame (NONE, HORIZONTAL, VERTICAL).",
    inputSchema: {
      nodeId: z.string(),
      layoutMode: z.string(),
      layoutWrap: z.string().optional()
    }
  },
  async ({ nodeId, layoutMode, layoutWrap }) => {
    const result = await sendCommand("set_layout_mode", { nodeId, layoutMode, layoutWrap });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_padding",
  {
    title: "Set padding",
    description: "Set padding values for an auto-layout frame (top, right, bottom, left).",
    inputSchema: {
      nodeId: z.string(),
      top: z.number().optional(),
      right: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional()
    }
  },
  async ({ nodeId, top, right, bottom, left }) => {
    const result = await sendCommand("set_padding", { nodeId, top, right, bottom, left });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_axis_align",
  {
    title: "Set axis align",
    description: "Set primary and counter axis alignment for auto-layout frames.",
    inputSchema: {
      nodeId: z.string(),
      primaryAxisAlignItems: z.string().optional(),
      counterAxisAlignItems: z.string().optional()
    }
  },
  async ({ nodeId, primaryAxisAlignItems, counterAxisAlignItems }) => {
    const result = await sendCommand("set_axis_align", { nodeId, primaryAxisAlignItems, counterAxisAlignItems });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_layout_sizing",
  {
    title: "Set layout sizing",
    description: "Set sizing modes for auto-layout frames.",
    inputSchema: {
      nodeId: z.string(),
      primaryAxisSizingMode: z.string().optional(),
      counterAxisSizingMode: z.string().optional(),
      layoutSizingHorizontal: z.string().optional(),
      layoutSizingVertical: z.string().optional()
    }
  },
  async ({ nodeId, primaryAxisSizingMode, counterAxisSizingMode, layoutSizingHorizontal, layoutSizingVertical }) => {
    const result = await sendCommand("set_layout_sizing", {
      nodeId,
      primaryAxisSizingMode,
      counterAxisSizingMode,
      layoutSizingHorizontal,
      layoutSizingVertical
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_item_spacing",
  {
    title: "Set item spacing",
    description: "Set distance between children in an auto-layout frame.",
    inputSchema: {
      nodeId: z.string(),
      itemSpacing: z.number()
    }
  },
  async ({ nodeId, itemSpacing }) => {
    const result = await sendCommand("set_item_spacing", { nodeId, itemSpacing });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "figma_set_text",
  {
    title: "Set text",
    description: "Sets characters on a TEXT node (by nodeId or current selection).",
    inputSchema: {
      nodeId: z.string().optional(),
      characters: z.string()
    }
  },
  async ({ nodeId, characters }) => {
    const result = await sendCommand("setText", { nodeId, characters });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "figma_set_solid_fill",
  {
    title: "Set solid fill",
    description: "Sets a SOLID fill on a node by nodeId.",
    inputSchema: {
      nodeId: z.string(),
      r: z.number(),
      g: z.number(),
      b: z.number(),
      opacity: z.number().optional()
    }
  },
  async ({ nodeId, r, g, b, opacity }) => {
    const result = await sendCommand("setSolidFill", { nodeId, r, g, b, opacity });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_image_fill",
  {
    title: "Set image fill",
    description: "Set an IMAGE fill on a node from a URL (createImageAsync), raw base64 imageBytes, or a local image file via localPath (read as base64 server-side). scaleMode: FILL, FIT, CROP, TILE.",
    inputSchema: z
      .object({
        nodeId: z.string(),
        url: z.string().optional(),
        imageBytes: z.string().optional(),
        localPath: z.string().optional(),
        scaleMode: z.string().optional(),
        paintIndex: z.number().optional(),
        rotation: z.number().optional()
      })
      .refine((v) => v.url || v.imageBytes || v.localPath, { message: "Provide url, imageBytes, or localPath" })
  },
  async ({ nodeId, url, imageBytes, localPath, scaleMode, paintIndex, rotation }) => {
    const resolvedImageBytes = localPath ? await readLocalFileAsBase64(localPath) : imageBytes;
    const result = await sendCommand("set_image_fill", { nodeId, url, imageBytes: resolvedImageBytes, scaleMode, paintIndex, rotation });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "undo",
  {
    title: "Undo last action",
    description: "Reverses the most recent auto-captured mutating action (snapshot-based, best-effort). Cannot restore deleted nodes or structural changes. Only works within the current plugin session while target-frame mutating actions were executed through this bridge."
  },
  async () => {
    const result = await sendCommand("undo", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "redo",
  {
    title: "Redo last undone action",
    description: "Re-applies the most recently undone action (snapshot-based, best-effort)."
  },
  async () => {
    const result = await sendCommand("redo", {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_style_guide",
  {
    title: "Get style guide",
    description: "Extract a usage style guide from the current page (or rootNodeId subtree): counts of distinct solid colors (hex), color variable bindings, font family/style combos, font sizes, line heights, spacing/gap/padding values, corner radii, stroke weights, and opacities.",
    inputSchema: {
      rootNodeId: z.string().optional()
    }
  },
  async ({ rootNodeId }) => {
    const result = await sendCommand("get_style_guide", rootNodeId ? { rootNodeId } : {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_font_list",
  {
    title: "Get font list",
    description: "List the distinct fonts (family + style) used in the current page or a rootNodeId subtree, with usage counts.",
    inputSchema: {
      rootNodeId: z.string().optional()
    }
  },
  async ({ rootNodeId }) => {
    const result = await sendCommand("get_font_list", rootNodeId ? { rootNodeId } : {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "distribute_nodes",
  {
    title: "Distribute nodes",
    description: "Space or align a set of nodes along an axis. axis: horizontal|vertical. mode: gap (fixed gap), spaceBetween/evenly (fill bounds), center (center the cluster). crossAlign: none|start|center|end. Bounds default to the common parent; pass bounds {x1,y1,x2,y2} to override (horizontal coordinates) or {y1,x1,y2,x2} semantics for vertical.",
    inputSchema: {
      nodeIds: z.array(z.string()),
      axis: z.string().optional(),
      mode: z.string().optional(),
      gap: z.number().optional(),
      crossAlign: z.string().optional(),
      bounds: z.object({ x1: z.number().optional(), y1: z.number().optional(), x2: z.number().optional(), y2: z.number().optional() }).optional()
    }
  },
  async ({ nodeIds, axis, mode, gap, crossAlign, bounds }) => {
    const result = await sendCommand("distribute_nodes", { nodeIds, axis, mode, gap, crossAlign, bounds });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "arrange_children",
  {
    title: "Arrange children",
    description: "Distribute the direct children of a frame/node along the main axis (horizontal or vertical). Accepts the same mode/gap/crossAlign options as distribute_nodes. Bounds default to the parent.",
    inputSchema: {
      parentNodeId: z.string(),
      axis: z.string().optional(),
      mode: z.string().optional(),
      gap: z.number().optional(),
      crossAlign: z.string().optional()
    }
  },
  async ({ parentNodeId, axis, mode, gap, crossAlign }) => {
    const result = await sendCommand("arrange_children", { parentNodeId, axis, mode, gap, crossAlign });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "import_tokens",
  {
    title: "Import design tokens",
    description: "Import a W3C-style Design Tokens JSON object into Figma variables (and optionally paint styles). Accepts nested {group:{name:{$type,$value}}} or plain nested values (types inferred from values). Creates/updates a variable collection (default 'Design Tokens') and a Default mode, then sets values. color -> COLOR variable + paint style, number/dimension -> FLOAT, string -> STRING, boolean -> BOOLEAN.",
    inputSchema: {
      tokens: z.record(z.any()),
      collectionName: z.string().optional(),
      modeName: z.string().optional(),
      createStyles: z.boolean().optional()
    }
  },
  async ({ tokens, collectionName, modeName, createStyles }) => {
    const result = await sendCommand("import_tokens", { tokens, collectionName, modeName, createStyles });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "export_tokens",
  {
    title: "Export design tokens",
    description: "Export local Figma variables as a W3C-style Design Tokens object (nested by collection/variable name), plus a flat variables list. Colors are emitted as hex. With includeModes (default true) every mode's values are returned under tokensByMode like \"Color/Dark\"; the response also includes `collections` (each with its full `modes` list), `modes` (all mode keys emitted) and `modeCount` so you can verify all modes (not just the first) came through. Set includeModes=false to skip per-mode views. Pass collections (array of collection names or ids) to export only those collections — keeps the response small on large files.",
    inputSchema: {
      includeModes: z.boolean().optional(),
      collections: z.array(z.string()).optional().describe("Export only these collections (by name or id). Omit to export all.")
    }
  },
  async ({ includeModes, collections }) => {
    const result = await sendCommand("export_tokens", { includeModes, collections });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_typography_scale",
  {
    title: "Create typography scale",
    description: "Create a text-style scale (caption/body/h3/h2/h1/display by default, or custom steps) from a baseSize and ratio: fontSize = base * ratio^offset. Can also create sample text nodes in a frame (createSampleFrame) spanning the steps.",
    inputSchema: {
      baseSize: z.number().optional(),
      ratio: z.number().optional(),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional(),
      prefix: z.string().optional(),
      steps: z.array(z.string()).optional(),
      lineHeightRatio: z.number().optional(),
      lineHeight: z.number().optional(),
      letterSpacing: z.number().optional(),
      createSampleFrame: z.boolean().optional(),
      parentNodeId: z.string().optional()
    }
  },
  async ({ baseSize, ratio, fontFamily, fontStyle, prefix, steps, lineHeightRatio, lineHeight, letterSpacing, createSampleFrame, parentNodeId }) => {
    const result = await sendCommand("create_typography_scale", { baseSize, ratio, fontFamily, fontStyle, prefix, steps, lineHeightRatio, lineHeight, letterSpacing, createSampleFrame, parentNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "generate_palette",
  {
    title: "Generate palette",
    description: "Generate a tonal 50..900 palette (default 10 steps) from a seed hex color. Light steps mix toward white, dark steps toward black. Optionally creates paint styles (createStyles=true), COLOR variables in a '<Name> Tokens' collection (createVariables=true), and a swatch frame with labeled rectangles (createFrame=true).",
    inputSchema: {
      hex: z.string(),
      name: z.string().optional(),
      steps: z.number().optional(),
      prefix: z.string().optional(),
      createStyles: z.boolean().optional(),
      createVariables: z.boolean().optional(),
      createFrame: z.boolean().optional(),
      swatchWidth: z.number().optional(),
      swatchHeight: z.number().optional(),
      gap: z.number().optional(),
      parentNodeId: z.string().optional()
    }
  },
  async ({ hex, name, steps, prefix, createStyles, createVariables, createFrame, swatchWidth, swatchHeight, gap, parentNodeId }) => {
    const result = await sendCommand("generate_palette", { hex, name, steps, prefix, createStyles, createVariables, createFrame, swatchWidth, swatchHeight, gap, parentNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "extract_component_set",
  {
    title: "Extract component set",
    description: "Convert multiple existing frames (or components) into a variant component set: each frame becomes a COMPONENT, then they are combined into a COMPONENT_SET via combine_as_variants. Set propertyName to attempt adding a VARIANT property (best-effort).",
    inputSchema: {
      nodeIds: z.array(z.string()),
      parentNodeId: z.string().optional(),
      name: z.string().optional(),
      propertyName: z.string().optional(),
      gap: z.number().optional(),
      gapX: z.number().optional(),
      gapY: z.number().optional(),
      columns: z.number().optional()
    }
  },
  async ({ nodeIds, parentNodeId, name, propertyName, gap, gapX, gapY, columns }) => {
    const result = await sendCommand("extract_component_set", { nodeIds, parentNodeId, name, propertyName, gap, gapX, gapY, columns });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_gradient_fill",
  {
    title: "Set gradient fill",
    description: "Set a gradient fill (LINEAR, RADIAL, ANGULAR, DIAMOND) on a node. stops: [{position 0..1, color {r,g,b[,a]}}]. Optional from/to transform points (normalized), opacity, paintIndex.",
    inputSchema: {
      nodeId: z.string(),
      gradientType: z.string().optional(),
      stops: z.array(
        z.object({
          position: z.number().optional(),
          color: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional()
        })
      ),
      from: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
      to: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
      opacity: z.number().optional(),
      paintIndex: z.number().optional()
    }
  },
  async ({ nodeId, gradientType, stops, from, to, opacity, paintIndex }) => {
    const result = await sendCommand("set_gradient_fill", { nodeId, gradientType, stops, from, to, opacity, paintIndex });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_effects",
  {
    title: "Set effects",
    description: "Set effects on a node. Pass effectStyleId to apply an existing style, or effects as raw array (DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR). boundVariables.color can bind a variable to the shadow color.",
    inputSchema: z
      .object({
        nodeId: z.string(),
        effectStyleId: z.string().optional(),
        effects: z.array(z.any()).optional(),
        boundVariables: z.record(z.string()).optional()
      })
      .refine((v) => v.effectStyleId || (Array.isArray(v.effects) && v.effects.length > 0), {
        message: "Provide either effectStyleId or a non-empty effects array"
      })
  },
  async ({ nodeId, effectStyleId, effects, boundVariables }) => {
    const result = await sendCommand("set_effects", { nodeId, effectStyleId, effects, boundVariables });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_vector",
  {
    title: "Create vector",
    description: "Create a VECTOR node from SVG path data. vectorPaths: [{data, windingRule?}]. Supports fills, strokes, strokeWeight, parentNodeId, x, y.",
    inputSchema: {
      vectorPaths: z.array(z.object({ data: z.string(), windingRule: z.string().optional() })),
      name: z.string().optional(),
      fills: z.array(z.any()).optional(),
      strokes: z.array(z.any()).optional(),
      strokeWeight: z.number().optional(),
      parentNodeId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ vectorPaths, name, fills, strokes, strokeWeight, parentNodeId, x, y }) => {
    const result = await sendCommand("create_vector", { vectorPaths, name, fills, strokes, strokeWeight, parentNodeId, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_vector_paths",
  {
    title: "Set vector paths",
    description: "Replace the SVG path data on an existing VECTOR node.",
    inputSchema: {
      nodeId: z.string(),
      vectorPaths: z.array(z.object({ data: z.string(), windingRule: z.string().optional() }))
    }
  },
  async ({ nodeId, vectorPaths }) => {
    const result = await sendCommand("set_vector_paths", { nodeId, vectorPaths });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "boolean_group",
  {
    title: "Boolean group",
    description: "Combine 2+ vector nodes into a boolean group (UNION, SUBTRACT, INTERSECT, EXCLUDE).",
    inputSchema: {
      nodeIds: z.array(z.string()).min(2),
      op: z.string().optional(),
      parentNodeId: z.string().optional(),
      name: z.string().optional()
    }
  },
  async ({ nodeIds, op, parentNodeId, name }) => {
    const result = await sendCommand("boolean_group", { nodeIds, op, parentNodeId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "group_nodes",
  {
    title: "Group nodes",
    description: "Wrap existing nodes in a GROUP.",
    inputSchema: {
      nodeIds: z.array(z.string()).min(1),
      parentNodeId: z.string().optional(),
      name: z.string().optional()
    }
  },
  async ({ nodeIds, parentNodeId, name }) => {
    const result = await sendCommand("group_nodes", { nodeIds, parentNodeId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "ungroup_node",
  {
    title: "Ungroup node",
    description: "Ungroup a GROUP node, moving its children up to the group's parent.",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("ungroup_node", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_section",
  {
    title: "Create section",
    description: "Create a SECTION node. Optional fillColor {r,g,b,a}, sectionProperties (e.g. {sectionType}), and parentNodeId.",
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      parentNodeId: z.string().optional(),
      fillColor: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
      sectionProperties: z.any().optional()
    }
  },
  async ({ name, x, y, width, height, parentNodeId, fillColor, sectionProperties }) => {
    const result = await sendCommand("create_section", { name, x, y, width, height, parentNodeId, fillColor, sectionProperties });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_section_properties",
  {
    title: "Set section properties",
    description: "Edit properties of an existing SECTION node, e.g. sectionType (SECTION | VIEWPORT) or the raw sectionProperties object.",
    inputSchema: {
      nodeId: z.string(),
      sectionType: z.string().optional().describe("Section type: SECTION or VIEWPORT."),
      sectionProperties: z.any().optional().describe("Raw sectionProperties object to merge onto the section.")
    }
  },
  async ({ nodeId, sectionType, sectionProperties }) => {
    const result = await sendCommand("set_section_properties", { nodeId, sectionType, sectionProperties });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_text_style",
  {
    title: "Set text style",
    description: "Apply a text style and/or fine-grained typography to a TEXT node. Pass textStyleId to apply an existing style; also supports fontFamily/fontStyle, fontSize, lineHeight (number|'AUTO'|{unit,value}), letterSpacing (number|{unit,value}), textCase, textDecoration, textAlignHorizontal/Vertical, paragraphIndent/Spacing, fillsHex/fills/fillStyleId, and boundVariables.",
    inputSchema: {
      nodeId: z.string(),
      textStyleId: z.string().optional(),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional(),
      fontSize: z.number().optional(),
      lineHeight: z.union([z.number(), z.literal("AUTO"), z.object({ unit: z.string().optional(), value: z.number().optional() })]).optional(),
      letterSpacing: z.union([z.number(), z.object({ unit: z.string().optional(), value: z.number().optional() })]).optional(),
      textCase: z.string().optional(),
      textDecoration: z.string().optional(),
      textAlignHorizontal: z.string().optional(),
      textAlignVertical: z.string().optional(),
      paragraphIndent: z.number().optional(),
      paragraphSpacing: z.number().optional(),
      fillsHex: z.string().optional(),
      fills: z.array(z.any()).optional(),
      fillStyleId: z.string().optional(),
      boundVariables: z.record(z.string()).optional()
    }
  },
  async ({ nodeId, textStyleId, fontFamily, fontStyle, fontSize, lineHeight, letterSpacing, textCase, textDecoration, textAlignHorizontal, textAlignVertical, paragraphIndent, paragraphSpacing, fillsHex, fills, fillStyleId, boundVariables }) => {
    const result = await sendCommand("set_text_style", {
      nodeId, textStyleId, fontFamily, fontStyle, fontSize, lineHeight, letterSpacing, textCase, textDecoration, textAlignHorizontal, textAlignVertical, paragraphIndent, paragraphSpacing, fillsHex, fills, fillStyleId, boundVariables
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_page",
  {
    title: "Create page",
    description: "Create a new page in the document. Pass activate: true to also switch to it.",
    inputSchema: {
      name: z.string().optional(),
      activate: z.boolean().optional().describe("Set the new page as the current page. Default false.")
    }
  },
  async ({ name, activate }) => {
    const result = await sendCommand("create_page", { name, activate });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "rename_page",
  {
    title: "Rename page",
    description: "Rename a page by pageId.",
    inputSchema: {
      pageId: z.string(),
      name: z.string()
    }
  },
  async ({ pageId, name }) => {
    const result = await sendCommand("rename_page", { pageId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_page",
  {
    title: "Delete page",
    description: "Delete a page by pageId. Requires confirmDelete=true.",
    inputSchema: {
      pageId: z.string(),
      confirmDelete: z.boolean()
    }
  },
  async ({ pageId, confirmDelete }) => {
    const result = await sendCommand("delete_page", { pageId, confirmDelete });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "duplicate_page",
  {
    title: "Duplicate page",
    description: "Duplicate a page (including all contents) by pageId. Auto-suffixes the name (Page 2, Page 3...) unless a name is given. Pass activate: true to switch to the duplicate.",
    inputSchema: {
      pageId: z.string(),
      name: z.string().optional().describe("Explicit name for the duplicate. Omit to auto-name (base 2, base 3...)."),
      activate: z.boolean().optional().describe("Set the duplicate as the current page. Default false.")
    }
  },
  async ({ pageId, name, activate }) => {
    const result = await sendCommand("duplicate_page", { pageId, name, activate });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_current_page",
  {
    title: "Set current page",
    description: "Set the current/active page by pageId.",
    inputSchema: {
      pageId: z.string()
    }
  },
  async ({ pageId }) => {
    const result = await sendCommand("set_current_page", { pageId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "reorder_page",
  {
    title: "Reorder page",
    description: "Move a page to a new index in the page tab bar (0-based).",
    inputSchema: {
      pageId: z.string(),
      index: z.number()
    }
  },
  async ({ pageId, index }) => {
    const result = await sendCommand("reorder_page", { pageId, index });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "generate_grid",
  {
    title: "Generate grid",
    description: "Generate a grid of items inside a parent. Clones itemNodeId if given, otherwise creates rectangles of itemWidth x itemHeight. Use {i} in name for the running index.",
    inputSchema: {
      columns: z.number().int().min(1).optional(),
      rows: z.number().int().min(1).optional(),
      parentNodeId: z.string().optional(),
      itemNodeId: z.string().optional(),
      itemWidth: z.number().optional(),
      itemHeight: z.number().optional(),
      spacingX: z.number().optional(),
      spacingY: z.number().optional(),
      name: z.string().optional()
    }
  },
  async ({ columns, rows, parentNodeId, itemNodeId, itemWidth, itemHeight, spacingX, spacingY, name }) => {
    const result = await sendCommand("generate_grid", { columns, rows, parentNodeId, itemNodeId, itemWidth, itemHeight, spacingX, spacingY, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bulk_rename",
  {
    title: "Bulk rename",
    description: "Find-and-replace text in node names across a subtree (defaults to current page). Supports regex and dryRun. Returns a before/after diff.",
    inputSchema: {
      find: z.string(),
      replace: z.string().optional(),
      useRegex: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      rootNodeId: z.string().optional()
    }
  },
  async ({ find, replace, useRegex, dryRun, rootNodeId }) => {
    const result = await sendCommand("bulk_rename", { find, replace, useRegex, dryRun, rootNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "bulk_update",
  {
    title: "Bulk update",
    description: "Apply one property across many nodes. Supported properties: fillColor, cornerRadius, opacity, visible, name, fillStyle, textStyle, cornerRadii. Target by nodeIds, by nodeTypes under rootNodeId, or the whole current page.",
    inputSchema: {
      property: z.string(),
      value: z.any(),
      nodeIds: z.array(z.string()).optional(),
      nodeTypes: z.array(z.string()).optional(),
      rootNodeId: z.string().optional()
    }
  },
  async ({ property, value, nodeIds, nodeTypes, rootNodeId }) => {
    const result = await sendCommand("bulk_update", { property, value, nodeIds, nodeTypes, rootNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "replace_all_instances",
  {
    title: "Replace all instances",
    description: "Swap every instance whose main component key matches sourceComponentKey to targetComponentKey. Supports dryRun and a rootNodeId scope.",
    inputSchema: {
      sourceComponentKey: z.string(),
      targetComponentKey: z.string(),
      dryRun: z.boolean().optional(),
      rootNodeId: z.string().optional()
    }
  },
  async ({ sourceComponentKey, targetComponentKey, dryRun, rootNodeId }) => {
    const result = await sendCommand("replace_all_instances", { sourceComponentKey, targetComponentKey, dryRun, rootNodeId });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "set_variable_mode",
  {
    title: "Set variable mode",
    description: "Theme switch: set the variable mode for one or many nodes. modeId can be a mode id or exact mode name. Scope via nodeIds, rootNodeId (recurse defaults true, pass recurse:false for the root only), or the whole current page.",
    inputSchema: {
      modeId: z.string(),
      collectionId: z.string().optional(),
      nodeIds: z.array(z.string()).optional(),
      rootNodeId: z.string().optional(),
      recurse: z.boolean().optional()
    }
  },
  async ({ modeId, collectionId, nodeIds, rootNodeId, recurse }) => {
    const result = await sendCommand("set_variable_mode", { modeId, collectionId, nodeIds, rootNodeId, recurse });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "create_variable_mode",
  {
    title: "Create variable mode",
    description: "Add a new mode to a variable collection.",
    inputSchema: {
      collectionId: z.string(),
      name: z.string()
    }
  },
  async ({ collectionId, name }) => {
    const result = await sendCommand("create_variable_mode", { collectionId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "rename_variable_mode",
  {
    title: "Rename variable mode",
    description: "Rename a mode within a variable collection.",
    inputSchema: {
      collectionId: z.string(),
      modeId: z.string(),
      name: z.string()
    }
  },
  async ({ collectionId, modeId, name }) => {
    const result = await sendCommand("rename_variable_mode", { collectionId, modeId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_variable_mode",
  {
    title: "Delete variable mode",
    description: "Remove a mode from a variable collection. Requires confirmDelete=true.",
    inputSchema: {
      collectionId: z.string(),
      modeId: z.string(),
      confirmDelete: z.boolean()
    }
  },
  async ({ collectionId, modeId, confirmDelete }) => {
    const result = await sendCommand("delete_variable_mode", { collectionId, modeId, confirmDelete });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "rename_variable_collection",
  {
    title: "Rename variable collection",
    description: "Rename a variable collection by collectionId.",
    inputSchema: {
      collectionId: z.string(),
      name: z.string()
    }
  },
  async ({ collectionId, name }) => {
    const result = await sendCommand("rename_variable_collection", { collectionId, name });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "delete_variable_collection",
  {
    title: "Delete variable collection",
    description: "Delete an entire variable collection (and all its variables/modes). Requires confirmDelete=true.",
    inputSchema: {
      collectionId: z.string(),
      confirmDelete: z.boolean()
    }
  },
  async ({ collectionId, confirmDelete }) => {
    const result = await sendCommand("delete_variable_collection", { collectionId, confirmDelete });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "subscribe_events",
  {
    title: "Subscribe to events",
    description: "Start pushing Figma events (selectionchange, documentchange) to the bridge. They land in the event log read via get_events.",
    inputSchema: {
      events: z.array(z.string())
    }
  },
  async ({ events }) => {
    const result = await sendCommand("subscribe_events", { events });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "unsubscribe_events",
  {
    title: "Unsubscribe from events",
    description: "Stop pushing selected Figma events to the bridge.",
    inputSchema: {
      events: z.array(z.string())
    }
  },
  async ({ events }) => {
    const result = await sendCommand("unsubscribe_events", { events });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.registerTool(
  "get_events",
  {
    title: "Get events",
    description: "Read pushed Figma events (selectionchange/documentchange) since a sequence cursor. Pass the previous call's currentSeq as sinceSeq to page forward. Cursor state lives in the MCP server process and resets on restart.",
    inputSchema: {
      sinceSeq: z.number().int().min(0).optional()
    }
  },
  async ({ sinceSeq }) => {
    const since = Number(sinceSeq) || 0;
    const events = eventLog.filter((e) => e.seq > since);
    return { content: [{ type: "text", text: JSON.stringify({ currentSeq: eventSeq, sinceSeq: since, eventCount: events.length, events }) }] };
  }
);

server.registerTool(
  "list_channels",
  {
    title: "List channels",
    description: "Channel dashboard: lists every connected Figma plugin channel with its fileKey/fileName and connection time.",
    inputSchema: {}
  },
  async () => {
    const entries = [];
    for (const [name, socket] of channels.entries()) {
      if (!isOpenSocket(socket)) continue;
      const meta = socketMeta.get(socket) || {};
      entries.push({
        channel: name,
        connected: true,
        fileKey: meta.fileKey || null,
        fileName: meta.fileName || null,
        connectedAt: meta.connectedAt || null
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ activeChannel, channels: entries }) }]
    };
  }
);

server.registerTool(
  "list_comments",
  {
    title: "List comments",
    description: "List comments on a Figma file via the REST API (requires FIGMA_TOKEN).",
    inputSchema: {
      fileKey: z.string()
    }
  },
  async ({ fileKey }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    const data = await figmaApiJson(`/v1/files/${key}/comments`, {});
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool(
  "post_comment",
  {
    title: "Post comment",
    description: "Create a comment on a Figma file via the REST API (requires FIGMA_TOKEN). Optional nodeId anchors it to a node; clientMeta {x,y[,nodeId]} positions it on the canvas.",
    inputSchema: {
      fileKey: z.string(),
      message: z.string(),
      nodeId: z.string().optional(),
      clientMeta: z.object({ x: z.number().optional(), y: z.number().optional(), nodeId: z.string().optional() }).optional()
    }
  },
  async ({ fileKey, message, nodeId, clientMeta }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    if (!String(message || "").trim()) throw new Error("Missing message");
    const body = { message: String(message) };
    const meta = {};
    if (clientMeta && clientMeta.x !== undefined) meta.x = clientMeta.x;
    if (clientMeta && clientMeta.y !== undefined) meta.y = clientMeta.y;
    if (nodeId) meta.node_id = String(nodeId);
    else if (clientMeta && clientMeta.nodeId) meta.node_id = String(clientMeta.nodeId);
    if (Object.keys(meta).length) body.client_meta = meta;
    const data = await figmaApiJson(`/v1/files/${key}/comments`, undefined, "POST", body);
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  }
);

server.registerTool(
  "delete_comment",
  {
    title: "Delete comment",
    description: "Delete a comment from a Figma file via the REST API (requires FIGMA_TOKEN).",
    inputSchema: {
      fileKey: z.string(),
      commentId: z.string()
    }
  },
  async ({ fileKey, commentId }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    await figmaApiJson(`/v1/files/${key}/comments/${String(commentId)}`, undefined, "DELETE");
    return { content: [{ type: "text", text: JSON.stringify({ success: true, commentId: String(commentId) }) }] };
  }
);

server.registerTool(
  "search_components",
  {
    title: "Search components",
    description: "Search for components/component-sets via the Figma REST API (requires FIGMA_TOKEN). Provide teamId to use /v1/team/{teamId}/components, or omit it to use /v1/me/components. Optional fileKey and pageSize filter the results.",
    inputSchema: {
      teamId: z.string().optional(),
      fileKey: z.string().optional(),
      pageSize: z.number().optional(),
      type: z.string().optional()
    }
  },
  async ({ teamId, fileKey, pageSize, type }) => {
    requireFigmaToken();
    const query = {};
    if (pageSize !== undefined) query.page_size = pageSize;
    if (fileKey) query.file_key = fileKey;
    const pathname = teamId ? `/v1/team/${String(teamId).trim()}/components` : "/v1/me/components";
    const data = await figmaApiJson(pathname, query);
    let list = Array.isArray(data && data.meta && data.meta.components) ? data.meta.components : [];
    if (String(type || "").toLowerCase() === "set") {
      list = list.filter((c) => Boolean(c.component_set_id));
    } else if (String(type || "").toLowerCase() === "component") {
      list = list.filter((c) => !c.component_set_id);
    }
    const compact = list.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      fileKey: c.file_key,
      user: c.user && c.user.handle,
      containingFrame: c.containing_frame && c.containing_frame.name,
      thumbnail: c.thumbnail_url,
      componentSetId: c.component_set_id || null
    }));
    return { content: [{ type: "text", text: JSON.stringify({ meta: data && data.meta, count: compact.length, components: compact }) }] };
  }
);

server.registerTool(
  "export_frames_to_disk",
  {
    title: "Export frames to disk",
    description: "Bulk-export frames from a Figma file to local disk via the REST API (requires FIGMA_TOKEN). Pass nodeIds, or pass pageId to export all top-level frames on a page. Renders PNG/JPG/SVG/PDF into a folder inside the figma-write-bridge repo.",
    inputSchema: {
      fileKey: z.string(),
      nodeIds: z.array(z.string()).optional(),
      pageId: z.string().optional(),
      format: z.string().optional(),
      scale: z.number().optional(),
      localPath: z.string(),
      fileNamePrefix: z.string().optional()
    }
  },
  async ({ fileKey, nodeIds, pageId, format, scale, localPath, fileNamePrefix }) => {
    const key = String(fileKey || "").trim();
    if (!key) throw new Error("Missing fileKey");
    const outDir = resolveSafeOutputDir(localPath);
    await mkdir(outDir, { recursive: true });
    const fmt = String(format || "png").toLowerCase();
    if (!["png", "jpg", "jpeg", "svg", "pdf"].includes(fmt)) throw new Error("Unsupported format: " + format);
    const apiFormat = fmt === "jpeg" ? "jpg" : fmt;
    const ext = apiFormat;
    const scaleValue = typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : 2;
    const prefix = typeof fileNamePrefix === "string" && fileNamePrefix.trim() ? String(fileNamePrefix).trim() + "-" : "";
    let ids = Array.isArray(nodeIds) ? nodeIds.map(String).filter(Boolean) : [];
    const namesById = {};
    if (!ids.length) {
      const file = await figmaApiJson(`/v1/files/${key}`, { depth: 2 });
      const pages = (file && file.document && file.document.children) || [];
      for (const page of pages) {
        if (pageId && page.id !== pageId) continue;
        for (const frame of page.children || []) {
          if (frame.type !== "FRAME" && frame.type !== "COMPONENT" && frame.type !== "COMPONENT_SET" && frame.type !== "SECTION") continue;
          ids.push(frame.id);
          namesById[frame.id] = frame.name || "";
        }
      }
    } else {
      try {
        const nodesRes = await figmaApiJson(`/v1/files/${key}/nodes`, { ids: ids.join(",") });
        const nodes = (nodesRes && nodesRes.nodes) || {};
        for (const nid of Object.keys(nodes)) {
          const n = nodes[nid] && nodes[nid].document;
          if (n) namesById[nid] = n.name || "";
        }
      } catch (_err) {}
    }
    if (!ids.length) throw new Error("No frames to export (pass nodeIds or pageId)");
    const downloaded = [];
    const errors = [];
    const CHUNK = 50;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const exportData = await figmaApiJson(`/v1/images/${key}`, {
        ids: chunk.join(","),
        format: apiFormat,
        scale: apiFormat === "png" || apiFormat === "jpg" ? scaleValue : undefined
      });
      const urls = (exportData && exportData.images) || {};
      for (const nodeId of chunk) {
        const url = String(urls[nodeId] || "");
        if (!url) {
          errors.push({ nodeId, error: "No export URL returned" });
          continue;
        }
        try {
          const buf = await httpGetBuffer(url);
          const safeName = String(namesById[nodeId] || "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || nodeId;
          const fileName = `${prefix}${safeName}-${nodeId}.${ext}`;
          const absFilePath = resolve(outDir, fileName);
          const rel = relative(outDir, absFilePath);
          if (rel.startsWith("..") || isAbsolute(rel)) {
            errors.push({ nodeId, error: "fileName escapes localPath" });
            continue;
          }
          await writeFile(absFilePath, buf);
          downloaded.push({ nodeId, fileName: safeName, savedPath: absFilePath });
        } catch (e) {
          errors.push({ nodeId, url, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ outDir, format: ext, scale: scaleValue, exportedCount: downloaded.length, downloaded, errors }) }]
    };
  }
);

async function main() {
  if (onceCreateFrame) {
    console.error(
      JSON.stringify(
        {
          name: "figma-write-bridge",
          wsUrl: `ws://${wsHost}:${wsPort}`,
          status: "listening-once"
        },
        null,
        2
      )
    );
    return;
  }

  if (standalone) {
    console.error(
      JSON.stringify(
        {
          name: "figma-write-bridge",
          wsUrl: `ws://${wsHost}:${wsPort}`,
          status: "listening-standalone"
        },
        null,
        2
      )
    );
    setInterval(() => {}, 1000);
    await new Promise(() => {});
    return;
  }

  const transport = new StdioServerTransport();
  const originalSend = transport.send.bind(transport);
  transport.send = (message, options) => originalSend(slimToolListPayload(message), options);
  await server.connect(transport);
  console.error(
    JSON.stringify(
      {
        name: "figma-write-bridge",
        wsUrl: `ws://${wsHost}:${wsPort}`,
        status: "listening"
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});
