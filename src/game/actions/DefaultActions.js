// Every tap-the-robot surprise lives here. Each action takes control of the
// robot, does something delightful, then hands control back.
import { TAU, rand, pick, chance, clamp, lerp, dist, angleTo, damp, easeOutCubic, easeInOutSine } from '../core/math.js';
import { roundRect } from '../world/Room.js';

export function registerDefaultActions(reg) {
  reg.register(SpinDance);
  reg.register(TurboZoom);
  reg.register(RainbowTrail);
  reg.register(BubbleParty);
  reg.register(DiscoMode);
  reg.register(SockGrab);
  reg.register(TidyToy);
  reg.register(DogRide);
  reg.register(HappyBeeps);
  reg.register(Fireworks);
  reg.register(Sneeze);
  reg.register(BounceParty);
  reg.register(HoverMode);
  reg.register(UnderCouch);
  reg.register(MopMode);
}

// ---------------------------------------------------------------- spin dance
const SpinDance = {
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

// ---------------------------------------------------------------- turbo zoom
const TurboZoom = {
  name: 'turboZoom',
  weight: 9,
  maxDur: 8,
  canRun: (g) => g.robot.battery > 0.3,
  start(g) {
    const r = g.robot;
    r.trailMode = 'turbo';
    r.actionSuction = true;
    r.setExpr('determined', 7);
    g.sound.ackBeep();
    this.state.target = g.room.randomFloorPoint(70);
    this.state.legs = 0;
  },
  update(g, dt) {
    const r = g.robot;
    g.sound.setHumIntensity(1.6);
    if (r.driveTo(this.state.target.x, this.state.target.y, 340, 60)) {
      this.state.legs++;
      g.particles.dustPuff(r.x, r.y + 10, 6);
      if (this.state.legs >= 5 || this.elapsed > 7) {
        this.finished = true;
        r.setExpr('happy', 2);
        g.sound.happyBeeps(3);
      } else {
        this.state.target = g.room.randomFloorPoint(70);
        g.sound.squeak();
      }
    }
  },
  end(g) {
    g.robot.actionSuction = false;
  },
};

// ------------------------------------------------------------- rainbow trail
const RainbowTrail = {
  name: 'rainbowTrail',
  weight: 9,
  maxDur: 10,
  canRun: (g) => g.robot.battery > 0.25,
  start(g) {
    const r = g.robot;
    r.trailMode = 'rainbow';
    r.actionSuction = true;
    r.setExpr('happy', 9);
    g.sound.sparklePickup();
    this.state.target = g.room.randomFloorPoint(70);
    this.state.sparkleT = 0;
  },
  update(g, dt) {
    const r = g.robot;
    this.state.sparkleT -= dt;
    if (this.state.sparkleT <= 0) {
      this.state.sparkleT = 0.22;
      g.particles.sparkle(r.x - Math.cos(r.heading) * 50, r.y - Math.sin(r.heading) * 50, 2);
    }
    if (r.driveTo(this.state.target.x, this.state.target.y, 210, 60)) {
      this.state.target = g.room.randomFloorPoint(70);
    }
    if (this.elapsed > 9) this.finished = true;
  },
  end(g) {
    g.robot.actionSuction = false;
    g.sound.tada();
  },
};

// -------------------------------------------------------------- bubble party
const BubbleParty = {
  name: 'bubbleParty',
  weight: 9,
  maxDur: 11,
  start(g) {
    this.state.bubbles = [];
    this.state.emitT = 0;
    this.state.target = g.room.randomFloorPoint(70);
    g.robot.setExpr('happy', 10);
    g.sound.happyBeeps(3);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (this.elapsed < 8.5) {
      st.emitT -= dt;
      if (st.emitT <= 0) {
        st.emitT = rand(0.12, 0.3);
        st.bubbles.push({
          x: r.x + rand(-30, 30),
          y: r.y - 20,
          vy: rand(-70, -35),
          vx: rand(-18, 18),
          size: rand(14, 34),
          wob: rand(0, TAU),
          age: 0,
          life: rand(3.5, 6),
        });
        if (chance(0.3)) g.sound.pop();
      }
      if (r.driveTo(st.target.x, st.target.y, 120, 60)) st.target = g.room.randomFloorPoint(70);
    } else {
      r.targetSpeed = 0;
    }
    for (let i = st.bubbles.length - 1; i >= 0; i--) {
      const b = st.bubbles[i];
      b.age += dt;
      b.wob += dt * 3;
      b.x += (b.vx + Math.sin(b.wob) * 20) * dt;
      b.y += b.vy * dt;
      b.vy *= 1 - 0.12 * dt;
      if (b.age > b.life || b.y < 60) {
        this.popBubble(g, i, false);
      }
    }
    if (this.elapsed > 10.5 && st.bubbles.length === 0) this.finished = true;
  },
  popBubble(g, i, byTap) {
    const b = this.state.bubbles[i];
    this.state.bubbles.splice(i, 1);
    g.sound.bubblePop();
    g.particles.burst(b.x, b.y, 'dot', 7, {
      colors: ['#bde8ff', '#e3f6ff', '#8fd4ff'],
      speedMin: 40, speedMax: 140,
      sizeMin: 3, sizeMax: 6,
      lifeMin: 0.25, lifeMax: 0.5,
      gravity: 220,
    });
    if (byTap) g.particles.sparkle(b.x, b.y, 3);
  },
  onTap(g, x, y) {
    const st = this.state;
    for (let i = st.bubbles.length - 1; i >= 0; i--) {
      const b = st.bubbles[i];
      if (dist(x, y, b.x, b.y) < b.size + 26) {
        this.popBubble(g, i, true);
        return true;
      }
    }
    return false;
  },
  drawOver(g, ctx) {
    for (const b of this.state.bubbles) {
      const grow = Math.min(1, b.age * 4);
      const s = b.size * grow;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(170, 225, 255, 0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // iridescent shine
      ctx.strokeStyle = `hsla(${(b.wob * 60) % 360}, 80%, 75%, 0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s - 3, b.wob, b.wob + 1.2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(-s * 0.35, -s * 0.35, s * 0.18, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  },
  end(g) {
    this.state.bubbles = [];
  },
};

// ---------------------------------------------------------------- disco mode
const DiscoMode = {
  name: 'discoMode',
  weight: 8,
  maxDur: 13,
  start(g) {
    g.dimTarget = 0.62;
    g.sound.startDisco();
    g.robot.setExpr('happy', 12);
    this.state.ballY = -120;
    this.state.t = 0;
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    // ball descends
    st.ballY = lerp(st.ballY, 300, 1 - Math.exp(-2.2 * dt));
    // robot dances a figure-8 on the open rug below the table
    const t = st.t * 1.4;
    const tx = 840 + Math.sin(t) * 240;
    const ty = 795 + Math.sin(t * 2) * 60;
    r.driveTo(tx, ty, 190, 30);
    if (Math.floor(st.t * 2) !== Math.floor((st.t - dt) * 2)) {
      r.hop(140);
    }
    if (st.t > 11) {
      g.dimTarget = 0;
      st.ballY = lerp(st.ballY, -150, 1 - Math.exp(-3 * dt));
      if (st.t > 12) this.finished = true;
    }
  },
  drawOver(g, ctx) {
    const st = this.state;
    const bx = 840;
    const by = st.ballY;
    const t = st.t;
    // hanging cord
    ctx.strokeStyle = 'rgba(60, 60, 70, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, by);
    ctx.stroke();
    // beams
    const colors = ['rgba(255, 93, 143, 0.30)', 'rgba(76, 201, 240, 0.30)', 'rgba(255, 210, 63, 0.30)', 'rgba(126, 217, 87, 0.30)'];
    for (let i = 0; i < 4; i++) {
      const a = t * 0.9 + (i * TAU) / 4;
      const fx = bx + Math.cos(a) * 520;
      const fy = 900 + Math.sin(a * 1.7) * 90;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(fx - 110, fy);
      ctx.lineTo(fx + 110, fy);
      ctx.closePath();
      ctx.fill();
      // floor pools
      ctx.beginPath();
      ctx.ellipse(fx, fy, 120, 42, 0, 0, TAU);
      ctx.fill();
    }
    // the ball
    const img = g.assets.get('disco_ball');
    if (img) {
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.sin(t * 0.8) * 0.1);
      ctx.drawImage(img, -60, -60, 120, 120);
      ctx.restore();
    } else {
      const grad = ctx.createRadialGradient(bx - 15, by - 15, 5, bx, by, 55);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#c9d6e8');
      grad.addColorStop(1, '#8593ad');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, 52, 0, TAU);
      ctx.fill();
      // facets
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(bx, by, 52 * Math.cos(i * 0.5), 52, ((t * 0.6) % 0.6) + i * 0.0, 0, TAU);
        ctx.stroke();
      }
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(bx, by, 52, 52 * (i / 4), 0, 0, TAU);
        ctx.stroke();
      }
    }
    // glints
    for (let i = 0; i < 6; i++) {
      const a = t * 2 + i * 1.1;
      const gx = bx + Math.cos(a) * 46;
      const gy = by + Math.sin(a * 1.3) * 46;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(gx, gy, 3, 0, TAU);
      ctx.fill();
    }
  },
  end(g) {
    g.dimTarget = 0;
    g.sound.stopDisco();
    g.sound.tada();
    g.particles.confettiBurst(g.robot.x, g.robot.y - 40, 40);
  },
};

// --------------------------------------------------- sock grab (Z70 arm!) ---
const SockGrab = {
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

function drawSockShape(ctx, g, tint) {
  const img = g.assets.getTinted('sock', tint);
  if (img) {
    ctx.drawImage(img, -31, -31, 62, 62);
    return;
  }
  ctx.rotate(0.5);
  ctx.fillStyle = tint;
  roundRect(ctx, -12, -26, 24, 40, 11);
  ctx.fill();
  ctx.save();
  ctx.translate(-3, 12);
  ctx.rotate(0.8);
  roundRect(ctx, -12, -8, 32, 24, 11);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#fff';
  roundRect(ctx, -12, -28, 24, 12, 6);
  ctx.fill();
}

// ------------------------------------------- tidy a toy back into the toybox
function isTidyableToy(d) {
  return (d.type === 'toy_ball' || d.type === 'toy_block') &&
    !d.toss && !d.fading && Math.abs(d.vx) < 40 && Math.abs(d.vy) < 40;
}

const TidyToy = {
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

function drawToyShape(ctx, g, held) {
  if (!held) return;
  const img = g.assets.get(held.type);
  if (img) {
    ctx.drawImage(img, -26, -26, 52, 52);
    return;
  }
  ctx.fillStyle = held.tint || '#3ddad7';
  if (held.type === 'toy_ball') {
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, TAU);
    ctx.fill();
  } else {
    roundRect(ctx, -19, -19, 38, 38, 8);
    ctx.fill();
  }
}

function drawArm(ctx, baseX, baseY, cx, cy, ext, claw) {
  const mx = lerp(baseX, cx, 0.5);
  const my = lerp(baseY, cy, 0.5) - 26 * ext;
  ctx.strokeStyle = '#3a4152';
  ctx.lineCap = 'round';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(mx, my);
  ctx.stroke();
  ctx.lineWidth = 11;
  ctx.strokeStyle = '#4d5568';
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(mx, my, 7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#2e3440';
  ctx.beginPath();
  ctx.arc(baseX, baseY, 12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#2e3440';
  ctx.lineWidth = 6;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.quadraticCurveTo(cx + side * (12 + claw * 12), cy + 4, cx + side * (5 + claw * 10), cy + 16);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ dog ride
const DogRide = {
  name: 'dogRide',
  weight: 8,
  maxDur: 11,
  canRun: (g) => g.dog.state !== 'ride' && g.dog.state !== 'startle' && !g.dog.pooping(),
  start(g) {
    g.dog.hurry = true;
    g.dog.beginWalk({ x: g.robot.x, y: g.robot.y });
    g.sound.bark();
    g.robot.setExpr('happy', 4);
    this.state.mounted = false;
  },
  update(g, dt) {
    const r = g.robot;
    const dog = g.dog;
    if (!this.state.mounted) {
      // they roll/run to meet each other!
      r.driveTo(dog.x, dog.y, 110, 85);
      dog.target = { x: r.x, y: r.y };
      dog.state = 'walk';
      if (dist(dog.x, dog.y, r.x, r.y) < 95) {
        dog.tryRide();
        this.state.mounted = true;
        g.particles.hearts(r.x, r.y - 60, 4);
        g.sound.bark();
      }
      if (this.elapsed > 9 && !this.state.mounted) this.finished = true;
    } else {
      // hand control back — the dog stays on for a while ambient-style
      this.finished = true;
    }
  },
  end(g) {
    g.dog.hurry = false;
  },
};

// ---------------------------------------------- mop emergency (poopocalypse)
// Never picked randomly — the game FORCES it once the robot realizes what it
// has been driving through.
const MopMode = {
  name: 'mopMode',
  weight: 0,
  canRun: () => false,
  maxDur: 120,
  start(g) {
    const r = g.robot;
    this.state = { phase: 'notice', t: 0, sprayT: 0, squeegeeT: 0, dockPhase: null, beepT: 0, success: false };
    r.targetSpeed = 0;
    r.actionDockOk = true;
    r.setExpr('dizzy', 2.2);
    g.sound.alarm();
    g.shake(3);
  },
  // shared back-in docking maneuver; returns true when parked
  dockManeuver(g, st, dt) {
    const r = g.robot;
    switch (st.dockPhase) {
      case 'go': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y, 195, 28, { ignoreDock: true })) {
          st.dockPhase = 'turn';
        }
        break;
      }
      case 'turn': {
        if (r.faceAngle(Math.PI / 2, 3)) st.dockPhase = 'back';
        break;
      }
      case 'back': {
        r.heading = Math.PI / 2;
        r.targetSpeed = -62;
        r.x = damp(r.x, g.dock.x, 5, dt);
        st.beepT -= dt;
        if (st.beepT <= 0) {
          st.beepT = 0.72;
          g.sound.backupBeep();
        }
        if (r.y <= g.dock.parkY) {
          r.y = g.dock.parkY;
          r.x = g.dock.x;
          r.targetSpeed = 0;
          r.speed = 0;
          st.dockPhase = null;
          g.sound.dockChime();
          return true;
        }
        break;
      }
    }
    return false;
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    switch (st.phase) {
      case 'notice': {
        // the horrified realization
        r.targetSpeed = 0;
        r.spinExtra = Math.sin(st.t * 24) * 0.05;
        if (st.t > 0.5 && !st.saidUhOh) {
          st.saidUhOh = true;
          g.say('uh_oh', { force: true });
        }
        if (st.t > 1.7) {
          r.spinExtra = 0;
          st.t = 0;
          if (!g.dock.canMop()) {
            // no water service — complain and leave the mess for the human
            g.say(g.dock.needsClean() ? 'clean_empty' : 'dirty_full', { force: true });
            g.sound.errorBuzz();
            g.mopComplained = true;
            r.setExpr('sleepy', 2.5);
            st.phase = 'giveup';
          } else {
            g.say('go_mop_install');
            r.setExpr('determined', 4);
            st.phase = 'toDock';
            st.dockPhase = 'go';
          }
        }
        break;
      }
      case 'giveup': {
        r.targetSpeed = 0;
        if (st.t > 1.4) this.finished = true;
        break;
      }
      case 'toDock': {
        if (this.dockManeuver(g, st, dt)) {
          st.phase = 'install';
          st.t = 0;
        }
        break;
      }
      case 'install': {
        // pads clip on at the dock
        r.targetSpeed = 0;
        if (st.t > 0.4 && !st.clunked) {
          st.clunked = true;
          g.sound.clunk();
        }
        if (st.t > 0.9 && !r.mopMode) {
          r.mopMode = true;
          g.sound.clunk();
          g.particles.sparkle(r.x, r.y + 30, 6);
        }
        if (st.t > 1.6) {
          g.say('mop_installed');
          r.trailMode = 'mop';
          st.phase = 'leaveDock';
          st.t = 0;
        }
        break;
      }
      case 'leaveDock': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 30, 130, 26, { ignoreDock: true })) {
          st.phase = 'mop';
          st.t = 0;
        }
        break;
      }
      case 'mop': {
        const pile = g.dirt.find((d) => d.type === 'poop');
        const smear = g.smears.nearest(r.x, r.y);
        const target = smear || pile;
        if (!target) {
          st.phase = 'toWash';
          st.t = 0;
          st.dockPhase = 'go';
          g.say('go_mop_wash');
          g.sound.happyBeeps(2);
          break;
        }
        r.driveTo(target.x, target.y, 165, 26);
        break;
      }
      case 'toWash': {
        if (this.dockManeuver(g, st, dt)) {
          st.phase = 'wash';
          st.t = 0;
          g.say('washing');
        }
        break;
      }
      case 'wash': {
        // scrub scrub — clean water in, dirty water out, gauges move
        r.targetSpeed = 0;
        r.spinExtra = Math.sin(st.t * 10) * 0.04;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 3), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 3), 0, 1);
        st.beepT -= dt;
        if (st.beepT <= 0) {
          st.beepT = 0.85;
          g.sound.washSwish();
        }
        if (Math.random() < 0.4) {
          g.particles.add({
            x: r.x + rand(-40, 40), y: r.y + rand(10, 40),
            kind: 'bubble', size: rand(4, 9), life: rand(0.4, 0.8),
            vy: rand(-35, -10), vx: rand(-12, 12),
          });
        }
        if (st.t > 3.0) {
          st.phase = 'uninstall';
          st.t = 0;
          r.spinExtra = 0;
        }
        break;
      }
      case 'uninstall': {
        r.targetSpeed = 0;
        if (st.t > 0.35 && r.mopMode) {
          r.mopMode = false;
          if (r.trailMode === 'mop') r.trailMode = null;
          g.sound.clunk();
        }
        if (st.t > 0.9) {
          st.phase = 'leaveDock2';
          st.t = 0;
          st.success = true;
          g.say('mop_done');
          g.sound.tada();
          g.particles.confettiBurst(r.x, r.y - 40, 24);
        }
        break;
      }
      case 'leaveDock2': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 20, 130, 26, { ignoreDock: true })) {
          this.finished = true;
        }
        break;
      }
    }
    // the pad wipes whatever it passes over
    if (r.mopMode) {
      const wiped = g.smears.wipeAt(r.x, r.y, 64);
      if (wiped > 0) {
        st.squeegeeT -= dt;
        if (st.squeegeeT <= 0) {
          st.squeegeeT = 0.28;
          g.sound.squeegee();
        }
        for (let i = 0; i < Math.min(wiped, 3); i++) {
          g.particles.add({
            x: r.x + rand(-30, 30), y: r.y + rand(0, 34),
            kind: 'bubble', size: rand(5, 10), life: rand(0.4, 0.8),
            vy: rand(-40, -12), vx: rand(-16, 16),
          });
        }
      }
      // rolling over a remaining pile in mop mode cleans it whole
      const pile = g.dirt.find((d) => d.type === 'poop' && dist(d.x, d.y, r.x, r.y) < r.radius + 14);
      if (pile) {
        g.dirt.remove(pile);
        g.sound.squelch();
        g.particles.dustPuff(pile.x, pile.y, 8, 'rgba(150, 110, 70, 0.45)');
        for (let i = 0; i < 8; i++) {
          g.particles.add({
            x: pile.x + rand(-20, 20), y: pile.y + rand(-14, 14),
            kind: 'bubble', size: rand(6, 12), life: rand(0.5, 1), vy: rand(-50, -20),
          });
        }
      }
      // fine water mist behind while moving
      st.sprayT -= dt;
      if (st.sprayT <= 0 && Math.abs(r.speed) > 30) {
        st.sprayT = 0.1;
        const bx = r.x - Math.cos(r.heading) * 40;
        const by = r.y - Math.sin(r.heading) * 40;
        g.particles.add({
          x: bx + rand(-22, 22), y: by + rand(-10, 10),
          kind: 'dot', color: 'rgba(120, 200, 255, 0.7)',
          size: rand(3, 5), life: rand(0.3, 0.55),
          vy: rand(-15, 10), vx: rand(-14, 14),
        });
      }
    }
  },
  end(g) {
    const r = g.robot;
    r.mopMode = false;
    if (r.trailMode === 'mop') r.trailMode = null;
    r.actionDockOk = false;
    r.spinExtra = 0;
    if (this.state?.success) {
      r.setExpr('love', 2);
      g.sound.fanfare();
      g.particles.sparkle(r.x, r.y - 40, 14);
    }
  },
};

// --------------------------------------------------------------- happy beeps
const HappyBeeps = {
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

// ----------------------------------------------------------------- fireworks
const Fireworks = {
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

// -------------------------------------------------------------------- sneeze
const Sneeze = {
  name: 'sneeze',
  weight: 6,
  maxDur: 6,
  start(g) {
    this.state.phase = 'inhale';
    this.state.t = 0;
    g.sound.sneezeInhale(1.4);
    g.robot.setExpr('effort', 1.6);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    r.targetSpeed = 0;
    if (st.phase === 'inhale') {
      // tremble grows
      r.spinExtra = Math.sin(st.t * 30) * 0.04 * st.t;
      if (chance(0.4)) {
        const a = rand(0, TAU);
        const d = rand(60, 130);
        g.particles.add({
          x: r.x + Math.cos(a) * d,
          y: r.y + Math.sin(a) * d - 20,
          kind: 'dot',
          color: 'rgba(200, 190, 175, 0.6)',
          size: 4,
          life: 0.3,
          vx: -Math.cos(a) * d * 2.6,
          vy: -Math.sin(a) * d * 2.6,
        });
      }
      if (st.t > 1.5) {
        st.phase = 'achoo';
        st.t = 0;
        r.spinExtra = 0;
        g.sound.sneezeBlow();
        g.shake(4);
        // blast of dust forward + recoil
        const mouth = r.mouthPos();
        const fx = Math.cos(r.heading);
        const fy = Math.sin(r.heading);
        for (let i = 0; i < 22; i++) {
          g.particles.add({
            x: mouth.x, y: mouth.y,
            kind: 'puff',
            color: `rgba(${170 + (rand(-25, 25) | 0)}, ${158 + (rand(-25, 25) | 0)}, 140, 0.75)`,
            size: rand(8, 20),
            life: rand(0.5, 1),
            vx: fx * rand(180, 460) + rand(-90, 90),
            vy: fy * rand(180, 460) + rand(-90, 90),
          });
        }
        // sneezed-out crumbs to re-vacuum!
        for (let i = 0; i < 3; i++) {
          const px = r.x + fx * rand(130, 300) + rand(-70, 70);
          const py = clamp(r.y + fy * rand(130, 300) + rand(-70, 70), g.room.bounds.minY, g.room.bounds.maxY);
          if (g.room.isFree(px, py, 30)) g.dirt.spawn(pick(['crumbs', 'dustbunny']), px, py, { drop: 0 });
        }
        r.speed = -260; // recoil!
        r.setExpr('dizzy', 1.6);
      }
    } else if (st.phase === 'achoo') {
      if (st.t > 1.4) {
        g.sound.happyBeeps(2);
        r.setExpr('happy', 1.5);
        this.finished = true;
      }
    }
  },
};

// ------------------------------------------------------------- bounce party
const BounceParty = {
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

// -------------------------------------------------------------- hover mode
const HoverMode = {
  name: 'hoverMode',
  weight: 6,
  maxDur: 12,
  canRun: (g) => g.robot.battery > 0.3,
  start(g) {
    this.state.phase = 'up';
    this.state.angle = 0;
    this.state.center = { x: g.robot.x, y: g.robot.y };
    this.state.flameT = 0;
    g.sound.whoosh();
    g.robot.setExpr('happy', 10);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    r.targetSpeed = 0;
    st.flameT -= dt;
    if (st.flameT <= 0 && st.phase !== 'done') {
      st.flameT = 0.05;
      g.particles.add({
        x: r.x + rand(-24, 24),
        y: r.y + 8,
        kind: 'flame',
        size: rand(8, 16),
        life: rand(0.2, 0.4),
        vy: rand(60, 140),
        vx: rand(-30, 30),
      });
      if (chance(0.2)) g.sound.jetFlame(0.15);
    }
    switch (st.phase) {
      case 'up': {
        r.z = lerp(r.z, 100, 1 - Math.exp(-2.5 * dt));
        if (r.z > 92) {
          st.phase = 'fly';
          st.t = 0;
        }
        break;
      }
      case 'fly': {
        st.angle += dt * 0.85;
        // big lazy circuit over the whole room — flying over furniture!
        const cx = 840, cy = 600;
        const tx = cx + Math.cos(st.angle + Math.PI) * 480;
        const ty = cy + Math.sin(st.angle + Math.PI) * 260;
        const a = angleTo(r.x, r.y, tx, ty);
        r.heading = a;
        r.x = lerp(r.x, tx, 1 - Math.exp(-2.2 * dt));
        r.y = lerp(r.y, ty, 1 - Math.exp(-2.2 * dt));
        r.z = 100 + Math.sin(this.elapsed * 3) * 12;
        if (this.elapsed > 8.5) {
          st.phase = 'land';
          st.landing = g.room.randomFloorPoint(75);
        }
        break;
      }
      case 'land': {
        r.x = lerp(r.x, st.landing.x, 1 - Math.exp(-3 * dt));
        r.y = lerp(r.y, st.landing.y, 1 - Math.exp(-3 * dt));
        r.z = Math.max(0, r.z - 130 * dt);
        if (r.z <= 0) {
          st.phase = 'done';
          g.particles.dustPuff(r.x, r.y + 10, 12);
          g.sound.bump();
          g.sound.happyBeeps(4);
          this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    g.robot.z = 0;
  },
};

// -------------------------------------------------------------- under couch
const UnderCouch = {
  name: 'underCouch',
  weight: 7,
  maxDur: 16,
  start(g) {
    this.state.phase = 'approach';
    this.state.t = 0;
    this.state.rattleT = 0;
    g.robot.setExpr('determined', 4);
    g.sound.ackBeep();
  },
  update(g, dt) {
    const g_ = g;
    const r = g.robot;
    const st = this.state;
    const couch = g.room.couch;
    st.t += dt;
    switch (st.phase) {
      case 'approach': {
        if (r.driveTo(couch.cx + 60, 700, 180, 30)) {
          st.phase = 'dive';
          r.allowUnderCouch = true;
          g.sound.whoosh();
        }
        break;
      }
      case 'dive': {
        if (r.driveTo(couch.cx, 870, 130, 26, { ignoreCouch: true })) {
          st.phase = 'rummage';
          st.t = 0;
        }
        break;
      }
      case 'rummage': {
        r.targetSpeed = 0;
        st.rattleT -= dt;
        if (st.rattleT <= 0) {
          st.rattleT = rand(0.5, 0.9);
          g.sound.rattle();
          g.shakeCouch = 0.3;
          // dust squirts out the sides
          const side = pick([-1, 1]);
          g.particles.dustPuff(couch.cx + side * 260, 900, 5);
        }
        // wander around under there (but stay hidden under the couch)
        r.heading += rand(-3, 3) * dt;
        r.targetSpeed = 60;
        const foot = couch.foot;
        r.x = clamp(r.x, foot.x + 60, foot.x + foot.w - 60);
        r.y = clamp(r.y, foot.y + 70, foot.y + foot.h - 20);
        if (st.t > 3.2) {
          st.phase = 'emerge';
          st.t = 0;
        }
        break;
      }
      case 'emerge': {
        if (r.driveTo(couch.cx + 40, 690, 140, 30, { ignoreCouch: true })) {
          r.allowUnderCouch = false;
          st.phase = 'reveal';
          st.t = 0;
          // treasure! dust bunnies scatter out & robot wears one as a hat
          g.hatTime = 7;
          g.sound.tada();
          g.particles.dustPuff(r.x, r.y, 14);
          for (let i = 0; i < 2; i++) {
            const a = rand(-Math.PI * 0.8, -Math.PI * 0.2);
            g.dirt.spawn('dustbunny', r.x + Math.cos(a) * rand(80, 150), Math.max(g.room.bounds.minY, r.y + Math.sin(a) * rand(60, 120)), { drop: 30 });
          }
          if (chance(0.6)) {
            const ball = g.dirt.spawn('toy_ball', couch.cx - 100, 720, {});
            ball.vx = rand(-160, -60);
            ball.vy = rand(-40, 40);
            g.sound.boing();
          }
          r.setExpr('love', 3);
          g.sound.happyBeeps(5);
        }
        break;
      }
      case 'reveal': {
        r.targetSpeed = 0;
        if (st.t > 1.6) this.finished = true;
        break;
      }
    }
  },
  end(g) {
    g.robot.allowUnderCouch = false;
  },
};
