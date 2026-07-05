// A ginger cat that naps in its bed, wanders the room, gets startled by the
// robot... and sometimes rides it. Peak internet physics.
import { TAU, rand, pick, chance, dist, angleTo, angleApproach, clamp, damp } from '../core/math.js';

export class Cat {
  constructor(game) {
    this.game = game;
    this.home = { x: 165, y: 322 };
    this.x = this.home.x;
    this.y = this.home.y;
    this.state = 'sleep'; // sleep | sit | walk | ride | startle
    this.stateT = 0;
    this.heading = 0;
    this.target = null;
    this.decideT = rand(6, 12);
    this.bob = 0;
    this.tailT = rand(0, 9);
    this.zzzT = 0;
    this.rideT = 0;
    this.meowCooldown = 0;
    this.startleV = null;
  }

  get baseline() {
    if (this.state === 'ride') return this.game.robot.y + 2;
    // sleeping happens inside the bed — draw on top of it
    if (this.state === 'sleep') return this.y + 66;
    return this.y + 34;
  }

  update(dt) {
    const g = this.game;
    this.stateT += dt;
    this.tailT += dt;
    if (this.meowCooldown > 0) this.meowCooldown -= dt;
    this.bob = Math.abs(Math.sin(this.stateT * 8)) * (this.state === 'walk' ? 6 : 0);

    switch (this.state) {
      case 'sleep': {
        this.zzzT -= dt;
        if (this.zzzT <= 0) {
          this.zzzT = rand(1.6, 2.6);
          g.particles.zzz(this.x + 26, this.y - 30);
        }
        this.decideT -= dt;
        if (this.decideT <= 0) {
          this.decideT = rand(10, 20);
          if (chance(0.6)) this.beginWalk();
        }
        break;
      }
      case 'sit': {
        this.decideT -= dt;
        if (this.decideT <= 0) {
          this.decideT = rand(8, 16);
          if (chance(0.45)) this.beginWalk(chance(0.4) ? this.home : null);
          else if (dist(this.x, this.y, this.home.x, this.home.y) < 60 && chance(0.6)) {
            this.state = 'sleep';
            this.stateT = 0;
          }
        }
        break;
      }
      case 'walk': {
        if (!this.target) {
          this.state = 'sit';
          break;
        }
        const speed = this.hurry ? 180 : 95;
        const a = angleTo(this.x, this.y, this.target.x, this.target.y);
        this.heading = angleApproach(this.heading, a, 4 * dt);
        this.x += Math.cos(this.heading) * speed * dt;
        this.y += Math.sin(this.heading) * speed * dt;
        if (dist(this.x, this.y, this.target.x, this.target.y) < 26) {
          const wasHome = dist(this.x, this.y, this.home.x, this.home.y) < 70;
          this.target = null;
          this.state = wasHome ? 'sleep' : 'sit';
          this.stateT = 0;
          this.decideT = rand(6, 14);
        }
        break;
      }
      case 'ride': {
        const r = g.robot;
        this.x = damp(this.x, r.x, 18, dt);
        this.y = damp(this.y, r.y - 26, 18, dt);
        this.rideT -= dt;
        if (this.rideT <= 0 || ['align', 'empty', 'charge', 'docked'].includes(r.state)) {
          this.hopOff();
        }
        break;
      }
      case 'startle': {
        // leap away with a poof
        if (this.startleV) {
          this.x += this.startleV.x * dt;
          this.y += this.startleV.y * dt;
          this.startleV.x *= 1 - 3 * dt;
          this.startleV.y *= 1 - 3 * dt;
        }
        if (this.stateT > 0.7) {
          this.state = 'sit';
          this.stateT = 0;
          this.decideT = rand(4, 9);
        }
        break;
      }
    }

    // keep cat on the floor area
    const b = g.room.bounds;
    this.x = clamp(this.x, b.minX - 30, b.maxX + 30);
    this.y = clamp(this.y, b.minY - 40, b.maxY + 40);
  }

  beginWalk(forcedTarget = null) {
    this.target = forcedTarget || this.game.room.randomFloorPoint(50);
    this.state = 'walk';
    this.stateT = 0;
  }

  startle() {
    if (this.state === 'ride' || this.state === 'startle') return;
    const g = this.game;
    const away = angleTo(g.robot.x, g.robot.y, this.x, this.y);
    this.startleV = { x: Math.cos(away) * 420, y: Math.sin(away) * 420 };
    this.state = 'startle';
    this.stateT = 0;
    g.sound.meow();
    g.particles.dustPuff(this.x, this.y + 20, 6);
    g.particles.add({ x: this.x, y: this.y - 55, kind: 'note', color: '#ff5d8f', size: 20, vy: -70, life: 0.8 });
  }

  tryRide() {
    const r = this.game.robot;
    if (this.state === 'ride') return false;
    if (['align', 'empty', 'charge', 'docked'].includes(r.state)) return false;
    this.state = 'ride';
    this.rideT = rand(10, 16);
    this.stateT = 0;
    this.game.sound.meow();
    return true;
  }

  hopOff() {
    const g = this.game;
    this.state = 'walk';
    this.stateT = 0;
    const p = g.room.randomFloorPoint(50);
    this.target = p;
    g.particles.dustPuff(this.x, this.y + 30, 4);
  }

