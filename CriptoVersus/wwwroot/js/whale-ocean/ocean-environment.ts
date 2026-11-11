import type { ArcRotateCamera, Engine, Scene } from "babylonjs";

export type BabylonApi = typeof import("babylonjs");

export interface OceanEnvironmentConfig {
    sunX: number;
    sunY: number;
    sunIntensity: number;
    rayIntensity: number;
    causticIntensity: number;
    waveSpeed: number;
    fogDensity: number;
}

export interface OceanEnvironmentOptions {
    babylon: BabylonApi;
    scene: Scene;
    camera: ArcRotateCamera;
    engine: Engine;
}

export interface OceanEnvironment {
    update(deltaTime: number): void;
    setConfig(config: Partial<OceanEnvironmentConfig>): void;
    resize(): void;
    dispose(): void;
}

const DEFAULT_CONFIG: OceanEnvironmentConfig = {
    sunX: 0.52,
    sunY: 1.06,
    sunIntensity: 1.25,
    rayIntensity: 0.72,
    causticIntensity: 0.65,
    waveSpeed: 0.45,
    fogDensity: 0.015
};

const SEA_VERTEX_SHADER = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;

    uniform mat4 worldViewProjection;
    uniform float time;

    varying vec2 vUV;
    varying float vWave;

    void main() {
        vec3 p = position;

        float a =
            sin(p.x * 0.26 + time * 0.70) *
            cos(p.z * 0.31 + time * 0.35);

        float b =
            sin(p.x * 0.54 - p.z * 0.21 +
                time * 0.45);

        float c =
            cos(p.z * 0.77 + time * 0.58);

        p.y += a * 0.36 + b * 0.15 + c * 0.06;

        vWave = a * 0.6 + b * 0.3 + c * 0.1;
        vUV = uv;

        gl_Position =
            worldViewProjection * vec4(p, 1.0);
    }
`;

const SEA_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUV;
    varying float vWave;

    uniform float time;

    void main() {
        vec2 p = vUV * 85.0;

        float a =
            sin(p.x * 0.75 + time * 0.5) *
            cos(p.y * 0.63 - time * 0.4);

        float b =
            sin(p.x * 0.38 + p.y * 0.72 +
                time * 0.32);

        float shimmer = pow(
            max(0.0, a * 0.7 + b * 0.3),
            5.0
        );

        vec3 dark = vec3(0.012, 0.28, 0.29);
        vec3 light = vec3(0.16, 0.68, 0.62);

        vec3 color = mix(
            dark,
            light,
            clamp(0.48 + vWave * 0.24, 0.0, 1.0)
        );

        color += shimmer *
            vec3(0.34, 0.47, 0.34) * 0.35;

        gl_FragColor = vec4(color, 0.82);
    }
`;

const SAND_VERTEX_SHADER = `
    precision highp float;

    attribute vec3 position;
    attribute vec2 uv;

    uniform mat4 worldViewProjection;
    uniform mat4 world;

    varying vec2 vUV;
    varying vec3 vWorld;

    void main() {
        vUV = uv;
        vWorld = (world * vec4(position, 1.0)).xyz;
        gl_Position =
            worldViewProjection * vec4(position, 1.0);
    }
`;

const SAND_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUV;
    varying vec3 vWorld;

    uniform float time;
    uniform float causticStrength;
    uniform vec3 cameraPosition;

    float causticLayer(vec2 p, float t) {
        vec2 q = p;

        q.x += sin(p.y * 0.67 + t * 0.54) * 0.42;
        q.y += cos(p.x * 0.81 - t * 0.43) * 0.42;

        float a = sin(
            q.x * 1.28 +
            sin(q.y * 0.81 + t * 0.25)
        );

        float b = cos(
            q.y * 1.31 +
            cos(q.x * 0.72 - t * 0.31)
        );

        float v = abs(a + b);

        return pow(
            1.0 - smoothstep(0.02, 0.48, v),
            1.65
        );
    }

    void main() {
        vec2 p = vWorld.xz * 0.72;

        float c1 = causticLayer(p, time);
        float c2 = causticLayer(
            p * 1.17 + vec2(3.6, 2.1),
            time * 0.81
        );

        float caustic = max(c1, c2 * 0.65);

        // Areia escura com reflexos dourados
        vec3 sand = vec3(0.055, 0.23, 0.22);
        vec3 sunColor = vec3(1.0, 0.91, 0.62);

        vec3 color =
            sand +
            sunColor * caustic *
            causticStrength;

        float distanceFromCamera =
            length(vWorld - cameraPosition);

        // O fundo desaparece suavemente
        // no oceano distante.
        float fog = 1.0 - exp(
            -distanceFromCamera *
            distanceFromCamera * 0.00035
        );

        color = mix(
            color,
            vec3(0.008, 0.19, 0.18),
            clamp(fog, 0.0, 0.98)
        );

        gl_FragColor = vec4(color, 1.0);
    }
