export function log(prefixOrEventName, eventNameOrPayload, maybePayload) {
    const hasExplicitPrefix = typeof maybePayload !== "undefined";
    const prefix = hasExplicitPrefix ? prefixOrEventName : "TV_MODE";
    const eventName = hasExplicitPrefix ? eventNameOrPayload : prefixOrEventName;
    const payload = hasExplicitPrefix ? maybePayload : eventNameOrPayload;

    if (typeof payload === "undefined") {
        console.log(`[${prefix}] ${eventName}`);
        return;
    }

    console.log(`[${prefix}] ${eventName}`, payload);
}

export async function initBroadcastAudio(elementId, volume, muted) {
    const audio = document.getElementById(elementId);
    if (!audio) {
        return;
    }

    audio.loop = true;
    audio.volume = typeof volume === "number" ? volume : 0.1;
    audio.muted = Boolean(muted);

    try {
        await audio.play();
    } catch {
        const resume = async () => {
            try {
                await audio.play();
            } catch {
            }

            document.removeEventListener("pointerdown", resume);
            document.removeEventListener("keydown", resume);
        };

        document.addEventListener("pointerdown", resume, { once: true });
        document.addEventListener("keydown", resume, { once: true });
    }
}

export function setBroadcastAudioMuted(elementId, muted, volume) {
    const audio = document.getElementById(elementId);
    if (!audio) {
        return;
    }

    audio.volume = typeof volume === "number" ? volume : audio.volume;
    audio.muted = Boolean(muted);

    if (!audio.muted) {
        audio.play().catch(() => {});
    }
}

export function playAudioCue(elementId) {
    const audio = document.getElementById(elementId);
    if (!audio) {
        return;
    }

    try {
        audio.currentTime = 0;
    } catch {
    }

    audio.play().catch(() => {});
}

if (typeof globalThis !== "undefined") {
    globalThis.initBroadcastAudio = initBroadcastAudio;
    globalThis.setBroadcastAudioMuted = setBroadcastAudioMuted;
    globalThis.playAudioCue = playAudioCue;
}
