// Game: owns the world, update/draw pipeline, y-sorted rendering and input.
import { TAU, clamp, lerp, rand, pick, chance, dist, damp, angleTo } from './core/math.js';
import { SoundEngine } from './core/SoundEngine.js';
import { Particles } from './fx/Particles.js';
import { Smears } from './fx/Smears.js';
import { Room, WORLD_W, WORLD_H, roundRect } from './world/Room.js';
import { Dock } from './entities/Dock.js';
import { Robot } from './entities/Robot.js';
import { DirtSystem } from './entities/DirtSystem.js';
import { Dog } from './entities/Dog.js';
import { Ambience } from './entities/Ambience.js';
import { Hud } from './ui/Hud.js';
import { ActionRegistry } from './actions/ActionRegistry.js';
import { registerDefaultActions } from './actions/DefaultActions.js';

export class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.sound = new SoundEngine();
    this.particles = new Particles();
    this.smears = new Smears(this);
    this.room = new Room(this);
    this.dock = new Dock(this);
    this.robot = new Robot(this);
    this.dirt = new DirtSystem(this);
    this.dog = new Dog(this);
    this.ambience = new Ambience(this);
    this.pendingMop = false;
    this.hud = new Hud(this);
    this.actions = new ActionRegistry(this);
    registerDefaultActions(this.actions);

    this.time = 0;
    this.dt = 0.016;
    this.dim = 0;
    this.dimTarget = 0;
    this.shakeAmt = 0;
    this.shakeCouch = 0;
    this.hatTime = 0;
    this.celebration = null;
    this.stats = { pickups: 0 };

    // view transform
    this.scale = 1;
    this.offX = 0;
    this.offY = 0;

    // input state
    this.pointerDown = false;
    this.downPos = null;
    this.downTime = 0;
    this.lastCrumb = null;
    this.dragSpawned = 0;

    // socks live in the laundry basket between deliveries — shared across
    // every browser via the dev server's stash (localStorage as fallback)
    this.basketSocks = this.loadSocks();
    this.pendingSockDrag = false;
    this.dragSock = null; // {tint, x, y} while a sock rides the finger
    this.syncSocks(true);
    this._sockPoll = setInterval(() => {
      if (!document.hidden) this.syncSocks(false);
    }, 8000);

    // seed a few dirt piles so there's something to do immediately
    for (let i = 0; i < 6; i++) this.dirt.spawnRandom();

    this.resize();
    this._raf = null;
    this._last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this.update(dt);
      this.draw();
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.dpr = dpr;
    const scale = Math.min(w / WORLD_W, h / WORLD_H);
    this.scale = scale;
    this.offX = (w - WORLD_W * scale) / 2;
    this.offY = (h - WORLD_H * scale) / 2;
  }

  screenToWorld(cx, cy) {
    return {
      x: (cx - this.offX) / this.scale,
      y: (cy - this.offY) / this.scale,
    };
  }

  shake(amt) {
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  // is a potty disaster anywhere in progress?
  messActive() {
    return this.pendingMop ||
      this.robot.smearT > 0 ||
      this.robot.mopMode ||
      this.smears.count > 0 ||
      this.actions.current?.name === 'mopMode' ||
      this.dog.pooping() ||
      this.dirt.items.some((d) => d.type === 'poop');
  }

  // ---- the sock stash -------------------------------------------------------

  loadSocks() {
    try {
      const raw = JSON.parse(localStorage.getItem('robo_socks'));
      if (Array.isArray(raw) && raw.every((t) => typeof t === 'string')) return raw.slice(0, 8);
    } catch (e) { /* fresh start */ }
    return ['#ff8fa3', '#8fd7ff'];
  }

  saveSocks() {
    try {
      localStorage.setItem('robo_socks', JSON.stringify(this.basketSocks));
    } catch (e) { /* private mode etc. — the server stash still works */ }
    // publish to the shared house-wide stash (dev server); absent on static hosts
    fetch(`${import.meta.env.BASE_URL}api/socks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.basketSocks),
    }).catch(() => {});
  }

  // adopt the server's shared stash so every browser sees the same basket
  async syncSocks(seedIfEmpty) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/socks`, { cache: 'no-store' });
      if (!res.ok) return;
      const socks = await res.json();
      if (Array.isArray(socks) && socks.length <= 16 && socks.every((t) => typeof t === 'string')) {
        // don't yank a sock out from under an active finger
        if (!this.dragSock && !this.pendingSockDrag) {
          this.basketSocks = socks.slice(0, 8);
          try {
            localStorage.setItem('robo_socks', JSON.stringify(this.basketSocks));
          } catch (e) { /* ok */ }
        }
      } else if (socks === null && seedIfEmpty) {
        // first browser to connect seeds the stash
        this.saveSocks();
      }
    } catch (e) { /* no backend (e.g. GitHub Pages) — localStorage only */ }
  }

  addBasketSock(tint) {
    this.basketSocks.push(tint || '#ff8fa3');
    if (this.basketSocks.length > 8) this.basketSocks.shift();
    this.saveSocks();
  }

  takeBasketSock() {
    const tint = this.basketSocks.pop() || null;
    if (tint) this.saveSocks();
    return tint;
  }

  basketHit(x, y) {
    const b = this.room.furniture.find((f) => f.name === 'basket');
    return x > b.cx - b.w / 2 - 12 && x < b.cx + b.w / 2 + 12 &&
      y > b.cy - b.h / 2 - 30 && y < b.cy + b.h / 2 + 16;
  }

  // a sock hops out of the basket onto the floor
  popSockOut() {
    const tint = this.takeBasketSock();
    if (!tint) {
      this.sound.squeak();
      return;
    }
    let spot = null;
    for (let i = 0; i < 24; i++) {
      const x = 1250 + rand(-120, 160);
      const y = 420 + rand(-20, 140);
      if (this.room.isFree(x, y, 45)) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) spot = this.room.randomFloorPoint(50);
    this.dirt.spawn('sock', spot.x, spot.y, { tint, drop: rand(110, 160) });
    this.sound.boing();
    this.particles.sparkle(1545, 250, 4);
  }

  onPickup(d) {
    this.stats.pickups++;
    this.hud.onPickup();
  }

  celebrate() {
    this.celebration = { t: 0, next: 0, count: 0 };
    this.sound.fanfare();
  }

  // ---- input --------------------------------------------------------------

  onPointerDown(cx, cy) {
    this.sound.unlock();
    this.lastInteraction = this.time;
    const p = this.screenToWorld(cx, cy);
    this.pointerDown = true;
    this.downPos = p;
    this.downTime = this.time;
    this.lastCrumb = p;
    this.dragSpawned = 0;
    // starting on the basket with socks inside? might become a sock drag
    this.pendingSockDrag = this.basketHit(p.x, p.y) && this.basketSocks.length > 0;
  }

  onPointerMove(cx, cy) {
    if (!this.pointerDown || !this.lastCrumb) return;
    const p = this.screenToWorld(cx, cy);
    // a sock riding the finger
    if (this.dragSock) {
      this.dragSock.x = p.x;
      this.dragSock.y = p.y;
      return;
    }
    // drag started on the basket → pull a sock out
    if (this.pendingSockDrag && this.downPos && dist(p.x, p.y, this.downPos.x, this.downPos.y) > 28) {
      const tint = this.takeBasketSock();
      if (tint) {
        this.dragSock = { tint, x: p.x, y: p.y };
        this.sound.pop();
        this.particles.sparkle(p.x, p.y, 3);
      }
      this.pendingSockDrag = false;
      return;
    }
    if (this.pendingSockDrag) return;
    // finger-drag sprinkles a crumb trail for the robot to chase
    if (dist(p.x, p.y, this.lastCrumb.x, this.lastCrumb.y) > 80 && this.dragSpawned < 14) {
      const b = this.room.bounds;
      if (p.x > b.minX - 20 && p.x < b.maxX + 20 && p.y > b.minY - 10 && p.y < b.maxY + 30 && this.room.isFree(p.x, p.y, 20)) {
        this.dirt.playerCrumb(p.x, p.y);
        this.sound.pop();
        this.lastCrumb = p;
        this.dragSpawned++;
        if (this.dragSpawned === 3) {
          const d = this.dirt.nearestVac(this.robot.x, this.robot.y, true);
          if (d) this.robot.notifyNewDirt(d);
        }
      }
    }
  }

  onPointerUp(cx, cy) {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    const p = this.screenToWorld(cx, cy);
    // drop the dragged sock
    if (this.dragSock) {
      this.dropSock(p.x, p.y);
      this.pendingSockDrag = false;
      this.downPos = null;
      return;
    }
    this.pendingSockDrag = false;
    const wasDrag = this.downPos && dist(p.x, p.y, this.downPos.x, this.downPos.y) > 30;
    const held = this.time - this.downTime;
    if (!wasDrag && held < 0.6) this.tap(p.x, p.y);
    this.downPos = null;
  }

  dropSock(x, y) {
    const sock = this.dragSock;
    this.dragSock = null;
    // back over the basket: tuck it back in
    if (this.basketHit(x, y)) {
      this.addBasketSock(sock.tint);
      this.sound.pop();
      this.particles.sparkle(1545, 250, 4);
      return;
    }
    // find a landing spot on the floor near the finger
    const b = this.room.bounds;
    let spot = null;
    const cx = clamp(x, b.minX - 20, b.maxX + 30);
    const cy = clamp(y, b.minY - 20, b.maxY + 40);
    if (this.room.isFree(cx, cy, 36)) {
      spot = { x: cx, y: cy };
    } else {
      for (let rr = 50; rr <= 200 && !spot; rr += 50) {
        for (let i = 0; i < 10; i++) {
          const a = rand(0, Math.PI * 2);
          const sx = cx + Math.cos(a) * rr;
          const sy = cy + Math.sin(a) * rr;
          if (sx > b.minX - 20 && sx < b.maxX + 30 && sy > b.minY - 20 && sy < b.maxY + 40 && this.room.isFree(sx, sy, 36)) {
            spot = { x: sx, y: sy };
            break;
          }
        }
      }
    }
    if (!spot) {
      // nowhere sensible — it flies back to the basket
      this.addBasketSock(sock.tint);
      this.sound.whoosh();
      return;
    }
    this.dirt.spawn('sock', spot.x, spot.y, { tint: sock.tint, drop: 26 });
    this.sound.pop();
    this.particles.dustPuff(spot.x, spot.y, 3, 'rgba(255, 230, 180, 0.5)');
  }

  tap(x, y) {
    const r = this.robot;
    // 1. HUD buttons
    if (this.hud.onTap(x, y)) return;
    // 2. running action consumes taps (bubble popping!)
    if (this.actions.onTap(x, y)) return;
    // 3. the robot!
    if (dist(x, y, r.x, r.y - r.z) < r.radius + 34) {
      this.tapRobot();
      return;
    }
    // 4. the dog
    if (this.dog.contains(x, y)) {
      this.dog.onTap();
      return;
    }
    // 5. the dock — summon the robot home
    if (this.dock.contains(x, y)) {
      this.dock.beacon = 1.2;
      this.sound.ackBeep();
      this.robot.summon();
      return;
    }
    // 6. toys bounce when tapped
    const toy = this.dirt.tapToy(x, y);
    if (toy) {
      toy.vx = rand(-220, 220);
      toy.vy = rand(-220, 220);
      this.sound.squeak();
      this.particles.sparkle(toy.x, toy.y - 20, 4);
      return;
    }
    // 7. furniture & wall objects
    const hit = this.room.tapFurniture(x, y);
    if (hit === 'tv') {
      this.room.tv.on = this.room.tv.on > 0 ? 0 : 9;
      this.sound.ackBeep();
      if (this.room.tv.on > 0) this.sound.happyBeeps(4);
      return;
    }
    if (hit === 'plant') {
      this.room.plantSway = 1;
      this.sound.whoosh();
      // leaves tumble down for the robot to eat
      for (let i = 0; i < 2; i++) {
        const lx = 1520 + rand(-70, 40);
        const ly = 900 + rand(-30, 30);
        if (this.room.isFree(lx, ly, 26)) this.dirt.spawn('leaf', lx, ly, { drop: rand(120, 200) });
      }
      const d = this.dirt.nearestVac(r.x, r.y, false);
      if (d && chance(0.6)) r.notifyNewDirt(d);
      return;
    }
    if (hit === 'toybox') {
      // a toy LAUNCHES clear across the room!
      const kind = pick(['toy_ball', 'toy_block']);
      let spot = null;
      for (let i = 0; i < 30; i++) {
        const p = this.room.randomFloorPoint(45);
        if (dist(p.x, p.y, 1535, 585) > 380 && this.room.isFree(p.x, p.y, 45, { solidTable: true })) {
          spot = p;
          break;
        }
      }
      if (!spot) spot = this.room.randomFloorPoint(45);
      const t = this.dirt.spawn(kind, 1505, 545, {});
      t.scale = 0.25; // grows as it pops out
      this.dirt.toss(t, spot.x, spot.y);
      this.sound.pop();
      this.sound.whoosh();
      this.particles.sparkle(1520, 530, 6);
      return;
    }
    if (hit === 'couch') {
      this.shakeCouch = 0.4;
      this.sound.squeak();
      if (chance(0.35)) {
        // a shy dust bunny scoots out from under the couch
        const d = this.dirt.spawn('dustbunny', this.room.couch.cx + rand(-140, 140), 730, {});
        d.vy = 60;
        this.particles.dustPuff(d.x, 740, 4);
      }
      return;
    }
    if (hit === 'catbed') {
      if (dist(this.dog.x, this.dog.y, this.room.furniture[4].cx, this.room.furniture[4].cy) < 120) {
        this.dog.onTap();
      } else {
        this.sound.squeak();
      }
      return;
    }
    if (hit === 'basket') {
      this.popSockOut();
      return;
    }
    // 8. tap the floor: sprinkle a mess for Robo to clean!
    const b = this.room.bounds;
    if (x > b.minX - 40 && x < b.maxX + 40 && y > b.minY - 30 && y < b.maxY + 40) {
      this.dirt.playerSprinkle(x, y);
      this.sound.pop();
      this.particles.dustPuff(x, y, 3, 'rgba(255, 230, 180, 0.5)');
      const d = this.dirt.nearestVac(r.x, r.y, true);
      if (d) r.notifyNewDirt(d);
    } else {
      // wall tap — just sparkle
      this.particles.sparkle(x, y, 4);
      this.sound.pop();
    }
  }

  tapRobot() {
    const r = this.robot;
    // parked/summoned? tapping the robot wakes it up
    if (r.stayDocked) {
      r.wake();
      return;
    }
    const busyDocking = ['align', 'empty', 'charge', 'docked'].includes(r.state);
    if (this.actions.busy || busyDocking || r.state === 'godock') {
      // mini reaction instead of a full event
      this.sound.happyBeeps(2);
      this.particles.hearts(r.x, r.y - 60, 2);
      r.setExpr('love', 1);
      if (r.state === 'docked') r.dockedUndockT = Math.min(r.dockedUndockT, 0.3);
      if (!this.actions.busy && !busyDocking) r.hop(140);
      return;
    }
    const ok = this.actions.trigger();
    if (!ok) {
      this.sound.happyBeeps(2);
      r.hop(160);
    }
  }

  // ---- update / draw --------------------------------------------------------

  update(dt) {
    this.dt = dt;
    this.time += dt;
    // some environments (iPad rotation, emulated viewports) miss resize events
    if (window.innerWidth !== this._lastW || window.innerHeight !== this._lastH) {
      this._lastW = window.innerWidth;
      this._lastH = window.innerHeight;
      this.resize();
    }
    this.room.update(dt);
    this.ambience.update(dt);
    this.dock.update(dt);
    this.robot.update(dt);
    this.dirt.update(dt);
    this.dog.update(dt);
    this.actions.update(dt);
    this.particles.update(dt);
    this.smears.update(dt);
    this.hud.update(dt);
    this.dim = damp(this.dim, this.dimTarget, 4, dt);

    // socks left on the floor get fetched by the arm before long
    this.sockFetchT = (this.sockFetchT ?? 6) - dt;
    if (this.sockFetchT <= 0) {
      this.sockFetchT = 7;
      if (!this.actions.busy && this.robot.state === 'clean' && !this.robot.stayDocked &&
          this.dirt.items.some((d) => d.type === 'sock')) {
        this.actions.triggerByName('sockGrab');
      }
    }

    // ---- the poopocalypse pipeline ----------------------------------------
    // 1. the robot blunders into a fresh pile (it has no idea)
    const r0 = this.robot;
    if (r0.smearT <= 0 && !r0.mopMode && r0.z <= 0 && Math.abs(r0.speed) > 25) {
      for (const d of this.dirt.items) {
        if (d.type !== 'poop' || d.drop > 0) continue;
        if (dist(d.x, d.y, r0.x, r0.y) < r0.radius * 0.85) {
          this.dirt.remove(d);
          this.smears.splat(d.x, d.y);
          r0.smearT = 5.2; // blissfully spreading it for a while
          r0.smearDist = 20;
          r0.fateTarget = null;
          this.sound.splat();
          this.shake(4);
          this.particles.dustPuff(d.x, d.y, 8, 'rgba(150, 110, 70, 0.5)');
          break;
        }
      }
    }
    // 2. the awful realization → forced mop mode (also mops leftovers)
    if (this.pendingMop || (this.smears.count > 0 && !r0.mopMode && r0.smearT <= 0)) {
      const dockStates = ['align', 'empty', 'charge', 'docked'];
      if (!dockStates.includes(r0.state) && this.actions.current?.name !== 'mopMode') {
        this.pendingMop = false;
        this.actions.force('mopMode');
      }
    }
    // 3. fate: a fresh pile quietly bends the robot's cleaning path toward it
    this.fateT = (this.fateT ?? 3) - dt;
    if (this.fateT <= 0) {
      this.fateT = 2.5;
      const pile = this.dirt.items.find((d) => d.type === 'poop' && d.age > 4 && !d.fated);
      if (pile && !this.actions.busy && ['clean', 'seek'].includes(r0.state) &&
          !r0.stayDocked && r0.smearT <= 0) {
        pile.fated = true;
        const a = angleTo(r0.x, r0.y, pile.x, pile.y);
        const fx = pile.x + Math.cos(a) * 150;
        const fy = pile.y + Math.sin(a) * 150;
        r0.fateTarget = this.room.isFree(fx, fy, 60) ? { x: fx, y: fy } : { x: pile.x, y: pile.y };
        r0.state = 'clean';
        r0.seekDirt = null;
        r0.bump = null;
        r0.cleanMode = 'wander';
      }
    }
    // 4. and sometimes the dog just... decides. all on its own.
    this.pottyT = (this.pottyT ?? rand(110, 190)) - dt;
    if (this.pottyT <= 0) {
      this.pottyT = rand(140, 240);
      if (!this.messActive()) this.dog.startPottyRun();
    }

    // stray toys get tidied back into the toybox by the arm too
    this.toyTidyT = (this.toyTidyT ?? 8) - dt;
    if (this.toyTidyT <= 0) {
      this.toyTidyT = 9;
      if (!this.actions.busy && this.robot.state === 'clean' && !this.robot.stayDocked &&
          this.dirt.items.some((d) => (d.type === 'toy_ball' || d.type === 'toy_block') && !d.toss && !d.fading)) {
        this.actions.triggerByName('tidyToy');
      }
    }

    // if nobody is tapping, the world stays alive: occasional surprise events
    this.autoEventT = (this.autoEventT ?? rand(40, 70)) - dt;
    if (this.autoEventT <= 0) {
      this.autoEventT = rand(50, 90);
      const idle = this.time - (this.lastInteraction ?? 0) > 20;
      if (idle && !this.actions.busy && this.robot.state === 'clean') {
        this.actions.triggerByName(pick(['sneeze', 'happyBeeps', 'dogRide', 'bounceParty', 'spinDance', 'tidyToy']));
      }
    }
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - 14 * dt);
    if (this.shakeCouch > 0) this.shakeCouch -= dt;
    if (this.hatTime > 0) this.hatTime -= dt;

    // robot pushes toy balls around
    for (const d of this.dirt.items) {
      if (d.type !== 'toy_ball' && d.type !== 'toy_block') continue;
      const dd = dist(d.x, d.y, this.robot.x, this.robot.y);
      if (dd < this.robot.radius + 24 && Math.abs(this.robot.speed) > 30) {
        const a = Math.atan2(d.y - this.robot.y, d.x - this.robot.x);
        const push = d.type === 'toy_ball' ? 300 : 150;
        d.vx += Math.cos(a) * push * dt * 6;
        d.vy += Math.sin(a) * push * dt * 6;
        if (chance(0.1)) this.sound.pop();
      }
    }

    // star-meter super celebration
    if (this.celebration) {
      const c = this.celebration;
      c.t += dt;
      c.next -= dt;
      if (c.next <= 0 && c.count < 7) {
        c.next = 0.35;
        c.count++;
        const x = rand(300, 1400);
        const y = rand(180, 480);
        this.sound.fireworkBurst();
        this.particles.burst(x, y, 'star', 24, { speedMin: 100, speedMax: 340, lifeMin: 0.6, lifeMax: 1.4, gravity: 150 });
        this.particles.confettiBurst(x, y, 20);
      }
      if (c.t > 3.2) this.celebration = null;
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#241a2e';
    ctx.fillRect(0, 0, w, h);

    const shakeX = this.shakeAmt > 0 ? rand(-this.shakeAmt, this.shakeAmt) : 0;
    const shakeY = this.shakeAmt > 0 ? rand(-this.shakeAmt, this.shakeAmt) : 0;
    ctx.setTransform(
      this.scale * this.dpr, 0, 0, this.scale * this.dpr,
      (this.offX + shakeX) * this.dpr,
      (this.offY + shakeY) * this.dpr
    );

    // world
    this.room.drawBase(ctx, this.assets);
    this.ambience.draw(ctx);
    this.room.drawTV(ctx);
    this.smears.draw(ctx); // floor stains sit under everything that moves
    this.robot.drawTrail(ctx);
    this.dirt.draw(ctx, this.assets);
    this.actions.drawUnder(ctx);

    // y-sorted entities
    const entries = [];
    for (const f of this.room.furniture) {
      entries.push({
        baseline: f.baseline,
        draw: () => {
          if (f.name === 'couch' && this.shakeCouch > 0) {
            ctx.save();
            ctx.translate(rand(-2.5, 2.5), rand(-1.5, 1.5));
            this.room.drawFurniture(ctx, this.assets, f);
            ctx.restore();
          } else {
            this.room.drawFurniture(ctx, this.assets, f);
          }
        },
      });
    }
    entries.push({ baseline: this.dock.baseline, draw: () => this.dock.draw(ctx, this.assets) });
    entries.push({
      baseline: this.robot.y,
      draw: () => {
        this.robot.draw(ctx, this.assets);
        if (this.hatTime > 0) this.drawHat(ctx);
      },
    });
    entries.push({ baseline: this.dog.baseline, draw: () => this.dog.draw(ctx, this.assets) });
    entries.sort((a, b) => a.baseline - b.baseline);
    for (const e of entries) e.draw();

    // dim for disco
    if (this.dim > 0.01) {
      ctx.fillStyle = `rgba(18, 10, 40, ${this.dim})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    this.actions.drawOver(ctx);
    this.particles.draw(ctx);

    // sock riding the finger
    if (this.dragSock) {
      const s = this.dragSock;
      ctx.fillStyle = 'rgba(80, 45, 25, 0.2)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + 34, 22, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(s.x, s.y - 14);
      ctx.rotate(Math.sin(this.time * 6) * 0.12);
      const img = this.assets.getTinted('sock', s.tint);
      if (img) {
        ctx.drawImage(img, -38, -38, 76, 76);
      } else {
        ctx.fillStyle = s.tint;
        ctx.beginPath();
        ctx.ellipse(0, 0, 18, 30, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // cozy vignette
    const vg = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.55, WORLD_W / 2, WORLD_H / 2, WORLD_H * 1.05);
    vg.addColorStop(0, 'rgba(60, 30, 40, 0)');
    vg.addColorStop(1, 'rgba(60, 30, 40, 0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    this.hud.draw(ctx);
  }

  drawHat(ctx) {
    // dust bunny hat after the under-couch adventure!
    const r = this.robot;
    const t = this.time;
    ctx.save();
    ctx.translate(r.x, r.y - r.z - 40);
    ctx.rotate(Math.sin(t * 3) * 0.1);
    ctx.fillStyle = 'rgba(165, 155, 160, 0.95)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + t * 0.4;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 9, Math.sin(a) * 7 - 2, 10, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(190, 180, 185, 1)';
    ctx.beginPath();
    ctx.arc(0, -2, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3a3340';
    ctx.beginPath();
    ctx.arc(-4, -4, 2, 0, TAU);
    ctx.arc(4, -4, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
