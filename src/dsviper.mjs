// Resolve the dsviper binding. In dev, node_modules/@digitalsubstrate/dsviper is a
// symlink onto the viper repo's dsviper_node (npm-link style); once published it is a
// normal peer dependency.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The JSDoc type lets TypeScript check the package against index.d.ts: createRequire alone
// types what it loads as `any`, and every call through it would go unchecked.
/** @type {typeof import('@digitalsubstrate/dsviper')} */
const dsviper = require('@digitalsubstrate/dsviper');

export default dsviper;
