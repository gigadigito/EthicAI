import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const wwwroot = fileURLToPath(new URL('../../wwwroot/', import.meta.url));
const pageCss = fileURLToPath(new URL('../../Components/Pages/Internet/WhaleOceanPage.razor.css', import.meta.url));
const pageRazor = fileURLToPath(new URL('../../Components/Pages/Internet/WhaleOceanPage.razor', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

// HUD rules live in the page's <style id="whale-ocean-hud-styles"> block (project
// convention), so the fixture stylesheet must combine the scoped page CSS with the
// extracted block to test what the real page applies.
async function loadPageCss() {
    const [scoped, razor] = await Promise.all([readFile(pageCss, 'utf8'), readFile(pageRazor, 'utf8')]);
    const match = razor.match(/<style id="whale-ocean-hud-styles">([\s\S]*?)<\/style>/);
    if (!match) throw new Error('WhaleOceanPage.razor is missing <style id="whale-ocean-hud-styles">');
    return `${scoped}\n${match[1].replace(/@@/g, '@')}`;
}

const server = http.createServer(async (req, res) => {
    try {
        const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (path === '/tests/whale-ocean-page.css') {
            res.writeHead(200, { 'Content-Type': mime['.css'], 'Cache-Control': 'no-store' }).end(await loadPageCss());
            return;
        }
        const file = resolve(wwwroot, '.' + path);
        if (!file.startsWith(wwwroot.endsWith(sep) ? wwwroot : wwwroot + sep)) { res.writeHead(403).end(); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    } catch { res.writeHead(404).end(); }
});
const port = Number(process.env.WHALE_OCEAN_TEST_PORT ?? 4289);
server.listen(port, '127.0.0.1');
