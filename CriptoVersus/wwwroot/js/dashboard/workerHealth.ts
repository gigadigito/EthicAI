// dashboard/workerHealth.ts

export type HealthItem = {
    Ok: boolean;
    Message: string;
};

export type HealthMap = Record<string, HealthItem>;

/**
 * Faz parse seguro do tx_health_json vindo do backend
 */
export function parseHealthJson(raw?: string | null): HealthMap {
    if (!raw) return {};

    try {
        return JSON.parse(raw) as HealthMap;
    } catch {
        console.warn("Health JSON inválido:", raw);
        return {};
    }
}

/**
 * Renderiza a lista de health checks em HTML
 */
export function renderHealthList(health: HealthMap): string {
    const keys = Object.keys(health);

    if (keys.length === 0) {
        return `<div class="text-muted">Sem health disponível</div>`;
    }

    const itemsHtml = keys.map((key) => {
        const item = health[key];
        const icon = item.Ok ? "✔" : "✖";
        const cls = item.Ok ? "text-success" : "text-danger";

        return (
            `<li class="${cls}">` +
            `${icon} <strong>${escapeHtml(key)}</strong> — ` +
            `${escapeHtml(item.Message ?? "")}` +
            `</li>`
        );
    });

    return `
    <ul class="list-unstyled mb-0">
      ${itemsHtml.join("")}
    </ul>
  `;
}

/**
 * Escapa HTML para evitar XSS
 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
