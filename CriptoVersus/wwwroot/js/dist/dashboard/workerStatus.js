// dashboard/workerStatus.ts
/**
 * Calcula o status do worker baseado no heartbeat
 */
export function computeWorkerStatus(secondsSinceHeartbeat, cycleIntervalSeconds, degraded) {
    if (secondsSinceHeartbeat === null)
        return "offline";
    // offline se passou de 2 ciclos
    if (secondsSinceHeartbeat > cycleIntervalSeconds * 2) {
        return "offline";
    }
    if (degraded)
        return "degraded";
    return "online";
}
/**
 * Badge HTML do status
 */
export function renderStatusBadge(status) {
    switch (status) {
        case "online":
            return `<span class="badge bg-success">ONLINE</span>`;
        case "degraded":
            return `<span class="badge bg-warning text-dark">ONLINE (DEGRADED)</span>`;
        case "offline":
            return `<span class="badge bg-danger">OFFLINE</span>`;
    }
}
