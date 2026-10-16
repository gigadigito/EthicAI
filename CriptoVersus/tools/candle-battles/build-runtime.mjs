import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const dest = new URL('wwwroot/games/candle-battles/vendor/', root);
await mkdir(dest, { recursive: true });
await copyFile(new URL('node_modules/phaser/dist/phaser.esm.min.js', root), new URL('phaser-3.90.0.esm.min.js', dest));
await copyFile(new URL('node_modules/phaser/LICENSE.md', root), new URL('PHASER-LICENSE.md', dest));

await writeFile(new URL('wwwroot/js/dist/candle-battles/package.json', root), JSON.stringify({type:'module'}));

// Browser ESM caches each relative import independently of the entrypoint URL.
// Keep this revision in sync with CandleBattlesHost.razor and the atlas URLs.
const revision = '20261015d';
const modules = new URL('wwwroot/js/dist/candle-battles/', root);
for (const file of await readdir(modules)) {
    if (!file.endsWith('.js')) continue;
    const url = new URL(file, modules);
    const source = await readFile(url, 'utf8');
    const versioned = source.replace(/(from\s+['"])(\.\/[^'"]+\.js)(['"])/g, (_match, before, path, after) =>
        `${before}${path}?v=${revision}${after}`);
    if (versioned !== source) await writeFile(url, versioned);
}
