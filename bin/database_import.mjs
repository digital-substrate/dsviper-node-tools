#!/usr/bin/env node
// Import a JSON export bundle (produced by database_export) into a NEW dsviper Database or
// CommitDatabase, preserving blob ids. Node port of dsviper-tools/database_import.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dsviper from '../src/dsviper.mjs';

const { Database, CommitDatabase, CommitState, CommitMutableState, DSMDefinitions,
        BlobLayout, Value, ValueBlob, ValueBlobId } = dsviper;

const CHUNK_SIZE = 48 * 1024 * 1024;
const fail = (m) => { console.error(m); process.exit(1); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const safeName = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '_');
const expand = (p) => p.replace(/^~(?=$|\/)/, os.homedir());

function loadManifest(bundle) {
    const p = path.join(bundle, 'manifest.json');
    if (!fs.existsSync(p)) fail(`Not an export bundle (missing manifest.json): ${bundle}`);
    return readJson(p);
}
function loadDefinitions(bundle, fmt) {
    if (fmt === 'xml') {
        const p = path.join(bundle, 'definitions.xml');
        if (!fs.existsSync(p)) fail(`Not an export bundle (missing definitions.xml): ${bundle}`);
        return DSMDefinitions.fromXmlString(fs.readFileSync(p, 'utf-8')).toDefinitions().const();
    }
    const p = path.join(bundle, 'definitions.json');
    if (!fs.existsSync(p)) fail(`Not an export bundle (missing definitions.json): ${bundle}`);
    return DSMDefinitions.fromJsonString(fs.readFileSync(p, 'utf-8')).toDefinitions().const();
}
function loadBlobIndex(bundle) {
    const p = path.join(bundle, 'blobs', 'index.json');
    return fs.existsSync(p) ? readJson(p) : [];
}

function importBlobs(store, bundle, blobIndex, verbose) {
    const blobsDir = path.join(bundle, 'blobs');
    for (const entry of blobIndex) {
        const blobId = ValueBlobId.tryParse(entry.id);
        if (blobId == null || !blobId.isValid()) fail(`Invalid blob id in index: ${entry.id}`);
        const layout = BlobLayout.parse(entry.layout);
        const size = entry.size;
        const p = path.join(blobsDir, `${entry.id}.bin`);
        if (!fs.existsSync(p)) fail(`Missing blob payload: ${p}`);
        const actual = fs.statSync(p).size;
        if (actual !== size) fail(`Blob ${entry.id} size mismatch: index says ${size}, file is ${actual}`);

        let stored;
        if (size <= CHUNK_SIZE) {
            stored = store.createBlob(blobId, layout, new ValueBlob(fs.readFileSync(p)));
        } else {
            store.createZeroBlob(blobId, layout, size);
            const fd = fs.openSync(p, 'r');
            try {
                const buf = Buffer.alloc(CHUNK_SIZE);
                let offset = 0;
                while (offset < size) {
                    const n = fs.readSync(fd, buf, 0, CHUNK_SIZE, offset);
                    store.writeBlob(blobId, new ValueBlob(buf.subarray(0, n)), offset);
                    offset += n;
                }
            } finally { fs.closeSync(fd); }
            stored = store.freezeBlob(blobId);
        }
        if (!stored) fail(`Failed to store blob ${entry.id}`);
    }
    if (verbose) console.log(`Imported ${blobIndex.length} blobs`);
}

function importDocuments(definitions, bundle, setDocument, verbose, fmt) {
    const documentsDir = path.join(bundle, 'documents');
    let total = 0;
    for (const attachment of definitions.attachments()) {
        const p = path.join(documentsDir, `${safeName(attachment.identifier())}.json`);
        if (!fs.existsSync(p)) continue;
        // entry.key / entry.document are the exact wire TEXT emitted at export (see the note there);
        // fed straight to from{Json,Xml}String, losslessly — no JS-object round-trip that would
        // collapse a whole-number double.
        for (const entry of readJson(p)) {
            const key = fmt === 'xml'
                ? Value.fromXmlString(entry.key, attachment.typeKey(), definitions)
                : Value.fromJsonString(entry.key, attachment.typeKey(), definitions);
            const document = fmt === 'xml'
                ? Value.fromXmlString(entry.document, attachment.documentType(), definitions)
                : Value.fromJsonString(entry.document, attachment.documentType(), definitions);
            setDocument(attachment, key, document);
            total++;
        }
    }
    if (verbose) console.log(`Imported ${total} documents`);
    return total;
}

