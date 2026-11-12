import test from "node:test";
import assert from "node:assert/strict";
import { flowStatusForConnection, guardWhaleOceanFlowStatus } from "../../dist/whale-ocean/whale-ocean-flow-state.js";

test("direct historical load keeps FINALIZED when bootstrap has no Money Flow", () => {
    const decision = guardWhaleOceanFlowStatus(true, "FINALIZED", "BOOTSTRAP_PENDING");
    assert.equal(decision.accepted, false);
    assert.equal(decision.status, "FINALIZED");
});

test("active match without batches remains flow-pending", () => {
    const decision = guardWhaleOceanFlowStatus(false, "BOOTSTRAP_PENDING", "BOOTSTRAP_PENDING");
    assert.equal(decision.accepted, true);
    assert.equal(decision.status, "BOOTSTRAP_PENDING");
});

test("SignalR connection alone does not mean LIVE", () => {
    assert.equal(flowStatusForConnection(true, false), "BOOTSTRAP_PENDING");
    assert.equal(flowStatusForConnection(false, false), "BOOTSTRAP_PENDING");
    assert.equal(flowStatusForConnection(true, true), "LIVE");
});

test("first live batch promotes only the flow state", () => {
    const decision = guardWhaleOceanFlowStatus(false, "BOOTSTRAP_PENDING", "LIVE");
    assert.equal(decision.accepted, true);
    assert.equal(decision.status, "LIVE");
});

test("closing an active match accepts FINALIZED", () => {
    const decision = guardWhaleOceanFlowStatus(false, "LIVE", "FINALIZED");
    assert.equal(decision.accepted, true);
    assert.equal(decision.status, "FINALIZED");
});

test("SignalR disconnect cannot replace FINALIZED", () => {
    const decision = guardWhaleOceanFlowStatus(true, "FINALIZED", "BOOTSTRAP_PENDING");
    assert.equal(decision.status, "FINALIZED");
});

test("SignalR reconnect cannot replace FINALIZED", () => {
    const decision = guardWhaleOceanFlowStatus(true, "FINALIZED", "LIVE");
    assert.equal(decision.status, "FINALIZED");
});

test("replay completion cannot replace FINALIZED", () => {
    const decision = guardWhaleOceanFlowStatus(true, "FINALIZED", "REPLAY");
    assert.equal(decision.status, "FINALIZED");
});

test("initialization callbacks cannot reopen a finalized match", () => {
    for (const requested of ["BOOTSTRAP_PENDING", "LIVE", "REPLAY", "PAUSED"]) {
        const decision = guardWhaleOceanFlowStatus(true, "FINALIZED", requested);
        assert.equal(decision.accepted, false, requested);
        assert.equal(decision.status, "FINALIZED", requested);
    }
});
