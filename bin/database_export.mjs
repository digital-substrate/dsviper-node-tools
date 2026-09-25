#!/usr/bin/env node
// Export a dsviper Database or CommitDatabase to a JSON bundle (embedded definitions,
// documents per attachment, blobs with layouts). Node port of dsviper-tools/database_export.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dsviper from '../src/dsviper.mjs';

/** @import * as V from '@digitalsubstrate/dsviper' */

const { Database, CommitDatabase, CommitStateBuilder, Value, ValueCommitId } = dsviper;

/**
 * The parsed command line.
 * @typedef {object} ExportArgs
 * @property {string} database
 * @property {string | null} commitId
 * @property {string | null} output
 * @property {number} indent
 * @property {'json' | 'xml'} format
 * @property {boolean} verbose
 */
/**
 * The opened source: a Database, or a CommitDatabase at one commit.
 * @typedef {object} Source
 * @property {'CommitDatabase' | 'Database'} kind
 * @property {V.CommitDatabase | V.Database} handle
 * @property {V.DefinitionsConst} definitions
 * @property {V.AttachmentGetting} attachmentGetting
 * @property {V.ValueCommitId | null} commitId
 */
/**
 * One entry of the blob index.
 * @typedef {{ id: string, layout: string, size: number, chunked: boolean }} BlobIndexEntry
 */
/**
 * The key and document of one entry, as wire text.
 * @typedef {{ key: string, document: string }} DocumentEntry
 */
/**
 * The bundle's manifest.
 * @typedef {object} Manifest
 * @property {string} source_type
 * @property {string} path
 * @property {string} uuid
 * @property {string} documentation
 * @property {string} codec
 * @property {string} definitions_hexdigest
 * @property {string | null} commit_id
 * @property {{ attachments: number, documents: number, blobs: number }} counts
 * @property {string} [format]
 */

const CHUNK_SIZE = 48 * 1024 * 1024;

// String form of an id value (CommitId/BlobId/UUId). `.encoded()` is the projection; fall
// back to representation() where it is not a plain string.
const enc = (/** @type {V.ValueCommitId | V.ValueBlobId | V.ValueUUId} */ v) => { const e = v.encoded(); return typeof e === 'string' ? e : v.representation(); };

/**
 * @param {string[]} argv
 * @returns {ExportArgs}
 */
function parseArgs(argv) {
    /** @type {{ database: string | null, commitId: string | null, output: string | null, indent: number, format: string, verbose: boolean }} */
    const args = { database: null, commitId: null, output: null, indent: 2, format: 'json', verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--commit-id') args.commitId = argv[++i];
        else if (a === '--output') args.output = argv[++i];
        else if (a === '--indent') args.indent = Number(argv[++i]);
        else if (a === '--format') args.format = argv[++i];
        else if (a === '-v' || a === '--verbose') args.verbose = true;
        else if (!a.startsWith('-') && args.database === null) args.database = a;
    }
    if (!args.database) fail('usage: database_export <database> [--commit-id last|first|<id>] [--output dir] [--indent n] [--format json|xml] [-v]');
    if (args.format !== 'json' && args.format !== 'xml') fail(`--format must be json or xml, not ${args.format}`);
    // Both checks above exit on failure: the database is set and the format is json or xml.
    return /** @type {ExportArgs} */ (args);
}

/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) { console.error(msg); process.exit(1); }

/**
 * @param {V.CommitDatabase} cdb
 * @param {string | null} requested
 * @returns {V.ValueCommitId}
 */
function resolveCommitId(cdb, requested) {
    if (requested == null) {
        const heads = [...cdb.headCommitIds()].map(enc).sort();
        console.error("This is a CommitDatabase: --commit-id is required.");
        console.error("Use 'last', 'first', or one of the available commit ids:");
        for (const h of heads) console.error(`  ${h}`);
        process.exit(1);
    }
    let commitId;
    if (requested === 'last') commitId = cdb.lastCommitId();
    else if (requested === 'first') commitId = cdb.firstCommitId();
    else commitId = ValueCommitId.tryParse(requested);

    if (commitId == null || !commitId.isValid() || !cdb.commitExists(commitId))
        fail(`Unknown or invalid commit id: ${requested}`);
    return commitId;
}

/**
 * @param {ExportArgs} args
 * @returns {Source}
 */
function openSource(args) {
    const p = args.database.replace(/^~(?=$|\/)/, os.homedir());
    if (!fs.existsSync(p)) fail(`No such file: ${p}`);

    if (CommitDatabase.isCompatible(p)) {
        const cdb = CommitDatabase.open(p, true);
        const commitId = resolveCommitId(cdb, args.commitId);
        const state = CommitStateBuilder.state(cdb, commitId);
        return { kind: 'CommitDatabase', handle: cdb, definitions: state.definitions(),
                 attachmentGetting: state.attachmentGetting(), commitId };
    }
    if (Database.isCompatible(p)) {
        if (args.commitId != null) console.error('--commit-id is ignored for a plain Database.');
        const db = Database.open(p, true);
        return { kind: 'Database', handle: db, definitions: db.definitions(),
                 attachmentGetting: db.attachmentGetting(), commitId: null };
    }
    fail(`Not a dsviper Database or CommitDatabase: ${p}`);
}

/**
 * @param {Source} src
 * @param {'json' | 'xml'} fmt
 * @returns {unknown} the XML text, or the parsed JSON
 */
const exportDefinitions = (src, fmt) => {
    const dsm = src.definitions.toDsmDefinitions();
    return fmt === 'xml' ? dsm.toXmlString(2) : JSON.parse(dsm.toJsonString());
};

