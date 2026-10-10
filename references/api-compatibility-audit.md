# SiYuan API compatibility audit

Audit date: 2026-10-10  
Reference: [Official SiYuan API.md](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)

## Scope and findings

The audit scanned the repository's JavaScript scripts for statically named API routes and compared SiYuan routes with the public endpoint sections in the current official API document. The `QDRANT` and `Ollama` client routes are external service APIs, not SiYuan endpoints.

### Corrected for the requested workflow

- `update.js` can resolve a unique document using `--path`, including a path that begins with a notebook name or notebook ID, then update that document.
- Document-ID validation in `update.js` now uses the documented `/api/filetree/getPathByID` route. The returned storage path identifies a document root by its `/<id>.sy` suffix, avoiding the undocumented block-info route and SQL index timing.
- `search.js --mode keyword` no longer requires Qdrant/Ollama configuration. The search manager already falls back to SiYuan SQL search when vector search is unavailable.
- Path-based create and read already use documented `/api/filetree/createDocWithMd` and `/api/filetree/getIDsByHPath` routes when the notebook is included in the path.

### Compatibility risk in existing commands

The repository still calls these SiYuan routes that have no dedicated public endpoint section in API.md:

| Route | Existing callers | Risk |
|---|---|---|
| `/api/block/getBlockInfo` | Block and document inspection, validation, move/delete, and related commands | Internal route behavior is not covered by the public compatibility contract. |
| `/api/filetree/listDocsByPath` | Structure listing and move operations | Internal route behavior is not covered by the public compatibility contract. |

The official API document says only interfaces with dedicated sections are public; other kernel routes do not carry compatibility guarantees. These remaining callers are outside the acceptance-path fix and should be migrated to documented endpoints in a separate change.

## Official feature areas not represented as dedicated skill commands

The repository exposes a useful subset of the public API, not full API parity. The current scripts do not provide dedicated commands for:

- Notebook configuration read/write, notebook creation/removal, and notebook/document ordering or sort configuration.
- Asset upload.
- Block prepend/append operations.
- Attribute-view/database operations and saved-search-criteria management.
- Template rendering, workspace file operations, export files/folders, and Pandoc conversion.
- Notification and network proxy APIs.

Some of these capabilities may be approximated through existing SQL, block, or document commands, but those are not equivalent to exposing each official endpoint's full behavior.

## Endpoint notes

- SiYuan endpoints found in scripts and represented in API.md include notebook listing/opening, document creation/path resolution/move/rename/remove, block operations, attributes, SQL, Markdown export, and system status.
- `/api/tags` and `/api/embeddings` occur in the Ollama embedding client and are not SiYuan API calls.
- This is a static route and capability audit; it does not claim full parameter-level verification for every legacy command.
