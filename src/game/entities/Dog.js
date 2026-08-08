// A corgi puppy: naps in the pet bed, trots around, rides the robot...
// and occasionally does what dogs do on the floor. Robot vacuum life.
import { TAU, rand, pick, chance, dist, angleTo, angleApproach, clamp, damp } from '../core/math.js';

const DOG_PLAYFIELD_RADIUS = 62;
const DOG_POTTY_REAR_OFFSET = 44;
const DOG_POTTY_HUD_CLEARANCE = DOG_PLAYFIELD_RADIUS + DOG_POTTY_REAR_OFFSET + 8;
const DOG_VOMIT_HUD_CLEARANCE = DOG_PLAYFIELD_RADIUS + 104;
// The puddle generator scatters secondary drops up to 54 units from its
// center. Its widest secondary is 34 units, so 76 keeps the entire painted
// spill on open floor and leaves one valid robot-sized point from which every
// drop is within the mop's 64-unit wipe radius.
const DOG_VOMIT_FOOTPRINT_RADIUS = 76;
const DOG_VOMIT_FORWARD_OFFSET = 52;
const DOG_VOMIT_DOWN_OFFSET = 18;
const DOG_ROUTE_SPACING = 52;
const DOG_ROUTE_SAMPLE_STEP = 4;

export class Dog {
  constructor(game) {
    this.game = game;
    this.roomId = 'living';
    const home = this.home;
    this.x = home.x;
    this.y = home.y;
    this.state = 'sleep'; // includes the room-specific potty/retch sequences below
    this.stateT = 0;
    this.heading = 0;
    this.target = null;
    this.decideT = rand(6, 12);
    this.bob = 0;
    this.tailT = rand(0, 9);
    this.zzzT = 0;
    this.rideT = 0;
    this.rideTravelPaused = false;
    this.barkCooldown = 0;
    this.startleV = null;
    this.hurry = false;
    this.sniffT = 0;
    this.circleAnchor = null;
    this.chaseT = 0;
    this.barkT = 0;
    this.panting = 0;
    this.messKind = null;
    this.vomitSpot = null;
    this.pottyRoute = null;
    this.pottyRouteTarget = null;
    this.pottyRouteIndex = 0;
  }

  activeRoomId() {
    return this.game.house?.activeRoomId ?? this.game.robot?.roomId ?? this.game.room?.id ?? 'living';
  }

  robotRoomId() {
    return this.game.robot?.roomId ?? this.activeRoomId();
  }

  owningRoom() {
    return this.game.house?.room(this.roomId) ?? this.game.room;
  }

  isActiveRoom() {
    return this.roomId === this.activeRoomId();
  }

  isPresent() {
    return this.state === 'ride' || this.isActiveRoom();
  }

