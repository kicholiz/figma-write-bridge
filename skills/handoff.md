# Dev Handoff Annotations

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
- **Responsive intent** — which elements fill vs. hug, min/max widths, wrap and reflow behavior, breakpoint differences. For a grid section, say which tracks are fixed vs. flexible and what should happen as the grid narrows.
- **Motion** — for anything animated, the trigger, duration, easing, and what is animating. Motion lives on a timeline the engineer cannot see in a static export, so it has to be written down.
- **Tokens** — where a value is deliberately a specific variable/style, and anything intentionally hardcoded (with the reason).
- **Accessibility** — heading order, alt text for meaningful images, focus order, label associations, and anything with a non-obvious accessible name.
- **Open questions** — anything you assumed while building. Annotate the assumption on the node rather than only mentioning it in chat, so it survives the handoff.

Attach each annotation to the **node it describes** (the button, the input, the list) rather than piling everything onto the screen frame. Use `properties` (e.g. width, fill, spacing entries) when you want Figma to pin the live measured value alongside your note instead of restating a number that can drift.

Use `categoryId` consistently if the file has annotation categories — read them with `get_annotations` (`includeCategories: true`) and reuse the existing ones instead of inventing new labels.

### Related handoff setup

While you're finishing a screen, also make sure the prototype layer is coherent, since it's part of what dev reads:
- Wire the frame-to-frame links with `set_transition_reaction` (or `set_reactions` for multi-action triggers) so the flow is clickable, not just drawn.
- `set_prototype_start_node` / `set_flow_starting_points` so the flow has a named entry point.
- `set_overlay_settings` on any frame used as an overlay, so it anchors and scrims correctly.

Keep annotations short and specific — one to three sentences per node. They're a spec, not prose; long paragraphs get ignored on canvas.

If the user explicitly says they don't want annotations, skip them — but say once that the screen is going out without handoff notes.
