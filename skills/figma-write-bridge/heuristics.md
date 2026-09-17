# Product Designer Heuristics

## Preferred Decision Heuristics — Product Designer Rules

Think like a product designer, not a script: every tool call should serve a user problem, a layout constraint, or the design system's intent. Before picking a tool, ask: *what is the user trying to accomplish, what is the hierarchy, and what should stay system-driven vs. explicitly specified?* The rules below encode that judgment for every tool family.

### For text updates
Use:
- `scan_text_nodes` to locate candidates
- `set_text_content` for one node
- `set_multiple_text_contents` for batch updates when you already know the id -> new text mapping
- `find_and_replace_text` (with `dryRun: true` first) when you're matching by content/pattern rather than by known node id, or when the same fix needs to apply across every page

Avoid creating replacement text layers if existing text nodes can be updated safely.

### For variable fonts
`get_font_variation_axes({ family })` first. If `variable: true`, pass `variationSettings` (OpenType tags like `{ wght: 550, slnt: -10 }`) on `create_text` / `set_text_style` / `create_text_style`. You can omit `fontStyle` so Figma picks the named instance that best matches the axes. Do not send `variationSettings` on a static family.

### For shaders
`list_shaders` then `apply_shader` — do not hand-author `{ type: "SHADER" }` fills unless you already imported the id. Effect shaders go on `effects`; fill shaders go on `fills` or `strokes`. Key `properties` by the names in `propertyDefinitions` (or by definition id). If `imported: false`, `apply_shader` imports first.

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

Avoid detaching or rebuilding instances unless the user explicitly asks. If a named component isn't in `libraries/<fileKey>/file-library.md` or on canvas, ask the user before creating it (see [library.md](library.md) above).

### For grid layout
Reach for `set_grid_layout` when the content is genuinely two-dimensional — a card grid, a dashboard, a pricing table, a calendar — where items must line up across both rows *and* columns. Nested horizontal/vertical auto-layouts cannot keep columns aligned across rows; a grid can.
Stay with `set_auto_layout` for one-directional content: toolbars, lists, stacks, button rows.
Order matters, and grids have two placement rules that bite in opposite directions:
1. Set the container up with `set_grid_layout` — counts and gaps first, then track sizes.
2. Place and widen any **spanning** child before the children that sit beside it. A span cannot cross an occupied cell, so a card added to column 1 blocks a later attempt to span columns 1–2. Adding the wide one first works; widening it afterwards does not.
3. A span is also rejected if anchor + span exceeds the track count — grow the grid before widening a child.
4. Children keep their own size in a cell. Set `horizontalAlign`/`verticalAlign` to `AUTO` on an axis to stretch them to fill it.

### For layout work
Full rules: [layout.md](layout.md).

Prefer:
- creating or identifying a parent frame first, then `set_auto_layout` (padding + gap + align in one call)
- `parentNodeId` + `index` on every create/instance call so the node is born in the right stack
- `set_padding`, `set_item_spacing`, and `set_axis_align` for targeted fixes
- `arrange_children` / `distribute_nodes` only for **freeform** (non-auto-layout) children
- `generate_grid` for a fresh repeating grid of clones

Do not `move_node` inside auto layout (it is rejected unless `ignoreAutoLayout: true`). Do not pass `fillHex` on nested wrappers. Omit `width`/`height` on nested auto-layout frames so they hug/fill instead of shipping at 320×200.

### For fills — when to paint (product designer rule)

**Most frames should have no fill.** `create_frame` clears Figma's default white fill so layout containers stay transparent. `set_auto_layout` / `set_layout_mode` also strip leftover default white on empty wrappers. Only paint a fill when the frame is a *visible surface*. Full table: [layout.md](layout.md).

| Node role | Fill? | How |
|---|---|---|
| Layout row/column/wrapper/spacer | **No** — leave transparent | Omit fill on `create_frame`; `set_fill_color({clear:true})` if one appeared |
| Screen / page background | Yes | `fillHex` / variable / fill style on the top-level frame |
| Card, chip, button surface, modal, input field | Yes | Prefer `apply_fill_style` or `bind_color_variable_to_fill` |
| Decorative shape (`create_rectangle` / vector) | Usually yes | Rectangle keeps Figma defaults; set intentionally |

Rules:
1. Never call `set_fill_color` "just in case" after creating a layout frame.
2. Never copy a parent's fill onto nested layout wrappers.
3. If a frame unexpectedly looks solid white/gray, clear it — that was almost certainly an unwanted default, not design intent.
4. Prefer styles/variables over raw hex when the file has a token system.

### For strokes

Stroke tools, in preference order:

