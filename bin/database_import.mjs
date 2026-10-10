#!/usr/bin/env node
// Import a JSON export bundle (produced by database_export) into a NEW dsviper Database or
// CommitDatabase, preserving blob ids. Node port of dsviper-tools/database_import.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dsviper from '../src/dsviper.mjs';

const { Database, CommitDatabase, CommitState, CommitMutableState, DSMDefinitions,
        BlobLayout, Value, ValueBlob, ValueBlobId } = dsviper;

/** @import * as V from '@digitalsubstrate/dsviper' */

/**
 * The fields of the bundle's manifest the import reads; each may be absent.
 * @typedef {object} BundleManifest
 * @property {string} [source_type]
 * @property {string} [documentation]
 * @property {string} [definitions_hexdigest]
 * @property {string} [format]
 * @property {{ documents?: number, blobs?: number }} [counts]
 * @property {{ runtime_id: string, identifier: string, file: string }[]} [attachments]
 */
/**
 * One entry of the bundle's blob index.
 * @typedef {{ id: string, layout: string, size: number, chunked: boolean }} BlobIndexEntry
 */
/**
 * The key and document of one entry, as wire text.
 * @typedef {{ key: string, document: string }} DocumentEntry
 */
/**
 * The documents of one attachment, found by its runtime id.
 * @typedef {[runtimeId: string, entries: DocumentEntry[]]} PlannedDocuments
 */
/**
 * Stores one document in the target.
 * @typedef {(attachment: V.Attachment, key: V.ValueKey, document: V.Value) => unknown} SetDocument
 */

