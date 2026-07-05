// All game audio is synthesized live with WebAudio — perfect for robot beeps,
// vacuum hums and toddler-friendly squeaks. No audio files needed.
import { rand, pick, clamp, chance } from './math.js';

const chanceHelper = () => chance(0.5);

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    try {
      this.muted = localStorage.getItem('robo_muted') === '1';
    } catch (e) {
      this.muted = false; // storage blocked (private mode) — default to sound on
    }
    this.humNodes = null;
    this.discoNodes = null;
    this._discoTimer = null;
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    // Gentle limiter so stacked effects never clip harshly.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('robo_muted', this.muted ? '1' : '0');
    } catch (e) { /* storage blocked — mute still applies this session */ }
    if (this.master) {
      this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime + 0.1);
    }
    return this.muted;
  }

  get ready() {
    return !!this.ctx;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---- primitives -------------------------------------------------------

  tone({ freq = 440, end = null, dur = 0.15, type = 'sine', vol = 0.3, attack = 0.005, delay = 0, curve = 'exp' }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end != null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(end, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.3, vol = 0.3, delay = 0, from = 800, to = 300, q = 1, type = 'bandpass', attack = 0.01 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(from, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(to, 40), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---- robot voice ------------------------------------------------------

  // Cheerful R2D2-ish chirp sequence.
  happyBeeps(n = 4) {
    if (!this.ctx) return;
    const base = pick([620, 700, 780]);
    for (let i = 0; i < n; i++) {
      const f = base * pick([1, 1.25, 1.5, 1.66, 2]);
      this.tone({ freq: f, end: f * pick([1.2, 0.8, 1.5]), dur: 0.09, type: 'square', vol: 0.12, delay: i * 0.11 });
    }
  }

  ackBeep() {
    this.tone({ freq: 880, dur: 0.07, type: 'square', vol: 0.1 });
    this.tone({ freq: 1320, dur: 0.09, type: 'square', vol: 0.1, delay: 0.08 });
  }

  sleepyBeep() {
    this.tone({ freq: 520, end: 340, dur: 0.35, type: 'triangle', vol: 0.16 });
    this.tone({ freq: 390, end: 250, dur: 0.45, type: 'triangle', vol: 0.14, delay: 0.4 });
  }

  questionBeep() {
    this.tone({ freq: 500, end: 900, dur: 0.18, type: 'square', vol: 0.1 });
  }

  // ---- gameplay sounds ---------------------------------------------------

  suckPop() {
    // quick inward slurp + pop
    this.noise({ dur: 0.12, vol: 0.25, from: 400, to: 2400, q: 2 });
    this.tone({ freq: rand(500, 700), end: rand(900, 1300), dur: 0.08, type: 'sine', vol: 0.22, delay: 0.05 });
  }

  bigSuck() {
    this.noise({ dur: 0.4, vol: 0.35, from: 300, to: 3000, q: 1.5 });
    this.tone({ freq: 300, end: 1200, dur: 0.35, type: 'sawtooth', vol: 0.08 });
  }

  sparklePickup() {
    const base = pick([880, 990, 1100]);
    [0, 4, 7, 12].forEach((st, i) => {
      this.tone({ freq: base * Math.pow(2, st / 12), dur: 0.12, type: 'sine', vol: 0.12, delay: i * 0.05 });
    });
  }

  bump() {
    this.tone({ freq: 140, end: 90, dur: 0.1, type: 'sine', vol: 0.3 });
    this.noise({ dur: 0.06, vol: 0.1, from: 500, to: 200 });
  }

  squeak() {
    const f = rand(900, 1400);
    this.tone({ freq: f, end: f * 1.6, dur: 0.09, type: 'sine', vol: 0.18 });
    this.tone({ freq: f * 1.6, end: f * 0.9, dur: 0.1, type: 'sine', vol: 0.15, delay: 0.09 });
  }

  boing() {
    this.tone({ freq: 220, end: 520, dur: 0.18, type: 'triangle', vol: 0.25 });
    this.tone({ freq: 520, end: 320, dur: 0.22, type: 'triangle', vol: 0.18, delay: 0.16 });
  }

  pop() {
    this.tone({ freq: rand(600, 900), end: rand(1200, 1600), dur: 0.05, type: 'sine', vol: 0.2 });
  }

  bubblePop() {
    this.tone({ freq: rand(700, 1000), end: rand(1400, 2000), dur: 0.06, type: 'sine', vol: 0.22 });
    this.noise({ dur: 0.05, vol: 0.08, from: 2000, to: 3000 });
  }

  whoosh() {
    this.noise({ dur: 0.5, vol: 0.3, from: 300, to: 1800, q: 0.8 });
  }

  dockChime() {
    [523, 659, 784, 1047].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.22, type: 'sine', vol: 0.16, delay: i * 0.09 });
    });
  }

  undockChime() {
    [784, 659, 523].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.15, type: 'sine', vol: 0.13, delay: i * 0.07 });
    });
  }

  backupBeep() {
    // gentle little truck-reversing beeper
    this.tone({ freq: 940, dur: 0.14, type: 'triangle', vol: 0.13 });
  }

  snore() {
    this.noise({ dur: 0.55, vol: 0.05, from: 220, to: 90, q: 1.2, attack: 0.2 });
    this.tone({ freq: 95, end: 62, dur: 0.55, type: 'triangle', vol: 0.06, attack: 0.15 });
  }

  chargeBlip(level) {
    // rising pitch as battery fills
    const f = 500 + 500 * level;
    this.tone({ freq: f, end: f * 1.3, dur: 0.1, type: 'sine', vol: 0.12 });
  }

  fullChargeFanfare() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.15, delay: i * 0.08 });
    });
  }

  emptyRoar(dur = 2.6) {
    if (!this.ctx) return;
    // The big satisfying auto-empty WHOOOSH
    this.noise({ dur, vol: 0.5, from: 120, to: 900, q: 0.7, attack: 0.35 });
    this.noise({ dur: dur * 0.8, vol: 0.25, from: 2000, to: 500, q: 2, delay: 0.2 });
    this.tone({ freq: 70, end: 130, dur, type: 'sawtooth', vol: 0.12, attack: 0.3 });
  }

  rattle() {
    for (let i = 0; i < 6; i++) {
      this.noise({ dur: 0.04, vol: 0.12, from: rand(1000, 3000), to: rand(800, 2000), delay: i * 0.06 + rand(0, 0.02) });
    }
  }

  fireworkLaunch() {
    this.noise({ dur: 0.7, vol: 0.15, from: 400, to: 2500, q: 3 });
    this.tone({ freq: 300, end: 1400, dur: 0.7, type: 'sine', vol: 0.08 });
  }

  fireworkBurst() {
    this.noise({ dur: 0.5, vol: 0.4, from: 900, to: 150, q: 0.6 });
    const base = pick([660, 784, 880]);
    [0, 3, 7, 10].forEach((st, i) => {
      this.tone({ freq: base * Math.pow(2, st / 12), dur: 0.35, type: 'sine', vol: 0.08, delay: 0.05 + i * 0.03 });
    });
  }

  sneezeInhale(dur = 1.0) {
    this.noise({ dur, vol: 0.2, from: 300, to: 1400, q: 1.5, attack: 0.4 });
    this.tone({ freq: 300, end: 700, dur, type: 'triangle', vol: 0.07, attack: 0.3 });
  }

  sneezeBlow() {
    this.noise({ dur: 0.45, vol: 0.5, from: 1500, to: 200, q: 0.7 });
    this.tone({ freq: 500, end: 120, dur: 0.4, type: 'sawtooth', vol: 0.15 });
  }

  meow() {
    // cartoon synth-cat
    const f = rand(500, 640);
    this.tone({ freq: f * 0.7, end: f * 1.5, dur: 0.18, type: 'sawtooth', vol: 0.07, curve: 'lin' });
    this.tone({ freq: f * 1.5, end: f * 0.75, dur: 0.4, type: 'sawtooth', vol: 0.09, delay: 0.16, curve: 'lin' });
  }

  bark() {
    // cheerful cartoon "arf arf!"
    const f = rand(200, 260);
    for (const d of [0, 0.16]) {
      this.tone({ freq: f * 1.8, end: f, dur: 0.09, type: 'sawtooth', vol: 0.14, delay: d, curve: 'lin' });
      this.noise({ dur: 0.07, vol: 0.12, from: 900, to: 350, q: 1.4, delay: d });
    }
  }

  yelp() {
    this.tone({ freq: 480, end: 950, dur: 0.13, type: 'sawtooth', vol: 0.12 });
    this.noise({ dur: 0.08, vol: 0.08, from: 1200, to: 2200, delay: 0.02 });
  }

  sniff() {
    this.noise({ dur: 0.09, vol: 0.09, from: 1400, to: 2600, q: 1.6 });
    this.noise({ dur: 0.09, vol: 0.09, from: 1400, to: 2600, q: 1.6, delay: 0.14 });
  }

  strain() {
    // comedic concentration
    this.tone({ freq: 200, end: 150, dur: 0.5, type: 'sawtooth', vol: 0.05, curve: 'lin' });
    this.tone({ freq: 300, end: 340, dur: 0.5, type: 'triangle', vol: 0.05, delay: 0.55, curve: 'lin' });
  }

  plop() {
    this.tone({ freq: 320, end: 70, dur: 0.14, type: 'sine', vol: 0.3 });
    this.noise({ dur: 0.1, vol: 0.14, from: 500, to: 150, q: 1, delay: 0.03 });
    this.tone({ freq: 200, end: 60, dur: 0.1, type: 'sine', vol: 0.18, delay: 0.12 });
  }

  splat() {
    // the terrible moment
    this.noise({ dur: 0.22, vol: 0.45, from: 700, to: 140, q: 0.8 });
    this.tone({ freq: 130, end: 50, dur: 0.2, type: 'sine', vol: 0.32 });
    this.noise({ dur: 0.14, vol: 0.2, from: 300, to: 90, q: 2, delay: 0.05 });
  }

  squelch() {
    this.noise({ dur: 0.16, vol: 0.2, from: 500, to: 150, q: 1.6 });
    this.tone({ freq: 240, end: 90, dur: 0.15, type: 'sine', vol: 0.14 });
  }

  alarm() {
    // uh-oh! sensor alarm
    [0, 0.18, 0.36].forEach((d, i) => {
      this.tone({ freq: i === 2 ? 1480 : 990, dur: 0.13, type: 'square', vol: 0.12, delay: d });
    });
  }

  mopJingle() {
    [392, 494, 587, 784].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.14, delay: i * 0.09 });
    });
    this.noise({ dur: 0.3, vol: 0.08, from: 2000, to: 4000, delay: 0.36 });
  }

  squeegee() {
    const up = chanceHelper();
    this.noise({ dur: 0.3, vol: 0.1, from: up ? 500 : 1500, to: up ? 1500 : 500, q: 3 });
  }

  glug() {
    // water filling: rising bloops
    [0, 0.16, 0.34, 0.5].forEach((d, i) => {
      this.tone({ freq: 180 + i * 60, end: 320 + i * 70, dur: 0.13, type: 'sine', vol: 0.18, delay: d });
    });
    this.noise({ dur: 0.7, vol: 0.06, from: 900, to: 1600, q: 1.4 });
  }

  drainGurgle() {
    [0, 0.14, 0.3, 0.48].forEach((d, i) => {
      this.tone({ freq: 360 - i * 55, end: 200 - i * 30, dur: 0.14, type: 'sine', vol: 0.16, delay: d });
    });
    this.noise({ dur: 0.8, vol: 0.09, from: 1400, to: 300, q: 1.2 });
  }

  clunk() {
    // mop pads locking in
    this.tone({ freq: 130, end: 80, dur: 0.09, type: 'sine', vol: 0.32 });
    this.noise({ dur: 0.05, vol: 0.14, from: 700, to: 300, delay: 0.01 });
    this.tone({ freq: 900, dur: 0.05, type: 'square', vol: 0.07, delay: 0.09 });
  }

  errorBuzz() {
    for (const d of [0, 0.22]) {
      this.tone({ freq: 160, end: 140, dur: 0.16, type: 'square', vol: 0.1, delay: d, curve: 'lin' });
      this.tone({ freq: 83, dur: 0.16, type: 'sawtooth', vol: 0.09, delay: d });
    }
  }

  washSwish() {
    this.noise({ dur: 0.5, vol: 0.12, from: 500, to: 1300, q: 1.1 });
    this.noise({ dur: 0.5, vol: 0.1, from: 1300, to: 450, q: 1.1, delay: 0.45 });
  }

  mechWhirr(dur = 0.8) {
    // little servo motor working
    this.tone({ freq: 210, end: 340, dur, type: 'sawtooth', vol: 0.06, curve: 'lin' });
    this.tone({ freq: 420, end: 660, dur, type: 'square', vol: 0.03, curve: 'lin' });
    this.noise({ dur, vol: 0.04, from: 900, to: 1400, q: 2 });
  }

  padClick() {
    this.tone({ freq: 480, dur: 0.04, type: 'square', vol: 0.14 });
    this.tone({ freq: 170, end: 120, dur: 0.08, type: 'sine', vol: 0.28, delay: 0.03 });
    this.noise({ dur: 0.05, vol: 0.1, from: 1800, to: 900, delay: 0.02 });
  }

  sprayHiss(dur = 0.4) {
    this.noise({ dur, vol: 0.14, from: 3200, to: 5200, q: 0.8 });
  }

  scrubStroke() {
    const up = chanceHelper();
    this.noise({ dur: 0.22, vol: 0.14, from: up ? 700 : 1800, to: up ? 1800 : 700, q: 2.2 });
  }

  purr(dur = 1.2) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 52;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.12;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.2);
    g.gain.setValueAtTime(0.14, t0 + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur);
    lfo.stop(t0 + dur);
  }

  fanfare() {
    const notes = [523, 523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this.tone({ freq: f, dur: i === notes.length - 1 ? 0.5 : 0.14, type: 'square', vol: 0.09, delay: i * 0.13 });
      this.tone({ freq: f / 2, dur: i === notes.length - 1 ? 0.5 : 0.14, type: 'triangle', vol: 0.1, delay: i * 0.13 });
    });
  }

  tada() {
    [659, 880].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.4, type: 'triangle', vol: 0.16, delay: i * 0.16 });
      this.tone({ freq: f * 1.5, dur: 0.4, type: 'sine', vol: 0.08, delay: i * 0.16 });
    });
    this.noise({ dur: 0.3, vol: 0.1, from: 3000, to: 5000, delay: 0.3 });
  }

  jetFlame(dur = 0.4) {
    this.noise({ dur, vol: 0.2, from: 200, to: 600, q: 0.8 });
  }

  // ---- vacuum hum loop ---------------------------------------------------

  startHum() {
    if (!this.ctx || this.humNodes) return;
    const t0 = this.ctx.currentTime;
    const noiseLen = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 340;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 82;
    const oscG = this.ctx.createGain();
    oscG.gain.value = 0.35;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.1, t0 + 0.6);
    src.connect(filt);
    osc.connect(oscG);
    oscG.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0);
    osc.start(t0);
    this.humNodes = { src, osc, g, filt };
  }

  setHumIntensity(v) {
    // v in 0..1.5 (turbo)
    if (!this.humNodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.humNodes.g.gain.linearRampToValueAtTime(0.04 + 0.09 * v, t + 0.2);
    this.humNodes.filt.frequency.linearRampToValueAtTime(240 + 500 * v, t + 0.2);
    this.humNodes.osc.frequency.linearRampToValueAtTime(70 + 50 * v, t + 0.2);
  }

  stopHum() {
    if (!this.humNodes || !this.ctx) return;
    const { src, osc, g } = this.humNodes;
    const t = this.ctx.currentTime;
    g.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    src.stop(t + 0.5);
    osc.stop(t + 0.5);
    this.humNodes = null;
  }

  // ---- disco chiptune ----------------------------------------------------

  startDisco() {
    if (!this.ctx || this._discoTimer) return;
    const bassline = [110, 110, 165, 110, 131, 131, 196, 165];
    const melody = [440, 0, 523, 440, 659, 523, 0, 587, 523, 0, 440, 392, 440, 0, 330, 392];
    let step = 0;
    const stepDur = 0.14;
    const tick = () => {
      const b = bassline[step % bassline.length];
      this.tone({ freq: b, dur: 0.12, type: 'sawtooth', vol: 0.1 });
      this.tone({ freq: b / 2, dur: 0.12, type: 'square', vol: 0.06 });
      const m = melody[step % melody.length];
      if (m) this.tone({ freq: m, dur: 0.11, type: 'square', vol: 0.055 });
      if (step % 2 === 0) this.noise({ dur: 0.04, vol: 0.1, from: 6000, to: 8000 });
      if (step % 4 === 0) this.tone({ freq: 60, end: 40, dur: 0.1, type: 'sine', vol: 0.3 });
      step++;
    };
    tick();
    this._discoTimer = setInterval(tick, stepDur * 1000);
  }

  stopDisco() {
    if (this._discoTimer) {
      clearInterval(this._discoTimer);
      this._discoTimer = null;
    }
  }
}
