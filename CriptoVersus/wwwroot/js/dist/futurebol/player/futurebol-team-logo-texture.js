const loggedLogoResults = new Set();
const logoTextureSize = 512;
const logoContentSize = 448;
const logoLoadTimeoutMs = 5000;
export class FuturebolTeamLogoTextureProvider {
    constructor(B, scene, teams) {
        this.B = B;
        this.scene = scene;
        this.disposed = false;
        this.logTeamSource('home', teams.home);
        this.logTeamSource('away', teams.away);
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
    ready() {
        return Promise.allSettled([
            this.resources.home.ready,
            this.resources.away.ready
        ]).then(() => undefined);
    }
    reconfigure(teams) {
        if (this.disposed)
            return Promise.resolve();
        return Promise.allSettled([
            this.reconfigureResource(this.resources.home, teams.home),
            this.reconfigureResource(this.resources.away, teams.away)
        ]).then(() => undefined);
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
    reconfigureResource(resource, configuration) {
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
    async loadResource(resource) {
        const configuration = resource.configuration;
        const generation = resource.generation;
        const started = performance.now();
        if (!configuration.logoUrl) {
            this.activateFallback(resource, "Logo URL ausente.", generation, performance.now() - started);
            return;
        }
        let decoded = null;
        try {
            decoded = await this.fetchLogo(configuration.logoUrl);
            if (this.disposed || resource.generation !== generation)
                return;
            const texture = new this.B.DynamicTexture(`futurebol-${configuration.symbol}-logo`, { width: logoTextureSize, height: logoTextureSize }, this.scene, false);
            texture.hasAlpha = true;
            const context = texture.getContext();
            context.clearRect(0, 0, logoTextureSize, logoTextureSize);
            const scale = Math.min(logoContentSize / Math.max(1, decoded.width), logoContentSize / Math.max(1, decoded.height));
            const width = Math.max(1, decoded.width * scale);
            const height = Math.max(1, decoded.height * scale);
            context.drawImage(decoded.source, (logoTextureSize - width) / 2, (logoTextureSize - height) / 2, width, height);
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
            this.logOnce(`loaded:${configuration.symbol}:${configuration.logoUrl}`, 'info', `[Futurebol][LogoTexture] team=${configuration.symbol} status=loaded `
                + `url=${configuration.logoUrl} durationMs=${Math.round(performance.now() - started)}`);
        }
        catch (error) {
            const detail = error instanceof Error
                ? error.message
                : 'Falha ao carregar a imagem do logo.';
            this.activateFallback(resource, detail, generation, performance.now() - started);
        }
        finally {
            decoded?.dispose();
        }
    }
    async fetchLogo(url) {
        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), logoLoadTimeoutMs);
        let response;
        try {
            response = await fetch(url, {
                cache: 'force-cache',
                credentials: 'same-origin',
                mode: 'cors',
                signal: controller.signal
            });
        }
        catch (error) {
            if (controller.signal.aborted)
                throw new Error(`Logo excedeu ${logoLoadTimeoutMs} ms.`);
            throw error;
        }
        finally {
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
            const loaded = new Promise((resolve, reject) => {
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
        }
        catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
        }
    }
    activateFallback(resource, error, generation = resource.generation, durationMs = 0) {
        if (this.disposed || resource.generation !== generation)
            return;
        resource.loaded = false;
        resource.fallbackActive = true;
        resource.error = error;
        if (!resource.texture) {
            try {
                const fallback = new this.B.DynamicTexture(`futurebol-${resource.configuration.symbol}-logo-fallback`, { width: 512, height: 512 }, this.scene, false);
                fallback.hasAlpha = true;
                const symbol = resource.configuration.symbol;
                const fontSize = Math.max(96, Math.floor(350 / Math.max(1, symbol.length * .72)));
                fallback.drawText(symbol, null, 340, `bold ${fontSize}px Arial, sans-serif`, '#ffffff', 'transparent', true, true);
                resource.texture = fallback;
                this.applyTexture(resource, fallback);
            }
            catch (fallbackError) {
                const fallbackDetail = fallbackError instanceof Error
                    ? fallbackError.message
                    : 'Falha ao criar ticker de fallback.';
                resource.error = error
                    ? `${error} Fallback: ${fallbackDetail}`
                    : fallbackDetail;
            }
        }
        if (error) {
            this.logOnce(`error:${resource.configuration.symbol}:${resource.configuration.logoUrl}`, 'warn', `[Futurebol][LogoTexture] team=${resource.configuration.symbol} status=failed `
                + `url=${resource.configuration.logoUrl ?? '(missing)'} `
                + `error=${resource.error ?? error} fallback=ticker `
                + `durationMs=${Math.round(durationMs)}`);
        }
    }
    logTeamSource(team, configuration) {
        console.info(`[Futurebol][TeamLogo] team=${configuration.symbol} `
            + `logoUrl=${configuration.logoUrl ?? '(missing)'} `
            + `source=match-presentation side=${team}`);
    }
    applyTexture(resource, texture) {
        resource.material.diffuseTexture = texture;
        resource.material.opacityTexture = texture;
        resource.material.emissiveTexture = texture;
    }
    logOnce(key, level, message) {
        if (loggedLogoResults.has(key))
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
