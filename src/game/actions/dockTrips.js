// Dock trips swap pads on/off (ModeSwitch) and wash dirty pads (WashTrip).
// MopMode is the separate in-room route controller for already-equipped wet
// cleaning; incidents themselves never request a pad installation.
import { clamp } from '../core/math.js';
import { dockManeuverStep, roomTravelStep } from './helpers.js';

const MOP_WIPE_RADIUS = 64;
const MOP_APPROACH_RADIUS = 48;

function clearMopRoute(st) {
  st.mopTarget = null;
  st.mopPath = null;
  st.mopPathIndex = 0;
  st.mopWaypointBest = Infinity;
  st.mopWaypointStallT = 0;
  st.mopTargetPlanX = null;
  st.mopTargetPlanY = null;
}

function routeLength(from, path) {
  let length = 0;
  let previous = from;
  for (const point of path) {
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function approachCandidates(r, target) {
  const candidates = [{ x: target.x, y: target.y }];
  const towardRobot = Math.atan2(r.y - target.y, r.x - target.x);
  // The robot only needs to pass within the wipe radius. An offset approach
  // lets its full body stay clear of an island or bin while the pads still
  // reach a painted drop beside that furniture.
  for (let index = 0; index < 16; index++) {
    const angle = towardRobot + index * Math.PI / 8;
    candidates.push({
      x: target.x + Math.cos(angle) * MOP_APPROACH_RADIUS,
      y: target.y + Math.sin(angle) * MOP_APPROACH_RADIUS,
    });
  }
  return candidates;
}

function planMopRoute(g, target) {
  const r = g.robot;
  const room = g.house?.room?.(r.roomId) ?? g.room;
  if (!room || typeof r.planRoomTravelPath !== 'function') return null;

  let best = null;
  for (const approach of approachCandidates(r, target)) {
    if (!room.isFree(approach.x, approach.y, (r.radius ?? 62) + 8)) continue;
    const path = r.planRoomTravelPath(approach.x, approach.y);
    if (!path?.length) continue;
    const length = routeLength(r, path);
    if (!best || length < best.length) best = { path, length };
  }
  return best?.path ?? null;
}

function orderedMopTargets(g, roomId) {
  const r = g.robot;
  const targets = typeof g.smears.mopTargetsIn === 'function'
    ? [...g.smears.mopTargetsIn(roomId)]
    : (g.smears.items ?? []).filter((item) => item.roomId === roomId);
  targets.sort((a, b) => {
    // A direct spill's primary mark is the collision-checked center from which
    // one pass normally reaches every secondary drop.
    if (!!a.primary !== !!b.primary) return a.primary ? -1 : 1;
    return Math.hypot(a.x - r.x, a.y - r.y) - Math.hypot(b.x - r.x, b.y - r.y);
  });
  const pile = g.dirt.find((item) => item.type === 'poop', roomId);
  if (pile) targets.push(pile);
  return targets;
}

function prepareMopRoute(g, st) {
  for (const target of orderedMopTargets(g, st.incidentRoomId)) {
    const path = planMopRoute(g, target);
    if (!path) continue;
    st.mopTarget = target;
    st.mopPath = path;
    st.mopPathIndex = 0;
    st.mopWaypointBest = Infinity;
    st.mopWaypointStallT = 0;
    st.mopTargetPlanX = target.x;
    st.mopTargetPlanY = target.y;
    return true;
  }
  return false;
}

function followMopRoute(g, st, dt) {
  const r = g.robot;
  const targetStillPresent = (typeof g.smears.containsTarget === 'function'
    ? g.smears.containsTarget(st.mopTarget)
    : (g.smears.items ?? []).includes(st.mopTarget)) ||
    (g.dirt.items ?? []).includes(st.mopTarget);
  const targetMoved = st.mopTarget && st.mopTargetPlanX != null &&
    Math.hypot(
      st.mopTarget.x - st.mopTargetPlanX,
      st.mopTarget.y - st.mopTargetPlanY,
    ) > 24;
  if (!targetStillPresent || targetMoved || !st.mopPath || st.mopPathIndex >= st.mopPath.length) {
    clearMopRoute(st);
    if (!prepareMopRoute(g, st)) return false;
  }

  const waypoint = st.mopPath[st.mopPathIndex];
  const distance = Math.hypot(r.x - waypoint.x, r.y - waypoint.y);
  if (distance < st.mopWaypointBest - 0.5) {
    st.mopWaypointBest = distance;
    st.mopWaypointStallT = 0;
  } else {
    st.mopWaypointStallT += dt;
  }

  if (st.mopWaypointStallT > 2.2) {
    const target = st.mopTarget;
    clearMopRoute(st);
    const path = target ? planMopRoute(g, target) : null;
    if (path) {
      st.mopTarget = target;
      st.mopPath = path;
      st.mopTargetPlanX = target.x;
      st.mopTargetPlanY = target.y;
    }
    return false;
  }

  const lastWaypoint = st.mopPathIndex === st.mopPath.length - 1;
  if (r.driveTravelWaypoint(
    waypoint.x,
    waypoint.y,
    lastWaypoint ? 165 : 155,
    lastWaypoint ? MOP_WIPE_RADIUS - MOP_APPROACH_RADIUS - 4 : 20,
  )) {
    st.mopPathIndex++;
    st.mopWaypointBest = Infinity;
    st.mopWaypointStallT = 0;
  }
  return true;
}

function nextMopRoomId(g, currentRoomId) {
  return g.smears.findAny?.((smear) => smear.roomId !== currentRoomId)?.roomId ??
    g.dirt.findAny?.((item) => item.type === 'poop' && item.roomId !== currentRoomId)?.roomId ?? null;
}

function latestPadNeed(g) {
  return !!g.modeNeedsPads();
}

function wetCleaningEnabled(g) {
  if (typeof g.canWetClean === 'function') return !!g.canWetClean();
  const selectedForMop = typeof g.modeNeedsPads === 'function' ? g.modeNeedsPads() : true;
  return selectedForMop && !!g.robot.mopMode;
}

function wetCleanupCanStart(g) {
  return wetCleaningEnabled(g) && (g.robot.smearT ?? 0) <= 0;
}

function returnToDockForLatestMode(st) {
  st.phase = 'toDock';
  st.dockPhase = 'go';
  st.t = 0;
}

// Decide what the dock should do from the robot's actual pad state and the
// player's latest mode choice. A service animation keeps its own captured
// direction so changing modes halfway through never makes the picture disagree
// with the equipment change. Once that animation completes, this function is
// called again and any newer choice is handled while the robot is still here.
function beginLatestModeService(g, st) {
  const r = g.robot;
  const install = latestPadNeed(g);
  st.install = install;
  st.serviceInstall = null;
  st.washFirst = !install && r.mopMode && g.mopDirt > 0.3 && g.dock.canMop();
  st.t = 0;

  if (r.mopMode === install) {
    st.phase = 'leave';
    return;
  }

  if (st.washFirst) {
    st.phase = 'wash';
    g.cutaway.show('wash');
    g.say('washing');
    return;
  }

  st.phase = 'service';
  st.serviceInstall = install;
  g.cutaway.show(install ? 'install' : 'remove');
}

function completeModeService(g, st) {
  const r = g.robot;
  // Apply exactly what the completed cutaway depicted, then reconcile again
  // in case the player changed modes while it was running.
  r.mopMode = st.serviceInstall;
  if (st.serviceInstall) g.say('mop_installed');
  g.particles.sparkle(r.x, r.y + 20, 6);
  beginLatestModeService(g, st);
}

// ----------------------- equipment change trip (player picked a new mode) ---
export const ModeSwitch = {
  name: 'modeSwitch',
  weight: 0,
  canRun: () => false,
  blocksWetCleanup: true,
  maxDur: 60,
  start(g) {
    const r = g.robot;
    const install = latestPadNeed(g);
    if (r.mopMode === install) {
      this.finished = true;
      return;
    }
    this.state = {
      phase: 'toDock', dockPhase: 'go', t: 0, install,
      originRoomId: r.roomId ?? g.room?.id ?? 'living',
      // dirty pads get washed before coming off, like the real thing
      washFirst: !install && g.mopDirt > 0.3 && g.dock.canMop(),
    };
    r.actionDockOk = true;
    r.setExpr('determined', 4);
    g.say(install ? 'go_mop_install' : 'remove_pads');
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!st) return;
    st.t += dt;
    switch (st.phase) {
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          beginLatestModeService(g, st);
        }
        break;
      }
      case 'wash': {
        r.targetSpeed = 0;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 4.6), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 4.6), 0, 1);
        if (g.cutaway.done) {
          g.mopDirt = 0;
          beginLatestModeService(g, st);
        }
        break;
      }
      case 'service': {
        r.targetSpeed = 0;
        if (g.cutaway.done) completeModeService(g, st);
        break;
      }
      case 'leave': {
        if (r.mopMode !== latestPadNeed(g)) {
          returnToDockForLatestMode(st);
          break;
        }
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 24, 130, 26, { ignoreDock: true })) {
          st.phase = 'return';
          st.t = 0;
        }
        break;
      }
      case 'return': {
        // Before doorway travel begins, a late mode change can still turn the
        // robot around locally. Once a crossing is underway it must finish the
        // atomic transition, after which it can safely route back to the dock.
        if (r.mopMode !== latestPadNeed(g) && !r.isRoomTraveling?.()) {
          returnToDockForLatestMode(st);
          break;
        }
        if (roomTravelStep(g, st.originRoomId, dt)) {
          if (r.mopMode !== latestPadNeed(g)) returnToDockForLatestMode(st);
          else this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    g.robot.actionDockOk = false;
    g.cutaway.dismiss();
  },
};

