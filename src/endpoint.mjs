// Forgiving service endpoint parsing — a pure helper (no binding), so it unit-tests on its own.
// Every shape below resolves to the same { host, port }:
//   []                 -> localhost:54328
//   ['54329']          -> localhost:54329   (a bare number is a port)
//   ['host:54329']     -> host:54329        (combined, the usual convention)
//   ['host', '54329']  -> host:54329        (positional, Python-compatible)
//   ['host']           -> host:54328
export const DEFAULT_HOST = 'localhost';
export const DEFAULT_PORT = '54328';

export function parseEndpoint(argv) {
    let host = DEFAULT_HOST, port = DEFAULT_PORT;
    if (argv.length === 1) {
        const a = argv[0];
        if (/^\d+$/.test(a)) port = a;                          // bare number -> port
        else if (a.includes(':')) [host, port] = a.split(':');  // host:port
        else host = a;                                          // host only
    } else if (argv.length >= 2) {
        [host, port] = argv[0].includes(':') ? argv[0].split(':') : [argv[0], argv[1]];
    }
    return { host: host || DEFAULT_HOST, port: port || DEFAULT_PORT };
}
