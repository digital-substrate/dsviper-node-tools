#!/usr/bin/env node
// Commit-database server — serve a CommitDatabase over a unix socket or TCP.
// Node port of dsviper-tools/commit_database_server.py.
//
//   commit_database_server --socket-path /tmp/cdb.sock ~/db.rapmc
//   commit_database_server --host 0.0.0.0 --port 54321 ~/db.rapmc -vv
//
// step() is a bounded wait, so the loop yields to the event loop between calls:
// that is what lets SIGINT be delivered, exactly as the Python handler runs
// between bytecodes. Only pure C++ loggers exist in this binding, so nothing
// can call back into JS from the C++ threads that serve each client.
import fs from 'node:fs';
import { homedir } from 'node:os';
import dsviper from '../src/dsviper.mjs';

const { Cancelation, CommitDatabase, CommitDatabaseServer, LoggerConsole, LoggerNull, Logging, Socket } = dsviper;

const fail = (m) => { console.error(m); process.exit(1); };
const expand = (p) => (p ? p.replace(/^~(?=$|\/)/, homedir()) : p);

function parseArgs(argv) {
    const a = { verbose: 0, host: '0.0.0.0', port: '54321', socketPath: null, database: null };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '-v' || v === '--verbose') a.verbose += 1;
        else if (v === '-vv') a.verbose += 2;
        else if (v === '-vvv') a.verbose += 3;
        else if (v === '--host') a.host = argv[++i];
        else if (v === '--port') a.port = argv[++i];
        else if (v === '--socket-path') a.socketPath = expand(argv[++i]);
        else if (v === '-h' || v === '--help') a.help = true;
        else if (!v.startsWith('-')) a.database = expand(v);
        else fail(`unknown option ${v}`);
    }
    return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.database) {
    console.log('usage: commit_database_server [-v] [--host H] [--port P] [--socket-path S] database');
    process.exit(args.help ? 0 : 1);
}

if (!CommitDatabase.isCompatible(args.database)) fail('Not a Commit Database.');

let level = Logging.LEVEL_ALL;
if (args.verbose === 1) level = Logging.LEVEL_CRITICAL;
else if (args.verbose === 2) level = Logging.LEVEL_INFO;
else if (args.verbose >= 3) level = Logging.LEVEL_DEBUG;

const logging = args.verbose ? new LoggerConsole(level).logging() : new LoggerNull().logging();

let socket;
if (args.socketPath) {
    if (fs.existsSync(args.socketPath)) fs.unlinkSync(args.socketPath);
    socket = Socket.createPassiveLocal(args.socketPath);
} else {
    socket = Socket.createPassiveInet(args.host, String(args.port));
}

const cancelation = new Cancelation();
process.on('SIGINT', () => {
    console.log('Server cancelation requested...\n');
    cancelation.cancel();
});

const server = new CommitDatabaseServer(args.database, socket, logging, cancelation);
server.start();

const tick = () => {
    if (!server.step(1) || cancelation.requested()) {
        const remaining = server.finishBefore(5);
        if (remaining) {
            console.error(`${remaining} client thread(s) still running, the server did not stop cleanly.`);
            process.exit(1);
        }
        console.log('The server finished gracefully.');
        process.exit(0);
    }
    setImmediate(tick);
};
tick();
