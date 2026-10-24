# Changelog — @digitalsubstrate/dsviper-tools

All notable changes to this package. Format: [Keep a Changelog](https://keepachangelog.com/),
[SemVer](https://semver.org/).

## [Unreleased]

### Fixed

- **`database_import` gives back every document of a bundle, or refuses it.** It matched each
  attachment to its file by identifier, whose spelling the 1.2.29 runtime changed for an
  attachment keyed by another namespace's concept: a bundle exported with one binding version
  lost those documents in the other, with a warning. The manifest lists the attachments by
  runtime id; a file no attachment claims, or a document count the manifest does not state,
  stops the import before it writes anything.
- **`database_export` read id sets as arrays.** A binding returning them as `ValueSet` made the
  head list and the blob index throw; they are spread first, which works with either.
- **`service_client` typed an attachment call as plain values.** An attachment function takes its
  `CommitAttachmentMutating` first, as the binding now declares; the pool view says so.

### Changed

- **Requires `@digitalsubstrate/dsviper >= 1.2.16`**, the first binding to name
  `CommitAttachmentMutating`, which the type annotations use; the type check fails against an
  earlier one.
- **A bundle is the one `dsviper-tools` writes** (`bundle_version` 2): either tool reads the
  other's. A bundle dsviper-tools 1.2.0 wrote, its documents as JSON objects, is refused:
  JavaScript cannot read them back without turning a whole-number double into an integer.
- **Requires `@digitalsubstrate/dsviper` >= 1.2.15,** the release whose declarations the
  package is typed against, and whose bundles find attachments by runtime id.
- **Typed against the binding's declarations.** `npm run typecheck` runs TypeScript over the
  package's `.mjs` through JSDoc; no call into the binding is made on an untyped receiver.

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
- `@digitalsubstrate/dsviper` >= 1.2.13.
