// database_export over a real CommitDatabase: the two paths that read a set of ids — the head
// list printed when --commit-id is missing, and the blob index. The CLI smoke only asks for the
// usage line, so both could break without a test noticing, and did: a binding that returns id
// sets as ValueSet rather than arrays made `.map` on them throw.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** @type {typeof import('@digitalsubstrate/dsviper')} */
const dsviper = createRequire(import.meta.url)('@digitalsubstrate/dsviper');
const { CommitDatabase, CommitMutableState, CommitState, Definitions, NameSpace, Type, ValueString, ValueUUId } = dsviper;

const exporter = fileURLToPath(new URL('../bin/database_export.mjs', import.meta.url));
const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [exporter, ...args], { encoding: 'utf8' });

describe('database_export on a CommitDatabase', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    const file = path.join(dir, 'model.cdb');

    before(() => {
        const definitions = new Definitions();
        const namespace = new NameSpace(ValueUUId.create(), 'Export');
        const concept = definitions.createConcept(namespace, 'Note');
        const attachment = definitions.createAttachment(namespace, 'text', concept, Type.STRING);
        const db = CommitDatabase.create(file);
        db.extendDefinitions(definitions.const());
        db.createBlobFromBuffer(Buffer.from([1, 2, 3, 4]));
        const mutable = new CommitMutableState(new CommitState(db.definitions()));
        mutable.attachmentMutating().set(attachment, attachment.createKey(), new ValueString('hello'));
        db.commitMutations('first', mutable);
        db.close();
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('lists the heads when no commit is named', () => {
        const { stderr, status } = run([file]);
        assert.equal(status, 1);
        assert.match(stderr, /--commit-id is required/);
        assert.match(stderr, /^ {2}[0-9a-f]{32,}/m, 'a head commit id is listed');
    });

    it('exports the documents and the blob index at the last commit', () => {
        const output = path.join(dir, 'out');
        const { stderr, status } = run([file, '--commit-id', 'last', '--output', output]);
        assert.equal(status, 0, stderr);
        const index = JSON.parse(fs.readFileSync(path.join(output, 'blobs', 'index.json'), 'utf8'));
        assert.equal(index.length, 1);
        assert.equal(index[0].size, 4);
        assert.ok(fs.existsSync(path.join(output, 'blobs', `${index[0].id}.bin`)));
    });
});
