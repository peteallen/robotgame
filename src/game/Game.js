// Game: owns the world, update/draw pipeline, y-sorted rendering and input.
import { TAU, clamp, rand, pick, chance, dist, damp, angleTo } from './core/math.js';
import { SoundEngine } from './core/SoundEngine.js';
import { Voice } from './core/Voice.js';
import { Sfx } from './core/Sfx.js';
import { Particles } from './fx/Particles.js';
import { Smears } from './fx/Smears.js';
import { Cutaway } from './fx/Cutaway.js';
import { Splash } from './fx/Splash.js';
import { WORLD_W, WORLD_H, roundRect } from './world/Room.js';
import { House } from './world/House.js';
import { Dock } from './entities/Dock.js';
import { Robot } from './entities/Robot.js';
import { DirtSystem } from './entities/DirtSystem.js';
import { Dog } from './entities/Dog.js';
import { Ambience } from './entities/Ambience.js';
import { MilkBottle } from './entities/MilkBottle.js';
import { Hud } from './ui/Hud.js';
import { ActionRegistry } from './actions/ActionRegistry.js';
import { registerDefaultActions } from './actions/index.js';
import { createMatJamTriggerState, updateMatJamTrigger } from './actions/matJam.js';

const DEFAULT_SOCKS = Object.freeze(['#ff8fa3', '#8fd7ff']);

function validSockList(value) {
  return Array.isArray(value) && value.length <= 16 &&
    value.every((tint) => typeof tint === 'string' && tint.length < 16);
}

export function cleanVictoryReady(game, robot = game.robot) {
  // The final particle can fill the bin, or finish its suction animation on
  // the same update that a full bin asks to go home. That automatic bin trip
  // may yield to the party, including while it is only just starting a doorway
  // trip. A low-battery return never yields: charging is safety-critical, and
  // the still-armed roomDirty flag lets the party begin after charging.
  const finalPickupDockTrip = game.finalVacuumRoomId === robot.roomId &&
    robot.dockReason === 'bin' &&
    (robot.state === 'godock' ||
      (robot.state === 'travel' && robot.roomTravel?.owner === 'state' &&
        robot.roomTravel.reason === 'dock'));
  const readyState = robot.state === 'clean' || robot.state === 'seek' || finalPickupDockTrip;

  return game.roomDirty && !game.actions.busy && readyState && !robot.stayDocked &&
    robot.smearT <= 0 && game.smears.count === 0 && !game.pendingMop &&
    !game.dog.pooping() && game.dirt.items.length === 0;
}

export class Game {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.sound = new SoundEngine();
    this.voice = new Voice(this.sound);
    this.sfx = new Sfx(this.sound);
    // House creates both full-size scenes and keeps `game.room` pointed at the
    // scene the player is viewing. The robot separately owns its physical room.
    this.house = new House(this);
    this.dock = new Dock(this);
    this.robot = new Robot(this);
    this.particles = new Particles(this);
    this.smears = new Smears(this);
    this.milkBottle = new MilkBottle(this);
    this.dirt = new DirtSystem(this);
    this.dog = new Dog(this);
    this.ambience = new Ambience(this);
    this.cutaway = new Cutaway(this);
    this.splash = new Splash(this);
    this.pendingMop = false;
    this.pendingMopRoomId = null;
    // Historical name, now house-wide: any room's DirtSystem.spawn re-arms it.
    this.roomDirty = false;
    this.finalVacuumRoomId = null;

    // cleaning mode the PLAYER chose: 'vac' | 'mop' | 'both'
    this.userMode = this.loadMode();
    this.mopDirt = 0; // pads get dirty while mopping; 1 = needs a wash
    this.hud = new Hud(this);
    this.actions = new ActionRegistry(this);
    registerDefaultActions(this.actions);
    this.matJamTriggerState = createMatJamTriggerState();

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
    // Room collision and initial floor seeding both consult the responsive
    // minimap position, so establish the real viewport transform first.
    this.resize();

    // input state
    this.pointerDown = false;
    this.downPos = null;
    this.downTime = 0;
    this.lastCrumb = null;
    this.dragSpawned = 0;
    this.robotDrag = null; // rescuing a trapped robot by hand
    this.pointerCapture = null; // HUD/doorway presses never become floor drags
    this._interactionRoomId = this.house.activeRoomId;
    this._roomTravelInputLocked = false;

    // socks live in the laundry basket between deliveries — shared across
    // every browser via the dev server's stash (localStorage as fallback)
    this.basketSocks = this.loadSocks();
    this._sockRevision = 0;
    this._sockSaveChain = Promise.resolve();
    this.pendingSockDrag = false;
    this.dragSock = null; // {tint, x, y} while a sock rides the finger
    this.syncSocks(true);
    this._sockPoll = setInterval(() => {
      if (!document.hidden) this.syncSocks(false);
    }, 8000);

