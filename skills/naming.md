# Naming And Structure For Code Handoff

Design names become code names. Whatever a layer, frame, component, or variable is called shows up on the other side as a class, component, prop, or token. Figma's defaults (`Frame 427`, `Group 12`, `Rectangle 4`, `Ellipse 5`, `Vector`, `Image 8`) carry no intent and become literal garbage in generated code — so names are part of the deliverable, not cosmetics.

Read this when you are building or finishing a screen that will be implemented, or when the user asks how to prepare a Figma file for code.

## Match the file first

- If the file already has a naming convention, **follow it**. Reuse its component names, slash paths, and token names rather than introducing a competing style.
- Only intervene where a name is absent or generic: replace Figma auto-names and appearance-based names with role-based ones derived from context (what the element is and does).
- Do not rename a file's established components or variables to "improve" them — that breaks every existing instance and binding. Renaming is for *new* or *generic-named* layers only.

## Layer names — role, not appearance

Name for what a thing **is or does**, not how it looks or where it sits.

| Good | Bad | Why |
|---|---|---|
| `header`, `hero`, `nav-top`, `card`, `card-header`, `cta`, `footer` | `Frame 427`, `Group 12` | auto-names are meaningless in code |
| `cta` | `Blue Button 2` | color/size in a name breaks on restyle and localizes badly |
| `product-card` | `Frame 27 copy 3` | "copy 3" is a duplicate, not a name |
| `avatar` | `Image 8` | role, not node type |

Rules:
- Never leave a Figma default name (`Frame N`, `Group N`, `Rectangle N`, `Ellipse N`, `Vector`, `Image N`) on a layer that will be implemented. Rename it by role.
- Don't put UI copy in a layer name. A text layer named "Save changes" becomes a hardcoded string; name the button `cta` and its label `cta-label`, and keep the copy as text content.
- Repeated items share one canonical name (`card`), or take a content-meaningful suffix when genuinely distinct (`card/plan-basic`). Numbering (`card-1`) is a last resort.
- Rename the **main component**, not each instance — instances inherit their name.

## Structure — keep semantic parity

- **One top-level frame = one screen, route, or component.** Name it for that (`settings`, `checkout`, `dashboard`), not `Desktop - 4`.
- **Keep nesting shallow and meaningful.** A wrapper that only "groups" things becomes a pointless `<div>`. Add a wrapper only when it carries layout (auto layout) or a real semantic role.
- **Prefer auto layout (flow) over absolute positioning.** Freeform/absolute placement is literally `position: absolute` in the output and breaks responsive code. Use auto layout with hug/fill so the structure maps to flexbox — see [layout.md](layout.md).
- **Anything repeated must be a component/instance.** Repetition is exactly what a code component is; a copy-pasted frame is a component you have not extracted yet.

## Components, variants, slots

- Group with slashes: `Button/Primary`, `Card/Header`, `Icon/Chevron`. The path reads as a component folder.
- Variant property names should read like code props — `Variant`, `Size`, `State`. Use `BOOLEAN` for flags (`Disabled`, `Loading`), `TEXT` for a swappable label, `INSTANCE_SWAP` for a swap target.
- Slots: name for the content that goes in (`slot/icon`, `slot/actions`), not the placeholder shape.
- Keep property values short and code-friendly (`Primary`, `Secondary`, `sm`, `lg`) — they become prop values.

## Variables / tokens

- Name with a semantic path that matches the code token: `color/bg/surface`, `color/text/primary`, `space/200`, `radius/md`. Avoid literal names (`blue-3`, `gray-17`).
- Bind variables/styles instead of hardcoded values — a hex with no token cannot be traced to a design decision. Extract the vocabulary from `libraries/<fileKey>/file-library.md` first (see [library.md](library.md)).

## Figma → code mapping

| Figma | Code |
|---|---|
| frame + auto layout | flex container |
| hug | `width: fit-content` |
| fill | `flex: 1` / `width: 100%` |
| fixed | explicit px / min–max |
| instance | component usage |
| variant property | prop |
| boolean property | boolean prop |
| instance-swap / slot | `children` / named slot |
| absolute / freeform | `position: absolute` |
| COMPONENT_SET | component with variants |
| auto-named layer | (unusable) |

## Pre-handoff cleanup pass

Cheap and high-value — do it before declaring a screen code-ready (alongside the annotations in [handoff.md](handoff.md)):

1. Find generic names: `find_nodes({ nameRegex: "^(Frame|Group|Rectangle|Ellipse|Vector|Image) \\d*$", rootNodeId })`.
2. Rename by role where it matters: `bulk_rename` (with `dryRun: true` first) or `rename_node` per node.
3. Verify with `get_node_info` on the screen — confirm no default names remain on implemented layers.

Renaming is non-destructive to the design (names only), but it **does** break external references to the old name, so never rename an existing shared component or variable.

Check drift with `get_style_guide` (what values the page uses) and `find_nodes({ missingFillStyle: true })` (hardcoded colors with no token).

## Anti-patterns

- `Frame 427` / `Group 12` / `Rectangle 4` shipped to dev.
- Appearance in names (`Blue Button`, `Big Card`, `Left Column`).
- UI copy used as layer names.
- Deep single-child wrapper chains.
- Freeform absolute layout for content that should flow.
- Duplicated frames instead of a component.
- Near-duplicate tokens (`blue-3` vs `color/brand/primary`).
