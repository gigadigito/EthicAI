// Gera todas as paginas de captura usadas pelos testes de imagem do Price Crossover Social.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const buildPage = resolve(here, "build-page.mjs");

const matrix = [
    ["pt-BR", "4x3", "base"],
    ["pt-BR", "16x9", "base"],
    ["pt-BR", "4x3", "long-symbols"],
    ["pt-BR", "4x3", "many-crossovers"],
    ["pt-BR", "4x3", "missing-metrics"],
    ["pt-BR", "4x3", "not-publishable"],
    ["en-US", "4x3", "base"],
    ["fr-FR", "4x3", "base"]
];

for (const [culture, preset, variant] of matrix) {
    execFileSync(process.execPath, [buildPage, "--culture", culture, "--preset", preset, "--variant", variant], {
        stdio: "inherit"
    });
}
