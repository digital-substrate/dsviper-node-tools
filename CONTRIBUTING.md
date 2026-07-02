# Contributing to dsviper-node-tools

Thanks for your interest in contributing.

## Reporting issues

Use [GitHub Issues](https://github.com/digital-substrate/dsviper-node-tools/issues).
Useful reports include:

- The `@digitalsubstrate/dsviper-tools` and `@digitalsubstrate/dsviper` versions, and your
  platform / Node version.
- The exact command line and a minimal reproducer (ideally a small `.dsm` or database).

## Submitting pull requests

1. Fork the repository and create a feature branch from the default branch
   (see the project's branch policy).
2. Each tool is a self-contained CLI under `bin/`; shared helpers live in `src/`
   (`dsviper.mjs` resolves the binding, `endpoint.mjs` parses a service endpoint,
   `service_pools.mjs` builds the REPL pool views). Keep pure helpers binding-free so they
   unit-test on their own.
3. Add tests under `test/` with the built-in `node:test` runner and `node:assert`;
   run `npm test` and make sure everything passes. The CLI smoke tests need the peer binding
   (`@digitalsubstrate/dsviper`) installed; the pure helper tests do not.

## Design notes

This is a **consumer-side** port of the headless Python `dsviper-tools`: it adds nothing to the
binding, it only drives its public surface. Keeping each tool ~1:1 with its Python counterpart is
a deliberate maintainability choice.

The tools store document values as **JSON text** end to end (`toJsonString` → `fromJsonString`),
never as `JSON.parse`d JS objects: a JS `number` has no int/float split, so round-tripping a typed
value through a native object is lossy on whole-number doubles (`1.0` → `1`, which the strict
decoder rejects). Use the JSON text channel or the binary `encode`/`decode` channel.

## Requirements

Node.js >= 22; `@digitalsubstrate/dsviper` >= 1.2.3.

## License

By contributing you agree your contributions are licensed under the project's MIT License
(inbound = outbound). No CLA required.
