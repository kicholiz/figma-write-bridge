---
name: "figma-write-bridge"
description: "Controls an open Figma file through the local figma-write-bridge MCP server. Invoke when a user wants to inspect or edit Figma from the agent."
---

# Figma Write Bridge

Use this skill when the user wants you to read from, generate into, or modify an open Figma file through the local `figma-write-bridge` plugin and MCP server.

This skill is for local Figma editing, not code generation. It assumes:
- The Figma Desktop app is open (the plugin connects to the bridge over a local `ws://localhost` WebSocket, which only works in the Desktop app, not a browser tab).
- The `Figma Write Bridge (Local)` development plugin is running in the target file.
- The plugin UI is connected to the local bridge WebSocket.
- The agent has access to the bridge MCP tools.

## When To Invoke

Invoke this skill when the user asks to:
- inspect the current Figma selection or document structure
- generate UI frames, text, shapes, or layouts in Figma
- update copy, styling, spacing, auto layout, prototype links, variables, or annotations in Figma
- import design-system components/styles/variables into the current file
- work inside a specific selected frame or page in an open Figma file
- download file JSON or exports from the Figma REST API using `FIGMA_TOKEN`

Do not invoke this skill when:
- the task is purely about code, screenshots, or static design discussion
- the user has not connected the Figma plugin and does not want local Figma edits
- the user only wants a design spec written in markdown

## Component Reuse First (Mandatory)

**Never build UI from primitives when an existing component could do the job.** This rule applies to every screen, mockup, section, card, button, input, nav bar, modal — anything.

Before calling `create_frame`, `create_rectangle`, `create_text`, or `create_vector` for anything that looks like a UI element (not a bare layout container), you must have already:

1. **Loaded the file's component catalog.** Read `libraries/<fileKey>/file-library.md`. If it doesn't exist, build it first (see "First use in a file"). Do not start generating before the catalog exists — the first screen you build should already reuse the file's real components.
2. **Matched each planned element against the catalog.** Write out the mapping before you build: "header → `Nav/TopBar` (12:34)", "CTA → `Button` set, Variant=Primary (56:78)". Match on intent, not exact name — a `Card`, `ListItem`, or `Tile` in the catalog covers a "product card" request even if the names differ.
3. **Instantiated the match** with `create_component_instance` / `create_instance_from_component_key` / `create_instance_from_set_key`, then configured it with `set_instance_properties` — rather than recreating its visual appearance with frames and rectangles.

Primitives are only allowed for:
- layout containers (the page frame, section wrappers, auto-layout rows/columns) that hold instances
- genuinely one-off content with no catalog equivalent
- elements the user explicitly asked you to build from scratch

If a needed element has no catalog match, do not silently draw it from primitives. Say which element had no match and ask whether to create it as a new component (see "Component not found"), or get the user's OK to build it as a one-off.

Also reuse before creating at the token level: apply existing variables and styles from the catalog (`apply_*_style`, `bind_color_variable_to_fill`) instead of hardcoding hex values, sizes, and spacing.

### Building a new component: bind existing variables first

When you do create a new component (after the user confirms), it must be built on the file's existing variables and styles — a new component with hardcoded values is design-system drift, even if the component itself is new.

Before setting any value on the new component:

1. **Read the Variables section of `libraries/<fileKey>/file-library.md`** (and any split `file-library.variables.*.md` for the relevant collection). This is the token vocabulary you must build from.
2. **Map each property to an existing variable or style** — fills and strokes to COLOR variables, padding/gap/sizing/corner radius to FLOAT variables, typography to an existing text style. State the mapping alongside the component mapping.
3. **Bind rather than set.** Prefer `bind_color_variable_to_fill` / `bind_color_variable_to_stroke` / `bind_variable_to_property` and `apply_fill_style` / `apply_text_style` / `apply_effect_style` over raw `set_fill_color`, `set_padding`, `set_item_spacing`, and `set_corner_radius` with literal numbers.
4. **Pick the nearest semantic token, not the nearest hex.** If the design calls for a color close to an existing `color/bg/surface`, use that variable rather than creating a near-duplicate.

Only create new variables or styles when the file genuinely has none that fit — i.e. the collection is empty, or nothing in it is semantically close. When that happens:
- Tell the user which value had no existing token before creating one.
- Create it in the file's existing collection (`create_variable` / `create_paint_style`) rather than starting a new collection, unless the user asks otherwise.
- Append the new variable/style to `libraries/<fileKey>/file-library.md` immediately.

If the file has no variables at all, say so once, then proceed with literal values (or offer `generate_palette` / `create_typography_scale` / `import_tokens` to bootstrap a token set first).

In your final report, state which components you reused (by name), which variables/styles the new component binds to, and list anything you had to build from primitives or hardcode, with the reason.

## Safety Rules

Follow these rules on every run:
- Treat Figma edits as high-impact. Prefer small, reversible changes.
- Read first, then write.
- Always ask the user which frame or selection to target if that is ambiguous.
- Before editing, identify and set a target frame.
- Stay inside the agreed frame or frames.
- Do not delete, reset, clear, or bulk-restructure anything unless the user explicitly asks.
- Prefer creating new nodes or cloning existing ones over destructive changes.
- After major edits, re-read the affected nodes to verify the result.
- Never create a primitive stand-in for something the file already has as a component — see "Component Reuse First (Mandatory)" above; it governs every build task.

Target-frame enforcement:
- Once `set_target_frame` (or `clear_target_frames`) has been called, the plugin enforces it: edits/deletes on nodes outside the recorded target frame(s) are rejected, and single-target create actions are placed inside the target frame automatically. The server keeps the plugin's copy in sync, so enforcement survives plugin UI reloads.
- Still self-enforce scope discipline (pick a frame before writing, stay inside it) — enforcement is a safety net, not a substitute for choosing the right scope.
- Note: `bulk_rename`, `bulk_update`, `replace_all_instances`, and `set_variable_mode` only check that their `rootNodeId` is inside the target (they may touch descendants outside the frame when given a broad root); scope those calls explicitly.

