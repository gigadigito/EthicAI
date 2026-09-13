import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cvPush.js');
const script = fs.readFileSync(scriptPath, 'utf8');

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; }
    };
}

function createHarness({ apiBase = 'https://api.example.test/', fetchHandler }) {
    const calls = [];
    const storage = new Map();
    const subscription = {
        endpoint: 'https://push.example.test/subscription',
        toJSON() {
            return {
                endpoint: this.endpoint,
                keys: { p256dh: 'public-key', auth: 'auth-key' }
            };
        },
        async unsubscribe() { return true; }
    };
    let currentSubscription = null;
    const registration = {
        installing: null,
        pushManager: {
            async getSubscription() { return currentSubscription; },
            async subscribe(options) {
                assert.equal(options.userVisibleOnly, true);
                assert.ok(options.applicationServerKey instanceof Uint8Array);
                currentSubscription = subscription;
                return subscription;
            }
        }
    };

    const context = vm.createContext({
        Uint8Array,
        Number,
        Math,
        Date,
        encodeURIComponent,
        document: {
            querySelector(selector) {
                assert.equal(selector, 'meta[name="cv-api-base-url"]');
                return apiBase === null ? null : { content: apiBase };
            }
        },
        navigator: {
            serviceWorker: {
                async register(url) {
                    assert.equal(url, '/js/sw-push.js');
                    return registration;
                }
            }
        },
        PushManager: function PushManager() {},
        Notification: {
            permission: 'granted',
            async requestPermission() { return 'granted'; }
        },
        localStorage: {
            getItem(key) { return storage.get(key) ?? null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        window: {
            PushManager: function PushManager() {},
            Notification: {},
            atob(value) { return Buffer.from(value, 'base64').toString('binary'); }
        },
        console: { warn() {}, error() {} },
        async fetch(url, options = {}) {
            calls.push({ url, options });
            return fetchHandler(url, options, calls);
        }
    });

    vm.runInContext(script, context, { filename: scriptPath });
    return { CvPush: context.CvPush, calls, storage };
}

{
    const harness = createHarness({
        fetchHandler(url, options) {
            if (url.endsWith('/push/vapid-public-key')) {
                return response(200, { publicKey: 'AQIDBA' });
            }
            if (url.endsWith('/push/subscribe')) {
                const payload = JSON.parse(options.body);
                assert.deepEqual(Object.keys(payload).sort(), ['auth', 'clientId', 'endpoint', 'p256dh']);
                return response(200, { success: true, subscriptionId: 17 });
            }
            if (url.endsWith('/matches/123/alerts')) {
                assert.deepEqual(JSON.parse(options.body), {
                    pushSubscriptionId: 17,
                    notifyScore: true,
                    notifyComeback: false,
                    notifyFinished: true,
                    culture: 'pt-BR'
                });
                return response(200, { success: true, alertSubscriptionId: 31 });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    const result = await harness.CvPush.subscribeMatchAlert(123, {
        notifyScore: true,
        notifyComeback: false,
        notifyFinished: true,
        culture: 'pt-BR'
    });

    assert.equal(result.success, true);
    assert.deepEqual(harness.calls.map(call => call.url), [
        'https://api.example.test/api/push/vapid-public-key',
        'https://api.example.test/api/push/subscribe',
        'https://api.example.test/api/matches/123/alerts'
    ]);
}

{
    const harness = createHarness({
        fetchHandler() { return response(404, { error: 'not found' }); }
    });
    const result = await harness.CvPush.getMatchAlertStatus(123);
    assert.equal(result.hasActiveSubscription, false);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].url, 'https://api.example.test/api/push/lookup?clientId=' + encodeURIComponent(harness.storage.get('cv_push_client_id')));
    assert.equal(harness.calls[0].options.method, undefined);
}

{
    const harness = createHarness({
        fetchHandler(url) {
            assert.equal(url, '/api/push/lookup?clientId=' + encodeURIComponent(harness.storage.get('cv_push_client_id')));
            return response(404, {});
        },
        apiBase: null
    });
    await harness.CvPush.getMatchAlertStatus(123);
}

{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(404, {});
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    const result = await harness.CvPush.subscribeMatchAlert(123, {});
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'vapid_fetch_failed');
    assert.equal(result.httpStatus, 404);
}

{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 'invalid' });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    const result = await harness.CvPush.subscribeMatchAlert(123, {});
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'browser_registration_invalid_response');
}

