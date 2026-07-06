// Dirt on the floor: crumbs, cereal, dust bunnies, leaves, sparkles — all
// vacuumable. Socks and toys are special: only the robot ARM can fetch them.
import { TAU, rand, pick, clamp, lerp, chance, dist, easeInCubic } from '../core/math.js';
import { roundRect, starPath } from '../world/Room.js';

const VAC_TYPES = ['crumbs', 'cereal', 'dustbunny', 'leaf', 'sparkle'];
const TAP_CYCLE = ['crumbs', 'cereal', 'dustbunny', 'sparkle', 'leaf'];

let nextId = 1;

export class DirtSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.tapCycleIdx = 0;
  }

  count() {
    return this.items.filter((d) => !d.sucking && d.vac).length;
  }

  spawn(type, x, y, opts = {}) {
    const d = {
      id: nextId++,
      type,
      x, y,
      vac: VAC_TYPES.includes(type),
      scale: 0,
      targetScale: opts.scale ?? rand(0.85, 1.15),
      rot: rand(0, TAU),
      wobble: rand(0, TAU),
      sucking: false,
      suckT: 0,
      age: 0,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
      playerMade: opts.playerMade ?? false,
      tint: opts.tint ?? pick(['#ff5d8f', '#ffb42e', '#3ddad7', '#a685f5', '#7ed957']),
      drop: opts.drop ?? 0, // fall-in height
      dropV: 0,
    };
    this.items.push(d);
    // anything landing on the floor re-arms the all-clean celebration — and
    // rouses a robot that parked itself after the last win
    this.game.roomDirty = true;
    const r = this.game.robot;
    if (r && r.state === 'docked' && !r.stayDocked && !r.waitingForBag) {
      r.dockedUndockT = Math.min(r.dockedUndockT, 0.8);
    }
    return d;
  }

  spawnRandom() {
    const { x, y } = this.game.room.randomFloorPoint(40);
    const type = pick(VAC_TYPES);
    this.spawn(type, x, y);
  }

  // A toddler tapped the floor: sprinkle a little cluster of mess!
  playerSprinkle(x, y) {
    const type = TAP_CYCLE[this.tapCycleIdx % TAP_CYCLE.length];
    this.tapCycleIdx++;
    const n = type === 'dustbunny' ? 1 : type === 'sparkle' ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const r = i === 0 ? 0 : rand(18, 52);
      const d = this.spawn(type, x + Math.cos(a) * r, y + Math.sin(a) * r, {
        playerMade: true,
        drop: rand(60, 140),
      });
      d.dropV = 0;
    }
    return type;
  }

  // small crumb while dragging finger
  playerCrumb(x, y) {
    this.spawn(pick(['crumbs', 'cereal']), x, y, { playerMade: true, drop: 40, scale: rand(0.6, 0.9) });
  }

  // launch an item in a big ballistic arc to a target spot
  toss(d, tx, ty) {
    const span = dist(d.x, d.y, tx, ty);
    d.toss = {
      fromX: d.x, fromY: d.y, toX: tx, toY: ty,
      t: 0,
      dur: clamp(span / 850, 0.55, 1.15),
      peak: 130 + span * 0.12,
    };
    d.drop = 0.01;
  }

  update(dt) {
    // NOTE: no ambient spawning — dirt only appears when the PLAYER makes it
    // (tapping the floor, shaking the plant, launching toys, dragging socks,
    // poking the dog...) so a fully-clean room stays clean and earns the party.
    // too many toys on the floor: the oldest one magically "gets put away"
    const toys = this.items.filter((d) => d.type === 'toy_ball' || d.type === 'toy_block');
    if (toys.length > 5) {
      const oldest = toys.reduce((a, b) => (a.age > b.age ? a : b));
      if (!oldest.fading) {
        oldest.fading = true;
        oldest.targetScale = 0;
        this.game.particles.sparkle(oldest.x, oldest.y, 6);
        setTimeout(() => this.remove(oldest), 600);
      }
    }
    const room = this.game.room;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.age += dt;
      d.wobble += dt;
      d.scale = lerp(d.scale, d.targetScale, 1 - Math.exp(-10 * dt));
      // ballistic toss (toys launched from the toybox)
      if (d.toss) {
        const ts = d.toss;
        ts.t += dt / ts.dur;
        const k = Math.min(1, ts.t);
        d.x = lerp(ts.fromX, ts.toX, k);
        d.y = lerp(ts.fromY, ts.toY, k);
        d.drop = Math.sin(Math.PI * k) * ts.peak + 0.01;
        d.rot += dt * 9;
        if (ts.t >= 1) {
          d.toss = null;
          d.drop = 0;
          this.game.particles.dustPuff(d.x, d.y, 5);
          this.game.sound.boing();
          if (d.type === 'toy_ball') {
            d.vx = rand(-70, 70);
            d.vy = rand(-70, 70);
          }
        }
        continue;
      }
      // drop-in animation
      if (d.drop > 0) {
        d.dropV += 900 * dt;
        d.drop -= d.dropV * dt;
        if (d.drop <= 0) {
          d.drop = 0;
          if (d.type !== 'sparkle') this.game.particles.dustPuff(d.x, d.y, 3);
        }
      }
      // physics for rolled toys
      if (Math.abs(d.vx) > 1 || Math.abs(d.vy) > 1) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= 1 - 2.4 * dt;
        d.vy *= 1 - 2.4 * dt;
        if (d.type === 'toy_ball') d.rot += d.vx * 0.02 * dt * 60;
        const b = room.bounds;
        if (d.x < b.minX - 40) { d.x = b.minX - 40; d.vx *= -0.7; }
        if (d.x > b.maxX + 40) { d.x = b.maxX + 40; d.vx *= -0.7; }
        if (d.y < b.minY - 20) { d.y = b.minY - 20; d.vy *= -0.7; }
        if (d.y > b.maxY + 40) { d.y = b.maxY + 40; d.vy *= -0.7; }
      }
      // dust bunnies drift veeery slowly
      if (d.type === 'dustbunny' && !d.sucking) {
        d.x += Math.sin(d.wobble * 0.6) * 3 * dt;
        d.y += Math.cos(d.wobble * 0.45) * 2 * dt;
      }
      // suck animation: spiral into the robot's mouth
      if (d.sucking) {
        d.suckT += dt / 0.3;
        const r = this.game.robot;
        const mouth = r.mouthPos();
        const t = easeInCubic(clamp(d.suckT, 0, 1));
        d.x = lerp(d.x, mouth.x, t * 0.6 + 0.2);
        d.y = lerp(d.y, mouth.y, t * 0.6 + 0.2);
        d.rot += 14 * dt;
        d.scale = d.targetScale * (1 - t * 0.9);
        if (d.suckT >= 1) {
          this.items.splice(i, 1);
          r.onDirtSwallowed(d);
        }
      }
    }
  }

  // find a vacuumable dirt near the robot's mouth
  trySuck(robot) {
    const mouth = robot.mouthPos();
    for (const d of this.items) {
      if (!d.vac || d.sucking || d.drop > 0) continue;
      const dx = d.x - mouth.x;
      const dy = d.y - mouth.y;
      if (dx * dx + dy * dy < 55 * 55) {
        d.sucking = true;
        d.suckT = 0;
        robot.onDirtCaught(d);
      }
    }
  }

  nearestVac(x, y, playerOnly = false) {
    let best = null;
    let bestD = Infinity;
    for (const d of this.items) {
      if (!d.vac || d.sucking) continue;
      if (d.shunned && d.shunned > this.game.time) continue;
      if (playerOnly && !d.playerMade) continue;
      const dd = (d.x - x) ** 2 + (d.y - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  find(predicate) {
    return this.items.find(predicate);
  }

  remove(d) {
    const i = this.items.indexOf(d);
    if (i >= 0) this.items.splice(i, 1);
  }

  tapToy(x, y) {
    for (const d of this.items) {
      if (d.type !== 'toy_ball' && d.type !== 'toy_block') continue;
      if ((d.x - x) ** 2 + (d.y - y) ** 2 < 55 * 55) return d;
    }
    return null;
  }

  draw(ctx, assets) {
    for (const d of this.items) {
      ctx.save();
      ctx.translate(d.x, d.y - d.drop);
      ctx.rotate(d.type === 'crumbs' || d.type === 'cereal' ? 0 : Math.sin(d.wobble) * 0.06 + (d.type.startsWith('toy') || d.type === 'sock' ? d.rot * 0.15 : 0));
      ctx.scale(d.scale, d.scale);
      if (d.drop > 0) ctx.globalAlpha = 0.9;
      const img = d.type === 'sock'
        ? assets.getTinted('sock', d.tint)
        : assets.get(spriteFor(d.type));
      if (img) {
        const s = sizeFor(d.type);
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      } else {
        drawFallback(ctx, d);
      }
      ctx.restore();
      // fresh poop steams gently (fades as it, er, matures)
      if (d.type === 'poop' && d.age < 8) {
        const fade = 1 - d.age / 8;
        ctx.strokeStyle = `rgba(180, 170, 160, ${0.35 * fade})`;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        for (const off of [-8, 6]) {
          const ph = d.wobble * 2 + off;
          ctx.beginPath();
          ctx.moveTo(d.x + off, d.y - 18);
          ctx.quadraticCurveTo(
            d.x + off + Math.sin(ph) * 6, d.y - 30,
            d.x + off + Math.sin(ph + 1) * 8, d.y - 42 - fade * 4
          );
          ctx.stroke();
        }
      }
      // soft contact shadow while dropping
      if (d.drop > 0) {
        ctx.fillStyle = 'rgba(90,50,30,0.15)';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y + 4, 14 * d.scale, 5 * d.scale, 0, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function spriteFor(type) {
  return type === 'toy_ball' ? 'toy_ball' : type === 'toy_block' ? 'toy_block' : type;
}

function sizeFor(type) {
  switch (type) {
    case 'dustbunny': return 58;
    case 'crumbs': return 44;
    case 'cereal': return 40;
    case 'leaf': return 48;
    case 'sparkle': return 42;
    case 'sock': return 62;
    case 'toy_ball': return 56;
    case 'toy_block': return 50;
    case 'poop': return 54;
    default: return 44;
  }
}

function drawFallback(ctx, d) {
  switch (d.type) {
    case 'crumbs': {
      ctx.fillStyle = '#8a5a2e';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + d.id;
        const r = i === 0 ? 0 : 6 + ((i * 13) % 9);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 3.4 + ((i * 7) % 3), 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'cereal': {
      const colors = ['#ffb42e', '#ff8a5c', '#e8656f'];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + d.id * 1.7;
        const r = i === 0 ? 0 : 13;
        ctx.strokeStyle = colors[(i + d.id) % 3];
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 7, 0, TAU);
        ctx.stroke();
      }
      break;
    }
    case 'dustbunny': {
      // fluffy gray ball with shy little eyes
      ctx.fillStyle = 'rgba(155, 145, 150, 0.92)';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + d.wobble * 0.3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 11, Math.sin(a) * 9, 12, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(185, 175, 180, 0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, TAU);
      ctx.fill();
      // eyes blink
      const blink = Math.sin(d.wobble * 1.4 + d.id) > 0.94;
      ctx.fillStyle = '#3a3340';
      if (blink) {
        ctx.fillRect(-8, -2, 6, 2.4);
        ctx.fillRect(3, -2, 6, 2.4);
      } else {
        ctx.beginPath();
        ctx.arc(-5, -2, 2.6, 0, TAU);
        ctx.arc(5, -2, 2.6, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'leaf': {
      ctx.rotate(d.id % 6);
      ctx.fillStyle = ['#7ed957', '#5cb85c', '#98d977'][d.id % 3];
      ctx.beginPath();
      ctx.ellipse(0, 0, 19, 11, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 90, 30, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, 5);
      ctx.quadraticCurveTo(0, -2, 16, -6);
      ctx.stroke();
      break;
    }
    case 'sparkle': {
      const tw = 0.75 + 0.25 * Math.sin(d.wobble * 5);
      ctx.scale(tw, tw);
      ctx.fillStyle = '#ffe066';
      starPath(ctx, 0, 0, 4, 17, 6);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      starPath(ctx, 0, 0, 4, 8, 3);
      ctx.fill();
      break;
    }
    case 'sock': {
      ctx.rotate(0.5);
      ctx.fillStyle = d.tint;
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
      // stripes
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      roundRect(ctx, -12, -10, 24, 5, 2.5);
      ctx.fill();
      break;
    }
    case 'toy_ball': {
      ctx.rotate(d.rot);
      const g = ctx.createRadialGradient(-6, -8, 2, 0, 0, 24);
      g.addColorStop(0, '#ffde59');
      g.addColorStop(0.5, d.tint);
      g.addColorStop(1, shade(d.tint));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0.4, 1.8);
      ctx.stroke();
      break;
    }
    case 'toy_block': {
      ctx.rotate(d.rot * 0.3);
      ctx.fillStyle = d.tint;
      roundRect(ctx, -20, -20, 40, 40, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      starPath(ctx, 0, 0, 5, 12, 5.5);
      ctx.fill();
      break;
    }
    case 'poop': {
      // the classic swirl
      ctx.fillStyle = '#7a4a26';
      for (const [w, h, y] of [[24, 12, 8], [18, 10, -1], [11, 8, -9]]) {
        ctx.beginPath();
        ctx.ellipse(0, y, w, h, 0, 0, TAU);
        ctx.fill();
      }
      // curled tip
      ctx.strokeStyle = '#7a4a26';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(3, -14, 4, Math.PI, TAU * 0.9);
      ctx.stroke();
      // glossy highlight
      ctx.fillStyle = 'rgba(255, 230, 200, 0.3)';
      ctx.beginPath();
      ctx.ellipse(-7, -2, 5, 3, 0.5, 0, TAU);
      ctx.fill();
      break;
    }
  }
}

function shade(hex) {
  // crude darken
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 60);
  const g = Math.max(0, ((n >> 8) & 255) - 60);
  const b = Math.max(0, (n & 255) - 60);
  return `rgb(${r},${g},${b})`;
}
