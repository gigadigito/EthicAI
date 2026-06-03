export function createTvAudioFacade(deps) {
    return {
        initBroadcastAudio(elementId, volume, muted) {
            return deps.initBroadcastAudio(elementId, volume, muted);
        },
        setBroadcastAudioMuted(elementId, muted, volume) {
            return deps.setBroadcastAudioMuted(elementId, muted, volume);
        },
        playAudioCue(elementId) {
            return deps.playAudioCue(elementId);
        },
        initTvAudioManager(volume, muted) {
            return deps.initTvAudioManager(volume, muted);
        },
        playTvAudioCue(key, options) {
            return deps.playTvAudioCue(key, options);
        },
        stopTvAudioCue(key) {
            return deps.stopTvAudioCue(key);
        },
        destroyBroadcastAudio(elementId) {
            return deps.destroyBroadcastAudio(elementId);
        },
        getTvAudioState() {
            return deps.getTvAudioState();
        },
        tvAudioMap: deps.tvAudioMap
    };
}
