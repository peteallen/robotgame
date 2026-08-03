// Two-room world ownership and the small amount of state needed to cross a
// doorway. Rooms continue to use the original fixed 1680x1050 coordinate
// system, so adding a room does not turn every existing interaction into a
// camera calculation.
import { clamp, lerp } from '../core/math.js';
import { Room, WORLD_W, WORLD_H } from './Room.js';
import { KitchenRoom } from './KitchenRoom.js';

const DEFAULT_TRANSITION_SECONDS = 0.78;

export class House {
  constructor(game, { activeRoomId = 'living' } = {}) {
    this.game = game;
    this.rooms = new Map();
    this.rooms.set('living', new Room(game));
    this.rooms.set('kitchen', new KitchenRoom(game));

    this.activeRoomId = this.rooms.has(activeRoomId) ? activeRoomId : 'living';
    this.transition = null;
    this.lastTransition = null;
    this.syncGameRoom();
  }

  get activeRoom() {
    return this.room(this.activeRoomId);
  }

  get roomIds() {
    return [...this.rooms.keys()];
  }

  get roomList() {
    return [...this.rooms.values()];
  }

  get transitionProgress() {
    return this.transition?.progress ?? 0;
  }

  room(id) {
    if (id && typeof id === 'object' && id.id) return this.rooms.get(id.id) || null;
    return this.rooms.get(id) || null;
  }

  hasRoom(id) {
    return this.rooms.has(id);
  }

  activate(id) {
    const next = this.room(id);
    if (!next) return null;
    this.activeRoomId = next.id;
    this.syncGameRoom();
    return next;
  }

  syncGameRoom() {
    if (this.game) this.game.room = this.activeRoom;
  }

  portal(fromRoomId = this.activeRoomId, idOrTargetRoomId = null) {
    const source = this.room(fromRoomId);
    return source?.portal(idOrTargetRoomId) || null;
  }

  connectedRoomId(fromRoomId = this.activeRoomId, portalId = null) {
    return this.portal(fromRoomId, portalId)?.targetRoomId ?? null;
  }

  pairedPortal(fromRoomId = this.activeRoomId, idOrTargetRoomId = null) {
    const sourcePortal = this.portal(fromRoomId, idOrTargetRoomId);
    if (!sourcePortal) return null;
    const targetRoom = this.room(sourcePortal.targetRoomId);
    if (!targetRoom) return null;
    return targetRoom.portal(sourcePortal.targetPortalId)
      || targetRoom.portals.find((item) => item.targetRoomId === fromRoomId)
      || null;
  }

  connection(fromRoomId = this.activeRoomId, toRoomId = null) {
    const fromRoom = this.room(fromRoomId);
    if (!fromRoom) return null;
    const fromPortal = fromRoom.portal(toRoomId);
    if (!fromPortal) return null;
    const toRoom = this.room(fromPortal.targetRoomId);
    const toPortal = this.pairedPortal(fromRoom.id, fromPortal.id);
    if (!toRoom || !toPortal) return null;
    return {
      fromRoom,
      toRoom,
      fromRoomId: fromRoom.id,
      toRoomId: toRoom.id,
      fromPortal,
      toPortal,
      approach: fromPortal.approach,
      threshold: fromPortal.threshold,
      departureExit: fromPortal.exit,
      arrivalEntry: toPortal.entry,
      arrival: toPortal.arrival,
      direction: fromPortal.side === 'right' ? 1 : -1,
    };
  }

  beginTransition(toRoomId, {
    fromRoomId = this.activeRoomId,
    portalId = null,
    duration = DEFAULT_TRANSITION_SECONDS,
    robot = null,
  } = {}) {
    if (this.transition) return null;
    const route = portalId
      ? this.connectionFromPortal(fromRoomId, portalId)
      : this.connection(fromRoomId, toRoomId);
    if (!route || route.toRoomId !== toRoomId) return null;

    const seconds = Math.max(0.1, Number.isFinite(duration) ? duration : DEFAULT_TRANSITION_SECONDS);
    this.transition = {
      id: `${route.fromRoomId}:${route.fromPortal.id}->${route.toRoomId}:${route.toPortal.id}`,
      fromRoomId: route.fromRoomId,
      toRoomId: route.toRoomId,
      fromPortalId: route.fromPortal.id,
      toPortalId: route.toPortal.id,
      fromPortal: route.fromPortal,
      toPortal: route.toPortal,
      elapsed: 0,
      duration: seconds,
      progress: 0,
      phase: 'departing',
      switched: false,
      completed: false,
      robot,
    };
    this.lastTransition = null;
    if (robot) robot.roomId = route.fromRoomId;
    return this.transition;
  }

  connectionFromPortal(fromRoomId, portalId) {
    const fromPortal = this.portal(fromRoomId, portalId);
    return fromPortal ? this.connection(fromRoomId, fromPortal.targetRoomId) : null;
  }

  updateTransition(dt) {
    const transition = this.transition;
    if (!transition) return null;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + Math.max(0, dt || 0));
    transition.progress = clamp(transition.elapsed / transition.duration, 0, 1);
    transition.phase = transition.progress < 0.44
      ? 'departing'
      : transition.progress < 0.56
        ? 'crossing'
        : transition.progress < 1
          ? 'arriving'
          : 'complete';

    if (!transition.switched && transition.progress >= 0.5) {
      transition.switched = true;
      this.activate(transition.toRoomId);
    }

