# Figma Write Bridge

Figma Write Bridge lets a local tool (like an AI assistant or a script) safely “write” into your open Figma file by connecting a Figma plugin to a local bridge server on your computer.

This repo contains:
- `figma-plugin/` — the Figma plugin (connects your Figma file to the bridge)
- `mcp-server.js` — the local bridge server (runs on your computer)
- `package.json` — Node.js setup (starts the server)

---

## What You’ll Use It For
- Let an assistant generate frames, text, shapes, styles, and structured layouts in your Figma file.
- Keep control: nothing happens unless your Figma file is open and the plugin is connected.

## What It Can Do
- **Frames, text, shapes, sections, and vectors** — create and edit nodes, including sections (`create_section`, `set_section_properties` to flip `SECTION`/`VIEWPORT`), vectors from SVG paths, and boolean groups.
- **Move anything anywhere** — `move_node` (absolute `x`/`y` or relative `dx`/`dy`, auto-frees auto-layout children), `reparent_node` / `insert_child` (move any node into/out of frames, sections, groups, auto-layouts, and slots, with an `index` for order), `append_to_slot` (into component slots), `move_node_to_page` (cut or copy to another page), and `clone_node_into_parent` (copy into any container).
- **Resize to fit** — `resize_to_fit` scales any layer to fit inside a target layer (`fit: "contain"` letterboxes, `fit: "cover"` fills/crops, both aspect-preserving and centered), or shrink-wraps a container tightly to its own children when no `targetNodeId` is given.
- **Find nodes by query** — `find_nodes` filters the whole document server-side by type, name/text, fill color, style/variable binding, instance overrides, and more (all combinable), so a search like "red button instances" or "hardcoded colors with no style" returns only the matches instead of a full tree dump.
- **Layout & structure** — auto layout, padding/spacing/alignment, layout grids, one-call grid generators (`generate_grid`), and layout helpers (`distribute_nodes`, `arrange_children`, which are auto-layout aware).
- **Fills & effects** — solid/gradient/image fills (from a URL, base64, or a local file path via `localPath`), shadows and blurs, and applying existing styles or variable-bound colors.
- **Text styling** — apply existing text styles or set font/font-size/line-height/letter-spacing/case/alignment directly, with variable binding. Generate a whole type scale from a base size + ratio with `create_typography_scale`.
- **Design tokens** — export local variables as a W3C-style Design Tokens JSON (`export_tokens`) and import a tokens JSON into variables + paint styles (`import_tokens`).
- **Style guides & palettes** — extract a usage style guide (`get_style_guide`: colors, fonts, sizes, spacing), list fonts used (`get_font_list`), and generate tonal color palettes with swatches/styles/variables (`generate_palette`).
- **Components** — create/import components and instances (imports accept a `name` to rename the main node), batch-convert frames into a variant component set (`extract_component_set`), and move/copy a local component to another open file's channel with `move_component_to_file`.
- **Undo/redo** — snapshot-based `undo` / `redo` for the most recent mutating actions, shared between the agent's tools and Undo/Redo buttons in the plugin UI itself (best-effort; cannot restore deleted nodes or structural changes).
- **Pages** — create, rename, duplicate (auto-names like `Name 2` or takes a `name`), reorder, switch, and delete pages; `create_page` / `duplicate_page` accept `activate: true` to switch to the new page.
- **Bulk & template work** — `bulk_rename`, `bulk_update`, `replace_all_instances`, and page duplication.
- **Variables & themes** — create/rename/delete variable modes and collections, and theme-switch whole frames/pages with `set_variable_mode`.
- **Live push events** — subscribe to `selectionchange` / `documentchange` so the agent can react to your selection or canvas without polling.
- **Channel dashboard** — `list_channels` shows which file each connected channel belongs to.
- **REST API extras** — file JSON, image downloads, bulk frame exports, file comments, and component search (with `FIGMA_TOKEN`).

---

## Prerequisites
- Figma Desktop app (recommended for local plugin + localhost connections)
- Node.js (LTS) installed on your computer

---

## Install the Figma Plugin
1. Open **Figma Desktop**.
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select this file:
   - `figma-write-bridge\figma-plugin\manifest.json`
4. The plugin appears as **“Figma Write Bridge (Local)”** under **Plugins → Development**.

---

## Start the Local Bridge Server
In a terminal (PowerShell is fine), run the following, replacing the path with the actual path to this repo on your computer:

```powershell
cd "C:\path\to\figma-write-bridge"
npm install
npm start
```

By default, the server listens on:
- `ws://localhost:8787`

Keep this terminal window open while you use the bridge.

---

## Add to Your AI Agent (MCP config)
If your AI agent supports MCP tool servers, you can register this bridge so the agent can call Figma tools.

