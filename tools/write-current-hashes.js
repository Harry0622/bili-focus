import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const hashes = {};
for (const file of ['manifest.json','popup.html','popup.js','popup.css','popup-custom.css','popup-library.css','background.js','content.js','shared/model.js','shared/store.js','shared/appearance.js','shared/limits.js','shared/library.js','shared/library-view.js','shared/icons.js','assets/rare-theme.js','assets/rare-toast.js','assets/rare-theme.css','ui/rare-theme.tsx','ui/rare-toast.tsx','vendor/rare-ui/theme-selector.tsx','vendor/rare-ui/toast.tsx','vendor/rare-ui/provenance.json','icons/16.png','icons/32.png','icons/48.png','icons/128.png','package-lock.json',...(await readdir(new URL('assets/chunks/',base))).map(f=>`assets/chunks/${f}`)]) hashes[file] = createHash('sha256').update(await readFile(new URL(file, base))).digest('hex');
const version = manifest.version.split('.').slice(0,2).join('.');
await writeFile(new URL(`docs/source-hashes-v${version}.json`, base), JSON.stringify({version:manifest.version,hashes}, null, 2));
console.log(`Wrote v${version} source hashes.`);
