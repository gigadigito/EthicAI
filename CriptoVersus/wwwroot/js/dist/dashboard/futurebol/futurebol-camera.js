/**
 * Câmera de transmissão do Futurebol.
 *
 * Mantém o campo legível durante a construção, antecipa o sentido do ataque
 * e aproxima a ação somente em passe, chute e resultado. O movimento usa
 * zona morta e suavização exponencial para evitar tremores causados pelas
 * pequenas correções da bola e dos jogadores.
 */
export class FuturebolCamera {
    constructor(B, scene, reducedMotion) {
        this.reducedMotion = reducedMotion;
        this.previousBall = point(0, 0.55, 0);
        this.fixed = false;
        this.initialized = false;
        this.smoothedBallVelocityX = 0;
        this.smoothedBallVelocityZ = 0;
        this.camera = new B.FreeCamera("futurebol-broadcast-camera", new B.Vector3(0, 20.8, -31.5), scene);
        this.camera.fov = 0.75;
        this.camera.minZ = 0.2;
        this.camera.maxZ = 180;
        this.target = new B.Vector3(0, 0.9, 0);
        this.camera.setTarget(this.target);
    }
    setFixed(value) {
        this.fixed = value;
    }
    update(ball, pressure, phase, activeTeam, deltaSeconds) {
        const safeDelta = clamp(deltaSeconds, 0, 0.1);
        this.updateBallVelocity(ball, safeDelta);
        const shot = this.fixed
            ? this.fixedBroadcastShot()
            : this.resolveBroadcastShot(ball, pressure, phase, activeTeam);
        const response = this.reducedMotion
            ? Math.min(shot.responsiveness, 0.62)
            : shot.responsiveness;
        const blend = safeDelta > 0
            ? 1 - Math.exp(-response * safeDelta)
            : 0;
        this.camera.position.x = dampWithDeadZone(this.camera.position.x, shot.positionX, blend, 0.035);
        this.camera.position.y = lerp(this.camera.position.y, shot.positionY, blend);
        this.camera.position.z = clamp(lerp(this.camera.position.z, shot.positionZ, blend), -36.5, -24.2);
        this.camera.fov = lerp(this.camera.fov, shot.fov, blend * 0.72);
        this.target.x = dampWithDeadZone(this.target.x, shot.targetX, blend, 0.025);
        this.target.y = lerp(this.target.y, shot.targetY, blend);
        this.target.z = dampWithDeadZone(this.target.z, shot.targetZ, blend, 0.025);
        this.camera.setTarget(this.target);
        copyPoint(this.previousBall, ball);
        this.initialized = true;
    }
    resolveBroadcastShot(ball, pressure, phase, activeTeam) {
        const direction = activeTeam === "home"
            ? 1
            : activeTeam === "away"
                ? -1
                : Math.sign(pressure);
        const velocityLead = clamp(this.smoothedBallVelocityX * 0.36, -2.2, 2.2);
        const lateralLead = clamp(this.smoothedBallVelocityZ * 0.2, -0.9, 0.9);
        switch (phase) {
            case "Neutral":
            case "Cooldown":
                return {
                    positionX: clamp(pressure * 1.2, -1.6, 1.6),
                    positionY: 21.4,
                    positionZ: -32.4,
                    targetX: clamp(pressure * 1.6, -2.1, 2.1),
                    targetY: 0.82,
                    targetZ: 0,
                    fov: 0.765,
                    responsiveness: 0.9
                };
            case "BuildUp":
                return {
                    positionX: clamp(ball.x * 0.4 + direction * 1.5, -11.5, 11.5),
                    positionY: 20.6,
                    positionZ: -30.8,
                    targetX: clamp(ball.x * 0.58 + direction * 2.1, -15, 15),
                    targetY: 0.92,
                    targetZ: clamp(ball.z * 0.28, -3.3, 3.3),
                    fov: 0.745,
                    responsiveness: 1.15
                };
            case "Passing":
                return {
                    positionX: clamp(ball.x * 0.54 + velocityLead, -13.2, 13.2),
                    positionY: 19.4,
                    positionZ: -28.9,
                    targetX: clamp(ball.x * 0.72 + velocityLead, -17.2, 17.2),
                    targetY: 1.05,
                    targetZ: clamp(ball.z * 0.42 + lateralLead, -4.4, 4.4),
                    fov: 0.715,
                    responsiveness: 1.7
                };
            case "Attacking":
                return {
                    positionX: clamp(ball.x * 0.58 + direction * 2.2 + velocityLead, -14.2, 14.2),
                    positionY: 19.1,
                    positionZ: -28.1,
                    targetX: clamp(ball.x * 0.76 + direction * 2.5, -17.8, 17.8),
                    targetY: 1,
                    targetZ: clamp(ball.z * 0.4 + lateralLead, -4.5, 4.5),
                    fov: 0.715,
                    responsiveness: 1.45
                };
            case "PreparingShot":
            case "Shooting":
                return {
                    positionX: clamp(ball.x * 0.7 + direction * 3.4 + velocityLead, -15.2, 15.2),
                    positionY: this.reducedMotion ? 18.6 : 17.6,
                    positionZ: this.reducedMotion ? -27.4 : -25.9,
                    targetX: clamp(ball.x * 0.84 + direction * 2.9, -19, 19),
                    targetY: 1.15,
                    targetZ: clamp(ball.z * 0.52 + lateralLead, -5.1, 5.1),
                    fov: this.reducedMotion ? 0.705 : 0.675,
                    responsiveness: this.reducedMotion ? 1.05 : 2.05
                };
            case "Outcome":
                return {
                    positionX: clamp(ball.x * 0.64 + direction * 2.3, -14.8, 14.8),
                    positionY: 18.7,
                    positionZ: -27.7,
                    targetX: clamp(ball.x * 0.79, -18.5, 18.5),
                    targetY: 1.05,
                    targetZ: clamp(ball.z * 0.5, -4.8, 4.8),
                    fov: 0.695,
                    responsiveness: 1.25
                };
            case "Resetting":
                return {
                    positionX: clamp(ball.x * 0.28, -7, 7),
                    positionY: 20.8,
                    positionZ: -31.2,
                    targetX: clamp(ball.x * 0.4, -9, 9),
                    targetY: 0.88,
                    targetZ: clamp(ball.z * 0.2, -2.5, 2.5),
                    fov: 0.75,
                    responsiveness: 0.95
                };
        }
    }
    fixedBroadcastShot() {
        return {
            positionX: 0,
            positionY: 22,
            positionZ: -33.5,
            targetX: 0,
            targetY: 0.85,
            targetZ: 0,
            fov: 0.78,
            responsiveness: 1.05
        };
    }
    updateBallVelocity(ball, deltaSeconds) {
        if (!this.initialized || deltaSeconds <= 0) {
            this.smoothedBallVelocityX = 0;
            this.smoothedBallVelocityZ = 0;
            return;
        }
        const rawVelocityX = (ball.x - this.previousBall.x) / deltaSeconds;
        const rawVelocityZ = (ball.z - this.previousBall.z) / deltaSeconds;
        const blend = 1 - Math.exp(-7.5 * deltaSeconds);
        this.smoothedBallVelocityX = lerp(this.smoothedBallVelocityX, clamp(rawVelocityX, -30, 30), blend);
        this.smoothedBallVelocityZ = lerp(this.smoothedBallVelocityZ, clamp(rawVelocityZ, -20, 20), blend);
    }
}
function point(x, y, z) {
    return { x, y, z };
}
function copyPoint(target, source) {
    target.x = source.x;
    target.y = source.y;
    target.z = source.z;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function lerp(from, to, amount) {
    return from + (to - from) * amount;
}
function dampWithDeadZone(current, target, amount, deadZone) {
    if (Math.abs(target - current) <= deadZone)
        return current;
    return lerp(current, target, amount);
}