    if (transition.robot) this.applyTransitionPose(transition.robot, transition.progress);
    if (transition.progress >= 1) return this.finishTransition();
    return transition;
  }

  transitionPose(progress = this.transitionProgress) {
    const transition = this.transition;
    if (!transition) return null;
    const p = clamp(progress, 0, 1);
    if (p < 0.5) {
      const local = p / 0.5;
      return {
        roomId: transition.fromRoomId,
        x: lerp(transition.fromPortal.approach.x, transition.fromPortal.exit.x, local),
        y: lerp(transition.fromPortal.approach.y, transition.fromPortal.exit.y, local),
        angle: transition.fromPortal.angle,
        visible: p < 0.47,
        phase: p < 0.44 ? 'departing' : 'crossing',
      };
    }

    const local = (p - 0.5) / 0.5;
    const inwardAngle = normalizeAngle(transition.toPortal.angle + Math.PI);
    return {
      roomId: transition.toRoomId,
      x: lerp(transition.toPortal.exit.x, transition.toPortal.arrival.x, local),
      y: lerp(transition.toPortal.exit.y, transition.toPortal.arrival.y, local),
      angle: inwardAngle,
      visible: p > 0.53,
      phase: p < 0.56 ? 'crossing' : p < 1 ? 'arriving' : 'complete',
    };
  }

  applyTransitionPose(robot, progress = this.transitionProgress) {
    const pose = this.transitionPose(progress);
    if (!robot || !pose) return pose;
    robot.roomId = pose.roomId;
    robot.x = pose.x;
    robot.y = pose.y;
    robot.heading = pose.angle;
    return pose;
  }

  finishTransition() {
    const transition = this.transition;
    if (!transition) return this.activeRoom;
    transition.elapsed = transition.duration;
    transition.progress = 1;
    transition.phase = 'complete';
    transition.switched = true;
    transition.completed = true;
    this.activate(transition.toRoomId);
    if (transition.robot) this.applyTransitionPose(transition.robot, 1);
    this.lastTransition = transition;
    this.transition = null;
    return transition;
  }

  cancelTransition({ restoreFromRoom = true } = {}) {
    const transition = this.transition;
    if (!transition) return null;
    if (restoreFromRoom) {
      this.activate(transition.fromRoomId);
      if (transition.robot) {
        transition.robot.roomId = transition.fromRoomId;
        transition.robot.x = transition.fromPortal.approach.x;
        transition.robot.y = transition.fromPortal.approach.y;
        transition.robot.heading = transition.fromPortal.angle;
      }
    }
    transition.phase = 'cancelled';
    transition.completed = false;
    this.lastTransition = transition;
    this.transition = null;
    return transition;
  }

  transitionFrame(progress = this.transitionProgress) {
    const transition = this.transition;
    if (!transition) {
      return {
        progress: 0,
        roomId: this.activeRoomId,
        room: this.activeRoom,
        offsetX: 0,
        sceneScale: 1,
        alpha: 1,
        overlayAlpha: 0,
      };
    }
    const p = clamp(progress, 0, 1);
    const showingDestination = p >= 0.5;
    const local = showingDestination ? (p - 0.5) * 2 : p * 2;
    const direction = transition.fromPortal.side === 'right' ? 1 : -1;
    const roomId = showingDestination ? transition.toRoomId : transition.fromRoomId;
    const offsetX = showingDestination
      ? direction * (1 - local) * WORLD_W * 0.035
      : -direction * local * WORLD_W * 0.035;
    return {
      progress: p,
      phase: transition.phase,
      roomId,
      room: this.room(roomId),
      // A very small pan reinforces direction without introducing a camera
      // system or moving tap coordinates. The matching cover scale keeps that
      // pan from exposing the dark canvas along its entering edge.
      offsetX,
      sceneScale: 1 + (Math.abs(offsetX) * 2 + 4) / WORLD_W,
      alpha: showingDestination ? 0.7 + local * 0.3 : 1 - local * 0.3,
      overlayAlpha: Math.sin(p * Math.PI) * 0.76,
      direction,
    };
  }

  drawTransition(ctx, drawRoom) {
    if (typeof drawRoom !== 'function') return this.transitionFrame();
    const frame = this.transitionFrame();
    ctx.save();
    // Keep the cover zoom inside the fixed game viewport. Wide phone screens
    // retain their intentional pillar-box bars while the room itself pans.
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
    ctx.translate(frame.offsetX, 0);
    if (frame.sceneScale !== 1) {
      ctx.translate(WORLD_W / 2, WORLD_H / 2);
      ctx.scale(frame.sceneScale, frame.sceneScale);
      ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
    }
    ctx.globalAlpha = frame.alpha;
    drawRoom(frame.room, ctx, frame);
    ctx.restore();

    if (frame.overlayAlpha > 0) {
      const wash = ctx.createLinearGradient(0, 0, WORLD_W, 0);
      if (frame.direction < 0) {
        wash.addColorStop(0, `rgba(47,35,48,${frame.overlayAlpha})`);
        wash.addColorStop(0.55, `rgba(99,77,81,${frame.overlayAlpha * 0.44})`);
        wash.addColorStop(1, 'rgba(47,35,48,0)');
      } else {
        wash.addColorStop(0, 'rgba(47,35,48,0)');
        wash.addColorStop(0.45, `rgba(99,77,81,${frame.overlayAlpha * 0.44})`);
        wash.addColorStop(1, `rgba(47,35,48,${frame.overlayAlpha})`);
      }
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }
    return frame;
  }
}

function normalizeAngle(angle) {
  let value = angle % (Math.PI * 2);
  if (value > Math.PI) value -= Math.PI * 2;
  if (value < -Math.PI) value += Math.PI * 2;
  return value;
}

export default House;
