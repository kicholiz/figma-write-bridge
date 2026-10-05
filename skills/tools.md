# Tool Catalog

MCP tool schemas are the source of truth for parameters. Read this file when you need the full tool list.

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

Pass `verbose: true` to any of the five to get the original array-of-objects (or nested tree) shape back.

### Read / Inspect
- `get_document_info` — current page's name/id/type/fileKey, its child nodes, `currentPage`, plus a `pages` list covering **every** page in the file (id/name/childCount), so one call gives the full-page overview without a separate `get_all_pages`.
- `get_all_pages` — compact map of every page (id/name/childCount). Pass `includeTopLevel: true` to also list each page's top-level frames. Call once for a full-file overview.
- `get_document_tree` — compact structural tree of the whole file (or one subtree). Every node is `{id, name, type}`; no extra fields unless requested. Default `maxDepth` is 3 to bound output; pass `fields: ["characters"]` to include TEXT content and a larger `maxDepth` for deeper expansion. Use `rootNodeId` to scope to a frame/page, `excludeTypes: ["VECTOR"]` to drop icon/vector noise, and `fields` to pull extra per-node values (e.g. `["fills","absoluteBoundingBox"]`) only when you need them. Returns a **columnar table** — see below.
- `get_selection`
- `get_selection_context` — bundles selection + node info + (for instances) main component id, property definitions, current property values, and slots in one call. Prefer this over chaining `get_selection` → `get_node_info` → `get_component_property_definitions` when you need more than just id/name/type.
- `find_nodes` — server-side predicate query; the node graph is filtered inside Figma and only matches come back, so "all red button instances" or "all hardcoded fills with no style" costs a handful of rows instead of a full tree dump filtered in context. Predicates (all optional, ANDed): `types`, `name` (glob), `nameRegex`, `textContains`, `fillHex` (+ `fillTolerance` for near-shades), `fillStyleId`, `textStyleId`, `missingFillStyle` (hardcoded color with no style/variable — design-system drift), `hasBoundVariable`/`boundVariableId`, `hasOverrides`/`mainComponentName` (instances), `visible`, `rootNodeId`, `allPages`. Paginate with `limit`/`offset`; `total`/`truncated` reflect the full match count, not just the returned page. Prefer this over `scan_nodes_by_types` or `get_document_tree` + manual filtering whenever the query is more selective than "give me every node of type X".
- `read_my_design`
- `set_focus` — select one node and scroll the viewport to it, switching to its page first. Use it to show the user what you just built or found (ids from a cross-page `find_nodes` work directly).
- `set_selections` — select several nodes at once. Switches to the first node's page; Figma scopes selection to one page, so anything elsewhere comes back in `skippedOnOtherPages`.
- `get_node_info`
- `get_nodes_info`
- `scan_text_nodes`
- `scan_instances_with_sources`
- `get_instance_source`
- `get_styles`
- `get_local_components`
- `list_variable_collections` — lists every collection with its modes (id/name). Use this first to discover mode ids/names (few collections — never paged).
- `list_variables` — list local variables, paged: returns `{ variables, total, offset, limit, pageCount }` (default `limit` 500) — page with `offset` until you reach `total` to enumerate every variable without one huge response. Pass `includeValues: true` to read each variable's value in **every** mode (`valuesByMode` keyed by modeId, `valuesByModeName` keyed by mode name, `defaultValue` from the collection's first mode, plus the mode list). This is how you read theme/dark-mode values. `set_variable_values` / `create_variable` accept `valuesByMode` keyed by mode id, mode name, or mode index to write into any mode.
- `get_variable` — read ONE variable's per-mode values in detail: lookup by `variableId`, `key`, or `name` (+ `collectionId`/`collectionName` to disambiguate). Returns raw `valuesByMode`/`valuesByModeName` (aliases are `{type:"VARIABLE_ALIAS",id}`) plus `resolvedValuesByMode`/`resolvedValuesByModeName` that follow aliases to concrete values (colors as hex). Prefer this over `list_variables({includeValues:true})` when you need one variable's full themed values.
- `get_annotations`
- `get_reactions`
- `get_changes_since` — pass the `currentSeq` from a previous call as `sinceSeq` to get back only the node ids this bridge has mutated since then, instead of re-reading the whole document to see what changed. Cursor resets when the MCP server restarts.
- `get_events` — read Figma events pushed by the plugin (selectionchange/documentchange) since a `sinceSeq` cursor. Pair with `subscribe_events` / `unsubscribe_events`. Handy to react to the user's live selection or canvas changes without polling `get_selection`.
- `get_font_list` — distinct fonts (family + style, plus `variationSettings` when a variable font is used) on the current page or a `rootNodeId` subtree, with usage counts. Use this before deciding whether a new `create_text_style` can reuse an existing family.
- `get_font_variation_axes` — OpenType axes a family exposes (`wght`, `slnt`, `opsz`, …), or `variable: false` for a static family. Call this before writing `variationSettings`. Requires Plugin API Update 138.
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
- `create_frame` — **defaults to no fill** (transparent). Nested into auto layout: omit `x`/`y` and omit `width`/`height` (do not ship at 320×200); pass `parentNodeId` + `index` + `layoutSizing`. `fillHex` only for visible surfaces; optional `layoutMode`
- `create_rectangle` — pass `parentNodeId` + `index` inside stacks; omit `x`/`y` unless the parent is freeform
- `create_text` — defaults to **auto-width hug** (`textAutoResize: WIDTH_AND_HEIGHT`). Pass `parentNodeId` + `index` inside stacks. Also `textAlignHorizontal`/`Vertical`, `layoutSizing`, `variationSettings`
- `create_section`
- `create_vector` (from SVG path data)
- `generate_grid` (columns x rows, clones `itemNodeId` or makes rectangles; `{i}` in name = running index)
- `create_component_instance` — pass `parentNodeId` + `index`
- `create_instance_from_component_key` / `create_instance_from_set_key` — same placement fields
- `create_instance_from_instance` — make a fresh instance of whatever component an existing instance points at; pass `parentNodeId`
- `clone_node` — duplicate a node in place (auto-layout clones stay in the flow; freeform clones nudge 20px)
- `clone_node_into_parent` — duplicate a node directly into a chosen parent (and optional `index`)