1. `apply_stroke_style` when a paint style exists for borders
2. `bind_color_variable_to_stroke` when borders are tokenized
3. `set_stroke_color` for raw strokes — supports `hex`/`r,g,b`, `strokeWeight`, `strokeAlign` (`INSIDE` preferred for UI boxes so size stays stable, else `CENTER`/`OUTSIDE`), `dashPattern` (e.g. `[4,4]`), `strokeCap`, `strokeJoin`, `styleId`, and `clear: true`

Do not stroke layout wrappers. Stroke cards, inputs, dividers, and icons only when the design calls for a border.

### For frame sizing — hug / fill / fixed

Use `set_layout_sizing` (or `set_auto_layout` sizing / `width`/`height` aliases) with `FIXED` | `HUG` | `FILL`:

| Role | Width | Height |
|---|---|---|
| Top-level screen / artboard | FIXED (e.g. 1440 / 390) | FIXED or HUG if content-driven |
| Section inside a column | FILL | HUG |
| Auto-layout row/column wrapper | HUG or FILL (match parent) | HUG |
| List item / full-bleed row | FILL | HUG |
| Button / chip / badge | HUG | HUG |
| Spacer | FIXED on the spacer axis | FIXED or FILL on the other |
| Icon slot / avatar | FIXED | FIXED |

FILL only works inside an auto-layout parent — outside it behaves like fixed. Never `resize_node` an auto-layout parent that already hugs/fills; change padding/gap/sizing instead.

### For text alignment vs parent axis alignment

These are different controls — set both when centering a label in a control:

| Control | Values | Meaning |
|---|---|---|
| `textAlignHorizontal` | LEFT / CENTER / RIGHT / JUSTIFIED | Where glyphs sit **inside the text box** |
| `textAlignVertical` | TOP / CENTER / BOTTOM | Where lines sit **inside the text box** (matters when height is fixed or FILL) |
| Parent `primaryAxisAlignItems` | MIN / CENTER / MAX / SPACE_BETWEEN / SPACE_AROUND / SPACE_EVENLY | Where **children** sit along the stack direction |
| Parent `counterAxisAlignItems` | MIN / CENTER / MAX / BASELINE | Where **children** sit on the cross axis |

Heuristics:
- Body / labels / form fields → text **LEFT** + **TOP**
- Centered hero title or CTA label in a centered stack → text **CENTER**; parent axes often **CENTER** too
- Button label inside a fixed-height button → parent **CENTER**/**CENTER**, text **CENTER**/**CENTER**
- Trailing meta, prices, table numbers → text **RIGHT**
- Multi-line wrapping body → text **TOP** (not vertical center)
- Single-line in a tall fixed box (input, table cell) → text **CENTER** vertically

Tooling: set text align via `create_text` / `set_text_style`; set parent align via `set_axis_align` or `set_auto_layout`.

### For resizing — `resize_to_fit` vs `resize_node` (product designer rule)
Use `resize_to_fit` when the intent is to **fit**, not to spec:
- **Shrink-wrap (no `targetNodeId`)**: a container/frame/section tightly wraps its children. Use when you just added/removed children, changed text, or updated a card and need the parent to hug its content again. This is the Figma "Resize to Fit" command — do not hardcode a width/height that you could derive from children.
- **`targetNodeId` with `fit: "contain"`**: scale an image, icon, or media layer to fit entirely inside a target frame without cropping (letterboxes). Use for responsive image fills, avatar → frame, logo → container.
- **`targetNodeId` with `fit: "cover"`**: fill the target fully, cropping overflow. Use for hero/cover images where filling the bounds matters more than showing the whole asset. Both `contain`/`cover` preserve aspect ratio and center the layer.

Use `resize_node` when the spec is **explicit**: a 320×200 card, a 1440px page frame, a fixed avatar 40×40. If you catch yourself computing `width = sum(children) + padding`, you probably want `resize_to_fit` instead.

Never use either on an auto-layout parent that already sizes itself — auto layout will fight your explicit size. For auto-layout frames, let layout do its job; use `set_layout_sizing` / padding / gap to influence size instead.

### For text — hug vs fill vs fixed (product designer rule)

Text frames have two independent modes: **auto-layout sizing** (`set_layout_sizing` HUG/FILL) and **text auto-resize** (`textAutoResize` on the TextNode itself). Keep them aligned:

