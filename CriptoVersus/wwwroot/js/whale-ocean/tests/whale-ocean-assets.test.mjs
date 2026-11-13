import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { fileURLToPath } from "node:url";

const spriteRoot = fileURLToPath(new URL("../../../games/whale-ocean/sprites/", import.meta.url));
const runtimeRoot = fileURLToPath(new URL("../../dist/whale-ocean/", import.meta.url));
const LEGACY_ATLAS_PATTERN = /atlas_(?:peixe_[pmg]|tubarao|baleia)_(?:lima|ciano)\.png/;
const EXPECTED_KINDS = ["barracuda", "bluefish", "grouper", "mackerel", "sardine", "shark", "snook", "swordfish", "tuna", "whale"];

test("ships the documented Whale Ocean atlas set", async () => {
    const manifest = JSON.parse(await readFile(`${spriteRoot}/manifest.json`, "utf8"));
    const entries = Object.entries(manifest.animations);
    assert.equal(manifest.frameWidth, 512);
    assert.equal(manifest.frameHeight, 256);
    assert.equal(manifest.framesPerAnimation, 12);
    assert.equal(manifest.atlas.columns, 4);
    assert.equal(manifest.atlas.rows, 3);
    assert.equal(entries.length, 20);
    const kinds = new Set(entries.map(([, definition]) => definition.kind));
    assert.deepEqual([...kinds].sort(), EXPECTED_KINDS);
    assert.doesNotMatch(JSON.stringify(manifest), LEGACY_ATLAS_PATTERN);
    for (const kind of EXPECTED_KINDS) for (const variant of ["lima", "ciano"]) {
        const definition = manifest.animations[`${kind}_${variant}`];
        assert.ok(definition, `${kind} requires the ${variant} variant`);
        assert.equal(definition.atlas, `atlas_${kind}_${variant}.png`);
    }

    for (const [, definition] of entries) {
        assert.equal(definition.frameCount, 12);
        const atlasPath = `${spriteRoot}/${definition.atlas}`;
        await access(atlasPath);
        const decoded = decodePng(await readFile(atlasPath));
        assert.equal(decoded.width, 2048);
        assert.equal(decoded.height, 768);
        assert.equal(decoded.bitDepth, 8);
        assert.equal(decoded.colorType, 6, "atlas must preserve RGBA alpha");
        for (let frame = 0; frame < 12; frame++)
            assert.ok(alphaPixelCount(decoded, frame) > 0, `frame ${frame} must contain a visible animal`);
    }
});

test("production Whale Ocean execution cannot resolve legacy atlas paths", async () => {
    const publicFiles = await readdir(spriteRoot);
    assert.equal(publicFiles.filter(file => LEGACY_ATLAS_PATTERN.test(file)).length, 0);

    const [bootstrap, runtime, model] = await Promise.all([
        readFile(`${runtimeRoot}/whale-ocean-bootstrap.js`, "utf8"),
        readFile(`${runtimeRoot}/whale-ocean-runtime.js`, "utf8"),
        readFile(`${runtimeRoot}/whale-ocean-model.js`, "utf8")
    ]);
    const executable = `${bootstrap}\n${runtime}\n${model}`;
    assert.doesNotMatch(executable, LEGACY_ATLAS_PATTERN);
    for (const kind of EXPECTED_KINDS)
        assert.match(executable, new RegExp(`(?:kind: \\"${kind}\\"|\\"${kind}\\")`));
    assert.match(runtime, /Missing Whale Ocean sprite atlas/, "missing new assets must fail explicitly");
    assert.match(runtime, /20261112-whale-ocean-territory-v10/, "manifest and atlas URLs must invalidate the old sprite cache");
    assert.match(runtime, /animalKindForEvent/, "shark and whale event actors use the current catalog");
});

function decodePng(buffer) {
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idat = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            assert.equal(data[12], 0, "interlaced PNGs are not supported by this asset test");
        } else if (type === "IDAT") idat.push(data);
        offset += length + 12;
    }
    assert.equal(bitDepth, 8);
    assert.equal(colorType, 6);
    const compressed = Buffer.concat(idat);
    const raw = inflateSync(compressed);
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);
    let source = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[source++];
        const rowStart = y * stride;
        for (let x = 0; x < stride; x++) {
            const value = raw[source++];
            const left = x >= 4 ? pixels[rowStart + x - 4] : 0;
            const up = y > 0 ? pixels[rowStart - stride + x] : 0;
            const upperLeft = y > 0 && x >= 4 ? pixels[rowStart - stride + x - 4] : 0;
            pixels[rowStart + x] = reconstruct(filter, value, left, up, upperLeft);
        }
    }
    return { width, height, bitDepth, colorType, pixels };
}

function reconstruct(filter, value, left, up, upperLeft) {
    if (filter === 0) return value;
    if (filter === 1) return (value + left) & 0xff;
    if (filter === 2) return (value + up) & 0xff;
    if (filter === 3) return (value + Math.floor((left + up) / 2)) & 0xff;
    if (filter === 4) {
        const prediction = left + up - upperLeft;
        const leftDistance = Math.abs(prediction - left);
        const upDistance = Math.abs(prediction - up);
        const upperLeftDistance = Math.abs(prediction - upperLeft);
        const nearest = leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
        return (value + nearest) & 0xff;
    }
    throw new Error(`Unsupported PNG filter ${filter}`);
}

function alphaPixelCount(decoded, frame) {
    const column = frame % 4;
    const row = Math.floor(frame / 4);
    let count = 0;
    for (let y = row * 256; y < (row + 1) * 256; y++) for (let x = column * 512; x < (column + 1) * 512; x++) {
        if (decoded.pixels[(y * decoded.width + x) * 4 + 3] > 8) count++;
    }
    return count;
}
