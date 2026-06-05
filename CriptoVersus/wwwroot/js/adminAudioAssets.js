export async function playAudio(element) {
    if (!element) {
        return;
    }

    await element.play();
}

export function stopAudio(element) {
    if (!element) {
        return;
    }

    element.pause();
    element.currentTime = 0;
}

export function setVolume(element, volume) {
    if (!element) {
        return;
    }

    const normalized = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    element.volume = normalized;
}
