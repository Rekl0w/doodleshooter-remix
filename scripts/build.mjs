import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
if (dirname(output) !== root || !output.endsWith('dist')) throw new Error('Invalid output directory');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', '_headers', 'src', 'vendor']) {
  await cp(join(root, file), join(output, file), { recursive: true });
}
await writeFile(join(output, '404.html'), '<!doctype html><html lang="tr"><meta charset="utf-8"><title>Sayfa bulunamadı</title><h1>Sayfa bulunamadı</h1><a href="/">Oyuna dön</a></html>');
console.log('Static game ready in dist/');
