import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const spriteRoot = fileURLToPath(new URL("../../../games/whale-ocean/sprites/", import.meta.url));

test("ships the documented Whale Ocean atlas set", async () => {
    const manifest = JSON.parse(await readFile(`${spriteRoot}/manifest.json`, "utf8"));
    const entries = Object.entries(manifest.animations);
    assert.equal(manifest.frameWidth, 512);
    assert.equal(manifest.frameHeight, 256);
    assert.equal(manifest.framesPerAnimation, 12);
    assert.equal(manifest.atlas.columns, 4);
    assert.equal(manifest.atlas.rows, 3);
    assert.equal(entries.length, 10);

    for (const [, definition] of entries) {
        assert.equal(definition.frameCount, 12);
        await access(`${spriteRoot}/${definition.atlas}`);
    }
});
