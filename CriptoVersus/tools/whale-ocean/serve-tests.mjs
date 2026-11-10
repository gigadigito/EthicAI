import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const wwwroot = fileURLToPath(new URL('../../wwwroot/', import.meta.url));
const pageCss = fileURLToPath(new URL('../../Components/Pages/Internet/WhaleOceanPage.razor.css', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
    try {
        const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path === '/tests/whale-ocean-page.css'
            ? pageCss
            : resolve(wwwroot, '.' + path);
        if (file !== pageCss && !file.startsWith(wwwroot.endsWith(sep) ? wwwroot : wwwroot + sep)) { res.writeHead(403).end(); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    } catch { res.writeHead(404).end(); }
});
const port = Number(process.env.WHALE_OCEAN_TEST_PORT ?? 4289);
server.listen(port, '127.0.0.1');
