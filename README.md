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
In a terminal (PowerShell is fine), run:

```powershell
cd ${path/to/figma-write-bridge} // replace with your path to the repo
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
2. Add this to your agent’s MCP config file (paths must be absolute; on Windows, use `\\` in JSON strings):

```json
{
  "mcpServers": {
    "figma-write-bridge": {
      "command": "node",
      "args": [
        "${path/to/figma-write-bridge}/mcp-server.js" // replace with your path to the repo
      ],
      "env": {
        "FIGMA_BRIDGE_HOST": "127.0.0.1",
        "FIGMA_BRIDGE_PORT": "8787",
        "FIGMA_BRIDGE_CHANNEL": "default",
        "FIGMA_BRIDGE_TIMEOUT_MS": "180000"
      }
    }
  }
}
```

Notes:
- If your agent starts the MCP server automatically, do not also run `npm start` (only one process can use port `8787`).
- After adding the config, restart your AI agent app so it picks up the new server.

## Target Frames (Safety)
This bridge runs in a restricted “no delete” mode:
- Delete/remove/reset/clear actions are blocked.
- Write operations are only allowed inside the target frame(s) you set.

Recommended workflow:
1. In Figma, select the frame you want the AI to work on.
2. From your AI agent, call `get_selection` and take the selected frame `id`.
3. Call `set_target_frame` with that `frameId`.
4. Use create/edit tools to add content within that frame.

Tip: If you call `create_frame` (or `figma_create_frame`) with no target set, the created frame becomes the target automatically.

---

## Connect from Figma (Setup in Your File)
1. Open the Figma file you want to work in.
2. Run the plugin:
   - **Plugins → Development → Figma Write Bridge (Local)**
3. In the plugin UI:
   - **WS URL**: `ws://127.0.0.1:8787`
   - **Channel**: `default` (you can change this; see Channels below)
4. Click **Connect**.
5. Confirm the status shows **Connected**.

As long as the plugin stays open and connected, the bridge can send commands into this Figma file.

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

Example (PowerShell):

```powershell
$env:FIGMA_BRIDGE_PORT="8790"
npm start
```

Then connect in Figma to `ws://127.0.0.1:8790`.
