// Pure celebration actions — the robot stops driving and throws a little party:
// spins, happy beeps, bouncing, fireworks, and the big all-clean victory lap.
import { TAU, rand, dist } from '../core/math.js';
import { dockManeuverStep } from './helpers.js';

// ---------------------------------------------------------------- spin dance
export const SpinDance = {
  name: 'spinDance',
  weight: 10,
  maxDur: 5,
  start(g) {
    g.robot.setExpr('happy', 4.5);
    g.sound.happyBeeps(5);
    this.state.spins = 0;
  },
  update(g, dt) {
    const r = g.robot;
    r.targetSpeed = 0;
    r.spinExtra += dt * (6 + Math.sin(this.elapsed * 2) * 2);
    if (this.elapsed > this.state.spins * 0.8) {
      this.state.spins++;
      g.particles.confettiBurst(r.x, r.y - 40, 14);
      g.sound.pop();
      if (this.state.spins === 3) r.hop(220);
    }
    if (this.elapsed > 4) {
      // ease out the spin
      r.spinExtra *= 1 - 6 * dt;
      if (Math.abs(r.spinExtra % TAU) < 0.15 || this.elapsed > 4.8) {
        r.spinExtra = 0;
        this.finished = true;
        g.sound.tada();
        g.particles.confettiBurst(r.x, r.y - 30, 30);
      }
    }
  },
};

// --------------------------------------------------------------- happy beeps
export const HappyBeeps = {
  name: 'happyBeeps',
  weight: 7,
  maxDur: 4.5,
  start(g) {
    g.robot.setExpr('love', 4);
    this.state.beepT = 0;
    this.state.beeps = 0;
  },
  update(g, dt) {
    const r = g.robot;
    r.targetSpeed = 0;
    r.spinExtra = Math.sin(this.elapsed * 6) * 0.18;
    this.state.beepT -= dt;
    if (this.state.beepT <= 0 && this.state.beeps < 5) {
      this.state.beepT = 0.65;
      this.state.beeps++;
      g.sound.happyBeeps(3);
      g.particles.notes(r.x, r.y - 70, 2);
      if (this.state.beeps % 2) g.particles.hearts(r.x + rand(-40, 40), r.y - 50, 2);
    }
    if (this.state.beeps >= 5 && this.state.beepT <= 0) {
      r.spinExtra = 0;
      this.finished = true;
    }
  },
};

// -------------------------------------------------------------- bounce party
export const BounceParty = {
  name: 'bounceParty',
  weight: 7,
  maxDur: 6,
  start(g) {
    this.state.hops = 0;
    this.state.hopT = 0.2;
    g.robot.setExpr('happy', 5);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    r.targetSpeed = 0;
    st.hopT -= dt;
    if (st.hopT <= 0 && r.z <= 0.5 && st.hops < 5) {
      st.hops++;
      const big = st.hops === 5;
      r.hop(big ? 420 : rand(200, 280));
      g.sound.squeak();
      if (big) {
        g.sound.boing();
      }
      st.hopT = big ? 1.4 : rand(0.4, 0.6);
    }
    if (st.hops >= 5 && r.z <= 0.5 && st.hopT < 0.9) {
      g.particles.confettiBurst(r.x, r.y - 20, 26);
      g.sound.tada();
      g.shake(3);
      this.finished = true;
    }
  },
};

// ----------------------------------------------------------------- fireworks
export const Fireworks = {
  name: 'fireworks',
  weight: 8,
  maxDur: 8,
  start(g) {
    this.state.rockets = [];
    this.state.launched = 0;
    this.state.launchT = 0.3;
    g.robot.setExpr('happy', 7);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    r.targetSpeed = 0;
    if (st.launched < 5) {
      st.launchT -= dt;
      if (st.launchT <= 0) {
        st.launchT = rand(0.5, 0.9);
        st.launched++;
        st.rockets.push({
          x: r.x, y: r.y - 30,
          vx: rand(-140, 140), vy: rand(-620, -480),
          burstY: rand(160, 380),
          hue: rand(0, 360),
          trail: 0,
        });
        g.sound.fireworkLaunch();
        r.hop(90);
        g.particles.dustPuff(r.x, r.y, 4);
      }
    }
    for (let i = st.rockets.length - 1; i >= 0; i--) {
      const k = st.rockets[i];
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vy += 240 * dt;
      k.trail -= dt;
      if (k.trail <= 0) {
        k.trail = 0.03;
        g.particles.add({
          x: k.x, y: k.y, kind: 'dot',
          color: `hsla(${k.hue}, 90%, 70%, 0.9)`,
          size: 5, life: 0.35,
          vy: 40,
        });
      }
      if (k.y <= k.burstY || k.vy > -60) {
        st.rockets.splice(i, 1);
        g.sound.fireworkBurst();
        g.shake(3);
        const colors = [`hsl(${k.hue}, 90%, 65%)`, `hsl(${(k.hue + 40) % 360}, 90%, 70%)`, '#fff'];
        g.particles.burst(k.x, k.y, 'star', 26, { colors, speedMin: 120, speedMax: 380, lifeMin: 0.6, lifeMax: 1.3, gravity: 160 });
        g.particles.burst(k.x, k.y, 'dot', 30, { colors, speedMin: 80, speedMax: 300, lifeMin: 0.5, lifeMax: 1.1, gravity: 200 });
      }
    }
    if (st.launched >= 5 && st.rockets.length === 0 && this.elapsed > 4.5) {
      this.finished = true;
    }
  },
};

