var CvPush = (function () {
    var API_BASE = resolveApiBase();
    var swRegistration = null;
    var vapidPublicKey = null;
    var currentClientId = null;
    var currentSubscriptionId = null;
    var lastFailure = null;
    var CLIENT_ID_KEY = 'cv_push_client_id';
    var SUBSCRIPTION_ID_KEY = 'cv_push_subscription_id';
    var MIGRATION_KEY = 'cv_push_sw_migrated';
    var LEGACY_SW_PATH = '/js/sw-push.js';

    function resolveApiBase() {
        var meta = document.querySelector('meta[name="cv-api-base-url"]');
        var configured = meta && typeof meta.content === 'string' ? meta.content.trim() : '';
        if (!configured) return '/api';

        configured = configured.replace(/\/+$/, '');
        return /\/api$/i.test(configured) ? configured : configured + '/api';
    }

    function recordFailure(code, message, httpStatus) {
        lastFailure = {
            code: code,
            message: message || code,
            httpStatus: httpStatus || null
        };
        console.error('[MATCH_ALERT] activate failed', {
            code: lastFailure.code,
            message: lastFailure.message,
            httpStatus: lastFailure.httpStatus
        });
        return null;
    }

    function failureResult(defaultCode, defaultMessage) {
        var failure = lastFailure || { code: defaultCode, message: defaultMessage, httpStatus: null };
        return {
            success: false,
            error: failure.message,
            errorCode: failure.code,
            httpStatus: failure.httpStatus
        };
    }

    async function readJsonSafely(response) {
        try {
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    function isValidSubscriptionId(value) {
        return Number.isSafeInteger(value) && value > 0;
    }

    function getClientId() {
        if (currentClientId) return currentClientId;
        try {
            var id = localStorage.getItem(CLIENT_ID_KEY);
            if (!id) {
                id = 'cv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
                localStorage.setItem(CLIENT_ID_KEY, id);
            }
            currentClientId = id;
            return id;
        } catch (e) {
            return 'cv_anon_' + Date.now();
        }
    }

    function getSubscriptionId() {
        if (currentSubscriptionId) return currentSubscriptionId;
        try {
            var id = localStorage.getItem(SUBSCRIPTION_ID_KEY);
            if (id) {
                currentSubscriptionId = parseInt(id, 10);
                if (isValidSubscriptionId(currentSubscriptionId)) return currentSubscriptionId;
                currentSubscriptionId = null;
                localStorage.removeItem(SUBSCRIPTION_ID_KEY);
            }
        } catch (e) { }
        return null;
    }

    function setSubscriptionId(id) {
        var parsedId = typeof id === 'string' ? Number(id) : id;
        currentSubscriptionId = isValidSubscriptionId(parsedId) ? parsedId : null;
        try {
            if (currentSubscriptionId) {
                localStorage.setItem(SUBSCRIPTION_ID_KEY, String(currentSubscriptionId));
            } else {
                localStorage.removeItem(SUBSCRIPTION_ID_KEY);
            }
        } catch (e) { }
    }

    async function recoverSubscriptionId() {
        var cached = getSubscriptionId();
        if (cached) return cached;

        try {
            var clientId = getClientId();
            var resp = await fetch(API_BASE + '/push/lookup?clientId=' + encodeURIComponent(clientId));
            if (!resp.ok) return null;
            var data = await readJsonSafely(resp);
            if (data && isValidSubscriptionId(Number(data.subscriptionId))) {
                setSubscriptionId(data.subscriptionId);
                return getSubscriptionId();
            }
        } catch (e) {
            console.warn('[CvPush] Failed to recover subscriptionId:', e);
        }
        return null;
    }

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var rawData = window.atob(base64);
        var outputArray = new Uint8Array(rawData.length);
        for (var i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    function isPushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    }

    function getPermissionState() {
        if (!isPushSupported()) return 'unsupported';
        return Notification.permission;
    }

    async function migrateLegacyServiceWorker() {
        try {
            if (localStorage.getItem(MIGRATION_KEY) === '1') return;
        } catch (e) { }

        if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return;

        var allUnregistered = true;
        var foundLegacy = false;

        try {
            var registrations = await navigator.serviceWorker.getRegistrations();

            for (var i = 0; i < registrations.length; i++) {
                var reg = registrations[i];
                var scriptUrl = reg.active && reg.active.scriptURL
                    ? reg.active.scriptURL
                    : (reg.installing && reg.installing.scriptURL
                        ? reg.installing.scriptURL
                        : (reg.waiting && reg.waiting.scriptURL ? reg.waiting.scriptURL : ''));

                if (!scriptUrl || !scriptUrl.endsWith(LEGACY_SW_PATH)) continue;

                if (swRegistration && scriptUrl === swRegistration.active?.scriptURL) continue;

                foundLegacy = true;
                console.warn('[CvPush] Detected legacy service worker:', scriptUrl);

                var oldSubscription = null;
                try {
                    if (reg.pushManager) {
                        oldSubscription = await reg.pushManager.getSubscription();
                    }
                } catch (e) { }

                var unregistered = false;
                try {
                    unregistered = await reg.unregister();
                } catch (e) {
                    console.warn('[CvPush] Failed to unregister legacy SW:', e);
                }

                if (!unregistered) {
                    allUnregistered = false;
                    console.warn('[CvPush] Legacy SW unregister returned false, migration pending');
                    continue;
                }

                console.warn('[CvPush] Unregistered legacy service worker');

                if (oldSubscription) {
                    try {
                        await fetch(API_BASE + '/push/subscribe', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                endpoint: oldSubscription.endpoint,
                                clientId: getClientId()
                            })
                        });
                        console.warn('[CvPush] Cleaned up legacy push subscription from API');
                    } catch (e) {
                        console.warn('[CvPush] Failed to clean up legacy subscription:', e);
                    }
                }
            }
        } catch (e) {
            console.warn('[CvPush] Legacy SW migration error:', e);
            allUnregistered = false;
        }

        if (!foundLegacy || allUnregistered) {
            setSubscriptionId(null);
            try {
                localStorage.setItem(MIGRATION_KEY, '1');
            } catch (e) { }
        }
    }

    async function init() {
        if (!isPushSupported()) {
            recordFailure('push_unsupported', 'Push notifications are not supported');
            return false;
        }

        try {
            swRegistration = await navigator.serviceWorker.register('/sw-push.js', { updateViaCache: 'none' });
            if (swRegistration.installing) {
                await new Promise(function (resolve) {
                    swRegistration.installing.addEventListener('statechange', function (e) {
                        if (e.target.state === 'activated') resolve();
                    });
                });
            }

            await migrateLegacyServiceWorker();

            return true;
        } catch (e) {
            recordFailure('service_worker_registration_failed', e && e.message ? e.message : 'Service Worker registration failed');
            return false;
        }
    }

    async function fetchVapidKey() {
        if (vapidPublicKey) return vapidPublicKey;

        try {
            var resp = await fetch(API_BASE + '/push/vapid-public-key');
            if (!resp.ok) {
                return recordFailure('vapid_fetch_failed', 'VAPID public key request failed', resp.status);
            }
            var data = await readJsonSafely(resp);
            if (!data || typeof data.publicKey !== 'string' || !data.publicKey.trim()) {
                return recordFailure('vapid_response_invalid', 'VAPID public key response is invalid', resp.status);
            }
            vapidPublicKey = data.publicKey;
            return vapidPublicKey;
        } catch (e) {
            recordFailure('vapid_fetch_failed', e && e.message ? e.message : 'Failed to fetch VAPID public key');
            return null;
        }
    }

    async function subscribe() {
        if (!swRegistration) {
            var ok = await init();
            if (!ok) return null;
        }

        var permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            return recordFailure('permission_denied', 'Notification permission was not granted');
        }

        var key = await fetchVapidKey();
        if (!key) return null;

        try {
            var existingSubscription = await swRegistration.pushManager.getSubscription();
            if (existingSubscription) {
                var existingId = await sendSubscriptionToServer(existingSubscription);
                if (!existingId) return null;
                return existingSubscription;
            }

            var subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
            });

            var subscriptionId = await sendSubscriptionToServer(subscription);
            if (!subscriptionId) return null;
            return subscription;
        } catch (e) {
            recordFailure('push_subscription_failed', e && e.message ? e.message : 'PushManager subscription failed');
            return null;
        }
    }

    async function unsubscribe() {
        if (!swRegistration) return false;

        try {
            var subscription = await swRegistration.pushManager.getSubscription();
            if (!subscription) {
                setSubscriptionId(null);
                return true;
            }

            var endpoint = subscription.endpoint;
            await subscription.unsubscribe();

            await fetch(API_BASE + '/push/subscribe', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endpoint: endpoint,
                    clientId: getClientId()
                })
            });

            setSubscriptionId(null);
            return true;
        } catch (e) {
            console.warn('[CvPush] Unsubscribe failed:', e);
            return false;
        }
    }

    async function isSubscribed() {
        if (!swRegistration) return false;

        try {
            var subscription = await swRegistration.pushManager.getSubscription();
            return subscription !== null;
        } catch (e) {
            return false;
        }
    }

    async function sendSubscriptionToServer(subscription) {
        var json = subscription.toJSON();
        if (!json || !json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) {
            return recordFailure('push_subscription_invalid', 'Browser push subscription is incomplete');
        }
        var payload = {
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            clientId: getClientId()
        };

        var resp;
        try {
            resp = await fetch(API_BASE + '/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            return recordFailure('browser_registration_failed', e && e.message ? e.message : 'Browser registration request failed');
        }

        if (!resp.ok) {
            return recordFailure('browser_registration_failed', 'Browser registration request failed', resp.status);
        }

        var data = await readJsonSafely(resp);
        var subscriptionId = data ? Number(data.subscriptionId) : NaN;
        if (!data || data.success !== true || !isValidSubscriptionId(subscriptionId)) {
            return recordFailure('browser_registration_invalid_response', 'Browser registration response is invalid', resp.status);
        }

        setSubscriptionId(subscriptionId);
        return subscriptionId;
    }

    async function ensureSubscriptionId() {
        var id = getSubscriptionId();
        if (id) return id;

        if (swRegistration) {
            var existing = await swRegistration.pushManager.getSubscription();
            if (existing) {
                await sendSubscriptionToServer(existing);
                id = getSubscriptionId();
                if (id) return id;
            }
        }

        return await recoverSubscriptionId();
    }

    async function subscribeMatchAlert(matchId, options) {
        lastFailure = null;
        if (!Number.isInteger(matchId) || matchId <= 0) {
            recordFailure('invalid_match_id', 'Match id is invalid');
            return failureResult('invalid_match_id', 'Match id is invalid');
        }

        if (!swRegistration) {
            var ok = await init();
            if (!ok) return failureResult('service_worker_registration_failed', 'Service Worker not available');
        }

        try {
            var subscription = await swRegistration.pushManager.getSubscription();
            if (!subscription) {
                var sub = await subscribe();
                if (!sub) return failureResult('push_subscription_failed', 'Push subscription required');
                subscription = sub;
            }
        } catch (e) {
            recordFailure('push_subscription_failed', e && e.message ? e.message : 'Unable to read browser push subscription');
            return failureResult('push_subscription_failed', 'Unable to read browser push subscription');
        }

        var subscriptionId = await ensureSubscriptionId();
        if (!isValidSubscriptionId(subscriptionId)) {
            if (!lastFailure) {
                recordFailure('browser_registration_invalid_response', 'Push subscription was not registered with the server');
            }
            return failureResult('browser_registration_invalid_response', 'Push subscription was not registered with the server');
        }

        var resp;
        try {
            resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pushSubscriptionId: subscriptionId,
                    notifyScore: options.notifyScore !== false,
                    notifyComeback: options.notifyComeback !== false,
                    notifyFinished: options.notifyFinished !== false,
                    culture: options.culture || 'en'
                })
            });
        } catch (e) {
            recordFailure('match_alert_save_failed', e && e.message ? e.message : 'Match alert request failed');
            return failureResult('match_alert_save_failed', 'Match alert request failed');
        }

        if (!resp.ok) {
            var err = await readJsonSafely(resp);
            recordFailure('match_alert_save_failed', err && err.error ? err.error : 'Match alert request failed', resp.status);
            return failureResult('match_alert_save_failed', 'Match alert request failed');
        }

        var result = await readJsonSafely(resp);
        if (!result || result.success !== true || !isValidSubscriptionId(Number(result.alertSubscriptionId))) {
            recordFailure('match_alert_invalid_response', 'Match alert response is invalid', resp.status);
            return failureResult('match_alert_invalid_response', 'Match alert response is invalid');
        }

        return result;
    }

    async function unsubscribeMatchAlert(matchId) {
        var subscriptionId = await ensureSubscriptionId();
        if (!subscriptionId) return { success: false, error: 'No active subscription' };

        try {
            var resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts?pushSubscriptionId=' + subscriptionId, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!resp.ok) return { success: false, error: 'Failed to unsubscribe' };
            return await readJsonSafely(resp) || { success: false, error: 'Invalid response' };
        } catch (e) {
            console.warn('[MATCH_ALERT] unsubscribe network error');
            return { success: false, error: 'Network error' };
        }
    }

    async function getMatchAlertStatus(matchId) {
        // Opening the settings modal is read-only: recover an existing server id,
        // but never create/register a push subscription from a status check.
        try {
            var subscriptionId = getSubscriptionId();
            if (!subscriptionId) {
                subscriptionId = await recoverSubscriptionId();
            }
            if (!subscriptionId) return { hasActiveSubscription: false };

            var resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts?pushSubscriptionId=' + subscriptionId);
            if (!resp.ok) return { hasActiveSubscription: false };
            return await readJsonSafely(resp) || { hasActiveSubscription: false };
        } catch (e) {
            console.warn('[MATCH_ALERT] status read failed');
            return { hasActiveSubscription: false };
        }
    }

    async function subscribeAssetAlert(currencyId, options) {
        lastFailure = null;
        if (!Number.isInteger(currencyId) || currencyId <= 0) {
            recordFailure('invalid_currency_id', 'Asset id is invalid');
            return { success: false, error: 'Asset id is invalid', errorCode: 'invalid_currency_id' };
        }

        if (!swRegistration) {
            var ok = await init();
            if (!ok) return { success: false, error: 'Service Worker not available', errorCode: 'service_worker_registration_failed' };
        }

        try {
            var subscription = await swRegistration.pushManager.getSubscription();
            if (!subscription) {
                var sub = await subscribe();
                if (!sub) return { success: false, error: 'Push subscription required', errorCode: 'push_subscription_failed' };
                subscription = sub;
            }
        } catch (e) {
            recordFailure('push_subscription_failed', e && e.message ? e.message : 'Unable to read browser push subscription');
            return { success: false, error: 'Unable to read browser push subscription', errorCode: 'push_subscription_failed' };
        }

        var subscriptionId = await ensureSubscriptionId();
        if (!isValidSubscriptionId(subscriptionId)) {
            if (!lastFailure) {
                recordFailure('browser_registration_invalid_response', 'Push subscription was not registered with the server');
            }
            return { success: false, error: 'Push subscription was not registered with the server', errorCode: 'browser_registration_invalid_response' };
        }

        var resp;
        try {
            resp = await fetch(API_BASE + '/assets/' + currencyId + '/alerts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pushSubscriptionId: subscriptionId,
                    culture: options.culture || 'en'
                })
            });
        } catch (e) {
            recordFailure('asset_alert_save_failed', e && e.message ? e.message : 'Asset alert request failed');
            return { success: false, error: 'Asset alert request failed', errorCode: 'asset_alert_save_failed' };
        }

        if (!resp.ok) {
            var errBody = await readJsonSafely(resp);
            var apiErrorCode = errBody && errBody.errorCode ? errBody.errorCode : null;
            var apiErrorMsg = errBody && errBody.error ? errBody.error : null;
            var resolvedCode = apiErrorCode || 'asset_alert_save_failed';
            recordFailure(resolvedCode, apiErrorMsg || 'Asset alert request failed', resp.status);

            if (resolvedCode === 'push_subscription_inactive') {
                var healed = await reRegisterSubscription();
                if (healed) {
                    try {
                        var retryResp = await fetch(API_BASE + '/assets/' + currencyId + '/alerts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                pushSubscriptionId: healed,
                                culture: options.culture || 'en'
                            })
                        });
                        if (retryResp.ok) {
                            var retryResult = await readJsonSafely(retryResp);
                            if (retryResult && retryResult.success === true) return retryResult;
                        }
                    } catch (e) { /* fall through */ }
                }
            }

            return { success: false, error: apiErrorMsg || 'Asset alert request failed', errorCode: resolvedCode, httpStatus: resp.status };
        }

        var result = await readJsonSafely(resp);
        if (!result || result.success !== true) {
            var resErrCode = result && result.errorCode ? result.errorCode : 'asset_alert_invalid_response';
            var resErrMsg = result && result.error ? result.error : 'Asset alert response is invalid';
            recordFailure(resErrCode, resErrMsg, resp.status);
            return { success: false, error: resErrMsg, errorCode: resErrCode, httpStatus: resp.status };
        }

        return result;
    }

    async function unsubscribeAssetAlert(currencyId) {
        var subscriptionId = await ensureSubscriptionId();
        if (!subscriptionId) return { success: false, error: 'No active subscription', errorCode: 'no_subscription' };

        try {
            var resp = await fetch(API_BASE + '/assets/' + currencyId + '/alerts?pushSubscriptionId=' + subscriptionId, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!resp.ok) {
                var errBody = await readJsonSafely(resp);
                var apiErr = errBody && errBody.errorCode ? errBody.errorCode : 'asset_unsubscribe_failed';
                var apiMsg = errBody && errBody.error ? errBody.error : 'Failed to unsubscribe';
                return { success: false, error: apiMsg, errorCode: apiErr, httpStatus: resp.status };
            }
            var data = await readJsonSafely(resp);
            return data || { success: false, error: 'Invalid response', errorCode: 'asset_unsubscribe_invalid_response' };
        } catch (e) {
            console.warn('[ASSET_ALERT] unsubscribe network error');
            return { success: false, error: 'Network error', errorCode: 'network_error' };
        }
    }

    async function getAssetAlertStatus(currencyId) {
        try {
            var subscriptionId = getSubscriptionId();
            if (!subscriptionId) {
                subscriptionId = await recoverSubscriptionId();
            }
            if (!subscriptionId) return { hasActiveSubscription: false };

            var resp = await fetch(API_BASE + '/assets/' + currencyId + '/alerts?pushSubscriptionId=' + subscriptionId);
            if (!resp.ok) return { hasActiveSubscription: false };
            return await readJsonSafely(resp) || { hasActiveSubscription: false };
        } catch (e) {
            console.warn('[ASSET_ALERT] status read failed');
            return { hasActiveSubscription: false };
        }
    }

    var version = '20260913-sw-migration';
    var capabilities = { matchAlerts: true, assetAlerts: true };

    function getCapabilities() {
        return { version: version, capabilities: capabilities };
    }

    async function reRegisterSubscription() {
        try {
            if (!swRegistration) {
                var ok = await init();
                if (!ok) return null;
            }
            var key = await fetchVapidKey();
            if (!key) return null;
            var subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
            });
            var subscriptionId = await sendSubscriptionToServer(subscription);
            if (!subscriptionId) return null;
            return getSubscriptionId();
        } catch (e) {
            recordFailure('push_subscription_failed', e && e.message ? e.message : 'Failed to re-register push subscription');
            return null;
        }
    }

    return {
        version: version,
        capabilities: capabilities,
        getCapabilities: getCapabilities,
        init: init,
        subscribe: subscribe,
        unsubscribe: unsubscribe,
        isSubscribed: isSubscribed,
        isPushSupported: isPushSupported,
        getPermissionState: getPermissionState,
        getClientId: getClientId,
        getSubscriptionId: getSubscriptionId,
        subscribeMatchAlert: subscribeMatchAlert,
        unsubscribeMatchAlert: unsubscribeMatchAlert,
        getMatchAlertStatus: getMatchAlertStatus,
        subscribeAssetAlert: subscribeAssetAlert,
        unsubscribeAssetAlert: unsubscribeAssetAlert,
        getAssetAlertStatus: getAssetAlertStatus
    };
})();