// -------------------------------- wash trip (pads dirty from mopping) -------
export const WashTrip = {
  name: 'washTrip',
  weight: 0,
  canRun: () => false,
  blocksWetCleanup: true,
  maxDur: 60,
  start(g) {
    const r = g.robot;
    if (!g.dock.canMop()) {
      // no water service — complain once, keep working with dirty pads
      g.say(g.dock.needsClean() ? 'clean_empty' : 'dirty_full', { force: true });
      g.sound.errorBuzz();
      g.mopComplained = true;
      this.state = { phase: 'giveup', t: 0 };
      return;
    }
    this.state = {
      phase: 'toDock', dockPhase: 'go', t: 0,
      originRoomId: r.roomId ?? g.room?.id ?? 'living',
      washComplete: false,
    };
    r.actionDockOk = true;
    r.setExpr('determined', 4);
    g.say('go_mop_wash');
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!st) return;
    st.t += dt;
    switch (st.phase) {
      case 'giveup': {
        r.targetSpeed = 0;
        if (st.t > 1.2) this.finished = true;
        break;
      }
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          if (st.washComplete) {
            beginLatestModeService(g, st);
          } else {
            st.phase = 'wash';
            st.t = 0;
            g.cutaway.show('wash');
            g.say('washing');
          }
        }
        break;
      }
      case 'wash': {
        r.targetSpeed = 0;
        r.spinExtra = Math.sin(st.t * 10) * 0.03;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 4.6), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 4.6), 0, 1);
        if (g.cutaway.done) {
          g.mopDirt = 0;
          st.washComplete = true;
          r.spinExtra = 0;
          g.say('mop_done');
          g.sound.tada();
          g.particles.sparkle(r.x, r.y - 40, 10);
          r.setExpr('happy', 2);
          // Washing does not imply the pads should stay installed. Resolve the
          // player's current mode here while the robot is still on the dock.
          beginLatestModeService(g, st);
        }
        break;
      }
      case 'service': {
        r.targetSpeed = 0;
        if (g.cutaway.done) completeModeService(g, st);
        break;
      }
      case 'leave': {
        if (r.mopMode !== latestPadNeed(g)) {
          returnToDockForLatestMode(st);
          break;
        }
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 24, 130, 26, { ignoreDock: true })) {
          st.phase = 'return';
          st.t = 0;
        }
        break;
      }
      case 'return': {
        if (r.mopMode !== latestPadNeed(g) && !r.isRoomTraveling?.()) {
          returnToDockForLatestMode(st);
          break;
        }
        if (roomTravelStep(g, st.originRoomId, dt)) {
          if (r.mopMode !== latestPadNeed(g)) returnToDockForLatestMode(st);
          else this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    g.robot.actionDockOk = false;
    g.robot.spinExtra = 0;
    g.cutaway.dismiss();
  },
};

