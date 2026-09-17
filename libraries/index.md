# Library Index

Each Figma file gets its own component & variable catalog so libraries are never
mixed across files. Libraries live in `libraries/<fileKey>/`, keyed by the file
key from the Figma URL (the segment after `/design/` or `/file/`).

| File key | File name | Channel | File library |
|----------|-----------|---------|---------------|
| `VKcN77ktPqrZsSmevqWboU` | GENESIS-Design-System | `design-system` | [file-library.md](VKcN77ktPqrZsSmevqWboU/file-library.md) |
| `LtYM9KC03ETU5w3zZge0bD` | AI-Test | `chb5r5j5` | [file-library.md](LtYM9KC03ETU5w3zZge0bD/file-library.md) |

Note: the rows above predate the merge to a single `file-library.md` — their old
`component-library.md`/`variable-library.md` files are gone from disk, so on next
use of either file, follow "first use in a file" and rebuild `file-library.md`
fresh.

## How to pick the right library for the current file

1. Confirm the current file via `get_document_info` (returns `fileKey` + file name)
   or `figma_bridge_status`.
2. Look up `fileKey` in this index (or just check if `libraries/<fileKey>/` exists).
3. Read ONLY `libraries/<fileKey>/file-library.md` (plus any collection split
   files its Variables section points to). Never read another file's library.
4. If `libraries/<fileKey>/file-library.md` does not exist, build it ("first use
   in a file" flow).
5. When a new file is used for the first time, add a row to this index.
