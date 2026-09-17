# Auto Layout And Placement

Figma auto layout is Flexbox: the parent owns direction, padding, gap, and alignment. Children do not get `x`/`y` unless they ignore the flow.

Read this before creating frames, placing children, or turning on auto layout.

## Defaults

- **UI is nested auto layout**, not absolute coordinates. Vertical page → horizontal rows → grid only when content is truly 2D.
- **Padding** is space inside the parent. **Gap** (`itemSpacing`) is space between siblings. Never fake either with spacer rectangles or empty text.
- **Hug** the parent to its children. **Fill** children that should stretch. **Fixed** only when the spec gives a size (screen width, avatar, icon).
- If any child is Fill on an axis, the parent **cannot Hug** that axis — it becomes Fixed. Do not mix Fill children with a Hug parent on the same axis.
- Alignment is a **parent** property (`set_axis_align` / `set_auto_layout`). Do not `move_node` to center something in a stack.
- **Ignore auto layout** (`ignoreAutoLayout: true`) is only for badges, FABs, and decorative overlays. It is CSS absolute positioning.
- Nested frames each have their own padding and gap. Do not copy a parent's fill onto nested wrappers.

## Fills On Frames

`create_frame` clears Figma's default white fill. `set_auto_layout` / `set_layout_mode` also strip leftover default white on **empty** wrappers.

| Role | Fill? |
|---|---|
| Nested row/column/wrapper/spacer | No — omit `fillHex` |
| Screen / page background | Yes — token or style on the top-level frame |
| Card, chip, button, modal, input | Yes — prefer a fill style or color variable |
| `create_rectangle` / vector | Yes — these are shapes, not layout |

Never call `set_fill_color` after creating a layout frame "just in case". If a wrapper looks solid white, `set_fill_color({ clear: true })`.

## Where To Put New Nodes

Always pass `parentNodeId` (or rely on a single `set_target_frame`). Create **into** the parent; do not create on the page and `move_node` afterwards.

### Freeform frame (`layoutMode` NONE)

`x` / `y` are **parent-relative**, applied after insert. `(0, 0)` is the parent's top-left. Stacking uses `index` / `bring_to_front` / `send_to_back`.

### Auto layout (HORIZONTAL / VERTICAL / GRID)

Omit `x` / `y`. Pass `index` for order and `layoutSizingHorizontal` / `Vertical` for Hug/Fill/Fixed.

- `move_node` is rejected here unless `ignoreAutoLayout: true`.
- Reorder with `insert_child` / `reparent_node` + `index`.
- Stretch with `set_layout_sizing`, not `resize_node`.
- Nested wrappers: omit `width`/`height` on `create_frame` so they do not ship at 320×200. Passing `layoutMode` also skips that default size.

### Slots

1. `get_instance_slots` (or `get_selection_context`) to get `slotNodeId`.
2. Create with `parentNodeId: slotNodeId`, or `append_to_slot`.
3. Omit `x` / `y`. If the slot is auto layout, children default to Fill. If it is freeform, they pin to `(0, 0)`.
4. Do not `move_node` a slot child.

## Build Sequence

1. Parent frame with `layoutMode` + padding + gap + axis align. No fill unless it is a visible surface.
2. Children with `parentNodeId` + `index` + sizing. Components first.
3. Text: Hug + auto-width for labels; Fill width + auto-height for wrapping body.
4. Verify with `get_node_info` (`layoutMode`, `layoutPositioning` should be `AUTO`, `fills` empty on wrappers).

## Hug / Fill Cheat Sheet

| Role | Width | Height |
|---|---|---|
| Top-level screen | FIXED | FIXED or HUG |
| Section in a column | FILL | HUG |
| Row/column wrapper | HUG or FILL | HUG |
| List row | FILL | HUG |
| Button / chip | HUG | HUG |
| Slot content | FILL | FILL or HUG |
| Icon / avatar | FIXED | FIXED |
