(function () {
    if (window.__cvBlazorReconnectInitialized) {
        return;
    }

    window.__cvBlazorReconnectInitialized = true;

    const reconnectStates = [
        "components-reconnect-show",
        "components-reconnect-failed",
        "components-reconnect-rejected",
        "components-reconnect-retrying",
        "components-reconnect-paused"
    ];

    let reloadTimerId = null;

    function clearReloadTimer() {
        if (reloadTimerId !== null) {
            window.clearTimeout(reloadTimerId);
            reloadTimerId = null;
        }
    }

    function isDisconnected(modal) {
        return reconnectStates.some((state) => modal.classList.contains(state));
    }

    function isPublicPage() {
        var path = window.location.pathname || "";
        return path === "/"
            || /^\/(en|pt|zh)\/?$/.test(path)
            || /^\/match\//.test(path)
            || /^\/(en|pt|zh)\/(match|partida)\//.test(path)
            || /^\/tv/.test(path)
            || /^\/(en|pt|zh)\/tv/.test(path)
            || /^\/stats/.test(path)
            || /^\/(en|pt|zh)\/(stats|estatisticas)/.test(path)
            || /^\/faq/.test(path)
            || /^\/(en|pt|zh)\/faq/.test(path)
            || /^\/tokenomics/.test(path)
            || /^\/(en|pt|zh)\/(tokenomics|como-funciona)/.test(path)
            || /^\/token/.test(path)
            || /^\/(en|pt|zh)\/token/.test(path)
            || /^\/roadmap/.test(path)
            || /^\/(en|pt|zh)\/roadmap/.test(path)
            || /^\/about/.test(path)
            || /^\/(en|pt|zh)\/about/.test(path)
            || /^\/social\//.test(path);
    }

    function applyPublicPageClass() {
        if (isPublicPage() && document.body) {
            document.body.classList.add("cv-public-page");
        }
    }

    function syncReloadTimer(modal) {
        if (!modal) {
            clearReloadTimer();
            return;
        }

        if (isDisconnected(modal)) {
            if (reloadTimerId === null) {
                var timeout = isPublicPage() ? 120000 : 30000;
                reloadTimerId = window.setTimeout(function () {
                    reloadTimerId = null;
                    window.location.reload();
                }, timeout);
            }

            return;
        }

        clearReloadTimer();
    }

    function initializeReconnectModal() {
        var modal = document.getElementById("components-reconnect-modal");
        if (!modal) {
            return false;
        }

        var observer = new MutationObserver(function () { syncReloadTimer(modal); });
        observer.observe(modal, {
            attributes: true,
            attributeFilter: ["class"]
        });

        syncReloadTimer(modal);
        window.addEventListener("beforeunload", clearReloadTimer);
        return true;
    }

    if (!initializeReconnectModal()) {
        var rootObserver = new MutationObserver(function () {
            if (initializeReconnectModal()) {
                rootObserver.disconnect();
            }
        });

        rootObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    if (document.body) {
        applyPublicPageClass();
    } else {
        document.addEventListener("DOMContentLoaded", applyPublicPageClass);
    }
})();
