const BABYLON_SCRIPT_ID = "futurebol-babylon-runtime";
const BABYLON_SCRIPT_URL = "/js/futurebol/vendor/babylon.js?v=8.19.0";
const GLTF_LOADER_SCRIPT_ID = "futurebol-babylon-gltf-loader";
const GLTF_LOADER_SCRIPT_URL = "/js/futurebol/vendor/babylonjs.loaders.min.js?v=8.19.0";
let loadPromise = null;
let users = 0;
let gltfLoadPromise = null;
let gltfUsers = 0;
let runtimePreloadPromise = null;
export async function acquireBabylon() {
    users += 1;
    const host = window;
    if (host.BABYLON)
        return host.BABYLON;
    loadPromise ?? (loadPromise = new Promise((resolve, reject) => {
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
    }));
    try {
        return await loadPromise;
    }
    catch (error) {
        releaseBabylon();
        throw error;
    }
}
export async function acquireBabylonGltfLoader() {
    gltfUsers += 1;
    if (gltfLoadPromise) {
        await gltfLoadPromise;
        return;
    }
    if (document.getElementById(GLTF_LOADER_SCRIPT_ID))
        return;
    gltfLoadPromise ?? (gltfLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.id = GLTF_LOADER_SCRIPT_ID;
        script.src = GLTF_LOADER_SCRIPT_URL;
        script.async = true;
        script.dataset.futurebolAsset = "true";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Não foi possível carregar o loader GLB local do Futurebol."));
        document.head.appendChild(script);
    }));
    try {
        await gltfLoadPromise;
    }
    catch (error) {
        releaseBabylonGltfLoader();
        throw error;
    }
}
export function preloadBabylonRuntime() {
    runtimePreloadPromise ?? (runtimePreloadPromise = (async () => {
        await acquireBabylon();
        await acquireBabylonGltfLoader();
    })());
    return runtimePreloadPromise;
}
export function releaseBabylonGltfLoader() {
    gltfUsers = Math.max(0, gltfUsers - 1);
    if (gltfUsers > 0)
        return;
    document.getElementById(GLTF_LOADER_SCRIPT_ID)?.remove();
    gltfLoadPromise = null;
}
export function releaseBabylon() {
    users = Math.max(0, users - 1);
    if (users > 0)
        return;
    document.getElementById(GLTF_LOADER_SCRIPT_ID)?.remove();
    document.getElementById(BABYLON_SCRIPT_ID)?.remove();
    gltfUsers = 0;
    gltfLoadPromise = null;
    delete window.BABYLON;
    loadPromise = null;
}
