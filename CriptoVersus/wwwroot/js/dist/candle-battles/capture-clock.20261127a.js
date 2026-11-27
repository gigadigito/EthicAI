/** Monotonic wall-clock projection used only by segmented video capture. */
export class MonotonicCaptureClock {
    constructor(now = () => performance.now()) {
        this.now = now;
        this.anchorNow = 0;
        this.anchorPosition = 0;
        this.limit = Number.POSITIVE_INFINITY;
        this.running = false;
    }
    prepare(positionMs, limitMs) {
        this.anchorPosition = Math.max(0, positionMs);
        this.limit = Math.max(this.anchorPosition, limitMs);
        this.anchorNow = this.now();
        this.running = false;
    }
    start() {
        if (this.running)
            return;
        this.anchorNow = this.now();
        this.running = true;
    }
    pause() {
        const position = this.position();
        this.anchorPosition = position;
        this.anchorNow = this.now();
        this.running = false;
        return position;
    }
    position() {
        const elapsed = this.running ? Math.max(0, this.now() - this.anchorNow) : 0;
        return Math.min(this.limit, this.anchorPosition + elapsed);
    }
    reset() {
        this.anchorNow = 0;
        this.anchorPosition = 0;
        this.limit = Number.POSITIVE_INFINITY;
        this.running = false;
    }
    get isRunning() { return this.running; }
}
