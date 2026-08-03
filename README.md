# Figma Write Bridge (for Designers)

Figma Write Bridge lets a local tool (like an AI assistant or a script) safely “write” into your open Figma file by connecting a Figma plugin to a local bridge server on your computer.

This repo contains:
- `figma-plugin/` — the Figma plugin (connects your Figma file to the bridge)
- `mcp-server.js` — the local bridge server (runs on your computer)
- `package.json` — Node.js setup (starts the server)

---

## What You’ll Use It For (Designer View)
- Let an assistant generate frames, text, shapes, styles, and structured layouts in your Figma file.
- Keep control: nothing happens unless your Figma file is open and the plugin is connected.

## What It Can Do
- **Frames, text, shapes, sections, and vectors** — create and edit nodes (including `create_section`, `create_vector` from SVG paths, and boolean groups).
- **Layout & structure** — auto layout, padding/spacing/alignment, layout grids, one-call grid generators (`generate_grid`), and layout helpers (`distribute_nodes`, `arrange_children`).
- **Fills & effects** — solid/gradient/image fills (from a URL, base64, or a local file path via `localPath`), shadows and blurs, and applying existing styles or variable-bound colors.
- **Text styling** — apply existing text styles or set font/font-size/line-height/letter-spacing/case/alignment directly, with variable binding. Generate a whole type scale from a base size + ratio with `create_typography_scale`.
- **Design tokens** — export local variables as a W3C-style Design Tokens JSON (`export_tokens`) and import a tokens JSON into variables + paint styles (`import_tokens`).
- **Style guides & palettes** — extract a usage style guide (`get_style_guide`: colors, fonts, sizes, spacing), list fonts used (`get_font_list`), and generate tonal color palettes with swatches/styles/variables (`generate_palette`).
- **Components** — create/import components and instances, and batch-convert frames into a variant component set (`extract_component_set`).
- **Undo/redo** — snapshot-based `undo` / `redo` for the most recent mutating actions (best-effort; cannot restore deleted nodes or structural changes).
- **Pages** — create, rename, duplicate, reorder, switch, and delete pages.
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

## Install the Figma Plugin (Development Plugin)
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
- `ws://127.0.0.1:8787`

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
        "FIGMA_BRIDGE_SECRET": "choose-a-random-shared-secret",
        "FIGMA_TOKEN": "your_figma_personal_access_token"
      }
    }
  }
}
```

Notes:
- If your agent starts the MCP server automatically, do not also run `npm start` (only one process can use port `8787`).
- After adding the config, restart your AI agent app so it picks up the new server.

## Authentication (Optional)
If you set `FIGMA_BRIDGE_SECRET` on the server, the plugin and any WebSocket client must send that same secret to join a channel, control the bridge, or query status — otherwise the connection is rejected and closed. To enable it:
1. Set `FIGMA_BRIDGE_SECRET` to a shared secret (see the MCP config above).
2. In the plugin UI, paste the same secret into the **Secret** field and click **Connect**.

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
1. Open the Figma file you want to work in.
2. Run the plugin:
   - **Plugins → Development → Figma Write Bridge (Local)**
3. The plugin auto-connects using the defaults shown (**WS URL** `ws://127.0.0.1:8787`, **Channel** `default`) — if the server is already running, the status flips to **Connected** with nothing else to click.
4. Only touch the fields if you changed `FIGMA_BRIDGE_PORT`, want a non-default channel (see Channels below), or set `FIGMA_BRIDGE_SECRET` (paste it into the **Secret** field), then click **Connect**.

As long as the plugin stays open and connected, the bridge can send commands into this Figma file. If you close and reopen the plugin, it reconnects automatically the same way.

---

## Channels (When You Have Multiple Files Open)
A “channel” is just a name that helps target the right Figma file.

Typical workflow:
- File A: channel `default`
- File B: channel `sandbox`
- File C: channel `design-system`

Set the channel in the plugin UI for each file. Then your external tool can select which channel to control.

---

## Useful Notes / Safety
- The bridge is meant to run locally. By default it binds to `127.0.0.1` (only your computer can access it).
- Treat this like “edit access”: only run the bridge when you trust the tool/script driving it.
- Keep a backup: duplicate your Figma file before running large generations/changes.
- The plugin must remain open; if you close the plugin UI, the connection is lost.

---

## Troubleshooting
- **Plugin says “Reconnecting…”**
  - Make sure `npm start` is running and no firewall is blocking port `8787`.
  - Confirm the WS URL matches the server (`ws://127.0.0.1:8787`).

- **Server/tool says “Figma plugin not connected”**
  - Open the Figma file and run the plugin, then click **Connect**.
  - If you have multiple files, ensure you’re using the correct **Channel**.

- **Port already in use**
  - Start the server on a different port by setting `FIGMA_BRIDGE_PORT`, then use the same port in the plugin UI WS URL.

---

## Advanced (Optional): Server Settings
Environment variables supported by the server:
- `FIGMA_BRIDGE_HOST` (default `127.0.0.1`)
- `FIGMA_BRIDGE_PORT` (default `8787`)
- `FIGMA_BRIDGE_CHANNEL` (default `default`)
- `FIGMA_BRIDGE_TIMEOUT_MS` (default `180000`)
- `FIGMA_BRIDGE_SECRET` (optional shared secret; if set, plugin/WebSocket clients must send it)
- `FIGMA_TOKEN` (required for the REST API tools: `get_figma_data`, `download_figma_images`, comments, `export_frames_to_disk`, `search_components`)

Example (PowerShell):

```powershell
$env:FIGMA_BRIDGE_PORT="8790"
npm start
```

Then connect in Figma to `ws://127.0.0.1:8790`.
