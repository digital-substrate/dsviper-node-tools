#!/usr/bin/env node
// The universal REPL client for any Viper service — the Node twin of
// `python -i service_client.py`. It connects a ServiceRemote and drops you into an
// interactive REPL, with a fluent proxy over the service's function pools:
//
//   viper> pools.Tools.add(12, 23)          // -> the remote result
//   viper> pools.<TAB>                       // completes pool names
//   viper> pools.Tools.<TAB>                 // completes function names
//   viper> pools.Tools.add                   // prints the signature + doc
//
// Attachment functions take a mutating state as their (injected) first argument:
//   viper> const ms = new CommitMutableState(new CommitState(s.definitions()))
//   viper> attachmentPools.PlayerModel.create(ms.attachmentMutating(), "houga", "expert")
//
// The pools views (src/service_pools.mjs) are PURE JS sugar over the explicit binding API
// (s.functionPools() / s.functionPoolFunc(pool, name).call(...)); the binding stays no-Proxy.
// Every dsviper class is spread into the REPL context (CommitState, CommitMutableState, …).
import repl from 'node:repl';
import dsviper from '../src/dsviper.mjs';
import { buildPools, nameOf, signatureOf } from '../src/service_pools.mjs';
import { parseEndpoint } from '../src/endpoint.mjs';

const { Definitions, ServiceRemote } = dsviper;
const safe = (fn) => { try { return fn(); } catch { /* ignore */ } };

// Forgiving endpoint parsing (src/endpoint.mjs) — `host`, `port`, `host:port`, or `host port`.
const { host, port } = parseEndpoint(process.argv.slice(2));

const defs = new Definitions();
let s;
try {
    s = ServiceRemote.connect(host, port, defs);
} catch (e) {
    console.error(`Cannot connect to Viper service ${host}:${port} — ${e.message ?? e}`);
    console.error('Usage: service_client [host] [port] | [host:port] | [port]   (default localhost:54328)');
    process.exit(1);
}

const pools = buildPools(() => s.functionPools(), (p, f) => s.functionPoolFunc(p, f), 'Pools');
const attachmentPools = buildPools(
    () => s.attachmentFunctionPools(), (p, f) => s.attachmentFunctionPoolFunc(p, f), 'AttachmentPools');
// Match Python's `s.pools.…` when the native handle accepts the extra property.
safe(() => { s.pools = pools; s.attachmentPools = attachmentPools; });

// Banner introspected from THIS service — only its real pools/functions, so the hints are
// always truthful (the client is universal; nothing is hard-coded to a particular schema).
function banner() {
    const funcPools = safe(() => s.functionPools()) ?? [];
    const attachPools = safe(() => s.attachmentFunctionPools()) ?? [];
    const lines = [`Connected to Viper service ${host}:${port}.`];
    if (funcPools.length) lines.push(`  function pools:   ${funcPools.map((p) => p.name()).join(', ')}`);
    if (attachPools.length) lines.push(`  attachment pools: ${attachPools.map((p) => p.name()).join(', ')}`);
    lines.push('In scope: s, pools, attachmentPools, defs + every dsviper class (CommitState, CommitMutableState, …).');
    lines.push('Tips: <TAB> completes pools/functions; a function name alone prints its signature.');

    const p0 = funcPools[0], f0 = p0 && safe(() => p0.functions()[0]);
    if (f0) lines.push(`  e.g.  pools.${p0.name()}.${nameOf(f0)}(…)      // ${signatureOf(f0)}`);
    const ap0 = attachPools[0], af0 = ap0 && safe(() => ap0.functions()[0]);
    if (af0) {
        lines.push('  attachment functions take a mutating state as their first argument:');
        lines.push('    const ms = new CommitMutableState(new CommitState(s.definitions()))');
        lines.push(`    attachmentPools.${ap0.name()}.${nameOf(af0)}(ms.attachmentMutating(), …)   // ${signatureOf(af0)}`);
    }
    console.log(lines.join('\n'));
}
banner();

const r = repl.start('viper> ');
Object.assign(r.context, dsviper);   // every dsviper export (Value, Type, CommitState, CommitMutableState, …)
Object.assign(r.context, { dsviper, defs, s, pools, attachmentPools });
r.on('exit', () => {
    safe(() => s.close?.());
    process.exit(0);
});
