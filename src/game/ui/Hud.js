// No-text HUD: dust-bin/mop pill + mode and return-home controls top-left,
// sound toggle top-right. The battery gauge lives ON the robot itself.
import { TAU, clamp, lerp } from '../core/math.js';
import { roundRect } from '../world/Room.js';
import { Minimap } from './Minimap.js';

const CONTROL_X = 22;
const CONTROL_Y = 90;
const CONTROL_SLOT_X = 10;
const CONTROL_SLOT_Y = 8;
const CONTROL_SLOT_STEP = 76;
const CONTROL_SLOT_W = 70;
const CONTROL_SLOT_H = 50;

export const HUD_HOME_BUTTON = Object.freeze({
  cx: 327,
  cy: 125,
  radius: 45,
  hitRadius: 60,
});

function controlSlotHit(x, y, index) {
  const sx = CONTROL_X + CONTROL_SLOT_X + index * CONTROL_SLOT_STEP;
  const sy = CONTROL_Y + CONTROL_SLOT_Y;
  return x > sx - 6 && x < sx + CONTROL_SLOT_W + 6 &&
    y > sy - 6 && y < sy + CONTROL_SLOT_H + 6;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.soundBtnPop = 0;
    this.homeBtnPop = 0;
    this.minimap = new Minimap(game);
  }

  update(dt) {
    this.t += dt;
    if (this.soundBtnPop > 0) this.soundBtnPop -= dt * 3;
    if (this.homeBtnPop > 0) this.homeBtnPop -= dt * 3;
    this.minimap.update(dt);
  }

  // Lets the game capture a HUD press before it can turn into a floor drag.
  // This includes the full minimap card, not just its two room buttons.
  hitTest(x, y) {
    if (this.minimap.hitTest(x, y)) return true;
    for (let i = 0; i < 3; i++) {
      if (controlSlotHit(x, y, i)) return true;
    }
    if (Math.hypot(x - HUD_HOME_BUTTON.cx, y - HUD_HOME_BUTTON.cy) <
        HUD_HOME_BUTTON.hitRadius) return true;
    return Math.hypot(x - 1610, y - 66) < 52;
  }

  // returns true if the tap was consumed by the HUD
  onTap(x, y) {
    const g = this.game;
    if (this.minimap.onTap(x, y)) return true;
    // mode picker slots (pill origin 22, 90) — generous fat-finger padding
    const modes = ['vac', 'mop', 'both'];
    for (let i = 0; i < 3; i++) {
      if (controlSlotHit(x, y, i)) {
        g.requestMode(modes[i]);
        return true;
      }
    }
    if (Math.hypot(x - HUD_HOME_BUTTON.cx, y - HUD_HOME_BUTTON.cy) <
        HUD_HOME_BUTTON.hitRadius) {
      this.homeBtnPop = 1;
      g.robot.summon();
      return true;
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

    // ---- control pill: vac / mop / both + an always-available dock return
    this.drawPill(ctx, CONTROL_X, CONTROL_Y, 245, (pctx) => {
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

    // ---- separate large return-home button beside the mode picker. Its
    // invisible hit halo remains at least 44 CSS pixels on compact landscape.
    const returning = !!r.stayDocked;
    const homePop = 1 + Math.max(0, this.homeBtnPop) * 0.18;
    ctx.save();
    ctx.translate(HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy);
    ctx.scale(homePop, homePop);
    ctx.fillStyle = returning
      ? 'rgba(69, 205, 187, 0.96)'
      : 'rgba(255, 252, 245, 0.94)';
    ctx.strokeStyle = returning
      ? `rgba(255, 255, 255, ${0.65 + 0.3 * Math.abs(Math.sin(this.t * 5))})`
      : 'rgba(90, 60, 20, 0.22)';
    ctx.lineWidth = returning ? 5 : 4;
    ctx.beginPath();
    ctx.arc(0, 0, HUD_HOME_BUTTON.radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    drawDockIcon(ctx, 0, 0, returning);
    ctx.restore();

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

    // ---- two-room house map (bottom-right)
    this.minimap.draw(ctx);
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

function drawDockIcon(ctx, cx, cy, active) {
  const color = active ? '#fff' : '#3a4152';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A small tower and charging pad echo the full-size dock in the room.
  roundRect(ctx, -13, -17, 26, 25, 7);
  ctx.fill();
  ctx.globalAlpha = active ? 0.62 : 0.35;
  roundRect(ctx, -23, 8, 46, 10, 5);
  ctx.fill();
  ctx.globalAlpha = 1;

  // An inbound arrow aimed at the pad makes this a command to come home,
  // rather than merely another maintenance gauge.
  ctx.beginPath();
  ctx.moveTo(0, 19);
  ctx.lineTo(0, 5);
  ctx.moveTo(-6, 11);
  ctx.lineTo(0, 5);
  ctx.lineTo(6, 11);
  ctx.strokeStyle = active ? '#239d91' : '#fffaf0';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
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
