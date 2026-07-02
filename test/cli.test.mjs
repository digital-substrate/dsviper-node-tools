// Smoke over the CLIs: each tool must load (it imports the peer binding at start-up) and print
// its usage on a no-op invocation, and service_client must fail a dead endpoint cleanly (no raw
// stack). These import the binding, so — like query's integration tests — the gate needs
// @digitalsubstrate/dsviper installed; until it is, the run fails by design.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = (name) => fileURLToPath(new URL(`../bin/${name}`, import.meta.url));
const run = (name, args = []) => spawnSync(process.execPath, [bin(name), ...args], { encoding: 'utf8' });

describe('CLI smoke', () => {
    for (const tool of ['database_export.mjs', 'database_import.mjs', 'dsm_util.mjs', 'commit_admin.mjs']) {
        it(`${tool} prints usage with no args`, () => {
            const { stdout, stderr, status } = run(tool);
            assert.match(`${stdout}${stderr}`, /usage:/, `expected a usage line from ${tool}`);
            assert.notEqual(status, null, `${tool} should not crash on a signal`);
        });
    }

    it('service_client fails a dead endpoint cleanly (no raw stack)', () => {
        // Port 1 is privileged and unused — connect is refused, so we exercise the error path.
        const { stdout, stderr, status } = run('service_client.mjs', ['127.0.0.1:1']);
        const out = `${stdout}${stderr}`;
        assert.match(out, /Cannot connect to Viper service 127\.0\.0\.1:1/);
        assert.doesNotMatch(out, /at file:/, 'a clean message, not a raw stack trace');
        assert.equal(status, 1);
    });
});
