import { build } from 'esbuild';
await import('./create-icon.mjs');
const prod = process.env.NODE_ENV === 'production';
// Release signing: set CSC_LINK/CSC_KEY_PASSWORD or signing GitHub action before packaging.
// See docs/signing.md (placeholder).
const prodSourcemap = false;
const devSourcemap = 'inline';
await build({entryPoints:['electron/main.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-electron/main.cjs',external:['electron'],sourcemap:prod?prodSourcemap:devSourcemap});
await build({entryPoints:['electron/preload.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-electron/preload.cjs',external:['electron'],sourcemap:prod?prodSourcemap:devSourcemap});
