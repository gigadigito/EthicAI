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

function createHarness({ apiBase = 'https://api.example.test/', fetchHandler, legacyRegistrations = [] }) {
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
        active: { scriptURL: '/sw-push.js' },
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

    const unregisteredUrls = [];
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
                    assert.equal(url, '/sw-push.js');
                    return registration;
                },
                async getRegistrations() {
                    return [...legacyRegistrations, registration];
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
    return { CvPush: context.CvPush, calls, storage, unregisteredUrls };
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

// --- SW Migration Tests ---

// Helper to create a mock legacy registration
function createLegacyRegistration({ scriptURL = 'https://example.test/js/sw-push.js', hasSubscription = false, unregisterResult = true, unregisterThrows = false } = {}) {
    const legacySub = hasSubscription ? {
        endpoint: 'https://legacy.push.test/old-endpoint',
        toJSON() {
            return {
                endpoint: this.endpoint,
                keys: { p256dh: 'legacy-key', auth: 'legacy-auth' }
            };
        },
        async unsubscribe() { return true; }
    } : null;

    let unregistered = false;
    return {
        active: { scriptURL },
        installing: null,
        waiting: null,
        get unregistered() { return unregistered; },
        pushManager: {
            async getSubscription() { return legacySub; }
        },
        async unregister() {
            if (unregisterThrows) throw new Error('unregister failed');
            unregistered = unregisterResult;
            return unregisterResult;
        }
    };
}

// Helper to create a third-party (non-legacy) registration
function createThirdPartyRegistration(scriptURL = 'https://example.test/sw-analytics.js') {
    let unregistered = false;
    return {
        active: { scriptURL },
        installing: null,
        waiting: null,
        get unregistered() { return unregistered; },
        pushManager: {
            async getSubscription() { return null; }
        },
        async unregister() {
            unregistered = true;
            return true;
        }
    };
}

// Test 1: New user - no legacy SW, no migration needed
{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 100 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1', 'migration flag set');
    assert.equal(harness.calls.filter(c => c.url.includes('/push/subscribe') && c.options?.method === 'DELETE').length, 0, 'no legacy cleanup API call');
    console.log('SW migration test 1 (new user) passed');
}

// Test 2: Only legacy SW - migration removes it
{
    const legacyReg = createLegacyRegistration({ hasSubscription: false });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 101 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, true, 'legacy SW was unregistered');
    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1', 'migration flag set');
    const deleteCalls = harness.calls.filter(c => c.url.includes('/push/subscribe') && c.options?.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'no DELETE call when legacy had no subscription');
    console.log('SW migration test 2 (only legacy) passed');
}

// Test 3: Only new SW - no migration needed
{
    const harness = createHarness({
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 102 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1', 'migration flag set');
    const deleteCalls = harness.calls.filter(c => c.url.includes('/push/subscribe') && c.options?.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'no cleanup needed');
    console.log('SW migration test 3 (only new SW) passed');
}

// Test 4: Legacy + new SW coexisting - migration removes legacy only
{
    const legacyReg = createLegacyRegistration({ hasSubscription: false });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 103 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, true, 'legacy SW was unregistered');
    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1');
    console.log('SW migration test 4 (legacy + new coexisting) passed');
}

// Test 5: Legacy subscription exists - migration cleans up API
{
    const legacyReg = createLegacyRegistration({ hasSubscription: true });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url, options) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe') && options?.method === 'DELETE') {
                const body = JSON.parse(options.body);
                assert.equal(body.endpoint, 'https://legacy.push.test/old-endpoint', 'legacy endpoint sent in DELETE');
                assert.ok(body.clientId, 'clientId included');
                return response(200, { success: true });
            }
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 104 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, true, 'legacy SW was unregistered');
    const deleteCalls = harness.calls.filter(c => c.url.includes('/push/subscribe') && c.options?.method === 'DELETE');
    assert.equal(deleteCalls.length, 1, 'DELETE call made for legacy subscription');
    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1');
    console.log('SW migration test 5 (legacy subscription exists) passed');
}