/**
 * @param {Source} src
 * @param {'json' | 'xml'} fmt
 * @returns {{ documents: Record<string, DocumentEntry[]>, total: number }}
 */
function exportDocuments(src, fmt) {
    /** @type {Record<string, DocumentEntry[]>} */
    const documents = {};
    let total = 0;
    for (const attachment of src.definitions.attachments()) {
        /** @type {DocumentEntry[]} */
        const entries = [];
        // Store the wire TEXT, not JSON.parse(...): a native JS object round-trip collapses a
        // whole-number double (1.0 -> 1, JS `number` has no int/float split) and the strict Viper
        // decoder then rejects it. The text preserves the exact encoding losslessly.
        // enumerate(…, false) keeps the documents as Values.
        for (const [key, value] of src.attachmentGetting.enumerate(attachment, false)) {
            const document = /** @type {V.Value} */ (value);
            entries.push(fmt === 'xml'
                ? { key: Value.toXmlString(key), document: Value.toXmlString(document) }
                : { key: Value.toJsonString(key), document: Value.toJsonString(document) });
        }
        documents[attachment.identifier()] = entries;
        total += entries.length;
    }
    return { documents, total };
}

/**
 * @param {Source} src
 * @returns {BlobIndexEntry[]}
 */
function exportBlobIndex(src) {
    const index = [...src.handle.blobIds()].map((blobId) => {
        const info = src.handle.blobInfo(blobId);
        if (!info) throw new Error(`No blob info for the listed blob ${enc(blobId)}`);
        return { id: enc(blobId), layout: info.blobLayout().representation(), size: info.size(), chunked: info.chunked() };
    });
    index.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return index;
}

/**
 * @param {Source} src
 * @param {number} documentCount
 * @param {BlobIndexEntry[]} blobIndex
 * @returns {Manifest}
 */
function buildManifest(src, documentCount, blobIndex) {
    const h = src.handle;
    return {
        source_type: src.kind,
        path: h.path(),
        uuid: enc(h.uuid()),
        documentation: h.documentation(),
        codec: h.codecName(),
        definitions_hexdigest: h.definitionsHexdigest(),
        commit_id: src.commitId ? enc(src.commitId) : null,
        counts: { attachments: src.definitions.attachments().length, documents: documentCount, blobs: blobIndex.length },
    };
}

const safeName = (/** @type {string} */ id) => id.replace(/[^A-Za-z0-9._-]+/g, '_');

/** @param {Source} src */
function defaultDir(src) {
    const base = path.basename(src.handle.path()) || enc(src.handle.uuid());
    let stem = base.replace(/\.[^.]*$/, '') || 'database';
    if (src.commitId) stem = `${stem}.${enc(src.commitId).slice(0, 12)}`;
    return `${stem}.export`;
}

/**
 * @param {string} p
 * @param {unknown} value
 * @param {number} indent
 */
const dumpJson = (p, value, indent) => fs.writeFileSync(p, JSON.stringify(value, null, indent) + '\n');

/**
 * @param {Source} src
 * @param {ExportArgs} args
 * @param {Manifest} manifest
 * @param {unknown} definitions
 * @param {Record<string, DocumentEntry[]>} documents
 * @param {BlobIndexEntry[]} blobIndex
 * @returns {string} the bundle directory
 */
function writeBundle(src, args, manifest, definitions, documents, blobIndex) {
    const outDir = (args.output ? args.output.replace(/^~(?=$|\/)/, os.homedir()) : defaultDir(src));
    const documentsDir = path.join(outDir, 'documents');
    const blobsDir = path.join(outDir, 'blobs');
    fs.mkdirSync(documentsDir, { recursive: true });
    fs.mkdirSync(blobsDir, { recursive: true });

    dumpJson(path.join(outDir, 'manifest.json'), manifest, args.indent);
    if (args.format === 'xml')
        fs.writeFileSync(path.join(outDir, 'definitions.xml'), definitions + '\n');
    else
        dumpJson(path.join(outDir, 'definitions.json'), definitions, args.indent);
    for (const [identifier, entries] of Object.entries(documents))
        dumpJson(path.join(documentsDir, `${safeName(identifier)}.json`), entries, args.indent);

    dumpJson(path.join(blobsDir, 'index.json'), blobIndex, args.indent);
    const blobIds = new Map([...src.handle.blobIds()].map((b) => [enc(b), b]));
    for (const entry of blobIndex) {
        const fd = fs.openSync(path.join(blobsDir, `${entry.id}.bin`), 'w');
        try {
            for (let offset = 0; offset < entry.size; offset += CHUNK_SIZE) {
                const count = Math.min(CHUNK_SIZE, entry.size - offset);
                const blobId = blobIds.get(entry.id);
                if (!blobId) throw new Error(`No listed blob ${entry.id}`);
                fs.writeSync(fd, src.handle.readBlob(blobId, count, offset).encoded());
            }
        } finally { fs.closeSync(fd); }
    }
    if (args.verbose) console.log(`Wrote bundle to ${outDir}`);
    return outDir;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.format === 'xml' && typeof Value.toXmlString !== 'function')
        fail('--format xml requires a dsviper build with XML support.');
    const src = openSource(args);
    try {
        const definitions = exportDefinitions(src, args.format);
        const { documents, total } = exportDocuments(src, args.format);
        const blobIndex = exportBlobIndex(src);
        const manifest = buildManifest(src, total, blobIndex);
        manifest.format = args.format;
        writeBundle(src, args, manifest, definitions, documents, blobIndex);
    } finally {
        src.handle.close();
    }
}

main();
