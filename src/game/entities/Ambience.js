// Ambient life: warm sunbeam through the window with floating dust motes.
import { TAU, rand } from '../core/math.js';

export class Ambience {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.roomId = null;
    this.beam = null;
    this.motes = [];
    for (let i = 0; i < 22; i++) {
      this.motes.push({
        u: rand(0, 1), v: rand(0, 1),
        r: rand(1.5, 3.6),
        sp: rand(0.008, 0.03),
        ph: rand(0, TAU),
      });
    }
    this.syncRoom();
  }

  syncRoom() {
    const room = this.game.room;
    if (!room || this.roomId === room.id) return;
    this.roomId = room.id;
    const w = room.window;
    if (!w) {
      this.beam = null;
      return;
    }
    // Beam quad from this room's window down-right onto its floor. A room
    // without a window has no sunbeam rather than inheriting stale geometry.
    this.beam = {
      x1: w.x + 10, x2: w.x + w.w - 10,
      y1: 170,
      x3: w.x + 250, x4: w.x + w.w + 330,
      y2: 720,
    };
  }

  update(dt) {
    this.syncRoom();
    this.t += dt;
    if (!this.beam) return;
    for (const m of this.motes) {
      m.v += m.sp * dt * 6;
      if (m.v > 1) {
        m.v = 0;
        m.u = rand(0, 1);
      }
    }
  }

  motePos(m) {
    const b = this.beam;
    const wob = Math.sin(this.t * 0.8 + m.ph) * 0.04;
    const u = Math.min(1, Math.max(0, m.u + wob));
    const xTop = b.x1 + (b.x2 - b.x1) * u;
    const xBot = b.x3 + (b.x4 - b.x3) * u;
    return {
      x: xTop + (xBot - xTop) * m.v,
      y: b.y1 + (b.y2 - b.y1) * m.v,
    };
  }

  draw(ctx) {
    const b = this.beam;
    if (!b) return;
    const pulse = 0.1 + 0.03 * Math.sin(this.t * 0.5);
    const g = ctx.createLinearGradient(0, b.y1, 0, b.y2);
    g.addColorStop(0, `rgba(255, 236, 170, ${pulse * 1.6})`);
    g.addColorStop(1, 'rgba(255, 236, 170, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y1);
    ctx.lineTo(b.x4, b.y2);
    ctx.lineTo(b.x3, b.y2);
    ctx.closePath();
    ctx.fill();

    // motes
    for (const m of this.motes) {
      const p = this.motePos(m);
      const tw = 0.35 + 0.3 * Math.sin(this.t * 2 + m.ph * 3);
      ctx.fillStyle = `rgba(255, 246, 210, ${tw})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, m.r, 0, TAU);
      ctx.fill();
    }
  }
}
