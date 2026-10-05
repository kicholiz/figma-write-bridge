# Schema And Failures

## Figma Schema Validation (Read Before Writing Fills, Effects, Grids, Reactions)

Figma validates `fills`, `effects`, `layoutGrids`, `reactions`, and `annotations` against a **closed schema**. Two failure modes matter:

- **A missing required key** — e.g. `Required value missing at [0].blendMode`.
- **An extra key the variant does not declare** — e.g. `Unrecognized key(s) in object: 'matchLayers' at [0].actions[0].transition`.

The bridge normalizes every one of these payloads for you, so you generally just pass plain values. The rules matter when you are deciding *what* to send:

- **Never echo a value you read back into a setter.** A paint, effect, grid, or reaction read from a node carries read-only extras (`boundVariables`, `noiseSizeVector`, …) that the setter rejects. Send only the fields you intend to change.
- **Effects** — `DROP_SHADOW`/`INNER_SHADOW` need `color`, `offset`, `radius`, `visible`, `blendMode` (the bridge defaults `visible: true`, `blendMode: "NORMAL"`). `LAYER_BLUR`/`BACKGROUND_BLUR` also need `blurType`: `"NORMAL"`, or `"PROGRESSIVE"` plus `startRadius`/`startOffset`/`endOffset`. `showShadowBehindNode` is `DROP_SHADOW`-only. `NOISE`, `TEXTURE`, `GLASS`, and `SHADER` (`{id, visible, properties}`) are also supported — prefer `apply_shader` for shaders.
- **Transitions** — `DISSOLVE`, `SMART_ANIMATE`, and `SCROLL_ANIMATE` accept **only** `{type, duration, easing}`. Adding `direction` or `matchLayers` fails validation. Only `MOVE_IN`, `MOVE_OUT`, `PUSH`, `SLIDE_IN`, `SLIDE_OUT` take those two.
- **Layout grids** — `sectionSize` is invalid when `alignment` is `STRETCH`; `offset` is invalid when `alignment` is `CENTER`.
- **Solid paints** — opacity belongs on the paint (`{type:"SOLID", color:{r,g,b}, opacity:0.5}`), not as an `a` channel inside `color`.
- **Grid layout** — `gridAutoTracks` is `NONE`/`ROWS` and `gridItemsPositioning` is `MANUAL`/`ROW_AUTO_FLOW`; track types are `FLEX`/`FIXED`/`HUG`.
- **Motion easing** — the transition easings plus `HOLD`. `EASE_IN_AND_OUT` is the correct spelling; `EASE_IN_OUT` is rejected, as are internal names like `OUT_CUBIC`.

Under `documentAccess: "dynamic-page"` (this plugin's manifest) two more rules apply, and the bridge already handles both — do not work around them:
- Pages load lazily. Anything that traverses the whole document loads all pages first, which is why file-wide reads cost more than page-scoped ones. Prefer `rootNodeId`/page scope over `allPages: true` unless you need it.
- **Selection is per-page.** `set_focus` and `set_selections` switch to the node's page automatically; a selection still cannot span two pages, so `set_selections` reports leftovers in `skippedOnOtherPages`.

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

Error messages worth recognizing:

| Message | Cause | Fix |
|---|---|---|
| `Unrecognized key(s) in object: '<key>'` | An extra key the schema variant does not declare — usually a value read off a node and passed straight back in | Send only the fields you mean to set |
| `Required value missing at [0].<key>` | A required field omitted from an effect or paint | Supply it, or let the bridge default it by passing the simple form |
| `Reaction at index N was invalid` | The prototype **destination** was rejected, not the action type | See destination rules in [heuristics.md](heuristics.md) |
| `Can only get component property definitions of a component set or non-variant component` | Property definitions were read off a variant | Pass the parent component set (the bridge promotes automatically on its own tools) |
| `Setting figma.currentPage is not supported` | Something bypassed `set_current_page` | Use `set_current_page`; report it, since bridge tools should never raise this |
| `Node is inside an auto-layout parent` | `move_node` was used on a stack child | Reorder with `insert_child` / `index`, or pass `ignoreAutoLayout: true` for an overlay |
| `Action not allowed: <name>` | The plugin build predates the tool | Reload **Figma Write Bridge (Local)** in Figma Desktop |
| `Shader not imported` | Applied a shader id that is not in the file yet | `import_shader_by_id` or `apply_shader` (it imports first) |
| `Variable fonts are not available` | Figma Desktop is older than Plugin API Update 138 | Ask the user to update Figma Desktop |
| `Motion APIs are not enabled for this Figma user` | The account lacks the Motion feature flag | Report it once and stop — do not retry. Prototype reactions still work |
| `span exceeds grid column count` / the bridge's `columnSpan … exceeds the grid's N columns` | A grid child was given a span that runs past the last track | Raise `columnCount` via `set_grid_layout`, or reduce the span |
| `Cannot set child to specified column span due to existing children in adjacent columns` | The span would cross a cell another child already occupies | Place and widen the spanning child before adding its neighbours, or move the blocking child first |
| `This is a top-level frame, which owns the timeline` | Keyframes were aimed at the frame that owns the timeline | Animate a descendant, or pass `allowTopLevelFrame: true` if you really mean it |
