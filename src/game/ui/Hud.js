// No-text HUD, deliberately minimal: dust-bin/mop pill + mode picker top-left,
// sound toggle top-right. The battery gauge lives ON the robot itself.
import { TAU, clamp, lerp } from '../core/math.js';
import { roundRect } from '../world/Room.js';

export class Hud {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.soundBtnPop = 0;
  }

  update(dt) {
    this.t += dt;
    if (this.soundBtnPop > 0) this.soundBtnPop -= dt * 3;
  }

  // returns true if the tap was consumed by the HUD
  onTap(x, y) {
    const g = this.game;
    // mode picker slots (pill origin 22, 90) — generous fat-finger padding
    const modes = ['vac', 'mop', 'both'];
    for (let i = 0; i < 3; i++) {
      const sx = 22 + 10 + i * 76;
      const sy = 90 + 8;
      if (x > sx - 6 && x < sx + 70 + 6 && y > sy - 6 && y < sy + 50 + 6) {
        g.requestMode(modes[i]);
        return true;
      }
    }
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

    // ---- bin pill (dust bin + mop-pad dirtiness gauge)
    this.drawPill(ctx, 22, 16, 245, (pctx) => {
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

      // ---- mop-pad dirtiness gauge (right portion)
      const dirt = g.mopDirt;
      const grubby = dirt >= 0.85;
      pctx.save();
      // ghost the whole gauge when no pads are installed
      if (!r.mopMode) pctx.globalAlpha = 0.25;
      // mini mop icon, just left of the bar (past the dot meter)
      const mopImg = g.assets.get('icon_mop');
      if (mopImg) {
        pctx.drawImage(mopImg, 152 - 11, 34 - 11, 22, 22);
      } else {
        // procedural blue droplet
        pctx.fillStyle = '#4aa3e8';
        pctx.beginPath();
        pctx.moveTo(152, 34 - 9);
        pctx.quadraticCurveTo(152 + 7, 34, 152, 34 + 5);
        pctx.quadraticCurveTo(152 - 7, 34, 152, 34 - 9);
        pctx.fill();
      }
      // pad bar: clean blue-white base, grubby brown fills left-to-right
      const barX = 162, barY = 25, barW = 64, barH = 18, barR = 9;
      const scale = grubby ? 1 + 0.06 * Math.sin(this.t * 9) : 1;
      pctx.save();
      pctx.translate(barX + barW / 2, barY + barH / 2);
      pctx.scale(scale, scale);
      pctx.translate(-(barX + barW / 2), -(barY + barH / 2));
      pctx.fillStyle = '#dfeefc';
      roundRect(pctx, barX, barY, barW, barH, barR);
      pctx.fill();
      // grubby fill, clipped to the rounded pad shape
      pctx.save();
      roundRect(pctx, barX, barY, barW, barH, barR);
      pctx.clip();
      // toward '#c0392b' urgency when very dirty (kept gentle)
      pctx.fillStyle = grubby ? blendHex('#8a6a48', '#c0392b', 0.5) : '#8a6a48';
      pctx.fillRect(barX, barY, barW * clamp(dirt, 0, 1), barH);
      pctx.restore();
      pctx.strokeStyle = '#9cc8ee';
      pctx.lineWidth = 2;
      roundRect(pctx, barX, barY, barW, barH, barR);
      pctx.stroke();
      pctx.restore();
      pctx.restore();
    });

    // ---- mode picker pill (vac / mop / both) — pick your cleaning flavor
    this.drawPill(ctx, 22, 90, 245, (pctx) => {
      const modes = ['vac', 'mop', 'both'];
      const pending = r.mopMode !== g.modeNeedsPads(); // robot's off to the dock to swap gear
      for (let i = 0; i < 3; i++) {
        const mode = modes[i];
        const active = g.userMode === mode;
        const sx = 10 + i * 76;
        // slot background
        pctx.fillStyle = active ? 'rgba(69, 205, 187, 0.95)' : 'rgba(120, 120, 140, 0.12)';
        roundRect(pctx, sx, 8, 70, 50, 14);
        pctx.fill();
        // icons, with a soft glow when this is the chosen one
        pctx.save();
        if (active) {
          pctx.shadowBlur = 6;
          pctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        }
        const cx = sx + 35;
        const cy = 33;
        if (mode === 'both') {
          drawModeIcon(pctx, this.game, 'vac', cx - 8, cy, 26, active);
          drawModeIcon(pctx, this.game, 'mop', cx + 8, cy, 26, active);
        } else {
          drawModeIcon(pctx, this.game, mode, cx, cy, 36, active);
        }
        pctx.restore();
        // pulsing outline on the active slot while gear is in transit
        if (pending && active) {
          pctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.4 + 0.5 * Math.abs(Math.sin(this.t * 5))) + ')';
          pctx.lineWidth = 3.5;
          roundRect(pctx, sx, 8, 70, 50, 14);
          pctx.stroke();
        }
      }
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

// draws a vac/mop icon at (cx, cy), sprite if we have one, doodle if not
function drawModeIcon(ctx, game, mode, cx, cy, size, active) {
  const img = game.assets.get(mode === 'vac' ? 'icon_vacuum' : 'icon_mop');
  if (img) {
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    return;
  }
  // procedural fallback — plain but friendly
  const col = active ? '#fff' : '#3a4152';
  if (mode === 'vac') {
    // spiral swirl
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let a = 0; a < TAU * 1.75; a += 0.25) {
      const rr = size * 0.08 + a * size * 0.055;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else {
    // droplet + a little pad bar
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.quadraticCurveTo(cx + size * 0.3, cy, cx, cy + size * 0.22);
    ctx.quadraticCurveTo(cx - size * 0.3, cy, cx, cy - size * 0.4);
    ctx.fill();
    roundRect(ctx, cx - size * 0.32, cy + size * 0.3, size * 0.64, size * 0.14, size * 0.07);
    ctx.fill();
  }
}

// blend two #rrggbb colors, t=0 -> a, t=1 -> b
function blendHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return 'rgb(' + r + ', ' + g + ', ' + bl + ')';
}
