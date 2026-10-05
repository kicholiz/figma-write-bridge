---
name: figma-write-bridge
description: Controls an open Figma file through the local figma-write-bridge MCP server. Invoke when inspecting or editing Figma — frames, text, layout, components, variables, prototypes, motion, shaders, or REST exports.
---

# Figma Write Bridge

Use this skill to read, generate into, or modify an open Figma file through the local `figma-write-bridge` plugin and MCP server. This is local Figma editing, not code generation.

Assumes: Figma **Desktop** is open (localhost WebSocket does not work in a browser tab), `Figma Write Bridge (Local)` is running in the target file, the plugin UI shows **Connected**, and the agent has the bridge MCP tools.

If the plugin was just updated, ask the user to reload it. New actions fail with `Action not allowed` until they do.

## When To Invoke

Invoke when the user asks to inspect or edit an open Figma file: selection, document structure, frames, copy, styling, auto layout, components, variables, prototypes, motion, shaders, or REST exports with `FIGMA_TOKEN`.

Do not invoke for pure code work, static design discussion, markdown specs, or when the plugin is not connected and they do not want local Figma edits.

## Read These Files When Needed

Keep references one level deep. Read only the file the current step needs:

- [setup.md](setup.md) — preconditions, channels, reconnect steps
- [library.md](library.md) — file-library catalog, first use, reconcile, component-not-found
- [layout.md](layout.md) — auto layout, hug/fill, placing into frames / stacks / slots, default fills
- [schema.md](schema.md) — closed schema for fills/effects/grids/reactions, error table
- [handoff.md](handoff.md) — required screen annotations for dev handoff
- [tools.md](tools.md) — full tool catalog (MCP schemas remain the source of truth for parameters)
- [heuristics.md](heuristics.md) — product-designer rules (text, grid, motion, shaders, variable fonts)
- [playbooks.md](playbooks.md) — copy, new screen, component, prototype, motion

## Component Reuse First (Mandatory)

**Never build UI from primitives when an existing component could do the job.**

Before `create_frame` / `create_rectangle` / `create_text` / `create_vector` for anything that looks like UI (not a bare layout container):

1. Load `libraries/<fileKey>/file-library.md`. If it is missing, build it first — [library.md](library.md).
2. Map each planned element to a catalog component by intent, not exact name.
3. Instantiate with `create_component_instance` / `create_instance_from_component_key` / `create_instance_from_set_key`, then `set_instance_properties`.

Primitives are only for layout containers, true one-offs, or when the user asked to build from scratch. No catalog match → ask before creating a new component or drawing a one-off. Bind existing variables/styles instead of hardcoding. Full rules: [library.md](library.md).

## Safety Rules

- Treat Figma edits as high-impact. Read first, then write. Prefer small reversible changes.
- Ask which frame to target if ambiguous. Call `set_target_frame` before editing and stay inside it.
- Do not delete, reset, clear, or bulk-restructure unless the user explicitly asks. Pages / top-level frames / sections need `confirmFrameOrPageDeletion: true`.
- Prefer clone/create over destructive changes. Re-read after major edits.
- `bulk_rename`, `bulk_update`, `replace_all_instances`, and `set_variable_mode` only check that `rootNodeId` is inside the target — scope them explicitly.

## Standard Workflow

1. **Catalog.** `get_document_info` → `fileKey` → read `libraries/<fileKey>/file-library.md` (build it if absent). Map elements to components before building.
2. **Preflight** once per session: `figma_bridge_status`, `get_document_info`, `get_selection`. Skip later unless reconnect/file change. Re-check `get_selection` when the task depends on the current selection. Setup details: [setup.md](setup.md).
3. **Scope.** `set_target_frame` on the agreed frame (or `create_frame` then treat it as the work area).
4. **Inspect** the target with `read_my_design` / `get_node_info` / `find_nodes` — library first, live tools only for what it does not answer.
5. **Mutate** in this order: update text/instance properties → apply styles/variables → instantiate catalog components → clone → primitives for layout only → delete only if asked. Place new nodes with `parentNodeId` + `index`; never `move_node` inside auto layout — [layout.md](layout.md).
6. **Handoff.** New screens are not done until annotated — [handoff.md](handoff.md).
7. **Verify.** Re-read affected nodes. Report counts and names, not raw payloads.

## Tool Map

MCP schemas win over this list. Full catalog: [tools.md](tools.md). Designer judgment: [heuristics.md](heuristics.md).

1. Status: `figma_bridge_status`, `get_document_info`, `get_selection` / `get_selection_context`
2. Scope: `set_target_frame`
3. Inspect: `read_my_design`, `get_document_tree`, `find_nodes`, file library
4. Reuse: instance tools + `set_instance_properties`
5. Tokens: `apply_*_style`, `bind_color_variable_to_fill`, `bind_variable_to_property` (including `opacity`)
6. Primitives only for layout containers
7. Verify + `get_annotations` on new screens

Five bulk reads return a columnar `{fields, rows}` table: `get_document_tree`, `scan_text_nodes`, `scan_nodes_by_types`, `get_local_components`, `find_nodes`. Pass `verbose: true` for objects.

Never echo a value you read back into a setter — [schema.md](schema.md).

### Shortcuts

- Variable fonts: `get_font_variation_axes` then `variationSettings` on text tools
- Shaders: `list_shaders` → `apply_shader` (imports if needed)
- Motion export: `export_node_as_image` with `MP4` / `GIF` / `WEBM`
- Clicks between screens → prototype reactions. Fades/slides on an element → Motion keyframes on a **descendant**
- `>3` related edits → `run_batch` (checkpoint first if blast radius is real)
- Most frames have **no fill**. Auto layout for 1D, grid layout for 2D. Place with `parentNodeId` + `index`; `move_node` is for freeform only — [layout.md](layout.md)

## Context And Output

Large tool results should not be carried forward verbatim. Extract ids and the fields you need. Summarize to the user. Tool results cap at 50KB; a `[TRUNCATED]` marker means narrow the query.

Always report: file/page, scope ids, tools used, what changed, remaining risk, handoff notes on new screens, and whether you verified.