`;

const LIGHT_FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 vUV;

    uniform sampler2D textureSampler;
    uniform float time;
    uniform vec2 sunPosition;
    uniform float sunIntensity;
    uniform float rayIntensity;

    float hash(float n) {
        return fract(sin(n) * 43758.5453);
    }

    float rays(vec2 uv) {
        vec2 d = uv - sunPosition;

        // Corrige aproximadamente o formato
        // horizontal dos feixes.
        d.x *= 1.65;

        float angle = atan(d.x, -d.y);
        float radius = length(d);

        float wave =
            sin(angle * 33.0 +
                sin(angle * 11.0 + time * 0.13)
                * 1.4);

        float wave2 =
            sin(angle * 19.0 -
                time * 0.07 +
                sin(angle * 7.0) * 1.8);

        float beams = pow(
            max(0.0, wave * 0.65 +
                     wave2 * 0.35),
            2.2
        );

        // Luz diminui conforme se afasta
        // da superfície.
        float attenuation =
            exp(-radius * 2.2);

        return beams * attenuation;
    }

    void main() {
        vec2 uv = vUV;
        vec3 color = texture2D(
            textureSampler, uv
        ).rgb;

        vec2 fromSun = uv - sunPosition;
        fromSun.x *= 1.5;

        float dist = length(fromSun);

        // Halo solar amplo e suave
        float halo = exp(
            -dist * dist * 16.0
        );

        float core = exp(
            -dist * dist * 90.0
        );

        float beamLight = rays(uv);

        // Volume luminoso que se dissolve
        // em direção ao fundo.
        float depthMask = smoothstep(
            0.05, 0.65, uv.y
        );

        float light =
            halo * 0.50 * sunIntensity +
            core * 0.65 * sunIntensity +
            beamLight * rayIntensity *
            depthMask;

        // Luz branca-quente na origem,
        // turquesa na água.
        vec3 warmSun = vec3(1.0, 0.94, 0.72);
        vec3 turquoise = vec3(0.24, 0.86, 0.73);

        vec3 lightColor = mix(
            turquoise,
            warmSun,
            clamp(halo * 1.6, 0.0, 1.0)
        );

        color += lightColor * light;

        // Escurecimento muito suave na
        // região central distante.
        float middleDepth =
            (1.0 - smoothstep(
                0.1, 0.75, uv.y
            )) * 0.10;

        color *= 1.0 - middleDepth;

        gl_FragColor = vec4(
            clamp(color, 0.0, 1.0),
            1.0
        );
    }
`;