  get home() {
    const room = this.owningRoom();
    const anchor = room?.dogHome ?? room?.anchors?.dogHome;
    if (Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)) return anchor;
    const bed = room?.furniture?.find((f) => f.name === 'catbed');
    if (bed) return { x: bed.cx, y: bed.cy - 8 };
    const b = room?.bounds;
    return b ? { x: b.minX + 65, y: b.minY + 182 } : { x: 165, y: 427 };
  }

  // real recorded bark when the clip pack is loaded, synth beep-bark if not
  bark(kind = 'single') {
    if (!this.isPresent()) return false;
    const g = this.game;
    if (!g.sfx.play(kind === 'excited' ? 'bark_excited' : 'bark_single')) g.sound.bark();
    return true;
  }

  get baseline() {
    if (this.state === 'ride') return this.game.robot.y + 2;
    const base = this.state === 'sleep' ? this.y + 66 : this.y + 34;
    // anywhere on/near the bed, draw ON TOP of it — a corgi sitting in his
    // bed must never be hidden behind the bed sprite
    const bed = this.owningRoom()?.furniture?.find((f) => f.name === 'catbed');
    if (bed && dist(this.x, this.y, bed.cx, bed.cy) < 95) {
      return Math.max(base, bed.baseline + 2);
    }
    return base;
  }

  pooping() {
    return ['goPotty', 'circling', 'squat', 'proud', 'retch', 'recover'].includes(this.state);
  }

  update(dt) {
    const g = this.game;
    // A doorway immediately ends zoomies. Otherwise a dog left behind could
    // keep steering and barking at the robot's unrelated coordinates.
    if (this.state === 'chase' && this.roomId !== this.robotRoomId()) {
      this.state = 'sit';
      this.stateT = 0;
      this.target = null;
      this.decideT = rand(6, 12);
      this.panting = 2.8;
    }
    if (this.state === 'ride') {
      this.roomId = this.robotRoomId();
      if (g.robot?.isRoomTraveling?.()) {
        // House transition poses briefly carry the pair beyond ordinary room
        // bounds. Keep the rider rigidly attached, skip floor clamping, and
        // pause rideT so a hop-off cannot fire in the doorway.
        this.x = g.robot.x;
        this.y = g.robot.y - 26;
        this.rideTravelPaused = true;
        return;
      }
      if (this.rideTravelPaused) {
        // Preserve one arrived frame with the pair still visibly together;
        // the ordinary ride countdown resumes on the following update.
        this.rideTravelPaused = false;
        this.x = g.robot.x;
        this.y = g.robot.y - 26;
        return;
      }
    }
    // Room selection controls visibility and taps only. The dog keeps walking,
    // finishing accidents, and reacting to the robot in its physical room even
    // while the player watches elsewhere.
    const movementStart = { x: this.x, y: this.y };
    this.stateT += dt;
    this.tailT += dt;
    if (this.barkCooldown > 0) this.barkCooldown -= dt;
    if (this.panting > 0) this.panting -= dt;
    const trotting = ['walk', 'goPotty', 'chase'].includes(this.state);
    this.bob = Math.abs(Math.sin(this.stateT * 8)) * (trotting ? 6 : 0);

    switch (this.state) {
      case 'sleep': {
        this.zzzT -= dt;
        if (this.zzzT <= 0) {
          this.zzzT = rand(1.6, 2.6);
          g.particles.zzz(this.x + 26, this.y - 30, this.roomId);
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
          this.clearPottyRoute();
          break;
        }
        const speed = this.hurry || this.state === 'goPotty' ? 180 : 95;
        const routedPottyRun = this.usesPottyRoute();
        const waypoint = routedPottyRun ? this.currentPottyWaypoint() : this.target;
        if (!waypoint) break;
        const waypointDistance = dist(this.x, this.y, waypoint.x, waypoint.y);
        const a = angleTo(this.x, this.y, waypoint.x, waypoint.y);
        this.heading = angleApproach(this.heading, a, 4 * dt);
        if (routedPottyRun) {
          // Follow the validated segment itself while the visible dog turns
          // smoothly toward it. Using the turning heading for position made
          // short runs orbit their destination and let long runs arc through
          // the kitchen island even when both endpoints were valid floor.
          const step = Math.min(speed * dt, waypointDistance);
          const next = {
            x: this.x + Math.cos(a) * step,
            y: this.y + Math.sin(a) * step,
          };
          if (this.floorSegmentFree({ x: this.x, y: this.y }, next)) {
            this.x = next.x;
            this.y = next.y;
            if (step >= waypointDistance - 0.001) {
              this.x = waypoint.x;
              this.y = waypoint.y;
              this.pottyRouteIndex++;
            }
          } else {
            // A responsive HUD resize can invalidate an already-planned leg.
            // Re-plan from the last known-safe pose instead of entering it.
            this.clearPottyRoute();
          }
        } else {
          this.x += Math.cos(this.heading) * speed * dt;
          this.y += Math.sin(this.heading) * speed * dt;
        }
        const reachedTarget = routedPottyRun
          ? this.pottyRouteIndex >= (this.pottyRoute?.length ?? Infinity)
          : dist(this.x, this.y, this.target.x, this.target.y) < 26;
        if (reachedTarget) {
          if (this.state === 'goPotty') {
            if (this.messKind === 'vomit') {
              // The destination was selected with a valid projected puddle.
              // Snap the last small arrival tolerance so that projection is
              // still exact when the retch begins.
              this.x = this.target.x;
              this.y = this.target.y;
              this.ensureVomitSpot();
              this.state = 'retch';
              this.clearPottyRoute();
              g.sound.strain();
            } else {
              this.circleAnchor = { x: this.x, y: this.y };
              this.state = 'circling';
            }
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
          g.dirt.spawn('poop', bx, by, { roomId: this.roomId });
          g.sound.plop();
          g.particles.dustPuff(bx, by, 4, 'rgba(150, 110, 70, 0.4)', this.roomId);
          g.onDogPoop?.();
        }
        if (this.stateT > 1.9) {
          this.state = 'proud';
          this.stateT = 0;
          this.delivered = false;
          this.bark();
        }
        break;
      }
      case 'proud': {
        // so pleased with itself
        this.bob = Math.abs(Math.sin(this.stateT * 12)) * 8;
        if (this.stateT > 1.0) {
          this.hurry = false;
          this.messKind = null;
          this.beginWalk();
        }
        break;
      }
      case 'retch': {
        // Kitchen accidents come from the front and use a wet puddle rather
        // than entering the living room's raw-poop wheel-smear sequence.
        this.bob = Math.abs(Math.sin(this.stateT * 18)) * 3;
        if (this.stateT > 0.9 && !this.delivered) {
          this.delivered = true;
          const spot = this.ensureVomitSpot();
          const bx = spot.x;
          const by = spot.y;
          g.smears.spillVomit(bx, by, { roomId: this.roomId });
          g.sound.splat();
          g.particles.burst(bx, by, 'dot', 8, {
            speedMin: 25,
            speedMax: 90,
            spreadY: 0.5,
            lifeMin: 0.35,
            lifeMax: 0.75,
            sizeMin: 4,
            sizeMax: 9,
            colors: ['#b8ad55', '#d9b55c', '#8d9148'],
            roomId: this.roomId,
            extra: { ay: 150 },
          });
        }
        if (this.stateT > 1.55) {
          this.state = 'recover';
          this.stateT = 0;
          this.delivered = false;
        }
        break;
      }
      case 'recover': {
        this.bob = Math.abs(Math.sin(this.stateT * 10)) * 2;
        if (this.stateT > 0.95) {
          this.hurry = false;
          this.messKind = null;
          this.vomitSpot = null;
          g.sound.sniff();
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
      case 'chase': {
        // ZOOMIES. The robot must be barked at, immediately and at length.
        const r = g.robot;
        this.chaseT -= dt;
        const d = dist(this.x, this.y, r.x, r.y);
        const a = angleTo(this.x, this.y, r.x, r.y);
        this.heading = angleApproach(this.heading, a, 6 * dt);
        if (d > 105) {
          this.x += Math.cos(this.heading) * 205 * dt;
          this.y += Math.sin(this.heading) * 205 * dt;
        } else if (d < 80) {
          // never clip into the robot — hold a respectful barking distance
          this.x -= Math.cos(a) * 150 * dt;
          this.y -= Math.sin(a) * 150 * dt;
        }
        this.barkT -= dt;
        if (this.barkT <= 0) {
          this.barkT = rand(0.9, 1.7);
          this.bark(chance(0.4) ? 'excited' : 'single');
        }
        // done, or the robot escaped somewhere un-chaseable (dock, a hand...)
        if (this.chaseT <= 0 || !['clean', 'seek', 'leaving', 'godock', 'action'].includes(r.state)) {
          this.state = 'sit';
          this.stateT = 0;
          this.decideT = rand(6, 12);
          this.panting = 2.8;
          if (!g.sfx.play('dog_pant')) g.sound.sniff();
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
    const b = this.owningRoom().bounds;
    this.x = clamp(this.x, b.minX - 30, b.maxX + 30);
    this.y = clamp(this.y, b.minY - 40, b.maxY + 40);
    this.keepOutOfHud(movementStart);
  }

  keepOutOfHud(previous) {
    this.reconcileHudAvoidance(previous);
  }

  reconcileHudAvoidance(previous = null) {
    const room = this.owningRoom();
    if (!room?.isHudFree) return;

    if (!room.isHudFree(this.x, this.y, DOG_PLAYFIELD_RADIUS)) {
      if (previous && room.isHudFree(previous.x, previous.y, DOG_PLAYFIELD_RADIUS)) {
        this.x = previous.x;
        this.y = previous.y;
      } else {
        const safe = room.nearestFreePoint?.(this.x, this.y, DOG_PLAYFIELD_RADIUS)
          ?? room.randomFloorPoint(DOG_PLAYFIELD_RADIUS);
        this.x = safe.x;
        this.y = safe.y;
      }

      if (this.circleAnchor) this.circleAnchor = { x: this.x, y: this.y };
      if (this.state === 'startle') this.startleV = null;
    }

    if (this.target) {
      const clearance = this.state === 'goPotty'
        ? (this.messKind === 'vomit' ? DOG_VOMIT_HUD_CLEARANCE : DOG_POTTY_HUD_CLEARANCE)
        : DOG_PLAYFIELD_RADIUS;
      const vomitPlan = this.state === 'goPotty' && this.messKind === 'vomit'
        ? this.vomitPlanAt(this.target.x, this.target.y, this.vomitSpot?.heading)
        : null;
      if (!room.isHudFree(this.target.x, this.target.y, clearance) ||
          (this.state === 'goPotty' && this.messKind === 'vomit' && !vomitPlan)) {
        if (this.state === 'goPotty' && this.messKind === 'vomit') {
          const destination = this.findVomitDestination();
          this.target = destination.point;
          this.vomitSpot = destination.plan;
        } else {
          this.target = room.randomFloorPoint(
            this.state === 'goPotty' ? 55 : DOG_PLAYFIELD_RADIUS,
            { hudClearance: clearance },
          );
        }
      } else if (vomitPlan) {
        this.vomitSpot = vomitPlan;
      }
    }

    // A resize can raise the minimap after the dog has already stopped and
    // cleared its walking target. Revalidate the projected puddle itself, not
    // just the dog's smaller body, before the delivery frame arrives.
    if (this.state === 'retch' && !this.delivered) this.ensureVomitSpot();
  }

  vomitPlanAt(x, y, preferredHeading = null) {
    const room = this.owningRoom();
    const firstHeading = preferredHeading === 0 || preferredHeading === Math.PI
      ? preferredHeading
      : pick([0, Math.PI]);
    for (const heading of [firstHeading, firstHeading === 0 ? Math.PI : 0]) {
      const point = {
        x: x + Math.cos(heading) * DOG_VOMIT_FORWARD_OFFSET,
        y: y + DOG_VOMIT_DOWN_OFFSET,
      };
      const b = room.bounds;
      const radius = DOG_VOMIT_FOOTPRINT_RADIUS;
      const insideFloor = point.x - radius >= b.minX && point.x + radius <= b.maxX &&
        point.y - radius >= b.minY && point.y + radius <= b.maxY;
      if (insideFloor && room.isFree(point.x, point.y, radius, {
        ignoreDock: true,
        solidTable: true,
      })) {
        return { ...point, heading };
      }
    }
    return null;
  }

  findVomitDestination({ requireRobotDistance = true } = {}) {
    const room = this.owningRoom();
    const g = this.game;
    const usable = (point) => point.y > 400 &&
      (!requireRobotDistance || dist(point.x, point.y, g.robot.x, g.robot.y) > 200) &&
      room.isFree(point.x, point.y, DOG_PLAYFIELD_RADIUS, { solidTable: true });

    for (let i = 0; i < 80; i++) {
      const point = room.randomFloorPoint(55, {
        hudClearance: DOG_VOMIT_HUD_CLEARANCE,
      });
      if (!usable(point)) continue;
      const plan = this.vomitPlanAt(point.x, point.y);
      if (plan) return { point, plan };
    }

    // Deterministic fallback for pathological random runs and compact layouts.
    const b = room.bounds;
    for (let y = b.maxY - DOG_PLAYFIELD_RADIUS; y >= Math.max(401, b.minY + DOG_PLAYFIELD_RADIUS); y -= 44) {
      for (let x = b.minX + DOG_PLAYFIELD_RADIUS; x <= b.maxX - DOG_PLAYFIELD_RADIUS; x += 44) {
        const point = { x, y };
        if (!usable(point)) continue;
        const plan = this.vomitPlanAt(point.x, point.y, 0);
        if (plan) return { point, plan };
      }
    }

    // The kitchen has ample valid floor, but retain a safe final fallback if a
    // future layout becomes unusually tight. Dropping the robot-distance
    // preference is safer than ever projecting into furniture or the HUD.
    if (requireRobotDistance) return this.findVomitDestination({ requireRobotDistance: false });
    const point = room.randomFloorPoint(DOG_PLAYFIELD_RADIUS, {
      hudClearance: DOG_VOMIT_HUD_CLEARANCE,
    });
    const plan = this.vomitPlanAt(point.x, point.y, 0);
    if (plan) return { point, plan };
    return {
      point: { x: room.bounds.minX + 210, y: room.bounds.maxY - 190 },
      plan: this.vomitPlanAt(room.bounds.minX + 210, room.bounds.maxY - 190, 0),
    };
  }

  ensureVomitSpot() {
    let plan = this.vomitPlanAt(this.x, this.y, this.vomitSpot?.heading ?? this.heading);
    if (!plan) {
      const destination = this.findVomitDestination({ requireRobotDistance: false });
      this.x = destination.point.x;
      this.y = destination.point.y;
      plan = destination.plan;
    }
    // The deterministic fallback above is intentionally chosen from known
    // open kitchen floor, so plan is non-null for every current room layout.
    this.heading = plan.heading;
    this.vomitSpot = plan;
    return plan;
  }

  usesPottyRoute() {
    return this.state === 'goPotty' && this.roomId === 'kitchen' && this.messKind === 'vomit';
  }

  clearPottyRoute() {
    this.pottyRoute = null;
    this.pottyRouteTarget = null;
    this.pottyRouteIndex = 0;
  }

  currentPottyWaypoint() {
    const targetChanged = !this.pottyRouteTarget ||
      dist(
        this.pottyRouteTarget.x,
        this.pottyRouteTarget.y,
        this.target.x,
        this.target.y,
      ) > 0.01;
    if (!this.pottyRoute?.length || targetChanged) {
      this.pottyRoute = this.planPottyRoute(this.target) ?? [];
      this.pottyRouteTarget = { ...this.target };
      this.pottyRouteIndex = 0;
    }
    return this.pottyRoute[this.pottyRouteIndex] ?? null;
  }

  // Kitchen accident destinations can lie on the opposite side of the solid
  // island. A small deterministic grid search turns the connected floor into
  // collision-checked waypoints, then removes every waypoint that is not
  // needed. Living-room potty runs retain their original free-form motion.
  planPottyRoute(target) {
    const room = this.owningRoom();
    const start = { x: this.x, y: this.y };
    const goal = { x: target.x, y: target.y };
    if (this.floorSegmentFree(start, goal)) return [goal];

    const bounds = room.bounds;
    const xValues = routeAxisValues(bounds.minX, bounds.maxX, [start.x, goal.x]);
    const yValues = routeAxisValues(bounds.minY, bounds.maxY, [start.y, goal.y]);
    const nodes = new Map();
    for (let row = 0; row < yValues.length; row++) {
      for (let col = 0; col < xValues.length; col++) {
        const point = { x: xValues[col], y: yValues[row] };
        if (!room.isFree(point.x, point.y, DOG_PLAYFIELD_RADIUS, { solidTable: true })) continue;
        const key = `${col},${row}`;
        nodes.set(key, { ...point, key, col, row });
      }
    }

    const startCol = xValues.findIndex((value) => Math.abs(value - start.x) < 0.001);
    const startRow = yValues.findIndex((value) => Math.abs(value - start.y) < 0.001);
    const startNode = nodes.get(`${startCol},${startRow}`);
    if (!startNode) return null;

    const open = [{
      node: startNode,
      cost: 0,
      score: dist(start.x, start.y, goal.x, goal.y),
    }];
    const costs = new Map([[startNode.key, 0]]);
    const parents = new Map([[startNode.key, null]]);
    let reached = null;

    while (open.length) {
      open.sort((a, b) => a.score - b.score);
      const current = open.shift();
      if (current.cost !== costs.get(current.node.key)) continue;
      if (this.floorSegmentFree(current.node, goal)) {
        reached = current.node;
        break;
      }

      for (let rowStep = -1; rowStep <= 1; rowStep++) {
        for (let colStep = -1; colStep <= 1; colStep++) {
          if (rowStep === 0 && colStep === 0) continue;
          const next = nodes.get(`${current.node.col + colStep},${current.node.row + rowStep}`);
          if (!next || !this.floorSegmentFree(current.node, next)) continue;
          const nextCost = current.cost + dist(current.node.x, current.node.y, next.x, next.y);
          if (nextCost >= (costs.get(next.key) ?? Infinity)) continue;
          costs.set(next.key, nextCost);
          parents.set(next.key, current.node.key);
          open.push({
            node: next,
            cost: nextCost,
            score: nextCost + dist(next.x, next.y, goal.x, goal.y),
          });
        }
      }
    }
    if (!reached) return null;

    const gridPath = [];
    for (let node = reached; node; node = nodes.get(parents.get(node.key))) {
      gridPath.push({ x: node.x, y: node.y });
    }
    gridPath.reverse();
    const rawPath = [start, ...gridPath.slice(1), goal];
    const route = [];
    let fromIndex = 0;
    while (fromIndex < rawPath.length - 1) {
      let nextIndex = rawPath.length - 1;
      while (nextIndex > fromIndex + 1 &&
          !this.floorSegmentFree(rawPath[fromIndex], rawPath[nextIndex])) {
        nextIndex--;
      }
      route.push(rawPath[nextIndex]);
      fromIndex = nextIndex;
    }
    return route;
  }

  floorSegmentFree(from, to) {
    const room = this.owningRoom();
    const radius = DOG_PLAYFIELD_RADIUS;
    const opts = { solidTable: true };
    if (!room.isFree(from.x, from.y, radius, opts) ||
        !room.isFree(to.x, to.y, radius, opts)) {
      return false;
    }

    const furniture = [];
    for (const item of room.furniture ?? []) {
      if (item.foot) furniture.push(item.foot);
      if (item.legs) furniture.push(...item.legs);
    }
    if (room.tableSolidFootprint) furniture.push(room.tableSolidFootprint);
    const dock = room.dockForRoom?.();
    if (dock?.footprint) furniture.push(dock.footprint);
    const radiusSquared = radius * radius;
    for (const footprint of furniture) {
      if (segmentRectDistanceSquared(from, to, footprint) < radiusSquared) return false;
    }

    const hud = room.hudAvoidanceRect?.();
    if (hud && segmentRectDistanceSquared(from, to, hud) <= radiusSquared) return false;

    // Keep custom room constraints covered in addition to the exact rectangle
    // checks above. The step is smaller than one normal 60 Hz potty stride.
    const length = dist(from.x, from.y, to.x, to.y);
    const steps = Math.max(1, Math.ceil(length / DOG_ROUTE_SAMPLE_STEP));
    for (let index = 1; index <= steps; index++) {
      const t = index / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      if (!room.isFree(x, y, radius, opts)) return false;
    }
    return true;
  }

  beginWalk(forcedTarget = null) {
    this.clearPottyRoute();
    const room = this.owningRoom();
    this.target = forcedTarget && room.isHudFree?.(forcedTarget.x, forcedTarget.y, DOG_PLAYFIELD_RADIUS)
      ? forcedTarget
      : room.randomFloorPoint(50, { hudClearance: DOG_PLAYFIELD_RADIUS });
    this.state = 'walk';
    this.stateT = 0;
    return true;
  }

  // tear after the robot, barking — pure joy, zero malice
  startChase() {
    const g = this.game;
    if (this.roomId !== this.robotRoomId()) return false;
    if (['ride', 'startle', 'chase'].includes(this.state) || this.pooping()) return false;
    if (!['clean', 'seek', 'leaving', 'godock'].includes(g.robot.state)) return false;
    this.state = 'chase';
    this.stateT = 0;
    this.chaseT = rand(6.5, 9.5);
    this.barkT = 0.15;
    g.robot.onChased();
    return true;
  }

  // Trot to a clear spot. The living room keeps the original poop routine;
  // the kitchen branches into a front-facing retch and wet puddle.
  startPottyRun() {
    if (!this.isActiveRoom()) return false;
    if (this.state === 'ride' || this.pooping()) return false;
    const g = this.game;
    const room = this.owningRoom();
    this.messKind = this.roomId === 'kitchen' ? 'vomit' : 'poop';
    this.vomitSpot = null;
    const hudClearance = this.messKind === 'vomit'
      ? DOG_VOMIT_HUD_CLEARANCE
      : DOG_POTTY_HUD_CLEARANCE;
    let spot = null;
    let vomitPlan = null;
    for (let i = 0; i < 40; i++) {
      const p = room.randomFloorPoint(55, {
        hudClearance,
      });
      const bodyClearance = this.messKind === 'vomit' ? DOG_PLAYFIELD_RADIUS : 60;
      if (p.y > 400 && dist(p.x, p.y, g.robot.x, g.robot.y) > 200 &&
          room.isFree(p.x, p.y, bodyClearance, { solidTable: true })) {
        if (this.messKind === 'vomit') {
          const plan = this.vomitPlanAt(p.x, p.y);
          if (!plan) continue;
          vomitPlan = plan;
        }
        spot = p;
        break;
      }
    }
    if (!spot) {
      if (this.messKind === 'vomit') {
        const destination = this.findVomitDestination();
        spot = destination.point;
        vomitPlan = destination.plan;
      } else {
        spot = room.randomFloorPoint(55, {
          hudClearance,
        });
      }
    }
    this.clearPottyRoute();
    this.target = spot;
    this.vomitSpot = vomitPlan;
    this.state = 'goPotty';
    this.stateT = 0;
    this.delivered = false;
    this.bark();
    return true;
  }

  startle() {
    if (this.roomId !== this.robotRoomId()) return false;
    if (this.state === 'ride' || this.state === 'startle' || this.pooping()) return false;
    const g = this.game;
    const away = angleTo(g.robot.x, g.robot.y, this.x, this.y);
    this.startleV = { x: Math.cos(away) * 420, y: Math.sin(away) * 420 };
    this.state = 'startle';
    this.stateT = 0;
    g.sound.yelp();
    g.particles.dustPuff(this.x, this.y + 20, 6, undefined, this.roomId);
    return true;
  }

  tryRide() {
    const r = this.game.robot;
    if (this.roomId !== this.robotRoomId()) return false;
    if (this.state === 'ride' || this.pooping()) return false;
    if (['align', 'empty', 'charge', 'docked', 'washpads'].includes(r.state)) return false;
    this.state = 'ride';
    this.rideT = rand(10, 16);
    this.rideTravelPaused = false;
    this.stateT = 0;
    this.bark();
    return true;
  }

  hopOff() {
    const g = this.game;
    this.roomId = this.robotRoomId();
    this.rideTravelPaused = false;
    this.state = 'walk';
    this.stateT = 0;
    this.target = this.owningRoom().randomFloorPoint(50, {
      hudClearance: DOG_PLAYFIELD_RADIUS,
    });
    g.particles.dustPuff(this.x, this.y + 30, 4, undefined, this.roomId);
  }

  onTap() {
    const g = this.game;
    if (!this.isPresent()) return;
    if (this.barkCooldown > 0) return;
    this.barkCooldown = 0.7;
    if (this.state === 'ride') {
      this.bark();
      g.particles.hearts(this.x, this.y - 40, 3, this.roomId);
      return;
    }
    // A dog tap always starts its room-specific accident unless it is already
    // busy or riding the robot.
    if (this.startPottyRun()) return;
    if (this.state === 'sleep') {
      this.state = 'sit';
      this.stateT = 0;
      this.bark();
      g.particles.add({
        x: this.x,
        y: this.y - 60,
        roomId: this.roomId,
        kind: 'heart',
        color: '#ff8fab',
        size: 12,
        vy: -60,
        life: 1,
      });
      return;
    }
    if (dist(this.x, this.y, g.robot.x, g.robot.y) < 240 && chance(0.55) && this.tryRide()) return;
    this.bark();
    if (chance(0.5)) this.beginWalk();
  }

  contains(x, y) {
    return this.isPresent() && dist(x, y, this.x, this.y) < 62;
  }

  draw(ctx, assets) {
    if (!this.isPresent()) return;
    const sleeping = this.state === 'sleep';
    const riding = this.state === 'ride';
    const squatting = this.state === 'squat';
    const retching = this.state === 'retch';
    const recovering = this.state === 'recover';
    const img = sleeping
      ? (assets.get('dog_sleep') || assets.get('dog_sit'))
      : ['walk', 'goPotty', 'circling', 'chase'].includes(this.state)
        ? assets.get('dog_walk')
        : assets.get('dog_sit');

    ctx.save();
    ctx.translate(this.x, this.y - this.bob - (riding ? 14 : 0));
    const facingLeft = Math.cos(this.heading) < 0 &&
      ['walk', 'goPotty', 'circling', 'chase', 'retch'].includes(this.state);
    if (facingLeft) ctx.scale(-1, 1);
    if (retching) {
      // Hunch forward toward the puddle with a small queasy pulse.
      ctx.translate(8, 12);
      ctx.scale(1.07, 0.82);
      ctx.rotate(Math.sin(this.stateT * 22) * 0.035);
    } else if (squatting) {
      // hunched, trembling concentration
      ctx.translate(0, 10);
      ctx.scale(1.06, 0.82);
      ctx.rotate(Math.sin(this.stateT * 26) * 0.03);
    }
    if (this.state === 'proud') {
      ctx.rotate(Math.sin(this.stateT * 12) * 0.08);
    }
    if (recovering) ctx.rotate(Math.sin(this.stateT * 15) * 0.045);

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
      const walk = ['walk', 'goPotty', 'circling', 'chase'].includes(this.state);
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
      // tongue (out while proud or panting after a good chase)
      if (this.state === 'proud' || this.panting > 0) {
        ctx.fillStyle = '#ff8fab';
        ctx.beginPath();
        ctx.ellipse(26, 5, 3.5, 6, 0.2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function routeAxisValues(min, max, extras = []) {
  const values = [];
  for (let value = min; value <= max + 0.1; value += DOG_ROUTE_SPACING) values.push(value);
  for (const value of extras) {
    if (Number.isFinite(value) && value >= min && value <= max) values.push(value);
  }
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))]
    .sort((a, b) => a - b);
}

function segmentRectDistanceSquared(from, to, rect) {
  if (pointInRectangle(from, rect) || pointInRectangle(to, rect)) return 0;
  const topLeft = { x: rect.x, y: rect.y };
  const topRight = { x: rect.x + rect.w, y: rect.y };
  const bottomRight = { x: rect.x + rect.w, y: rect.y + rect.h };
  const bottomLeft = { x: rect.x, y: rect.y + rect.h };
  return Math.min(
    segmentDistanceSquared(from, to, topLeft, topRight),
    segmentDistanceSquared(from, to, topRight, bottomRight),
    segmentDistanceSquared(from, to, bottomRight, bottomLeft),
    segmentDistanceSquared(from, to, bottomLeft, topLeft),
  );
}

function pointInRectangle(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w &&
    point.y >= rect.y && point.y <= rect.y + rect.h;
}

function segmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  );
}

function pointSegmentDistanceSquared(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) {
    return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
  }
  const t = clamp(
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    0,
    1,
  );
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 1e-9;
  const onSegment = (p, q, r) =>
    q.x >= Math.min(p.x, r.x) - epsilon && q.x <= Math.max(p.x, r.x) + epsilon &&
    q.y >= Math.min(p.y, r.y) - epsilon && q.y <= Math.max(p.y, r.y) + epsilon;
  if (Math.abs(abC) <= epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(c, b, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}
