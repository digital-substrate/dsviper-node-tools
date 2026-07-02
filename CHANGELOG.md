# Changelog — @digitalsubstrate/dsviper-tools

All notable changes to this package. Format: [Keep a Changelog](https://keepachangelog.com/),
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- Initial Node port of the headless Python `dsviper-tools`, over `@digitalsubstrate/dsviper`.
- `database_export` / `database_import` — Database & CommitDatabase ⇄ JSON bundle (embedded
  definitions, documents per attachment stored as JSON **text**, blobs with layouts, blob ids
  preserved). Round-trips losslessly (matching definitions hexdigest); validated on real 3D
  databases up to 3.3 GB — the re-imported database opens and renders identically in the 3D
  application.
- `dsm_util` — `check` / `encode` / `decode` (DSM ⇄ JSON) and `create_database` /
  `create_commit_database` from a `.dsm`.
- `commit_admin` — `reset` / `reduce_heads` / `sync` over a local file, socket or `host:port`
  CommitDatabase.
- `service_client` — the universal REPL client for any Viper service (the Node twin of
  `python -i service_client.py`): a fluent, tab-completable, self-documenting view over the
  service's function pools (`pools.Tools.add(12, 23)`), attachment pools with an injected mutating
  state, a banner introspected from the connected service, and forgiving endpoint parsing
  (`host`, `port`, `host:port`, or `host port`).

### Scope

- GUI editors (`cdbe`/`dbe`), the blocking `commit_database_server`, and `dsm_util`'s kibo
  code-gen subcommands (`create_python_package`/`create_node_package`) stay out of scope.

### Requirements

- Node.js >= 22.
- `@digitalsubstrate/dsviper` >= 1.2.3 (the binding stub fixes the tools rely on).
