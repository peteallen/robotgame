// A tiny, wordless house map. It lives in world coordinates so it scales with
// the rest of the tablet-first HUD.
import { TAU, clamp, lerp } from '../core/math.js';
import { roundRect } from '../world/Room.js';
import {
  MINIMAP_BOUNDS,
  MINIMAP_SAFE_BOTTOM_PX,
  minimapVerticalOffset,
  minimapVerticalOffsetForGame,
} from './minimapLayout.js';

export { MINIMAP_BOUNDS, MINIMAP_SAFE_BOTTOM_PX, minimapVerticalOffset };

const ROOM_TILES = Object.freeze({
  living: Object.freeze({ x: 1360, y: 886, w: 124, h: 122 }),
  kitchen: Object.freeze({ x: 1514, y: 886, w: 124, h: 122 }),
});

const ROOM_IDS = ['living', 'kitchen'];

export class Minimap {
  constructor(game) {
    this.game = game;
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
  }

  verticalOffset() {
    return minimapVerticalOffsetForGame(this.game);
  }

  // The entire card is protected from floor/furniture interactions, including
  // the connector and padding between the two room buttons.
  hitTest(x, y) {
    const b = MINIMAP_BOUNDS;
    const offsetY = this.verticalOffset();
    return x >= b.x && x <= b.x + b.w &&
      y >= b.y + offsetY && y <= b.y + offsetY + b.h;
  }

  // Pointer-down capture is intentionally side-effect free. The corresponding
  // short tap performs navigation through onTap().
  onPointerDown(x, y) {
    return this.hitTest(x, y);
  }

  onTap(x, y) {
    if (!this.hitTest(x, y)) return false;

    const targetRoomId = this.roomAt(x, y);
    if (targetRoomId && typeof this.game.requestRoom === 'function') {
      // The house controller owns all travel and home-return behavior. In
      // particular, choosing the living room while away requests the route
      // back to the robot's home room rather than teleporting it.
      this.game.requestRoom(targetRoomId, 'map');
    }
    return true;
  }

  roomAt(x, y) {
    const offsetY = this.verticalOffset();
    for (const roomId of ROOM_IDS) {
      const b = ROOM_TILES[roomId];
      if (x >= b.x && x <= b.x + b.w &&
          y >= b.y + offsetY && y <= b.y + offsetY + b.h) return roomId;
    }
    return null;
  }

  draw(ctx) {
    const b = MINIMAP_BOUNDS;
    const transition = this.readTransition();
    const activeRoomId = this.activeRoomId();
    const destinationRoomId = transition?.toRoomId ?? this.destinationRoomId();

    ctx.save();
    ctx.translate(0, this.verticalOffset());
    ctx.shadowColor = 'rgba(72, 48, 22, 0.2)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = 'rgba(255, 252, 245, 0.94)';
    ctx.strokeStyle = 'rgba(90, 60, 20, 0.24)';
    ctx.lineWidth = 4;
    roundRect(ctx, b.x, b.y, b.w, b.h, 30);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.stroke();

    // A quiet inner highlight gives the card the same softly molded look as
    // the existing cream controls.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 2;
    roundRect(ctx, b.x + 7, b.y + 7, b.w - 14, b.h - 14, 24);
    ctx.stroke();

    this.drawConnector(ctx);
    this.drawRoomTile(ctx, 'living', activeRoomId, destinationRoomId);
    this.drawRoomTile(ctx, 'kitchen', activeRoomId, destinationRoomId);
    this.drawRobotMarker(ctx, activeRoomId, transition);
    ctx.restore();
  }

  activeRoomId() {
    return this.game.robot?.roomId
      ?? this.game.house?.activeRoomId
      ?? this.game.room?.id
      ?? 'living';
  }

  destinationRoomId() {
    const house = this.game.house;
    return house?.destinationRoomId
      ?? house?.targetRoomId
      ?? house?.requestedRoomId
      ?? this.game.robot?.targetRoomId
      ?? null;
  }

  readTransition() {
    const house = this.game.house;
    const raw = house?.transition;
    if (!raw) return null;

    const fromRoomId = raw.fromRoomId ?? raw.fromId ?? raw.from ?? this.activeRoomId();
    const toRoomId = raw.toRoomId ?? raw.toId ?? raw.to ?? this.destinationRoomId();
    if (!ROOM_TILES[fromRoomId] || !ROOM_TILES[toRoomId]) return null;

    let progress = raw.progress;
    if (!Number.isFinite(progress)) progress = house.transitionProgress;
    if (!Number.isFinite(progress) && Number.isFinite(raw.elapsed) && raw.duration > 0) {
      progress = raw.elapsed / raw.duration;
    }

    return {
      fromRoomId,
      toRoomId,
      progress: clamp(Number.isFinite(progress) ? progress : 0, 0, 1),
    };
  }

  drawConnector(ctx) {
    const left = ROOM_TILES.living;
    const right = ROOM_TILES.kitchen;
    const y = this.markerPoint('living').y;
    const x1 = left.x + left.w - 4;
    const x2 = right.x + 4;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(87, 72, 62, 0.32)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 10;
    ctx.stroke();

    // The two upright marks make the connection read as a doorway, rather
    // than just decorative lines between cards.
    const mid = (x1 + x2) / 2;
    ctx.strokeStyle = '#74675d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mid - 7, y - 12);
    ctx.lineTo(mid - 7, y + 12);
    ctx.moveTo(mid + 7, y - 12);
    ctx.lineTo(mid + 7, y + 12);
    ctx.stroke();
    ctx.restore();
  }

