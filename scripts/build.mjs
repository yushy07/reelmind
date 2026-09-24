import { build } from 'esbuild';
await import('./create-icon.mjs');
const isPackaged = process.argv.includes('--packaged') || process.env.NODE_ENV === 'production';
// Strip sourcemaps for packaged builds to avoid leaking dev source paths into binary
const sourcemap = !process.env.CI && !isPackaged ? 'inline' : false;
await build({entryPoints:['electron/main.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-electron/main.cjs',external:['electron'],sourcemap});
await build({entryPoints:['electron/preload.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-electron/preload.cjs',external:['electron'],sourcemap});
