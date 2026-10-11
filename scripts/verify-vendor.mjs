import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('vendor-manifest.json', root), 'utf8'));
for (const artifact of manifest.artifacts) {
  const file = new URL(artifact.path, root);
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  if (digest !== artifact.sha256)
    throw new Error(`Vendored artifact changed: ${fileURLToPath(file)}. Rebuild and update its provenance/hash in vendor-manifest.json.`);
}
console.log(`Verified ${manifest.artifacts.length} vendored dependency checksums.`);