    // Both rooms begin with a small, equal cleaning job. Explicit ownership is
    // important because the two scenes deliberately reuse the same coordinates.
    for (const roomId of this.house.roomIds) {
      for (let i = 0; i < 3; i++) this.dirt.spawnRandom(roomId);
    }

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
    this.reconcileMinimapOverlap();
  }

  reconcileMinimapOverlap() {
    if (!this.house) return;
    const relocate = (point, roomId, radius) => {
      const room = this.house.room(roomId);
      if (!room?.isHudFree || room.isHudFree(point.x, point.y, radius)) return false;
      const safe = room.nearestFreePoint(point.x, point.y, radius);
      point.x = safe.x;
      point.y = safe.y;
      return true;
    };

    const robot = this.robot;
    if (robot && !this.house.transition && !robot.isRoomTraveling?.()) {
      relocate(robot, robot.roomId, robot.radius ?? 62);
    }

    for (const item of this.dirt?.items ?? []) {
      const needsPickupAccess = item.vac || item.type === 'sock' ||
        item.type === 'toy_ball' || item.type === 'toy_block';
      const clearance = needsPickupAccess ? (robot?.radius ?? 62) + 8 : 24;
      if (relocate(item, item.roomId, clearance) && item.sucking) {
        item.sucking = false;
        item.suckT = 0;
      }
      if (item.toss) {
        const target = { x: item.toss.toX, y: item.toss.toY };
        if (relocate(target, item.roomId, clearance)) {
          item.toss.toX = target.x;
          item.toss.toY = target.y;
        }
      }
    }

    for (const smear of this.smears?.items ?? []) {
      const radius = smear.puddle ? Math.max(smear.len ?? 0, smear.w ?? 0) / 2 + 4 : 18;
      relocate(smear, smear.roomId, radius);
    }
    this.smears?.reconcileLayout?.();
    this.milkBottle?.syncLayout?.();
    this.dog?.reconcileHudAvoidance?.();
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

  say(name, opts) {
    this.voice.say(name, opts);
  }

  requestRoom(roomId, source = 'manual') {
    if (!this.house.hasRoom(roomId)) return false;
    const startingTravel = roomId !== this.robot.roomId && !this.robot.isRoomTraveling?.();
    const accepted = this.robot.requestRoom?.(roomId, source) ?? false;
    if (!accepted) return false;

    if (startingTravel) {
      // A room request owns navigation from this point on. End any gesture in
      // the old room immediately instead of waiting for the visual midpoint.
      this.cancelPointerInteraction();
      this._roomTravelInputLocked = true;
      if (source === 'map' || source === 'doorway') this.sound.ackBeep();
    }
    return true;
  }

  showRoom(roomId, source = 'manual') {
    if (!this.house.hasRoom(roomId)) return false;
    if (roomId === this.house.activeRoomId) return true;

    // Room controls own only the camera. Any robot journey already under way
    // remains untouched, and the normal cleaning watchdog decides when Robo
    // actually needs to cross the doorway.
    this.cancelPointerInteraction();
    this.house.activate(roomId);
    this._interactionRoomId = roomId;
    if (source === 'map' || source === 'doorway') this.sound.ackBeep();
    return true;
  }

  // One cancellation path is used by room requests, automatic/action travel,
  // and the eventual scene switch. A sock already pulled from the basket goes
  // safely back into the shared stash; a lifted rescue robot is set down in
  // its original room before the pointer state is forgotten.
  cancelPointerInteraction({ returnSock = true } = {}) {
    if (returnSock && this.dragSock) this.addBasketSock(this.dragSock.tint);
    this.dragSock = null;

    const trapped = this.actions?.current;
    if (this.robotDrag?.moved && trapped?.name === 'trapped' &&
        trapped.state?.phase === 'held' && trapped.state.roomId === this.room?.id) {
      trapped.place(this, this.robot.x, this.robot.y);
    }
    this.robotDrag = null;
    this.pointerDown = false;
    this.pointerCapture = null;
    this.pendingSockDrag = false;
    this.downPos = null;
    this.lastCrumb = null;
    this.dragSpawned = 0;
  }

  syncRoomInteractionState() {
    const roomId = this.house.activeRoomId;
    const traveling = !!this.house.transition || !!this.robot.isRoomTraveling?.();
    // A physical-dock press is already a specific, high-priority command. If
    // Theo changes the view before lifting their finger, keep that capture
    // alive so its service and summon still run against the original dock.
    const pendingDockTap = this.pointerDown && this.pointerCapture?.kind === 'dock';
    if (!pendingDockTap && roomId !== this._interactionRoomId) {
      this.cancelPointerInteraction();
    }
    this._interactionRoomId = roomId;
    this._roomTravelInputLocked = traveling;
  }

  // ---- cleaning modes -------------------------------------------------------

  loadMode() {
    try {
      const m = localStorage.getItem('robo_mode');
      if (m === 'vac' || m === 'mop' || m === 'both') return m;
    } catch (e) { /* default */ }
    return 'vac';
  }

  modeNeedsPads() {
    return this.userMode !== 'vac';
  }

  modeHasVac() {
    return this.userMode !== 'mop';
  }

  canWetClean() {
    const robot = this.robot;
    if (!this.modeNeedsPads() || !robot.mopMode) return false;

    // A dock return is a stop command, not another cleaning pass. In
    // particular, battery cancellation happens before this watchdog runs, so
    // installed pads must not keep wiping the floor on the first homeward
    // frame after the active mop action has been released.
    const batteryCritical = typeof robot.isBatteryCritical === 'function'
      ? robot.isBatteryCritical()
      : Number.isFinite(robot.battery) && robot.battery <= 0.16;
    if (batteryCritical || robot.stayDocked) return false;
    if (['godock', 'align', 'empty', 'washpads', 'charge', 'docked'].includes(robot.state)) {
      return false;
    }
    return !(robot.state === 'travel' && robot.roomTravel?.reason === 'dock');
  }

  requestMode(mode) {
    if (mode === this.userMode) {
      this.sound.pop();
      return;
    }
    this.userMode = mode;
    try {
      localStorage.setItem('robo_mode', mode);
    } catch (e) { /* session only */ }
    this.sound.ackBeep();
    this.lastInteraction = this.time;
    // the equipment watchdog notices the mismatch and sends the robot to the
    // dock with the right announcement
  }

  // player just serviced a dock tank
  onDockServiced() {
    this.mopComplained = false;
    this.sound.happyBeeps(3);
    this.particles.sparkle(this.dock.x, this.dock.spriteTop + 40, 8, this.dock.roomId);
  }

  // is a potty disaster anywhere in progress? (pads merely being installed
  // is NOT a disaster — that's just mop mode)
  messActive() {
    return this.pendingMop ||
      this.robot.smearT > 0 ||
      this.smears.count > 0 ||
      this.actions.current?.name === 'mopMode' ||
      this.dog.pooping() ||
      this.dirt.items.some((d) => d.type === 'poop');
  }

  updateMatJam(dt) {
    return updateMatJamTrigger(this, this.matJamTriggerState, dt);
  }

  // ---- the sock stash -------------------------------------------------------

  loadSocks() {
    try {
      const raw = JSON.parse(localStorage.getItem('robo_socks'));
      // Floor and hand-held socks are intentionally session-only. An empty
      // saved basket therefore means a refresh orphaned those socks, so repair
      // it with the friendly starter pair instead of preserving emptiness.
      if (validSockList(raw) && raw.length > 0) return raw.slice(0, 8);
    } catch (e) { /* fresh start */ }
    return [...DEFAULT_SOCKS];
  }

  saveSocks() {
    this._sockRevision = (this._sockRevision ?? 0) + 1;
    const snapshot = JSON.stringify(this.basketSocks);
    try {
      localStorage.setItem('robo_socks', snapshot);
    } catch (e) { /* private mode etc. — the server stash still works */ }
    // Serialize whole-array writes so a rapid pull-and-return cannot let an
    // older request arrive last and overwrite the newer shared state.
    const publish = () => fetch(`${import.meta.env.BASE_URL}api/socks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: snapshot,
    }).catch(() => {});
    this._sockSaveChain = (this._sockSaveChain ?? Promise.resolve()).then(publish, publish);
    return this._sockSaveChain;
  }

  // adopt the server's shared stash so every browser sees the same basket
  async syncSocks(seedIfEmpty) {
    const requestRevision = this._sockRevision ?? 0;
    try {
      // A poll can begin after saveSocks increments the revision but before
      // its serialized POST reaches the server. Wait for every write that was
      // already queued when this sync began so the GET cannot read and adopt
      // the older shared stash. A later local mutation changes the revision
      // and is still rejected by the checks on either side of the GET.
      const queuedSaves = this._sockSaveChain ?? Promise.resolve();
      await queuedSaves;
      if (requestRevision !== (this._sockRevision ?? 0)) return;

      const res = await fetch(`${import.meta.env.BASE_URL}api/socks`, { cache: 'no-store' });
      if (!res.ok) return;
      const socks = await res.json();
      // A local pull, return, or robot delivery that happened while this GET
      // was in flight is newer than the response and must win.
      if (requestRevision !== (this._sockRevision ?? 0)) return;

      if (validSockList(socks) && (!seedIfEmpty || socks.length > 0)) {
        // don't yank a sock out from under an active finger
        if (!this.dragSock && !this.pendingSockDrag) {
          this.basketSocks = socks.slice(0, 8);
          try {
            localStorage.setItem('robo_socks', JSON.stringify(this.basketSocks));
          } catch (e) { /* ok */ }
        }
      } else if (seedIfEmpty) {
        // A missing, malformed, or empty startup stash cannot describe floor
        // socks because the floor itself is not persisted. Restore and publish
        // the starter pair so this browser and the next refresh both recover.
        if (!this.basketSocks.length) this.basketSocks = [...DEFAULT_SOCKS];
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

  roomFurniture(name, room = this.room) {
    return room?.getFurniture?.(name) ??
      room?.furniture?.find((item) => item.name === name) ?? null;
  }

  basketEffectPoint(room = this.room) {
    const basket = this.roomFurniture('basket', room);
    if (!basket) return null;
    return {
      x: basket.cx,
      y: basket.cy - basket.h * 0.22,
    };
  }

  basketHit(x, y) {
    const b = this.roomFurniture('basket');
    if (!b) return false;
    return x > b.cx - b.w / 2 - 12 && x < b.cx + b.w / 2 + 12 &&
      y > b.cy - b.h / 2 - 30 && y < b.cy + b.h / 2 + 16;
  }

  // a sock hops out of the basket onto the floor
  popSockOut() {
    const basket = this.roomFurniture('basket');
    if (!basket) {
      this.sound.squeak();
      return;
    }
    const tint = this.takeBasketSock();
    if (!tint) {
      this.sound.squeak();
      return;
    }
    const room = this.room;
    const roomId = room.id;
    const center = (room.bounds.minX + room.bounds.maxX) / 2;
    const inward = basket.cx > center ? -1 : 1;
    let spot = null;
    for (let i = 0; i < 24; i++) {
      const x = basket.cx + inward * rand(basket.w * 0.7, basket.w * 1.75);
      const y = basket.cy + basket.h * 0.62 + rand(-10, basket.h * 0.75);
      if (room.isFree(x, y, 45)) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) spot = room.randomFloorPoint(50);
    this.dirt.spawn('sock', spot.x, spot.y, { tint, drop: rand(110, 160), roomId });
    this.sound.boing();
    const effect = this.basketEffectPoint(room);
    if (effect) this.particles.sparkle(effect.x, effect.y, 4, roomId);
  }

  onPickup(d) {
    this.stats.pickups++;
    // DirtSystem removes the swallowed particle before calling this hook. If
    // that made the entire house clean apart from a possibly-running action,
    // remember where it happened. This also lets a vacuuming stunt finish
    // before its eventual bin/battery dock request yields to the party.
    if (this.dirt.items.length === 0 && this.robot.smearT <= 0 &&
        this.smears.count === 0 && !this.pendingMop && !this.dog.pooping()) {
      this.finalVacuumRoomId = d.roomId ?? this.robot.roomId;
    }
  }

  celebrate() {
    this.celebration = {
      t: 0,
      next: 0,
      count: 0,
      roomId: this.robot.roomId,
    };
    this.sound.fanfare();
  }

  // ---- input --------------------------------------------------------------

  onPointerCancel() {
    this.cancelPointerInteraction();
  }

  onPointerDown(cx, cy) {
    if (this.splash.active) {
      this.splash.dismiss();
      return;
    }
    this.sound.unlock();
    this.lastInteraction = this.time;
    const p = this.screenToWorld(cx, cy);

    // Capture overlays and doorway runways on press, not release. That keeps a
    // finger which starts on the minimap or doorway from ever becoming a trail
    // of crumbs when it moves a little before lifting.
    if (this.hud.hitTest(p.x, p.y)) {
      this.pointerDown = true;
      this.pointerCapture = { kind: 'hud' };
      this.downPos = p;
      this.downTime = this.time;
      this.lastCrumb = null;
      this.pendingSockDrag = false;
      return;
    }
    const sleepingRobotHit = this.robot.stayDocked &&
      this.robot.roomId === this.house.activeRoomId &&
      dist(p.x, p.y, this.robot.x, this.robot.y - this.robot.z) < this.robot.radius + 34;
    if (!sleepingRobotHit && this.dock &&
        this.dock.roomId === this.house.activeRoomId &&
        this.dock.contains?.(p.x, p.y)) {
      this.pointerDown = true;
      this.pointerCapture = {
        kind: 'dock',
        roomId: this.dock.roomId,
        x: p.x,
        y: p.y,
      };
      this.downPos = p;
      this.downTime = this.time;
      this.lastCrumb = null;
      this.pendingSockDrag = false;
      return;
    }
    // a trapped robot can be grabbed: press it, drag it somewhere safe
    // Its visible body is a more specific target than a doorway's deliberately
    // generous runway, so rescue wins when the two hit areas overlap. The HUD
    // remains first so the minimap and other controls keep their normal input.
    const act = this.actions.current;
    if (this.robot.roomId === this.house.activeRoomId &&
        act?.name === 'trapped' && act.grabbable() &&
        dist(p.x, p.y, this.robot.x, this.robot.y - this.robot.z) < this.robot.radius + 46) {
      this.robotDrag = { moved: false };
      this.pointerDown = true;
      this.downPos = p;
      this.lastCrumb = null;
      this.pointerCapture = null;
      this.pendingSockDrag = false;
      return;
    }
    const doorway = this.room.tapDoorway?.(p.x, p.y);
    if (doorway) {
      this.pointerDown = true;
      this.pointerCapture = { kind: 'doorway', targetRoomId: doorway.targetRoomId };
      this.downPos = p;
      this.downTime = this.time;
      this.lastCrumb = null;
      this.pendingSockDrag = false;
      return;
    }
    if (this.milkBottle?.contains?.(p.x, p.y, this.house.activeRoomId)) {
      this.pointerDown = true;
      this.pointerCapture = { kind: 'milkBottle' };
      this.downPos = p;
      this.downTime = this.time;
      this.lastCrumb = null;
      this.pendingSockDrag = false;
      return;
    }
    this.pointerDown = true;
    this.pointerCapture = null;
    this.downPos = p;
    this.downTime = this.time;
    this.lastCrumb = p;
    this.dragSpawned = 0;
    // starting on the basket with socks inside? might become a sock drag
    this.pendingSockDrag = this.basketHit(p.x, p.y) && this.basketSocks.length > 0;
  }

  onPointerMove(cx, cy) {
    if (this.splash.active) return;
    if (this.pointerCapture) return;
    // the trapped robot rides the finger to safety
    if (this.robotDrag && this.pointerDown) {
      const act = this.actions.current;
      if (act?.name !== 'trapped') {
        this.robotDrag = null;
        return;
      }
      const p = this.screenToWorld(cx, cy);
      if (!this.robotDrag.moved && this.downPos &&
          dist(p.x, p.y, this.downPos.x, this.downPos.y) > 14) {
        this.robotDrag.moved = true;
        act.grab(this);
      }
      if (this.robotDrag.moved) {
        const b = this.room.bounds;
        this.robot.x = clamp(p.x, b.minX, b.maxX);
        this.robot.y = clamp(p.y, b.minY, b.maxY);
      }
      return;
    }
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
        this.dragSock = { tint, x: p.x, y: p.y, roomId: this.room.id };
        this.sound.pop();
        this.particles.sparkle(p.x, p.y, 3, this.room.id);
      }
      this.pendingSockDrag = false;
      return;
    }
    if (this.pendingSockDrag) return;
    // finger-drag sprinkles a crumb trail for the robot to chase
    if (dist(p.x, p.y, this.lastCrumb.x, this.lastCrumb.y) > 80 && this.dragSpawned < 14) {
      const b = this.room.bounds;
      if (p.x > b.minX - 20 && p.x < b.maxX + 20 && p.y > b.minY - 10 && p.y < b.maxY + 30 && this.room.isFree(p.x, p.y, 20)) {
        this.dirt.playerCrumb(p.x, p.y, this.room.id);
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
    if (this.splash.active) return;
    if (!this.pointerDown) return;
    this.pointerDown = false;
    const p = this.screenToWorld(cx, cy);

    if (this.pointerCapture) {
      const capture = this.pointerCapture;
      const dragLimit = capture.kind === 'milkBottle' ? 48 : 30;
      const wasDrag = this.downPos && dist(p.x, p.y, this.downPos.x, this.downPos.y) > dragLimit;
      const held = this.time - this.downTime;
      const holdLimit = capture.kind === 'milkBottle' ? 0.85 : 0.6;
      this.pointerCapture = null;
      this.downPos = null;
      this.lastCrumb = null;
      if (!wasDrag && held < holdLimit) {
        if (capture.kind === 'hud') this.hud.onTap(p.x, p.y);
        else if (capture.kind === 'doorway') this.showRoom(capture.targetRoomId, 'doorway');
        else if (capture.kind === 'milkBottle') this.milkBottle.poke();
        else if (capture.kind === 'dock') {
          this.tapDock(capture.x, capture.y, capture.roomId);
        }
      }
      return;
    }
    // set the rescued robot down — or, if it was just a tap, poke it
    if (this.robotDrag) {
      const drag = this.robotDrag;
      this.robotDrag = null;
      const act = this.actions.current;
      if (act?.name === 'trapped') {
        if (drag.moved) act.place(this, p.x, p.y);
        else act.poke(this);
      }
      this.downPos = null;
      return;
    }
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
      const effect = this.basketEffectPoint();
      if (effect) this.particles.sparkle(effect.x, effect.y, 4, this.room.id);
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
    this.dirt.spawn('sock', spot.x, spot.y, { tint: sock.tint, drop: 26, roomId: this.room.id });
    this.sound.pop();
    this.particles.dustPuff(spot.x, spot.y, 3, 'rgba(255, 230, 180, 0.5)', this.room.id);
  }

  floorPointNear(furniture, minRadius, maxRadius, objectRadius = 36) {
    const room = this.room;
    const b = room.bounds;
    for (let i = 0; i < 36; i++) {
      const a = rand(0, TAU);
      const radius = rand(minRadius, maxRadius);
      const x = furniture.cx + Math.cos(a) * radius;
      const y = furniture.cy + Math.sin(a) * radius;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (room.isFree(x, y, objectRadius, { solidTable: true })) return { x, y };
    }
    return room.randomFloorPoint(objectRadius);
  }

  tapKitchenFurniture(hit) {
    if (this.room.id !== 'kitchen' || !hit) return false;
    const room = this.room;
    const furniture = this.roomFurniture(hit, room);
    if (!furniture) return false;
    const roomId = room.id;
    room.activateFurniture?.(hit);

    if (hit === 'island') {
      // The cereal bowl is painted on the left side of the island. Pieces arc
      // out from that authored location and land only on reachable floor.
      const source = {
        x: furniture.cx - furniture.w * 0.15,
        y: furniture.cy - furniture.h * 0.31,
      };
      for (let i = 0; i < 5; i++) {
        const target = this.floorPointNear(
          furniture,
          furniture.w * 0.48,
          furniture.w * 0.92,
          (this.robot.radius ?? 62) + 8,
        );
        const cereal = this.dirt.spawn('cereal', source.x + rand(-22, 22), source.y + rand(-8, 8), {
          playerMade: true,
          roomId,
          scale: rand(0.7, 1),
        });
        this.dirt.toss(cereal, target.x, target.y);
      }
      this.sound.whoosh();
      this.sound.boing();
      this.particles.sparkle(source.x, source.y, 7, roomId);
    } else if (hit === 'trash') {
      // A bin tap makes a visible, player-caused spill. Most taps shake loose
      // crumbs; occasionally one shy dust bunny tumbles out instead.
      const kind = chance(0.3) ? 'dustbunny' : 'crumbs';
      const count = kind === 'dustbunny' ? 1 : 3;
      const source = {
        x: furniture.cx - furniture.w * 0.22,
        y: furniture.cy - furniture.h * 0.22,
      };
      for (let i = 0; i < count; i++) {
        const target = this.floorPointNear(
          furniture,
          furniture.w * 0.75,
          furniture.w * 1.75,
          (this.robot.radius ?? 62) + 8,
        );
        const item = this.dirt.spawn(kind, source.x + rand(-12, 12), source.y, {
          playerMade: true,
          roomId,
          scale: rand(0.75, 1.05),
        });
        this.dirt.toss(item, target.x, target.y);
      }
      this.sound.pop();
      this.sound.whoosh();
      this.particles.dustPuff(source.x, source.y, 6, 'rgba(170, 150, 125, 0.5)', roomId);
    } else if (hit === 'fridge') {
      // The milk now comes from the visible bottle on the island. The fridge
      // keeps its friendly wobble/light response without creating a surprise
      // floor mess from an object the player cannot see.
      this.sound.pop();
      this.particles.sparkle(furniture.cx - furniture.w * 0.28, furniture.cy, 4, roomId);
    } else if (hit === 'sink') {
      this.sound.glug();
      for (let i = 0; i < 9; i++) {
        this.particles.add({
          x: furniture.cx + rand(-95, 95),
          y: furniture.cy + rand(-28, 18),
          roomId,
          kind: 'bubble',
          size: rand(5, 12),
          life: rand(0.7, 1.4),
          vx: rand(-22, 22),
          vy: rand(-95, -42),
        });
      }
    } else {
      // Cabinet doors give a soft bounce without adding unexplained debris.
      this.sound.pop();
      this.particles.sparkle(furniture.cx, furniture.cy - furniture.h * 0.25, 4, roomId);
    }

    const nearest = this.dirt.nearestVac(this.robot.x, this.robot.y, true, roomId);
    if (nearest) this.robot.notifyNewDirt(nearest);
    return true;
  }

  tapDock(x, y, roomId = this.house.activeRoomId) {
    if (!this.dock || this.dock.roomId !== roomId ||
        !this.dock.contains?.(x, y)) {
      return false;
    }

    const zone = this.dock.tapZone(x, y);
    if (zone && this.dock.service(zone)) {
      this.say('thank_you', { force: true });
      this.onDockServiced();
    } else if (zone) {
      this.sound.pop();
      this.particles.sparkle(x, y, 3, this.dock.roomId);
    }

    // Every part of the physical dock is also an immediate return command.
    // Action cleanup safely puts down anything in the robotic arm first.
    this.dock.beacon = 1.2;
    this.robot.summon();
    return true;
  }

  tap(x, y) {
    const r = this.robot;
    // 1. HUD buttons
    if (this.hud.onTap(x, y)) return;
    // 2. A robot deliberately sleeping on the dock retains its one-tap wake
    // control. Other action-specific robot taps get their own first chance
    // below, before the ordinary surprise-action trigger.
    if (r.stayDocked && r.roomId === this.house.activeRoomId &&
        dist(x, y, r.x, r.y - r.z) < r.radius + 34) {
      this.tapRobot();
      return;
    }
    // 3. The dock is a high-priority stop-and-return control, even during an
    // action or doorway crossing.
    if (this.tapDock(x, y)) return;
    // 4. paired doorway — this sits ahead of every room object and floor tap
    const doorway = this.room.tapDoorway?.(x, y);
    if (doorway) {
      this.showRoom(doorway.targetRoomId, 'doorway');
      return;
    }
    // 5. A running action consumes its own targets first. This includes taps
    // on the robot itself, such as helping it out of a kitchen-mat jam.
    if (r.roomId === this.house.activeRoomId && this.actions.onTap(x, y)) return;
    // 6. the ordinary robot tap starts a surprise or gives a busy reaction.
    if (r.roomId === this.house.activeRoomId &&
        dist(x, y, r.x, r.y - r.z) < r.radius + 34) {
      this.tapRobot();
      return;
    }
    // 7. the dog
    if (this.dog.roomId === this.house.activeRoomId && this.dog.contains(x, y)) {
      this.dog.onTap();
      return;
    }
    // 8. toys bounce when tapped
    const toy = this.dirt.tapToy(x, y);
    if (toy) {
      toy.vx = rand(-220, 220);
      toy.vy = rand(-220, 220);
      this.sound.squeak();
      this.particles.sparkle(toy.x, toy.y - 20, 4, toy.roomId);
      return;
    }
    if (this.milkBottle?.contains?.(x, y, this.house.activeRoomId)) {
      this.milkBottle.poke();
      return;
    }
    // 9. furniture & wall objects
    const hit = this.room.tapFurniture(x, y);
    if (this.tapKitchenFurniture(hit)) return;
    if (hit === 'tv') {
      this.room.tv.on = this.room.tv.on > 0 ? 0 : 12;
      this.sound.ackBeep();
      if (this.room.tv.on > 0) this.sound.happyBeeps(4);
      return;
    }
    if (hit === 'plant') {
      const plant = this.roomFurniture('plant');
      if (!plant) return;
      this.room.plantSway = 1;
      this.sound.whoosh();
      // leaves tumble down for the robot to eat — the pot's own footprint is
      // solid, so derive clear landing points from the plant's current layout.
      const center = (this.room.bounds.minX + this.room.bounds.maxX) / 2;
      const inward = plant.cx > center ? -1 : 1;
      const floorY = plant.foot ? plant.foot.y + plant.foot.h : plant.cy + plant.h / 2;
      const clearance = (r.radius ?? 62) + 8;
      let dropped = 0;
      for (let i = 0; i < 24 && dropped < 2; i++) {
        const lx = plant.cx + inward * rand(plant.w * 0.4, plant.w * 1.05);
        const ly = floorY + rand(-35, 55);
        if (this.room.isFree(lx, ly, clearance)) {
          this.dirt.spawn('leaf', lx, ly, { drop: rand(120, 200), roomId: this.room.id });
          dropped++;
        }
      }
      const d = this.dirt.nearestVac(r.x, r.y, false, this.room.id);
      if (d && chance(0.6)) r.notifyNewDirt(d);
      return;
    }
    if (hit === 'toybox') {
      const toybox = this.roomFurniture('toybox');
      if (!toybox) return;
      // a toy LAUNCHES clear across the room!
      const kind = pick(['toy_ball', 'toy_block']);
      const source = {
        x: toybox.cx,
        y: toybox.cy - toybox.h * 0.22,
      };
      let spot = null;
      for (let i = 0; i < 30; i++) {
        const p = this.room.randomFloorPoint((r.radius ?? 62) + 8);
        if (dist(p.x, p.y, source.x, source.y) > Math.max(320, toybox.w * 1.4) &&
            this.room.isFree(p.x, p.y, (r.radius ?? 62) + 8, { solidTable: true })) {
          spot = p;
          break;
        }
      }
      if (!spot) spot = this.room.randomFloorPoint((r.radius ?? 62) + 8);
      const t = this.dirt.spawn(kind, source.x, source.y, { roomId: this.room.id });
      t.scale = 0.25; // grows as it pops out
      this.dirt.toss(t, spot.x, spot.y);
      this.sound.pop();
      this.sound.whoosh();
      this.particles.sparkle(source.x, source.y, 6, this.room.id);
      return;
    }
    if (hit === 'couch') {
      const couch = this.roomFurniture('couch');
      if (!couch) return;
      this.shakeCouch = 0.4;
      this.sound.squeak();
      if (chance(0.35)) {
        // a shy dust bunny scoots out from under the couch
        const frontY = couch.foot?.y ?? couch.cy - couch.h * 0.3;
        const rawX = couch.cx + rand(-couch.w * 0.27, couch.w * 0.27);
        const rawY = frontY - 30;
        const point = this.room.nearestFreePoint(
          rawX,
          rawY,
          (r.radius ?? 62) + 8,
        );
        const d = this.dirt.spawn('dustbunny', point.x, point.y, {
          roomId: this.room.id,
        });
        d.vy = 60;
        this.particles.dustPuff(d.x, frontY - 20, 4, undefined, this.room.id);
      }
      return;
    }
    if (hit === 'catbed') {
      const bed = this.roomFurniture('catbed');
      if (bed && this.dog.roomId === this.room.id &&
          dist(this.dog.x, this.dog.y, bed.cx, bed.cy) < 120) {
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
    // 10. tap the floor: sprinkle a mess for Robo to clean!
    const b = this.room.bounds;
    if (x > b.minX - 40 && x < b.maxX + 40 && y > b.minY - 30 && y < b.maxY + 40) {
      this.dirt.playerSprinkle(x, y, this.room.id);
      this.sound.pop();
      this.particles.dustPuff(x, y, 3, 'rgba(255, 230, 180, 0.5)', this.room.id);
      const d = this.dirt.nearestVac(r.x, r.y, true, this.room.id);
      if (d) r.notifyNewDirt(d);
    } else {
      // wall tap — just sparkle
      this.particles.sparkle(x, y, 4, this.room.id);
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
    if (this.actions.busy || busyDocking || r.state === 'godock' || r.isRoomTraveling?.()) {
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

    // title screen holds the world still until the start tap; during the
    // dismiss fade the room comes alive underneath
    this.splash.update(dt);
    if (this.splash.active && !this.splash.fading) return;
    this.room.update(dt);
    // Actor simulation is room-owned, not camera-owned. Switching the view
    // must not pause a dock service animation or a dog already crossing the
    // floor in the other room.
    this.dock.update(dt);
    this.robot.update(dt);
    this.syncRoomInteractionState();
    // The kitchen mat clock observes the robot's resolved movement, then only
    // starts a jam on a genuine outside-to-inside crossing.
    this.updateMatJam(dt);
    this.ambience.update(dt);
    this.dirt.update(dt);
    this.dog.update(dt);
    // The bottle and floor field advance before actions inspect wet work. This
    // prevents MopMode from finishing in a transient gap between poured drops.
    this.milkBottle.update(dt);
    this.smears.update(dt);
    this.actions.update(dt);
    // Controlled actions advance their own room travel after Robot.update().
    this.syncRoomInteractionState();
    this.particles.update(dt);
    this.cutaway.update(dt);
    this.hud.update(dt);
    this.dim = damp(this.dim, this.dimTarget, 4, dt);

    // socks left on the floor get fetched by the arm before long
    this.sockFetchT = (this.sockFetchT ?? 6) - dt;
    if (this.sockFetchT <= 0) {
      this.sockFetchT = 7;
      if (!this.actions.busy && this.robot.state === 'clean' && !this.robot.stayDocked &&
          !this.robot.isRoomTraveling?.() &&
          this.dirt.items.some((d) => d.roomId === this.robot.roomId && d.type === 'sock')) {
        this.actions.triggerByName('sockGrab');
      }
    }

    // ---- the wet-mess pipeline --------------------------------------------
    // 1. the robot blunders into a fresh pile (it has no idea — and mop pads
    // are NO protection: it completes the full initial smear in every mode,
    // then only an already-equipped mop mode cleans what is left behind)
    const r0 = this.robot;
    if (r0.smearT <= 0 && r0.z <= 0 && Math.abs(r0.speed) > 25) {
      for (const d of this.dirt.items) {
        if (d.roomId !== r0.roomId || d.type !== 'poop' || d.drop > 0) continue;
        if (dist(d.x, d.y, r0.x, r0.y) < r0.radius * 0.85) {
          this.dirt.remove(d);
          this.smears.splat(d.x, d.y, { roomId: d.roomId });
          r0.beginWetTracking('poop', d.roomId, { duration: 5.2 });
          r0.fateTarget = null;
          this.sound.splat();
          this.shake(4);
          this.particles.dustPuff(d.x, d.y, 8, 'rgba(150, 110, 70, 0.5)', d.roomId);
          break;
        }
      }
    }

    // Vacuum-only wheels pick up existing wet mess on contact and drag it
    // through the room. A finite burst plus cooldown makes repeated crossings
    // progressively worse without allowing the new tail to retrigger forever.
    if (!this.modeNeedsPads() && r0.smearT <= 0 && r0.wetTrackCooldown <= 0 &&
        r0.z <= 0 && Math.abs(r0.speed) > 25) {
      const contact = this.smears.wetContactAt(
        r0.x,
        r0.y,
        r0.radius * 0.45,
        r0.roomId,
      );
      if (contact && r0.beginWetTracking(contact.kind, contact.roomId, {
        fieldId: contact.fieldId ?? null,
      })) {
        this.sound.splat();
        r0.setExpr('dizzy', 1.2);
      }
    }

    // 2. Wet work follows the selected mode. Installed pads in mop or
    // vacuum+mop clean in place; vacuum-only leaves the mess alone and never
    // turns the incident into an unsolicited equipment trip.
    const directPuddle = this.smears.findPuddle?.();
    const needsWetCleanup = !!directPuddle && r0.smearT <= 0;
    const readyWetWork = this.smears.hasReadyForMop?.() ?? this.smears.count > 0;
    if (r0.smearT <= 0 &&
        (this.pendingMop || needsWetCleanup || readyWetWork) && this.canWetClean()) {
      if (!this.pendingMopRoomId && (this.pendingMop || directPuddle)) {
        this.pendingMopRoomId = directPuddle?.roomId ?? r0.roomId;
      }
      const dockStates = ['align', 'empty', 'washpads', 'charge', 'docked'];
      // A trapped robot or a dog still making the puddle cannot start cleanup;
      // the persistent floor mark keeps the request alive for a later retry.
      if (!this.dog.pooping() && !dockStates.includes(r0.state) &&
          this.actions.current?.name !== 'mopMode' &&
          !this.actions.current?.blocksWetCleanup && !r0.isRoomTraveling?.()) {
        if (this.actions.force('mopMode')) {
          // MopMode.start reads the incident room synchronously.
          this.pendingMop = false;
          this.pendingMopRoomId = null;
        }
      }
    }
    // ambient mopping: pads wipe whatever they pass over (not while the robot
    // is busy spreading a fresh disaster) + pads get dirty + wet trail
    if (this.canWetClean()) {
      if (Math.abs(r0.speed) > 25) {
        this.mopDirt = clamp(this.mopDirt + dt / 55, 0, 1);
        if (!r0.trailMode) r0.trailMode = 'mop';
      }
      if (r0.smearT <= 0) {
        const wiped = this.smears.wipeAt(r0.x, r0.y, 64, r0.roomId);
        if (wiped > 0) {
          this.mopDirt = clamp(this.mopDirt + wiped * 0.02, 0, 1);
          this.squeegeeT = (this.squeegeeT ?? 0) - dt;
          if (this.squeegeeT <= 0) {
            this.squeegeeT = 0.28;
            this.sound.squeegee();
          }
          for (let i = 0; i < Math.min(wiped, 3); i++) {
            this.particles.add({
              x: r0.x + rand(-30, 30), y: r0.y + rand(0, 34),
              kind: 'bubble', size: rand(5, 10), life: rand(0.4, 0.8),
              vy: rand(-40, -12), vx: rand(-16, 16),
              roomId: r0.roomId,
            });
          }
        }
        // (no pile shortcut here: a fresh pile always goes through the smear
        // collision above first — pads only help with the wiping after)
      }
    } else if (r0.trailMode === 'mop') {
      r0.trailMode = null;
    }

    // the LAST speck, sock and toy is gone → throw the all-clean victory party!
    if (cleanVictoryReady(this, r0) && this.actions.force('winParty')) {
      this.roomDirty = false;
      this.finalVacuumRoomId = null;
    }

    // An explicit player mode change outranks incident handling and may swap
    // equipment even while wet work exists. Automatic pad washing still waits
    // until the floor is clean, avoiding a mid-puddle service detour.
    const serviceReady = !this.actions.busy && ['clean', 'seek'].includes(r0.state) &&
      !r0.stayDocked && !r0.isRoomTraveling?.() && r0.smearT <= 0;
    if (serviceReady && r0.mopMode !== this.modeNeedsPads()) {
      this.actions.force('modeSwitch');
    } else if (serviceReady && this.smears.count === 0 && !this.pendingMop &&
        r0.mopMode && this.mopDirt >= 1 &&
        (this.dock.canMop() || !this.mopComplained)) {
      this.actions.force('washTrip');
    }

    // gentle reminder while anything on the dock needs a human
    if (this.dock.anyAlert()) {
      this.alertRemindT = (this.alertRemindT ?? 20) - dt;
      if (this.alertRemindT <= 0) {
        this.alertRemindT = 34;
        this.dock.beacon = 1.2;
        if (this.dock.needsBag()) this.say('bag_full');
        else if (this.dock.needsClean()) this.say('clean_empty');
        else if (this.dock.needsDirty()) this.say('dirty_full');
      }
    } else {
      this.alertRemindT = 20;
    }
    // 3. fate: a fresh pile quietly bends the robot's cleaning path toward it
    this.fateT = (this.fateT ?? 3) - dt;
    if (this.fateT <= 0) {
      this.fateT = 2.5;
      const pile = this.dirt.items.find((d) =>
        d.roomId === r0.roomId && d.type === 'poop' && d.age > 4 && !d.fated
      );
      if (pile && !r0.fateTarget && !this.actions.busy && ['clean', 'seek'].includes(r0.state) &&
          !r0.stayDocked && r0.smearT <= 0) {
        pile.fated = true;
        const a = angleTo(r0.x, r0.y, pile.x, pile.y);
        const fx = pile.x + Math.cos(a) * 150;
        const fy = pile.y + Math.sin(a) * 150;
        const robotRoom = this.house?.room?.(r0.roomId) ?? this.room;
        r0.fateTarget = robotRoom.isFree(fx, fy, 60)
          ? { x: fx, y: fy, roomId: pile.roomId, pile }
          : { x: pile.x, y: pile.y, roomId: pile.roomId, pile };
        r0.state = 'clean';
        r0.seekDirt = null;
        r0.bump = null;
        r0.cleanMode = 'wander';
      }
    }
    // (the dog only poops when poked now — no debris appears on its own, so a
    // clean room STAYS clean and the win party means something)

    // stray toys get tidied back into the toybox by the arm too
    this.toyTidyT = (this.toyTidyT ?? 8) - dt;
    if (this.toyTidyT <= 0) {
      this.toyTidyT = 9;
      if (!this.actions.busy && this.robot.state === 'clean' && !this.robot.stayDocked &&
          !this.robot.isRoomTraveling?.() &&
          this.dirt.items.some((d) => d.roomId === this.robot.roomId &&
            (d.type === 'toy_ball' || d.type === 'toy_block') && !d.toss && !d.fading)) {
        this.actions.triggerByName('tidyToy');
      }
    }

    // zoomies: every so often the pup decides the robot MUST be chased
    this.dogChaseT = (this.dogChaseT ?? rand(70, 130)) - dt;
    if (this.dogChaseT <= 0) {
      this.dogChaseT = rand(110, 200);
      if (!this.actions.busy && !this.messActive() && !r0.stayDocked &&
          !r0.isRoomTraveling?.() && this.dog.roomId === r0.roomId &&
          ['clean', 'seek'].includes(r0.state)) {
        this.dog.startChase();
      }
    }

    // every so often the robot wedges itself under something and needs rescuing
    this.trapT = (this.trapT ?? rand(50, 90)) - dt;
    if (this.trapT <= 0) {
      this.trapT = rand(130, 220);
      const robotRoom = this.house?.room?.(r0.roomId) ?? this.room;
      if (!this.actions.busy && r0.state === 'clean' && !r0.stayDocked &&
          !r0.isRoomTraveling?.() && !this.messActive() && !this.dock.anyAlert() &&
          this.dog.state !== 'ride' &&
          r0.battery > 0.3 && r0.bin < 0.9 &&
          r0.mopMode === this.modeNeedsPads() && !(r0.mopMode && this.mopDirt >= 1) &&
          (this.roomFurniture('couch', robotRoom) ||
            this.roomFurniture('table', robotRoom))) {
        this.actions.force('trapped');
      }
    }

    // if nobody is tapping, the world stays alive: occasional surprise events
    // (no 'sneeze' here — it scatters crumbs, and debris never appears on its own)
    this.autoEventT = (this.autoEventT ?? rand(40, 70)) - dt;
    if (this.autoEventT <= 0) {
      this.autoEventT = rand(50, 90);
      const idle = this.time - (this.lastInteraction ?? 0) > 20;
      if (idle && !this.actions.busy && this.robot.state === 'clean' &&
          !this.robot.isRoomTraveling?.()) {
        this.actions.triggerByName(pick(['happyBeeps', 'dogRide', 'bounceParty', 'spinDance', 'tidyToy']));
      }
    }
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - 14 * dt);
    if (this.shakeCouch > 0) this.shakeCouch -= dt;
    if (this.hatTime > 0) this.hatTime -= dt;

    // robot pushes toy balls around
    for (const d of this.dirt.items) {
      if (d.roomId !== this.robot.roomId ||
          (d.type !== 'toy_ball' && d.type !== 'toy_block')) continue;
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
        this.particles.burst(x, y, 'star', 24, {
          speedMin: 100, speedMax: 340, lifeMin: 0.6, lifeMax: 1.4,
          gravity: 150, roomId: c.roomId,
        });
        this.particles.confettiBurst(x, y, 20, c.roomId);
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

    // House draws exactly the room Theo selected. Doorway crossing changes the
    // robot's physical pose without taking control of this camera choice.
    this.house.drawTransition(ctx, (room, roomCtx) => this.drawRoomScene(roomCtx, room));

    // cozy vignette
    const vg = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.55, WORLD_W / 2, WORLD_H / 2, WORLD_H * 1.05);
    vg.addColorStop(0, 'rgba(60, 30, 40, 0)');
    vg.addColorStop(1, 'rgba(60, 30, 40, 0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    this.hud.draw(ctx);

    // title screen on top of everything
    this.splash.draw(ctx);
  }

  drawRoomScene(ctx, room) {
    room.drawBase(ctx, this.assets);
    // A controlled action can cross at the end of update(), after Ambience's
    // normal tick. Resync here as well so the first kitchen frame never shows
    // the living-room sunbeam (or vice versa).
    this.ambience.syncRoom?.();
    this.ambience.draw(ctx);
    room.drawTV?.(ctx);
    this.smears.draw(ctx); // floor stains sit under everything that moves
    this.robot.drawTrail(ctx);
    this.dirt.draw(ctx, this.assets);

    const transitionPose = this.house.transition?.robot
      ? this.house.transitionPose()
      : null;
    const robotVisible = this.robot.roomId === room.id && (!transitionPose || transitionPose.visible);
    if (robotVisible) this.actions.drawUnder(ctx);

    // Furniture and actors share one baseline sort, preserving the original
    // room's convincing "in front of / behind" behavior in the kitchen too.
    const entries = [];
    for (const furniture of room.furniture) {
      entries.push({
        baseline: furniture.baseline,
        draw: () => {
          const shaking = furniture.name === 'couch' && this.shakeCouch > 0;
          ctx.save();
          if (shaking) ctx.translate(rand(-2.5, 2.5), rand(-1.5, 1.5));
          if (room.id === 'kitchen' && furniture.name === 'fridge') {
            this.drawFridgeLight(ctx, room, furniture);
          }
          room.drawFurniture(ctx, this.assets, furniture);
          ctx.restore();
        },
      });
    }
    if (this.milkBottle?.roomId === room.id) {
      entries.push({
        baseline: this.milkBottle.baseline(room),
        draw: () => this.milkBottle.draw(ctx),
      });
    }
    if (this.dock.roomId === room.id) {
      entries.push({ baseline: this.dock.baseline, draw: () => this.dock.draw(ctx, this.assets) });
    }
    if (robotVisible) {
      entries.push({
        baseline: this.robot.y,
        draw: () => {
          this.robot.draw(ctx, this.assets);
          if (this.hatTime > 0) this.drawHat(ctx);
        },
      });
    }
    const dogVisible = this.dog.roomId === room.id &&
      (this.dog.state !== 'ride' || robotVisible);
    if (dogVisible) {
      entries.push({ baseline: this.dog.baseline, draw: () => this.dog.draw(ctx, this.assets) });
    }
    entries.sort((a, b) => a.baseline - b.baseline);
    for (const entry of entries) entry.draw();

    // dim for disco
    if (this.dim > 0.01) {
      ctx.fillStyle = `rgba(18, 10, 40, ${this.dim})`;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    if (robotVisible) this.actions.drawOver(ctx);
    this.particles.draw(ctx);
    this.cutaway.draw(ctx);
    if (this.dragSock && (this.dragSock.roomId ?? room.id) === room.id) {
      this.drawDraggedSock(ctx, this.dragSock);
    }
  }

  drawFridgeLight(ctx, room, fridge) {
    if (room.fridgeWobble <= 0) return;
    const alpha = clamp(room.fridgeWobble / 0.8, 0, 1);
    const glowX = fridge.cx - fridge.w * 0.34;
    const glowY = fridge.cy + fridge.h * 0.16;
    ctx.save();
    const glow = ctx.createRadialGradient(glowX, glowY, 8, glowX, glowY, fridge.w * 0.82);
    glow.addColorStop(0, `rgba(255, 250, 190, ${0.52 * alpha})`);
    glow.addColorStop(0.55, `rgba(255, 229, 130, ${0.2 * alpha})`);
    glow.addColorStop(1, 'rgba(255, 229, 130, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(glowX, glowY + fridge.h * 0.18, fridge.w * 0.82, fridge.h * 0.42, -0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawDraggedSock(ctx, sock) {
    ctx.fillStyle = 'rgba(80, 45, 25, 0.2)';
    ctx.beginPath();
    ctx.ellipse(sock.x, sock.y + 34, 22, 8, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(sock.x, sock.y - 14);
    ctx.rotate(Math.sin(this.time * 6) * 0.12);
    const img = this.assets.getTinted('sock', sock.tint);
    if (img) {
      ctx.drawImage(img, -38, -38, 76, 76);
    } else {
      ctx.fillStyle = sock.tint;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 30, 0.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
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