function importIntoDatabase(output, documentation, definitions, bundle, blobIndex, verbose, fmt) {
    const db = Database.create(output, documentation);
    try {
        db.extendDefinitions(definitions);
        const live = db.definitions();
        db.beginTransaction();
        importBlobs(db.databasing(), bundle, blobIndex, verbose);
        const count = importDocuments(live, bundle, (a, k, d) => db.set(a, k, d), verbose, fmt);
        db.commit();
        return { count, hexdigest: db.definitionsHexdigest() };
    } catch (e) {
        if (db.inTransaction()) db.rollback();
        throw e;
    } finally {
        db.close();
    }
}

function importIntoCommitDatabase(output, documentation, definitions, bundle, blobIndex, label, verbose, fmt) {
    const cdb = CommitDatabase.create(output, documentation);
    try {
        cdb.extendDefinitions(definitions);
        const live = cdb.definitions();
        const store = cdb.commitDatabasing();
        store.beginTransaction();
        importBlobs(store, bundle, blobIndex, verbose);
        store.commit();
        const mutable = new CommitMutableState(new CommitState(live));
        const count = importDocuments(live, bundle, (a, k, d) => mutable.attachmentMutating().set(a, k, d), verbose, fmt);
        cdb.commitMutations(label, mutable);
        return { count, hexdigest: cdb.definitionsHexdigest() };
    } finally {
        cdb.close();
    }
}

function verify(manifest, documentCount, blobIndex, hexdigest) {
    const counts = manifest.counts || {};
    if (counts.documents != null && counts.documents !== documentCount)
        console.error(`Warning: document count mismatch (manifest ${counts.documents}, imported ${documentCount}).`);
    if (counts.blobs != null && counts.blobs !== blobIndex.length)
        console.error(`Warning: blob count mismatch (manifest ${counts.blobs}, imported ${blobIndex.length}).`);
    if (manifest.definitions_hexdigest && manifest.definitions_hexdigest !== hexdigest)
        console.error(`Warning: definitions hexdigest mismatch (manifest ${manifest.definitions_hexdigest}, imported ${hexdigest}).`);
    else if (manifest.definitions_hexdigest)
        console.log(`definitions hexdigest matches (${hexdigest}).`);
}

function main() {
    const argv = process.argv.slice(2);
    const args = { label: 'import', documentation: undefined, force: false, verbose: false, targetKind: null };
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--as') args.targetKind = argv[++i];
        else if (a === '--label') args.label = argv[++i];
        else if (a === '--documentation') args.documentation = argv[++i];
        else if (a === '--force') args.force = true;
        else if (a === '-v' || a === '--verbose') args.verbose = true;
        else if (!a.startsWith('-')) pos.push(a);
    }
    const [bundleArg, outputArg] = pos;
    if (!bundleArg || !outputArg)
        fail('usage: database_import <bundle> <output> [--as database|commit-database] [--label L] [--documentation D] [--force] [-v]');

    const bundle = expand(bundleArg);
    if (!fs.existsSync(bundle) || !fs.statSync(bundle).isDirectory()) fail(`No such bundle directory: ${bundle}`);
    const output = expand(outputArg);
    if (fs.existsSync(output)) {
        if (!args.force) fail(`Output already exists (use --force to overwrite): ${output}`);
        fs.rmSync(output);
    }

    const manifest = loadManifest(bundle);
    const fmt = manifest.format || 'json';
    if (fmt === 'xml' && typeof Value.fromXmlString !== 'function')
        fail('bundle is in XML format but the installed dsviper lacks XML support.');
    const definitions = loadDefinitions(bundle, fmt);
    const blobIndex = loadBlobIndex(bundle);

    const kind = args.targetKind || (manifest.source_type === 'CommitDatabase' ? 'commit-database' : 'database');
    const documentation = args.documentation !== undefined ? args.documentation : (manifest.documentation || undefined);

    let result, label;
    if (kind === 'commit-database') {
        result = importIntoCommitDatabase(output, documentation, definitions, bundle, blobIndex, args.label, args.verbose, fmt);
        label = 'CommitDatabase';
    } else {
        result = importIntoDatabase(output, documentation, definitions, bundle, blobIndex, args.verbose, fmt);
        label = 'Database';
    }

    verify(manifest, result.count, blobIndex, result.hexdigest);
    if (args.verbose) console.log(`Wrote ${label} to ${output} (${result.count} documents, ${blobIndex.length} blobs)`);
}

main();
