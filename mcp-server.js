import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

const wsHost = process.env.FIGMA_BRIDGE_HOST || "127.0.0.1";
const wsPort = Number(process.env.FIGMA_BRIDGE_PORT || "8787");
const commandTimeoutMs = Number(process.env.FIGMA_BRIDGE_TIMEOUT_MS || "180000");
const defaultChannel = process.env.FIGMA_BRIDGE_CHANNEL || "default";

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

const wss = new WebSocketServer({ host: wsHost, port: wsPort });

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

function markSocketRole(socket, role) {
  const prev = socketMeta.get(socket);
  const connectedAt = prev?.connectedAt ?? Date.now();
  socketMeta.set(socket, { connectedAt, role: String(role) });
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

function sendCommand(action, payload, socketOverride) {
  const socket = socketOverride || getActiveSocket();
  if (!socket) {
    throw new Error("Figma plugin not connected");
  }

  if (!socketOverride) {
    const actionName = String(action || "");
    if (!actionName) throw new Error("Missing action");
    if (/delete|remove|reset|clear/i.test(actionName)) {
      if (actionName !== "delete_node" && actionName !== "delete_multiple_nodes") {
        throw new Error(`Blocked action: ${actionName}`);
      }
    }
    if (/^(applySarawakFoundations)$/i.test(actionName)) {
      throw new Error(`Blocked action: ${actionName}`);
    }

    const isReadAction =
      /^(ping|get_|scan_|export_|import_)/.test(actionName) ||
      /^(getSelection|getDocumentInfo|getDocumentInfo|getNode|getNodeById|scanTree|getStyles|getLocalComponents|get_document_info|get_selection|get_node|get_styles|get_local_components)$/i.test(
        actionName
      );
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

  socket.send(JSON.stringify({ type: "command", id, action, payload }));
  return promise;
}

wss.on("error", (err) => {
  console.error(err?.stack ?? String(err));
});

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
      const channel = typeof msg.channel === "string" && msg.channel.trim() ? msg.channel.trim() : defaultChannel;
      const prev = socketToChannel.get(socket);
      if (prev) channels.delete(prev);
      socketToChannel.set(socket, channel);
      channels.set(channel, socket);
      markSocketRole(socket, "plugin");
      clientSockets.delete(socket);
      unclaimedSockets.delete(socket);
      if (!activeChannel) activeChannel = channel;
      try {
        socket.send(JSON.stringify({ type: "system", channel, message: `Joined channel: ${channel}` }));
      } catch {}
      return;
    }

    if (msg.type === "set_active_channel") {
      markSocketRole(socket, "client");
      clientSockets.add(socket);
      unclaimedSockets.delete(socket);
      const channel = typeof msg.channel === "string" && msg.channel.trim() ? msg.channel.trim() : defaultChannel;
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
              connectedChannels: Array.from(channels.entries())
                .filter(([, s]) => s && s.readyState === WebSocket.OPEN)
                .map(([name]) => name)
            }
          })
        );
      } catch {}
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
    if (channel) channels.delete(channel);
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
        wss.close(() => process.exit(0));
      } catch (err) {
        console.error(err?.stack ?? String(err));
        try {
          socket.close();
        } catch {}
        wss.close(() => process.exit(1));
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
  "set_target_frame",
  "get_target_frames",
  "clear_target_frames",
  "rename_node",
  "get_document_info",
  "get_selection",
  "get_node_info",
  "get_nodes_info",
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
  "create_component_instance",
  "export_node_as_image",
  "scan_text_nodes",
  "create_rectangle",
  "create_frame",
  "create_text",
  "set_fill_color",
  "set_stroke_color",
  "move_node",
  "resize_node",
  "clone_node",
  "clone_node_into_parent",
  "delete_node",
  "delete_multiple_nodes",
  "set_corner_radius",
  "set_text_content",
  "set_multiple_text_contents",
  "get_reactions",
  "set_reactions",
  "clear_reactions",
  "upsert_reaction",
  "set_overflow_direction",
  "set_fixed_children",
  "list_variable_collections",
  "list_variables",
  "create_variable_collection",
  "create_variable",
  "set_variable_values",
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
  "figma_get_selection",
  "figma_get_document_info",
  "figma_set_text",
  "figma_create_frame",
  "figma_create_rectangle",
  "figma_create_text",
  "figma_rename_node",
  "figma_set_solid_fill"
]);

{
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name, meta, handler) => {
    if (!ALLOWED_MCP_TOOLS.has(String(name))) return;
    return originalRegisterTool(name, meta, handler);
  };
}

server.registerTool(
  "figma_bridge_status",
  {
    title: "Figma bridge status",
    description: "Returns whether the local Figma plugin is connected."
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
            connectedChannels: Array.from(channels.entries())
              .filter(([, s]) => s && s.readyState === WebSocket.OPEN)
              .map(([name]) => name)
          },
          null,
          2
        )
      }
    ]
  })
);

