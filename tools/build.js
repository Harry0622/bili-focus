import { build } from 'esbuild';
import { readFile, mkdir, writeFile, readdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const provenance = JSON.parse(await readFile('vendor/rare-ui/provenance.json', 'utf8'));
const source = await readFile('vendor/rare-ui/theme-selector.tsx');
if (createHash('sha256').update(source).digest('hex') !== provenance.sha256) throw Error('Rare UI source differs from its recorded upstream checksum');
const toastSource = await readFile('vendor/rare-ui/toast.tsx');
if (createHash('sha256').update(toastSource).digest('hex') !== provenance.toast.sha256) throw Error('Rare UI Toast source checksum mismatch');
await mkdir('assets', { recursive: true });
await rm(path.join(root, 'assets', 'chunks'), { recursive: true, force: true });
const result = await build({
  entryPoints: { 'rare-theme': 'ui/rare-theme.tsx', 'rare-toast': 'ui/rare-toast.tsx' }, outdir: 'assets', bundle: true, splitting: true, chunkNames: 'chunks/[name]-[hash]',
  minify: true, format: 'esm', platform: 'browser', target: 'chrome120', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@/lib/utils': path.join(root, 'ui/utils.ts') },
  metafile: true, legalComments: 'external',
});
execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'ui/rare-theme.css', '-o', 'assets/rare-theme.css', '--minify'], { stdio: 'inherit' });
await mkdir('assets/licenses', { recursive: true });
for (const name of ['react', 'react-dom', 'scheduler', 'clsx', 'tailwind-merge', 'tailwindcss', 'sonner', 'motion', 'motion-dom', 'motion-utils', 'framer-motion', 'figma-squircle', 'tslib']) {
  const directory = path.join('node_modules', name);
  const file = (await readdir(directory)).find(f => /^license(?:\.(md|txt))?$/i.test(f));
  if (!file) throw Error(`Missing license for ${name}`);
  await copyFile(path.join(directory, file), path.join('assets/licenses', `${name}.txt`));
}
await copyFile('vendor/rare-ui/LICENSE', 'assets/licenses/rare-ui.txt');
const stats = {};
for (const file of [...Object.keys(result.metafile.outputs), 'assets/rare-theme.css']) { const bytes = await readFile(file); stats[file] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length }; }
await mkdir('output', { recursive: true });
await writeFile('output/rare-build.json', JSON.stringify({ source: provenance, files: stats, inputs: Object.keys(result.metafile.inputs) }, null, 2));
console.log(JSON.stringify(stats, null, 2));
