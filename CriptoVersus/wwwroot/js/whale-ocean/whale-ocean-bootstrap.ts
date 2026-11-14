import { WhaleOceanRuntime, type WhaleOceanCalibrationSettings, type WhaleOceanGeometryDiagnostic, type WhaleOceanRuntimeOptions, type WhaleOceanVisualDiagnosticRow } from "./whale-ocean-runtime.js";
import type { WhaleOceanBatch } from "./whale-ocean-model.js";
import type { WhaleOceanAnimalKind } from "./whale-ocean-model.js";
import type { WhaleOceanScoreboard } from "./whale-ocean-scoreboard.js";

const instances = new Map<number, WhaleOceanRuntime>();
const initializationTasks = new Map<number, Promise<void>>();

export async function initialize(options: WhaleOceanRuntimeOptions): Promise<void> {
    const previous = initializationTasks.get(options.matchId);
    if (previous) {
        try { await previous; } catch { /* the next initialization owns recovery */ }
    }

    const task = initializeRuntime(options);
    initializationTasks.set(options.matchId, task);
    try {
        await task;
    } finally {
        if (initializationTasks.get(options.matchId) === task)
            initializationTasks.delete(options.matchId);
    }
}

async function initializeRuntime(options: WhaleOceanRuntimeOptions): Promise<void> {
    await dispose(options.matchId);
    const runtime = new WhaleOceanRuntime({
        ...options,
        visualBudget: options.visualBudget
    });
    // Keep the instance discoverable for an explicit dispose while async
    // Babylon/texture initialization is still in flight. The runtime itself
    // checks `disposed` before touching the scene after every await.
    instances.set(options.matchId, runtime);
    try {
        await runtime.initialize();
        if (options.calibrationEnabled) initializeCalibrationPanel(options.matchId);
    } catch (error) {
        instances.delete(options.matchId);
        await runtime.dispose();
        throw error;
    }
}

export async function initializeDiagnostic(canvas: HTMLCanvasElement, mode: "sprites" | "showcase"): Promise<void> {
    const matchId = mode === "sprites" ? -10_001 : -10_002;
    await initialize({
        canvas,
        matchId,
        leftSymbol: "LIMA",
        rightSymbol: "CIANO",
        leftPrice: null,
        rightPrice: null,
        leftChange: 0,
        rightChange: 0,
        leftColor: "#789A0C",
        rightColor: "#087F83",
        quality: "High",
        diagnostic: mode
    });
}

export function receive(matchId: number, batch: WhaleOceanBatch): void {
    instances.get(matchId)?.receive(batch);
}

export function getVisualDiagnostics(matchId: number): WhaleOceanVisualDiagnosticRow[] {
    return instances.get(matchId)?.visualDiagnostics() ?? [];
}

export function getGeometryDiagnostics(matchId: number): WhaleOceanGeometryDiagnostic | null {
    return instances.get(matchId)?.geometryDiagnostics() ?? null;
}

export function getCalibrationState(matchId: number) {
    return instances.get(matchId)?.getCalibrationState() ?? null;
}

export function setCalibration(matchId: number, settings: WhaleOceanCalibrationSettings): void {
    instances.get(matchId)?.setCalibration(settings);
}

