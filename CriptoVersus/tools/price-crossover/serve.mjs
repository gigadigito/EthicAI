// Servidor estatico dos testes de captura do card social Price Crossover.
// /js/* e servido de CriptoVersus/wwwroot (modulo real de renderizacao);
// o restante e servido de tools/price-crossover/out (paginas geradas).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "../../wwwroot");
const outRoot = resolve(here, "out");

const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2"
};

function insideRoot(root, target) {
    const normalizedRoot = root.endsWith(sep) ? root : root + sep;
    return target === root || target.startsWith(normalizedRoot);
}

const server = http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);

        if (pathname === "/healthz") {
            res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
            return;
        }

        const root = pathname.startsWith("/js/") ? webRoot : outRoot;
        const target = resolve(root, "." + pathname);

        if (!insideRoot(root, target)) {
            res.writeHead(403).end();
            return;
        }

        const data = await readFile(target);
        res.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(data);
    } catch {
        res.writeHead(404).end();
    }
});

const port = Number(process.env.PRICE_CROSSOVER_TEST_PORT ?? 4288);
server.listen(port, "127.0.0.1", () => {
    console.log(`price-crossover capture server em http://127.0.0.1:${port}`);
});