// ---------------------------------------------- directed wet-floor cleanup
// Never picked randomly. The game starts it only when the selected mode already
// has pads installed, so an incident can guide normal in-room mopping but can
// never make a vacuum-only robot fetch different equipment.
export const MopMode = {
  name: 'mopMode',
  weight: 0,
  canRun: () => false,
  canForce: wetCleanupCanStart,
  maxDur: 90,
  start(g) {
    const r = g.robot;
    if (!wetCleanupCanStart(g)) {
      this.finished = true;
      return;
    }
    const currentRoomId = r.roomId ?? g.room?.id ?? 'living';
    const currentHasIncident = g.smears.hasIn?.(currentRoomId) ||
      g.dirt.hasIn?.(currentRoomId, (d) => d.type === 'poop');
    const firstIncident = g.smears.findAny?.() ?? g.dirt.findAny?.((d) => d.type === 'poop');
    const requestedIncidentRoomId = [g.pendingMopRoomId, g.mopIncidentRoomId]
      .find((roomId) => typeof roomId === 'string' && (g.house?.room?.(roomId) || roomId === currentRoomId));
    const incidentRoomId = requestedIncidentRoomId ??
      (currentHasIncident ? currentRoomId : firstIncident?.roomId ?? currentRoomId);
    this.state = {
      phase: 'returnToIncident', t: 0, success: false,
      incidentRoomId,
    };
    clearMopRoute(this.state);
    r.targetSpeed = 0;
    r.actionDockOk = false;
    r.setExpr('determined', 4);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!wetCleaningEnabled(g)) {
      // A mode tap can arrive after this action has taken ownership of a
      // doorway trip. Stop all wet work immediately, but keep advancing that
      // already-committed crossing until House completes its atomic handoff.
      // Releasing control only after arrival leaves the normal mode watchdog
      // free to start the requested equipment trip on the next check.
      const travel = r.roomTravel;
      if (travel?.owner === 'controlled' &&
          !r.travelToRoomStep?.(travel.targetRoomId, dt)) {
        return;
      }
      this.finished = true;
      return;
    }
    st.t += dt;
    switch (st.phase) {
      case 'returnToIncident': {
        if (roomTravelStep(g, st.incidentRoomId, dt)) {
          clearMopRoute(st);
          st.phase = 'mop';
          st.t = 0;
        }
        break;
      }
      case 'mop': {
        if (!roomTravelStep(g, st.incidentRoomId, dt)) return;
        // ambient pad-wiping (in Game.update) does the cleaning — this just
        // drives the robot over every last smear
        if (!g.smears.hasIn?.(st.incidentRoomId) &&
            !g.dirt.hasIn?.(st.incidentRoomId, (item) => item.type === 'poop')) {
          const nextRoomId = nextMopRoomId(g, st.incidentRoomId);
          if (nextRoomId) {
            st.incidentRoomId = nextRoomId;
            clearMopRoute(st);
            st.phase = 'returnToIncident';
            st.t = 0;
            break;
          }
          st.success = true;
          g.mopDirt = 1; // filthy pads — the wash trip follows on its own
          g.sound.happyBeeps(2);
          this.finished = true;
          break;
        }
        followMopRoute(g, st, dt);
        break;
      }
    }
  },
  end(g) {
    const r = g.robot;
    r.actionDockOk = false;
    g.cutaway.dismiss();
    if (this.state?.success) {
      r.setExpr('happy', 2);
    }
  },
};
