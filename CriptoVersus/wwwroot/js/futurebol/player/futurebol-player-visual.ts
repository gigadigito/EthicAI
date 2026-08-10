import type { AbstractMesh, TransformNode } from "babylonjs";
import type {
    FuturebolPlayerState,
    FuturebolPlayerVisualDiagnostics,
    FuturebolQuality,
    FuturebolVisualUpdateContext
} from "../futurebol-types.js";

export interface FuturebolPlayerVisual {
    readonly root: TransformNode;
    readonly meshes: readonly AbstractMesh[];
    update(player: FuturebolPlayerState, context: FuturebolVisualUpdateContext, deltaSeconds: number): void;
    diagnostics(): FuturebolPlayerVisualDiagnostics;
    setQuality(quality: FuturebolQuality): void;
    reset(): void;
    dispose(): void;
}
