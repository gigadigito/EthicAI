import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const dest = new URL('wwwroot/games/candle-battles/vendor/', root);
await mkdir(dest, { recursive: true });
await copyFile(new URL('node_modules/phaser/dist/phaser.esm.min.js', root), new URL('phaser-3.90.0.esm.min.js', dest));
await copyFile(new URL('node_modules/phaser/LICENSE.md', root), new URL('PHASER-LICENSE.md', dest));

await writeFile(new URL('wwwroot/js/dist/candle-battles/package.json', root), JSON.stringify({type:'module'}));
