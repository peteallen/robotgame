// Tidying chores — the robot deploys its grabber arm to pick up a stray sock
// (into the laundry basket) or a loose toy (back into the toybox).
import { TAU, rand, pick, clamp, lerp, dist, angleTo, easeOutCubic } from '../core/math.js';
import { drawArm, drawSockShape, drawToyShape, isTidyableToy } from './helpers.js';

// --------------------------------------------------- sock grab (Z70 arm!) ---
export const SockGrab = {
  name: 'sockGrab',
  weight: 10,
  maxDur: 32,
  start(g) {
    const r = g.robot;
    // a sock already on the floor (dragged/popped from the basket) comes first
    const floorSock = g.dirt.find((d) => d.type === 'sock' && d.drop <= 0);
    if (floorSock) {
      this.state = {
        phase: 'approach',
        t: 0,
        sock: { x: floorSock.x, y: floorSock.y, z: 0, tint: floorSock.tint },
        item: floorSock,
        arm: { ext: 0, claw: 1, tx: floorSock.x, ty: floorSock.y, holding: false },
        dropZ: 0,
      };
      r.setExpr('determined', 3);
      g.sound.ackBeep();
      return;
    }
    // otherwise one tumbles in out of nowhere (laundry day!)
    let p = null;
    for (let i = 0; i < 40; i++) {
      const cand = g.room.randomFloorPoint(60);
      const d = dist(cand.x, cand.y, r.x, r.y);
      if (d > 180 && d < 620 && cand.y > 380 && g.room.isFree(cand.x, cand.y, 70, { solidTable: true })) {
        p = cand;
        break;
      }
    }
    if (!p) p = { x: 840, y: 850 };
    this.state = {
      phase: 'flyin',
      t: 0,
      sock: { x: p.x, y: p.y, z: 700, tint: pick(['#ff8fa3', '#8fd7ff', '#b8f2a4', '#ffe08a']) },
      item: null,
      arm: { ext: 0, claw: 1, tx: p.x, ty: p.y, holding: false },
      dropZ: 0,
    };
    g.sound.whoosh();
    r.setExpr('determined', 3);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    const sock = st.sock;
    switch (st.phase) {
      case 'flyin': {
        sock.z -= 900 * dt;
        if (sock.z <= 0) {
          sock.z = 0;
          g.particles.dustPuff(sock.x, sock.y, 6);
          g.sound.boing();
          g.sound.questionBeep();
          st.phase = 'approach';
        }
        break;
      }
      case 'approach': {
        if (r.driveTo(sock.x, sock.y, 200, 105)) {
          st.phase = 'extend';
          st.t = 0;
          r.faceAngle(angleTo(r.x, r.y, sock.x, sock.y));
          g.sound.ackBeep();
        }
        break;
      }
      case 'extend': {
        r.faceAngle(angleTo(r.x, r.y, sock.x, sock.y));
        st.arm.ext = Math.min(1, st.t / 0.9);
        st.arm.tx = sock.x;
        st.arm.ty = sock.y;
        if (st.arm.ext >= 1) {
          st.phase = 'grab';
          st.t = 0;
          g.sound.squeak();
        }
        break;
      }
      case 'grab': {
        st.arm.claw = 1 - Math.min(1, st.t / 0.3);
        if (st.t > 0.35) {
          st.arm.holding = true;
          if (st.item) {
            // the floor sock is in the claw now — the action draws it from here
            g.dirt.remove(st.item);
            st.item = null;
          }
          st.phase = 'lift';
          st.t = 0;
          g.sound.tada();
          g.particles.sparkle(sock.x, sock.y - 40, 8);
        }
        break;
      }
      case 'lift': {
        st.arm.ext = 1 - easeOutCubic(Math.min(1, st.t / 0.7)) * 0.75;
        if (st.t > 0.8) {
          st.phase = 'carry';
          st.t = 0;
          r.setExpr('happy', 6);
        }
        break;
      }
      case 'carry': {
        // carrying a sock overhead — the tabletop counts as solid so the
        // robot walks AROUND it instead of ducking underneath
        if (r.driveTo(1520, 445, 195, 45, { solidTable: true })) {
          st.phase = 'deposit';
          st.t = 0;
        }
        break;
      }
      case 'deposit': {
        const done = r.faceAngle(angleTo(r.x, r.y, 1545, 300));
        st.arm.tx = 1545;
        st.arm.ty = 255;
        if (done) {
          st.arm.ext = Math.min(1, st.arm.ext + dt / 0.7);
          if (st.arm.ext >= 1) {
            st.phase = 'release';
            st.t = 0;
            st.arm.claw = 1;
            st.arm.holding = false;
            st.dropZ = 60;
          }
        }
        break;
      }
      case 'release': {
        st.dropZ -= 350 * dt;
        if (st.dropZ <= -20 && !st.released) {
          st.released = true;
          g.addBasketSock(st.sock.tint); // it lives in the basket now!
          g.sound.pop();
          g.sound.dockChime();
          g.particles.confettiBurst(1545, 260, 18);
          g.particles.sparkle(1545, 250, 6);
        }
        if (st.t > 0.6) {
          st.phase = 'retract';
          st.t = 0;
        }
        break;
      }
      case 'retract': {
        st.arm.ext = Math.max(0, st.arm.ext - dt / 0.5);
        if (st.arm.ext <= 0) {
          this.finished = true;
          g.sound.happyBeeps(4);
        }
        break;
      }
    }
    // holding: sock follows claw
    if (st.arm.holding) {
      const claw = this.clawPos(g);
      sock.x = claw.x;
      sock.y = claw.y + 14;
      sock.z = 0;
    }
  },
  clawPos(g) {
    const r = g.robot;
    const st = this.state;
    const reach = st.arm.ext;
    return {
      x: lerp(r.x, st.arm.tx, reach),
      y: lerp(r.y - 20, st.arm.ty, reach),
    };
  },
  end(g) {
    // interrupted mid-carry (mop emergency!): drop the sock right here
    const st = this.state;
    if (st?.arm?.holding && !st.released) {
      g.dirt.spawn('sock', g.robot.x, clamp(g.robot.y + 46, g.room.bounds.minY, g.room.bounds.maxY + 30), { tint: st.sock.tint });
    }
  },
  drawOver(g, ctx) {
    const st = this.state;
    const r = g.robot;
    const sock = st.sock;
    // sock falling in / carried (drawn here so it goes OVER the robot);
    // while it's still a floor item, the DirtSystem draws it instead
    if (!st.item && (st.phase !== 'release' || !st.released)) {
      ctx.save();
      ctx.translate(sock.x, sock.y - sock.z - (st.phase === 'release' ? -st.dropZ : 0));
      if (sock.z > 2) {
        ctx.rotate(sock.z * 0.02);
      }
      drawSockShape(ctx, g, sock.tint);
      ctx.restore();
      if (sock.z > 2) {
        ctx.fillStyle = 'rgba(80,45,25,0.18)';
        ctx.beginPath();
        ctx.ellipse(sock.x, sock.y + 6, 20, 7, 0, 0, TAU);
        ctx.fill();
      }
    }
    // the arm
    if (st.arm.ext > 0.02) {
      const claw = this.clawPos(g);
      drawArm(ctx, r.x, r.y - 20, claw.x, claw.y, st.arm.ext, st.arm.claw);
    }
  },
};

