const feeds = new Map();

function getCards(root) {
    return Array.from(root.querySelectorAll("[data-tv-event-card]"));
}

function activateCard(card) {
    card.classList.add("is-visible");
}

function ensureObserver(rootId, root) {
    const existing = feeds.get(rootId);
    if (existing?.observer) {
        return existing;
    }

    const observer = typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) {
                    continue;
                }

                activateCard(entry.target);
                observer.unobserve(entry.target);
            }
        }, {
            threshold: 0.16,
            rootMargin: "0px 0px -8% 0px"
        })
        : null;

    const state = { root, observer };
    feeds.set(rootId, state);
    return state;
}

export function initTvEventFeed(rootId = "tv-goal-event-feed") {
    const root = document.getElementById(rootId);
    if (!root) {
        return false;
    }

    ensureObserver(rootId, root);
    refreshTvEventFeed(rootId);
    return true;
}

export function refreshTvEventFeed(rootId = "tv-goal-event-feed") {
    const root = document.getElementById(rootId);
    if (!root) {
        return;
    }

    const state = ensureObserver(rootId, root);
    const cards = getCards(root);

    cards.forEach((card, index) => {
        if (!state.observer || index === 0) {
            activateCard(card);
            return;
        }

        if (!card.classList.contains("is-visible")) {
            state.observer.observe(card);
        }
    });
}

export function disposeTvEventFeed(rootId = "tv-goal-event-feed") {
    const state = feeds.get(rootId);
    if (!state) {
        return;
    }

    try {
        state.observer?.disconnect?.();
    } catch {
    }

    feeds.delete(rootId);
}
