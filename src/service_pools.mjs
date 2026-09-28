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
/** @import * as V from '@digitalsubstrate/dsviper' */

/**
 * A pool of a service, plain or attachment.
 * @typedef {V.ServiceRemoteFunctionPool | V.ServiceRemoteAttachmentFunctionPool} RemotePool
 */
/**
 * A function as listed by a pool, plain or attachment.
 * @typedef {V.ServiceRemoteFunctionPoolFunction | V.ServiceRemoteAttachmentFunctionPoolFunction} RemotePoolFunction
 */
/**
 * A callable remote function, plain or attachment.
 * @typedef {V.ServiceRemoteFunction | V.ServiceRemoteAttachmentFunction} RemoteFunction
 */
/**
 * An argument forwarded as given: an attachment function takes its AttachmentMutating first.
 * @typedef {V.InputValue | V.AttachmentMutating} PoolArgument
 */
/**
 * One pool's view: function name -> callable remote function.
 * @typedef {Record<string, (...args: PoolArgument[]) => V.OutputValue>} PoolView
 */
/**
 * A service's pools view: pool name -> pool view.
 * @typedef {Record<string, PoolView>} PoolsView
 */

const INSPECT = Symbol.for('nodejs.util.inspect.custom');
/**
 * @template T
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

/**
 * The signature of a remote function, e.g. "add(a: int64, b: int64) -> int64".
 * @param {RemotePoolFunction} func
 * @returns {string}
 */
export const signatureOf = (func) => func.prototype().toString();
/**
 * The name of a remote function.
 * @param {RemotePoolFunction} func
 * @returns {string}
 */
export const nameOf = (func) => signatureOf(func).split('(')[0];

// One pool -> a null-proto object whose keys are the function names, each value the callable
// remote function (with a custom-inspect rendering its signature + doc).
/**
 * @param {string} poolName
 * @param {RemotePool} pool
 * @param {(pool: string, func: string) => RemoteFunction} getFunc
 * @returns {PoolView}
 */
function buildPool(poolName, pool, getFunc) {
    /** @type {PoolView} */
    const poolObj = Object.create(null);
    for (const func of safe(() => pool.functions(), [])) {
        const signature = signatureOf(func);
        const funcName = nameOf(func);
        const doc = safe(() => func.documentation(), '');
        const call = (/** @type {PoolArgument[]} */ ...args) =>
            /** @type {{ call(...args: PoolArgument[]): V.OutputValue }} */ (getFunc(poolName, funcName)).call(...args);
        call[INSPECT] = () => (doc ? `${signature}\n${doc}` : signature);
        poolObj[funcName] = call;
    }
    Object.defineProperty(poolObj, INSPECT, {
        value: () => `${poolName} { ${Object.keys(poolObj).join(', ')} }`, enumerable: false,
    });
    return poolObj;
}

// The pools of a service -> a null-proto object keyed by pool name.
/**
 * Build the fluent view over the pools of a service.
 * @param {() => RemotePool[]} listPools lists the pools (e.g. `() => s.functionPools()`)
 * @param {(pool: string, func: string) => RemoteFunction} getFunc resolves a callable function
 * @param {string} label the name the view's inspection prints
 * @returns {PoolsView}
 */
export function buildPools(listPools, getFunc, label) {
    /** @type {PoolsView} */
    const pools = Object.create(null);
    for (const pool of safe(() => listPools(), []))
        pools[pool.name()] = buildPool(pool.name(), pool, getFunc);
    Object.defineProperty(pools, INSPECT, {
        value: () => `${label} { ${Object.keys(pools).join(', ')} }`, enumerable: false,
    });
    return pools;
}
