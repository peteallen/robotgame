// Robo — the robot vacuum star of the show.
// Real-robot behaviors: straight-line wander with bump-and-turn, spiral
// cleaning, wall following, docking to auto-empty + fast-charge.
import { TAU, clamp, lerp, rand, pick, chance, dist, angleTo, angleDiff, angleApproach, damp, easeOutCubic } from '../core/math.js';
import { roundRect } from '../world/Room.js';

const R = 56; // robot radius in world units

export class Robot {
  constructor(game) {
    this.game = game;
    const dock = game.dock;
    this.x = dock.x;
    this.y = dock.parkY;
    this.radius = R;
    this.heading = Math.PI / 2; // facing down/out of dock
    this.speed = 0;
    this.targetSpeed = 0;
    this.turnRate = 3.2;

    this.state = 'docked';
    this.stateT = 0;
    this.dockReason = null;
    this.cleanMode = 'wander';
    this.modeTimer = 4;
    this.spiralDir = 1;
    this.spiralT = 0;
    this.wall = null;
    this.bump = null;
    this.pauseT = 0;
    this.seekDirt = null;
    this.seekCheckT = 1;
    this.chirpT = rand(5, 10);
    this.stuckT = 0;
    this.lastX = this.x;
    this.lastY = this.y;

    this.battery = 0.85;
    this.bin = 0.2;
    this.suctionOn = false;
    this.stayDocked = false; // parked via dock tap, naps until tapped awake
    this.napT = 0;
    this.backupBeepT = 0;
    this.seekT = 0;

    // visuals
    this.z = 0;
    this.vz = 0;
    this.squish = 0;
    this.spinExtra = 0;
    this.wobbleT = 0;
    this.blinkT = rand(2, 5);
    this.blink = 0;
    this.face = null; // {expr, until}
    this.lidarSpin = 0;
    this.brushSpin = 0;
    this.bumpFlash = 0;
    this.chargeGlow = 0;
    this.emptyShake = 0;
    this.trailMode = null;
    this.trail = [];
    this.trailT = 0;
    this.rainbowHue = 0;

    // combo / celebration
    this.recentPickups = [];

    // action control
    this.controlled = false;

    this.dockedUndockT = 1.2;
  }

  // ---- helpers for actions & systems -------------------------------------

  mouthPos() {
    return {
      x: this.x + Math.cos(this.heading) * R * 0.72,
      y: this.y + Math.sin(this.heading) * R * 0.72,
    };
  }

  setExpr(expr, dur = 1.2) {
    this.face = { expr, until: this.game.time + dur };
  }

  hop(v = 260) {
    if (this.z <= 1) {
      this.vz = v;
      this.game.sound.boing();
    }
  }

  takeControl() {
    this.controlled = true;
    this.state = 'action';
    this.bump = null;
    this.seekDirt = null;
  }

  release() {
    this.controlled = false;
    this.trailMode = null;
    if (this.stayDocked) {
      this.goDock('summon');
    } else if (this.bin >= 1 || this.battery <= 0.16) {
      this.goDock(this.bin >= 1 ? 'bin' : 'battery');
    } else {
      this.state = 'clean';
      this.cleanMode = 'wander';
      this.modeTimer = rand(6, 10);
      this.targetSpeed = 130;
    }
  }

  // Steer toward a point with obstacle avoidance. Returns true when arrived.
  driveTo(tx, ty, speed = 160, arrive = 26, opts = {}) {
    const d = dist(this.x, this.y, tx, ty);
    if (d < arrive) {
      this.targetSpeed = 0;
      return true;
    }
    // committed escape maneuver after getting pinned on an obstacle
    if (this.escape && this.game.time < this.escape.until) {
      this.heading = angleApproach(this.heading, this.escape.heading, 6 * this.game.dt);
      this.targetSpeed = 110;
      return false;
    }
    const want = angleTo(this.x, this.y, tx, ty);
    const room = this.game.room;
    // probe slightly LARGER than the physics radius so "probe says go,
    // physics says no" pinning can't happen
    const free = (a, len) =>
      room.isFree(this.x + Math.cos(a) * len, this.y + Math.sin(a) * len, R + 5, opts);
    let best = want;
    if (!free(want, 95) || !free(want, 50)) {
      const options = [0.55, -0.55, 1.1, -1.1, 1.7, -1.7];
      best = null;
      for (const off of options) {
        if (free(want + off, 95)) {
          best = want + off;
          break;
        }
      }
      if (best == null) best = want + Math.PI * 0.8;
    }
    this.heading = angleApproach(this.heading, best, this.turnRate * 1.4 * this.game.dt);
    // slow down for sharp turns so it looks deliberate
    const misalign = Math.abs(angleDiff(this.heading, want));
    this.targetSpeed = speed * clamp(1.15 - misalign * 0.6, 0.35, 1);
    return false;
  }