// ------------------------------------------ the all-clean victory party -----
// Forced by Game when the LAST speck, sock and toy leaves the floor:
// a proud spin, then a full VICTORY LAP around the room trailing rainbow and
// fireworks, then home to the dock to service-and-park. The robot stays
// parked while the floor is pristine — until somebody (three years old,
// probably) makes a brand-new mess.
export const WinParty = {
  name: 'winParty',
  weight: 0,
  canRun: () => false,
  maxDur: 34,
  start(g) {
    this.state = { phase: 'cheer', t: 0, burstT: 0.4, shineT: 0, hops: 0, lap: null, fwT: 0.7 };
    g.say('all_clean', { force: true });
    g.celebrate(); // the big sky-fireworks show
    g.sound.tada();
    g.robot.setExpr('love', 8);
    g.robot.actionDockOk = true;
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    // the freshly-cleaned floor gleams all over during the whole party
    st.shineT -= dt;
    if (st.shineT <= 0) {
      st.shineT = 0.16;
      const p = g.room.randomFloorPoint(30);
      g.particles.sparkle(p.x, p.y, 2);
    }
    switch (st.phase) {
      case 'cheer': {
        // proud pirouette with confetti hops
        r.targetSpeed = 0;
        r.spinExtra += dt * 6;
        st.burstT -= dt;
        if (st.burstT <= 0 && st.hops < 2) {
          st.burstT = 0.85;
          st.hops++;
          r.hop(230);
          g.particles.confettiBurst(r.x, r.y - 40, 20);
        }
        if (st.t > 1.9) {
          r.spinExtra = 0;
          st.phase = 'lap';
          st.t = 0;
          // full circuit of the room, entering at the nearest waypoint
          const W = [
            { x: 1060, y: 900 }, { x: 640, y: 930 }, { x: 240, y: 640 },
            { x: 400, y: 330 }, { x: 1100, y: 360 },
          ];
          let best = 0;
          let bd = Infinity;
          W.forEach((p, i) => {
            const d = dist(r.x, r.y, p.x, p.y);
            if (d < bd) { bd = d; best = i; }
          });
          st.lap = [];
          for (let i = 0; i <= W.length; i++) st.lap.push(W[(best + i) % W.length]);
          r.trailMode = 'rainbow';
        }
        break;
      }
      case 'lap': {
        // fireworks pop off overhead all along the lap
        st.fwT -= dt;
        if (st.fwT <= 0) {
          st.fwT = rand(0.45, 0.8);
          const fx = r.x + rand(-90, 90);
          const fy = r.y - rand(150, 270);
          g.sound.fireworkBurst();
          g.particles.burst(fx, fy, 'star', 20, { speedMin: 90, speedMax: 300, lifeMin: 0.5, lifeMax: 1.1, gravity: 150 });
          g.particles.burst(fx, fy, 'dot', 16, { speedMin: 70, speedMax: 240, lifeMin: 0.4, lifeMax: 0.9, gravity: 190 });
        }
        const wp = st.lap[0];
        if (r.driveTo(wp.x, wp.y, 260, 55)) {
          st.lap.shift();
          g.particles.confettiBurst(r.x, r.y - 30, 12);
          g.sound.pop();
        }
        if (!st.lap.length || st.t > 17) {
          st.phase = 'toDock';
          st.dockPhase = 'go';
          st.t = 0;
          r.trailMode = null;
          g.say('go_dock');
        }
        break;
      }
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          // parked! release() runs the normal service plan, and the docked
          // robot stays home while the floor is pristine
          r.parkAfterAction = true;
          g.particles.sparkle(r.x, r.y - 40, 10);
          g.sound.happyBeeps(5);
          this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    const r = g.robot;
    r.spinExtra = 0;
    r.trailMode = null;
    r.actionDockOk = false;
  },
};
