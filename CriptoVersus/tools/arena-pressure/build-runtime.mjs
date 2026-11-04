import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const modules = new URL('wwwroot/js/dist/arena-pressure/', root);

await mkdir(modules, { recursive: true });
await writeFile(new URL('package.json', modules), JSON.stringify({ type: 'module' }, null, 2));

const revision = '20261104b';
const runtimeFiles = ['model.js', 'rope.js', 'wheel.js', 'candles.js', 'particles.js', 'hud.js', 'engine.js'];

for (const file of runtimeFiles) {
    const url = new URL(file, modules);
    if (!existsSync(url)) continue;
    const source = await readFile(url, 'utf8');

    // Create immutable versioned files for cache busting if needed
    const immutableVersioned = source.replace(/((?:from|import)\s+['"])(\.\/[^'"]+)\.js(['"])/g, (_match, before, path, after) =>
        `${before}${path}.${revision}.js${after}`);
    await writeFile(new URL(file.replace(/\.js$/, `.${revision}.js`), modules), immutableVersioned);
}

console.log('Arena Pressure runtime build complete.');
