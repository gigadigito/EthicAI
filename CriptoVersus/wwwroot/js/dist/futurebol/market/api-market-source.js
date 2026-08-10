export class ApiMarketSource {
    constructor(initialSnapshot) {
        this.listeners = new Set();
        this.connected = false;
        this.error = null;
        this.snapshot = cloneSnapshot(initialSnapshot);
    }
    async connect() {
        if (this.connected)
            return;
        this.connected = true;
        this.emit(this.snapshot);
    }
    async disconnect() {
        this.connected = false;
        this.listeners.clear();
    }
    getSnapshot() {
        return cloneSnapshot(this.snapshot);
    }
    getDiagnostics() {
        return {
            mode: 'api',
            lastUpdatedAt: this.snapshot.timestamp,
            error: this.error
        };
    }
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    push(snapshot) {
        this.snapshot = cloneSnapshot(snapshot);
        this.error = null;
        if (this.connected)
            this.emit(this.snapshot);
    }
    reportError(message) {
        this.error = message.trim() || 'Falha ao receber a atualização de mercado.';
    }
    emit(snapshot) {
        const copy = cloneSnapshot(snapshot);
        for (const listener of this.listeners)
            listener(copy);
    }
}
function cloneSnapshot(snapshot) {
    return {
        ...snapshot,
        home: { ...snapshot.home },
        away: { ...snapshot.away }
    };
}