1. Make sure the Figma plugin is connected in the file you want to edit.
2. Add this to your agent's MCP config file. Replace `args` with the absolute path to `mcp-server.js` on your computer (on Windows, JSON strings need `\\` for each backslash). `FIGMA_TOKEN` is optional — only needed if you want the REST API tools (`get_figma_data`, `download_figma_images`); omit that line entirely if you don't have a token yet:

```json
{
  "mcpServers": {
    "figma-write-bridge": {
      "command": "node",
      "args": [
        "C:\\path\\to\\figma-write-bridge\\mcp-server.js"
      ],
      "env": {
        "FIGMA_BRIDGE_HOST": "127.0.0.1",
        "FIGMA_BRIDGE_PORT": "8787",
        "FIGMA_BRIDGE_CHANNEL": "default",
        "FIGMA_BRIDGE_TIMEOUT_MS": "180000",
        "FIGMA_TOKEN": "your_figma_personal_access_token"
      }
    }
  }
}
```

Notes:
- If your agent starts the MCP server automatically, do not also run `npm start` (only one process can use port `8787`).
- After adding the config, restart your AI agent app so it picks up the new server.
- **Running more than one MCP server?** Each server needs its own port *and* channel: set `FIGMA_BRIDGE_PORT` and `FIGMA_BRIDGE_CHANNEL` per server (e.g. server A → port `8787`, channel `default`; server B → port `8788`, channel `design`). Each server should use a port in the plugin's scan range (`8787–8797`) so it shows up in the plugin's **Discovered servers** dropdown — then in Figma just pick the server for the agent you want. One plugin UI connects to exactly one channel / MCP server.

## Target Frames (Safety)
`set_target_frame` / `get_target_frames` / `clear_target_frames` let the agent record which frame(s) you intend it to work in. Target-frame scoping is **enforced by the plugin**: when target frame(s) are set, write/delete actions targeting nodes outside those frame(s) are rejected with an error (create actions use the target frame as their host when one is set). A small, explicit set of delete/reset/clear actions is allowed by default (deleting a node, a page, a variable, a variable mode, or a component property/slot, and clearing prototype reactions) so the agent can actually make the changes you ask for — everything else matching "delete/remove/reset/clear" is blocked.

The server syncs `targetFrameIds` into the plugin automatically whenever they change (`set_target_frame` / `clear_target_frames`) and whenever a plugin connects, so enforcement stays in sync even if the plugin UI reloads.

Recommended workflow:
1. In Figma, select the frame you want the AI to work on.
2. From your AI agent, call `get_selection` and take the selected frame `id`.
3. Call `set_target_frame` with that `frameId`.
4. Use create/edit tools to add content within that frame.

Tip: If you call `create_frame` (or `figma_create_frame`) with no target set, the created frame becomes the target automatically.

---

## Figma REST API Tools (No Plugin Required)
If you provide `FIGMA_TOKEN`, the server also exposes tools that call the Figma REST API directly:
- `get_figma_data` (fetch file JSON, and optionally node JSON)
- `download_figma_images` (download images/exports to a local folder)
- `list_comments` / `post_comment` / `delete_comment` (file comments)
- `export_frames_to_disk` (bulk-export a set of frames or a whole page to a local folder)
- `search_components` (find components/component-sets across your account or a team)

Examples:
- `get_figma_data({ fileKey, nodeId? })`
- `download_figma_images({ fileKey, nodes, localPath, pngScale? })`
- `export_frames_to_disk({ fileKey, pageId, localPath, format: "png", scale: 2 })`
- `post_comment({ fileKey, message, nodeId })`
- `search_components({ teamId?, fileKey?, pageSize? })`

---

## Connect from Figma (Setup in Your File)
> **Use the Figma Desktop app.** The plugin connects to the bridge over `ws://localhost`, which only works in the Figma **Desktop** app — the browser version cannot reach a local WebSocket server.
1. Open the Figma file you want to work in.
2. Run the plugin:
   - **Plugins → Development → Figma Write Bridge (Local)**
3. The plugin auto-connects using the defaults shown (**Server** `localhost:8787` — host and port in one field; `ws://` is added automatically, **Channel** `default`) — if the server is already running, the status flips to **Connected** with nothing else to click.
4. **Discovered servers** — on load (and via the **Scan** button) the plugin scans localhost ports `8787–8797` for running figma-write-bridge servers. Every running agent's MCP server appears in the dropdown, labelled `channel · host:port — fileName`. Picking one auto-fills **Server** + **Channel** and connects immediately, so with several agents you just choose which one should control this file.
5. **Channel** defaults to `default`. If you started the MCP server with a non-default `FIGMA_BRIDGE_CHANNEL` (see Channels below), type that same channel here so the plugin joins the right server. Only touch the fields if you changed `FIGMA_BRIDGE_PORT` or use a custom channel, then click **Connect**.

As long as the plugin stays open and connected, the bridge can send commands into this Figma file. If you close and reopen the plugin, it reconnects automatically the same way.

