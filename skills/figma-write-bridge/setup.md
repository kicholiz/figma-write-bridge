# Setup

## Required Preconditions

Before any editing session, verify:
1. The bridge is reachable with `figma_bridge_status`.
2. The expected channel is active (defaults to `default`; matches the server's `FIGMA_BRIDGE_CHANNEL`). Use `figma_bridge_status` to see it and `join_channel` if needed.
3. The correct Figma file is open via `get_document_info`.
4. The user’s intended frame is selected, or you can identify it from the document.
5. You have a clear parent/container before creating nodes.

If the bridge is not connected, tell the user to:
1. Start the local server or MCP server for `figma-write-bridge`.
2. Open the target Figma file.
3. Run `Figma Write Bridge (Local)`.
4. Connect the plugin UI to `ws://localhost:8787` or the configured port — or pick the matching entry from the plugin's **Discovered servers** dropdown (it scans localhost ports `8787–8797` for running servers, one per agent).
5. Confirm the plugin shows `Connected`.

## Channels (One Plugin = One Channel / MCP Server)

A “channel” is the name that ties a plugin UI to the MCP server it routes through:

- By default the channel is `default` — on both the server and the plugin UI. A single server needs nothing else.
- The server's channel is fixed at startup by the `FIGMA_BRIDGE_CHANNEL` env var (default `default`). This is what lets you run **multiple MCP servers**, each on its own `FIGMA_BRIDGE_PORT` + `FIGMA_BRIDGE_CHANNEL`, each controlling its own Figma file.
- In the plugin UI, the **Channel** field defaults to `default`. If the user started a server with a non-default `FIGMA_BRIDGE_CHANNEL`, they type that same channel in the plugin UI (plus the matching host:port) so the plugin joins the right server. One plugin UI connects to exactly one channel / MCP server.
- To discover running servers, the plugin scans localhost ports `8787–8797` (`GET /health` on each port; server answers with `{ name: "figma-write-bridge", wsUrl, host, port, channel, connectedChannels }`). Running servers appear in the **Discovered servers** dropdown — selecting one auto-fills **Server** + **Channel** and connects. Keep each agent's `FIGMA_BRIDGE_PORT` inside `8787–8797` so it shows up; the scan range is tunable via `scanPortStart`/`scanPortCount` at the top of `figma-plugin/code.js`.
- The server targets the channel configured at startup. A plugin that joined that channel is the one your commands act on.

So the routing rule is: **the channel in the plugin UI must equal the `FIGMA_BRIDGE_CHANNEL` of the MCP server it's connected to** (both `default` when unset). You can see the active channel via `figma_bridge_status`, switch it with `join_channel`, and list all connected channels with `list_channels`.
