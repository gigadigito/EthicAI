self.addEventListener('push', function (event) {
    if (!event.data) return;

    var payload;
    try {
        payload = event.data.json();
    } catch (e) {
        payload = { title: 'CriptoVersus', body: event.data.text() };
    }

    var title = payload.title || 'CriptoVersus';
    var options = {
        body: payload.body || '',
        icon: payload.icon || '/android-chrome-192x192.png',
        badge: payload.badge || '/android-chrome-192x192.png',
        tag: payload.tag || 'cv-notification',
        renotify: true,
        data: {
            url: payload.url || '/',
            matchId: payload.matchId,
            alertType: payload.alertType,
            cv_source: 'push'
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    var url = '/';
    if (event.notification.data && event.notification.data.url) {
        url = event.notification.data.url;
    }

    if (url.indexOf('cv_source=') === -1) {
        url += (url.indexOf('?') === -1 ? '?' : '&') + 'cv_source=push';
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
                    client.navigate(url);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