console.log('cvPush contract tests passed');

// --- A: cvPush exports version and capabilities ---
{
    const harness = createHarness({
        fetchHandler() { return response(404, {}); }
    });
    assert.ok(typeof harness.CvPush.version === 'string' && harness.CvPush.version.length > 0, 'version must be a non-empty string');
    assert.ok(typeof harness.CvPush.capabilities === 'object', 'capabilities must be an object');
    assert.equal(harness.CvPush.capabilities.assetAlerts, true, 'capabilities.assetAlerts must be true');
    assert.equal(harness.CvPush.capabilities.matchAlerts, true, 'capabilities.matchAlerts must be true');
}

// --- B: getCapabilities returns version + capabilities ---
{
    const harness = createHarness({
        fetchHandler() { return response(404, {}); }
    });
    const caps = harness.CvPush.getCapabilities();
    assert.equal(caps.version, harness.CvPush.version);
    assert.deepEqual(caps.capabilities, harness.CvPush.capabilities);
}

// --- C: subscribeAssetAlert preserves error/errorCode/httpStatus from API ---
{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 42 });
            if (url.endsWith('/assets/5/alerts')) {
                return response(404, { success: false, error: 'Push subscription not found or inactive.', errorCode: 'push_subscription_inactive' });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    const result = await harness.CvPush.subscribeAssetAlert(5, { culture: 'en' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Push subscription not found or inactive.');
    assert.equal(result.errorCode, 'push_subscription_inactive');
    assert.equal(result.httpStatus, 404);
}

// --- D: unsubscribeAssetAlert preserves error/errorCode/httpStatus ---
{
    const harness = createHarness({
        fetchHandler(url, options) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 42 });
            if (url.includes('/assets/5/alerts') && options && options.method === 'DELETE') {
                return response(404, { success: false, error: 'No active subscription found.', errorCode: 'asset_not_found' });
            }
            if (url.includes('/assets/5/alerts')) {
                return response(200, { currencyId: 5, hasActiveSubscription: false });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    harness.storage.set('cv_push_subscription_id', '42');
    const result = await harness.CvPush.unsubscribeAssetAlert(5);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'asset_not_found');
    assert.equal(result.httpStatus, 404);
}

// --- E: getAssetAlertStatus is READ-ONLY (no permission request, no push subscription creation) ---
{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.includes('/assets/5/alerts')) {
                return response(200, { currencyId: 5, hasActiveSubscription: false });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    harness.storage.set('cv_push_subscription_id', '42');
    const result = await harness.CvPush.getAssetAlertStatus(5);
    assert.equal(result.hasActiveSubscription, false);
    // getAssetAlertStatus should NOT call /push/subscribe or /push/vapid-public-key
    const hasSubscriptionCall = harness.calls.some(c => c.url.includes('/push/subscribe'));
    const hasVapidCall = harness.calls.some(c => c.url.includes('/push/vapid-public-key'));
    assert.equal(hasSubscriptionCall, false, 'getAssetAlertStatus must not create push subscription');
    assert.equal(hasVapidCall, false, 'getAssetAlertStatus must not fetch VAPID key');
}

// --- F: subscribeAssetAlert success flow ---
{
    const harness = createHarness({
        fetchHandler(url, options) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 42 });
            if (url.endsWith('/assets/7/alerts')) {
                const body = JSON.parse(options.body);
                assert.equal(body.pushSubscriptionId, 42);
                assert.equal(body.culture, 'pt-BR');
                return response(200, { success: true, alertSubscriptionId: 99, active: true });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    const result = await harness.CvPush.subscribeAssetAlert(7, { culture: 'pt-BR' });
    assert.equal(result.success, true);
    assert.equal(result.alertSubscriptionId, 99);
}

// --- G: getAssetAlertStatus with active subscription ---
{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.includes('/assets/12/alerts')) {
                return response(200, { currencyId: 12, hasActiveSubscription: true, symbol: 'LSK', assetAlertSubscriptionId: 55 });
            }
            throw new Error(`Unexpected URL: ${url}`);
        }
    });
    harness.storage.set('cv_push_subscription_id', '42');
    const result = await harness.CvPush.getAssetAlertStatus(12);
    assert.equal(result.hasActiveSubscription, true);
    assert.equal(result.assetAlertSubscriptionId, 55);
}

console.log('cvPush asset-alert tests passed');
