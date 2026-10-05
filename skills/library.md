# File Library

## File Library (Components + Variables)

To avoid re-reading the full component/variable catalog from Figma on every request (each `get_local_components`, `get_styles`, or `list_variables` round-trip costs tokens), this skill maintains one catalog file per Figma file under `libraries/<fileKey>/` in the project root (where `fileKey` comes from the Figma URL — the segment after `/design/` or `/file/`):

- `libraries/<fileKey>/file-library.md` — every local component and every local variable of that Figma file, in one file (plus any split files it points to — see "Capping large libraries").

`libraries/index.md` maps each file key to its file name/channel (the channel is the one of the MCP server that file is reached through — `default` by default) and the library path. **Read only the library for the file you are currently working in** — confirm the file with `get_document_info` (returns `fileKey`) or `figma_bridge_status`, then read `libraries/<fileKey>/file-library.md`. Never read or use another file's `libraries/<fileKey>/` folder — those catalogs belong to a different Figma file and do not apply here.

**Whenever a Figma file is opened (the first tool call of a session), check for `libraries/<fileKey>/file-library.md` before doing anything else.** If it exists, this file's design system is already cataloged — when creating mockups, screens, or any new UI, prefer instantiating the components listed there over building frames/shapes from primitives. If it doesn't exist yet, build it once (see **First use in a file** below) before generating anything, so the very first screen you build already reuses the file's real components.

### First use in a file

Before the first read/write of a session, get the current file's key (via `figma_bridge_status` or `get_document_info`) and check whether `libraries/<fileKey>/file-library.md` already exists.

If it does **not** exist yet, this is the first time the plugin is being used against this Figma file. Build it now:

1. Confirm the bridge and file via `figma_bridge_status` and `get_document_info`.
2. If you don't already know the Figma file's URL (needed to build component links), ask the user for it once. Extract the file key from the URL (the segment after `/design/` or `/file/`).
3. Call `get_local_components` to enumerate every component and component set in the file (this also returns `description`, `key`, and simplified `componentPropertyDefinitions` — no extra per-component calls needed). It is paged: returns `{ components, total, offset, limit, pageCount }` — page with `offset`/`limit` (default 500) until you've collected `total` entries.
4. For each component/component set, record: name, type (`COMPONENT` or `COMPONENT_SET`), node id, description if available, its property names/types (from `componentPropertyDefinitions`, omit if none), and a direct Figma URL built as `https://www.figma.com/design/<fileKey>/<file-name>?node-id=<nodeId with ":" replaced by "-">`.
5. Call `list_variable_collections` (few, never paged) and `list_variables` to enumerate every variable — page `list_variables` with `offset`/`limit` (default 500). **Omit `includeValues` for the catalog (metadata only — `includeValues:false` is default)**; this keeps the catalog token-cheap. Only use `includeValues:true` or targeted `get_variable` reads when you actually need themed values for a specific task — never for the full catalog.
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

Do not run this reconcile pass automatically on every turn — only on the explicit trigger phrase above, or when a lookup miss suggests the library is stale (see **First use in a file**).

### Every subsequent use

If `libraries/<fileKey>/file-library.md` already exists for the current file:
- Read it directly (a plain file read) instead of calling `get_local_components`, `get_styles`, or `list_variables` to answer "what components/variables exist" questions.
- Only fall back to the live tools when:
  - a lookup in the library file misses (see **Component not found** below),
  - the user says the file's components/variables changed, or
  - the library file looks stale/empty relative to what's on canvas.
- When a live refresh is needed, only re-scan what changed if possible; otherwise re-run the full build steps above and overwrite the file.
- Whenever you create a new component, style, or variable, append the new entry to the relevant section of `libraries/<fileKey>/file-library.md` immediately so it stays in sync without a full re-scan next time.

### Reading variables without listing (token-cheap)

Do **not** call `list_variables` to "see what's available" on every turn — it consumes tokens even paged. Prefer this cascade:

1. **Cache first (zero bridge cost).** After `get_document_info` → `fileKey`, plain-read `libraries/<fileKey>/file-library.md` (and if `## Variables` is split, read only `libraries/<fileKey>/file-library.variables.<collection-slug>.md` for the collection you need — never all splits). This answers 95% of "what variables exist" without a bridge call. See **First use in a file**.
2. **One-variable read.** When you need a themed value for a known token, use `get_variable({name, collectionName})` or `get_variable({variableId})` — it returns `resolvedValuesByMode`/`resolvedValuesByModeName` (hex for colors) for all modes in one cheap row. Prefer this over `list_variables({includeValues:true})`.
3. **Filtered / paged list only when discovering.** If you must discover, filter: `list_variables({resolvedType:"COLOR", limit:50})` or `list_variables({collectionId, limit:50})`, or `export_tokens({collections:["<name>"], includeModes:false})` for a snapshot. Page with `offset` until `total`. Never call `list_variables({includeValues:true})` without a `resolvedType` or collection filter — and default `includeValues:false` for metadata-only discovery.
4. **Usage inference (no catalog).** To check if a token is actually bound, use `find_nodes({hasBoundVariable:true, boundVariableId})` or `get_style_guide({rootNodeId})` instead of listing the whole catalog.

Rule of thumb: catalog build = `includeValues:false`; value read = `get_variable` or `export_tokens` per collection; full `list_variables({includeValues:true})` is an anti-pattern unless you must audit every value at once.

### Component not found

If the user asks to use or place a component by name and it is not present in `libraries/<fileKey>/file-library.md` (or, if no library file exists yet, not found via `get_local_components`):
- Do not silently substitute a plain frame/rectangle for it.
- Ask the user: "I couldn't find a '<name>' component in this file. Would you like me to create it as a new component?"
- Only proceed to `create_component` / `create_component_from_node` / `combine_as_variants` after they confirm.
- Build it against the file's existing variables and styles. Do not hardcode colors, spacing, radii, or type when a token exists.
- After creating it, append the new entry to `libraries/<fileKey>/file-library.md` right away.
