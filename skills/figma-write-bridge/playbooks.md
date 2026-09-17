# Playbooks

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
3. Check `libraries/<fileKey>/file-library.md` (build it first if this is the first use in the file — see [library.md](library.md)). Plan the screen against its cataloged components: use `create_instance_from_component_key` / `create_instance_from_set_key` / `create_component_instance` wherever a listed component matches, and only fall back to primitives for elements the library doesn't cover.
4. `create_frame` for the screen (`fillHex` only if it is a painted surface) then `set_target_frame`
5. Nested sections: `create_frame` with `parentNodeId`, `layoutMode`, **no fill**, omit width/height so they hug/fill. Place children with `parentNodeId` + `index` — never `move_node` inside the stack (see [layout.md](layout.md))
6. `set_auto_layout` for one-directional sections, or `set_grid_layout` + `set_grid_child_position` when the section is a true two-dimensional grid (cards, dashboard tiles, pricing columns)
7. `create_text`, `create_rectangle`, or component-instance tools **with `parentNodeId`** for anything not covered by the library
8. `set_transition_reaction` to wire interactive elements to their destinations, and `set_flow_starting_points` if this screen starts a flow
9. `set_multiple_annotations` to annotate the screen for dev handoff — components + variants used, interactions, undrawn states, content rules, responsive intent, a11y, and any assumptions (see [handoff.md](handoff.md))
10. `get_node_info` to verify structure and `get_annotations` to confirm the notes landed

### Add a design-system component
1. inspect existing instances with `scan_instances_with_sources`
2. if needed, import with `import_component_by_key` or `import_component_set_by_key`
3. create with `create_instance_from_component_key` or `create_instance_from_set_key` (`parentNodeId` + `index` inside the stack or slot)
4. configure with `set_instance_properties`
5. verify with `get_instance_source` and `get_instance_properties`

### Add prototype behavior
1. `get_reactions` on the source nodes to see what already exists
2. confirm the destination is a valid target for the navigation type (see the table in [heuristics.md](heuristics.md) under "For prototyping") — for `NAVIGATE`, that means a top-level frame
3. `get_animation_presets` if you need the exact transition/easing spelling
4. `set_transition_reaction` per link (or one `run_batch` of them for a whole flow); `set_reactions` when a trigger needs several actions
5. `set_overlay_settings` for any overlay destination
6. `set_prototype_start_node` / `set_flow_starting_points` to name the flow's entry point
7. `get_reactions` again to confirm the final graph

### Animate an element on the timeline
1. `get_motion` on the target to read existing tracks, the timeline duration, and confirm `motionEnabled`
2. pick the element to animate — a **descendant**, never the top-level frame that owns the timeline
3. `list_animation_styles` and reuse one with `apply_animation_style` if the file already has a style for this gesture
4. otherwise `set_keyframe_track` per property — remember transform fields compose with the resting transform (neutral `0`, or `1` for scale)
5. the timeline auto-extends to fit; call `set_timeline_duration` only to set an explicit length
6. `get_motion` again to confirm the tracks landed, and annotate the motion intent for dev handoff