export function createOceanEnvironment(options: OceanEnvironmentOptions): OceanEnvironment {
    const { babylon: B, scene, camera, engine } = options;
    const config = { ...DEFAULT_CONFIG };
    const V3 = (x: number, y: number, z: number) => new B.Vector3(x, y, z);
    const C3 = (r: number, g: number, b: number) => new B.Color3(r, g, b);
    const ownedMaterials: Array<{ dispose(): void }> = [];
    const ownedMeshes: Array<{ dispose(): void }> = [];

    scene.clearColor = new B.Color4(0.005, 0.19, 0.18, 1);
    scene.fogMode = B.Scene.FOGMODE_EXP2;
    scene.fogDensity = config.fogDensity;
    scene.fogColor = C3(0.008, 0.19, 0.18);

    // The reference camera is applied to the existing Whale Ocean camera.
    // The sun remains fixed in screen coordinates, as in the original code.
    camera.alpha = -Math.PI / 2;
    camera.beta = 1.48;
    camera.radius = 27;
    camera.target = V3(0, -0.5, 0);
    camera.fov = 0.85;
    camera.minZ = 0.1;
    camera.maxZ = 450;
    camera.lowerRadiusLimit = 8;
    camera.upperRadiusLimit = 70;
    camera.lowerAlphaLimit = camera.alpha;
    camera.upperAlphaLimit = camera.alpha;
    camera.lowerBetaLimit = camera.beta;
    camera.upperBetaLimit = camera.beta;

    const ambient = new B.HemisphericLight("OceanAmbient", V3(0, 1, 0), scene);
    ambient.intensity = 0.7;
    ambient.diffuse = C3(0.30, 0.82, 0.76);

    B.Effect.ShadersStore["seaV3VertexShader"] = SEA_VERTEX_SHADER;
    B.Effect.ShadersStore["seaV3FragmentShader"] = SEA_FRAGMENT_SHADER;
    const surface = B.MeshBuilder.CreateGround("OceanSurface", {
        width: 320,
        height: 320,
        subdivisions: 110
    }, scene);
    surface.position.y = 10;
    const surfaceMat = new B.ShaderMaterial("OceanSurfaceMaterial", scene, {
        vertex: "seaV3",
        fragment: "seaV3"
    }, {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "time"],
        needAlphaBlending: true
    });
    surfaceMat.backFaceCulling = false;
    surfaceMat.alphaMode = B.Engine.ALPHA_COMBINE;
    surface.material = surfaceMat;
    ownedMeshes.push(surface);
    ownedMaterials.push(surfaceMat);

    B.Effect.ShadersStore["sandV3VertexShader"] = SAND_VERTEX_SHADER;
    B.Effect.ShadersStore["sandV3FragmentShader"] = SAND_FRAGMENT_SHADER;
    const floor = B.MeshBuilder.CreateGround("OceanFloor", { width: 320, height: 320 }, scene);
    floor.position.y = -12;
    const floorMat = new B.ShaderMaterial("SandMaterial", scene, {
        vertex: "sandV3",
        fragment: "sandV3"
    }, {
        attributes: ["position", "uv"],
        uniforms: ["world", "worldViewProjection", "time", "causticStrength", "cameraPosition"]
    });
    floorMat.setFloat("causticStrength", config.causticIntensity);
    floor.material = floorMat;
    ownedMeshes.push(floor);
    ownedMaterials.push(floorMat);

    B.Effect.ShadersStore["oceanLightV3FragmentShader"] = LIGHT_FRAGMENT_SHADER;
    const lightPost = new B.PostProcess(
        "OceanSunRays",
        "oceanLightV3",
        ["time", "sunPosition", "sunIntensity", "rayIntensity"],
        [],
        1,
        camera
    );

    let time = 0;
    lightPost.onApply = effect => {
        effect.setFloat("time", time);
        effect.setFloat2("sunPosition", config.sunX, config.sunY);
        effect.setFloat("sunIntensity", config.sunIntensity);
        effect.setFloat("rayIntensity", config.rayIntensity);
    };

    const particleTexture = new B.DynamicTexture("OceanParticle", { width: 64, height: 64 }, scene, false);
    const ctx = particleTexture.getContext();
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(240,255,240,0.8)");
    gradient.addColorStop(0.35, "rgba(180,240,220,0.22)");
    gradient.addColorStop(1, "rgba(120,200,190,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    particleTexture.update();

    const particles = new B.ParticleSystem("OceanSediments", 250, scene);
    particles.particleTexture = particleTexture;
    particles.emitter = V3(0, 0, 0);
    particles.minEmitBox = V3(-25, -8, -30);
    particles.maxEmitBox = V3(25, 8, 30);
    particles.minSize = 0.018;
    particles.maxSize = 0.075;
    particles.minLifeTime = 10;
    particles.maxLifeTime = 20;
    particles.emitRate = 12;
    particles.color1 = new B.Color4(0.7, 1, 0.85, 0.13);
    particles.color2 = new B.Color4(0.4, 0.8, 0.8, 0.07);
    particles.colorDead = new B.Color4(0, 0, 0, 0);
    particles.direction1 = V3(-0.02, 0.01, -0.02);
    particles.direction2 = V3(0.02, 0.06, 0.02);
    particles.minEmitPower = 0.01;
    particles.maxEmitPower = 0.05;
    particles.updateSpeed = 0.012;
    particles.start();

    let disposed = false;
    return {
        update(deltaTime: number): void {
            if (disposed) return;
            time += Math.min(Math.max(deltaTime, 0), 0.05);
            surfaceMat.setFloat("time", time * config.waveSpeed);
            floorMat.setFloat("time", time);
            floorMat.setVector3("cameraPosition", camera.globalPosition);
        },
        setConfig(next: Partial<OceanEnvironmentConfig>): void {
            if (disposed) return;
            Object.assign(config, next);
            scene.fogDensity = config.fogDensity;
            floorMat.setFloat("causticStrength", config.causticIntensity);
        },
        resize(): void {
            const width = engine.getRenderWidth();
            const height = engine.getRenderHeight();
            if (width > 0 && height > 0) {
                lightPost.width = width;
                lightPost.height = height;
            }
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            lightPost.dispose();
            particles.dispose();
            particleTexture.dispose();
            ambient.dispose();
            for (const mesh of ownedMeshes) mesh.dispose();
            for (const material of ownedMaterials) material.dispose();
        }
    };
}
