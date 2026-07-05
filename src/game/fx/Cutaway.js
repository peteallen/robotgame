// The "maintenance cam": a big cutaway panel showing the robot's UNDERSIDE
// while mop pads are installed, removed, or washed at the dock. Pure theater —
// zoomy, clicky, sudsy.
import { TAU, rand, clamp, lerp, easeOutBack, easeInCubic } from '../core/math.js';
import { roundRect } from '../world/Room.js';

const DUR = { install: 3.0, remove: 2.6, wash: 4.6 };
// pad mounts on the underside sprite (fractions of sprite half-size)
const MOUNTS = [
  { x: -0.4, y: 0.46 },
  { x: 0.4, y: 0.46 },
];

export class Cutaway {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.suds = [];
    this.drops = [];
  }

  get running() {
    return !!this.active;
  }

  show(mode) {
    this.active = { mode, t: 0, dur: DUR[mode], clicked: [false, false], sprayT: 0, scrubT: 0 };
    this.suds = [];
    this.drops = [];
    this.game.sound.mechWhirr(0.7);
  }

  get done() {
    return !this.active || this.active.t >= this.active.dur;
  }

  dismiss() {
    this.active = null;
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const g = this.game;
    if (a.mode === 'install' || a.mode === 'remove') {
      // click moments per pad
      const clickAt = a.mode === 'install' ? [0.55, 0.72] : [0.35, 0.52];
      clickAt.forEach((frac, i) => {
        if (!a.clicked[i] && a.t / a.dur >= frac) {
          a.clicked[i] = true;
          g.sound.padClick();
        }
      });
    }
    if (a.mode === 'wash') {
      const phase = a.t / a.dur;
      a.sprayT -= dt;
      if (a.sprayT <= 0 && phase < 0.75) {
        a.sprayT = 0.45;
        g.sound.sprayHiss(0.35);
      }
      a.scrubT -= dt;
      if (a.scrubT <= 0 && phase > 0.15 && phase < 0.85) {
        a.scrubT = 0.3;
        g.sound.scrubStroke();
      }
      // suds accumulate then rinse away
      if (phase > 0.1 && phase < 0.7 && Math.random() < 0.5) {
        this.suds.push({
          x: rand(-1, 1), y: rand(0.25, 0.85), r: rand(8, 22),
          born: a.t, life: rand(0.8, 1.6), drift: rand(-14, 14),
        });
      }
      if (Math.random() < 0.4) {
        this.drops.push({ x: rand(-0.8, 0.8), y: rand(0.4, 0.9), vy: rand(120, 260), vx: rand(-60, 60), born: a.t });
      }
    }
    if (a.t >= a.dur + 0.35) this.active = null; // linger a beat, then pop away
  }

  draw(ctx) {
    const a = this.active;
    if (!a) return;
    const g = this.game;
    const t = a.t;
    // pop in / out
    const inT = clamp(t / 0.3, 0, 1);
    const outT = clamp((t - a.dur) / 0.3, 0, 1);
    const scale = easeOutBack(inT) * (1 - easeInCubic(outT));
    if (scale <= 0.01) return;

    // dim the world
    ctx.fillStyle = `rgba(20, 14, 36, ${0.42 * scale})`;
    ctx.fillRect(0, 0, 1680, 1050);

    const cx = 840;
    const cy = 495;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // panel
    const PW = 740;
    const PH = 520;
    ctx.fillStyle = 'rgba(30, 36, 54, 0.97)';
    ctx.strokeStyle = 'rgba(255, 252, 245, 0.95)';
    ctx.lineWidth = 8;
    roundRect(ctx, -PW / 2, -PH / 2, PW, PH, 34);
    ctx.fill();
    ctx.stroke();
    // little "camera" corner dots
    ctx.fillStyle = 'rgba(120, 200, 255, 0.7)';
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.arc(dx * (PW / 2 - 30), dy * (PH / 2 - 30), 6, 0, TAU);
      ctx.fill();
    }

    // soft spotlight so the navy underside pops off the dark panel
    const spot = ctx.createRadialGradient(0, 0, 60, 0, 0, 300);
    spot.addColorStop(0, 'rgba(150, 190, 235, 0.34)');
    spot.addColorStop(1, 'rgba(150, 190, 235, 0)');
    ctx.fillStyle = spot;
    ctx.beginPath();
    ctx.arc(0, 0, 300, 0, TAU);
    ctx.fill();

    // the underside (wobble transform balanced by the restore below)
    const img = g.assets.get('underside');
    const S = 420;
    ctx.save();
    ctx.rotate(Math.sin(t * 2.2) * 0.015);
    if (img) {
      ctx.drawImage(img, -S / 2, -S / 2, S, S);
    } else {
      // procedural fallback underside
      ctx.fillStyle = '#5eead4';
      ctx.beginPath();
      ctx.arc(0, 0, S / 2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1f2734';
      ctx.beginPath();
      ctx.arc(0, 0, S / 2 - 16, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0d1118';
      roundRect(ctx, -S * 0.32, -S * 0.06, S * 0.14, S * 0.34, 14);
      ctx.fill();
      roundRect(ctx, S * 0.18, -S * 0.06, S * 0.14, S * 0.34, 14);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, S * 0.09, 0, TAU);
      ctx.fill();
    }

    // pads (install slide-in / remove slide-out / wash spin)
    const padImg = g.assets.get('mop_pads');
    const phase = clamp(t / a.dur, 0, 1);
    MOUNTS.forEach((m, i) => {
      const mx = m.x * (S / 2);
      const my = m.y * (S / 2);
      let px = mx;
      let py = my;
      let alpha = 1;
      let squash = 1;
      let spin = 0;
      if (a.mode === 'install') {
        const start = i === 0 ? 0.12 : 0.3;
        const end = i === 0 ? 0.55 : 0.72;
        const k = clamp((phase - start) / (end - start), 0, 1);
        if (k <= 0) return;
        const from = (i === 0 ? -1 : 1) * (PW / 2 + 80);
        px = lerp(from, mx, easeOutBack(Math.min(1, k * 1.02)));
        if (a.clicked[i] && phase - (i === 0 ? 0.55 : 0.72) < 0.12) squash = 1.18;
      } else if (a.mode === 'remove') {
        const start = i === 0 ? 0.35 : 0.52;
        const k = clamp((phase - start) / 0.3, 0, 1);
        const to = (i === 0 ? -1 : 1) * (PW / 2 + 80);
        px = lerp(mx, to, easeInCubic(k));
        alpha = 1 - k * 0.3;
      } else if (a.mode === 'wash') {
        spin = t * (phase < 0.8 ? 9 : 3);
      }
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(spin);
      ctx.scale(squash, squash);
      ctx.globalAlpha = alpha;
      const PS = S * 0.34;
      // dirt tint on the pads: dirty at wash start, clean by the end
      const dirt = a.mode === 'wash' ? clamp(this.startDirt() * (1 - phase * 1.25), 0, 1) : (a.mode === 'remove' ? this.startDirt() : 0);
      if (padImg) {
        ctx.drawImage(padImg, -PS / 2, -PS / 2, PS, PS);
      } else {
        ctx.fillStyle = '#f4f8ff';
        ctx.beginPath();
        ctx.arc(0, 0, PS / 2, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#7cc4f8';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
      if (dirt > 0.05) {
        ctx.globalAlpha = alpha * dirt * 0.55;
        ctx.fillStyle = '#7a5a38';
        ctx.beginPath();
        ctx.arc(0, 0, PS / 2 - 3, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    // wash extras: spray jets, suds, flying drops
    if (a.mode === 'wash' && phase < 0.8) {
      ctx.strokeStyle = 'rgba(130, 205, 255, 0.85)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      for (const m of MOUNTS) {
        const mx = m.x * (S / 2);
        const jx = mx + Math.sin(t * 22 + mx) * 8;
        ctx.beginPath();
        ctx.moveTo(jx - 14, PH / 2 - 14);
        ctx.lineTo(mx - 6, m.y * (S / 2) + 26);
        ctx.moveTo(jx + 14, PH / 2 - 14);
        ctx.lineTo(mx + 6, m.y * (S / 2) + 26);
        ctx.stroke();
      }
    }
    for (const s of this.suds) {
      const age = t - s.born;
      if (age > s.life) continue;
      const k = age / s.life;
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.fillStyle = '#eaf6ff';
      ctx.beginPath();
      ctx.arc(s.x * (S / 2) + s.drift * age, s.y * (S / 2) - age * 26, s.r * (1 + k * 0.4), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x * (S / 2) + s.drift * age - s.r * 0.3, s.y * (S / 2) - age * 26 - s.r * 0.3, s.r * 0.3, 0, TAU);
      ctx.fill();
    }
    for (const d of this.drops) {
      const age = t - d.born;
      if (age > 0.6) continue;
      ctx.globalAlpha = 1 - age / 0.6;
      ctx.fillStyle = 'rgba(140, 205, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(d.x * (S / 2) + d.vx * age, d.y * (S / 2) + d.vy * age, 4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore(); // underside wobble
    ctx.restore(); // panel transform
  }

  // how dirty the pads look when a wash starts (captured lazily)
  startDirt() {
    if (this.active && this.active._dirt == null) {
      this.active._dirt = clamp(this.game.mopDirt ?? 0, 0, 1);
    }
    return this.active?._dirt ?? 0;
  }
}
