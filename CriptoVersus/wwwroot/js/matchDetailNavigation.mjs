export function scrollToCurrentFragment(expectedId) {
    if (typeof expectedId !== "string" || expectedId.length === 0) {
        return false;
    }

    let fragment;
    try {
        fragment = decodeURIComponent(window.location.hash.slice(1));
    } catch {
        return false;
    }

    if (fragment !== expectedId) {
        return false;
    }

    const target = document.getElementById(expectedId);
    if (!target) {
        return false;
    }

    target.scrollIntoView({ behavior: "auto", block: "start" });
    return true;
}