export function initializeCalibrationPanel(matchId: number): void {
    const runtime = instances.get(matchId);
    const panel = document.querySelector<HTMLElement>(`[data-whale-ocean-calibration="${matchId}"]`);
    if (!runtime || !panel) return;
    detachCalibrationPanel(matchId);
    let settings = runtime.getCalibrationState().settings;
    let paused = false;
    const storageKey = "cv:whale-ocean-calibration:v1";
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as WhaleOceanCalibrationSettings | null;
        if (saved?.version === 1) {
            runtime.setCalibration(saved);
            settings = runtime.getCalibrationState().settings;
        }
    } catch { /* An invalid local DEV snapshot is ignored. */ }
    const setStatus = (message: string) => {
        const status = panel.querySelector<HTMLElement>("[data-calibration-status]");
        if (status) status.textContent = message;
    };
    const pathValue = (path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key], settings);
    const writePath = (path: string, value: unknown) => {
        const parts = path.split(".");
        let target = settings as unknown as Record<string, unknown>;
        for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
        target[parts[parts.length - 1]] = value;
    };
    const apply = (message = "Aplicado ao runtime") => {
        runtime.setCalibration(settings);
        settings = runtime.getCalibrationState().settings;
        render();
        setStatus(message);
    };
    const render = () => {
        for (const element of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-calibration-field]")) {
            const path = element.dataset.calibrationField!;
            const value = pathValue(path);
            if (element instanceof HTMLInputElement && element.type === "checkbox") element.checked = value === true;
            else element.value = String(value ?? "");
        }
        const state = runtime.getCalibrationState();
        const diagnostics = panel.querySelector<HTMLElement>("[data-calibration-diagnostics]");
        if (diagnostics) diagnostics.textContent = JSON.stringify({ camera: state.camera, canvas: state.canvas, visibleWorld: state.visibleWorld, diagnostics: state.diagnostics, samplePaths: state.paths.filter(path => path.band === "central").slice(0, 4) }, null, 2);
        const pauseButton = panel.querySelector<HTMLButtonElement>("[data-calibration-action='pause']");
        if (pauseButton) pauseButton.textContent = paused ? "Resume simulation" : "Pause simulation";
    };
    const cloneSettings = (value: WhaleOceanCalibrationSettings) => JSON.parse(JSON.stringify(value)) as WhaleOceanCalibrationSettings;
    const readControl = (selector: string, fallback: string) => panel.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? fallback;
    const spawn = (side: "buy" | "sell", territory: "left" | "right", quantity = Number(readControl("[data-test-field='quantity']", "1"))) => {
        const kind = readControl("[data-test-field='kind']", "sardine") as WhaleOceanAnimalKind;
        const bandIndex = Math.max(0, Math.min(4, Number(readControl("[data-test-field='band']", "2"))));
        const speed = Math.max(0.05, Number(readControl("[data-test-field='speed']", "1")) || 1);
        runtime.spawnCalibrationTestFish({ side, territory, kind, bandIndex, speed, quantity });
        render();
    };
    const onInput = (event: Event) => {
        const element = event.target as HTMLInputElement | HTMLSelectElement | null;
        const path = element?.dataset.calibrationField;
        if (!path) return;
        const value = element instanceof HTMLInputElement && element.type === "checkbox" ? element.checked : Number.isFinite(Number(element.value)) && element.type !== "select-one" ? Number(element.value) : element.value;
        writePath(path, value);
        apply();
    };
    const onClick = async (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-calibration-action]");
        if (!button) return;
        const action = button.dataset.calibrationAction;
        if (action === "reset-camera") {
            const state = runtime.getCalibrationState();
            settings.camera = { ...state.camera };
            apply("Câmera de referência restaurada");
        } else if (action === "center-camera") {
            const state = runtime.getCalibrationState();
            settings.camera.targetX = (state.visibleWorld.left + state.visibleWorld.right) / 2;
            apply("Câmera centralizada");
        } else if (action === "apply-offset") apply("Offset aplicado sem acumular");
        else if (action === "reset-defaults") { runtime.resetCalibration(); settings = runtime.getCalibrationState().settings; render(); setStatus("Defaults restaurados"); }
        else if (action === "save") { localStorage.setItem(storageKey, JSON.stringify(settings)); setStatus("Calibração salva no localStorage"); }
        else if (action === "load") {
            try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as WhaleOceanCalibrationSettings | null; if (!saved) throw new Error("Nenhuma calibração salva"); runtime.setCalibration(saved); settings = runtime.getCalibrationState().settings; render(); setStatus("Calibração carregada"); }
            catch { setStatus("Nenhuma calibração válida encontrada"); }
        } else if (action === "export" || action === "copy") {
            const json = JSON.stringify(settings, null, 2);
            if (action === "copy") { await navigator.clipboard?.writeText(json); setStatus("JSON copiado"); }
            else { const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "whale-ocean-calibration-v1.json"; link.click(); URL.revokeObjectURL(url); setStatus("JSON exportado"); }
        } else if (action === "spawn") spawn(readControl("[data-test-field='side']", "buy") as "buy" | "sell", readControl("[data-test-field='territory']", "left") as "left" | "right");
        else if (action === "spawn-both") { spawn("buy", "left"); spawn("sell", "right"); setStatus("TEST BUY + TEST SELL criados"); }
        else if (action === "all-bands") { for (let band = 0; band < 5; band++) { runtime.spawnCalibrationTestFish({ side: "buy", territory: "left", kind: readControl("[data-test-field='kind']", "sardine") as any, bandIndex: band, speed: 1, quantity: 1 }); runtime.spawnCalibrationTestFish({ side: "sell", territory: "right", kind: readControl("[data-test-field='kind']", "sardine") as any, bandIndex: band, speed: 1, quantity: 1 }); } render(); setStatus("Todas as faixas testadas"); }
        else if (action === "pause") { paused = !paused; runtime.setPaused(paused); render(); }
        else if (action === "toggle") { panel.classList.toggle("whale-ocean__calibration--collapsed"); button.textContent = panel.classList.contains("whale-ocean__calibration--collapsed") ? "+" : "−"; }
        else if (action === "clear") { runtime.clearCalibrationTestFish(); render(); setStatus("Peixes TEST removidos"); }
        else if (action === "restart") { runtime.restartCalibrationTrajectories(); render(); setStatus("Trajetórias TEST reiniciadas"); }
    };
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", onInput);
    panel.addEventListener("click", onClick);
    panelBindings.set(matchId, () => { panel.removeEventListener("input", onInput); panel.removeEventListener("change", onInput); panel.removeEventListener("click", onClick); });
    render();
}

const panelBindings = new Map<number, () => void>();

function detachCalibrationPanel(matchId: number): void {
    panelBindings.get(matchId)?.();
    panelBindings.delete(matchId);
}

export function setPaused(matchId: number, paused: boolean): void {
    instances.get(matchId)?.setPaused(paused);
}

export function setConnectionState(matchId: number, connected: boolean): void {
    instances.get(matchId)?.setConnectionState(connected);
}

export function setMatchFinished(matchId: number, finished: boolean): void {
    instances.get(matchId)?.setMatchFinished(finished);
}

export function setOfficialMatchState(
    matchId: number,
    finished: boolean,
    rawStatus: string | null,
    startTimeUtc: string | null,
    endTimeUtc: string | null
): void {
    instances.get(matchId)?.setOfficialMatchState(finished, rawStatus, startTimeUtc, endTimeUtc);
}

export function completeReplay(matchId: number): void {
    instances.get(matchId)?.completeReplay();
}

export function setScoreboard(matchId: number, scoreboard: WhaleOceanScoreboard | null): void {
    instances.get(matchId)?.setScoreboard(scoreboard);
}

export async function setQuality(matchId: number, quality: "Low" | "Medium" | "High"): Promise<void> {
    await instances.get(matchId)?.setQuality(quality);
}

export function setLabels(matchId: number, labels: Record<string, string>): void {
    instances.get(matchId)?.setLabels(labels);
}

export async function dispose(matchId: number): Promise<void> {
    detachCalibrationPanel(matchId);
    const runtime = instances.get(matchId);
    if (!runtime) return;
    instances.delete(matchId);
    await runtime.dispose();
}