### Update Nodes
- `rename_node`
- `move_node` — absolute `x`/`y` or relative `dx`/`dy` on **freeform** parents. Inside auto layout this is rejected unless `ignoreAutoLayout: true` (overlay)
- `reparent_node` (optional `index`) / `insert_child` — move (cut) any existing node into/out of frames, sections, groups, auto-layouts, slots, and pages; `index` controls order inside auto-layout containers (omit `index` on `insert_child` to append). Children stay in the flow unless `ignoreAutoLayout` is set
- `get_parent_chain`
- `resize_node` — set explicit `width`/`height` (either may be omitted). On TEXT, refuses hug auto-width unless you pass `textAutoResize` (`HEIGHT`/`NONE`) or `forceFixed`
- `resize_to_fit` — two modes: (1) pass `targetNodeId` to scale the layer to fit inside that layer (aspect-preserving, centered; `fit: "contain"` letterboxes, `fit: "cover"` fills and crops); (2) omit `targetNodeId` to shrink-wrap the container tightly to its own children (Figma's "Resize to Fit"). Prefer this over `resize_node` when fitting content, not spec'ing a size.
- `bring_to_front` / `send_to_back` — reorder a layer within its parent's z-order (children[0] = back-most, children[last] = front-most). Use to fix stacking without reparenting.
- `set_fill_color` (`figma_set_solid_fill` is a shorthand) — also accepts `fillHex` and `clear: true` to remove fills
- `set_stroke_color` — color (`hex`/`r,g,b`), `strokeWeight`, `strokeAlign` (CENTER|INSIDE|OUTSIDE), `dashPattern`, `strokeCap`, `strokeJoin`, `styleId`, or `clear: true`
- `set_corner_radius`
- `set_text_content` (`figma_set_text` is a shorthand alias)
- `set_multiple_text_contents`
- `set_text_style` (typography + align + `textAutoResize` + layout sizing + variable binding + `variationSettings` for variable-font axes)

### Fills & Effects
- `set_image_fill` — IMAGE fill from a URL, raw base64, or a local file via `localPath` (the server reads the file to base64); `scaleMode` FILL/FIT/CROP/TILE, `paintIndex`, `rotation`
- `set_gradient_fill` — LINEAR/RADIAL/ANGULAR/DIAMOND with `stops`, optional `from`/`to` transform points, `opacity`, `paintIndex`
- `set_effects` — raw effects or an existing `effectStyleId`; `boundVariables.color` binds a variable. Supported types: `DROP_SHADOW`, `INNER_SHADOW`, `LAYER_BLUR`, `BACKGROUND_BLUR` (both `blurType: "NORMAL"` and `"PROGRESSIVE"`), `NOISE` (`MONOTONE`/`DUOTONE`/`MULTITONE`), `TEXTURE`, `GLASS`, and `SHADER` (`{id, properties}` after import). Prefer `apply_shader` for shaders. Required keys are filled in for you — pass the values you care about and let the bridge complete the shape (see [schema.md](schema.md)).
- `apply_fill_style` / `apply_stroke_style` — apply a local paint style to fills or strokes
- `bind_color_variable_to_fill` / `bind_color_variable_to_stroke` — bind a COLOR variable to a paint

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
- `rename_variable_collection` / `delete_variable_collection` (delete needs `confirmDelete`)

### Events (Push from Figma)
- `subscribe_events` / `unsubscribe_events` — enable/disable push of `selectionchange` / `documentchange`
- `get_events` — read the pushed events since a `sinceSeq` cursor

### Layout
- `set_auto_layout` — bundled layoutMode/padding/gap/align + sizing (`layoutSizingHorizontal`/`Vertical` or `width`/`height` aliases: FIXED|HUG|FILL). Empty wrappers strip leftover default white unless `clearFill: false`
- `set_layout_mode`
- `set_padding`
- `set_axis_align` — parent child alignment (MIN/CENTER/MAX/…); distinct from textAlign*
- `set_layout_sizing` — FIXED|HUG|FILL via layoutSizing* or width/height; TEXT may also set `textAutoResize`
- `set_item_spacing`
- `set_layout_grids` — `ROWS`/`COLUMNS` (with `alignment`, `gutterSize`, `count`, and `sectionSize` only when alignment is not `STRETCH`) or `GRID` (with `sectionSize`). These are visual layout *guides*, not a layout mode — for real grid layout see `set_grid_layout` below.
- `set_grid_layout` — turn a frame into a **GRID auto-layout** container (the third `layoutMode` beside `HORIZONTAL`/`VERTICAL`, where children occupy cells rather than one flow). Sets `rowCount`/`columnCount`, `rowGap`/`columnGap`, and per-track `rowSizes`/`columnSizes` — each entry a number (fixed px) or `{type: 'FLEX'|'FIXED'|'HUG', value}`, where `FLEX` tracks split leftover space by weight.
- `get_grid_layout` — read a grid's tracks, gaps, and every child's cell/span/alignment. Returns `isGrid: false` for a non-grid frame. Call it before repositioning children so you know the bounds.
- `set_grid_child_position` — place a child: 0-based `row`/`column` anchors, `rowSpan`/`columnSpan`, and `horizontalAlign`/`verticalAlign` (`MIN`/`CENTER`/`MAX`/`AUTO`, where `AUTO` stretches). Anchor + span must fit inside the grid.
- `reorder_grid_tracks` — move whole rows/columns (`axis`, `fromIndices`, `insertionIndex`), carrying their children along.
- `distribute_nodes` — space/align an arbitrary set of **freeform** nodes along `axis` (horizontal|vertical): `mode` `gap` (fixed `gap`), `spaceBetween`/`evenly` (fill bounds), or `center`; `crossAlign` none|start|center|end; `bounds {x1,y1,x2,y2}` overrides the default parent-based bounds. Auto-layout children are skipped (use `set_item_spacing` / `set_axis_align`)
- `arrange_children` — same distribution options applied to the direct children of a `parentNodeId`. On auto-layout parents it is skipped with a notice (layout already arranges them).

### Motion (Timeline Animation)
Distinct from prototype reactions: reactions link frames on click, Motion animates properties over a timeline **inside** one top-level frame. The whole surface is gated behind a Figma feature flag — `get_motion` returns `motionEnabled: false` when the account lacks it, and the write tools return one clear error. Do not retry on that error.
- `get_motion` — read timelines (durations in seconds), the current `playheadPosition` (seconds; undefined when no timeline is active), manual keyframe tracks, applied animation styles, and resolved animations, for given nodes or the current selection. Always start here.
- `set_keyframe_track` — add/replace one track. `field` is a property (`TRANSLATION_X`/`_Y`/`_XY`, `ROTATION`, `SCALE_X`/`_Y`/`_XY`, `OPACITY`, `CORNER_RADIUS` and the per-corner variants, `STROKE_WEIGHT` and the per-border variants, `WIDTH`, `HEIGHT`, `STACK_*`/`GRID_*` spacing, `PATH_TRIM_START`/`_END`) — or `FILLS`/`STROKES`/`EFFECTS` **with a `paintIndex`** for color/effect animation.
- `remove_keyframe_track` — drop one track by field, or `all: true` to clear them.
- `list_animation_styles` / `apply_animation_style` / `remove_animation_style` — reusable animation presets. List first for a real `styleId`; `duration` and `timelineOffset` are seconds and top-level, not `props`. Verify against `animationStyles` in the response, not `animations`.
- `set_timeline_duration` — set the containing top-level frame's timeline length in seconds.

### Shaders
A shader must be imported into the file before it can be applied. `list_shaders` returns owned/library shaders with `imported: false` until you import them.

- `list_shaders` — enumerate shader effects/fills available to the file (`id`, `name`, `type` `effect|fill`, `imported`, `propertyDefinitions`). Empty when the account has none.
- `import_shader_by_id` — materialize a shader by `shaderId` or `name`. Idempotent if already imported; populates `propertyDefinitions`.
- `apply_shader` — import if needed and apply to `fills`, `strokes`, or `effects`. `properties` may be keyed by definition id or author-defined name; hex strings are accepted for COLOR properties. Default target is `effects` for effect shaders and `fills` for fill shaders.

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
- `add_component_property` / `edit_component_property` / `delete_component_property` — author a component's property schema (`VARIANT`, `BOOLEAN`, `TEXT`, `INSTANCE_SWAP`). Definitions live on the **component set** when the component is a variant; the bridge resolves that for you, so pass either the set or any variant.
- `bind_component_property` — point a layer's `visible` / `characters` / `mainComponent` field at a declared property, which is what actually makes the property do something
- `create_component_slot`
- `edit_component_slot`
- `delete_component_slot`
- `get_instance_slots`
- `append_to_slot` — reparent into a SLOT; children join the slot flow (Fill when the slot is auto layout, `(0,0)` when freeform). Do not `move_node` afterwards
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

Related: `export_node_as_image` (plugin-side, no token needed) also accepts a `localPath` to save the rendered node to disk instead of returning base64. Formats: PNG/JPG/SVG/PDF, plus MP4/GIF/WEBM for a top-level frame with Motion (`fps`, `quality`, GIF `loopCount`).
