#!/usr/bin/env node
// DSM utility — check / encode / decode / create_database / create_commit_database.
// Node port of the DSM-API subcommands of dsviper-tools/dsm_util.py. The kibo-codegen
// subcommands (create_python_package / create_node_package) are a follow-up: they shell out to
// the Java generator, not the dsviper binding.
import fs from 'node:fs';
import os from 'node:os';
import dsviper from '../src/dsviper.mjs';

const { DSMDefinitions, DSMBuilder, CommitDatabase, Database } = dsviper;

const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

function fatalReportError(report, message) {
    if (report.hasError()) {
        console.log(message);
        console.log('parse errors detected in DSM Definitions.');
        console.log('use the sub-command check to display errors.');
        process.exit(1);
    }
}

function check(input) {
    const [report] = DSMBuilder.assemble(expand(input)).parse();
    if (report.hasError()) {
        for (const error of report.errors()) console.log(String(error.representation?.() ?? error));
        return 1;
    }
    return 0;
}

function encode(input, outJson) {
    const [report, dsmDefinitions] = DSMBuilder.assemble(expand(input)).parse();
    fatalReportError(report, "can't encode dsm definitions.");
    fs.writeFileSync(expand(outJson), dsmDefinitions.toJsonString());
    return 0;
}

function decode(inJson, outDsm) {
    const dsmDefinitions = DSMDefinitions.fromJsonString(fs.readFileSync(expand(inJson), 'utf-8'));
    fs.writeFileSync(expand(outDsm), dsmDefinitions.toDsm());
    return 0;
}

function createDb(ctor, input, output, documentation, force) {
    const [report, , definitions] = DSMBuilder.assemble(expand(input)).parse();
    fatalReportError(report, "can't create a database.");
    const out = expand(output);
    if (fs.existsSync(out) && force) fs.rmSync(out);
    const db = ctor.create(out, documentation);
    db.extendDefinitions(definitions);
    db.close();
    return 0;
}

function main() {
    const argv = process.argv.slice(2);
    const sub = argv[0];
    const pos = [];
    let force = false;
    let documentation = 'Not Documented';
    for (let i = 1; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force') force = true;
        else if (a === '--documentation') documentation = argv[++i];
        else if (!a.startsWith('-')) pos.push(a);
    }
    switch (sub) {
        case 'check': return check(pos[0]);
        case 'encode': return encode(pos[0], pos[1]);
        case 'decode': return decode(pos[0], pos[1]);
        case 'create_database': return createDb(Database, pos[0], pos[1], documentation, force);
        case 'create_commit_database': return createDb(CommitDatabase, pos[0], pos[1], documentation, force);
        default:
            console.log('usage: dsm_util <check|encode|decode|create_database|create_commit_database> <args> [--force] [--documentation D]');
            console.log('(create_python_package / create_node_package: follow-up — need the kibo jar + templates)');
            return 1;
    }
}

process.exit(main());
