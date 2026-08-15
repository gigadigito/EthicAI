import type {
    BaseTexture,
    Scene,
    StandardMaterial
} from 'babylonjs';
import type {
    FuturebolLogoTextureDiagnostic,
    FuturebolLogoTextureDiagnosticMap,
    FuturebolTeam,
    FuturebolTeamVisualConfiguration,
    FuturebolTeamVisualConfigurationMap
} from '../futurebol-types.js';

type BabylonApi = typeof import('babylonjs');
const loggedLogoResults = new Set<string>();

interface FuturebolLogoTextureResource {
    readonly team: FuturebolTeam;
    configuration: FuturebolTeamVisualConfiguration;
    readonly material: StandardMaterial;
    texture: BaseTexture | null;
    ready: Promise<void>;
    generation: number;
    loaded: boolean;
    fallbackActive: boolean;
    error: string | null;
}

interface FuturebolDecodedLogo {
    readonly source: CanvasImageSource;
    readonly width: number;
    readonly height: number;
    dispose(): void;
}

const logoTextureSize = 512;
const logoContentSize = 448;
const logoLoadTimeoutMs = 5_000;

export class FuturebolTeamLogoTextureProvider {
    private readonly resources: Record<FuturebolTeam, FuturebolLogoTextureResource>;
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        teams: FuturebolTeamVisualConfigurationMap
    ) {
        this.logTeamSource('home', teams.home);
        this.logTeamSource('away', teams.away);
        this.resources = {
            home: this.createResource('home', teams.home),
            away: this.createResource('away', teams.away)
        };
    }

    public material(team: FuturebolTeam): StandardMaterial {
        return this.resources[team].material;
    }

    public diagnostics(): FuturebolLogoTextureDiagnosticMap {
        return {
            home: this.toDiagnostic(this.resources.home),
            away: this.toDiagnostic(this.resources.away)
        };
    }

    public ready(): Promise<void> {
        return Promise.allSettled([
            this.resources.home.ready,
            this.resources.away.ready
        ]).then(() => undefined);
    }

    public reconfigure(teams: FuturebolTeamVisualConfigurationMap): Promise<void> {
        if (this.disposed)
            return Promise.resolve();

        return Promise.allSettled([
            this.reconfigureResource(this.resources.home, teams.home),
            this.reconfigureResource(this.resources.away, teams.away)
        ]).then(() => undefined);
    }

    public dispose(): void {
        if (this.disposed)
            return;

        this.disposed = true;
        for (const resource of Object.values(this.resources)) {
            resource.material.diffuseTexture = null;
            resource.material.opacityTexture = null;
            resource.material.emissiveTexture = null;
            resource.material.dispose(false, false);
            resource.texture?.dispose();
            resource.texture = null;
        }
    }

    private createResource(
        team: FuturebolTeam,
        configuration: FuturebolTeamVisualConfiguration
    ): FuturebolLogoTextureResource {
        const material = new this.B.StandardMaterial(
            `futurebol-${team}-logo-material`,
            this.scene
        );
        material.disableLighting = true;
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        material.zOffset = -2;

        const resource: FuturebolLogoTextureResource = {
            team,
            configuration,
            material,
            texture: null,
            ready: Promise.resolve(),
            generation: 0,
            loaded: false,
            fallbackActive: false,
            error: null
        };

        this.activateFallback(resource, null);
        resource.ready = this.loadResource(resource);
        return resource;
    }

    private reconfigureResource(
        resource: FuturebolLogoTextureResource,
        configuration: FuturebolTeamVisualConfiguration
    ): Promise<void> {
        if (resource.configuration.symbol === configuration.symbol
            && resource.configuration.logoUrl === configuration.logoUrl)
            return resource.ready;

        resource.generation += 1;
        resource.configuration = { ...configuration };
        this.logTeamSource(resource.team, configuration);
        resource.material.diffuseTexture = null;
        resource.material.opacityTexture = null;
        resource.material.emissiveTexture = null;
        resource.texture?.dispose();
        resource.texture = null;
        resource.loaded = false;
        resource.fallbackActive = false;
        resource.error = null;
        this.activateFallback(resource, null);
        resource.ready = this.loadResource(resource);
        return resource.ready;
    }

    private async loadResource(resource: FuturebolLogoTextureResource): Promise<void> {
        const configuration = resource.configuration;
        const generation = resource.generation;
        const started = performance.now();
        if (!configuration.logoUrl) {
            this.activateFallback(resource, "Logo URL ausente.", generation, performance.now() - started);
            return;
        }

        let decoded: FuturebolDecodedLogo | null = null;
        try {
            decoded = await this.fetchLogo(configuration.logoUrl);
            if (this.disposed || resource.generation !== generation)
                return;

            const texture = new this.B.DynamicTexture(
                `futurebol-${configuration.symbol}-logo`,
                { width: logoTextureSize, height: logoTextureSize },
                this.scene,
                false
            );
            texture.hasAlpha = true;
            const context = texture.getContext();
            context.clearRect(0, 0, logoTextureSize, logoTextureSize);
            const scale = Math.min(
                logoContentSize / Math.max(1, decoded.width),
                logoContentSize / Math.max(1, decoded.height)
            );
            const width = Math.max(1, decoded.width * scale);
            const height = Math.max(1, decoded.height * scale);
            context.drawImage(
                decoded.source,
                (logoTextureSize - width) / 2,
                (logoTextureSize - height) / 2,
                width,
                height
            );
            texture.update(true);

            if (this.disposed || resource.generation !== generation) {
                texture.dispose();
                return;
            }

            const previousTexture = resource.texture;
            resource.texture = texture;
            resource.loaded = true;
            resource.fallbackActive = false;
            resource.error = null;
            this.applyTexture(resource, texture);
            previousTexture?.dispose();
            this.logOnce(
                `loaded:${configuration.symbol}:${configuration.logoUrl}`,
                'info',
                `[Futurebol][LogoTexture] team=${configuration.symbol} status=loaded `
                + `url=${configuration.logoUrl} durationMs=${Math.round(performance.now() - started)}`
            );
        } catch (error) {
            const detail = error instanceof Error
                ? error.message
                : 'Falha ao carregar a imagem do logo.';
            this.activateFallback(resource, detail, generation, performance.now() - started);
        } finally {
            decoded?.dispose();
        }
    }

    private async fetchLogo(url: string): Promise<FuturebolDecodedLogo> {
        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(
            () => controller.abort(),
            logoLoadTimeoutMs
        );
        let response: Response;
        try {
            response = await fetch(url, {
                cache: 'force-cache',
                credentials: 'same-origin',
                mode: 'cors',
                signal: controller.signal
            });
        } catch (error) {
            if (controller.signal.aborted)
                throw new Error(`Logo excedeu ${logoLoadTimeoutMs} ms.`);
            throw error;
        } finally {
            globalThis.clearTimeout(timeoutId);
        }
        if (!response.ok)
            throw new Error(`Logo HTTP ${response.status}.`);

        const blob = await response.blob();
        if (blob.size === 0)
            throw new Error('A imagem do logo veio vazia.');

        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(blob);
            if (bitmap.width <= 0 || bitmap.height <= 0) {
                bitmap.close();
                throw new Error('A imagem do logo possui dimensões inválidas.');
            }
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                dispose: () => bitmap.close()
            };
        }

        const objectUrl = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.decoding = 'async';
            const loaded = new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('O navegador não conseguiu decodificar o logo.'));
            });
            image.src = objectUrl;
            await loaded;
            if (image.naturalWidth <= 0 || image.naturalHeight <= 0)
                throw new Error('A imagem do logo possui dimensões inválidas.');
            return {
                source: image,
                width: image.naturalWidth,
                height: image.naturalHeight,
                dispose: () => URL.revokeObjectURL(objectUrl)
            };
        } catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
        }
    }

    private activateFallback(
        resource: FuturebolLogoTextureResource,
        error: string | null,
        generation = resource.generation,
        durationMs = 0
    ): void {
        if (this.disposed || resource.generation !== generation)
            return;

        resource.loaded = false;
        resource.fallbackActive = true;
        resource.error = error;
        if (!resource.texture) {
            try {
                const fallback = new this.B.DynamicTexture(
                    `futurebol-${resource.configuration.symbol}-logo-fallback`,
                    { width: 512, height: 512 },
                    this.scene,
                    false
                );
                fallback.hasAlpha = true;
                const symbol = resource.configuration.symbol;
                const fontSize = Math.max(96, Math.floor(350 / Math.max(1, symbol.length * .72)));
                fallback.drawText(
                    symbol,
                    null,
                    340,
                    `bold ${fontSize}px Arial, sans-serif`,
                    '#ffffff',
                    'transparent',
                    true,
                    true
                );
                resource.texture = fallback;
                this.applyTexture(resource, fallback);
            } catch (fallbackError) {
                const fallbackDetail = fallbackError instanceof Error
                    ? fallbackError.message
                    : 'Falha ao criar ticker de fallback.';
                resource.error = error
                    ? `${error} Fallback: ${fallbackDetail}`
                    : fallbackDetail;
            }
        }

        if (error) {
            this.logOnce(
                `error:${resource.configuration.symbol}:${resource.configuration.logoUrl}`,
                'warn',
                `[Futurebol][LogoTexture] team=${resource.configuration.symbol} status=failed `
                + `url=${resource.configuration.logoUrl ?? '(missing)'} `
                + `error=${resource.error ?? error} fallback=ticker `
                + `durationMs=${Math.round(durationMs)}`
            );
        }
    }

    private logTeamSource(
        team: FuturebolTeam,
        configuration: FuturebolTeamVisualConfiguration
    ): void {
        console.info(
            `[Futurebol][TeamLogo] team=${configuration.symbol} `
            + `logoUrl=${configuration.logoUrl ?? '(missing)'} `
            + `source=match-presentation side=${team}`
        );
    }

    private applyTexture(
        resource: FuturebolLogoTextureResource,
        texture: BaseTexture
    ): void {
        resource.material.diffuseTexture = texture;
        resource.material.opacityTexture = texture;
        resource.material.emissiveTexture = texture;
    }

    private logOnce(key: string, level: 'info' | 'warn', message: string): void {
        if (loggedLogoResults.has(key))
            return;

        loggedLogoResults.add(key);
        if (level === 'info')
            console.info(message);
        else
            console.warn(message);
    }

    private toDiagnostic(
        resource: FuturebolLogoTextureResource
    ): FuturebolLogoTextureDiagnostic {
        return {
            symbol: resource.configuration.symbol,
            logoUrl: resource.configuration.logoUrl,
            loaded: resource.loaded,
            fallbackActive: resource.fallbackActive,
            error: resource.error
        };
    }
}