## Required Preconditions

Before any editing session, verify:
1. The bridge is reachable with `figma_bridge_status`.
2. The expected channel is active (defaults to `default`; matches the server's `FIGMA_BRIDGE_CHANNEL`). Use `figma_bridge_status` to see it and `join_channel` if needed.
3. The correct Figma file is open via `get_document_info` or `figma_get_document_info`.
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

## File Library (Components + Variables)

To avoid re-reading the full component/variable catalog from Figma on every request (each `get_local_components`, `get_styles`, or `list_variables` round-trip costs tokens), this skill maintains one catalog file per Figma file under `libraries/<fileKey>/` in the project root (where `fileKey` comes from the Figma URL — the segment after `/design/` or `/file/`):

- `libraries/<fileKey>/file-library.md` — every local component and every local variable of that Figma file, in one file (plus any split files it points to — see "Capping large libraries").

`libraries/index.md` maps each file key to its file name/channel (the channel is the one of the MCP server that file is reached through — `default` by default) and the library path. **Read only the library for the file you are currently working in** — confirm the file with `get_document_info` (returns `fileKey`) or `figma_bridge_status`, then read `libraries/<fileKey>/file-library.md`. Never read or use another file's `libraries/<fileKey>/` folder — those catalogs belong to a different Figma file and do not apply here.

**Whenever a Figma file is opened (the first tool call of a session), check for `libraries/<fileKey>/file-library.md` before doing anything else.** If it exists, this file's design system is already cataloged — when creating mockups, screens, or any new UI, prefer instantiating the components listed there over building frames/shapes from primitives. If it doesn't exist yet, build it once (see "First use in a file" below) before generating anything, so the very first screen you build already reuses the file's real components.

### First use in a file

Before the first read/write of a session, get the current file's key (via `figma_bridge_status` or `get_document_info`) and check whether `libraries/<fileKey>/file-library.md` already exists.

If it does **not** exist yet, this is the first time the plugin is being used against this Figma file. Build it now:

1. Confirm the bridge and file via `figma_bridge_status` and `get_document_info`.
2. If you don't already know the Figma file's URL (needed to build component links), ask the user for it once. Extract the file key from the URL (the segment after `/design/` or `/file/`).
3. Call `get_local_components` to enumerate every component and component set in the file (this also returns `description`, `key`, and simplified `componentPropertyDefinitions` — no extra per-component calls needed). It is paged: returns `{ components, total, offset, limit, pageCount }` — page with `offset`/`limit` (default 500) until you've collected `total` entries.
4. For each component/component set, record: name, type (`COMPONENT` or `COMPONENT_SET`), node id, description if available, its property names/types (from `componentPropertyDefinitions`, omit if none), and a direct Figma URL built as `https://www.figma.com/design/<fileKey>/<file-name>?node-id=<nodeId with ":" replaced by "-">`.
5. Call `list_variable_collections` (few, never paged) and `list_variables` to enumerate every variable — page `list_variables` with `offset`/`limit` (default 500). Omit `includeValues` for the catalog (metadata only); use `list_variables({includeValues:true})` or targeted reads when you actually need values.
6. Write `libraries/<fileKey>/file-library.md` with two sections:

   ```markdown
   # File Library — <file name>

   ## Components

   | Name | Type | Description | Properties | Node ID | URL |
   |------|------|-------------|------------|---------|-----|
   | Button | COMPONENT_SET | Primary/secondary/ghost button | Variant: Style(Primary/Secondary/Ghost), Boolean: Disabled | 12:34 | https://www.figma.com/design/... |

   ## Variables

   ### <Collection name> (modes: Light, Dark)

   | Name | Type | Light | Dark |
   |------|------|-------|------|
   | color/bg/primary | COLOR | #FFFFFF | #111111 |
   ```

   The Properties column is a cache of `componentPropertyDefinitions` — read it instead of calling `get_component_property_definitions` or `get_instance_properties` again just to learn what properties a component exposes. Only call those tools live when you need an instance's *current* values, not its schema. The Node ID / URL columns are what let you retrieve or instantiate a component cheaply (`create_instance_from_component_key` / `create_instance_from_set_key` with the key, or the URL to open it) without a live lookup.

7. Add (or update) the row for this file in `libraries/index.md`, then tell the user the file library was created and will be used going forward instead of re-scanning the file.

If a component genuinely has no `description` exposed by the tooling, leave that cell blank rather than guessing.

### Capping large libraries

Large design systems can blow the same token budget this skill is trying to save. Apply these caps when building or refreshing `file-library.md`:
- If the Variables section would exceed roughly 150 rows total, split it per collection into `libraries/<fileKey>/file-library.variables.<collection-slug>.md` files instead of inlining them, and leave a short index under `## Variables` in `file-library.md` listing each collection file and its row count.
- If the Components section would exceed roughly 100 rows, group it into subsections by page or by name prefix (e.g. `### Atoms`, `### Molecules`) within `file-library.md` itself rather than splitting into separate files — components are looked up by name/type more often than filtered by collection, so one indexed file stays more useful.
- When reading a split library back, only read the specific collection/section file relevant to the current task, not every file.

### Reconcile / prune (trigger: "update library")

`file-library.md` only ever gets appended to during normal work, so it can drift from the live file (renamed, deleted, or orphaned entries). When the user's message contains phrasing like "update library", "refresh library", or "sync library":
1. Re-run `get_local_components` and `list_variable_collections`/`list_variables` fully.
2. Diff the live results against the existing Components and Variables sections of `libraries/<fileKey>/file-library.md` by id.
3. Remove rows whose id no longer exists live; update rows whose name/description/properties/value changed; add rows that are new.
4. Rewrite the file with the reconciled table(s) — don't just append.
5. Report a one-line diff summary to the user (e.g. "removed 2 stale components, updated 1 description, added 3 new variables") rather than re-printing the whole table.

Do not run this reconcile pass automatically on every turn — only on the explicit trigger phrase above, or when a lookup miss suggests the library is stale (see "Component not found").

### Every subsequent use

If `libraries/<fileKey>/file-library.md` already exists for the current file:
- Read it directly (a plain file read) instead of calling `get_local_components`, `get_styles`, or `list_variables` to answer "what components/variables exist" questions.
- Only fall back to the live tools when:
  - a lookup in the library file misses (see "Component not found" below),
  - the user says the file's components/variables changed, or
  - the library file looks stale/empty relative to what's on canvas.
- When a live refresh is needed, only re-scan what changed if possible; otherwise re-run the full build steps above and overwrite the file.
- Whenever you create a new component, style, or variable, append the new entry to the relevant section of `libraries/<fileKey>/file-library.md` immediately so it stays in sync without a full re-scan next time.

### Component not found

If the user asks to use or place a component by name and it is not present in `libraries/<fileKey>/file-library.md` (or, if no library file exists yet, not found via `get_local_components`):
- Do not silently substitute a plain frame/rectangle for it.
- Ask the user: "I couldn't find a '<name>' component in this file. Would you like me to create it as a new component?"
- Only proceed to `create_component` / `create_component_from_node` / `combine_as_variants` after they confirm.
- Build it against the file's existing variables and styles — see "Building a new component: bind existing variables first". Do not hardcode colors, spacing, radii, or type when a token exists.
- After creating it, append the new entry to `libraries/<fileKey>/file-library.md` right away.

## Dev Handoff Annotations (Screens)

**Any screen you create is not finished until it is annotated for dev handoff.** A screen that only looks right is half-delivered — the engineer reading it needs the intent that isn't visible on canvas. Annotate as the final step of building a screen, before you report back, without waiting to be asked.

Use `set_multiple_annotations` (one batched call, not one `set_annotation` per node) with `labelMarkdown` for the note. Note that setting an annotation **replaces** that node's existing annotations, so call `get_annotations` first if you're adding to a screen that already has some, and re-send the merged set.

### What to annotate

Cover these on every screen — skip a category only when it genuinely doesn't apply:

- **The screen frame itself** — what the screen is, its entry point, and any route/state it represents.
- **Components used** — for each instance, name the source component and the variant/property values set (e.g. "`Button` set — Variant=Primary, Size=Large, Disabled=false"). This is what tells the engineer to reach for the existing coded component instead of rebuilding it.
- **Interactive elements** — what each button/link/input does: target screen, submit action, validation rules, disabled conditions.
- **States not drawn on canvas** — loading, empty, error, disabled, hover/focus, and what triggers each. If you only built the happy path, annotate that explicitly rather than leaving it implied.
- **Content rules** — which text is static vs. dynamic, data source, truncation/overflow behavior, character limits, pluralization, date/number formatting.
- **Responsive intent** — which elements fill vs. hug, min/max widths, wrap and reflow behavior, breakpoint differences.
- **Tokens** — where a value is deliberately a specific variable/style, and anything intentionally hardcoded (with the reason).
- **Accessibility** — heading order, alt text for meaningful images, focus order, label associations, and anything with a non-obvious accessible name.
- **Open questions** — anything you assumed while building. Annotate the assumption on the node rather than only mentioning it in chat, so it survives the handoff.

Attach each annotation to the **node it describes** (the button, the input, the list) rather than piling everything onto the screen frame. Use `properties` (e.g. width, fill, spacing entries) when you want Figma to pin the live measured value alongside your note instead of restating a number that can drift.

Use `categoryId` consistently if the file has annotation categories — read them with `get_annotations` (`includeCategories: true`) and reuse the existing ones instead of inventing new labels.

### Related handoff setup

While you're finishing a screen, also make sure the prototype layer is coherent, since it's part of what dev reads:
- `set_reactions` / `upsert_reaction` so interactive elements actually point at their destinations
- `set_prototype_start_node` / `set_flow_starting_points` so the flow has a named entry point

Keep annotations short and specific — one to three sentences per node. They're a spec, not prose; long paragraphs get ignored on canvas.

If the user explicitly says they don't want annotations, skip them — but say once that the screen is going out without handoff notes.

## Standard Workflow

### 0. Load Local Catalogs
- Get the current file's key (`figma_bridge_status` / `get_document_info`), then check for `libraries/<fileKey>/file-library.md`.
- If present, read it now for context before making any Figma calls — every screen/mockup you build this session must be assembled from its cataloged components, not primitives (see "Component Reuse First").
- If absent, follow "First use in a file" above once preflight succeeds. Do not start building until it exists.
- Before any build step, plan the element → component mapping against the catalog and state it to the user.

### 1. Preflight
Run this fully only once per session (or after a reconnect):
- `figma_bridge_status`
- `get_document_info` or `figma_get_document_info`
- `get_selection` or `figma_get_selection`

If multiple files may be open:
- confirm the correct channel (it must match the `FIGMA_BRIDGE_CHANNEL` of the MCP server you're using — `default` unless overridden)
- call `join_channel` before editing

Once bridge, channel, and file have been confirmed successfully earlier in the same session, do not re-run `figma_bridge_status` or `get_document_info` before every subsequent message — reuse what you already know. Only re-check when:
- a tool call fails or times out (connection may have dropped),
- the user says they reopened Figma, switched files, or switched channels, or
- a meaningful gap has passed and you have reason to think state changed.
`get_selection` is the exception — the user's selection can change between messages, so re-check it whenever the task depends on "the current selection" rather than a previously captured node id.

### 2. Scope The Work
If the user wants edits inside an existing frame:
- ask them to select the frame in Figma, or identify it from returned node info
- call `get_selection`
- extract the selected frame `id`
- call `set_target_frame` with that `frameId`

If no frame exists yet:
- create one with `create_frame` or `figma_create_frame`
- then immediately treat the new frame as the active work area

Even after `set_target_frame`, still manually avoid touching unrelated nodes.

### 3. Inspect Before Editing
Check `libraries/<fileKey>/file-library.md` first for anything about known components, styles, or variables — only fall back to live tools for what it doesn't answer:
- `get_all_pages` once when you need a map of the whole file, or `get_document_tree` (with `maxDepth`/`excludeTypes`) to read an entire page/frame's structure and text in one compact call instead of many node reads
- `read_my_design` for rich details on the current selection (pass `maxDepth`/`excludeTypes` to limit the read)
- `get_node_info` for a single node
- `get_nodes_info` for several known nodes
- `scan_text_nodes` to find text to update
- `get_styles` to inspect local styles
- `get_local_components` to inspect reusable components
- `scan_instances_with_sources` and `get_instance_source` to understand instance provenance
- `list_variable_collections` and `list_variables` to inspect local variables

### 4. Choose The Least Risky Mutation
Prefer this order:
1. update existing text or instance properties
2. apply existing styles, variables, or components
3. instantiate a cataloged component (`create_instance_from_component_key` / `create_instance_from_set_key` / `create_component_instance`) — this is the default way to add UI
4. clone existing nodes when that preserves structure better
5. create new primitive nodes inside the target frame — only for layout containers or elements with no catalog match (see "Component Reuse First")
6. only use deletion if the user explicitly requested it

### 5. Verify
After edits:
- re-run `get_node_info`, `get_nodes_info`, or `read_my_design`
- confirm names, text, position, sizing, and styles
- if you built a screen, confirm it is annotated for dev handoff (`get_annotations`) before reporting done
- summarize exactly what changed

## Tool Guide

### Core Status And Routing
- `figma_bridge_status`: confirm the bridge is connected; reports the active channel (the server's `FIGMA_BRIDGE_CHANNEL`, `default` unless overridden) and every connected channel with its `fileKey`/`fileName`
- `join_channel`: switch the active channel to a different connected Figma file/channel (channel names come from `figma_bridge_status`)
- `list_channels`: dashboard of every connected plugin channel with its fileKey/fileName and connection time (useful when several files are open)

### Columnar results

Five bulk reads — `get_document_tree`, `scan_text_nodes`, `scan_nodes_by_types`, `get_local_components`, and `find_nodes` — return a **columnar table** instead of an array of objects, which cuts ~30% of the tokens on large results:

```json
{ "fields": ["depth", "id", "name", "type"],
  "rows": [[0, "0:1", "Page 1", "PAGE"],
           [1, "1:2", "Hero", "FRAME"]] }
```

`fields` names the columns; each entry in `rows` lines up with it positionally. A missing value is `null`.

For `get_document_tree` the rows are a **pre-order traversal** with a `depth` column: `depth: 0` is the root, and each row is a child of the nearest preceding row with `depth - 1`. This reconstructs the nesting exactly — no `children` arrays needed.

Pass `verbose: true` to any of the four to get the original array-of-objects (or nested tree) shape back.

### Read / Inspect
- `get_document_info` — current page's name/id/type/fileKey, its child nodes, `currentPage`, plus a `pages` list covering **every** page in the file (id/name/childCount), so one call gives the full-page overview without a separate `get_all_pages`.
- `get_all_pages` — compact map of every page (id/name/childCount). Pass `includeTopLevel: true` to also list each page's top-level frames. Call once for a full-file overview.
- `get_document_tree` — compact structural tree of the whole file (or one subtree). Every node is `{id, name, type}`; no extra fields unless requested. Default `maxDepth` is 3 to bound output; pass `fields: ["characters"]` to include TEXT content and a larger `maxDepth` for deeper expansion. Use `rootNodeId` to scope to a frame/page, `excludeTypes: ["VECTOR"]` to drop icon/vector noise, and `fields` to pull extra per-node values (e.g. `["fills","absoluteBoundingBox"]`) only when you need them. Returns a **columnar table** — see below.
- `get_selection`
- `get_selection_context` — bundles selection + node info + (for instances) main component id, property definitions, current property values, and slots in one call. Prefer this over chaining `get_selection` → `get_node_info` → `get_component_property_definitions` when you need more than just id/name/type.
- `find_nodes` — server-side predicate query; the node graph is filtered inside Figma and only matches come back, so "all red button instances" or "all hardcoded fills with no style" costs a handful of rows instead of a full tree dump filtered in context. Predicates (all optional, ANDed): `types`, `name` (glob), `nameRegex`, `textContains`, `fillHex` (+ `fillTolerance` for near-shades), `fillStyleId`, `textStyleId`, `missingFillStyle` (hardcoded color with no style/variable — design-system drift), `hasBoundVariable`/`boundVariableId`, `hasOverrides`/`mainComponentName` (instances), `visible`, `rootNodeId`, `allPages`. Paginate with `limit`/`offset`; `total`/`truncated` reflect the full match count, not just the returned page. Prefer this over `scan_nodes_by_types` or `get_document_tree` + manual filtering whenever the query is more selective than "give me every node of type X".
- `read_my_design`
- `get_node_info`
- `get_nodes_info`
- `scan_text_nodes`
- `scan_instances_with_sources`
- `get_instance_source`
- `get_styles`
- `get_local_components`
- `list_variable_collections` — lists every collection with its modes (id/name). Use this first to discover mode ids/names (few collections — never paged).
- `list_variables` — list local variables, paged: returns `{ variables, total, offset, limit, pageCount }` (default `limit` 500) — page with `offset` until you reach `total` to enumerate every variable without one huge response. Pass `includeValues: true` to read each variable's value in **every** mode (`valuesByMode` keyed by modeId, `valuesByModeName` keyed by mode name, `defaultValue` from the collection's first mode, plus the mode list). This is how you read theme/dark-mode values. `set_variable_values` / `create_variable` accept `valuesByMode` keyed by mode id, mode name, or mode index to write into any mode.
- `get_annotations`
- `get_reactions`
- `get_changes_since` — pass the `currentSeq` from a previous call as `sinceSeq` to get back only the node ids this bridge has mutated since then, instead of re-reading the whole document to see what changed. Cursor resets when the MCP server restarts.
- `get_events` — read Figma events pushed by the plugin (selectionchange/documentchange) since a `sinceSeq` cursor. Pair with `subscribe_events` / `unsubscribe_events`. Handy to react to the user's live selection or canvas changes without polling `get_selection`.
- `get_font_list` — distinct fonts (family + style) used on the current page or a `rootNodeId` subtree, with usage counts. Use this before deciding whether a new `create_text_style` can reuse an existing family.
- `get_style_guide` — extract a usage style guide from the current page (or a `rootNodeId` subtree): counted solid colors (hex), color variable bindings, font combos/sizes/line heights, spacing/gap/padding values, corner radii, stroke weights, and opacities. Use it to summarize "what does this page use" without dumping raw nodes.

`get_node_info`, `get_nodes_info`, and `read_my_design` also accept a `fields` array (e.g. `["fills"]` or `["characters"]`) to return only those top-level fields per node instead of the full set — use it when you only need one or two properties across many nodes.

### Batch Execution
- `run_batch` — runs a list of `{action, payload}` steps in one round trip instead of one tool call per step. Sequential, stops on first error by default (`stopOnError: false` to keep going). Not a transaction — pair it with `create_checkpoint` first if you need a rollback path. Prefer this whenever you're about to make more than ~3 related edits in a row (e.g. styling a row of buttons).

### Checkpoints (Best-Effort Undo)
- `create_checkpoint` / `restore_checkpoint` / `list_checkpoints` — snapshot and restore position, size, rotation, opacity, visibility, fills, strokes, corner radius, and text characters on specific nodes. This is not real undo: it can't restore a deleted node or undo structural changes (reparenting, added/removed children), and it's lost if the plugin UI reloads. Use it before a risky batch of property edits on existing nodes, not as a substitute for asking the user before destructive structural changes.
- `undo` / `redo` — snapshot-based undo/redo stacks. Every mutating action in the built-in allowlist (property edits like move/resize/fills/strokes/text/layout/effects/variable-binding, plus `distribute_nodes`/`arrange_children`) is auto-captured with before/after state as it runs, and `undo` reverses the most recent one (redo re-applies it). Same limits as checkpoints: cannot restore deleted nodes or structural changes, and the stacks are lost on plugin UI reload. Prefer `create_checkpoint` for anything you want to be able to restore after a multi-step batch — the undo stack only tracks the single most recent action (with redo), not an arbitrary restore point.

### Find And Replace
- `find_and_replace_text` — search TEXT node characters (literal or regex) and replace matches, optionally across every page (`allPages: true`), not just the current one. Always try `dryRun: true` first on anything touching more than a handful of nodes or `allPages: true`, review the returned matches, then re-run without `dryRun` to commit.

### Frame Scope
- `set_target_frame` — enforced by the plugin once set (edits outside are rejected; single-target creates are placed inside automatically)
- `get_target_frames`
- `clear_target_frames`

### Create
- `create_frame`
- `create_rectangle`
- `create_text`
- `create_section`
- `create_vector` (from SVG path data)
- `generate_grid` (columns x rows, clones `itemNodeId` or makes rectangles; `{i}` in name = running index)
- `create_component_instance`
- `create_instance_from_component_key`
- `create_instance_from_set_key`

### Update Nodes
- `rename_node`
- `move_node` — absolute `x`/`y` or relative `dx`/`dy`; children of auto-layout parents are switched to absolute positioning so they can move freely
- `reparent_node` (optional `index`) / `insert_child` — move (cut) any existing node into/out of frames, sections, groups, auto-layouts, slots, and pages; `index` controls order inside auto-layout containers
- `get_parent_chain`
- `resize_node`
- `resize_to_fit` — two modes: (1) pass `targetNodeId` to scale the layer to fit inside that layer (aspect-preserving, centered; `fit: "contain"` letterboxes, `fit: "cover"` fills and crops); (2) omit `targetNodeId` to shrink-wrap the container tightly to its own children (Figma's "Resize to Fit")
- `set_fill_color`
- `set_stroke_color`
- `set_corner_radius`
- `set_text_content`
- `set_multiple_text_contents`
- `set_text_style` (apply an existing text style and/or fine-grained typography + variable binding)

### Fills & Effects
- `set_image_fill` — IMAGE fill from a URL, raw base64, or a local file via `localPath` (the server reads the file to base64); `scaleMode` FILL/FIT/CROP/TILE, `paintIndex`, `rotation`
- `set_gradient_fill` — LINEAR/RADIAL/ANGULAR/DIAMOND with `stops`, optional `from`/`to` transform points, `opacity`, `paintIndex`
- `set_effects` — raw effects (DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR) or apply an existing `effectStyleId`; `boundVariables.color` binds a variable

### Vector & Structure
- `set_vector_paths` — replace SVG path data on a VECTOR
- `boolean_group` — combine 2+ vector nodes (UNION/SUBTRACT/INTERSECT/EXCLUDE)
- `group_nodes` / `ungroup_node`
- `create_section` — SECTION node with optional fill and `sectionProperties`
- `set_section_properties` — edit an existing SECTION's `sectionType` (SECTION|VIEWPORT) or raw `sectionProperties`

### Pages
- `create_page` / `rename_page` / `duplicate_page` / `set_current_page` / `reorder_page` — `create_page` and `duplicate_page` accept `activate: true` to switch to the new page; `duplicate_page` auto-suffixes the name (`Name 2`, `Name 3`…) unless `name` is given
- `delete_page` (requires `confirmDelete: true`)
- `move_node_to_page` — move (cut) or copy (`copy: true`) a top-level node (frame/section/component/instance) to another page

### Bulk Operations
- `bulk_rename` — find/replace in node names across a subtree (regex + `dryRun` supported)
- `bulk_update` — apply one property (`fillColor`, `cornerRadius`, `opacity`, `visible`, `name`, `fillStyle`, `textStyle`, `cornerRadii`) to many nodes
- `replace_all_instances` — swap every instance of a component key to another (`dryRun` supported)

### Theme Switching & Variable Modes
- `set_variable_mode` — theme switch: set a mode on many nodes at once (`modeId` can be an id or exact name; scope via `nodeIds`/`rootNodeId`/whole page)
- `create_variable_mode` / `rename_variable_mode` / `delete_variable_mode` (delete needs `confirmDelete`)
- `rename_variable_collection`

### Events (Push from Figma)
- `subscribe_events` / `unsubscribe_events` — enable/disable push of `selectionchange` / `documentchange`
- `get_events` — read the pushed events since a `sinceSeq` cursor

### Layout
- `set_auto_layout`
- `set_layout_mode`
- `set_padding`
- `set_axis_align`
- `set_layout_sizing`
- `set_item_spacing`
- `set_layout_grids`
- `distribute_nodes` — space/align an arbitrary set of nodes along `axis` (horizontal|vertical): `mode` `gap` (fixed `gap`), `spaceBetween`/`evenly` (fill bounds), or `center`; `crossAlign` none|start|center|end; `bounds {x1,y1,x2,y2}` overrides the default parent-based bounds. Auto-layout children are switched to absolute positioning first.
- `arrange_children` — same distribution options applied to the direct children of a `parentNodeId`. On auto-layout parents it is skipped with a notice (layout already arranges them).

### Design Tokens
- `export_tokens` — dump all local variables as a W3C-style Design Tokens JSON (nested by collection/variable name, colors as hex) plus a flat `variables` list; `includeModes: false` skips the per-mode views. Handy to snapshot a file's token set for reuse across files or to send to the user as a spec.
- `import_tokens` — create/update variables from a W3C-style tokens object (nested `{group:{name:{$type,$value}}}` or plain nested values; types inferred from `$type` or the value shape). Creates/reuses the `collectionName` collection (default "Design Tokens") and Default mode. `color` → COLOR variable + paint style, `number`/`dimension` → FLOAT, `string` → STRING, `boolean` → BOOLEAN. Use it to apply a brand palette/token spec into the file.

### Typography & Palettes
- `create_typography_scale` — create a text-style scale from `baseSize` + `ratio` (fontSize = base × ratio^offset) over default steps caption/body/h3/h2/h1/display (or `steps`); optionally `createSampleFrame` for labeled sample text nodes. Use when starting a fresh type ramp instead of hand-creating each `create_text_style`.
- `generate_palette` — build a tonal 50…900 palette (default 10 steps) from a seed `hex`; optionally create paint styles, COLOR variables in a `<Name> Tokens` collection, and a labeled swatch frame. Use to bootstrap a color system quickly.

### Components And Libraries
- `import_component_by_key` / `import_component_set_by_key` — import into the current file (optional `name` renames the imported main node)
- `move_component_to_file` — move (or copy with `mode: 'copy'`) a local component/component-set to another connected channel's file by `componentId`/`componentKey`/`componentName`
- `get_instance_properties`
- `set_instance_properties`
- `swap_instance_component`
- `create_component_slot`
- `edit_component_slot`
- `delete_component_slot`
- `get_instance_slots`
- `append_to_slot`
- `extract_component_set` — batch-convert 2+ frames (or existing components) into a variant COMPONENT_SET via combine_as_variants. Pass `propertyName` to attempt adding a VARIANT property (best-effort; if it fails, author properties with `add_component_property` / name variants with `set_variant_properties` afterwards). Use when the user wants a set of screens/states turned into one variant component.

### Styles
- `create_paint_style`
- `create_text_style`
- `create_effect_style`
- `create_grid_style`
- `import_style_by_key`
- `apply_fill_style`
- `apply_stroke_style`
- `apply_text_style`
- `apply_effect_style`
- `apply_grid_style`

### Variables
- `create_variable_collection`
- `create_variable`
- `set_variable_values`
- `rename_variable`
- `import_variable_by_key`
- `bind_color_variable_to_fill`
- `bind_color_variable_to_stroke`
- `bind_variable_to_property`
- `set_node_explicit_variable_mode`

### Prototype / Metadata
- `get_reactions`
- `set_reactions`
- `clear_reactions`
- `upsert_reaction`
- `set_transition_reaction`
- `set_smart_animate_reaction`
- `get_animation_presets`
- `get_overlay_settings`
- `set_overlay_settings`
- `get_prototype_settings`
- `set_prototype_start_node`
- `set_flow_starting_points`
- `set_overflow_direction`
- `set_fixed_children`
- `set_annotation`
- `set_multiple_annotations`

### Export / REST API
These require a configured `FIGMA_TOKEN` for REST access:
- `get_figma_data`
- `download_figma_images`
- `export_frames_to_disk` — bulk-export a set of frames or a whole page (`pageId`) to PNG/JPG/SVG/PDF inside the repo
- `list_comments` / `post_comment` / `delete_comment` — file comments
- `search_components` — find components/component-sets via `/v1/me/components` (or `/v1/team/{teamId}/components`); filter by `fileKey`, `pageSize`, and `type` (`component`|`set`). Use to discover a component's `key` across your account/team without the file open locally.

Use them when the user wants:
- file JSON
- node JSON from a remote file
- exported assets saved locally
- a snapshot/export of many frames at once
- to read or leave comments on a Figma file
- to find a component key from a remote file/team

Related: `export_node_as_image` (plugin-side, no token needed) also accepts a `localPath` to save the rendered node to disk instead of returning base64.

## Preferred Decision Heuristics

### For text updates
Use:
- `scan_text_nodes` to locate candidates
- `set_text_content` for one node
- `set_multiple_text_contents` for batch updates when you already know the id -> new text mapping
- `find_and_replace_text` (with `dryRun: true` first) when you're matching by content/pattern rather than by known node id, or when the same fix needs to apply across every page

Avoid creating replacement text layers if existing text nodes can be updated safely.

### For component-based design systems
Prefer:
- checking `libraries/<fileKey>/file-library.md` first for the component's id/key/url before calling any live lookup tool
- `get_selection_context` when the user is pointing at something already selected in Figma and you need its full editable surface (properties, slots, bound properties) in one call
- `scan_instances_with_sources`
- `get_instance_source`
- `import_component_by_key` or `import_component_set_by_key`
- `create_instance_from_component_key` or `create_instance_from_set_key`
- `set_instance_properties`
- `create_component_slot` / `edit_component_slot` / `delete_component_slot` for authoring SLOT properties on a component; `get_instance_slots` / `append_to_slot` for filling them on an instance

Avoid detaching or rebuilding instances unless the user explicitly asks. If a named component isn't in `libraries/<fileKey>/file-library.md` or on canvas, ask the user before creating it (see "Component not found" above).

### For layout work
Prefer:
- creating or identifying a parent frame first
- `set_auto_layout` for bundled changes
- `set_padding`, `set_item_spacing`, and `set_axis_align` for targeted fixes
- `arrange_children` (parent-based) or `distribute_nodes` (arbitrary id set) to space/align existing absolute-positioned nodes; use `mode: "spaceBetween"` when the user wants them spread to fill a container, or the default `gap` mode for even fixed spacing
- `generate_grid` for a fresh repeating grid of clones

Avoid absolute-positioning everything if auto layout is already being used.

### For design-system generation
Prefer:
- reading the Variables section of `libraries/<fileKey>/file-library.md` first — build on the tokens that already exist before adding any new ones
- `get_style_guide` next to see what colors/fonts/spacing the file already leans on, then:
- `generate_palette` to bootstrap a tonal palette (styles + variables + swatch frame) from one brand hex
- `create_typography_scale` to build the type ramp instead of dozens of `create_text_style` calls
- `import_tokens` to apply a full W3C token spec (colors → variables + paint styles), or `export_tokens` to snapshot the file's variables as tokens JSON
- `extract_component_set` to turn existing frames into a variant component set, then `add_component_property` / `set_variant_properties` to author variant properties
- update `libraries/<fileKey>/file-library.md` after these tools create new variables/styles/components

### For multi-step edits
When a request decomposes into more than ~3 independent bridge calls (e.g. "make all 5 buttons in this row the same fill and corner radius"), prefer one `run_batch` call over 5 separate tool calls — it's one WebSocket round trip instead of five, and you still get a per-step result/error back. For edits with meaningful blast radius on existing nodes, call `create_checkpoint` on the affected nodeIds first so you have a `restore_checkpoint` fallback if the batch produces something the user doesn't want. For quick single property edits, `undo` / `redo` can reverse the last action without a checkpoint, but don't rely on it across a long batch — checkpoints are the durable restore path.

### For prototyping / motion
Use:
- `set_transition_reaction` / `set_smart_animate_reaction` for node-to-node interactions with typed transition/easing payloads
- `set_reactions` / `upsert_reaction` directly when you need multiple actions on one trigger (pass `actions: [...]` instead of a single `action`)
- `get_overlay_settings` / `set_overlay_settings` when the reaction's navigation is `OVERLAY`, to configure anchor position, scrim background, and click-outside-to-close
- `get_prototype_settings` / `set_prototype_start_node` / `set_flow_starting_points` for the Present entry point and named Flows

Smart Animate itself has no scriptable keyframe/timeline API to call into — it always auto-interpolates between two frames/variants based on the duration+easing you set. There's nothing beyond the reaction/transition tools above to reach for.

### For styling
Prefer:
- checking `libraries/<fileKey>/file-library.md` first for existing tokens before calling `list_variables` or `get_styles`
- applying existing styles and variables before creating new local styles
- `apply_*_style` when a matching style already exists
- variable binding when the file uses variables semantically

### For fills, images, and effects
Prefer:
- `apply_fill_style` when a paint style already exists; otherwise `set_fill_color` for solid, `set_gradient_fill` for gradients, `set_image_fill` for images
- `set_image_fill` with `localPath` (absolute or repo-relative path to an image on disk) instead of a remote `url` when the asset is already local — the server reads it directly; be mindful that very large files inflate the WebSocket payload
- applying an existing `effectStyleId` before authoring raw `effects`
- always passing `paintIndex` explicitly when the node already has multiple fills (e.g. an image on top of a solid)

### For page / bulk / template work
Prefer:
- `duplicate_page` when starting from an existing page layout rather than rebuilding it
- `generate_grid` for repetitive card/tile grids; pass `itemNodeId` to clone an existing card and `{i}` in `name` to number them
- `bulk_rename` with `dryRun: true` first when the match could hit many nodes
- `replace_all_instances` with `dryRun: true` first before swapping a component everywhere
- `run_batch` to combine several of these into one round trip

### For theme switching
Prefer:
- `set_variable_mode` to switch a frame's mode (or whole page) instead of overwriting fills by hand when the file uses variables
- verify the target collection/mode ids via `list_variable_collections` / `list_variables` first (the tool accepts exact mode names too)

### For reacting to the user's canvas
Prefer:
- `subscribe_events` (selectionchange/documentchange) + `get_events` when you need to watch the user's live selection or canvas changes over a session, instead of polling `get_selection`

### For destructive changes
Only use:
- `delete_node`
- `delete_multiple_nodes`
- `delete_variable`
- `delete_variable_mode`
- `delete_page`
- `clear_reactions`

when the user clearly asked for removal or reset-like behavior.

**Deleting top-level content needs explicit confirmation.** `delete_node` / `delete_multiple_nodes` refuse to remove a **page**, a **top-level frame**, or a **top-level section** unless you pass `confirmFrameOrPageDeletion: true` on the same call. When the user asks you to delete such a node, pass that flag; do not surprise-delete large top-level content without it.

## Recommended Interaction Pattern

Use this sequence for most editing tasks:
1. Load the current file's `libraries/<fileKey>/file-library.md` if present, or build it on first use, then map every planned element to a cataloged component before building (see "Component Reuse First" — this step is mandatory, not a preference).
2. Confirm bridge and file with `figma_bridge_status` and `get_document_info` — skip this step if already confirmed earlier in the session (see Preflight).
3. Confirm selection with `get_selection`.
4. Set scope with `set_target_frame`.
5. Inspect the target node tree with `read_my_design` or `get_node_info` (pass `maxDepth`/`excludeTypes` when you only need a shallow read).
6. Make the smallest viable edit.
7. If you built a screen, annotate it for dev handoff (see "Dev Handoff Annotations").
8. Re-read the affected nodes.
9. Report what changed and any limitations.

## Example Playbooks

### Update copy in a selected frame
1. `get_selection`
2. `set_target_frame`
3. `scan_text_nodes` with the selected frame as `rootNodeId`
4. `set_multiple_text_contents`
5. `get_nodes_info` to verify the updated text

### Create a new screen from scratch
1. `figma_bridge_status`
2. `get_document_info`
3. Check `libraries/<fileKey>/file-library.md` (build it first if this is the first use in the file — see "First use in a file"). Plan the screen against its cataloged components: use `create_instance_from_component_key` / `create_instance_from_set_key` / `create_component_instance` wherever a listed component matches, and only fall back to primitives for elements the library doesn't cover.
4. `create_frame`
5. `set_target_frame`
6. `set_auto_layout`
7. `create_text`, `create_rectangle`, or component-instance tools for anything not covered by the library
8. `set_reactions` / `upsert_reaction` for interactive elements, and `set_flow_starting_points` if this screen starts a flow
9. `set_multiple_annotations` to annotate the screen for dev handoff — components + variants used, interactions, undrawn states, content rules, responsive intent, a11y, and any assumptions (see "Dev Handoff Annotations")
10. `get_node_info` to verify structure and `get_annotations` to confirm the notes landed

### Add a design-system component
1. inspect existing instances with `scan_instances_with_sources`
2. if needed, import with `import_component_by_key` or `import_component_set_by_key`
3. create with `create_instance_from_component_key` or `create_instance_from_set_key`
4. configure with `set_instance_properties`
5. verify with `get_instance_source` and `get_instance_properties`

### Add prototype behavior
1. identify source and destination nodes
2. verify current state with `get_reactions`
3. apply with `set_reactions` or `upsert_reaction`
4. confirm the final reaction graph

## Failure Handling

If a command fails:
- check whether the plugin is still connected
- confirm the correct channel is active
- confirm the node still exists
- confirm the selected frame or parent node is correct
- retry with narrower scope
- if the issue is ambiguous, ask the user before proceeding

Common causes:
- plugin not connected
- wrong channel
- wrong node id
- trying to mutate a node type that does not support that property
- missing `FIGMA_TOKEN` for REST API tools

## Context Discipline

Large tool results (a big `read_my_design` subtree, `scan_text_nodes` over hundreds of nodes, `scan_instances_with_sources`, `get_nodes_info` for many ids) should not be carried forward verbatim into later reasoning or into the reply to the user:
- Extract only what the next step actually needs (the matching node ids, the specific field values) and drop the rest before continuing.
- When reporting results to the user, summarize (counts, names, what changed) instead of pasting raw JSON.
- Never echo a full component/variable library table back to the user after reading it — you already have it; just use it.
- If you need the same raw data again later in the same task, prefer re-deriving the small piece you need (e.g. `get_node_info` on one id) over re-reading the full original dump from earlier in the conversation.

Tool results are capped at 50KB (~12k tokens); past that they are truncated with a `[TRUNCATED: ...]` marker. Treat a truncated result as a signal to narrow the request (`maxDepth`, `chunkSize`/`offset`, `rootNodeId`, `excludeTypes`, `maxChars`) rather than to retry it unchanged. Override the cap with `FIGMA_BRIDGE_MAX_RESULT_BYTES` if a single large read is genuinely needed.

## Output Expectations

When using this skill, always report, briefly (counts and names, not raw payloads):
- which file or page you targeted
- which frame or node ids you used as scope
- which tools you called
- what changed
- any unresolved ambiguity or risk
- for new screens: which nodes you annotated and which handoff categories you could not fill in
- whether you verified the final result