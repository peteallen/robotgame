import { publicAssetUrl } from './assetUrl.js';

// Spoken announcements, generated offline via OpenRouter (openai/gpt-audio)
// and played through the game's WebAudio graph so the mute button applies.
const LINES = [
  'start_clean', 'go_charge', 'charge_done', 'go_empty', 'emptying', 'go_dock',
  'uh_oh', 'go_mop_install', 'mop_installed', 'go_mop_wash', 'washing',
  'mop_done', 'remove_pads', 'bag_full', 'clean_empty', 'dirty_full', 'thank_you',
];

// nag lines get a longer minimum gap so the robot doesn't badger the family
const ALERT_COOLDOWN = { bag_full: 17000, clean_empty: 17000, dirty_full: 17000 };

export class Voice {
  constructor(sound) {
    this.sound = sound;
    this.raw = {};      // name -> ArrayBuffer (fetched)
    this.buffers = {};  // name -> AudioBuffer (decoded once ctx exists)
    this.speaking = false;
    this.lastSaid = {};
    this.load();
  }

  async load() {
    await Promise.all(LINES.map(async (name) => {
      try {
        const res = await fetch(publicAssetUrl(`assets/voice/${name}.wav`));
        if (res.ok) this.raw[name] = await res.arrayBuffer();
      } catch (e) { /* voice pack missing — beeps only, still fine */ }
    }));
  }

  say(name, { force = false, cooldown = 4000 } = {}) {
    const s = this.sound;
    if (!s.ctx || s.muted) return;
    if (this.speaking && !force) return;
    const now = performance.now();
    const minGap = Math.max(cooldown, ALERT_COOLDOWN[name] ?? 0);
    if (this.lastSaid[name] && now - this.lastSaid[name] < minGap) return;
    const play = (buf) => {
      this.lastSaid[name] = now;
      this.speaking = true;
      const src = s.ctx.createBufferSource();
      src.buffer = buf;
      const g = s.ctx.createGain();
      g.gain.value = 0.95;
      src.connect(g);
      g.connect(s.master);
      src.onended = () => { this.speaking = false; };
      src.start();
      // safety: never wedge the speaking flag
      setTimeout(() => { this.speaking = false; }, buf.duration * 1000 + 300);
    };
    if (this.buffers[name]) {
      play(this.buffers[name]);
    } else if (this.raw[name]) {
      s.ctx.decodeAudioData(this.raw[name].slice(0)).then((buf) => {
        this.buffers[name] = buf;
        play(buf);
      }).catch(() => {});
    }
  }
}
