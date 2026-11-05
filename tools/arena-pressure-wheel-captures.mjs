import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../CriptoVersus/node_modules/@playwright/test/index.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, 'tmp', 'arena-pressure-wheel-validation');
const webRoot = path.join(repositoryRoot, 'CriptoVersus', 'wwwroot');

const mimeTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp']
]);

const indexHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>html,body{margin:0;background:#09111f;overflow:hidden}#arena{width:960px;height:540px}</style></head>
<body><div id="arena"></div>
<script type="module">
    window.mountArena = async (leftPressure) => {
        const { create } = await import('/js/dist/arena-pressure/engine.js');
        window.arenaEngine = await create(document.getElementById('arena'), {
            initialLeft: leftPressure,
            initialRight: 100 - leftPressure,
            reducedMotion: true,
            baseUrl: '/games/arena-pressure/assets/'
        });
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
</script></body></html>`;

function safePath(urlPath) {
    const mapped = urlPath.startsWith('/js/') || urlPath.startsWith('/games/')
        ? urlPath.slice(1)
        : null;
    if (!mapped) return null;
    const candidate = path.resolve(webRoot, mapped);
    return candidate.startsWith(webRoot) ? candidate : null;
}

const server = createServer(async (request, response) => {
    try {
        if (request.url === '/' || request.url === '/index.html') {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(indexHtml);
            return;
        }

        const filePath = safePath(new URL(request.url, 'http://127.0.0.1').pathname);
        if (!filePath) {
            response.writeHead(404);
            response.end();
            return;
        }

        const fileInfo = await stat(filePath);
        if (!fileInfo.isFile()) throw new Error('not_file');
        response.writeHead(200, {
            'content-type': mimeTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
            'cache-control': 'no-store'
        });
        response.end(await readFile(filePath));
    } catch {
        response.writeHead(404);
        response.end();
    }
});

await mkdir(outputDirectory, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'
});
const states = [100, 75, 65, 50, 35, 0];

try {
    for (const leftPressure of states) {
        const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.evaluate((value) => window.mountArena(value), leftPressure);
        await page.screenshot({
            path: path.join(outputDirectory, `wheel-${String(leftPressure).padStart(3, '0')}-left.png`),
            clip: { x: 300, y: 95, width: 360, height: 365 }
        });
        await page.close();
    }
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
}

console.log(`Captured ${states.length} Arena Pressure wheel states in ${outputDirectory}`);
