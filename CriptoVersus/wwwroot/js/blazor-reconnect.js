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

    function syncReloadTimer(modal) {
        if (!modal) {
            clearReloadTimer();
            return;
        }

        if (isDisconnected(modal)) {
            if (reloadTimerId === null) {
                reloadTimerId = window.setTimeout(() => {
                    reloadTimerId = null;
                    window.location.reload();
                }, 30000);
            }

            return;
        }

        clearReloadTimer();
    }

    function initializeReconnectModal() {
        const modal = document.getElementById("components-reconnect-modal");
        if (!modal) {
            return false;
        }

        const observer = new MutationObserver(() => syncReloadTimer(modal));
        observer.observe(modal, {
            attributes: true,
            attributeFilter: ["class"]
        });

        syncReloadTimer(modal);
        window.addEventListener("beforeunload", clearReloadTimer);
        return true;
    }

    if (!initializeReconnectModal()) {
        const rootObserver = new MutationObserver(() => {
            if (initializeReconnectModal()) {
                rootObserver.disconnect();
            }
        });

        rootObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
})();
