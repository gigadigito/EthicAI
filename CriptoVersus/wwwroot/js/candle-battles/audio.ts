const BASE = '/games/candle-battles/assets/audio/';
export class AudioManager {
    private music?: HTMLAudioElement;
    private effects = new Set<HTMLAudioElement>();
    private last = new Map<string, number>();
    private unlocked = false;
    private preload: HTMLAudioElement[] = [];
    private fadeTimer?: ReturnType<typeof setInterval>;
    master = .65;
    musicVolume = .35;
    effectsVolume = .7;
    muted = true;
    constructor() {
        try {
            const saved = JSON.parse(localStorage.getItem('candle-battles-audio') ?? '{}');
            for (const key of ['master','musicVolume','effectsVolume'] as const)
                if (Number.isFinite(saved[key])) this[key] = Math.max(0, Math.min(1, saved[key]));
            this.muted = saved.muted !== false;
        } catch { /* Storage can be disabled by browser policy. */ }
    }
    unlock(): void {
        if(this.unlocked)return;this.unlocked=true;
        for(const name of ['score_point','data_tick','combo','dash','block_fall','sell_red','menu_select','block_lock','candle_spawn','big_win','line_complete','buy_green','candle_destroy','draw','punch_impact','pause']){
            const clip=new Audio(BASE+'sfx/sfx_'+name+'.wav');clip.preload='auto';clip.load();this.preload.push(clip);
        }
    }
    configure(master: number, music: number, effects: number, muted: boolean): void {
        this.master = Math.max(0, Math.min(1, master)); this.musicVolume = Math.max(0, Math.min(1, music));
        this.effectsVolume = Math.max(0, Math.min(1, effects)); this.muted = muted;
        if (this.music) { this.music.muted = muted; this.music.volume = this.master * this.musicVolume; }
        for (const audio of this.effects) { audio.muted = muted; audio.volume = this.master * this.effectsVolume; }
        try { localStorage.setItem('candle-battles-audio', JSON.stringify({ master, musicVolume:music, effectsVolume:effects, muted })); } catch { }
    }
    loop(name: 'menu' | 'arena'): void {
        if (!this.unlocked) return;
        const src = BASE + 'music/music_' + name + '_loop_132bpm.wav';
        if (this.music?.src.endsWith(src)) { void this.music.play().catch(() => {}); return; }
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.music?.pause();
        const audio = this.music = new Audio(src);
        audio.loop = true; audio.volume = 0; audio.muted = this.muted;
        void audio.play().catch(() => {});
        let step = 0;
        this.fadeTimer = setInterval(() => { audio.volume = this.master * this.musicVolume * Math.min(1, ++step / 12);
            if (step >= 12) { clearInterval(this.fadeTimer); this.fadeTimer = undefined; } }, 40);
    }
    play(name: string): void {
        if (!this.unlocked || this.muted || this.effects.size >= 6) return;
        const now = performance.now(), gap = name === 'data_tick' ? 900 : 80;
        if (now - (this.last.get(name) ?? -Infinity) < gap) return;
        this.last.set(name, now);
        const audio = new Audio(BASE + 'sfx/sfx_' + name + '.wav');
        audio.volume = this.master * this.effectsVolume;
        this.effects.add(audio);
        const release = () => { this.effects.delete(audio); audio.onended = audio.onerror = null; audio.removeAttribute('src'); };
        audio.onended = release; audio.onerror = release;
        void audio.play().catch(release);
    }
    pause(): void {
        this.music?.pause();
        for (const effect of this.effects) {
            effect.pause(); effect.onended = effect.onerror = null; effect.removeAttribute('src');
        }
        this.effects.clear();
    }
    dispose(): void {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.pause(); this.music?.removeAttribute('src'); this.music = undefined;
        for (const effect of this.effects) { effect.onended = effect.onerror = null; effect.removeAttribute('src'); }
        this.effects.clear(); this.last.clear();
        for(const clip of this.preload){clip.pause();clip.removeAttribute('src');}this.preload=[];
    }
}
