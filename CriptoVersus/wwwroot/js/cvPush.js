var CvPush = (function () {
    var API_BASE = '/api';
    var swRegistration = null;
    var vapidPublicKey = null;
    var currentClientId = null;
    var currentSubscriptionId = null;
    var CLIENT_ID_KEY = 'cv_push_client_id';
    var SUBSCRIPTION_ID_KEY = 'cv_push_subscription_id';

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
                if (!isNaN(currentSubscriptionId)) return currentSubscriptionId;
            }
        } catch (e) { }
        return null;
    }

    function setSubscriptionId(id) {
        currentSubscriptionId = id;
        try {
            if (id) {
                localStorage.setItem(SUBSCRIPTION_ID_KEY, String(id));
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
            var data = await resp.json();
            if (data.subscriptionId) {
                setSubscriptionId(data.subscriptionId);
                return data.subscriptionId;
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

    async function init() {
        if (!isPushSupported()) return false;

        try {
            swRegistration = await navigator.serviceWorker.register('/js/sw-push.js');
            if (swRegistration.installing) {
                await new Promise(function (resolve) {
                    swRegistration.installing.addEventListener('statechange', function (e) {
                        if (e.target.state === 'activated') resolve();
                    });
                });
            }
            return true;
        } catch (e) {
            console.warn('[CvPush] Service Worker registration failed:', e);
            return false;
        }
    }

    async function fetchVapidKey() {
        if (vapidPublicKey) return vapidPublicKey;

        try {
            var resp = await fetch(API_BASE + '/push/vapid-public-key');
            if (!resp.ok) return null;
            var data = await resp.json();
            vapidPublicKey = data.publicKey;
            return vapidPublicKey;
        } catch (e) {
            console.warn('[CvPush] Failed to fetch VAPID key:', e);
            return null;
        }
    }

    async function subscribe() {
        if (!swRegistration) {
            var ok = await init();
            if (!ok) return null;
        }

        var permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;

        var key = await fetchVapidKey();
        if (!key) return null;

        try {
            var existingSubscription = await swRegistration.pushManager.getSubscription();
            if (existingSubscription) {
                await sendSubscriptionToServer(existingSubscription);
                return existingSubscription;
            }

            var subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(key)
            });

            await sendSubscriptionToServer(subscription);
            return subscription;
        } catch (e) {
            console.warn('[CvPush] Push subscription failed:', e);
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
        var payload = {
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            clientId: getClientId()
        };

        var resp = await fetch(API_BASE + '/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            console.warn('[CvPush] Server subscription save failed:', resp.status);
            return null;
        }

        var data = await resp.json();
        if (data.subscriptionId) {
            setSubscriptionId(data.subscriptionId);
        }
        return data.subscriptionId;
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
        if (!swRegistration) {
            var ok = await init();
            if (!ok) return { success: false, error: 'Service Worker not available' };
        }

        var subscription = await swRegistration.pushManager.getSubscription();
        if (!subscription) {
            var sub = await subscribe();
            if (!sub) return { success: false, error: 'Push subscription required' };
            subscription = sub;
        }

        var subscriptionId = await ensureSubscriptionId();
        if (!subscriptionId) {
            return { success: false, error: 'Push subscription not registered with server' };
        }

        var resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts', {
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

        if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            return { success: false, error: err.error || 'Failed to subscribe' };
        }

        return await resp.json();
    }

    async function unsubscribeMatchAlert(matchId) {
        var subscriptionId = await ensureSubscriptionId();
        if (!subscriptionId) return { success: false, error: 'No active subscription' };

        var resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts?pushSubscriptionId=' + subscriptionId, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!resp.ok) return { success: false, error: 'Failed to unsubscribe' };
        return await resp.json();
    }

    async function getMatchAlertStatus(matchId) {
        // Opening the settings modal is read-only: recover an existing server id,
        // but never create/register a push subscription from a status check.
        var subscriptionId = getSubscriptionId();
        if (!subscriptionId) {
            subscriptionId = await recoverSubscriptionId();
        }
        if (!subscriptionId) return { hasActiveSubscription: false };

        var resp = await fetch(API_BASE + '/matches/' + matchId + '/alerts?pushSubscriptionId=' + subscriptionId);
        if (!resp.ok) return { hasActiveSubscription: false };
        return await resp.json();
    }

    return {
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
        getMatchAlertStatus: getMatchAlertStatus
    };
})();
