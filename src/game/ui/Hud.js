// No-text HUD: battery pill, dust-bin pill, star meter, sound toggle.
// Everything is an icon, everything is big and tappable.
import { TAU, clamp, lerp } from '../core/math.js';
import { roundRect, starPath } from '../world/Room.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.soundBtnPop = 0;
    this.starPop = 0;
    this.stars = 0; // 0..5 star meter, fills every 10 pickups
    this.pickupsTowardStar = 0;
  }

  onPickup() {
    this.pickupsTowardStar++;
    if (this.pickupsTowardStar >= 10) {
      this.pickupsTowardStar = 0;
      this.stars++;
      this.starPop = 1;
      const g = this.game;
      g.sound.tada();
      if (this.stars >= 5) {
        // BIG celebration, then reset
        this.stars = 0;
        g.celebrate();
      }
    }
  }

  update(dt) {
    this.t += dt;
    if (this.soundBtnPop > 0) this.soundBtnPop -= dt * 3;
    if (this.starPop > 0) this.starPop -= dt * 1.5;
  }

  // returns true if the tap was consumed by the HUD
  onTap(x, y) {
    const g = this.game;
    // sound button top-right
    if (Math.hypot(x - 1610, y - 66) < 52) {
      const muted = g.sound.toggleMute();
      this.soundBtnPop = 1;
      if (!muted) g.sound.ackBeep();
      return true;
    }
    return false;
  }

  draw(ctx) {
    const g = this.game;
    const r = g.robot;

    // ---- battery pill (top-left, stacked)
    this.drawPill(ctx, 22, 16, 190, (pctx) => {
      const level = r.battery;
      const low = level < 0.22;
      const pulse = low ? 0.75 + 0.25 * Math.sin(this.t * 8) : 1;
      // battery body
      pctx.fillStyle = '#3a4152';
      roundRect(pctx, 14, 16, 108, 34, 10);
      pctx.fill();
      pctx.fillStyle = '#3a4152';
      roundRect(pctx, 122, 25, 10, 16, 4);
      pctx.fill();
      const col = level > 0.5 ? '#69d96e' : level > 0.22 ? '#ffb42e' : '#ff5d5d';
      pctx.fillStyle = col;
      pctx.globalAlpha = pulse;
      roundRect(pctx, 19, 21, Math.max(6, 98 * level), 24, 7);
      pctx.fill();
      pctx.globalAlpha = 1;
      // bolt icon
      pctx.fillStyle = '#fff';
      pctx.save();
      pctx.translate(152, 33);
      const chg = r.state === 'charge';
      if (chg) pctx.scale(1 + 0.15 * Math.sin(this.t * 10), 1 + 0.15 * Math.sin(this.t * 10));
      boltPath(pctx, 0, 0, 17);
      pctx.fill();
      pctx.restore();
    });

    // ---- bin pill
    this.drawPill(ctx, 22, 90, 150, (pctx) => {
      const fill = r.bin;
      const full = fill > 0.85;
      const pulse = full ? 1 + 0.06 * Math.sin(this.t * 9) : 1;
      pctx.save();
      pctx.translate(44, 34);
      pctx.scale(pulse, pulse);
      // bin icon
      pctx.fillStyle = '#3a4152';
      pctx.beginPath();
      pctx.moveTo(-20, -12);
      pctx.lineTo(20, -12);
      pctx.lineTo(15, 22);
      pctx.lineTo(-15, 22);
      pctx.closePath();
      pctx.fill();
      roundRect(pctx, -24, -20, 48, 9, 4);
      pctx.fill();
      // fill level inside bin
      pctx.save();
      pctx.beginPath();
      pctx.moveTo(-18, -10);
      pctx.lineTo(18, -10);
      pctx.lineTo(14, 20);
      pctx.lineTo(-14, 20);
      pctx.closePath();
      pctx.clip();
      pctx.fillStyle = full ? '#ffb42e' : '#b3a89d';
      pctx.fillRect(-20, 20 - 30 * fill, 40, 30 * fill);
      pctx.restore();
      pctx.restore();
      // fill dots meter
      pctx.fillStyle = '#3a4152';
      for (let i = 0; i < 4; i++) {
        const on = fill > (i + 0.5) / 4;
        pctx.globalAlpha = on ? 1 : 0.22;
        pctx.fillStyle = on ? (full ? '#ffb42e' : '#8d9bb8') : '#3a4152';
        pctx.beginPath();
        pctx.arc(86 + i * 16, 34, 6, 0, TAU);
        pctx.fill();
      }
      pctx.globalAlpha = 1;
    });

    // ---- star meter pill (stacked below)
    this.drawPill(ctx, 22, 164, 245, (pctx) => {
      for (let i = 0; i < 5; i++) {
        const filled = i < this.stars;
        const isNew = filled && i === this.stars - 1 && this.starPop > 0;
        const scale = isNew ? 1 + this.starPop * 0.6 : 1;
        pctx.save();
        pctx.translate(36 + i * 44, 28);
        pctx.scale(scale, scale);
        pctx.fillStyle = filled ? '#ffd23f' : 'rgba(120, 120, 140, 0.25)';
        pctx.strokeStyle = filled ? 'rgba(200, 140, 20, 0.6)' : 'rgba(90, 90, 110, 0.3)';
        pctx.lineWidth = 2.5;
        starPath(pctx, 0, 0, 5, 15, 6.8);
        pctx.fill();
        pctx.stroke();
        pctx.restore();
      }
      const prog = this.pickupsTowardStar / 10;
      pctx.fillStyle = 'rgba(120, 120, 140, 0.25)';
      roundRect(pctx, 22, 47, 200, 7, 3.5);
      pctx.fill();
      pctx.fillStyle = '#ffd23f';
      roundRect(pctx, 22, 47, Math.max(7, 200 * prog), 7, 3.5);
      pctx.fill();
    });

    // ---- sound button (top-right)
    const muted = g.sound.muted;
    const pop = 1 + Math.max(0, this.soundBtnPop) * 0.25;
    ctx.save();
    ctx.translate(1610, 66);
    ctx.scale(pop, pop);
    ctx.fillStyle = 'rgba(255, 252, 245, 0.92)';
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.2)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // speaker icon
    ctx.fillStyle = '#3a4152';
    ctx.beginPath();
    ctx.moveTo(-20, -8);
    ctx.lineTo(-8, -8);
    ctx.lineTo(6, -20);
    ctx.lineTo(6, 20);
    ctx.lineTo(-8, 8);
    ctx.lineTo(-20, 8);
    ctx.closePath();
    ctx.fill();
    if (muted) {
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-26, -26);
      ctx.lineTo(26, 26);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#3a4152';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      const w = 0.85 + 0.15 * Math.sin(this.t * 6);
      ctx.beginPath();
      ctx.arc(8, 0, 13 * w, -0.9, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(8, 0, 21 * w, -0.8, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPill(ctx, x, y, w, drawContent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255, 252, 245, 0.92)';
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.2)';
    ctx.lineWidth = 4;
    roundRect(ctx, 0, 0, w, 66, 33);
    ctx.fill();
    ctx.stroke();
    drawContent(ctx);
    ctx.restore();
  }
}

function boltPath(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.18, cy - s);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.18, cy + s);
  ctx.lineTo(cx + s * 0.45, cy - s * 0.15);
  ctx.lineTo(cx + s * 0.05, cy - s * 0.15);
  ctx.closePath();
}