const CHUNK_SIZE = 48 * 1024 * 1024;
/** @type {(m: string) => never} */
const fail = (m) => { console.error(m); process.exit(1); };
const readJson = (/** @type {string} */ p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const expand = (/** @type {string} */ p) => p.replace(/^~(?=$|\/)/, os.homedir());

/**
 * @param {string} bundle
 * @returns {BundleManifest}
 */
function loadManifest(bundle) {
    const p = path.join(bundle, 'manifest.json');
    if (!fs.existsSync(p)) fail(`Not an export bundle (missing manifest.json): ${bundle}`);
    return readJson(p);
}
/**
 * @param {string} bundle
 * @param {string} fmt
 * @returns {V.DefinitionsConst}
 */
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
/**
 * @param {string} bundle
 * @returns {BlobIndexEntry[]}
 */
function loadBlobIndex(bundle) {
    const p = path.join(bundle, 'blobs', 'index.json');
    return fs.existsSync(p) ? readJson(p) : [];
}

/**
 * @param {V.Databasing | V.CommitDatabasing} store
 * @param {string} bundle
 * @param {BlobIndexEntry[]} blobIndex
 * @param {boolean} verbose
 */
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

const runtimeId = (/** @type {V.Attachment} */ attachment) => String(attachment.runtimeId().encoded());
const PYTHON_OBJECTS = 'This bundle holds its documents as JSON objects, as database_export of dsviper-tools 1.2.0 '
    + 'wrote them: JavaScript cannot read them back without turning a whole-number double into an integer. '
    + 'Import it with dsviper-tools, or export it again.';

/**
 * Every documents file of the bundle, by attachment runtime id; or fail before anything is
 * written: a file no attachment claims, or a count the manifest does not state, is data lost.
 *
 * A bundle lists its attachments by runtime id, the identity that holds across runtime versions;
 * an identifier is a name, and `App::Lib::User.profile` was `Lib::User.profile` before the 1.2.29
 * runtime. A bundle without that list was written by dsviper-tools 1.2.0, its documents as JSON
 * objects that JavaScript cannot read back losslessly.
 * @param {V.DefinitionsConst} definitions
 * @param {string} bundle
 * @param {BundleManifest} manifest
 * @returns {PlannedDocuments[]}
 */
function planDocuments(definitions, bundle, manifest) {
    const documentsDir = path.join(bundle, 'documents');
    const present = fs.existsSync(documentsDir)
        ? fs.readdirSync(documentsDir).filter((f) => f.endsWith('.json')).sort() : [];
    if (!manifest.attachments) fail(PYTHON_OBJECTS);
    /** @type {[V.Attachment, string][]} */
    const claimed = [];
    const byRuntimeId = new Map(manifest.attachments.map((e) => [e.runtime_id, e]));
    for (const attachment of definitions.attachments()) {
        const entry = byRuntimeId.get(runtimeId(attachment));
        if (!entry) continue;
        byRuntimeId.delete(entry.runtime_id);
        claimed.push([attachment, entry.file]);
    }
    if (byRuntimeId.size)
        fail(`The bundle lists attachments its definitions do not hold: ${[...byRuntimeId.values()].map((e) => e.identifier).sort().join(', ')}`);

    const files = new Set(claimed.map(([, file]) => file));
    const orphans = present.filter((f) => !files.has(f));
    if (orphans.length) fail(`Documents no attachment of the bundle's definitions claims: ${orphans.join(', ')}.`);

    /** @type {PlannedDocuments[]} */
    const plan = claimed.map(([attachment, file]) => [runtimeId(attachment), readJson(path.join(documentsDir, file))]);
    for (const [, entries] of plan)
        if (entries.some((e) => typeof e.key !== 'string' || typeof e.document !== 'string')) fail(PYTHON_OBJECTS);
    const count = plan.reduce((n, [, entries]) => n + entries.length, 0);
    const expected = manifest.counts?.documents;
    if (expected != null && expected !== count) fail(`The bundle holds ${count} documents, its manifest states ${expected}.`);
    return plan;
}

/**
 * @param {V.DefinitionsConst} definitions
 * @param {PlannedDocuments[]} plan
 * @param {SetDocument} setDocument
 * @param {boolean} verbose
 * @param {string} fmt
 * @returns {number} the number of documents imported
 */
function importDocuments(definitions, plan, setDocument, verbose, fmt) {
    const attachments = new Map(definitions.attachments().map((a) => [runtimeId(a), a]));
    let total = 0;
    for (const [attachmentRuntimeId, entries] of plan) {
        const attachment = attachments.get(attachmentRuntimeId);
        if (!attachment) fail(`No attachment ${attachmentRuntimeId} in the definitions the target was given.`);
        // entry.key / entry.document are the exact wire TEXT emitted at export (see the note there);
        // fed straight to from{Json,Xml}String, losslessly — no JS-object round-trip that would
        // collapse a whole-number double.
        for (const entry of entries) {
            // Decoded against the attachment's key type, the key is a ValueKey.
            const key = /** @type {V.ValueKey} */ (fmt === 'xml'
                ? Value.fromXmlString(entry.key, attachment.typeKey(), definitions)
                : Value.fromJsonString(entry.key, attachment.typeKey(), definitions));
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

/**
 * @param {string} output
 * @param {string | undefined} documentation
 * @param {V.DefinitionsConst} definitions
 * @param {string} bundle
 * @param {PlannedDocuments[]} plan
 * @param {BlobIndexEntry[]} blobIndex
 * @param {boolean} verbose
 * @param {string} fmt
 * @returns {{ count: number, hexdigest: string }}
 */
function importIntoDatabase(output, documentation, definitions, bundle, plan, blobIndex, verbose, fmt) {
    const db = Database.create(output, documentation);
    try {
        db.extendDefinitions(definitions);
        const live = db.definitions();
        db.beginTransaction();
        importBlobs(db.databasing(), bundle, blobIndex, verbose);
        const count = importDocuments(live, plan, (a, k, d) => db.set(a, k, d), verbose, fmt);
        db.commit();
        return { count, hexdigest: db.definitionsHexdigest() };
    } catch (e) {
        if (db.inTransaction()) db.rollback();
        throw e;
    } finally {
        db.close();
    }
}

/**
 * @param {string} output
 * @param {string | undefined} documentation
 * @param {V.DefinitionsConst} definitions
 * @param {string} bundle
 * @param {PlannedDocuments[]} plan
 * @param {BlobIndexEntry[]} blobIndex
 * @param {string} label
 * @param {boolean} verbose
 * @param {string} fmt
 * @returns {{ count: number, hexdigest: string }}
 */
function importIntoCommitDatabase(output, documentation, definitions, bundle, plan, blobIndex, label, verbose, fmt) {
    const cdb = CommitDatabase.create(output, documentation);
    try {
        cdb.extendDefinitions(definitions);
        const live = cdb.definitions();
        const store = cdb.commitDatabasing();
        store.beginTransaction();
        importBlobs(store, bundle, blobIndex, verbose);
        store.commit();
        const mutable = new CommitMutableState(new CommitState(live));
        const count = importDocuments(live, plan, (a, k, d) => mutable.attachmentMutating().set(a, k, d), verbose, fmt);
        cdb.commitMutations(label, mutable);
        return { count, hexdigest: cdb.definitionsHexdigest() };
    } finally {
        cdb.close();
    }
}

/**
 * @param {BundleManifest} manifest
 * @param {BlobIndexEntry[]} blobIndex
 * @param {string} hexdigest
 */
function verify(manifest, blobIndex, hexdigest) {
    const counts = manifest.counts || {};
    if (counts.blobs != null && counts.blobs !== blobIndex.length)
        console.error(`Warning: blob count mismatch (manifest ${counts.blobs}, imported ${blobIndex.length}).`);
    if (manifest.definitions_hexdigest && manifest.definitions_hexdigest !== hexdigest)
        console.error(`Warning: definitions hexdigest mismatch (manifest ${manifest.definitions_hexdigest}, imported ${hexdigest}).`);
    else if (manifest.definitions_hexdigest)
        console.log(`definitions hexdigest matches (${hexdigest}).`);
}

function main() {
    const argv = process.argv.slice(2);
    /** @type {{ label: string, documentation: string | undefined, force: boolean, verbose: boolean, targetKind: string | null }} */
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
    const manifest = loadManifest(bundle);
    const fmt = manifest.format || 'json';
    if (fmt === 'xml' && typeof Value.fromXmlString !== 'function')
        fail('bundle is in XML format but the installed dsviper lacks XML support.');
    const definitions = loadDefinitions(bundle, fmt);
    const blobIndex = loadBlobIndex(bundle);
    const plan = planDocuments(definitions, bundle, manifest);

    const output = expand(outputArg);
    if (fs.existsSync(output)) {
        if (!args.force) fail(`Output already exists (use --force to overwrite): ${output}`);
        fs.rmSync(output);
    }

    const kind = args.targetKind || (manifest.source_type === 'CommitDatabase' ? 'commit-database' : 'database');
    const documentation = args.documentation !== undefined ? args.documentation : (manifest.documentation || undefined);

    let result, label;
    if (kind === 'commit-database') {
        result = importIntoCommitDatabase(output, documentation, definitions, bundle, plan, blobIndex, args.label, args.verbose, fmt);
        label = 'CommitDatabase';
    } else {
        result = importIntoDatabase(output, documentation, definitions, bundle, plan, blobIndex, args.verbose, fmt);
        label = 'Database';
    }

    verify(manifest, blobIndex, result.hexdigest);
    if (args.verbose) console.log(`Wrote ${label} to ${output} (${result.count} documents, ${blobIndex.length} blobs)`);
}

main();
