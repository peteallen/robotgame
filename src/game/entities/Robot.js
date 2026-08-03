// Robo — the robot vacuum star of the show.
// Real-robot behaviors: straight-line wander with bump-and-turn, spiral
// cleaning, wall following, docking to auto-empty + fast-charge.
import { TAU, clamp, lerp, rand, pick, chance, dist, angleTo, angleDiff, angleApproach, damp, easeOutCubic } from '../core/math.js';
import { Room, roundRect } from '../world/Room.js';

const R = 62; // robot radius in world units (sized so the on-body battery reads)

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
    // The robot, rather than the currently drawn scene, is the authoritative
    // owner of its location. House transitions update this at their midpoint.
    this.roomId = 'living';
    this.roomTravel = null;
    this.targetRoomId = null;

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
    this.seekPathTarget = null;
    this.seekPath = null;
    this.seekPathIndex = 0;
    this.seekWaypointBest = Infinity;
    this.seekWaypointStallT = 0;
    this.seekCheckT = 1;
    this.chirpT = rand(5, 10);
    this.stuckT = 0;
    this.lastX = this.x;
    this.lastY = this.y;

    this.battery = 0.85;
    this.bin = 0.2;
    this.suctionOn = false;
    this.stayDocked = false; // parked via dock tap, naps until tapped awake
    this.dockAfterAction = false; // set by winParty: dock + stay when it ends
    this.napT = 0;
    this.backupBeepT = 0;
    this.seekT = 0;

    // the poopocalypse
    this.smearT = 0; // seconds of oblivious mess-spreading left
    this.smearDist = 0;
    this.smearRoomId = null;
    this.mopMode = false;
    this.fateTarget = null; // disguised waypoint that leads through... something

    // dock maintenance
    this.waitingForBag = false; // parked, bin full, bag full — needs a human
    this.announceT = 0;
    this.actionDockOk = false; // actions may drive onto the dock pad

    // wedged under furniture, crying for a rescue (status light flashes red)
    this.trapped = false;

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
    // An emergency action can be forced between any two frames. Cancel a
    // doorway trip through House first so the new action never inherits a
    // half-owned transition that it cannot advance.
    if (this.roomTravel) this.abortRoomTravel();
    this.controlled = true;
    this.state = 'action';
    this.bump = null;
    this.seekDirt = null;
  }

  // is he sitting at the dock with a maintenance problem? (red-blink signal)
  dockAlerted() {
    return ['docked', 'charge', 'empty', 'washpads'].includes(this.state) &&
      this.game.dock.anyAlert();
  }

  release() {
    this.controlled = false;
    this.trailMode = null;
    if (this.dockAfterAction) {
      // the win party ended: head home the normal way and stay parked
      // until somebody taps the robot awake (same flow as a dock-tap park)
      this.dockAfterAction = false;
      this.stayDocked = true;
    }
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
    const room = this.roomFor();
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
    const room = this.roomFor();
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

  roomFor(roomId = this.roomId) {
    return this.game.house?.room?.(roomId) ?? this.game.room;
  }

  isRoomTraveling() {
    return this.roomTravel !== null;
  }

  // Public entry point for doorway taps and the minimap. Controlled actions
  // use travelToRoomStep() instead, so a room request never cancels an action.
  requestRoom(roomId, reason = 'manual') {
    const house = this.game.house;
    if (!house?.room?.(roomId)) return roomId === this.roomId;
    // A deliberate dock nap has one wake-up affordance: tapping the robot.
    // Room controls may choose a destination only after wake() clears this flag;
    // the dock-owned route home remains allowed while that nap is being set up.
    if (this.stayDocked && reason !== 'dock') return false;
    if (!this.roomTravel && roomId === this.roomId) return true;
    if (this.controlled) return false;
    if (this.roomTravel) return this.roomTravel.targetRoomId === roomId;
    if (this.smearT > 0 && reason !== 'dock') return false;
    if (this.game.dog?.roomId === this.roomId && this.game.dog.pooping?.()) {
      return false;
    }

    // Finishing dock service and backing onto the pad are deliberately not
    // interruptible. An alerted dock also keeps its existing refusal behavior.
    const dockBusy = ['align', 'empty', 'charge', 'washpads'].includes(this.state);
    if (dockBusy && reason !== 'dock') return false;
    if (this.state === 'docked' && this.game.dock.anyAlert()) {
      this.game.dock.beacon = 1.2;
      this.game.sound.errorBuzz();
      this.setExpr('full', 3);
      return false;
    }
    if (this.state === 'godock' && reason !== 'dock') return false;

    let resumeState = this.state;
    if (resumeState === 'docked' || resumeState === 'leaving') resumeState = 'clean';
    if (!['clean', 'seek', 'godock'].includes(resumeState)) resumeState = 'clean';
    const resume = {
      state: resumeState,
      cleanMode: this.cleanMode,
      modeTimer: this.modeTimer,
      seekDirt: this.seekDirt,
      seekT: this.seekT,
      fateTarget: this.fateTarget,
    };

    if (this.state === 'docked') {
      this.stayDocked = false;
      this.game.sound.undockChime();
    }
    return this.beginRoomTravel(roomId, { owner: 'state', reason, resume });
  }

  // Controlled dock and cleanup actions call this once per frame and pause
  // their own local phase until it returns true.
  travelToRoomStep(targetRoomId, dt) {
    if (!this.roomTravel && this.roomId === targetRoomId) return true;
    if (!this.roomTravel) {
      if (!this.beginRoomTravel(targetRoomId, { owner: 'controlled', reason: 'action' })) {
        return false;
      }
    } else if (this.roomTravel.targetRoomId !== targetRoomId) {
      return false;
    }
    return this.updateRoomTravel(dt);
  }

  beginRoomTravel(targetRoomId, { owner, reason, resume = null }) {
    const house = this.game.house;
    if (!house?.room?.(targetRoomId) || house.transition || this.roomTravel ||
        targetRoomId === this.roomId) return false;
    if (this.game.dog?.roomId === this.roomId && this.game.dog.pooping?.()) return false;
    const portal = house.portal?.(this.roomId, targetRoomId) ?? this.roomFor()?.portal?.(targetRoomId);
    if (!portal) return false;

    const path = this.planRoomTravelPath(
      portal.approach.x,
      portal.approach.y,
      { ignoreDock: true },
    );
    if (!path?.length) return false;

    // A manual or cleaning trip should not carry a nearly-finished suction
    // animation across the doorway. Leave that item in the source room so the
    // final pickup, and any resulting victory, still belongs to the room where
    // cleaning actually completes. Automatic dock trips keep their in-flight
    // pickup because the victory watchdog may intentionally preempt them.
    if (owner === 'state' && reason !== 'dock') {
      for (const item of this.game.dirt.items) {
        if (item.roomId !== this.roomId || !item.sucking) continue;
        item.sucking = false;
        item.suckT = 0;
      }
    }

    this.roomTravel = {
      owner,
      reason,
      fromRoomId: this.roomId,
      targetRoomId,
      portalId: portal.id,
      phase: 'approach',
      resume,
      path,
      pathIndex: 0,
      waypointBest: Infinity,
      waypointStallT: 0,
    };
    this.targetRoomId = targetRoomId;
    this.bump = null;
    this.escape = null;
    this.speed = 0;
    this.targetSpeed = 0;
    this.seekDirt = null;
    if (this.fateTarget) this.clearFateTarget();
    this.prepareDogForTravel();
    if (owner === 'state') {
      this.state = 'travel';
      this.stateT = 0;
    }
    return true;
  }

  // Doorway travel needs a stronger guarantee than ordinary wandering. A
  // small deterministic grid search finds a collision-checked corridor around
  // large furniture, then simplifies it into a handful of visible waypoints.
  // This prevents local steering from orbiting the kitchen island forever.
  planRoomTravelPath(tx, ty, opts = {}) {
    const room = this.roomFor();
    const start = { x: this.x, y: this.y };
    const goal = { x: tx, y: ty };
    // A physically clear direct line is safe even when it passes through a
    // deliberately snug authored corridor. Detours use a larger margin.
    if (this.travelSegmentFree(room, start, goal, opts, R + 2)) return [goal];

    const spacing = 56;
    const clearance = R + 8;
    const nodes = new Map();
    const bounds = room.bounds;
    const xValues = axisValues(bounds.minX, bounds.maxX, spacing, [start.x, goal.x]);
    const yValues = axisValues(bounds.minY, bounds.maxY, spacing, [start.y, goal.y]);
    for (let row = 0; row < yValues.length; row++) {
      const y = yValues[row];
      for (let col = 0; col < xValues.length; col++) {
        const x = xValues[col];
        if (!room.isFree(x, y, clearance, opts)) continue;
        const key = `${col},${row}`;
        nodes.set(key, { key, col, row, x, y });
      }
    }

    const connectorRadius = spacing * 2.6;
    let starts = [...nodes.values()].filter((node) =>
      dist(start.x, start.y, node.x, node.y) <= connectorRadius &&
      this.travelSegmentFree(room, start, node, opts)
    );
    // Authored edge pockets can fall between grid rows. If that happens, use
    // any physically visible node rather than falling back to the looping
    // local planner. This connector alone uses the physics radius so a robot
    // already sitting in a snug but valid corridor can drive outward into the
    // grid's more generous clearance.
    if (!starts.length) {
      starts = [...nodes.values()].filter((node) =>
        this.travelSegmentFree(room, start, node, opts, R)
      );
    }
    if (!starts.length) return null;

    const open = [];
    const costs = new Map();
    const parents = new Map();
    for (const node of starts) {
      const cost = dist(start.x, start.y, node.x, node.y);
      costs.set(node.key, cost);
      parents.set(node.key, null);
      open.push({ node, cost, score: cost + dist(node.x, node.y, goal.x, goal.y) });
    }

    let reached = null;
    while (open.length) {
      open.sort((a, b) => a.score - b.score);
      const current = open.shift();
      if (current.cost !== costs.get(current.node.key)) continue;
      if (this.travelSegmentFree(room, current.node, goal, opts)) {
        reached = current.node;
        break;
      }

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const next = nodes.get(`${current.node.col + dx},${current.node.row + dy}`);
          if (!next || !this.travelSegmentFree(room, current.node, next, opts)) continue;
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
    const raw = [start, ...gridPath, goal];
    const simplified = [];
    let fromIndex = 0;
    while (fromIndex < raw.length - 1) {
      let nextIndex = raw.length - 1;
      while (nextIndex > fromIndex + 1 &&
          !this.travelSegmentFree(room, raw[fromIndex], raw[nextIndex], opts)) {
        nextIndex--;
      }
      simplified.push(raw[nextIndex]);
      fromIndex = nextIndex;
    }
    return simplified;
  }

  clearSeekPath() {
    this.seekPathTarget = null;
    this.seekPath = null;
    this.seekPathIndex = 0;
    this.seekWaypointBest = Infinity;
    this.seekWaypointStallT = 0;
  }

  planSeekPath(target) {
    const room = this.roomFor();
    if (!target || !room) return null;
    const candidates = [{ x: target.x, y: target.y }];
    const towardRobot = angleTo(target.x, target.y, this.x, this.y);
    // Floor specks are intentionally allowed closer to furniture than the
    // robot's body. The suction mouth reaches well beyond the chassis, so plan
    // to a free point around the speck and let the final short approach pull it
    // in without trying to park the robot on top of it.
    for (const radius of [72, 88]) {
      for (let index = 0; index < 16; index++) {
        const angle = towardRobot + index * Math.PI / 8;
        candidates.push({
          x: target.x + Math.cos(angle) * radius,
          y: target.y + Math.sin(angle) * radius,
        });
      }
    }

    let best = null;
    for (const candidate of candidates) {
      if (!room.isFree(candidate.x, candidate.y, R + 8)) continue;
      const path = this.planRoomTravelPath(candidate.x, candidate.y);
      if (!path?.length) continue;
      let length = 0;
      let previous = this;
      for (const point of path) {
        length += dist(previous.x, previous.y, point.x, point.y);
        previous = point;
      }
      if (!best || length < best.length) best = { path, length };
    }
    return best?.path ?? null;
  }

  followSeekPath(target, dt) {
    if (this.seekPathTarget !== target) {
      this.clearSeekPath();
      this.seekPathTarget = target;
      this.seekPath = this.planSeekPath(target);
    }
    if (!this.seekPath || this.seekPathIndex >= this.seekPath.length) return false;

    const waypoint = this.seekPath[this.seekPathIndex];
    const waypointDistance = dist(this.x, this.y, waypoint.x, waypoint.y);
    if (waypointDistance < this.seekWaypointBest - 0.5) {
      this.seekWaypointBest = waypointDistance;
      this.seekWaypointStallT = 0;
    } else {
      this.seekWaypointStallT += dt;
    }
    if (this.seekWaypointStallT > 2.2) {
      this.seekPath = this.planSeekPath(target);
      this.seekPathIndex = 0;
      this.seekWaypointBest = Infinity;
      this.seekWaypointStallT = 0;
      this.escape = null;
      return !!this.seekPath;
    }

    const lastWaypoint = this.seekPathIndex === this.seekPath.length - 1;
    if (this.driveTravelWaypoint(
      waypoint.x,
      waypoint.y,
      lastWaypoint ? 170 : 155,
      lastWaypoint ? 14 : 20,
    )) {
      this.seekPathIndex++;
      this.seekWaypointBest = Infinity;
      this.seekWaypointStallT = 0;
    }
    return true;
  }

  travelSegmentFree(room, from, to, opts = {}, clearance = R + 8) {
    if (!room.isFree(from.x, from.y, clearance, opts) ||
        !room.isFree(to.x, to.y, clearance, opts)) {
      return false;
    }

    // Room collision is built from axis-aligned furniture footprints. Check
    // the entire line against those shapes, not only sampled positions. This
    // catches arbitrarily short collision intervals where a route just grazes
    // a rounded, radius-inflated furniture corner.
    const obstacles = [];
    for (const furniture of room.furniture ?? []) {
      if (opts.ignoreCouch && furniture.name === 'couch') continue;
      if (furniture.foot) obstacles.push(furniture.foot);
      if (furniture.legs) obstacles.push(...furniture.legs);
    }
    const tableSolid = room.tableSolidFootprint ?? Room.TABLE_SOLID;
    if (opts.solidTable && tableSolid) obstacles.push(tableSolid);
    const dock = room.dockForRoom?.();
    if (!opts.ignoreDock && dock?.footprint) obstacles.push(dock.footprint);
    const clearanceSq = clearance * clearance;
    for (const obstacle of obstacles) {
      if (segmentRectDistanceSquared(from, to, obstacle) < clearanceSq) return false;
    }

    const length = dist(from.x, from.y, to.x, to.y);
    // Keep the validation stride below the robot's normal per-frame movement.
    // A coarse sample can hop over the very short collision interval created
    // by a line grazing an inflated furniture corner, even though movement
    // physics catches that interval and leaves the robot pinned there.
    const steps = Math.max(1, Math.ceil(length / 4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!room.isFree(lerp(from.x, to.x, t), lerp(from.y, to.y, t), clearance, opts)) {
        return false;
      }
    }
    return true;
  }

  driveTravelWaypoint(tx, ty, speed = 165, arrive = 20) {
    const distance = dist(this.x, this.y, tx, ty);
    if (distance < arrive) {
      this.speed = 0;
      this.targetSpeed = 0;
      return true;
    }
    const want = angleTo(this.x, this.y, tx, ty);
    this.heading = angleApproach(this.heading, want, this.turnRate * 1.7 * this.game.dt);
    const misalign = Math.abs(angleDiff(this.heading, want));
    // Pivot before committing to a pre-validated segment. Carrying residual
    // speed around a sharp waypoint corner can otherwise cut into furniture.
    this.targetSpeed = misalign > 0.28
      ? 0
      : speed * clamp(1.05 - misalign * 0.8, 0.55, 1);
    return false;
  }

  updateRoomTravel(dt) {
    const travel = this.roomTravel;
    const house = this.game.house;
    if (!travel || !house) return false;

    const portal = house.portal?.(travel.fromRoomId, travel.portalId)
      ?? house.room?.(travel.fromRoomId)?.portal?.(travel.portalId);
    if (!portal) {
      this.abortRoomTravel();
      return false;
    }

    if (travel.phase === 'approach') {
      if (!travel.path?.length || travel.pathIndex >= travel.path.length) {
        const path = this.planRoomTravelPath(
          portal.approach.x,
          portal.approach.y,
          { ignoreDock: true },
        );
        if (!path?.length) {
          this.abortRoomTravel();
          return false;
        }
        travel.path = path;
        travel.pathIndex = 0;
        travel.waypointBest = Infinity;
        travel.waypointStallT = 0;
      }
      const waypoint = travel.path[travel.pathIndex] ?? portal.approach;
      const waypointDistance = dist(this.x, this.y, waypoint.x, waypoint.y);
      if (waypointDistance < travel.waypointBest - 0.5) {
        travel.waypointBest = waypointDistance;
        travel.waypointStallT = 0;
      } else {
        travel.waypointStallT += dt;
      }
      if (travel.waypointStallT > 2.2) {
        const path = this.planRoomTravelPath(
          portal.approach.x,
          portal.approach.y,
          { ignoreDock: true },
        );
        if (!path?.length) {
          this.abortRoomTravel();
          return false;
        }
        travel.path = path;
        travel.pathIndex = 0;
        travel.waypointBest = Infinity;
        travel.waypointStallT = 0;
        this.escape = null;
        return false;
      }

      const lastWaypoint = travel.pathIndex === travel.path.length - 1;
      if (this.driveTravelWaypoint(
        waypoint.x,
        waypoint.y,
        lastWaypoint ? 180 : 165,
        lastWaypoint ? 28 : 24,
      )) {
        travel.pathIndex++;
        travel.waypointBest = Infinity;
        travel.waypointStallT = 0;
        if (travel.pathIndex >= travel.path.length) travel.phase = 'face';
      }
      return false;
    }

    if (travel.phase === 'face') {
      if (!this.faceAngle(portal.angle, 4)) return false;
      this.speed = 0;
      this.targetSpeed = 0;
      house.beginTransition?.(travel.targetRoomId, {
        fromRoomId: travel.fromRoomId,
        portalId: travel.portalId,
        duration: 0.9,
        robot: this,
      });
      if (!house.transition) {
        this.abortRoomTravel();
        return false;
      }
      travel.phase = 'cross';
      return false;
    }

    this.speed = 0;
    this.targetSpeed = 0;
    house.updateTransition?.(dt);
    this.syncRidingDog();
    if (house.transition) return false;

    // House.finishTransition() has placed the robot on the paired arrival
    // anchor and set roomId. Resume only after that atomic handoff is complete.
    return this.finishRoomTravel();
  }

  finishRoomTravel() {
    const travel = this.roomTravel;
    if (!travel) return true;
    this.roomTravel = null;
    this.targetRoomId = null;
    this.escape = null;
    this.bump = null;
    this.speed = 0;
    this.targetSpeed = 0;
    this.trailT = 0;
    this.lastX = this.x;
    this.lastY = this.y;
    this.syncRidingDog();

    if (travel.owner === 'state') {
      const resume = travel.resume ?? { state: 'clean' };
      this.cleanMode = resume.cleanMode ?? 'wander';
      this.modeTimer = resume.modeTimer ?? rand(6, 10);
      this.seekT = resume.seekT ?? 0;
      const seekStillHere = resume.seekDirt &&
        resume.seekDirt.roomId === this.roomId &&
        this.game.dirt.items.includes(resume.seekDirt) &&
        !resume.seekDirt.sucking;
      this.seekDirt = seekStillHere ? resume.seekDirt : null;
      const fateRoomId = resume.fateTarget?.roomId ?? travel.fromRoomId;
      this.fateTarget = resume.fateTarget && fateRoomId === this.roomId
        ? resume.fateTarget
        : null;
      this.state = resume.state === 'seek' && !seekStillHere ? 'clean' : resume.state;
      this.stateT = 0;
    }
    return true;
  }

  abortRoomTravel() {
    const travel = this.roomTravel;
    this.game.house?.cancelTransition?.();
    this.roomTravel = null;
    this.targetRoomId = null;
    this.targetSpeed = 0;
    this.speed = 0;
    this.lastX = this.x;
    this.lastY = this.y;
    this.syncRidingDog();
    if (travel?.owner === 'state') {
      this.state = travel.resume?.state ?? 'clean';
      this.stateT = 0;
    }
  }

  prepareDogForTravel() {
    const dog = this.game.dog;
    if (!dog || dog.roomId !== this.roomId || dog.state === 'ride') return;
    // A dog left behind must not continue a chase against a robot in another
    // room. Other dog activities remain exactly where they began.
    if (dog.state === 'chase') {
      dog.state = 'sit';
      dog.stateT = 0;
      dog.target = null;
      dog.chaseT = 0;
    }
  }

  syncRidingDog() {
    const dog = this.game.dog;
    if (!dog || dog.state !== 'ride') return;
    dog.roomId = this.roomId;
    dog.x = this.x;
    dog.y = this.y - 26;
  }

  roomHasChoreWork(roomId) {
    const room = this.game.house?.room?.(roomId);
    if (!room) return false;
    const hasFurniture = (name) => room.getFurniture?.(name) ??
      room.furniture?.find((item) => item.name === name);
    const items = this.game.dirt.items;
    const hasSock = hasFurniture('basket') && items.some((d) =>
      d.roomId === roomId && d.type === 'sock' && d.drop <= 0
    );
    const hasToy = hasFurniture('toybox') && items.some((d) =>
      d.roomId === roomId && (d.type === 'toy_ball' || d.type === 'toy_block') &&
      !d.toss && !d.fading
    );
    return !!(hasSock || hasToy);
  }

  roomHasRawPoop(roomId) {
    return this.game.dirt.items.some((item) =>
      item.roomId === roomId && item.type === 'poop' && item.drop <= 0 && item.age > 4
    );
  }

  bindFatePile(target = this.fateTarget) {
    if (!target) return null;
    if (target.pile && this.game.dirt.items.includes(target.pile)) return target.pile;
    const start = { x: this.x, y: this.y };
    const candidates = this.game.dirt.items.filter((item) =>
      item.roomId === (target.roomId ?? this.roomId) &&
      item.type === 'poop' && item.fated
    );
    let best = null;
    let bestDistance = Infinity;
    for (const pile of candidates) {
      const distance = pointSegmentDistanceSquared(pile, start, target);
      if (distance >= bestDistance) continue;
      best = pile;
      bestDistance = distance;
    }
    if (best) target.pile = best;
    return best;
  }

  clearFateTarget({ releasePile = true } = {}) {
    const pile = this.bindFatePile();
    if (releasePile && pile && this.game.dirt.items.includes(pile)) pile.fated = false;
    this.fateTarget = null;
  }

  otherCleaningWorkRoomId() {
    const house = this.game.house;
    if (!house?.rooms || this.roomHasChoreWork(this.roomId) || this.roomHasRawPoop(this.roomId)) {
      return null;
    }
    const now = this.game.time;
    for (const roomId of house.rooms.keys()) {
      if (roomId === this.roomId) continue;
      const hasVacuumWork = this.game.modeHasVac() && this.game.dirt.items.some((d) =>
        d.roomId === roomId && d.vac && !d.sucking && (!d.shunned || d.shunned <= now)
      );
      if (hasVacuumWork || this.roomHasChoreWork(roomId) || this.roomHasRawPoop(roomId)) {
        return roomId;
      }
    }
    return null;
  }

  goDock(reason) {
    const alreadyGoing = this.dockReason === reason &&
      (this.state === 'godock' || this.roomTravel?.resume?.state === 'godock');
    this.dockReason = reason;
    if (!alreadyGoing) {
      if (reason === 'battery') {
        this.setExpr('sleepy', 3);
        this.game.say('go_charge');
      } else if (reason === 'bin') {
        this.setExpr('full', 3);
        this.game.say('go_empty');
      } else {
        this.game.say('go_dock');
        this.game.sound.ackBeep();
      }
    }
    if (this.roomTravel) {
      // Finish a doorway crossing before redirecting. Its caller then resumes
      // in the normal docking state and routes home from whichever side won.
      if (this.roomTravel.owner === 'state') {
        this.roomTravel.resume = { ...this.roomTravel.resume, state: 'godock' };
      }
      return;
    }
    this.state = 'godock';
    this.seekDirt = null;
    this.bump = null;
  }

  summon() {
    // tapping the dock always means "go home and STAY until tapped awake"
    this.stayDocked = true;
    if (['docked', 'charge', 'empty', 'washpads', 'align'].includes(this.state)) return;
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
    } else if (this.state === 'travel' && this.dockReason === 'summon' && this.roomTravel) {
      // A crossing already in progress finishes safely, then resumes cleaning
      // instead of backing into the dock.
      this.roomTravel.resume = {
        ...this.roomTravel.resume,
        state: 'clean',
        seekDirt: null,
        fateTarget: null,
      };
    }
  }

  // the dog just declared a chase — startled hop, then scoot!
  onChased() {
    if (this.controlled) return;
    this.hop(180);
    this.setExpr('dizzy', 2);
    this.game.sound.questionBeep();
  }

  notifyNewDirt(d) {
    if (this.controlled) return;
    if (!this.game.modeHasVac()) return; // mop-only: crumbs aren't its job
    if ((d.roomId ?? this.roomId) !== this.roomId) return;
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
    const active = !['docked', 'charge', 'empty', 'washpads'].includes(this.state);
    if (active && !g.freezeBattery) {
      this.battery = clamp(this.battery - dt / 150, 0, 1);
      if (this.battery <= 0.16 && !this.controlled && !['godock', 'align', 'travel'].includes(this.state)) {
        this.goDock('battery');
      }
    }
    // full bin heads home no matter how it got full
    if (this.bin >= 1 && !this.controlled && ['clean', 'seek'].includes(this.state)) {
      this.goDock('bin');
    }

    if (!this.controlled) this.updateState(dt);

    // physics: move
    this.speed = damp(this.speed, this.targetSpeed, 6, dt);
    if (Math.abs(this.speed) > 2) {
      const nx = this.x + Math.cos(this.heading) * this.speed * dt;
      const ny = this.y + Math.sin(this.heading) * this.speed * dt;
      const dockingStates = ['align', 'docked', 'empty', 'charge', 'leaving'];
      const opts = {
        ignoreDock: dockingStates.includes(this.state) || this.state === 'godock' ||
          this.isRoomTraveling() || this.actionDockOk,
        ignoreCouch: this.allowUnderCouch === true,
      };
      const room = this.roomFor();
      if (room.isFree(nx, ny, R, opts)) {
        this.x = nx;
        this.y = ny;
      } else if (!room.isFree(this.x, this.y, R, opts)) {
        // already embedded in an obstacle (teleport/edge case) — let it
        // drive out instead of being pinned forever
        this.x = nx;
        this.y = ny;
      } else {
        const hit = room.collisionNormal(nx, ny, R, opts);
        this.onBump(hit);
      }
    }

    // suction (a truly full bin can't hold any more; mop-only never vacuums)
    this.suctionOn = (['clean', 'seek', 'leaving'].includes(this.state) ||
      (this.state === 'action' && this.actionSuction === true)) && this.bin < 0.999 && g.modeHasVac();
    if (this.suctionOn && Math.abs(this.speed) > 10) {
      g.dirt.trySuck(this);
    }

    // hum follows motion
    if (g.sound.ready) {
      if (this.suctionOn || ['godock', 'travel', 'action'].includes(this.state)) {
        g.sound.startHum();
        g.sound.setHumIntensity(clamp(Math.abs(this.speed) / 170, 0.15, 1.6));
      } else {
        g.sound.setHumIntensity(0.05);
        if (['docked', 'charge', 'empty', 'washpads'].includes(this.state)) g.sound.stopHum();
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

    // dirty wheels stamp smears along both wheel tracks while oblivious
    if (this.smearT > 0) {
      this.smearRoomId ??= this.roomId;
      this.smearT -= dt;
      const sp = Math.abs(this.speed);
      if (sp > 20 && this.z <= 0) {
        this.smearDist += sp * dt;
        if (this.smearDist > 24) {
          this.smearDist = 0;
          const px = Math.cos(this.heading + Math.PI / 2);
          const py = Math.sin(this.heading + Math.PI / 2);
          for (const side of [-1, 1]) {
            g.smears.stamp(
              this.x + px * 33 * side,
              this.y + py * 33 * side,
              this.heading,
              { roomId: this.roomId },
            );
          }
          if (chance(0.2)) {
            g.smears.stamp(
              this.x + rand(-16, 16),
              this.y + rand(-16, 16),
              this.heading,
              { roomId: this.roomId },
            );
          }
        }
      }
      if (this.smearT <= 0) {
        if (g.actions.current?.name !== 'mopMode') {
          g.pendingMop = true; // the awful realization comes next
          g.pendingMopRoomId = this.smearRoomId ?? this.roomId;
        }
        this.smearRoomId = null;
      }
    }

    // trail recording
    if (this.trailMode && this.roomTravel?.phase !== 'cross') {
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.024;
        this.trail.push({
          x: this.x,
          y: this.y,
          roomId: this.roomId,
          age: 0,
          hue: this.rainbowHue,
        });
        this.rainbowHue = (this.rainbowHue + 9) % 360;
      }
    }
    const trailLife = this.trailMode === 'turbo' ? 0.5 : this.trailMode === 'mop' ? 3.2 : 1.6;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].age += dt;
      if (this.trail[i].age > trailLife) this.trail.splice(i, 1);
    }

    // stuck detection for nav states (incl. actions driving via driveTo)
    if (!this.isRoomTraveling() && ['godock', 'seek', 'action'].includes(this.state)) {
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
        // bin full + bag full: stuck until a human empties the bag
        if (this.waitingForBag) {
          if (!g.dock.needsBag()) {
            this.waitingForBag = false;
            // 'empty' is still at the front of the plan — resume it
            this.nextDockTask();
          } else {
            this.announceT -= dt;
            if (this.announceT <= 0) {
              this.announceT = 26;
              g.say('bag_full');
              g.sound.errorBuzz();
            }
          }
          break;
        }
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
        // the dock needs a human (bag full / water tanks) → REFUSE to head
        // out: sit here blinking red until somebody services it
        if (g.dock.anyAlert()) {
          if (!this.blockBuzzed) {
            this.blockBuzzed = true;
            g.sound.errorBuzz();
            g.dock.beacon = 1.2;
            this.setExpr('full', 3);
          }
          break;
        }
        this.blockBuzzed = false;
        this.dockedUndockT -= dt;
        if (this.dockedUndockT <= 0) {
          this.state = 'leaving';
          this.stateT = 0;
          g.sound.undockChime();
          g.say('start_clean');
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
      case 'travel': {
        this.updateRoomTravel(dt);
        break;
      }
      case 'seek': {
        if (!this.seekDirt || this.seekDirt.roomId !== this.roomId ||
            this.seekDirt.sucking || !g.dirt.items.includes(this.seekDirt)) {
          const player = g.dirt.nearestVac(this.x, this.y, true, this.roomId);
          const localWork = g.dirt.nearestVac(this.x, this.y, false, this.roomId);
          const next = player || (chance(0.5) ? localWork : null);
          if (next && dist(this.x, this.y, next.x, next.y) < 900) {
            this.seekDirt = next;
            this.seekT = 0;
          } else {
            this.seekDirt = null;
            this.state = 'clean';
            this.cleanMode = 'wander';
            this.modeTimer = rand(6, 11);
            if (!localWork) {
              const otherRoomId = this.otherCleaningWorkRoomId();
              if (otherRoomId) this.requestRoom(otherRoomId, 'cleaning');
            }
            break;
          }
        }
        // Follow a collision-checked route until the suction mouth is on the
        // target's side of the furniture. Route progress does not consume the
        // short final-approach timeout.
        if (this.followSeekPath(this.seekDirt, dt)) {
          this.seekT = 0;
          break;
        }
        // A moving speck or an unusually tight final approach can still fail;
        // real robots eventually shrug and try something else.
        this.seekT += dt;
        if (this.seekT > 8) {
          this.seekDirt.shunned = g.time + 30;
          this.seekDirt = null;
          this.clearSeekPath();
          this.seekT = 0;
          g.sound.questionBeep();
          this.setExpr('dizzy', 1.2);
          break;
        }
        this.driveTo(this.seekDirt.x, this.seekDirt.y, 175, 20);
        break;
      }
      case 'godock': {
        if (this.roomId !== g.dock.roomId) {
          this.requestRoom(g.dock.roomId, 'dock');
          break;
        }
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
        // dust streams into the bag, which visibly fills
        g.dock.bagFill = clamp(g.dock.bagFill + dt * (0.2 / 3.0), 0, 1);
        if (this.stateT > 3.0) {
          this.bin = 0;
          g.sound.dockChime();
          g.particles.sparkle(g.dock.x, g.dock.spriteTop + 60, 12);
          this.nextDockTask();
        } else {
          this.bin = Math.max(0, this.bin - dt / 2.8);
        }
        break;
      }
      case 'washpads': {
        // pads scrubbing at the dock (undercarriage cam is showing it all)
        this.targetSpeed = 0;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 4.6), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 4.6), 0, 1);
        if (g.cutaway.done) {
          g.mopDirt = 0;
          g.cutaway.dismiss();
          g.sound.ackBeep();
          g.particles.sparkle(this.x, this.y - 40, 8);
          this.nextDockTask();
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
          g.say('charge_done');
          g.particles.burst(this.x, this.y - 40, 'star', 14, { colors: ['#7ef29d', '#c5ffd9', '#fff'], speedMin: 60, speedMax: 200, lifeMin: 0.5, lifeMax: 1 });
          this.setExpr('happy', 2);
          this.nextDockTask();
        }
        break;
      }
    }
  }

  updateClean(dt) {
    const g = this.game;
    const dogHere = g.dog?.roomId === this.roomId;
    // being chased overrides fancy patterns — just RUN (in a fun way)
    if (dogHere && g.dog.state === 'chase' && this.cleanMode !== 'wander') {
      this.cleanMode = 'wander';
      this.modeTimer = rand(4, 7);
    }
    // "fate" waypoint: looks like ordinary cleaning, happens to pass through
    // whatever the dog left on the floor
    if (this.fateTarget) {
      if (this.fateTarget.roomId && this.fateTarget.roomId !== this.roomId) {
        this.clearFateTarget();
      }
    }
    if (this.fateTarget) {
      const pile = this.bindFatePile();
      if (this.driveTo(this.fateTarget.x, this.fateTarget.y, 145, 30)) {
        if (pile && this.game.dirt.items.includes(pile) && !this.fateTarget.finalApproach) {
          // Local obstacle avoidance can reach the authored point beyond a
          // pile while skirting the actual mess. Keep ownership of that exact
          // pile and make its center the final approach. Arriving within 30px
          // necessarily crosses the game's wider splat radius while moving.
          this.fateTarget.x = pile.x;
          this.fateTarget.y = pile.y;
          this.fateTarget.finalApproach = true;
          this.bump = null;
          this.escape = null;
        } else {
          this.clearFateTarget();
        }
      }
      return;
    }
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

    // chance to notice dirt nearby (mop-only ignores vacuumable dirt)
    this.seekCheckT -= dt;
    if (this.seekCheckT <= 0) {
      this.seekCheckT = 1.4;
      let localWork = null;
      if (g.modeHasVac()) {
        const player = g.dirt.nearestVac(this.x, this.y, true, this.roomId);
        const target = player || g.dirt.nearestVac(this.x, this.y, false, this.roomId);
        localWork = target;
        if (target) {
          const d = dist(this.x, this.y, target.x, target.y);
          if (player || (d < 460 && chance(0.55))) {
            this.seekDirt = target;
            this.state = 'seek';
            return;
          }
        }
      }
      if (!localWork) {
        const otherRoomId = this.otherCleaningWorkRoomId();
        if (otherRoomId && this.requestRoom(otherRoomId, 'cleaning')) return;
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
      case 'wander': {
        const dog = g.dog;
        if (dogHere && dog.state === 'chase') {
          // yipes — scoot away from the pup! (bump recovery still applies,
          // so fleeing into a wall stays a comedy, not a clip-through)
          if (dist(this.x, this.y, dog.x, dog.y) < 340) {
            const flee = angleTo(dog.x, dog.y, this.x, this.y);
            this.heading = angleApproach(this.heading, flee, 2.6 * dt);
          }
          this.targetSpeed = 200;
        } else {
          this.targetSpeed = 135;
        }
        break;
      }
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
        const b = this.roomFor().bounds;
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
        // bumping the dog!
        const dog = g.dog;
        if (dog && dog.roomId === this.roomId &&
            dist(this.x, this.y, dog.x, dog.y) < R + 55 && dog.state !== 'ride') {
          dog.startle();
        }
      }
    } else if (['seek', 'godock', 'travel', 'leaving', 'action'].includes(this.state)) {
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
    // every return services whatever's equipped, in the order the real one
    // does it: empty the bin, wash the pads, then charge
    this.dockPlan = [];
    if (this.bin > 0.12 || this.dockReason === 'bin') this.dockPlan.push('empty');
    if (this.mopMode && g.mopDirt > 0.1) this.dockPlan.push('wash');
    if (this.battery < 0.95) this.dockPlan.push('charge');
    this.nextDockTask();
  }

  // run the next service in the dock plan (or settle in)
  nextDockTask() {
    const g = this.game;
    while (this.dockPlan && this.dockPlan.length) {
      const task = this.dockPlan.shift();
      if (task === 'empty') {
        if (g.dock.needsBag()) {
          // can't auto-empty into a full bag — wait for a human, then retry
          this.dockPlan.unshift('empty');
          this.state = 'docked';
          this.stateT = 0;
          this.waitingForBag = true;
          this.announceT = 24;
          this.setExpr('full', 4);
          g.say('bag_full');
          g.sound.errorBuzz();
          return;
        }
        this.state = 'empty';
        this.stateT = 0;
        g.say('emptying');
        g.sound.emptyRoar(3.0);
        this.setExpr('effort', 3);
        return;
      }
      if (task === 'wash') {
        if (!g.dock.canMop()) {
          // no water service — complain, pads stay dirty, carry on
          g.say(g.dock.needsClean() ? 'clean_empty' : 'dirty_full');
          g.sound.errorBuzz();
          g.mopComplained = true;
          continue;
        }
        this.state = 'washpads';
        this.stateT = 0;
        g.cutaway.show('wash');
        g.say('washing');
        this.setExpr('effort', 3);
        return;
      }
      if (task === 'charge') {
        if (this.battery >= 0.95) continue;
        this.state = 'charge';
        this.stateT = 0;
        this.chargeBlipLevel = Math.floor(this.battery * 5);
        return;
      }
    }
    this.state = 'docked';
    this.stateT = 0;
    this.dockedUndockT = 1.5;
    this.setExpr('happy', 1.4);
  }

  // ---- drawing ------------------------------------------------------------

  drawTrail(ctx) {
    if (!this.trail.length) return;
    const activeRoomId = this.game.house?.activeRoomId ?? this.roomId;
    if (this.trailMode === 'rainbow') {
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const q = this.trail[i - 1];
        if (p.roomId !== activeRoomId || q.roomId !== activeRoomId) continue;
        const a = clamp(1 - p.age / 1.6, 0, 1);
        ctx.strokeStyle = `hsla(${p.hue}, 85%, 62%, ${a * 0.85})`;
        ctx.lineWidth = 34 * a + 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    } else if (this.trailMode === 'mop') {
      // glistening freshly-mopped streak that slowly evaporates
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        const q = this.trail[i - 1];
        if (p.roomId !== activeRoomId || q.roomId !== activeRoomId) continue;
        const t = clamp(1 - p.age / 3.2, 0, 1);
        // holds wet for a while, then dries out
        const a = t > 0.55 ? 1 : t / 0.55;
        ctx.strokeStyle = `rgba(160, 220, 255, ${a * 0.32})`;
        ctx.lineWidth = 46 + 8 * t;
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
        if (p.roomId !== activeRoomId || q.roomId !== activeRoomId) continue;
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
    if (this.trapped) return 'dizzy';
    if (this.state === 'charge') return 'charge';
    if (this.state === 'empty' || this.state === 'washpads') return 'effort';
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

    if (this.mopMode) this.drawMopPad(ctx);
    this.drawFaceAndLights(ctx);
    ctx.restore();

    // battery gauge lives ON the robot — always upright, under the turret
    this.drawBattery(ctx);

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

  drawBattery(ctx) {
    const level = this.battery;
    const charging = this.state === 'charge';
    const low = level < 0.22 && !charging;
    const blink = low ? 0.5 + 0.5 * Math.abs(Math.sin(this.game.time * 6)) : 1;
    ctx.save();
    ctx.translate(this.x, this.y - this.z + R * 0.56);
    // dark backing plate so the gauge reads over any shell art or rotation
    ctx.fillStyle = 'rgba(24, 30, 41, 0.92)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2.5;
    roundRect(ctx, -27, -12, 54, 24, 9);
    ctx.fill();
    ctx.stroke();
    // battery tip nub
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    roundRect(ctx, 28, -5, 5, 10, 2.5);
    ctx.fill();
    // the cell
    const col = charging ? '#7ef29d' : level > 0.5 ? '#69d96e' : level > 0.22 ? '#ffb42e' : '#ff5d5d';
    ctx.globalAlpha = blink;
    ctx.fillStyle = col;
    roundRect(ctx, -22, -7, Math.max(4, 44 * level), 14, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    // charging bolt flashes on the gauge itself
    if (charging) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.game.time * 10);
      drawBolt(ctx, 0, 0, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawMopPad(ctx) {
    // deployed mop pad at the rear — clean blue when fresh, grubby as it soils
    const y0 = R * 0.44;
    const h = R * 0.44;
    const dirt = clamp((this.game.mopDirt ?? 0) * 0.75, 0, 1);
    // base: #cfeaff (207,234,255) -> grubby #a98b5f (169,139,95)
    const br = Math.round(lerp(207, 169, dirt));
    const bg = Math.round(lerp(234, 139, dirt));
    const bb = Math.round(lerp(255, 95, dirt));
    ctx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
    roundRect(ctx, -36, y0, 72, h, 11);
    ctx.fill();
    // stripes: rgba(90,165,225,0.55) -> grubby rgba(122,90,56,0.6)
    const sr = Math.round(lerp(90, 122, dirt));
    const sg = Math.round(lerp(165, 90, dirt));
    const sb = Math.round(lerp(225, 56, dirt));
    const sa = lerp(0.55, 0.6, dirt);
    ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${sa})`;
    for (let i = 0; i < 3; i++) {
      roundRect(ctx, -29 + i * 22, y0 + 5, 12, h - 10, 5);
      ctx.fill();
    }
    ctx.globalAlpha = 0.45 + 0.3 * Math.sin(this.wobbleT * 6);
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, -30, y0 + 3, 60, 5, 2.5);
    ctx.fill();
    ctx.globalAlpha = 1;
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
    const distress = this.trapped || this.dockAlerted();
    const trapBlink = Math.sin(this.wobbleT * 8) > 0;
    const ringColor =
      distress ? (trapBlink ? '#ff3b30' : '#6b1712')
      : this.mopMode ? '#48b6ff'
      : this.state === 'charge' ? '#7ef29d'
      : this.bin > 0.88 ? '#ffb42e'
      : this.state === 'action' ? '#ff5d8f'
      : '#4cc9f0';
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = distress ? 5 : 3;
    ctx.globalAlpha = distress ? (trapBlink ? 1 : 0.4) : 0.65 + 0.35 * Math.sin(this.wobbleT * 3);
    ctx.beginPath();
    ctx.arc(0, -2, 28, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (distress && trapBlink) {
      // the status LED itself, blazing red so the SOS reads from anywhere
      ctx.fillStyle = '#ff3b30';
      ctx.shadowColor = 'rgba(255, 60, 40, 0.95)';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(0, -20, 5.5, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
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

function axisValues(min, max, spacing, extras = []) {
  const values = [];
  for (let value = min; value <= max + 0.1; value += spacing) values.push(value);
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
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-12) return (point.x - a.x) ** 2 + (point.y - a.y) ** 2;
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1);
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
