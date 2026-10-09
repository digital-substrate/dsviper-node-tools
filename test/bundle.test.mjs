// database_export and database_import: a bundle gives back every document it holds, or nothing.
//
// A bundle lists its attachments by runtime id. The identifier is a name, and its spelling changed
// with the 1.2.29 runtime (`App::Lib::User.profile` for an attachment of `App` keyed by `Lib::User`,
// `Lib::User.profile` before): matched by name, a bundle exported by one version and imported by
// the other dropped those documents with a warning. The import refuses a file no attachment claims,
// or a count the manifest does not state, before it writes anything.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** @type {typeof import('@digitalsubstrate/dsviper')} */
const dsviper = createRequire(import.meta.url)('@digitalsubstrate/dsviper');
const { Database, DSMBuilder } = dsviper;

const SOURCE = 'namespace Lib {00000000-0000-0000-0000-0000000000a1} {'
    + ' concept User; struct P { int64 a; double d; }; attachment<User, P> card; };'
    + ' namespace App {00000000-0000-0000-0000-0000000000a3} {'
    + ' struct Q { string s; }; attachment<Lib::User, Q> profile; };';

const tool = (/** @type {string} */ name) => fileURLToPath(new URL(`../bin/${name}.mjs`, import.meta.url));
const run = (/** @type {string} */ name, /** @type {string[]} */ args) =>
    spawnSync(process.execPath, [tool(name), ...args], { encoding: 'utf8' });

describe('an export bundle', () => {
    /** @type {string} */ let dir;
    /** @type {string} */ let bundle;
    /** @type {any} */ let manifest;

    const readManifest = () => JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
    const writeManifest = (/** @type {any} */ m) => fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify(m));
    const imported = () => {
        const output = path.join(dir, 'out.db');
        return { result: run('database_import', [bundle, output, '-v']), output };
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
        const source = path.join(dir, 'source.db');
        const builder = new DSMBuilder();
        builder.append('model.dsm', SOURCE);
        const [report, dsm] = builder.parse();
        assert.ok(!report.hasError() && dsm);
        const db = Database.create(source);
        db.extendDefinitions(dsm.toDefinitions().const());
        const live = db.definitions();
        const card = live.attachments().find((a) => a.identifier() === 'Lib::User.card');
        assert.ok(card);
        db.beginTransaction();
        for (let i = 0; i < 2; i++) {
            const key = card.createKey();
            for (const attachment of live.attachments()) db.set(attachment, key, attachment.createDocument());
        }
        db.commit();
        db.close();
        bundle = path.join(dir, 'bundle');
        const exported = run('database_export', [source, '--output', bundle]);
        assert.equal(exported.status, 0, exported.stderr);
        manifest = readManifest();
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists each attachment by runtime id', () => {
        assert.equal(manifest.attachments.length, 2);
        for (const entry of manifest.attachments) {
            assert.deepEqual(Object.keys(entry).sort(), ['file', 'identifier', 'runtime_id']);
            assert.ok(fs.existsSync(path.join(bundle, 'documents', entry.file)));
        }
    });

    it('gives back every document', () => {
        const { result } = imported();
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Imported 4 documents/);
    });

    it('finds a file named otherwise by runtime id', () => {
        const entry = manifest.attachments[1];
        const documents = path.join(bundle, 'documents');
        fs.renameSync(path.join(documents, entry.file), path.join(documents, 'renamed.json'));
        entry.file = 'renamed.json';
        writeManifest(manifest);
        const { result } = imported();
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Imported 4 documents/);
    });

    it('refuses a file no attachment claims, before writing', () => {
        fs.writeFileSync(path.join(bundle, 'documents', 'Other_User.profile.json'), '[]');
        const { result, output } = imported();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Other_User\.profile\.json/);
        assert.ok(!fs.existsSync(output));
    });

    it('refuses a bundle without its attachment list, as dsviper-tools 1.2.0 wrote them', () => {
        delete manifest.attachments;
        writeManifest(manifest);
        const { result, output } = imported();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Import it with dsviper-tools/);
        assert.ok(!fs.existsSync(output));
    });

    it('refuses a count the manifest does not state', () => {
        manifest.counts.documents = 5;
        writeManifest(manifest);
        const { result, output } = imported();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /holds 4 documents, its manifest states 5/);
        assert.ok(!fs.existsSync(output));
    });

    it('refuses documents held as JSON objects, which JavaScript cannot read back losslessly', () => {
        const file = path.join(bundle, 'documents', manifest.attachments[0].file);
        const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify(entries.map((/** @type {any} */ e) =>
            ({ key: JSON.parse(e.key), document: JSON.parse(e.document) }))));
        const { result, output } = imported();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Import it with dsviper-tools/);
        assert.ok(!fs.existsSync(output));
    });
});
