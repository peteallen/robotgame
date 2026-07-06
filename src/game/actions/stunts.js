// Showy solo stunts — the robot zooms, paints rainbows, blows bubbles, throws
// a disco, hovers on jets, dives under the couch, sneezes, or gives the dog a
// ride. Big movement, big spectacle, no chores.
import { TAU, rand, pick, chance, clamp, lerp, dist, angleTo } from '../core/math.js';

// ---------------------------------------------------------------- turbo zoom
export const TurboZoom = {
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
export const RainbowTrail = {
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
export const BubbleParty = {
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
export const DiscoMode = {
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

// -------------------------------------------------------------- hover mode
export const HoverMode = {
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
export const UnderCouch = {
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

// -------------------------------------------------------------------- sneeze
export const Sneeze = {
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

// ------------------------------------------------------------------ dog ride
export const DogRide = {
  name: 'dogRide',
  weight: 8,
  maxDur: 11,
  canRun: (g) => g.dog.state !== 'ride' && g.dog.state !== 'startle' && !g.dog.pooping(),
  start(g) {
    g.dog.hurry = true;
    g.dog.beginWalk({ x: g.robot.x, y: g.robot.y });
    g.dog.bark();
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
        g.dog.bark();
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