// Test 6: Repeated migration - flag prevents re-execution
{
    const legacyReg = createLegacyRegistration({ hasSubscription: false });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 105 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    harness.storage.set('cv_push_sw_migrated', '1');

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, false, 'legacy SW NOT unregistered (migration skipped)');
    const deleteCalls = harness.calls.filter(c => c.url.includes('/push/subscribe') && c.options?.method === 'DELETE');
    assert.equal(deleteCalls.length, 0, 'no cleanup on repeated run');
    console.log('SW migration test 6 (repeated migration) passed');
}

// Test 7: Third-party SW not removed
{
    const thirdParty = createThirdPartyRegistration('https://analytics.example.test/sw.js');
    const legacyReg = createLegacyRegistration({ hasSubscription: false });
    const harness = createHarness({
        legacyRegistrations: [thirdParty, legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 106 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(thirdParty.unregistered, false, 'third-party SW was NOT unregistered');
    assert.equal(legacyReg.unregistered, true, 'legacy SW was unregistered');
    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1');
    console.log('SW migration test 7 (third-party SW preserved) passed');
}

console.log('cvPush SW migration tests passed');

// --- SW Migration Failure Edge Cases ---

// Test 8: unregister() returns false — flag should NOT be set
{
    const legacyReg = createLegacyRegistration({ unregisterResult: false });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 200 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, false, 'unregister returned false, SW not removed');
    assert.notEqual(harness.storage.get('cv_push_sw_migrated'), '1', 'flag NOT set when unregister fails');
    console.log('SW migration test 8 (unregister returns false) passed');
}

// Test 9: unregister() throws — flag should NOT be set
{
    const legacyReg = createLegacyRegistration({ unregisterThrows: true });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 201 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, false, 'unregister threw, SW not removed');
    assert.notEqual(harness.storage.get('cv_push_sw_migrated'), '1', 'flag NOT set when unregister throws');
    console.log('SW migration test 9 (unregister throws) passed');
}

// Test 10: unregister succeeds — flag IS set
{
    const legacyReg = createLegacyRegistration({ unregisterResult: true });
    const harness = createHarness({
        legacyRegistrations: [legacyReg],
        fetchHandler(url) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 202 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(legacyReg.unregistered, true, 'unregister succeeded');
    assert.equal(harness.storage.get('cv_push_sw_migrated'), '1', 'flag IS set on success');
    console.log('SW migration test 10 (unregister succeeds) passed');
}

// Test 11: mix of success + failure — flag NOT set (partial migration pending)
{
    const failReg = createLegacyRegistration({
        scriptURL: 'https://example.test/js/sw-push.js',
        unregisterResult: false
    });
    const successReg = createLegacyRegistration({
        scriptURL: 'https://example.test/js/sw-push.js',
        hasSubscription: true,
        unregisterResult: true
    });
    const harness = createHarness({
        legacyRegistrations: [failReg, successReg],
        fetchHandler(url, options) {
            if (url.endsWith('/push/vapid-public-key')) return response(200, { publicKey: 'AQIDBA' });
            if (url.endsWith('/push/subscribe') && options?.method === 'DELETE') {
                return response(200, { success: true });
            }
            if (url.endsWith('/push/subscribe')) return response(200, { success: true, subscriptionId: 203 });
            throw new Error(`Unexpected URL: ${url}`);
        }
    });

    await harness.CvPush.init();

    assert.equal(failReg.unregistered, false, 'first legacy NOT unregistered');
    assert.equal(successReg.unregistered, true, 'second legacy unregistered');
    assert.notEqual(harness.storage.get('cv_push_sw_migrated'), '1', 'flag NOT set when any unregister fails');
    console.log('SW migration test 11 (partial failure) passed');
}

console.log('cvPush SW migration edge case tests passed');
