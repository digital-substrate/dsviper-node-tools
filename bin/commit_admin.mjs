#!/usr/bin/env node
// Commit-database admin — reset / reduce_heads / sync a CommitDatabase source (a local file, a
// host:port, or a unix socket). Node port of dsviper-tools/commit_admin.py.
//
//   commit_admin --database ~/db.rapmc reset
//   commit_admin --database ~/src.rapmc reduce_heads --loop --update-interval 5
//   commit_admin --host 127.0.0.1 --port 54321 sync ~/local.rapmc --loop --update-interval 2 -vv
import fs from 'node:fs';
import { homedir } from 'node:os';
import dsviper from '../src/dsviper.mjs';

const { CommitDatabase, CommitDatabaseHelper, CommitSynchronizer, LoggerConsole, LoggerNull, Logging } = dsviper;

const fail = (m) => { console.error(m); process.exit(1); };
const expand = (p) => (p ? p.replace(/^~(?=$|\/)/, homedir()) : p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
    const a = { verbose: 0, database: null, host: null, port: '54321', socketPath: null,
                sub: null, file: null, loop: false, updateInterval: null, blobDataSize: 25 };
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--verbose') a.verbose++;
        else if (/^-v+$/.test(t)) a.verbose += t.length - 1;   // -v, -vv, -vvv (argparse count)
        else if (t === '--database') a.database = argv[++i];
        else if (t === '--host') a.host = argv[++i];
        else if (t === '--port') a.port = argv[++i];
        else if (t === '--socket-path') a.socketPath = argv[++i];
        else if (t === '--loop') a.loop = true;
        else if (t === '--update-interval') a.updateInterval = Number(argv[++i]);
        else if (t === '--blob-data-size') a.blobDataSize = Number(argv[++i]);
        else if (t.startsWith('-')) fail(`unknown option: ${t}`);
        else pos.push(t);
    }
    a.sub = pos[0];
    if (a.sub === 'sync') a.file = pos[1];
    return a;
}

// The CommitDatabase for the source (local file / socket / host:port). open()/connect()/
// connectLocal() already return a CommitDatabase — no need to reconstruct one from its
// CommitDatabasing (the runtime forbids that anyway; use the static factories).
function openSource(args) {
    if (args.database == null && args.host == null && args.socketPath == null)
        fail('use --database, --host or --socket-path to specify the source');
    let db, description;
    if (args.database) { db = CommitDatabase.open(expand(args.database)); description = args.database; }
    else if (args.socketPath) { db = CommitDatabase.connectLocal(args.socketPath); description = args.socketPath; }
    else { db = CommitDatabase.connect(args.host, String(args.port)); description = `${args.host}:${args.port}`; }
    if (args.verbose) console.log(`Server: ${description}`);
    return db;
}

function reset(args) {
    const db = openSource(args);
    db.commitDatabasing().resetCommits();
    db.close();
}

async function reduceHeads(args) {
    const db = openSource(args);
    const interval = (args.updateInterval ?? 2) * 1000;
    if (args.loop) for (;;) { CommitDatabaseHelper.reduceHeads(db); await sleep(interval); }
    else CommitDatabaseHelper.reduceHeads(db);
    db.close();
}

async function sync(args) {
    if (!args.file) fail('usage: commit_admin sync <file> [--loop] [--update-interval sec] [--blob-data-size Mo]');
    const sourceDb = openSource(args);
    const source = sourceDb.commitDatabasing();
    const filename = expand(args.file);
    const dest = fs.existsSync(filename) ? CommitDatabase.open(filename)
                                         : CommitDatabase.create(filename, source.documentation());

    const level = args.verbose === 1 ? Logging.LEVEL_CRITICAL
                : args.verbose === 2 ? Logging.LEVEL_INFO
                : args.verbose >= 3 ? Logging.LEVEL_DEBUG
                : null;
    const logging = (level != null ? new LoggerConsole(level) : new LoggerNull()).logging();

    const synchronizer = new CommitSynchronizer(source, dest.commitDatabasing(), 'Sync', args.blobDataSize * 1024 * 1024);
    const interval = (args.updateInterval ?? 5) * 1000;
    if (args.loop) for (;;) { synchronizer.sync(logging); await sleep(interval); }
    else synchronizer.sync(logging);

    dest.close();
    sourceDb.close();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    switch (args.sub) {
        case 'reset': return reset(args);
        case 'reduce_heads': return reduceHeads(args);
        case 'sync': return sync(args);
        default:
            console.log('usage: commit_admin <reset|reduce_heads|sync> ' +
                '(--database D | --host H [--port P] | --socket-path S) [-v...]');
            console.log('  reduce_heads [--loop] [--update-interval sec]');
            console.log('  sync <file>  [--loop] [--update-interval sec] [--blob-data-size Mo]');
            process.exit(1);
    }
}

main();
