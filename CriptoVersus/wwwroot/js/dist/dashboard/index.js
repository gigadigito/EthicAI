// dashboard/index.ts
import { parseHealthJson, renderHealthList, } from "./workerHealth.js";
import { computeWorkerStatus, renderStatusBadge, } from "./workerStatus.js";
/**
 * Atualiza a UI do dashboard do worker
 */
export function updateWorkerDashboard(data) {
    const health = parseHealthJson(data.tx_health_json);
    const status = computeWorkerStatus(data.secondsSinceHeartbeat, data.cycleIntervalSeconds, data.in_degraded);
    // status badge
    const statusEl = document.getElementById("worker-status-badge");
    if (statusEl) {
        statusEl.innerHTML = renderStatusBadge(status);
    }
    // health list
    const healthEl = document.getElementById("worker-health-list");
    if (healthEl) {
        healthEl.innerHTML = renderHealthList(health);
    }
}
