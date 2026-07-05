// The multi-function dock: auto-empty dust bag, clean water tank, dirty water
// tank. The player maintains all three — tap a flashing tank to service it.
// The robot won't auto-empty with a full bag and can't mop without water.
import { TAU, clamp, rand, pointInRect } from '../core/math.js';
import { roundRect } from '../world/Room.js';

// Sprite-relative regions (fractions of the drawn sprite box) — calibrated by
// measuring public/assets/sprites/dock.png. Re-measure after regenerating art.
const REGIONS = {
  bag: { x0: 0.21, y0: 0.145, x1: 0.79, y1: 0.365 },
  clean: { x0: 0.185, y0: 0.49, x1: 0.485, y1: 0.71 },
  dirty: { x0: 0.515, y0: 0.49, x1: 0.815, y1: 0.71 },
  led: { x: 0.49, y: 0.435 },
  padCenterY: 0.88, // robot parks centered here
  towerBottomY: 0.76,
};

export class Dock {
  constructor(game) {
    this.game = game;
    this.x = 1330;
    this.parkY = 300; // robot center when docked — middle of the big pad
    this.drawW = 288; // matches sprite aspect (448x560)
    this.drawH = 360;
    this.spriteTop = this.parkY - Math.round(REGIONS.padCenterY * this.drawH);
    this.y = this.spriteTop + REGIONS.towerBottomY * this.drawH; // tower floor contact
    this.approach = { x: 1330, y: 480 };
    this.footprint = { x: 1215, y: 175, w: 230, h: 178 };
    this.baseline = this.y + 2;

    // the consumables — this is the maintenance game
    this.bagFill = 0.3;
    this.cleanWater = 0.85;
    this.dirtyWater = 0.15;

    this.glow = 0;
    this.pullT = 0;
    this.beacon = 0;
    this.wobble = 0;
    this.anim = null; // {type: 'bag'|'fill'|'drain', t, popped?}

    this.computeRects();
  }

  computeRects() {
    const left = this.x - this.drawW / 2;
    const top = this.spriteTop;
    const rect = (r) => ({
      x: left + r.x0 * this.drawW,
      y: top + r.y0 * this.drawH,
      w: (r.x1 - r.x0) * this.drawW,
      h: (r.y1 - r.y0) * this.drawH,
    });
    this.bagRect = rect(REGIONS.bag);
    this.cleanRect = rect(REGIONS.clean);
    this.dirtyRect = rect(REGIONS.dirty);
    this.ledPos = { x: left + REGIONS.led.x * this.drawW, y: top + REGIONS.led.y * this.drawH };
  }

  // ---- maintenance state ---------------------------------------------------

  needsBag() { return this.bagFill >= 1; }
  needsClean() { return this.cleanWater <= 0.15; }
  needsDirty() { return this.dirtyWater >= 1; }
  canMop() { return !this.needsClean() && !this.needsDirty(); }
  anyAlert() { return this.needsBag() || this.needsClean() || this.needsDirty(); }

  tapZone(x, y) {
    const pad = 18;
    const hit = (r) => pointInRect(x, y, { x: r.x - pad, y: r.y - pad - 10, w: r.w + pad * 2, h: r.h + pad * 2 });
    if (hit(this.bagRect)) return 'bag';
    if (hit(this.cleanRect)) return 'clean';
    if (hit(this.dirtyRect)) return 'dirty';
    return null;
  }

  // player tapped a tank — returns true if anything got serviced
  service(zone) {
    const g = this.game;
    if (zone === 'bag' && this.bagFill > 0.04) {
      this.anim = { type: 'bag', t: 0, popped: false };
      this.bagFill = 0;
      g.sound.whoosh();
      return true;
    }
    if (zone === 'clean' && this.cleanWater < 0.96) {
      this.anim = { type: 'fill', t: 0 };
      g.sound.glug();
      return true;
    }
    if (zone === 'dirty' && this.dirtyWater > 0.04) {
      this.anim = { type: 'drain', t: 0 };
      g.sound.drainGurgle();
      return true;
    }
    return false;
  }

