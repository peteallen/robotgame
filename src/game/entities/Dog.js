// A corgi puppy: naps in the pet bed, trots around, rides the robot...
// and occasionally does what dogs do on the floor. Robot vacuum life.
import { TAU, rand, pick, chance, dist, angleTo, angleApproach, clamp, damp } from '../core/math.js';

export class Dog {
  constructor(game) {
    this.game = game;
    this.home = { x: 165, y: 322 };
    this.x = this.home.x;
    this.y = this.home.y;
    this.state = 'sleep'; // sleep | sit | walk | ride | startle | goPotty | circling | squat | proud
    this.stateT = 0;
    this.heading = 0;
    this.target = null;
    this.decideT = rand(6, 12);
    this.bob = 0;
    this.tailT = rand(0, 9);
    this.zzzT = 0;
    this.rideT = 0;
    this.barkCooldown = 0;
    this.startleV = null;
    this.hurry = false;
    this.sniffT = 0;
    this.circleAnchor = null;
  }

  get baseline() {
    if (this.state === 'ride') return this.game.robot.y + 2;
    if (this.state === 'sleep') return this.y + 66;
    return this.y + 34;
  }

  pooping() {
    return ['goPotty', 'circling', 'squat', 'proud'].includes(this.state);
  }

  update(dt) {
    const g = this.game;
    this.stateT += dt;
    this.tailT += dt;
    if (this.barkCooldown > 0) this.barkCooldown -= dt;
    const trotting = this.state === 'walk' || this.state === 'goPotty';
    this.bob = Math.abs(Math.sin(this.stateT * 8)) * (trotting ? 6 : 0);

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
      case 'walk':
      case 'goPotty': {
        if (!this.target) {
          this.state = 'sit';
          break;
        }
        const speed = this.hurry || this.state === 'goPotty' ? 180 : 95;
        const a = angleTo(this.x, this.y, this.target.x, this.target.y);
        this.heading = angleApproach(this.heading, a, 4 * dt);
        this.x += Math.cos(this.heading) * speed * dt;
        this.y += Math.sin(this.heading) * speed * dt;
        if (dist(this.x, this.y, this.target.x, this.target.y) < 26) {
          if (this.state === 'goPotty') {
            this.circleAnchor = { x: this.x, y: this.y };
            this.state = 'circling';
            this.stateT = 0;
            this.sniffT = 0;
            this.target = null;
            break;
          }
          const wasHome = dist(this.x, this.y, this.home.x, this.home.y) < 70;
          this.target = null;
          this.state = wasHome ? 'sleep' : 'sit';
          this.stateT = 0;
          this.decideT = rand(6, 14);
        }
        break;
      }
      case 'circling': {
        // the ancient pre-poop ritual
        const c = this.circleAnchor;
        const a = this.stateT * 4.2;
        this.x = c.x + Math.cos(a) * 22;
        this.y = c.y + Math.sin(a) * 16;
        this.heading = a + Math.PI / 2;
        this.sniffT -= dt;
        if (this.sniffT <= 0) {
          this.sniffT = 0.6;
          g.sound.sniff();
        }
        if (this.stateT > 1.7) {
          this.state = 'squat';
          this.stateT = 0;
          this.x = c.x;
          this.y = c.y;
          this.heading = pick([0, Math.PI]); // side-on for the full silhouette
          g.sound.strain();
        }
        break;
      }
      case 'squat': {
        // concentration...
        if (this.stateT > 1.4 && !this.delivered) {
          this.delivered = true;
          const bx = this.x - Math.cos(this.heading) * 44;
          const by = this.y + 16;
          g.dirt.spawn('poop', bx, by, {});
          g.sound.plop();
          g.particles.dustPuff(bx, by, 4, 'rgba(150, 110, 70, 0.4)');
          g.onDogPoop?.();
        }
        if (this.stateT > 1.9) {
          this.state = 'proud';
          this.stateT = 0;
          this.delivered = false;
          g.sound.bark();
        }
        break;
      }
      case 'proud': {
        // so pleased with itself
        this.bob = Math.abs(Math.sin(this.stateT * 12)) * 8;
        if (this.stateT > 1.0) {
          this.hurry = false;
          this.beginWalk();
        }
        break;
      }
      case 'ride': {
        const r = g.robot;
        this.x = damp(this.x, r.x, 18, dt);
        this.y = damp(this.y, r.y - 26, 18, dt);
        this.rideT -= dt;
        if (this.rideT <= 0 || ['align', 'empty', 'charge', 'docked', 'washpads'].includes(r.state)) {
          this.hopOff();
        }
        break;
      }
      case 'startle': {
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

    // keep the pup on the floor area
    const b = g.room.bounds;
    this.x = clamp(this.x, b.minX - 30, b.maxX + 30);
    this.y = clamp(this.y, b.minY - 40, b.maxY + 40);
  }

  beginWalk(forcedTarget = null) {
    this.target = forcedTarget || this.game.room.randomFloorPoint(50);
    this.state = 'walk';
    this.stateT = 0;
  }

  // trot off to a good spot and do the deed
  startPottyRun() {
    if (this.state === 'ride' || this.pooping()) return false;
    const g = this.game;
    let spot = null;
    for (let i = 0; i < 40; i++) {
      const p = g.room.randomFloorPoint(55);
      if (p.y > 400 && dist(p.x, p.y, g.robot.x, g.robot.y) > 200 &&
          g.room.isFree(p.x, p.y, 60, { solidTable: true })) {
        spot = p;
        break;
      }
    }
    if (!spot) spot = g.room.randomFloorPoint(55);
    this.target = spot;
    this.state = 'goPotty';
    this.stateT = 0;
    this.delivered = false;
    g.sound.bark();
    return true;
  }

  startle() {
    if (this.state === 'ride' || this.state === 'startle' || this.pooping()) return;
    const g = this.game;
    const away = angleTo(g.robot.x, g.robot.y, this.x, this.y);
    this.startleV = { x: Math.cos(away) * 420, y: Math.sin(away) * 420 };
    this.state = 'startle';
    this.stateT = 0;
    g.sound.yelp();
    g.particles.dustPuff(this.x, this.y + 20, 6);
  }

  tryRide() {
    const r = this.game.robot;
    if (this.state === 'ride' || this.pooping()) return false;
    if (['align', 'empty', 'charge', 'docked', 'washpads'].includes(r.state)) return false;
    this.state = 'ride';
    this.rideT = rand(10, 16);
    this.stateT = 0;
    this.game.sound.bark();
    return true;
  }

  hopOff() {
    const g = this.game;
    this.state = 'walk';
    this.stateT = 0;
    this.target = g.room.randomFloorPoint(50);
    g.particles.dustPuff(this.x, this.y + 30, 4);
  }

  onTap() {
    const g = this.game;
    if (this.barkCooldown > 0) return;
    this.barkCooldown = 0.7;
    if (this.state === 'ride') {
      g.sound.bark();
      g.particles.hearts(this.x, this.y - 40, 3);
      return;
    }
    // toddler's orders: tapping the dog starts the potty show (when the room
    // isn't already mid-disaster)
    if (!g.messActive() && this.startPottyRun()) return;
    if (this.state === 'sleep') {
      this.state = 'sit';
      this.stateT = 0;
      g.sound.bark();
      g.particles.add({ x: this.x, y: this.y - 60, kind: 'heart', color: '#ff8fab', size: 12, vy: -60, life: 1 });
      return;
    }
    if (dist(this.x, this.y, g.robot.x, g.robot.y) < 240 && chance(0.55) && this.tryRide()) return;
    g.sound.bark();
    if (chance(0.5)) this.beginWalk();
  }

  contains(x, y) {
    return dist(x, y, this.x, this.y) < 62;
  }

  draw(ctx, assets) {
    const sleeping = this.state === 'sleep';
    const riding = this.state === 'ride';
    const squatting = this.state === 'squat';
    const img = sleeping
      ? (assets.get('dog_sleep') || assets.get('dog_sit'))
      : (this.state === 'walk' || this.state === 'goPotty' || this.state === 'circling')
        ? assets.get('dog_walk')
        : assets.get('dog_sit');

    ctx.save();
    ctx.translate(this.x, this.y - this.bob - (riding ? 14 : 0));
    const facingLeft = Math.cos(this.heading) < 0 && ['walk', 'goPotty', 'circling'].includes(this.state);
    if (facingLeft) ctx.scale(-1, 1);
    if (squatting) {
      // hunched, trembling concentration
      ctx.translate(0, 10);
      ctx.scale(1.06, 0.82);
      ctx.rotate(Math.sin(this.stateT * 26) * 0.03);
    }
    if (this.state === 'proud') {
      ctx.rotate(Math.sin(this.stateT * 12) * 0.08);
    }

    // shadow
    ctx.fillStyle = 'rgba(80,45,25,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 36 + this.bob, 44, 14, 0, 0, TAU);
    ctx.fill();

    if (img) {
      const s = sleeping ? 108 : 120;
      ctx.drawImage(img, -s / 2, -s / 2 - 8, s, s);
      ctx.restore();
      return;
    }

    // ------- procedural corgi fallback -------
    const orange = '#e8933f';
    const cream = '#fbe8cc';
    if (sleeping) {
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.ellipse(0, 14, 44, 30, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.ellipse(8, 22, 26, 14, 0, 0, TAU);
      ctx.fill();
      // head + big ears
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.arc(-20, 2, 20, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-36, -6); ctx.lineTo(-34, -30); ctx.lineTo(-20, -14);
      ctx.moveTo(-12, -12); ctx.lineTo(-2, -30); ctx.lineTo(2, -8);
      ctx.fill();
      ctx.strokeStyle = '#7a4a1d';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(-26, 2, 4.5, 0.2, Math.PI - 0.2);
      ctx.moveTo(-11, 6);
      ctx.arc(-15, 2, 4.5, 0.2, Math.PI - 0.2);
      ctx.stroke();
    } else {
      // tail — a happy nub that wags fast
      const wag = Math.sin(this.tailT * (this.state === 'proud' ? 22 : 9)) * 0.5;
      ctx.save();
      ctx.translate(-30, 4);
      ctx.rotate(-0.5 + wag);
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.ellipse(0, -8, 9, 13, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      // body
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.ellipse(-6, 12, 32, 22, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.ellipse(0, 22, 24, 11, 0, 0, TAU);
      ctx.fill();
      // stumpy legs
      const walk = ['walk', 'goPotty', 'circling'].includes(this.state);
      ctx.strokeStyle = orange;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      const step = walk ? Math.sin(this.stateT * 9) * 7 : 0;
      ctx.beginPath();
      ctx.moveTo(-16, 26); ctx.lineTo(-16 + step, 37);
      ctx.moveTo(6, 26); ctx.lineTo(6 - step, 37);
      ctx.stroke();
      // head
      ctx.fillStyle = orange;
      ctx.beginPath();
      ctx.arc(20, -8, 20, 0, TAU);
      ctx.fill();
      // giant corgi ears
      ctx.beginPath();
      ctx.moveTo(4, -18); ctx.lineTo(6, -42); ctx.lineTo(19, -22);
      ctx.moveTo(24, -22); ctx.lineTo(33, -42); ctx.lineTo(37, -16);
      ctx.fill();
      ctx.fillStyle = '#f8c9d4';
      ctx.beginPath();
      ctx.moveTo(8, -24); ctx.lineTo(9, -35); ctx.lineTo(16, -25);
      ctx.fill();
      // face
      ctx.fillStyle = cream;
      ctx.beginPath();
      ctx.ellipse(24, -2, 11, 9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#43302a';
      ctx.beginPath();
      ctx.arc(15, -10, 2.8, 0, TAU);
      ctx.arc(27, -10, 2.8, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(24, -2, 3.4, 0, TAU);
      ctx.fill();
      // tongue
      if (this.state === 'proud' || chance(0.0)) {
        ctx.fillStyle = '#ff8fab';
        ctx.beginPath();
        ctx.ellipse(26, 5, 3.5, 6, 0.2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
