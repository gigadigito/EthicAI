export type CaptureNow = () => number;

/** Monotonic wall-clock projection used only by segmented video capture. */
export class MonotonicCaptureClock {
    private anchorNow = 0;
    private anchorPosition = 0;
    private limit = Number.POSITIVE_INFINITY;
    private running = false;

    constructor(private readonly now: CaptureNow = () => performance.now()) {}

    prepare(positionMs: number, limitMs: number): void {
        this.anchorPosition = Math.max(0, positionMs);
        this.limit = Math.max(this.anchorPosition, limitMs);
        this.anchorNow = this.now();
        this.running = false;
    }

    start(): void {
        if (this.running) return;
        this.anchorNow = this.now();
        this.running = true;
    }

    pause(): number {
        const position = this.position();
        this.anchorPosition = position;
        this.anchorNow = this.now();
        this.running = false;
        return position;
    }

    position(): number {
        const elapsed = this.running ? Math.max(0, this.now() - this.anchorNow) : 0;
        return Math.min(this.limit, this.anchorPosition + elapsed);
    }

    reset(): void {
        this.anchorNow = 0;
        this.anchorPosition = 0;
        this.limit = Number.POSITIVE_INFINITY;
        this.running = false;
    }

    get isRunning(): boolean { return this.running; }
}