  drawRoomTile(ctx, roomId, activeRoomId, destinationRoomId) {
    const b = ROOM_TILES[roomId];
    const active = roomId === activeRoomId;
    const destination = roomId === destinationRoomId && roomId !== activeRoomId;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);

    ctx.save();
    if (active || destination) {
      ctx.shadowColor = active ? 'rgba(42, 183, 166, 0.58)' : 'rgba(255, 171, 57, 0.58)';
      ctx.shadowBlur = active ? 13 : 10 + pulse * 7;
    }
    ctx.fillStyle = roomId === 'living' ? '#f5dfbd' : '#dcefe6';
    ctx.strokeStyle = active ? '#239d91' : '#8b7662';
    ctx.lineWidth = active ? 6 : 3;
    roundRect(ctx, b.x, b.y, b.w, b.h, 22);
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';

    // Active is a solid double frame; destination is a pulsing dashed frame.
    // Shape and line treatment carry the state even without relying on color.
    if (active) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2.5;
      roundRect(ctx, b.x + 8, b.y + 8, b.w - 16, b.h - 16, 15);
      ctx.stroke();
      this.drawActiveTabs(ctx, b);
    } else if (destination) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.66 + pulse * 0.3})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 7]);
      roundRect(ctx, b.x + 6, b.y + 6, b.w - 12, b.h - 12, 17);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (roomId === 'living') this.drawSofa(ctx, b.x + b.w / 2, b.y + 49);
    else this.drawKitchen(ctx, b.x + b.w / 2, b.y + 48);
    ctx.restore();
  }

  drawActiveTabs(ctx, b) {
    ctx.fillStyle = '#239d91';
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    roundRect(ctx, cx - 15, b.y - 4, 30, 8, 4);
    ctx.fill();
    roundRect(ctx, cx - 15, b.y + b.h - 4, 30, 8, 4);
    ctx.fill();
    roundRect(ctx, b.x - 4, cy - 15, 8, 30, 4);
    ctx.fill();
    roundRect(ctx, b.x + b.w - 4, cy - 15, 8, 30, 4);
    ctx.fill();
  }

  drawSofa(ctx, cx, cy) {
    ctx.save();
    ctx.fillStyle = '#ef826f';
    ctx.strokeStyle = '#5e514b';
    ctx.lineWidth = 3;
    roundRect(ctx, cx - 39, cy - 22, 78, 35, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f39a83';
    roundRect(ctx, cx - 34, cy - 4, 68, 29, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#dc6f60';
    roundRect(ctx, cx - 45, cy - 8, 15, 32, 7);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, cx + 30, cy - 8, 15, 32, 7);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 27, cy + 24);
    ctx.lineTo(cx - 29, cy + 30);
    ctx.moveTo(cx + 27, cy + 24);
    ctx.lineTo(cx + 29, cy + 30);
    ctx.stroke();
    ctx.restore();
  }

  drawKitchen(ctx, cx, cy) {
    ctx.save();
    ctx.strokeStyle = '#53605a';
    ctx.lineWidth = 3;

    // Rounded refrigerator with a visible split and handles.
    ctx.fillStyle = '#f9faf5';
    roundRect(ctx, cx - 43, cy - 29, 38, 62, 8);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 42, cy - 5);
    ctx.lineTo(cx - 6, cy - 5);
    ctx.moveTo(cx - 14, cy - 20);
    ctx.lineTo(cx - 14, cy - 10);
    ctx.moveTo(cx - 14, cy + 3);
    ctx.lineTo(cx - 14, cy + 14);
    ctx.stroke();

    // Mint counter, pale worktop, and two cupboard pulls.
    ctx.fillStyle = '#75c7b2';
    roundRect(ctx, cx + 1, cy - 8, 45, 41, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffe8b2';
    roundRect(ctx, cx - 3, cy - 13, 53, 11, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#53605a';
    ctx.beginPath();
    ctx.arc(cx + 13, cy + 9, 2.5, 0, TAU);
    ctx.arc(cx + 34, cy + 9, 2.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  markerPoint(roomId) {
    const b = ROOM_TILES[roomId] ?? ROOM_TILES.living;
    return { x: b.x + b.w / 2, y: b.y + 95 };
  }

  drawRobotMarker(ctx, activeRoomId, transition) {
    let point = this.markerPoint(activeRoomId);
    if (transition) {
      const from = this.markerPoint(transition.fromRoomId);
      const to = this.markerPoint(transition.toRoomId);
      point = {
        x: lerp(from.x, to.x, transition.progress),
        y: lerp(from.y, to.y, transition.progress) - Math.sin(transition.progress * Math.PI) * 3,
      };
    }

    const bob = 1 + 0.035 * Math.sin(this.t * 6);
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(bob, bob);
    ctx.shadowColor = 'rgba(42, 38, 36, 0.38)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#3a4152';
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(0, -1, 12, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#45cdbb';
    ctx.beginPath();
    ctx.arc(0, -5, 4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#3a4152';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 2, 6, 0.22, Math.PI - 0.22);
    ctx.stroke();
    ctx.restore();
  }
}
