// Title screen: generated hero art + live animation on top. The dismiss tap
// doubles as the browser audio-unlock gesture, so sound Just Works after it.
import { TAU, rand, pick, clamp, lerp, easeOutBack, easeInCubic } from '../core/math.js';
import { roundRect, starPath } from '../world/Room.js';

const W = 1680;
const H = 1050;

export class Splash {
  constructor(game) {
    this.game = game;
    this.active = true;
    this.t = 0;
    this.fade = 0; // 0 shown -> 1 gone
    this.fading = false;
    this.rippleT = 0;
    this.ripples = [];
    this.confetti = [];
    this.sparkles = [];
    for (let i = 0; i < 30; i++) {
      this.sparkles.push({
        x: rand(0, W), y: rand(0, H),
        size: rand(4, 11), speed: rand(14, 42),
        ph: rand(0, TAU),
        color: pick(['#ffe066', '#fff6c9', '#ffd6f5', '#c9f7ef', '#ffffff']),
      });
    }
  }

  dismiss() {
    if (!this.active || this.fading) return;
    this.fading = true;
    const g = this.game;
    g.sound.unlock();
    g.sound.whoosh();
    g.sound.happyBeeps(5);
    g.sound.tada();
    for (let i = 0; i < 70; i++) {
      const a = rand(-Math.PI, 0);
      const sp = rand(240, 640);
      this.confetti.push({
        x: 840 + rand(-60, 60), y: 660,
        vx: Math.cos(a) * sp * rand(0.4, 1), vy: Math.sin(a) * sp,
        rot: rand(0, TAU), vrot: rand(-9, 9),
        size: rand(8, 15), wob: rand(0, TAU),
        color: pick(['#ff5d8f', '#ffb42e', '#3ddad7', '#a685f5', '#7ed957', '#4cc9f0']),
      });
    }
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    for (const s of this.sparkles) {
      s.y -= s.speed * dt;
      s.x += Math.sin(this.t * 0.8 + s.ph) * 12 * dt;
      if (s.y < -20) {
        s.y = H + 20;
        s.x = rand(0, W);
      }
    }
    this.rippleT -= dt;
    if (this.rippleT <= 0 && !this.fading) {
      this.rippleT = 1.15;
      this.ripples.push({ t: 0 });
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt;
      if (this.ripples[i].t > 1.1) this.ripples.splice(i, 1);
    }
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.vy += 620 * dt;
      c.vx *= 1 - 1.1 * dt;
      c.x += c.vx * dt + Math.sin(c.wob += dt * 5) * 26 * dt;
      c.y += c.vy * dt;
      c.rot += c.vrot * dt;
      if (c.y > H + 40) this.confetti.splice(i, 1);
    }
    if (this.fading) {
      this.fade += dt / 0.95;
      if (this.fade >= 1) this.active = false;
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const g = this.game;
    const t = this.t;
    const out = easeInCubic(clamp(this.fade, 0, 1));
    ctx.save();
    ctx.globalAlpha = 1 - out;
    // zoom THROUGH the splash as it fades — feels like diving into the room
    const zoom = 1 + out * 0.45;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);

    // ---- background art (Ken Burns drift) ----
    const bg = g.assets.get('splash');
    if (bg) {
      const drift = 1.04 + 0.025 * Math.sin(t * 0.16);
      const dw = W * drift;
      const dh = dw * (bg.height / bg.width);
      ctx.drawImage(bg, (W - dw) / 2 + Math.sin(t * 0.11) * 16, Math.min(0, (H - dh) / 2), dw, Math.max(dh, H));
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#f5e3cf');
      grad.addColorStop(0.45, '#eed5bb');
      grad.addColorStop(0.46, '#e8b884');
      grad.addColorStop(1, '#d9a06b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // soft vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H);
    vg.addColorStop(0, 'rgba(50, 25, 40, 0)');
    vg.addColorStop(1, 'rgba(50, 25, 40, 0.28)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ---- rising sparkles ----
    for (const s of this.sparkles) {
      const tw = 0.45 + 0.45 * Math.sin(t * 2.4 + s.ph * 3);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(t * 0.6 + s.ph);
      ctx.globalAlpha = (1 - out) * tw;
      ctx.fillStyle = s.color;
      starPath(ctx, 0, 0, 4, s.size, s.size * 0.42);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1 - out;

    // ---- title ----
    const entrance = easeOutBack(clamp(t / 0.8, 0, 1));
    const bob = Math.sin(t * 1.4) * 9;
    const tilt = Math.sin(t * 0.9) * 0.02;
    const logo = g.assets.get('title_logo');
    ctx.save();
    ctx.translate(W / 2, 205 + bob);
    ctx.rotate(tilt);
    ctx.scale(entrance, entrance);
    if (logo) {
      const lw = 980;
      const lh = lw * (logo.height / logo.width);
      ctx.drawImage(logo, -lw / 2, -lh / 2, lw, lh);
    } else {
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.font = '900 108px "Arial Rounded MT Bold", -apple-system, sans-serif';
      ctx.lineWidth = 26;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = 'rgba(90, 50, 30, 0.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.strokeText("Theo's Robot", 0, -46);
      ctx.strokeText('Vacuum Game', 0, 74);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#45cdbb';
      ctx.fillText("Theo's Robot", 0, -46);
      ctx.fillStyle = '#ff8a5c';
      ctx.fillText('Vacuum Game', 0, 74);
    }
    ctx.restore();

    // ---- tap-to-start prompt: a pulsing robot button with ripples ----
    const px = 840;
    const py = 880;
    for (const r of this.ripples) {
      const k = r.t / 1.1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - k) * 0.7 * (1 - out)})`;
      ctx.lineWidth = 6 * (1 - k) + 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 58 + k * 110, 0, TAU);
      ctx.stroke();
    }
    // it lands right on the poster robot's body: "press his power button!"
    const pulse = 1 + 0.08 * Math.sin(t * 4.2);
    ctx.save();
    ctx.translate(px, py + Math.sin(t * 2.6) * 5);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255, 252, 245, 0.96)';
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.25)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 72, 0, TAU);
    ctx.fill();
    ctx.stroke();
    const rg = ctx.createRadialGradient(-12, -16, 5, 0, 0, 54);
    rg.addColorStop(0, '#8ff0e0');
    rg.addColorStop(0.6, '#45cdbb');
    rg.addColorStop(1, '#28a394');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, 54, 0, TAU);
    ctx.fill();
    // power glyph, glowing
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 12 + 6 * Math.sin(t * 4.2);
    ctx.beginPath();
    ctx.arc(0, 3, 26, -Math.PI * 0.32, Math.PI * 1.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(0, 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // ---- dismiss confetti ----
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      const squish = Math.abs(Math.sin(c.wob * 2)) * c.size + 1;
      ctx.fillRect(-c.size / 2, -squish / 2, c.size, squish);
      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
