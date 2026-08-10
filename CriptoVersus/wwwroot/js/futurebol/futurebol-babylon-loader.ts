type BabylonApi = typeof import("babylonjs");

interface BabylonWindow extends Window {
    BABYLON?: BabylonApi;
}

const BABYLON_SCRIPT_ID = "futurebol-babylon-runtime";
const BABYLON_SCRIPT_URL = "/js/futurebol/vendor/babylon.js?v=8.19.0";
const GLTF_LOADER_SCRIPT_ID = "futurebol-babylon-gltf-loader";
const GLTF_LOADER_SCRIPT_URL = "/js/futurebol/vendor/babylonjs.loaders.min.js?v=8.19.0";
let loadPromise: Promise<BabylonApi> | null = null;
let users = 0;
let gltfLoadPromise: Promise<void> | null = null;
let gltfUsers = 0;

export async function acquireBabylon(): Promise<BabylonApi> {
    users += 1;
    const host = window as unknown as BabylonWindow;
    if (host.BABYLON)
        return host.BABYLON;

    loadPromise ??= new Promise<BabylonApi>((resolve, reject) => {
        const script = document.createElement("script");
        script.id = BABYLON_SCRIPT_ID;
        script.src = BABYLON_SCRIPT_URL;
        script.async = true;
        script.dataset.futurebolAsset = "true";
        script.onload = () => {
            if (host.BABYLON)
                resolve(host.BABYLON);
            else
                reject(new Error("Babylon.js carregou sem expor o runtime esperado."));
        };
        script.onerror = () => reject(new Error("Não foi possível carregar o runtime 3D local do Futurebol."));
        document.head.appendChild(script);
    });

    try {
        return await loadPromise;
    } catch (error) {
        releaseBabylon();
        throw error;
    }
}

export async function acquireBabylonGltfLoader(): Promise<void> {
    gltfUsers += 1;
    if (document.getElementById(GLTF_LOADER_SCRIPT_ID))
        return;

    gltfLoadPromise ??= new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.id = GLTF_LOADER_SCRIPT_ID;
        script.src = GLTF_LOADER_SCRIPT_URL;
        script.async = true;
        script.dataset.futurebolAsset = "true";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Não foi possível carregar o loader GLB local do Futurebol."));
        document.head.appendChild(script);
    });

    try {
        await gltfLoadPromise;
    } catch (error) {
        releaseBabylonGltfLoader();
        throw error;
    }
}

export function releaseBabylonGltfLoader(): void {
    gltfUsers = Math.max(0, gltfUsers - 1);
    if (gltfUsers > 0)
        return;
    document.getElementById(GLTF_LOADER_SCRIPT_ID)?.remove();
    gltfLoadPromise = null;
}

export function releaseBabylon(): void {
    users = Math.max(0, users - 1);
    if (users > 0)
        return;

    document.getElementById(GLTF_LOADER_SCRIPT_ID)?.remove();
    document.getElementById(BABYLON_SCRIPT_ID)?.remove();
    gltfUsers = 0;
    gltfLoadPromise = null;
    delete (window as unknown as BabylonWindow).BABYLON;
    loadPromise = null;
}