---

## Channels (One Plugin = One Channel / MCP Server)
A “channel” is just a name that targets the right Figma file through the right MCP server.

- By default the channel is `default`, and that is the only channel a single server needs.
- To run **multiple MCP servers** (e.g. one per Figma file/team), give each server its own port and channel:
  - Server A → `FIGMA_BRIDGE_PORT=8787`, `FIGMA_BRIDGE_CHANNEL=default`
  - Server B → `FIGMA_BRIDGE_PORT=8788`, `FIGMA_BRIDGE_CHANNEL=design` (or any custom name)

Then in each open Figma file, run the plugin and enter the matching server *host:port* and *channel* in the UI. Each plugin UI connects to exactly one channel / MCP server.

Your external tool can see and select channels per server:
- `figma_bridge_status` lists every connected channel with its `fileKey`/`fileName` on that server's WebSocket.
- `join_channel` switches which connected channel subsequent commands target.
- `list_channels` shows the dashboard of connected channels.

---

## Useful Notes / Safety
- The bridge is meant to run locally. By default it binds to `127.0.0.1` (only your computer can access it).
- Treat this like “edit access”: only run the bridge when you trust the tool/script driving it.
- Keep a backup: duplicate your Figma file before running large generations/changes.
- The plugin must remain open; if you close the plugin UI, the connection is lost.
- **Deleting top-level content requires confirmation**: `delete_node` / `delete_multiple_nodes` refuse to remove a **page**, a **top-level frame**, or a **top-level section** unless you pass `confirmFrameOrPageDeletion: true` — an explicit safety guard against wiping a whole page/frame in one call.

---

## Troubleshooting
- **Plugin says “Reconnecting…”**
  - Make sure `npm start` is running and no firewall is blocking port `8787`.
  - Confirm the WS URL matches the server (`ws://localhost:8787`). Both `localhost:8787` and `ws://localhost:8787` are accepted — the plugin adds the `ws://` prefix if it’s missing.
  - **Run the plugin in the Figma Desktop app** (not a browser tab) — the browser version cannot connect to a local WebSocket server.
  - If you changed the plugin code, **re-import the plugin from the manifest** (Plugins → Development → Import plugin from manifest…) — Figma caches the previously imported copy and does not pick up file changes automatically.

- **Server/tool says “Figma plugin not connected”**
  - Open the Figma file and run the plugin, then click **Connect**.
  - If you have multiple files, ensure you’re using the correct **Channel**.

- **“No servers found on ports 8787–8797”**
  - The dropdown only lists servers running inside the scan range. Make sure `npm start` (or your agent) is actually running, and that each server uses a `FIGMA_BRIDGE_PORT` in `8787–8797`. Otherwise type the `host:port` manually in **Server**.
  - Check a server directly with `curl http://127.0.0.1:8787/health`.

- **Port already in use**
  - Start the server on a different port by setting `FIGMA_BRIDGE_PORT`, then use the same port in the plugin UI WS URL.

---

## Advanced (Optional): Server Settings
Environment variables supported by the server:
- `FIGMA_BRIDGE_HOST` (default `127.0.0.1`)
- `FIGMA_BRIDGE_PORT` (default `8787`)
- `FIGMA_BRIDGE_CHANNEL` (default `default`; pin this to run multiple MCP servers, each on its own port)
- `FIGMA_BRIDGE_TIMEOUT_MS` (default `180000`)
- `FIGMA_BRIDGE_MAX_RESULT_BYTES` (default `50000`) — cap on a single tool result before it is truncated, to stop one big read from filling the agent's context. Raise it if you genuinely need a large single read.
- `FIGMA_TOKEN` (required for the REST API tools: `get_figma_data`, `download_figma_images`, comments, `export_frames_to_disk`, `search_components`)

Example (PowerShell):

```powershell
$env:FIGMA_BRIDGE_PORT="8790"
$env:FIGMA_BRIDGE_CHANNEL="default"
npm start
```

Then connect in Figma to `ws://localhost:8790` with Channel `default`.

> **Port already in use?** The server stops immediately with a clear message instead of silently failing. If you hit it, another `figma-write-bridge` instance is already bound to that port — stop it, use `FIGMA_BRIDGE_PORT` for a different one, and point the plugin UI at that new port (and matching channel).

> **Health check / discovery** — every server answers `GET http://127.0.0.1:<port>/health` on its WebSocket port with `{ "name": "figma-write-bridge", "wsUrl", "host", "port", "channel", "connectedChannels" }`. The Figma plugin uses this to populate the **Discovered servers** dropdown (scan range `8787–8797`, tunable via the `scanPortStart`/`scanPortCount` constants at the top of `figma-plugin/code.js`). You can also check a server yourself, e.g. `curl http://127.0.0.1:8787/health`.
