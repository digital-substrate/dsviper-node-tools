// Pure unit over the endpoint parser — no binding, no network, so it runs everywhere.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEndpoint, DEFAULT_HOST, DEFAULT_PORT } from '../src/endpoint.mjs';

describe('parseEndpoint', () => {
    it('defaults to localhost:54328 with no args', () => {
        assert.deepEqual(parseEndpoint([]), { host: DEFAULT_HOST, port: DEFAULT_PORT });
    });
    it('reads a bare number as the port', () => {
        assert.deepEqual(parseEndpoint(['54329']), { host: 'localhost', port: '54329' });
    });
    it('splits the combined host:port form', () => {
        assert.deepEqual(parseEndpoint(['myhost:54329']), { host: 'myhost', port: '54329' });
    });
    it('accepts the positional host port form', () => {
        assert.deepEqual(parseEndpoint(['myhost', '54329']), { host: 'myhost', port: '54329' });
    });
    it('takes a lone non-numeric arg as the host, default port', () => {
        assert.deepEqual(parseEndpoint(['myhost']), { host: 'myhost', port: DEFAULT_PORT });
    });
    it('falls back to the default port when the port half is empty', () => {
        assert.deepEqual(parseEndpoint(['myhost:']), { host: 'myhost', port: DEFAULT_PORT });
    });
    it('lets the combined form win over a stray extra arg', () => {
        assert.deepEqual(parseEndpoint(['localhost:54329', 'ignored']), { host: 'localhost', port: '54329' });
    });
});
