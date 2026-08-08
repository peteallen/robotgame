// Shared helpers used by several actions: the back-in dock maneuver plus the
// little canvas draw routines for the grabber arm, socks, and toys, and the
// toy-tidy eligibility check.
import { TAU, lerp, damp } from '../core/math.js';
import { roundRect } from '../world/Room.js';

// ---------------- shared dock-trip helper (mop gear lives at the dock) ------

// Room travel for an action that already owns robot control. The Robot helper
// returns true only after the robot has emerged into the destination room.
export function roomTravelStep(g, targetRoomId, dt) {
  const r = g.robot;
  const currentRoomId = r.roomId ?? g.room?.id;
  if (!targetRoomId || (currentRoomId === targetRoomId && !r.isRoomTraveling?.())) return true;
  return r.travelToRoomStep?.(targetRoomId, dt) ?? false;
}

// Flying and furniture stunts are allowed to put Robo somewhere the ordinary
// driving collision rules reject. If one of those actions is interrupted, put
// him down in his physical room before normal navigation resumes. The viewed
// room may be different, so never use `g.room` unless no room registry exists.
export function settleRobotOnOpenFloor(g) {
  const r = g.robot;
  const room = r.roomFor?.(r.roomId) ??
    g.house?.room?.(r.roomId) ??
    g.room;
  const clearance = (r.radius ?? 62) + 4;

  r.z = 0;
  r.vz = 0;
  r.speed = 0;
  r.targetSpeed = 0;

  if (!room?.isFree || room.isFree(r.x, r.y, clearance)) return;

  const nearby = room.nearestFreePoint?.(r.x, r.y, clearance);
  if (nearby && room.isFree(nearby.x, nearby.y, clearance)) {
    r.x = nearby.x;
    r.y = nearby.y;
    return;
  }

  const fallback = room.randomFloorPoint?.(clearance);
  if (fallback && room.isFree(fallback.x, fallback.y, clearance)) {
    r.x = fallback.x;
    r.y = fallback.y;
  }
}

// back-in docking maneuver; returns true when parked
export function dockManeuverStep(g, st, dt) {
  const r = g.robot;
  const dockRoomId = g.dock.roomId ?? 'living';
  const currentRoomId = r.roomId ?? g.room?.id ?? dockRoomId;
  if (currentRoomId !== dockRoomId || r.isRoomTraveling?.()) {
    // Controlled actions keep ownership of the robot while the reusable room
    // travel helper visibly drives through both sides of the doorway.
    if (!roomTravelStep(g, dockRoomId, dt)) return false;
  }
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
      st.beepT = (st.beepT ?? 0) - dt;
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
}

export function drawArm(ctx, baseX, baseY, cx, cy, ext, claw) {
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

export function drawSockShape(ctx, g, tint) {
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

export function drawToyShape(ctx, g, held) {
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

export function isTidyableToy(d) {
  return (d.type === 'toy_ball' || d.type === 'toy_block') &&
    !d.toss && !d.fading && Math.abs(d.vx) < 40 && Math.abs(d.vy) < 40;
}