  onTap() {
    const g = this.game;
    if (this.meowCooldown > 0) return;
    this.meowCooldown = 0.7;
    if (this.state === 'ride') {
      g.sound.purr(1.4);
      g.particles.hearts(this.x, this.y - 40, 3);
      return;
    }
    if (this.state === 'sleep') {
      this.state = 'sit';
      this.stateT = 0;
      g.sound.meow();
      g.particles.add({ x: this.x, y: this.y - 60, kind: 'heart', color: '#ff8fab', size: 12, vy: -60, life: 1 });
      return;
    }
    // near the robot? hop on!
    if (dist(this.x, this.y, g.robot.x, g.robot.y) < 240 && chance(0.55) && this.tryRide()) return;
    g.sound.meow();
    if (chance(0.5)) this.beginWalk();
  }

  contains(x, y) {
    return dist(x, y, this.x, this.y) < 62;
  }

  draw(ctx, assets) {
    const g = this.game;
    const sleeping = this.state === 'sleep';
    const riding = this.state === 'ride';
    const img = sleeping
      ? (assets.get('cat_sleep') || assets.get('cat_sit'))
      : this.state === 'walk' ? assets.get('cat_walk') : assets.get('cat_sit');

    ctx.save();
    ctx.translate(this.x, this.y - this.bob - (riding ? 14 : 0));
    const facingLeft = Math.cos(this.heading) < 0 && this.state === 'walk';
    if (facingLeft) ctx.scale(-1, 1);

    if (img) {
      const s = sleeping ? 108 : 118;
      // shadow
      ctx.fillStyle = 'rgba(80,45,25,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, 36 + this.bob, 44, 14, 0, 0, TAU);
      ctx.fill();
      ctx.drawImage(img, -s / 2, -s / 2 - 8, s, s);
      ctx.restore();
      return;
    }

    // ------- procedural ginger cat -------
    ctx.fillStyle = 'rgba(80,45,25,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 36 + this.bob, 42, 13, 0, 0, TAU);
    ctx.fill();

    const orange = '#f2a252';
    const darkOrange = '#dd8a3a';
    if (sleeping) {
      // curled donut
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.ellipse(0, 14, 44, 30, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = darkOrange;
      ctx.beginPath();
      ctx.ellipse(0, 14, 44, 30, 0, Math.PI * 0.15, Math.PI * 0.6);
      ctx.ellipse(0, 14, 30, 20, 0, Math.PI * 0.6, Math.PI * 0.15, true);
      ctx.fill();
      // head resting
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.arc(-20, 2, 20, 0, TAU);
      ctx.fill();
      // ears
      ctx.beginPath();
      ctx.moveTo(-34, -8); ctx.lineTo(-30, -24); ctx.lineTo(-20, -14);
      ctx.moveTo(-12, -12); ctx.lineTo(-4, -24); ctx.lineTo(-2, -8);
      ctx.fill();
      // closed eyes
      ctx.strokeStyle = '#7a4a1d';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(-26, 2, 4.5, 0.2, Math.PI - 0.2);
      ctx.moveTo(-11, 2 + 4);
      ctx.arc(-15, 2, 4.5, 0.2, Math.PI - 0.2);
      ctx.stroke();
      // tail wrap
      ctx.strokeStyle = darkOrange;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(6, 22, 34, 0.3, Math.PI * 0.95);
      ctx.stroke();
    } else {
      // sitting / walking cat
      const walk = this.state === 'walk';
      // tail — swishy!
      ctx.strokeStyle = darkOrange;
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      const tailWave = Math.sin(this.tailT * 3) * 14;
      ctx.beginPath();
      ctx.moveTo(-28, 16);
      ctx.quadraticCurveTo(-52, 8 + tailWave * 0.4, -46, -22 + tailWave);
      ctx.stroke();
      // body
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.ellipse(-6, 12, 32, 24, 0, 0, TAU);
      ctx.fill();
      // stripes
      ctx.strokeStyle = darkOrange;
      ctx.lineWidth = 5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(-6 - i * 9, 8, 18, -1.1, 0.6);
        ctx.stroke();
      }
      // legs when walking
      if (walk) {
        ctx.strokeStyle = orange;
        ctx.lineWidth = 9;
        const step = Math.sin(this.stateT * 9) * 8;
        ctx.beginPath();
        ctx.moveTo(-16, 26); ctx.lineTo(-16 + step, 38);
        ctx.moveTo(6, 26); ctx.lineTo(6 - step, 38);
        ctx.stroke();
      }
      // head
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.arc(20, -8, 19, 0, TAU);
      ctx.fill();
      // ears
      ctx.beginPath();
      ctx.moveTo(6, -18); ctx.lineTo(9, -34); ctx.lineTo(19, -24);
      ctx.moveTo(24, -24); ctx.lineTo(32, -34); ctx.lineTo(34, -16);
      ctx.fill();
      ctx.fillStyle = '#f8c9d4';
      ctx.beginPath();
      ctx.moveTo(9.5, -21); ctx.lineTo(10.6, -29); ctx.lineTo(16, -24);
      ctx.fill();
      // face
      ctx.fillStyle = '#43302a';
      ctx.beginPath();
      ctx.arc(15, -9, 2.6, 0, TAU);
      ctx.arc(26, -9, 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e88';
      ctx.beginPath();
      ctx.moveTo(19, -4); ctx.lineTo(23, -4); ctx.lineTo(21, -1);
      ctx.fill();
      // whiskers
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(24, -3); ctx.lineTo(38, -6);
      ctx.moveTo(24, -1); ctx.lineTo(38, 2);
      ctx.moveTo(17, -3); ctx.lineTo(5, -5);
      ctx.stroke();
      // chest
      ctx.fillStyle = '#fbe3c4';
      ctx.beginPath();
      ctx.ellipse(16, 8, 10, 13, -0.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