  update(dt) {
    this.wobble += dt;
    if (this.pullT > 0) this.pullT -= dt;
    if (this.glow > 0) this.glow -= dt;
    if (this.beacon > 0) this.beacon -= dt;
    const g = this.game;
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      if (a.type === 'fill') {
        this.cleanWater = clamp(this.cleanWater + dt / 1.15, 0, 1);
        // splash bubbles at the rising surface
        if (Math.random() < 0.5) {
          const r = this.cleanRect;
          g.particles.add({
            x: r.x + rand(6, r.w - 6),
            y: r.y + r.h * (1 - this.cleanWater) + 4,
            kind: 'bubble', size: rand(2.5, 5), life: rand(0.25, 0.5), vy: rand(-25, -8),
          });
        }
        if (this.cleanWater >= 1 && a.t > 1.2) {
          this.anim = null;
          g.particles.sparkle(this.cleanRect.x + this.cleanRect.w / 2, this.cleanRect.y, 6);
          g.sound.ackBeep();
        }
      } else if (a.type === 'drain') {
        this.dirtyWater = clamp(this.dirtyWater - dt / 1.05, 0, 1);
        if (Math.random() < 0.45) {
          const r = this.dirtyRect;
          g.particles.add({
            x: r.x + rand(8, r.w - 8), y: r.y + r.h + 6,
            kind: 'dot', color: 'rgba(138, 106, 74, 0.7)',
            size: rand(3, 5), life: rand(0.3, 0.5), vy: rand(50, 110),
          });
        }
        if (this.dirtyWater <= 0 && a.t > 1.1) {
          this.anim = null;
          g.particles.sparkle(this.dirtyRect.x + this.dirtyRect.w / 2, this.dirtyRect.y, 6);
          g.sound.ackBeep();
        }
      } else if (a.type === 'bag') {
        if (a.t > 0.75 && !a.popped) {
          a.popped = true;
          g.sound.pop();
          g.particles.dustPuff(this.bagRect.x + this.bagRect.w / 2, this.bagRect.y - 130, 8);
          g.particles.sparkle(this.bagRect.x + this.bagRect.w / 2, this.bagRect.y - 110, 5);
        }
        if (a.t > 1.1) this.anim = null;
      }
    }
  }

  // Robot calls this while auto-emptying: stream dust particles into the bag.
  pullDust(robot) {
    this.pullT = 0.2;
    const p = this.game.particles;
    const bx = this.bagRect.x + this.bagRect.w / 2;
    const by = this.bagRect.y + this.bagRect.h / 2;
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      p.add({
        x: robot.x + Math.cos(a) * 30,
        y: robot.y + Math.sin(a) * 20,
        kind: 'puff',
        color: `rgba(${150 + rand(-30, 30) | 0}, ${140 + rand(-30, 30) | 0}, 130, 0.7)`,
        size: rand(7, 14),
        life: 0.5,
        vx: (bx + rand(-14, 14) - robot.x) * 2.2,
        vy: (by + rand(-16, 16) - robot.y) * 2.2,
      });
    }
  }

  contains(x, y) {
    return x > this.x - 155 && x < this.x + 155 && y > -10 && y < this.y + 115;
  }

  // ---- drawing ---------------------------------------------------------------

  draw(ctx, assets) {
    const img = assets.get('dock');
    const t = this.wobble;
    ctx.save();
    ctx.translate(this.x, 0);

    // soft shadow under the pad
    ctx.fillStyle = 'rgba(90, 50, 30, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, this.parkY + 34, 140, 34, 0, 0, TAU);
    ctx.fill();

    if (img) {
      ctx.drawImage(img, -this.drawW / 2, this.spriteTop, this.drawW, this.drawH);
    } else {
      this.drawFallbackTower(ctx);
    }
    ctx.restore();

    // ---- fills (world coords, sprite-calibrated) ----
    this.drawBagFill(ctx);
    this.drawWater(ctx, this.cleanRect, this.cleanWater, 'clean');
    this.drawWater(ctx, this.dirtyRect, this.dirtyWater, 'dirty');

    // ---- little icon labels ----
    this.drawBadge(ctx, assets, 'icon_dust', this.bagRect, '#9aa0aa');
    this.drawBadge(ctx, assets, 'icon_water', this.cleanRect, '#4cc9f0');
    this.drawBadge(ctx, assets, 'icon_dirty', this.dirtyRect, '#8a6a4a');

    // ---- alert bubbles + outlines ----
    const alerts = [];
    if (this.needsBag()) alerts.push(['icon_dust', this.bagRect, '#9aa0aa']);
    if (this.needsClean()) alerts.push(['icon_water', this.cleanRect, '#4cc9f0']);
    if (this.needsDirty()) alerts.push(['icon_dirty', this.dirtyRect, '#8a6a4a']);
    alerts.forEach(([icon, rect, color], i) => this.drawAlert(ctx, assets, icon, rect, color, i, alerts.length));

    // ---- service animations ----
    if (this.anim?.type === 'bag') this.drawBagAnim(ctx);
    if (this.anim?.type === 'fill') this.drawPour(ctx);

    // ---- status LED ----
    const breathe = 0.6 + 0.4 * Math.sin(t * 2.2);
    const ledColor = this.anyAlert() ? '#ff5d5d' : this.pullT > 0 ? '#ff9e2e' : this.glow > 0 ? '#69f0ae' : '#4cc9f0';
    ctx.fillStyle = ledColor;
    ctx.globalAlpha = 0.5 + 0.5 * breathe;
    ctx.beginPath();
    ctx.arc(this.ledPos.x, this.ledPos.y, 8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.25 * breathe;
    ctx.beginPath();
    ctx.arc(this.ledPos.x, this.ledPos.y, 16, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // summon beacon rings on the pad
    if (this.beacon > 0) {
      const bt = 1 - this.beacon / 1.2;
      for (let i = 0; i < 2; i++) {
        const rt = (bt + i * 0.35) % 1;
        ctx.strokeStyle = `rgba(76, 201, 240, ${0.7 * (1 - rt)})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 45, 42 + rt * 95, 17 + rt * 38, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // suction swirl into the bag while emptying
    if (this.pullT > 0) {
      const bx = this.bagRect.x + this.bagRect.w / 2;
      const by = this.bagRect.y + this.bagRect.h + 8;
      ctx.strokeStyle = 'rgba(255, 158, 46, 0.5)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(bx, by, 20 + i * 8, a, a + 1.8);
        ctx.stroke();
      }
    }
  }

  drawBagFill(ctx) {
    const r = this.bagRect;
    const fill = clamp(this.bagFill, 0, 1);
    if (this.anim?.type === 'bag') return; // old bag is flying away
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.clip();
    const dh = r.h * fill;
    const full = this.needsBag();
    ctx.fillStyle = full
      ? `rgba(190, 120, 90, ${0.85 + 0.1 * Math.sin(this.wobble * 6)})`
      : 'rgba(150, 138, 128, 0.88)';
    ctx.fillRect(r.x, r.y + r.h - dh, r.w, dh + 1);
    ctx.fillStyle = 'rgba(115, 103, 95, 0.55)';
    for (let i = 0; i < 6; i++) {
      const sx = r.x + 10 + ((i * 37) % (r.w - 20));
      const sy = r.y + r.h - dh * (0.15 + ((i * 53) % 10) / 13);
      if (sy > r.y + 2) {
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawWater(ctx, r, level, kind) {
    if (level <= 0.01) return;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, 9);
    ctx.clip();
    const top = r.y + r.h * (1 - level);
    if (kind === 'clean') {
      const g = ctx.createLinearGradient(0, top, 0, r.y + r.h);
      g.addColorStop(0, 'rgba(110, 200, 250, 0.75)');
      g.addColorStop(1, 'rgba(60, 150, 220, 0.85)');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(0, top, 0, r.y + r.h);
      g.addColorStop(0, 'rgba(150, 115, 80, 0.8)');
      g.addColorStop(1, 'rgba(110, 82, 55, 0.9)');
      ctx.fillStyle = g;
    }
    ctx.fillRect(r.x, top, r.w, r.h * level + 2);
    // wavy surface line
    ctx.strokeStyle = kind === 'clean' ? 'rgba(220, 245, 255, 0.9)' : 'rgba(200, 170, 140, 0.7)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let x = 0; x <= r.w; x += 6) {
      const yy = top + Math.sin(this.wobble * 2.4 + x * 0.22) * 1.8;
      x === 0 ? ctx.moveTo(r.x + x, yy) : ctx.lineTo(r.x + x, yy);
    }
    ctx.stroke();
    // murk blobs in dirty water
    if (kind === 'dirty') {
      ctx.fillStyle = 'rgba(80, 58, 38, 0.5)';
      for (let i = 0; i < 4; i++) {
        const bx = r.x + 10 + ((i * 41) % (r.w - 20));
        const by = top + 10 + ((i * 29 + this.wobble * 6) % Math.max(6, r.h * level - 14));
        ctx.beginPath();
        ctx.arc(bx, by, 4.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawBadge(ctx, assets, icon, rect, fallbackColor) {
    const img = assets.get(icon);
    const bx = rect.x + 4;
    const by = rect.y - 4;
    if (img) {
      ctx.drawImage(img, bx - 12, by - 12, 24, 24);
    } else {
      ctx.fillStyle = fallbackColor;
      ctx.beginPath();
      ctx.arc(bx, by, 9, 0, TAU);
      ctx.fill();
    }
  }

  drawAlert(ctx, assets, icon, rect, color, i, total) {
    const t = this.wobble;
    // pulsing outline on the needy tank
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.strokeStyle = `rgba(255, 80, 80, ${0.45 + 0.5 * pulse})`;
    ctx.lineWidth = 4 + pulse * 2;
    roundRect(ctx, rect.x - 5, rect.y - 5, rect.w + 10, rect.h + 10, 12);
    ctx.stroke();
    // bouncing bubble above the dock
    const spread = (i - (total - 1) / 2) * 74;
    const bx = this.x + spread;
    const by = this.y - this.drawH + 42 - Math.abs(Math.sin(t * 3)) * 12;
    ctx.save();
    ctx.translate(bx, by);
    ctx.fillStyle = 'rgba(255, 252, 245, 0.96)';
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // little tail
    ctx.beginPath();
    ctx.moveTo(-7, 26);
    ctx.lineTo(0, 42);
    ctx.lineTo(8, 25);
    ctx.closePath();
    ctx.fill();
    const img = assets.get(icon);
    if (img) {
      ctx.drawImage(img, -18, -18, 36, 36);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, TAU);
      ctx.fill();
    }
    // red "!" badge
    ctx.fillStyle = '#ff5d5d';
    ctx.beginPath();
    ctx.arc(22, -20, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    roundRect(ctx, 19.5, -27, 5, 9, 2.5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(22, -14.5, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawBagAnim(ctx) {
    const a = this.anim;
    const r = this.bagRect;
    const t = Math.min(1, a.t / 0.9);
    const rise = t * t * 200;
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2 - rise);
    ctx.rotate(Math.sin(a.t * 7) * 0.18);
    ctx.globalAlpha = clamp(1.2 - t, 0, 1);
    ctx.fillStyle = '#f2efe8';
    roundRect(ctx, -r.w * 0.34, -r.h * 0.42, r.w * 0.68, r.h * 0.84, 12);
    ctx.fill();
    ctx.fillStyle = 'rgba(150, 138, 128, 0.8)';
    roundRect(ctx, -r.w * 0.34, r.h * 0.06, r.w * 0.68, r.h * 0.36, 10);
    ctx.fill();
    ctx.restore();
  }

  drawPour(ctx) {
    const r = this.cleanRect;
    const cx = r.x + r.w / 2;
    const topY = this.y + 70 - this.drawH - 26;
    const surface = r.y + r.h * (1 - this.cleanWater);
    ctx.strokeStyle = 'rgba(120, 205, 255, 0.85)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx, surface);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230, 248, 255, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 1, topY);
    ctx.lineTo(cx - 1, surface);
    ctx.stroke();
  }

  drawFallbackTower(ctx) {
    // simple stand-in if the sprite is missing
    const w = this.drawW * 0.62;
    const h = this.drawH * 0.82;
    const tg = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    tg.addColorStop(0, '#565b6e');
    tg.addColorStop(0.5, '#6e7488');
    tg.addColorStop(1, '#4c5162');
    ctx.fillStyle = tg;
    roundRect(ctx, -w / 2, 62 - h, w, h, 24);
    ctx.fill();
    ctx.fillStyle = '#3b3f4d';
    roundRect(ctx, -w / 2 + 16, 40, w - 32, 26, 12);
    ctx.fill();
  }
}