- **Hug contents — Auto-width** (`textAutoResize: "WIDTH_AND_HEIGHT"` + `set_layout_sizing({width:"HUG", height:"HUG"})` / Figma UI "Hug" / "Auto width"): the text box shrinks/grows to its characters with no wrapping (single-line hug). Use for labels, buttons, chips, badges, captions — anything where the container should be driven by content length. A `Button` set to hug will stay pill-tight regardless of label ("Save" vs "Save changes"). Prefer auto-width for inline elements, tags, and when you don't yet know the copy length. **Plugin:** keep as `WIDTH_AND_HEIGHT`; do not call `resize_node` — let hug drive size. Width/height are derived, not set.
- **Fill container + Auto-height** (`textAutoResize: "HEIGHT"` + `width:"FILL"` / "Fill" + "Auto height"): the text fills the parent's available width and wraps, height auto-adjusts to content. Use for body copy inside a column, inputs that should span the form width, titles that should wrap to the column, or any text that must align to a grid/column. Fill only makes sense inside an auto-layout parent — outside it, it behaves like fixed. **Plugin:** use `WIDTH_AND_HEIGHT` → `HEIGHT` switch via the plugin's text-frame control; then change **width only** (`resize_node({width})` or `set_layout_sizing({width:"FILL", height:"HUG"})`) — height stays auto.
- **Fixed size** (`textAutoResize: "NONE"` + explicit `width`/`height`): use only when the spec gives an explicit size (e.g., a 320px card's title must be 280×48). Avoid fixed for text that will be translated or is user-generated. **Plugin:** `NONE` allows changing **both width and height** via `resize_node({width, height})`; text truncates/overflows instead of rewrapping.

Decision checklist before setting text size:
1. Is the text inside an auto-layout frame? If no → auto-width (hug) is safe default; fixed only with a spec.
2. Is it a control that should size to its label? → Auto-width.
3. Is it content that should line-wrap to the column? → Auto-height + Fill width.
4. Is the design responsive? Prefer auto-width for components, auto-height+Fill for layout-level text, never fixed without a reason. Annotate the choice (see Dev Handoff).

Switching rules (plugin must enforce):
- Auto-width (`WIDTH_AND_HEIGHT`): no explicit `resize_node` width/height — size is content-driven.
- Auto-height (`HEIGHT`): allow **width** changes only; height is auto.
- Fixed (`NONE`): allow **both width and height** changes; both are explicit.
- Always use `set_layout_sizing` (or `set_auto_layout` with sizing) for HUG/FILL intent, and the TextNode's `textAutoResize` control for wrapping intent — `resize_node` on a text node forces a fixed size and breaks hug/fill. Never `resize_node`/`resize_to_fit` on an auto-layout parent that already sizes itself.

### For text wrapping and truncation
`set_text_style` also carries the paragraph-level controls:
- `textWrapStyle`: `BALANCE` evens out line lengths — the right choice for headings and short display text. `PRETTY` avoids leaving a single word on the last line, good for body copy. `AUTO` is the default.
- `textTruncation: 'ENDING'` plus `maxLines` caps a block with an ellipsis. `maxLines` needs truncation on to have any effect; pass `maxLines: null` to clear the cap.
Prefer these over manually shortening copy — they keep the real content in the file for the engineer reading it.

### For layer order — `bring_to_front` / `send_to_back`
- Use `bring_to_front` to bring a layer to the front of its current parent's stack (e.g., a tooltip over a card, a modal overlay above content) without moving it to another frame. It keeps the node in place and just reorders z-index.
- Use `send_to_back` to push a background, decoration, or backdrop behind siblings (e.g., a fill rectangle should sit behind card content).
- For fine-grained z-order (second-from-front, between two siblings) use `reparent_node` or `insert_child` with an explicit `index` instead — front/back are just shortcuts for `index = 0` and `index = last`.
- Never reparent just to reorder — keep the hierarchy, only change z-order.

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

### For prototyping (frame-to-frame links)
Prefer:
- `set_transition_reaction` for a single frame-to-frame link with an explicit transition — this is the default tool for "link A to B". `set_smart_animate_reaction` is the same thing with `SMART_ANIMATE` preselected.
- `set_reactions` when one trigger fires several actions, or when you are replacing a node's whole interaction set. `upsert_reaction` to change one interaction without disturbing the others.
- `get_animation_presets` to look up valid transition types, easing names, and curated presets before authoring a transition.
- `get_overlay_settings` / `set_overlay_settings` to control how an overlay anchors and scrims, alongside the reaction whose `navigation` is `OVERLAY`.
- `get_prototype_settings` / `set_prototype_start_node` / `set_flow_starting_points` for the Present entry point and named Flows.

Destination rules — a NODE action fails with `Reaction at index N was invalid` when the destination does not suit its navigation type:

| `navigation` | Destination must be |
|---|---|
| `NAVIGATE`, `SWAP` | a **top-level** frame on a page (not a nested child) |
| `OVERLAY` | a frame configured as an overlay |
| `SCROLL_TO` | a node inside a scrollable ancestor of the source |
| `CHANGE_TO` | a sibling variant in the **same component set** as the source |

Transitions are validated strictly — see [schema.md](schema.md) above; `direction`/`matchLayers` belong only to the directional types.

Smart Animate itself still auto-interpolates between two frames — there is no per-property control *within a Smart Animate transition*. Property-level animation is a separate feature: see "For motion / animation" below.

### For motion / animation
Two different features — pick by what the user is describing:
- **"When I click this, go to that screen"** → a prototype reaction (`set_transition_reaction`, `set_reactions`). See "For prototyping (frame-to-frame links)".
- **"Make this fade in / slide up / pulse"** → Motion keyframes on the element itself (`set_keyframe_track`), which animate properties along the frame's timeline.

Working rules:
1. `get_motion` first — read the existing tracks and the timeline duration before writing, and confirm `motionEnabled`.
2. Animate **descendants**, not the top-level frame: that frame owns the timeline rather than animating on it, so keyframes there do nothing. The bridge refuses it unless you pass `allowTopLevelFrame: true`.
3. Transform fields (`TRANSLATION_*`, `ROTATION`, `SCALE_*`) **compose** with the node's resting transform — neutral is `0`, or `1` for scale. Everything else replaces the value. So `SCALE_X: 1` means "unchanged", not "collapse".
4. Positions are seconds. The first keyframe's value holds back to `t=0` and the last holds to the end, so don't add padding keyframes just to pin the resting state.
5. Easing on a keyframe describes the move **into** it, so easing on the first keyframe is ignored. `HOLD` gives step interpolation. Use `EASE_IN_AND_OUT`, never `EASE_IN_OUT`.
6. The bridge lengthens the timeline automatically when your animation runs past it (pass `extendTimeline: false` to opt out). It never shortens it on your behalf — that would truncate existing motion — so reach for `set_timeline_duration` deliberately, and only when the user asks.
7. Prefer an existing animation style (`list_animation_styles` → `apply_animation_style`) when the file already uses one for that gesture, the same way you prefer an existing component over primitives.

### For styling
Prefer:
- checking `libraries/<fileKey>/file-library.md` first for existing tokens before calling `list_variables` or `get_styles`
- applying existing styles and variables before creating new local styles
- `apply_*_style` when a matching style already exists
- variable binding when the file uses variables semantically
- **not** painting fills on every new frame — see "For fills — when to paint"

### For fills, images, effects, and strokes
Prefer:
- transparent layout frames by default (`create_frame` clears the white default)
- `apply_fill_style` when a paint style already exists; otherwise `set_fill_color` / `fillHex` for solid, `set_gradient_fill` for gradients, `set_image_fill` for images
- `set_fill_color({ nodeId, clear: true })` to strip accidental fills from wrappers
- `apply_stroke_style` or `bind_color_variable_to_stroke` before raw `set_stroke_color`
- `set_stroke_color` with `strokeAlign: "INSIDE"` for UI borders; `dashPattern: [4, 4]` for dashed; `clear: true` to remove
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

### For product design — choosing the right tool family
As a product designer, map the user's intent to the tool family before picking a specific tool:
- **Structure first, style second.** Create or select the parent frame/section, set its auto-layout, then adjust children. Never style children before the layout is correct.
- **Reuse > create > style.** Check the library (`libraries/<fileKey>/file-library.md`) for a component/variable/style; instantiate or bind it. Only create primitives for true layout containers.
- **Variables are the source of truth.** In a file with collections/modes, change theme or brand via `set_variable_mode` / `set_variable_values` / `get_variable`, not by overwriting hexes. Use `list_variables({includeValues:true})` to verify the mode matrix before editing.
- **Scope narrowly, verify widely.** `set_target_frame` to the frame the user means, use `read_my_design` with `maxDepth` to inspect, make the edit, then re-read the subtree and confirm it matches the spec.
- **When in doubt, ask.** If the intent is ambiguous (which mode, which frame, hug vs fill), ask for one clarification rather than guessing and producing drift.

Use this sequence for most editing tasks:
1. Load the current file's `libraries/<fileKey>/file-library.md` if present, or build it on first use, then map every planned element to a cataloged component before building (see "Component Reuse First" — this step is mandatory, not a preference).
2. Confirm bridge and file with `figma_bridge_status` and `get_document_info` — skip this step if already confirmed earlier in the session (see Preflight).
3. Confirm selection with `get_selection`.
4. Set scope with `set_target_frame`.
5. Inspect the target node tree with `read_my_design` or `get_node_info` (pass `maxDepth`/`excludeTypes` when you only need a shallow read).
6. Make the smallest viable edit.
7. If you built a screen, annotate it for dev handoff (see [handoff.md](handoff.md)).
8. Re-read the affected nodes.
9. Report what changed and any limitations.
