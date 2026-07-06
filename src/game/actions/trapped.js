// The "rescue me!" action — the robot wedges itself under furniture, flashes
// its light red, and cries for help until a toddler grabs, lifts, and places
// it back on open floor. Game.js routes press-and-drag to grab/place/poke.
import { TAU, rand, pick, clamp, lerp } from '../core/math.js';

// ------------------------------------------------- trapped! (rescue me) -----
// The robot wedges itself under the couch arm or the coffee table — sticking
// out just enough to grab — flashes its status light red and cries for help.
// Game.js routes press-and-drag on the robot to grab()/place()/poke() while
// this runs; nothing else can free it. Toddler to the rescue!
export const Trapped = {
  name: 'trapped',
  weight: 0,
  canRun: () => false,
  maxDur: 100000, // waits for its hero as long as it takes
  start(g) {
    const couch = g.room.couch;
    const kind = pick(['couch', 'table']);
    // Wedge spots measured from sprite pixels (couch paint's right edge at the
    // robot's row is world x≈560; the tabletop lip between the legs ends at
    // y≈575) so the robot ends up ~2/3 hidden with a grabbable bit poking out.
    // driveTo stops ~13px short of the target, which the numbers account for.
    this.state = kind === 'couch'
      ? {
          kind,
          phase: 'drive', t: 0,
          stage: { x: couch.cx + 380, y: 862 },
          wedge: { x: couch.cx + 206, y: 862 }, // lands ≈548: 45px sticks out
          inHeading: Math.PI, // nose under the couch arm, rear sticking out
          pleadT: 0, chirpT: 0, strainT: 0,
        }
      : {
          kind,
          phase: 'drive', t: 0,
          stage: { x: 876, y: 782 },
          wedge: { x: 876, y: 598 }, // lands ≈612: nose tucked under the lip
          inHeading: -Math.PI / 2, // nose under the tabletop, rear poking out
          pleadT: 0, chirpT: 0, strainT: 0,
        };
    g.robot.setExpr('determined', 3);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    switch (st.phase) {
      case 'drive': {
        if (r.driveTo(st.stage.x, st.stage.y, 165, 30)) {
          st.phase = 'wedge';
          st.t = 0;
          if (st.kind === 'couch') r.allowUnderCouch = true;
        } else if (st.t > 14) {
          // can't even reach the furniture — never mind, try again later
          this.finished = true;
        }
        break;
      }
      case 'wedge': {
        const arrived = r.driveTo(st.wedge.x, st.wedge.y, 110, 14, st.kind === 'couch' ? { ignoreCouch: true } : {});
        if (arrived || st.t > 8) this.becomeStuck(g);
        break;
      }
      case 'stuck': {
        r.targetSpeed = 0;
        r.heading = st.inHeading;
        // brushes whirr and wheels grind — going absolutely nowhere
        r.brushSpin += dt * 16;
        st.strainT -= dt;
        if (st.strainT <= 0) {
          st.strainT = rand(1.7, 2.9);
          g.sound.strain();
          r.squish = 0.6;
          const back = st.inHeading + Math.PI;
          g.particles.dustPuff(r.x + Math.cos(back) * 44, r.y + Math.sin(back) * 44 + 10, 3);
        }
        st.chirpT -= dt;
        if (st.chirpT <= 0) {
          st.chirpT = 2.6;
          g.sound.backupBeep();
        }
        st.pleadT -= dt;
        if (st.pleadT <= 0) {
          st.pleadT = 12;
          g.say('help_stuck', { cooldown: 9000 });
        }
        break;
      }
      case 'held': {
        // dangling from a giant helpful hand, wheels spinning in the air
        r.targetSpeed = 0;
        r.vz = 0; // hop-gravity stays off while airborne in a hand
        r.z = lerp(r.z, 30, 1 - Math.exp(-10 * dt));
        r.brushSpin += dt * 9;
        break;
      }
      case 'placed': {
        r.targetSpeed = 0;
        st.chirpT -= dt;
        if (st.chirpT <= 0) {
          st.chirpT = 3.4;
          g.sound.questionBeep(); // "...may I go now?"
        }
        break;
      }
      case 'resume': {
        r.targetSpeed = 0;
        // relocalizing pirouette, just like the real one after being carried
        r.spinExtra += dt * 5.4;
        if (st.t > 1.15) {
          r.spinExtra = 0;
          this.finished = true;
        }
        break;
      }
    }
  },
  becomeStuck(g) {
    const r = g.robot;
    const st = this.state;
    st.phase = 'stuck';
    st.t = 0;
    st.pleadT = 1.1; // the cry for help comes right after the thunk
    st.chirpT = 2.0;
    st.strainT = 0.5;
    r.trapped = true;
    r.targetSpeed = 0;
    r.speed = 0;
    r.squish = 0.9;
    g.sound.bump();
    g.sound.errorBuzz();
    g.shake(2);
    g.particles.dustPuff(r.x, r.y + 8, 6);
  },
  grabbable() {
    return ['stuck', 'placed'].includes(this.state?.phase);
  },
  grab(g) {
    if (!this.grabbable()) return;
    const st = this.state;
    st.phase = 'held';
    st.t = 0;
    g.sound.squeak();
    g.sound.mechWhirr(0.35);
    g.robot.allowUnderCouch = true; // lifted clear of the skirt, no snagging
    g.robot.setExpr('dizzy', 2);
  },
  // finger let go: set the robot down on the nearest clear patch of floor
  place(g, x, y) {
    const r = g.robot;
    const st = this.state;
    if (st.phase !== 'held') return;
    const b = g.room.bounds;
    const cx = clamp(x, b.minX, b.maxX);
    const cy = clamp(y, b.minY, b.maxY);
    let spot = g.room.isFree(cx, cy, r.radius + 4) ? { x: cx, y: cy } : null;
    for (let rr = 44; rr <= 280 && !spot; rr += 44) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + rr * 0.13;
        const sx = cx + Math.cos(a) * rr;
        const sy = cy + Math.sin(a) * rr;
        if (sx > b.minX && sx < b.maxX && sy > b.minY && sy < b.maxY &&
            g.room.isFree(sx, sy, r.radius + 4)) {
          spot = { x: sx, y: sy };
          break;
        }
      }
    }
    if (!spot) spot = g.room.randomFloorPoint(r.radius + 6);
    r.x = spot.x;
    r.y = spot.y;
    r.allowUnderCouch = false;
    st.phase = 'placed';
    st.t = 0;
    st.chirpT = 1.4;
    g.sound.clunk();
    // gravity drops it the last bit — landing squish + dust come free
  },
  // a plain tap (no drag): frees a PLACED robot; a stuck one just wiggles
  poke(g) {
    const st = this.state;
    const r = g.robot;
    if (st.phase === 'placed') {
      st.phase = 'resume';
      st.t = 0;
      r.trapped = false;
      g.say('thank_resume', { force: true });
      g.sound.happyBeeps(4);
      g.particles.hearts(r.x, r.y - 60, 4);
      r.setExpr('love', 2.5);
    } else if (st.phase === 'stuck') {
      r.squish = 0.8;
      g.sound.strain();
      g.say('help_stuck', { cooldown: 5000 });
    }
  },
  drawOver(g, ctx) {
    const r = g.robot;
    if (!r.trapped) return;
    // emergency light spilling out from under the furniture (synced with the
    // status-ring blink — both run on wobbleT). Two layers: a hot core right
    // at the robot plus a wide soft wash, so it reads clear across the room.
    // pulses bright/dim but never fully off — an ember between flashes
    const on = 0.22 + 0.78 * Math.max(0, Math.sin(r.wobbleT * 8));
    const cy = r.y - r.z;
    const wide = ctx.createRadialGradient(r.x, cy, 12, r.x, cy, 185);
    wide.addColorStop(0, `rgba(255, 60, 45, ${0.10 + 0.26 * on})`);
    wide.addColorStop(1, 'rgba(255, 60, 45, 0)');
    ctx.fillStyle = wide;
    ctx.beginPath();
    ctx.arc(r.x, cy, 185, 0, TAU);
    ctx.fill();
    const core = ctx.createRadialGradient(r.x, cy, 2, r.x, cy, 62);
    core.addColorStop(0, `rgba(255, 120, 90, ${0.65 * on})`);
    core.addColorStop(1, 'rgba(255, 80, 55, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(r.x, cy, 62, 0, TAU);
    ctx.fill();
    // and the lidar turret doubles as a rotating emergency beacon: two red
    // beams sweep across the floor like a tiny police light
    const ang = r.wobbleT * 4.2;
    ctx.fillStyle = `rgba(255, 70, 50, ${0.09 + 0.13 * on})`;
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(r.x, cy);
      ctx.arc(r.x, cy, 215, ang + off - 0.17, ang + off + 0.17);
      ctx.closePath();
      ctx.fill();
    }
  },
  end(g) {
    const r = g.robot;
    r.trapped = false;
    r.allowUnderCouch = false;
    r.spinExtra = 0;
  },
};