  // find an open direction and commit to it briefly
  startEscape() {
    const room = this.game.room;
    for (let i = 0; i < 8; i++) {
      const a = this.heading + Math.PI + (i - 4) * 0.7 + rand(-0.2, 0.2);
      if (room.isFree(this.x + Math.cos(a) * 130, this.y + Math.sin(a) * 130, R + 5)) {
        this.escape = { heading: a, until: this.game.time + 0.9 };
        return;
      }
    }
    this.escape = { heading: this.heading + Math.PI, until: this.game.time + 0.9 };
  }

  faceAngle(a, rate = 3.5) {
    this.targetSpeed = 0;
    this.heading = angleApproach(this.heading, a, rate * this.game.dt);
    return Math.abs(angleDiff(this.heading, a)) < 0.06;
  }

  goDock(reason) {
    this.dockReason = reason;
    this.state = 'godock';
    this.seekDirt = null;
    this.bump = null;
    if (reason === 'battery') {
      this.setExpr('sleepy', 3);
      this.game.sound.sleepyBeep();
    } else if (reason === 'bin') {
      this.setExpr('full', 3);
      this.game.sound.ackBeep();
    } else {
      this.game.sound.ackBeep();
    }
  }

  summon() {
    // tapping the dock always means "go home and STAY until tapped awake"
    this.stayDocked = true;
    if (['docked', 'charge', 'empty', 'align'].includes(this.state)) return;
    if (this.controlled) return; // release() sends it home when the action ends
    this.goDock('summon');
  }

  wake() {
    this.stayDocked = false;
    const g = this.game;
    g.sound.happyBeeps(3);
    g.particles.hearts(this.x, this.y - 60, 3);
    this.setExpr('happy', 1.5);
    if (this.state === 'docked') {
      this.dockedUndockT = 0.4;
    } else if (this.state === 'godock' && this.dockReason === 'summon') {
      // caught mid-way home: never mind, back to cleaning!
      this.state = 'clean';
      this.cleanMode = 'wander';
      this.modeTimer = rand(6, 10);
    }
  }

  notifyNewDirt(d) {
    if (this.controlled) return;
    if (this.state === 'clean' || this.state === 'seek') {
      this.seekDirt = d;
      this.seekT = 0;
      this.state = 'seek';
      if (chance(0.5)) this.game.sound.ackBeep();
      this.setExpr('determined', 1.6);
    } else if (this.state === 'docked' && !this.stayDocked) {
      // wake up for the player!
      this.dockedUndockT = Math.min(this.dockedUndockT, 0.4);
    }
  }

  onDirtCaught() {
    this.game.sound.bigSuckSmall?.();
  }

  onDirtSwallowed(d) {
    const g = this.game;
    this.bin = clamp(this.bin + (d.type === 'dustbunny' ? 0.11 : 0.075), 0, 1);
    const mouth = this.mouthPos();
    if (d.type === 'sparkle') {
      g.sound.sparklePickup();
      g.particles.sparkle(mouth.x, mouth.y, 10);
    } else {
      g.sound.suckPop();
      g.particles.dustPuff(mouth.x, mouth.y, 5);
    }
    g.onPickup(d);
    // combo joy
    const now = g.time;
    this.recentPickups = this.recentPickups.filter((t) => now - t < 2.2);
    this.recentPickups.push(now);
    if (this.recentPickups.length === 3) {
      this.setExpr('love', 1.6);
      g.sound.happyBeeps(5);
      g.particles.hearts(this.x, this.y - 40, 6);
    }
    if (this.bin >= 1 && !this.controlled && this.state !== 'godock' && this.state !== 'align') {
      this.goDock('bin');
    }
  }

  // ---- update -------------------------------------------------------------

