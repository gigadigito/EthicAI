import { mkdir, copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const dest = new URL('wwwroot/games/candle-battles/vendor/', root);
await mkdir(dest, { recursive: true });
await copyFile(new URL('node_modules/phaser/dist/phaser.esm.min.js', root), new URL('phaser-3.90.0.esm.min.js', dest));
await copyFile(new URL('node_modules/phaser/LICENSE.md', root), new URL('PHASER-LICENSE.md', dest));

await writeFile(new URL('wwwroot/js/dist/candle-battles/package.json', root), JSON.stringify({type:'module'}));

// Browser ESM caches each relative import independently. Publish immutable file
// names because the production CDN does not vary static assets by query string.
// Keep this revision in sync with CandleBattlesHost.razor.
const revision = '20261024e';
const modules = new URL('wwwroot/js/dist/candle-battles/', root);
const runtimeFiles = ['audio.js', 'model.js', 'combat-animations.js', 'renderer.js', 'dialogue.js', 'game.js',
    'dialogue-catalog.js', 'dialogue-engine.js', 'dialogue-phrases-pt.js', 'dialogue-phrases-en.js',
    'dialogue-phrases-es-fr-de.js', 'dialogue-phrases-it-ja-zh.js'];
for (const file of runtimeFiles) {
    const url = new URL(file, modules);
    const source = await readFile(url, 'utf8');
    const queryVersioned = source.replace(/((?:from|import)\s+['"])(\.\/[^'"]+\.js)(['"])/g, (_match, before, path, after) =>
        `${before}${path}?v=${revision}${after}`);
    if (queryVersioned !== source) await writeFile(url, queryVersioned);

    const immutableVersioned = source.replace(/((?:from|import)\s+['"])(\.\/[^'"]+)\.js(['"])/g, (_match, before, path, after) =>
        `${before}${path}.${revision}.js${after}`);
    await writeFile(new URL(file.replace(/\.js$/, `.${revision}.js`), modules), immutableVersioned);
}
