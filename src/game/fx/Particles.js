// One generic particle system powers confetti, dust, sparkles, bubbles,
// hearts, musical notes, flames, leaves and firework bursts.
import { TAU, rand, pick, clamp, lerp } from '../core/math.js';

const CONFETTI_COLORS = ['#ff5d8f', '#ffb42e', '#3ddad7', '#a685f5', '#7ed957', '#ff8a5c', '#4cc9f0'];

export class Particles {
  constructor() {
    this.items = [];
    this.max = 500;
  }

  add(p) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0,
      life: 1, age: 0, size: 6, rot: rand(0, TAU), vrot: 0,
      color: '#fff', kind: 'dot', wobble: rand(0, TAU), alpha: 1,
      z: 0, vz: 0, gz: 0, // pseudo-height for tossed items
      ...p,
    });
  }

  burst(x, y, kind, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(opts.speedMin ?? 40, opts.speedMax ?? 180);
      this.add({
        x, y,
        vx: Math.cos(a) * sp * (opts.spreadX ?? 1),
        vy: Math.sin(a) * sp * (opts.spreadY ?? 1),
        kind,
        life: rand(opts.lifeMin ?? 0.5, opts.lifeMax ?? 1.2),
        size: rand(opts.sizeMin ?? 4, opts.sizeMax ?? 9),
        color: opts.color ?? pick(opts.colors ?? CONFETTI_COLORS),
        vrot: rand(-6, 6),
        ay: opts.gravity ?? 0,
        ...opts.extra,
      });
    }
  }

  confettiBurst(x, y, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI, 0) * 0.9 - 0.05; // mostly upward
      const sp = rand(150, 420);
      this.add({
        x, y,
        vx: Math.cos(a) * sp * rand(0.4, 1),
        vy: Math.sin(a) * sp,
        ay: 520,
        kind: 'confetti',
        life: rand(1.2, 2.4),
        size: rand(6, 12),
        color: pick(CONFETTI_COLORS),
        vrot: rand(-9, 9),
      });
    }
  }

  dustPuff(x, y, count = 8, color = 'rgba(180,160,140,0.5)') {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      this.add({
        x: x + rand(-6, 6), y: y + rand(-6, 6),
        vx: Math.cos(a) * rand(10, 60),
        vy: Math.sin(a) * rand(10, 60) - 20,
        kind: 'puff',
        life: rand(0.4, 0.9),
        size: rand(6, 16),
        color,
      });
    }
  }

  sparkle(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      this.add({
        x: x + rand(-14, 14), y: y + rand(-14, 14),
        vx: rand(-25, 25), vy: rand(-60, -15),
        kind: 'star',
        life: rand(0.4, 0.9),
        size: rand(4, 9),
        color: pick(['#fff6c9', '#ffe066', '#fff', '#ffd6f5']),
        vrot: rand(-3, 3),
      });
    }
  }

  hearts(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      this.add({
        x: x + rand(-20, 20), y: y + rand(-10, 5),
        vx: rand(-20, 20), vy: rand(-90, -50),
        kind: 'heart',
        life: rand(0.9, 1.5),
        size: rand(8, 16),
        color: pick(['#ff5d8f', '#ff8fab', '#ff477e']),
      });
    }
  }

  notes(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      this.add({
        x: x + rand(-16, 16), y: y + rand(-10, 0),
        vx: rand(-24, 24), vy: rand(-80, -45),
        kind: 'note',
        life: rand(1, 1.6),
        size: rand(14, 20),
        color: pick(['#4cc9f0', '#a685f5', '#ff5d8f', '#3ddad7']),
      });
    }
  }

  zzz(x, y) {
    this.add({
      x: x + rand(-6, 6), y,
      vx: rand(8, 20), vy: rand(-40, -25),
      kind: 'zzz',
      life: 1.6,
      size: rand(11, 16),
      color: '#9db4ff',
    });
  }

  update(dt) {
    const items = this.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) {
        items.splice(i, 1);
        continue;
      }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz += p.gz * dt;
      p.z += p.vz * dt;
      p.rot += p.vrot * dt;
      p.wobble += dt * 5;
      if (p.kind === 'confetti') {
        p.vx *= 1 - 1.2 * dt;
        p.x += Math.sin(p.wobble) * 30 * dt;
      }
      if (p.kind === 'bubble') {
        p.x += Math.sin(p.wobble) * 22 * dt;
      }
      if (p.kind === 'leaffall') {
        p.x += Math.sin(p.wobble * 0.7) * 40 * dt;
      }
    }
  }

  draw(ctx) {
    for (const p of this.items) {
      const t = p.age / p.life;
      const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(fade * p.alpha, 0, 1);
      ctx.translate(p.x, p.y - p.z);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case 'confetti': {
          const squish = Math.sin(p.wobble * 2);
          ctx.fillRect(-p.size / 2, (-p.size / 2) * Math.abs(squish), p.size, p.size * Math.abs(squish) + 1);
          break;
        }
        case 'puff': {
          const grow = 1 + t * 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, (p.size * grow) / 2, 0, TAU);
          ctx.fill();
          break;
        }
        case 'star': {
          drawStar(ctx, 0, 0, 5, p.size, p.size * 0.45);
          ctx.fill();
          break;
        }
        case 'heart': {
          drawHeart(ctx, 0, 0, p.size);
          ctx.fill();
          break;
        }
        case 'note': {
          ctx.rotate(-p.rot + Math.sin(p.wobble) * 0.25);
          ctx.font = `bold ${Math.round(p.size)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(pick2(p, ['♪', '♫']), 0, 0);
          break;
        }
        case 'zzz': {
          ctx.rotate(-p.rot + 0.3);
          ctx.font = `bold ${Math.round(p.size)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('z', 0, 0);
          break;
        }
        case 'bubble': {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, TAU);
          ctx.fillStyle = 'rgba(160,220,255,0.25)';
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(-p.size * 0.35, -p.size * 0.35, p.size * 0.22, 0, TAU);
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fill();
          break;
        }
        case 'flame': {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
          g.addColorStop(0, '#fff3b0');
          g.addColorStop(0.5, '#ffb42e');
          g.addColorStop(1, 'rgba(255,90,60,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, TAU);
          ctx.fill();
          break;
        }
        case 'leaffall': {
          ctx.rotate(Math.sin(p.wobble) * 0.8);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.55, 0.6, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,60,0,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-p.size * 0.7, 0.4 * p.size);
          ctx.lineTo(p.size * 0.7, -0.4 * p.size);
          ctx.stroke();
          break;
        }
        case 'streak': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * 0.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-p.vx * 0.06, -p.vy * 0.06);
          ctx.stroke();
          break;
        }
        default: {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}

export function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}

export function drawHeart(ctx, cx, cy, size) {
  const s = size / 16;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 6 * s);
  ctx.bezierCurveTo(cx - 10 * s, cy - 4 * s, cx - 4 * s, cy - 10 * s, cx, cy - 4 * s);
  ctx.bezierCurveTo(cx + 4 * s, cy - 10 * s, cx + 10 * s, cy - 4 * s, cx, cy + 6 * s);
  ctx.closePath();
}

// stable per-particle pick (avoids flicker between frames)
function pick2(p, arr) {
  return arr[Math.floor(p.wobble * 7) % arr.length];
}
