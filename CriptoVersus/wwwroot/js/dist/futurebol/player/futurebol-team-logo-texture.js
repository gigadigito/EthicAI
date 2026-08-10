const loggedLogoResults = new Set();
export class FuturebolTeamLogoTextureProvider {
    constructor(B, scene, teams, development) {
        this.B = B;
        this.scene = scene;
        this.development = development;
        this.disposed = false;
        this.resources = {
            home: this.createResource('home', teams.home),
            away: this.createResource('away', teams.away)
        };
    }
    material(team) {
        return this.resources[team].material;
    }
    diagnostics() {
        return {
            home: this.toDiagnostic(this.resources.home),
            away: this.toDiagnostic(this.resources.away)
        };
    }
    dispose() {
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
    createResource(team, configuration) {
        const material = new this.B.StandardMaterial(`futurebol-${team}-logo-material`, this.scene);
        material.disableLighting = true;
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        material.zOffset = -2;
        const resource = {
            configuration,
            material,
            texture: null,
            loaded: false,
            fallbackActive: false,
            error: null
        };
        if (!configuration.logoUrl) {
            this.activateFallback(resource, null);
            return resource;
        }
        try {
            const texture = new this.B.Texture(configuration.logoUrl, this.scene, false, true, this.B.Texture.TRILINEAR_SAMPLINGMODE, () => {
                if (this.disposed || resource.fallbackActive)
                    return;
                resource.loaded = true;
                resource.error = null;
                this.logOnce(`loaded:${configuration.symbol}:${configuration.logoUrl}`, 'info', `[Futurebol] Logo ${configuration.symbol} carregado`);
            }, (message, exception) => {
                const detail = message?.trim()
                    || (exception instanceof Error ? exception.message : null)
                    || 'Falha ao carregar a textura.';
                this.activateFallback(resource, detail);
            });
            if (resource.fallbackActive) {
                texture.dispose();
                return resource;
            }
            texture.hasAlpha = true;
            texture.wrapU = this.B.Texture.CLAMP_ADDRESSMODE;
            texture.wrapV = this.B.Texture.CLAMP_ADDRESSMODE;
            resource.texture = texture;
            this.applyTexture(resource, texture);
        }
        catch (error) {
            const detail = error instanceof Error
                ? error.message
                : 'Falha ao criar a textura.';
            this.activateFallback(resource, detail);
        }
        return resource;
    }
    activateFallback(resource, error) {
        if (this.disposed || resource.fallbackActive)
            return;
        const failedTexture = resource.texture;
        const fallback = new this.B.DynamicTexture(`futurebol-${resource.configuration.symbol}-logo-fallback`, { width: 512, height: 512 }, this.scene, false);
        fallback.hasAlpha = true;
        const symbol = resource.configuration.symbol;
        const fontSize = Math.max(96, Math.floor(350 / Math.max(1, symbol.length * .72)));
        fallback.drawText(symbol, null, 340, `bold ${fontSize}px Arial, sans-serif`, '#ffffff', 'transparent', true, true);
        resource.texture = fallback;
        resource.loaded = false;
        resource.fallbackActive = true;
        resource.error = error;
        this.applyTexture(resource, fallback);
        failedTexture?.dispose();
        if (error) {
            this.logOnce(`error:${resource.configuration.symbol}:${resource.configuration.logoUrl}`, 'warn', `[Futurebol] Logo ${resource.configuration.symbol} falhou: ${error}`);
        }
    }
    applyTexture(resource, texture) {
        resource.material.diffuseTexture = texture;
        resource.material.opacityTexture = texture;
        resource.material.emissiveTexture = texture;
    }
    logOnce(key, level, message) {
        if (!this.development || loggedLogoResults.has(key))
            return;
        loggedLogoResults.add(key);
        if (level === 'info')
            console.info(message);
        else
            console.warn(message);
    }
    toDiagnostic(resource) {
        return {
            symbol: resource.configuration.symbol,
            logoUrl: resource.configuration.logoUrl,
            loaded: resource.loaded,
            fallbackActive: resource.fallbackActive,
            error: resource.error
        };
    }
}
