import assert from "node:assert/strict";
import { MockMarketSource } from "../../dist/futurebol/market/mock-market-source.js";

async function collect(seed) {
    const source = new MockMarketSource("BTC", "ETH", seed, 5);
    const snapshots = [];

    await new Promise(async resolve => {
        const unsubscribe = source.subscribe(snapshot => {
            snapshots.push(snapshot);
            if (snapshots.length === 5) {
                unsubscribe();
                void source.disconnect().then(resolve);
            }
        });
        await source.connect();
    });

    return snapshots;
}

const firstRun = await collect("futurebol-demo-001");
const secondRun = await collect("futurebol-demo-001");
assert.deepEqual(firstRun, secondRun, "a mesma seed deve reproduzir os mesmos snapshots");
assert.deepEqual(firstRun.map(snapshot => snapshot.sequence), [0, 1, 2, 3, 4]);

for (const snapshot of firstRun) {
    assert.ok(snapshot.home.momentum >= 0 && snapshot.home.momentum <= 100);
    assert.ok(snapshot.away.momentum >= 0 && snapshot.away.momentum <= 100);
    assert.equal(snapshot.home.symbol, "BTC");
    assert.equal(snapshot.away.symbol, "ETH");
}

const differentSeed = await collect("futurebol-demo-002");
assert.notDeepEqual(firstRun, differentSeed, "seeds diferentes devem alterar as ondas determinísticas");
console.log("Futurebol MockMarketSource tests passed");
