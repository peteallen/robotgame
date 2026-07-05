// The auto-empty charging dock — tall tower against the wall, glowing
// contacts, dust-bag window that visibly fills up.
import { TAU, clamp, rand } from '../core/math.js';
import { roundRect } from '../world/Room.js';

export class Dock {
  constructor(game) {
    this.game = game;
    this.x = 1330;
    this.y = 232; // where the tower meets the floor
    this.parkY = 262; // robot center when docked
    this.approach = { x: 1330, y: 430 };
    this.footprint = { x: 1250, y: 150, w: 160, h: 130 };
    // where the tower meets the floor — the robot parks IN FRONT of this,
    // so a docked robot (y=262) draws on top of the ramp, not behind it
    this.baseline = 235;
    this.bagFill = 0.15;
    this.glow = 0;
    this.pullT = 0; // >0 while sucking dust out of robot
    this.beacon = 0;
    this.wobble = 0;
  }

  update(dt) {
    this.wobble += dt;
    if (this.pullT > 0) this.pullT -= dt;
    if (this.glow > 0) this.glow -= dt;
    if (this.beacon > 0) this.beacon -= dt;
  }

  // Robot calls this while auto-emptying: stream dust particles into the tower.
  pullDust(robot) {
    this.pullT = 0.2;
    const p = this.game.particles;
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      p.add({
        x: robot.x + Math.cos(a) * 30,
        y: robot.y + Math.sin(a) * 20,
        kind: 'puff',
        color: `rgba(${150 + rand(-30, 30) | 0}, ${140 + rand(-30, 30) | 0}, 130, 0.7)`,
        size: rand(7, 14),
        life: 0.5,
        vx: (this.x + rand(-12, 12) - robot.x) * 2.4,
        vy: (this.y - 90 + rand(-20, 20) - robot.y) * 2.4,
      });
    }
  }

  contains(x, y) {
    return x > this.x - 110 && x < this.x + 110 && y > 40 && y < this.y + 110;
  }

  draw(ctx, assets) {
    const img = assets.get('dock');
    const t = this.wobble;
    ctx.save();
    ctx.translate(this.x, this.y);

    // charging pad shadow on floor (always, sits under robot)
    ctx.fillStyle = 'rgba(90, 50, 30, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, 46, 95, 34, 0, 0, TAU);
    ctx.fill();

    if (img) {
      const w = 240;
      const h = 300;
      ctx.drawImage(img, -w / 2, -h + 60, w, h);
    } else {
      // --- procedural dock tower ---
      // baseplate ramp
      const rg = ctx.createLinearGradient(0, 0, 0, 52);
      rg.addColorStop(0, '#4a4e5c');
      rg.addColorStop(1, '#343845');
      ctx.fillStyle = rg;
      roundRect(ctx, -85, -6, 170, 56, 18);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 216, 77, 0.9)';
      roundRect(ctx, -34, 18, 28, 12, 6);
      ctx.fill();
      roundRect(ctx, 8, 18, 28, 12, 6);
      ctx.fill();
      // tower
      const tg = ctx.createLinearGradient(-70, 0, 70, 0);
      tg.addColorStop(0, '#565b6e');
      tg.addColorStop(0.5, '#6e7488');
      tg.addColorStop(1, '#4c5162');
      ctx.fillStyle = tg;
      roundRect(ctx, -70, -190, 140, 196, 26);
      ctx.fill();
      // face plate
      ctx.fillStyle = '#3b3f4d';
      roundRect(ctx, -54, -176, 108, 76, 18);
      ctx.fill();
      // dust bag window
      ctx.fillStyle = 'rgba(220, 235, 255, 0.25)';
      roundRect(ctx, -44, -168, 88, 62, 12);
      ctx.fill();
    }

    // Dust in bag window (drawn for both sprite & fallback, tuned position)
    const fill = clamp(this.bagFill, 0, 1);
    ctx.save();
    roundRect(ctx, -44, -168, 88, 60, 12);
    ctx.clip();
    ctx.fillStyle = 'rgba(150, 138, 128, 0.9)';
    const dh = 60 * fill;
    ctx.fillRect(-44, -108 - dh, 88, dh + 2);
    ctx.fillStyle = 'rgba(120, 108, 100, 0.5)';
    for (let i = 0; i < 5; i++) {
      const bx = -30 + i * 15;
      const by = -110 - dh * (0.2 + ((i * 37) % 10) / 14);
      if (by > -168) {
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // status LED — breathing
    const breathe = 0.6 + 0.4 * Math.sin(t * 2.2);
    const ledColor = this.pullT > 0 ? '#ff9e2e' : this.glow > 0 ? '#69f0ae' : '#4cc9f0';
    ctx.fillStyle = ledColor;
    ctx.globalAlpha = 0.5 + 0.5 * breathe;
    ctx.beginPath();
    ctx.arc(0, -74, 8, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.25 * breathe;
    ctx.beginPath();
    ctx.arc(0, -74, 16, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // summon beacon (tap feedback): expanding rings
    if (this.beacon > 0) {
      const bt = 1 - this.beacon / 1.2;
      for (let i = 0; i < 2; i++) {
        const rt = (bt + i * 0.35) % 1;
        ctx.strokeStyle = `rgba(76, 201, 240, ${0.7 * (1 - rt)})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(0, 30, 40 + rt * 90, 16 + rt * 36, 0, 0, TAU);
        ctx.stroke();
      }
    }

    // suction swirl while emptying
    if (this.pullT > 0) {
      ctx.strokeStyle = 'rgba(255, 158, 46, 0.5)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.arc(0, -90, 26 + i * 9, a, a + 1.8);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
