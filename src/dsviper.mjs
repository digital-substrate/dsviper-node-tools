// Resolve the dsviper binding. In dev, node_modules/@digitalsubstrate/dsviper is a
// symlink onto the viper repo's dsviper_node (npm-link style); once published it is a
// normal peer dependency.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export default require('@digitalsubstrate/dsviper');