server.registerTool(
  "join_channel",
  {
    title: "Join channel",
    description: "Selects which connected Figma plugin channel to target for subsequent commands.",
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
            },
            null,
            2
          )
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify({ targetFrameIds: Array.from(targetFrameIds) }, null, 2) }] };
  }
);

server.registerTool(
  "get_target_frames",
  {
    title: "Get target frames",
    description: "Returns the current target frameIds the agent is allowed to modify."
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ targetFrameIds: Array.from(targetFrameIds) }, null, 2) }]
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
    return { content: [{ type: "text", text: JSON.stringify({ targetFrameIds: [] }, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "read_my_design",
  {
    title: "Read my design",
    description: "Get detailed node information about the current selection without parameters."
  },
  async () => {
    const result = await sendCommand("read_my_design", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_node_info",
  {
    title: "Get node info",
    description: "Get detailed information about a specific node.",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("get_node_info", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_nodes_info",
  {
    title: "Get nodes info",
    description: "Get detailed information about multiple nodes by providing an array of node IDs.",
    inputSchema: {
      nodeIds: z.array(z.string())
    }
  },
  async ({ nodeIds }) => {
    const result = await sendCommand("get_nodes_info", { nodeIds });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "import_component_by_key",
  {
    title: "Import component by key",
    description: "Import a library component into the current file using its componentKey.",
    inputSchema: {
      componentKey: z.string()
    }
  },
  async ({ componentKey }) => {
    const result = await sendCommand("import_component_by_key", { componentKey });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "import_component_set_by_key",
  {
    title: "Import component set by key",
    description: "Import a library component set into the current file using its componentSetKey.",
    inputSchema: {
      componentSetKey: z.string()
    }
  },
  async ({ componentSetKey }) => {
    const result = await sendCommand("import_component_set_by_key", { componentSetKey });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "move_node",
  {
    title: "Move node",
    description: "Move a node to a new position.",
    inputSchema: {
      nodeId: z.string(),
      x: z.number().optional(),
      y: z.number().optional()
    }
  },
  async ({ nodeId, x, y }) => {
    const result = await sendCommand("move_node", { nodeId, x, y });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "clone_node",
  {
    title: "Clone node",
    description: "Create a copy of an existing node with optional position offset.",
    inputSchema: {
      nodeId: z.string(),
      dx: z.number().optional(),
      dy: z.number().optional()
    }
  },
  async ({ nodeId, dx, dy }) => {
    const result = await sendCommand("clone_node", { nodeId, dx, dy });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "clone_node_into_parent",
  {
    title: "Clone node into parent",
    description: "Clone a node and append it into a specified parent container.",
    inputSchema: {
      nodeId: z.string(),
      parentNodeId: z.string(),
      dx: z.number().optional(),
      dy: z.number().optional()
    }
  },
  async ({ nodeId, parentNodeId, dx, dy }) => {
    const result = await sendCommand("clone_node_into_parent", { nodeId, parentNodeId, dx, dy });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "delete_node",
  {
    title: "Delete node",
    description: "Delete a node by nodeId (only within the allowed target frame).",
    inputSchema: {
      nodeId: z.string()
    }
  },
  async ({ nodeId }) => {
    const result = await sendCommand("delete_node", { nodeId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "delete_multiple_nodes",
  {
    title: "Delete multiple nodes",
    description: "Delete multiple nodes by nodeIds (only within the allowed target frame).",
    inputSchema: {
      nodeIds: z.array(z.string())
    }
  },
  async ({ nodeIds }) => {
    const result = await sendCommand("delete_multiple_nodes", { nodeIds });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "scan_text_nodes",
  {
    title: "Scan text nodes",
    description: "Scan text nodes with basic chunking support.",
    inputSchema: {
      rootNodeId: z.string().optional(),
      chunkSize: z.number().optional(),
      offset: z.number().optional()
    }
  },
  async ({ rootNodeId, chunkSize, offset }) => {
    const result = await sendCommand("scan_text_nodes", { rootNodeId, chunkSize, offset });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_styles",
  {
    title: "Get styles",
    description: "Get information about local styles."
  },
  async () => {
    const result = await sendCommand("get_styles", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_local_components",
  {
    title: "Get local components",
    description: "Get information about local components.",
    inputSchema: {
      includeComponentSets: z.boolean().optional()
    }
  },
  async ({ includeComponentSets }) => {
    const result = await sendCommand("get_local_components", { includeComponentSets });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "export_node_as_image",
  {
    title: "Export node as image",
    description: "Export a node as an image (PNG, JPG, SVG, or PDF) - returns base64.",
    inputSchema: {
      nodeId: z.string(),
      format: z.string().optional(),
      scale: z.number().optional()
    }
  },
  async ({ nodeId, format, scale }) => {
    const result = await sendCommand("export_node_as_image", { nodeId, format, scale });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "scan_nodes_by_types",
  {
    title: "Scan nodes by types",
    description: "Scan for nodes with specific types.",
    inputSchema: {
      types: z.array(z.string())
    }
  },
  async ({ types }) => {
    const result = await sendCommand("scan_nodes_by_types", { types });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "list_variables",
  {
    title: "List variables",
    description: "List local variables in the current file (optionally filtered by resolvedType).",
    inputSchema: {
      resolvedType: z.string().optional()
    }
  },
  async ({ resolvedType }) => {
    const result = await sendCommand("list_variables", { resolvedType });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
      valuesByMode: z.record(z.any()).optional()
    }
  },
  async ({ collectionId, name, resolvedType, description, scopes, valuesByMode }) => {
    const result = await sendCommand("create_variable", {
      collectionId,
      name,
      resolvedType,
      description,
      scopes,
      valuesByMode
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "set_variable_values",
  {
    title: "Set variable values",
    description: "Update a variable's values by mode.",
    inputSchema: {
      variableId: z.string(),
      valuesByMode: z.record(z.any())
    }
  },
  async ({ variableId, valuesByMode }) => {
    const result = await sendCommand("set_variable_values", { variableId, valuesByMode });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "add_renewal_info_panel",
  {
    title: "Add renewal info panel",
    description:
      "Adds a right-side container that shows renewal info (expiry date, times renewed, max renewals) into/within the specified target frame.",
    inputSchema: {
      targetNodeId: z.string(),
      expiryDate: z.string().optional(),
      timesRenewed: z.number().optional(),
      maxRenewals: z.number().optional(),
      title: z.string().optional()
    }
  },
  async ({ targetNodeId, expiryDate, timesRenewed, maxRenewals, title }) => {
    const result = await sendCommand("add_renewal_info_panel", {
      targetNodeId,
      expiryDate,
      timesRenewed,
      maxRenewals,
      title
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "create_renewal_tab_screen",
  {
    title: "Create renewal tab screen",
    description:
      "Clones an existing screen/frame, places it below the source, and updates it to represent the Renewal tab (including an optional renewal info panel).",
    inputSchema: {
      url: z.string().optional(),
      sourceNodeId: z.string().optional(),
      name: z.string().optional(),
      spacing: z.number().optional(),
      expiryDate: z.string().optional(),
      timesRenewed: z.number().optional(),
      maxRenewals: z.number().optional()
    }
  },
  async ({ url, sourceNodeId, name, spacing, expiryDate, timesRenewed, maxRenewals }) => {
    const result = await sendCommand("create_renewal_tab_screen", {
      url,
      sourceNodeId,
      name,
      spacing,
      expiryDate,
      timesRenewed,
      maxRenewals
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_get_selection",
  {
    title: "Get current selection",
    description: "Returns the currently selected nodes in the open Figma document."
  },
  async () => {
    const result = await sendCommand("getSelection", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_get_document_info",
  {
    title: "Get document info",
    description: "Returns basic info about the currently open Figma document (name + current page)."
  },
  async () => {
    const result = await sendCommand("getDocumentInfo", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_create_frame",
  {
    title: "Create frame",
    description: "Creates a frame on the current page.",
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ name, x, y, width, height }) => {
    const result = await sendCommand("createFrame", { name, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_create_rectangle",
  {
    title: "Create rectangle",
    description: "Creates a rectangle on the current page.",
    inputSchema: {
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional()
    }
  },
  async ({ name, x, y, width, height }) => {
    const result = await sendCommand("createRectangle", { name, x, y, width, height });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_apply_sarawak_foundations",
  {
    title: "Apply Sarawak foundations",
    description: "Creates the Foundations/Components/Patterns/AI Surfaces pages and applies Sarawak paint + shadow styles."
  },
  async () => {
    const result = await sendCommand("applySarawakFoundations", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_reset_sarawak_design_system",
  {
    title: "Reset + generate Sarawak Design System",
    description:
      "Deletes non-target pages, ensures the 4 pages, applies Sarawak styles, and generates a design-system scaffold (placeholders) per instructions.md."
  },
  async () => {
    const result = await sendCommand("reset_sarawak_design_system", {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_create_text",
  {
    title: "Create text",
    description: "Creates a text node on the current page.",
    inputSchema: {
      characters: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      fontSize: z.number().optional()
    }
  },
  async ({ characters, name, x, y, fontSize }) => {
    const result = await sendCommand("createText", {
      characters,
      name,
      x,
      y,
      fontSize
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "figma_rename_node",
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
