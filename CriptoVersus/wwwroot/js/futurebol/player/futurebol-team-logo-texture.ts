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

export class FuturebolTeamLogoTextureProvider {
    private readonly resources: Record<FuturebolTeam, FuturebolLogoTextureResource>;
    private disposed = false;

    public constructor(
        private readonly B: BabylonApi,
        private readonly scene: Scene,
        teams: FuturebolTeamVisualConfigurationMap,
        private readonly development: boolean
    ) {
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
        return Promise.all([
            this.resources.home.ready,
            this.resources.away.ready
        ]).then(() => undefined);
    }

    public reconfigure(teams: FuturebolTeamVisualConfigurationMap): Promise<void> {
        if (this.disposed)
            return Promise.resolve();

        return Promise.all([
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
            configuration,
            material,
            texture: null,
            ready: Promise.resolve(),
            generation: 0,
            loaded: false,
            fallbackActive: false,
            error: null
        };

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
        resource.material.diffuseTexture = null;
        resource.material.opacityTexture = null;
        resource.material.emissiveTexture = null;
        resource.texture?.dispose();
        resource.texture = null;
        resource.loaded = false;
        resource.fallbackActive = false;
        resource.error = null;
        resource.ready = this.loadResource(resource);
        return resource.ready;
    }

    private async loadResource(resource: FuturebolLogoTextureResource): Promise<void> {
        const configuration = resource.configuration;
        const generation = resource.generation;
        if (!configuration.logoUrl) {
            this.activateFallback(resource, null, generation);
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

            resource.texture = texture;
            resource.loaded = true;
            resource.fallbackActive = false;
            resource.error = null;
            this.applyTexture(resource, texture);
            this.logOnce(
                `loaded:${configuration.symbol}:${configuration.logoUrl}`,
                'info',
                `[Futurebol] Logo ${configuration.symbol} carregado`
            );
        } catch (error) {
            const detail = error instanceof Error
                ? error.message
                : 'Falha ao carregar a imagem do logo.';
            this.activateFallback(resource, detail, generation);
        } finally {
            decoded?.dispose();
        }
    }

    private async fetchLogo(url: string): Promise<FuturebolDecodedLogo> {
        const response = await fetch(url, {
            cache: 'force-cache',
            credentials: 'same-origin',
            mode: 'cors'
        });
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
        generation = resource.generation
    ): void {
        if (this.disposed || resource.generation !== generation || resource.fallbackActive)
            return;

        const failedTexture = resource.texture;
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
        resource.loaded = false;
        resource.fallbackActive = true;
        resource.error = error;
        this.applyTexture(resource, fallback);
        failedTexture?.dispose();

        if (error) {
            this.logOnce(
                `error:${resource.configuration.symbol}:${resource.configuration.logoUrl}`,
                'warn',
                `[Futurebol] Logo ${resource.configuration.symbol} falhou: ${error}`
            );
        }
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
        if (!this.development || loggedLogoResults.has(key))
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