  update(dt) {
    const g = this.game;
    this.stateT += dt;
    this.wobbleT += dt;
    this.lidarSpin += dt * (this.suctionOn ? 7 : 2);
    this.brushSpin += dt * (this.suctionOn ? 22 : 4);
    if (this.bumpFlash > 0) this.bumpFlash -= dt;
    if (this.emptyShake > 0) this.emptyShake -= dt;

    // hop physics
    if (this.z > 0 || this.vz !== 0) {
      this.vz -= 1300 * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        if (this.vz < -150) {
          this.squish = 1;
          g.particles.dustPuff(this.x, this.y + 20, 6);
        }
        this.vz = 0;
      }
    }
    this.squish = Math.max(0, this.squish - dt * 4);

    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.14;
      this.blinkT = rand(2.4, 5.5);
    }
    if (this.blink > 0) this.blink -= dt;

    // battery drain while out and about
    const active = !['docked', 'charge', 'empty'].includes(this.state);
    if (active && !g.freezeBattery) {
      this.battery = clamp(this.battery - dt / 150, 0, 1);
      if (this.battery <= 0.16 && !this.controlled && !['godock', 'align'].includes(this.state)) {
        this.goDock('battery');
      }
    }

    if (!this.controlled) this.updateState(dt);

    // physics: move
    this.speed = damp(this.speed, this.targetSpeed, 6, dt);
    if (Math.abs(this.speed) > 2) {
      const nx = this.x + Math.cos(this.heading) * this.speed * dt;
      const ny = this.y + Math.sin(this.heading) * this.speed * dt;
      const dockingStates = ['align', 'docked', 'empty', 'charge', 'leaving'];
      const opts = {
        ignoreDock: dockingStates.includes(this.state) || this.state === 'godock',
        ignoreCouch: this.allowUnderCouch === true,
      };
      if (g.room.isFree(nx, ny, R, opts)) {
        this.x = nx;
        this.y = ny;
      } else if (!g.room.isFree(this.x, this.y, R, opts)) {
        // already embedded in an obstacle (teleport/edge case) — let it
        // drive out instead of being pinned forever
        this.x = nx;
        this.y = ny;
      } else {
        const hit = g.room.collisionNormal(nx, ny, R, opts);
        this.onBump(hit);
      }
    }

    // suction
    this.suctionOn = ['clean', 'seek', 'leaving'].includes(this.state) ||
      (this.state === 'action' && this.actionSuction === true);
    if (this.suctionOn && Math.abs(this.speed) > 10) {
      g.dirt.trySuck(this);
    }

    // hum follows motion
    if (g.sound.ready) {
      if (this.suctionOn || this.state === 'godock' || this.state === 'action') {
        g.sound.startHum();
        g.sound.setHumIntensity(clamp(Math.abs(this.speed) / 170, 0.15, 1.6));
      } else {
        g.sound.setHumIntensity(0.05);
        if (['docked', 'charge', 'empty'].includes(this.state)) g.sound.stopHum();
      }
    }

    // occasional personality chirps
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      this.chirpT = rand(7, 15);
      if (this.state === 'clean' && chance(0.7)) {
        g.sound.happyBeeps(chance(0.5) ? 2 : 3);
      }
    }

    // trail recording
    if (this.trailMode) {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.024;
        this.trail.push({ x: this.x, y: this.y, age: 0, hue: this.rainbowHue });
        this.rainbowHue = (this.rainbowHue + 9) % 360;
      }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].age += dt;
      if (this.trail[i].age > (this.trailMode === 'turbo' ? 0.5 : 1.6)) this.trail.splice(i, 1);
    }

    // stuck detection for nav states (incl. actions driving via driveTo)
    if (['godock', 'seek', 'action'].includes(this.state)) {
      this.stuckT += dt;
      if (this.stuckT > 1.1) {
        if (dist(this.x, this.y, this.lastX, this.lastY) < 18 && Math.abs(this.targetSpeed) > 20) {
          this.startEscape();
        }
        this.stuckT = 0;
        this.lastX = this.x;
        this.lastY = this.y;
      }
    }
  }

  updateState(dt) {
    const g = this.game;
    switch (this.state) {
      case 'docked': {
        this.targetSpeed = 0;
        if (this.stayDocked) {
          // parked on purpose — settle in for a nap until tapped awake
          if (this.stateT > 3.5) {
            this.napT -= dt;
            if (this.napT <= 0) {
              this.napT = rand(2.2, 3.6);
              g.particles.zzz(this.x + 24, this.y - 58);
              if (chance(0.3)) g.sound.snore();
            }
          }
          break;
        }
        this.dockedUndockT -= dt;
        if (this.dockedUndockT <= 0) {
          this.state = 'leaving';
          this.stateT = 0;
          g.sound.undockChime();
        }
        break;
      }
      case 'leaving': {
        if (this.driveTo(g.dock.approach.x, g.dock.approach.y + 30, 120, 30, { ignoreDock: true })) {
          this.state = 'clean';
          this.cleanMode = 'wander';
          this.modeTimer = rand(7, 12);
          this.heading = rand(0.3, Math.PI - 0.3);
        }
        break;
      }
      case 'clean': {
        this.updateClean(dt);
        break;
      }
      case 'seek': {
        if (!this.seekDirt || this.seekDirt.sucking || !g.dirt.items.includes(this.seekDirt)) {
          const next = g.dirt.nearestVac(this.x, this.y, true) || (chance(0.5) ? g.dirt.nearestVac(this.x, this.y) : null);
          if (next && dist(this.x, this.y, next.x, next.y) < 900) {
            this.seekDirt = next;
            this.seekT = 0;
          } else {
            this.seekDirt = null;
            this.state = 'clean';
            this.cleanMode = 'wander';
            this.modeTimer = rand(6, 11);
            break;
          }
        }
        // can't get to it (e.g. wedged behind table legs)? shrug and move on —
        // real robots give up too
        this.seekT += dt;
        if (this.seekT > 8) {
          this.seekDirt.shunned = g.time + 30;
          this.seekDirt = null;
          this.seekT = 0;
          g.sound.questionBeep();
          this.setExpr('dizzy', 1.2);
          break;
        }
        this.driveTo(this.seekDirt.x, this.seekDirt.y, 175, 20);
        break;
      }
      case 'godock': {
        const a = g.dock.approach;
        if (this.driveTo(a.x, a.y, 165, 30, { ignoreDock: true })) {
          this.state = 'align';
          this.stateT = 0;
        }
        break;
      }
      case 'align': {
        // like a real robot vacuum: spin 180 to face AWAY from the dock,
        // then carefully BACK IN (with a backup beeper, naturally)
        if (this.faceAngle(Math.PI / 2, 2.8)) {
          this.heading = Math.PI / 2;
          this.targetSpeed = -62; // reversing!
          this.x = damp(this.x, g.dock.x, 5, dt);
          this.backupBeepT -= dt;
          if (this.backupBeepT <= 0) {
            this.backupBeepT = 0.72;
            g.sound.backupBeep();
          }
          if (this.y <= g.dock.parkY) {
            this.y = g.dock.parkY;
            this.x = damp(this.x, g.dock.x, 10, dt);
            this.targetSpeed = 0;
            this.speed = 0;
            this.arriveAtDock();
          }
        }
        // safety: something interfered with the maneuver — take another run at it
        if (this.state === 'align' && this.stateT > 8) {
          this.state = 'godock';
          this.stateT = 0;
        }
        break;
      }
      case 'empty': {
        this.targetSpeed = 0;
        this.emptyShake = 0.1;
        g.dock.pullDust(this);
        g.shake(2);
        if (this.stateT > 3.0) {
          this.bin = 0;
          g.dock.bagFill = clamp(g.dock.bagFill + 0.14, 0, 1);
          g.sound.dockChime();
          g.particles.sparkle(g.dock.x, g.dock.y - 120, 12);
          if (this.battery < 0.95) {
            this.state = 'charge';
            this.stateT = 0;
            this.chargeBlipLevel = Math.floor(this.battery * 5);
          } else {
            this.state = 'docked';
            this.dockedUndockT = 1.2;
            this.setExpr('happy', 1.5);
          }
        } else {
          this.bin = Math.max(0, this.bin - dt / 2.8);
        }
        break;
      }
      case 'charge': {
        this.targetSpeed = 0;
        this.battery = clamp(this.battery + dt / 4.6, 0, 1); // FAST charging!
        this.chargeGlow = 1;
        const lvl = Math.floor(this.battery * 5);
        if (lvl > (this.chargeBlipLevel ?? 0)) {
          this.chargeBlipLevel = lvl;
          g.sound.chargeBlip(this.battery);
          g.particles.add({
            x: this.x + rand(-20, 20), y: this.y - 30,
            vy: -70, kind: 'star', color: '#7ef29d',
            life: 0.7, size: 8,
          });
        }
        if (this.battery >= 1) {
          g.sound.fullChargeFanfare();
          g.particles.burst(this.x, this.y - 40, 'star', 14, { colors: ['#7ef29d', '#c5ffd9', '#fff'], speedMin: 60, speedMax: 200, lifeMin: 0.5, lifeMax: 1 });
          this.setExpr('happy', 2);
          this.state = 'docked';
          this.stateT = 0;
          this.dockedUndockT = 1.4;
        }
        break;
      }
    }
  }

  updateClean(dt) {
    const g = this.game;
    // pause-and-look-around moments
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      this.targetSpeed = 0;
      return;
    }
    this.modeTimer -= dt;
    if (this.modeTimer <= 0) {
      const roll = Math.random();
      if (roll < 0.22) {
        this.cleanMode = 'spiral';
        this.spiralT = 0;
        this.spiralDir = pick([-1, 1]);
        this.modeTimer = rand(4.5, 6);
      } else if (roll < 0.36) {
        this.cleanMode = 'wall';
        this.modeTimer = rand(4, 7);
      } else if (roll < 0.46) {
        this.pauseT = rand(0.7, 1.3);
        this.game.sound.questionBeep();
        this.modeTimer = rand(6, 11);
        return;
      } else {
        this.cleanMode = 'wander';
        this.modeTimer = rand(7, 13);
        this.heading += rand(-0.8, 0.8);
      }
    }

    // chance to notice dirt nearby
    this.seekCheckT -= dt;
    if (this.seekCheckT <= 0) {
      this.seekCheckT = 1.4;
      const player = g.dirt.nearestVac(this.x, this.y, true);
      const target = player || g.dirt.nearestVac(this.x, this.y);
      if (target) {
        const d = dist(this.x, this.y, target.x, target.y);
        if (player || (d < 460 && chance(0.55))) {
          this.seekDirt = target;
          this.state = 'seek';
          return;
        }
      }
    }

    // bump recovery sequence
    if (this.bump) {
      const b = this.bump;
      b.t += dt;
      if (b.phase === 'reverse') {
        this.targetSpeed = -70;
        if (b.t > 0.28) {
          b.phase = 'turn';
          b.t = 0;
        }
      } else {
        this.targetSpeed = 0;
        this.heading = angleApproach(this.heading, b.newHeading, 4.5 * dt);
        if (Math.abs(angleDiff(this.heading, b.newHeading)) < 0.08) {
          this.bump = null;
        }
      }
      return;
    }

    switch (this.cleanMode) {
      case 'wander':
        this.targetSpeed = 135;
        break;
      case 'spiral': {
        this.spiralT += dt;
        this.targetSpeed = 120;
        const rate = clamp(2.8 - this.spiralT * 0.45, 0.7, 2.8);
        this.heading += rate * this.spiralDir * dt;
        break;
      }
      case 'wall': {
        // follow the nearest wall, keeping it on the robot's left
        this.targetSpeed = 140;
        const b = g.room.bounds;
        const margin = 40;
        const dLeft = this.x - b.minX;
        const dRight = b.maxX - this.x;
        const dTop = this.y - b.minY;
        const dBot = b.maxY - this.y;
        const m = Math.min(dLeft, dRight, dTop, dBot);
        let wantHeading;
        if (m === dTop) wantHeading = 0;
        else if (m === dRight) wantHeading = Math.PI / 2;
        else if (m === dBot) wantHeading = Math.PI;
        else wantHeading = -Math.PI / 2;
        // drift gently toward the wall to hug it
        const hug = clamp((m - 110) / 200, -1, 1);
        const toWall = m === dTop ? -Math.PI / 2 : m === dRight ? 0 : m === dBot ? Math.PI / 2 : Math.PI;
        const target = wantHeading + angleDiff(wantHeading, toWall) * 0 + hug * 0.35 * (angleDiff(wantHeading, toWall) > 0 ? 1 : -1);
        this.heading = angleApproach(this.heading, target, 2.2 * dt);
        break;
      }
    }
  }

  onBump(hit) {
    const g = this.game;
    this.speed *= 0.2;
    if (this.state === 'clean') {
      if (!this.bump) {
        g.sound.bump();
        this.bumpFlash = 0.25;
        this.squish = 0.8;
        const mouth = this.mouthPos();
        g.particles.dustPuff(mouth.x, mouth.y, 4);
        let base;
        if (hit) base = Math.atan2(hit.ny, hit.nx);
        else base = this.heading + Math.PI;
        const newHeading = base + rand(-0.9, 0.9);
        this.bump = { phase: 'reverse', t: 0, newHeading };
        if (this.cleanMode === 'spiral') this.cleanMode = 'wander';
        if (chance(0.12)) {
          this.setExpr('dizzy', 1);
          g.sound.questionBeep();
        }
        // bumping the cat!
        const cat = g.cat;
        if (cat && dist(this.x, this.y, cat.x, cat.y) < R + 55 && cat.state !== 'ride') {
          cat.startle();
        }
      }
    } else if (['seek', 'godock', 'leaving', 'action'].includes(this.state)) {
      // physically blocked mid-navigation: commit to an escape direction
      if (!this.escape || this.game.time >= this.escape.until) this.startEscape();
    }
    // push toy balls around!
    // (handled by game via proximity, not collision)
  }

  arriveAtDock() {
    const g = this.game;
    g.sound.dockChime();
    g.dock.glow = 2;
    g.particles.sparkle(this.x, this.y - 30, 6);
    // backed in: face out into the room, rear (dust port) against the tower
    this.heading = Math.PI / 2;
    if (this.bin > 0.4 || this.dockReason === 'bin') {
      this.state = 'empty';
      this.stateT = 0;
      g.sound.emptyRoar(3.0);
      this.setExpr('effort', 3);
    } else if (this.battery < 0.95) {
      this.state = 'charge';
      this.stateT = 0;
      this.chargeBlipLevel = Math.floor(this.battery * 5);
    } else {
      this.state = 'docked';
      this.stateT = 0;
      this.dockedUndockT = 1.5;
      this.setExpr('happy', 1.4);
    }
  }

  // ---- drawing ------------------------------------------------------------

  drawTrail(ctx) {
    if (!this.trail.length) return;
    if (this.trailMode === 'rainbow') {
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const q = this.trail[i - 1];
        const a = clamp(1 - p.age / 1.6, 0, 1);
        ctx.strokeStyle = `hsla(${p.hue}, 85%, 62%, ${a * 0.85})`;
        ctx.lineWidth = 34 * a + 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    } else if (this.trailMode === 'turbo') {
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const q = this.trail[i - 1];
        const a = clamp(1 - p.age / 0.5, 0, 1);
        ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.5})`;
        ctx.lineWidth = 20 * a + 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  currentExpr() {
    if (this.face && this.game.time < this.face.until) return this.face.expr;
    if (this.state === 'charge') return 'charge';
    if (this.state === 'empty') return 'effort';
    if (this.state === 'docked' && this.stayDocked && this.stateT > 3.5) return 'sleepy';
    if (this.state === 'docked') return 'happy';
    if (this.battery < 0.2) return 'sleepy';
    if (this.bin > 0.88) return 'full';
    if (this.state === 'seek') return 'determined';
    if (this.cleanMode === 'spiral' && this.state === 'clean') return 'happy';
    return 'normal';
  }

  draw(ctx, assets) {
    const g = this.game;
    const img = assets.get('robot');
    const shake = this.emptyShake > 0 ? Math.sin(g.time * 60) * 2.2 : 0;

    // shadow
    const shadowScale = 1 - clamp(this.z / 300, 0, 0.45);
    ctx.fillStyle = `rgba(80, 45, 25, ${0.28 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 14, R * 1.02 * shadowScale, R * 0.52 * shadowScale, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(this.x + shake, this.y - this.z);
    const sq = 1 + this.squish * 0.12;
    ctx.scale(sq, 1 / sq);
    ctx.rotate(this.heading + Math.PI / 2 + this.spinExtra); // sprite faces up

    // driving wiggle
    if (Math.abs(this.speed) > 40) {
      ctx.rotate(Math.sin(this.wobbleT * 13) * 0.015);
    }

    // side brushes peeking out (under body) — they spin!
    this.drawBrush(ctx, -R * 0.68, -R * 0.6);
    this.drawBrush(ctx, R * 0.68, -R * 0.6);

    if (img) {
      const s = R * 2.3;
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
    } else {
      this.drawBody(ctx);
    }

    this.drawFaceAndLights(ctx);
    ctx.restore();

    // charge bolt above robot
    if (this.state === 'charge') {
      const t = g.time;
      const bob = Math.sin(t * 5) * 5;
      ctx.save();
      ctx.translate(this.x, this.y - 105 - bob);
      const pulse = 0.8 + 0.2 * Math.sin(t * 9);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#7ef29d';
      ctx.strokeStyle = 'rgba(30, 120, 60, 0.6)';
      ctx.lineWidth = 3;
      drawBolt(ctx, 0, 0, 26);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBrush(ctx, bx, by) {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.brushSpin * (bx < 0 ? 1 : -1));
    ctx.strokeStyle = 'rgba(90, 90, 100, 0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + 0.5) * 12, Math.sin(a + 0.5) * 12, Math.cos(a) * 22, Math.sin(a) * 22);
      ctx.stroke();
    }
    ctx.fillStyle = '#4a4e5c';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawBody(ctx) {
    // outer ring
    ctx.fillStyle = '#333947';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    // main body
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R);
    g.addColorStop(0, '#8ff0e0');
    g.addColorStop(0.55, '#45cdbb');
    g.addColorStop(1, '#28a394');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R - 6, 0, TAU);
    ctx.fill();
    // front bumper (top in body space)
    ctx.fillStyle = this.bumpFlash > 0 ? '#ffd23f' : '#2b8377';
    ctx.beginPath();
    ctx.arc(0, 0, R - 2, -Math.PI * 0.88, -Math.PI * 0.12);
    ctx.arc(0, 0, R - 16, -Math.PI * 0.12, -Math.PI * 0.88, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, R - 5, -Math.PI * 0.78, -Math.PI * 0.55);
    ctx.arc(0, 0, R - 11, -Math.PI * 0.55, -Math.PI * 0.78, true);
    ctx.closePath();
    ctx.fill();
    // dust window (rear)
    ctx.fillStyle = 'rgba(25, 32, 40, 0.55)';
    roundRect(ctx, -26, R * 0.36, 52, 22, 9);
    ctx.fill();
  }

  drawFaceAndLights(ctx) {
    const expr = this.currentExpr();
    // dust fill in rear window
    const fill = this.bin;
    ctx.save();
    roundRect(ctx, -24, R * 0.38, 48, 18, 7);
    ctx.clip();
    ctx.fillStyle = 'rgba(200, 190, 180, 0.28)';
    ctx.fillRect(-24, R * 0.38, 48, 18);
    ctx.fillStyle = fill > 0.85 ? 'rgba(255, 160, 80, 0.95)' : 'rgba(168, 155, 145, 0.95)';
    ctx.fillRect(-24, R * 0.38 + 18 * (1 - fill), 48, 18 * fill + 1);
    // little specks
    ctx.fillStyle = 'rgba(110, 100, 92, 0.8)';
    for (let i = 0; i < 4; i++) {
      const sx = -18 + i * 11;
      const sy = R * 0.38 + 18 - 18 * fill * ((i % 3) / 3 + 0.3);
      if (fill > 0.1) {
        ctx.beginPath();
        ctx.arc(sx, sy, 2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();

    // lidar turret
    ctx.fillStyle = '#1f2734';
    ctx.beginPath();
    ctx.arc(0, -2, 25, 0, TAU);
    ctx.fill();
    const ringColor =
      this.state === 'charge' ? '#7ef29d'
      : this.bin > 0.88 ? '#ffb42e'
      : this.state === 'action' ? '#ff5d8f'
      : '#4cc9f0';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.wobbleT * 3);
    ctx.beginPath();
    ctx.arc(0, -2, 28, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // spinning lidar glint
    ctx.fillStyle = 'rgba(120, 220, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(Math.cos(this.lidarSpin) * 17, -2 + Math.sin(this.lidarSpin) * 17, 3.2, 0, TAU);
    ctx.fill();

    // LED eyes on the turret screen
    const blinking = this.blink > 0;
    ctx.save();
    ctx.translate(0, -2);
    const eyeGlow = (draw) => {
      ctx.shadowColor = 'rgba(120, 230, 255, 0.9)';
      ctx.shadowBlur = 9;
      draw();
      ctx.shadowBlur = 0;
    };
    ctx.fillStyle = '#a5ecff';
    ctx.strokeStyle = '#a5ecff';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    const ex = 11.5;
    switch (blinking && expr !== 'sleepy' ? 'blink' : expr) {
      case 'blink': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.moveTo(-ex - 5, -3); ctx.lineTo(-ex + 5, -3);
          ctx.moveTo(ex - 5, -3); ctx.lineTo(ex + 5, -3);
          ctx.stroke();
        });
        break;
      }
      case 'happy': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -1, 6.5, Math.PI, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, -1, 6.5, Math.PI, 0);
          ctx.stroke();
        });
        break;
      }
      case 'love': {
        ctx.fillStyle = '#ff7aa8';
        eyeGlow(() => {
          drawMiniHeart(ctx, -ex, -3, 9);
          drawMiniHeart(ctx, ex, -3, 9);
        });
        break;
      }
      case 'sleepy': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -4, 6.5, 0.25, Math.PI - 0.25);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, -4, 6.5, 0.25, Math.PI - 0.25);
          ctx.stroke();
        });
        break;
      }
      case 'full': {
        ctx.fillStyle = '#ffcf6e';
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -3, 5, 0, TAU);
          ctx.arc(ex, -3, 5, 0, TAU);
          ctx.fill();
        });
        // puffed cheeks
        ctx.fillStyle = 'rgba(255, 170, 110, 0.75)';
        ctx.beginPath();
        ctx.arc(-ex - 3, 7, 4, 0, TAU);
        ctx.arc(ex + 3, 7, 4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'dizzy': {
        eyeGlow(() => {
          for (const sx of [-ex, ex]) {
            ctx.beginPath();
            ctx.arc(sx, -3, 3, 0, TAU * 0.75 + this.wobbleT * 6);
            ctx.stroke();
          }
        });
        break;
      }
      case 'charge': {
        ctx.fillStyle = '#7ef29d';
        eyeGlow(() => {
          drawBolt(ctx, -ex, -2, 9);
          ctx.fill();
          drawBolt(ctx, ex, -2, 9);
          ctx.fill();
        });
        break;
      }
      case 'effort': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.moveTo(-ex - 5, -7); ctx.lineTo(-ex + 5, -2);
          ctx.moveTo(ex + 5, -7); ctx.lineTo(ex - 5, -2);
          ctx.stroke();
        });
        break;
      }
      case 'determined': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -2, 5, 0, TAU);
          ctx.arc(ex, -2, 5, 0, TAU);
          ctx.fill();
        });
        ctx.strokeStyle = '#a5ecff';
        ctx.beginPath();
        ctx.moveTo(-ex - 7, -11); ctx.lineTo(-ex + 4, -8);
        ctx.moveTo(ex + 7, -11); ctx.lineTo(ex - 4, -8);
        ctx.stroke();
        break;
      }
      case 'sing': {
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -1, 6.5, Math.PI, 0);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(ex, -1, 6.5, Math.PI, 0);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.arc(0, 8, 4, 0, TAU);
        ctx.stroke();
        break;
      }
      default: {
        // normal: round eyes that glance toward travel direction
        eyeGlow(() => {
          ctx.beginPath();
          ctx.arc(-ex, -3, 5.4, 0, TAU);
          ctx.arc(ex, -3, 5.4, 0, TAU);
          ctx.fill();
        });
      }
    }
    ctx.restore();
  }
}

function drawBolt(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.18, cy - s);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.18, cy + s);
  ctx.lineTo(cx + s * 0.45, cy - s * 0.15);
  ctx.lineTo(cx + s * 0.05, cy - s * 0.15);
  ctx.closePath();
}

function drawMiniHeart(ctx, cx, cy, size) {
  const s = size / 16;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 6 * s);
  ctx.bezierCurveTo(cx - 10 * s, cy - 4 * s, cx - 4 * s, cy - 10 * s, cx, cy - 4 * s);
  ctx.bezierCurveTo(cx + 4 * s, cy - 10 * s, cx + 10 * s, cy - 4 * s, cx, cy + 6 * s);
  ctx.closePath();
  ctx.fill();
}
