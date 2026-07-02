// Fluent, tab-completable, self-documenting view over a Viper service's function pools — the
// ergonomic layer Python gets from __getattr__/__dir__/__doc__. PURE JS sugar over the explicit
// binding API (s.functionPools() / s.functionPoolFunc(pool, name).call(...)); the binding stays
// no-Proxy.
//
// Built as REAL objects (not a Proxy): the pool and function names are enumerable off the
// service, so a plain object with real properties is both simpler and better than a Proxy — the
// node:repl completer lists real properties natively (it does NOT complete Proxy traps), and
// util.inspect honours a real object's custom-inspect (it bypasses a Proxy's). A snapshot is taken
// at build time; a service's definitions are fixed for the session.
//
// All metadata comes straight off the function objects: `func.prototype().toString()` renders
// "add(a: int64, b: int64) -> int64" (name + signature), `func.documentation()` the doc.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

export const signatureOf = (func) => func.prototype().toString();
export const nameOf = (func) => signatureOf(func).split('(')[0];

// One pool -> a null-proto object whose keys are the function names, each value the callable
// remote function (with a custom-inspect rendering its signature + doc).
function buildPool(poolName, pool, getFunc) {
    const poolObj = Object.create(null);
    for (const func of safe(() => pool.functions(), [])) {
        const signature = signatureOf(func);
        const funcName = nameOf(func);
        const doc = safe(() => func.documentation(), '');
        const call = (...args) => getFunc(poolName, funcName).call(...args);
        call[INSPECT] = () => (doc ? `${signature}\n${doc}` : signature);
        poolObj[funcName] = call;
    }
    Object.defineProperty(poolObj, INSPECT, {
        value: () => `${poolName} { ${Object.keys(poolObj).join(', ')} }`, enumerable: false,
    });
    return poolObj;
}

// The pools of a service -> a null-proto object keyed by pool name.
export function buildPools(listPools, getFunc, label) {
    const pools = Object.create(null);
    for (const pool of safe(() => listPools(), []))
        pools[pool.name()] = buildPool(pool.name(), pool, getFunc);
    Object.defineProperty(pools, INSPECT, {
        value: () => `${label} { ${Object.keys(pools).join(', ')} }`, enumerable: false,
    });
    return pools;
}
