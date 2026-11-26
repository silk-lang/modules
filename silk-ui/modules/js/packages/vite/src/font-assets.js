import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function fontAssetResolver(config, sheets, output) {
  const base = new URL(config.base, 'https://silk.invalid/').pathname;
  return url => {
    if (!url || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
    const candidates = new Map();
    for (const sheet of sheets) {
      const path = decodeURIComponent(new URL(url, 'https://silk.invalid/' + sheet.fileName).pathname);
      const name = path.startsWith(base) ? path.slice(base.length) : path.slice(1);
      const asset = output[name];
      if (asset?.type === 'asset' && !asset.fileName.endsWith('.css')) {
        candidates.set('asset:' + name, Buffer.from(asset.source));
      } else if (config.publicDir) {
        const file = resolve(config.publicDir, name);
        if (file.startsWith(resolve(config.publicDir) + sep) && statSync(file, { throwIfNoEntry: false })?.isFile()) {
          candidates.set(file, readFileSync(file));
        }
      }
    }
    if (!candidates.size) throw new Error(`Font URL does not resolve to a bundled asset: ${url}`);
    const values = [...candidates.values()];
    if (values.some(value => !value.equals(values[0]))) throw new Error(`Font URL is ambiguous across CSS chunks: ${url}`);
    return 'data:application/octet-stream;base64,' + values[0].toString('base64');
  };
}