// ------------------------------------------- tidy a toy back into the toybox
export const TidyToy = {
  name: 'tidyToy',
  weight: 7,
  maxDur: 30,
  canRun: (g) => g.dirt.items.some(isTidyableToy),
  start(g) {
    const toy = g.dirt.items.find(isTidyableToy);
    if (!toy) {
      this.finished = true;
      return;
    }
    this.state = {
      phase: 'approach',
      t: 0,
      toy,
      held: null, // {type, tint, rot} once grabbed
      arm: { ext: 0, claw: 1, tx: toy.x, ty: toy.y },
      dropZ: 0,
      released: false,
    };
    g.robot.setExpr('determined', 3);
    g.sound.ackBeep();
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    switch (st.phase) {
      case 'approach': {
        if (!g.dirt.items.includes(st.toy)) {
          // someone bounced it away — give up gracefully
          this.finished = true;
          return;
        }
        st.arm.tx = st.toy.x;
        st.arm.ty = st.toy.y;
        if (r.driveTo(st.toy.x, st.toy.y, 190, 105)) {
          st.phase = 'extend';
          st.t = 0;
        }
        break;
      }
      case 'extend': {
        r.faceAngle(angleTo(r.x, r.y, st.arm.tx, st.arm.ty));
        st.arm.ext = Math.min(1, st.t / 0.8);
        if (st.arm.ext >= 1) {
          st.phase = 'grab';
          st.t = 0;
          g.sound.squeak();
        }
        break;
      }
      case 'grab': {
        st.arm.claw = 1 - Math.min(1, st.t / 0.3);
        if (st.t > 0.35 && !st.held) {
          st.held = { type: st.toy.type, tint: st.toy.tint, rot: st.toy.rot };
          g.dirt.remove(st.toy);
          g.particles.sparkle(st.arm.tx, st.arm.ty - 20, 5);
          g.sound.pop();
        }
        if (st.t > 0.4) {
          st.phase = 'lift';
          st.t = 0;
        }
        break;
      }
      case 'lift': {
        st.arm.ext = 1 - easeOutCubic(Math.min(1, st.t / 0.6)) * 0.75;
        if (st.t > 0.7) {
          st.phase = 'carry';
          st.t = 0;
          r.setExpr('happy', 6);
        }
        break;
      }
      case 'carry': {
        // toybox approach point (from the open floor below-left)
        if (r.driveTo(1395, 705, 190, 45, { solidTable: true })) {
          st.phase = 'deposit';
          st.t = 0;
        }
        break;
      }
      case 'deposit': {
        const done = r.faceAngle(angleTo(r.x, r.y, 1535, 590));
        st.arm.tx = 1528;
        st.arm.ty = 545;
        if (done) {
          st.arm.ext = Math.min(1, st.arm.ext + dt / 0.6);
          if (st.arm.ext >= 1) {
            st.phase = 'release';
            st.t = 0;
            st.arm.claw = 1;
            st.dropZ = 50;
          }
        }
        break;
      }
      case 'release': {
        st.dropZ -= 320 * dt;
        if (st.dropZ <= -6 && !st.released) {
          st.released = true;
          st.held = null;
          g.sound.boing();
          g.sound.dockChime();
          g.particles.sparkle(1535, 555, 8);
          g.particles.confettiBurst(1535, 560, 12);
        }
        if (st.t > 0.5) {
          st.phase = 'retract';
          st.t = 0;
        }
        break;
      }
      case 'retract': {
        st.arm.ext = Math.max(0, st.arm.ext - dt / 0.5);
        if (st.arm.ext <= 0) {
          this.finished = true;
          g.sound.happyBeeps(4);
        }
        break;
      }
    }
  },
  clawPos(g) {
    const r = g.robot;
    const st = this.state;
    return {
      x: lerp(r.x, st.arm.tx, st.arm.ext),
      y: lerp(r.y - 20, st.arm.ty, st.arm.ext),
    };
  },
  end(g) {
    // interrupted while holding a toy: it tumbles to the floor
    const st = this.state;
    if (st?.held) {
      const t = g.dirt.spawn(st.held.type, g.robot.x, g.robot.y + 40, { tint: st.held.tint });
      t.vx = rand(-70, 70);
      t.vy = rand(30, 90);
    }
  },
  drawOver(g, ctx) {
    const st = this.state;
    if (!st.arm) return;
    const r = g.robot;
    if (st.arm.ext > 0.02) {
      const claw = this.clawPos(g);
      drawArm(ctx, r.x, r.y - 20, claw.x, claw.y, st.arm.ext, st.arm.claw);
      // held toy at the claw (or dropping into the box)
      if (st.held || (st.phase === 'release' && !st.released)) {
        const hx = st.phase === 'release' ? st.arm.tx : claw.x;
        const hy = (st.phase === 'release' ? st.arm.ty - st.dropZ : claw.y) + 16;
        ctx.save();
        ctx.translate(hx, hy);
        drawToyShape(ctx, g, st.held);
        ctx.restore();
      }
    }
  },
};
