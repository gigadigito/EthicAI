export function isProceduralPlaybackDuplicate(signature, previousSignature, previousAt, now = Date.now(), cooldownMs = 1200) {
    if (!signature) {
        return false;
    }

    return signature === previousSignature && now - previousAt < cooldownMs;
}
