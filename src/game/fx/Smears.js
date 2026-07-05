// Persistent floor decals for the poopocalypse: brown wheel smears stamped by
// an oblivious robot, and the sparkling clean "shine" marks the mop leaves.
import { TAU, rand, clamp } from '../core/math.js';

const MAX_SMEARS = 160;

export class Smears {
  constructor(game) {
    this.game = game;
    this.items = []; // {x, y, rot, len, w, alpha, shade}
    this.shines = []; // {x, y, age, life, rot}
  }

  get count() {
    return this.items.length;
  }

  // one wheel-track streak
  stamp(x, y, rot) {
    if (this.items.length >= MAX_SMEARS) this.items.shift();
    this.items.push({
      x: x + rand(-3, 3),
      y: y + rand(-3, 3),
      rot: rot + rand(-0.16, 0.16),
      len: rand(24, 42),
      w: rand(9, 14),
      alpha: rand(0.35, 0.55),
      shade: rand(-14, 14) | 0,
    });
  }

  // the initial squish site — a big ugly blob with spatter
  splat(x, y) {
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU);
      const d = i === 0 ? 0 : rand(10, 46);
      if (this.items.length >= MAX_SMEARS) this.items.shift();
      this.items.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        rot: rand(0, TAU),
        len: i === 0 ? rand(46, 58) : rand(14, 30),
        w: i === 0 ? rand(30, 38) : rand(8, 16),
        alpha: i === 0 ? 0.6 : rand(0.3, 0.5),
        shade: rand(-14, 14) | 0,
      });
    }
  }

  nearest(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.items) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // mop pass: remove smears within radius, leave a brief sparkle-clean shine
  wipeAt(x, y, radius) {
    let wiped = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i];
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < radius * radius) {
        this.items.splice(i, 1);
        this.shines.push({ x: s.x, y: s.y, age: 0, life: rand(1.2, 2), rot: rand(0, TAU) });
        wiped++;
      }
    }
    return wiped;
  }

  update(dt) {
    for (let i = this.shines.length - 1; i >= 0; i--) {
      const sh = this.shines[i];
      sh.age += dt;
      if (sh.age >= sh.life) this.shines.splice(i, 1);
    }
  }

  draw(ctx) {
    // the mess
    for (const s of this.items) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = `rgb(${107 + s.shade}, ${66 + s.shade}, ${38 + s.shade})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, s.len / 2, s.w / 2, 0, 0, TAU);
      ctx.fill();
      // streaky core
      ctx.globalAlpha = s.alpha * 0.7;
      ctx.fillStyle = `rgb(${88 + s.shade}, ${52 + s.shade}, ${28 + s.shade})`;
      ctx.beginPath();
      ctx.ellipse(s.len * 0.12, 0, s.len * 0.3, s.w * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // freshly mopped gleam
    for (const sh of this.shines) {
      const t = sh.age / sh.life;
      const a = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      ctx.globalAlpha = clamp(a, 0, 1) * 0.5;
      ctx.fillStyle = '#e8f7ff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 7, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(-2, -2.5); ctx.lineTo(0, -8); ctx.lineTo(2, -2.5);
      ctx.lineTo(8, 0); ctx.lineTo(2, 2.5); ctx.lineTo(0, 8); ctx.lineTo(-2, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
