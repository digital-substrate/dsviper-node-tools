# @digitalsubstrate/dsviper-tools (Node)

Node CLI + REPL tooling over [`@digitalsubstrate/dsviper`](https://www.npmjs.com/package/@digitalsubstrate/dsviper)
— a port of the headless Python `dsviper-tools`. It doubles as a real-consumer validation of the
N_Viper binding surface (it exercises the read/write/DSM/blob paths on real 3D databases).

## Tools

| Command | What it does |
|---|---|
| `database_export <db> [--commit-id last\|first\|<id>] [--output dir] [-v]` | Export a Database / CommitDatabase to a JSON bundle (embedded definitions, documents per attachment, blobs with layouts). |
| `database_import <bundle> <out> [--as database\|commit-database] [--force] [-v]` | Import a bundle into a NEW Database / CommitDatabase, preserving blob ids. |
| `dsm_util <check\|encode\|decode\|create_database\|create_commit_database> …` | DSM utilities: parse-check, DSM ⇄ JSON, and empty-database creation from a `.dsm`. |
| `commit_admin <reset\|reduce_heads\|sync> (--database D \| --host H [--port P] \| --socket-path S) …` | Administer a CommitDatabase: wipe commits, collapse heads, or sync into another CommitDatabase. |
| `service_client [host] [port] \| [host:port] \| [port]` | The **universal REPL client** for any Viper service — connects a `ServiceRemote` and drops you into a `node:repl` with a fluent, tab-completable view over its function pools (`pools.Tools.add(12, 23)`), attachment pools, and the session live (`s`, `defs`). The Node twin of `python -i service_client.py`. |

`database_export` then `database_import` round-trips a database losslessly (matching definitions
hexdigest), validated on real 3D databases up to 3.3 GB — the re-imported database opens and
renders identically in the 3D application.

## Scope (port from the Python `dsviper-tools`)

- **Ported** (headless): `database_export`, `database_import`, `dsm_util`, `commit_admin`,
  `service_client` (REPL).
- **Not ported**:
  - the QML editors (`cdbe` / `dbe`) — Qt/QML;
  - the blocking `commit_database_server` — its thread-per-connection accept loop is incompatible
    with the Node event loop (a synchronous REPL *client* is fine; a server is not);
  - the kibo code-generation subcommands of `dsm_util`
    (`create_python_package` / `create_node_package`) — they shell out to the Java generator, not
    the binding; a follow-up.

## The JSON round-trip gotcha (important)

**Do not round-trip a typed Viper value through `JSON.parse` / `JSON.stringify`.** JS `number` has
no int/float split, so a whole-number double collapses (`1.0` → `1`) and the strict Viper decoder
then rejects it (`expected json double`). Keep the JSON **text** end to end
(`Value.toJsonString` → `Value.fromJsonString`), or use the binary channel
(`Value.encode` / `Value.decode`). `database_export` / `import` store document values as JSON text
for exactly this reason.

## Dev

In development `node_modules/@digitalsubstrate/dsviper` is npm-linked onto the viper repo's
`dsviper_node`; on publish it is a normal peer dependency (`>=1.2.3`).

## License

MIT.
