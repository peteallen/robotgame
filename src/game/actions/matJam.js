// A small kitchen-only mishap: while crossing the anti-fatigue mat, Robo can
// briefly catch a wheel and grind in place. This action is intentionally
// independent of floor messes; Game only needs to feed the trigger helper once
// per update.
import { dist, pointInRect, rand } from '../core/math.js';

const INITIAL_DELAY = [45, 75];
const REPEAT_DELAY = [120, 200];
const MIN_TRAVERSAL_SPEED = 25;

function kitchenMat(g) {
  return g.house?.room?.('kitchen')?.rug ?? null;
}

export function robotOnKitchenMat(g, robot = g.robot) {
  const mat = kitchenMat(g);
  return !!mat && robot?.roomId === 'kitchen' &&
    pointInRect(robot.x, robot.y, mat);
}

// The event clock measures ordinary powered cleaning in the kitchen, not wall
// time. Time spent in the living room, in a doorway, parked, or in another
// action therefore cannot make the next kitchen visit jam immediately.
export function matJamClockEligible(g, robot = g.robot) {
  return robot?.roomId === 'kitchen' &&
    !g.actions?.busy &&
    !g.messActive?.() &&
    !robot.stayDocked &&
    !robot.isRoomTraveling?.() &&
    ['clean', 'seek'].includes(robot.state) &&
    Math.abs(robot.speed) > MIN_TRAVERSAL_SPEED;
}

// Kept separate from the crossing latch so the Game watchdog and focused tests
// share exactly the same definition of a safe moment to start the action.
export function matJamEligible(g, robot = g.robot) {
  return robotOnKitchenMat(g, robot) && matJamClockEligible(g, robot);
}

export function createMatJamTriggerState(initialDelay = rand(...INITIAL_DELAY)) {
  return {
    cooldown: Math.max(0, initialDelay),
    wasOnMat: false,
  };
}

// Returns true only on the frame that the action actually starts. A crossing
// gets one attempt: remaining on the mat can never roll or trigger every frame.
// Supplying nextDelay makes timing deterministic in tests without replacing the
// game's global random source.
export function updateMatJamTrigger(
  g,
  triggerState,
  dt,
  { nextDelay = () => rand(...REPEAT_DELAY) } = {},
) {
  if (!triggerState) return false;
  if (matJamClockEligible(g)) {
    triggerState.cooldown = Math.max(0, triggerState.cooldown - Math.max(0, dt || 0));
  }

  const onMat = robotOnKitchenMat(g);
  const enteredMat = onMat && !triggerState.wasOnMat;
  triggerState.wasOnMat = onMat;
  if (!enteredMat || triggerState.cooldown > 0 || !matJamEligible(g)) return false;

  const started = g.actions?.force?.('matJam') === true;
  if (started) triggerState.cooldown = Math.max(0, nextDelay());
  return started;
}

function beginRecovery(action, g, helped) {
  const r = g.robot;
  const st = action.state;
  if (st.phase !== 'jammed') return;
  st.phase = 'recover';
  st.t = 0;
  st.helped = helped;
  r.trapped = false;
  r.spinExtra = 0;
  r.targetSpeed = 0;
  r.speed = 0;
  g.sound.stopWheelGrind();
  r.setExpr(helped ? 'love' : 'determined', 1.5);
  r.hop(helped ? 190 : 165);
  if (helped) {
    g.sound.happyBeeps(3);
    g.particles.hearts(r.x, r.y - 58, 3, r.roomId);
  } else {
    g.sound.ackBeep();
  }
}

export const MatJam = {
  name: 'matJam',
  weight: 0,
  canRun: () => false,
  canForce: (g) => matJamEligible(g),
  blocksWetCleanup: true,
  maxDur: 14,

  start(g) {
    const r = g.robot;
    this.state = {
      phase: 'jammed',
      roomId: r.roomId,
      t: 0,
      autoFreeAt: rand(8, 11),
      helped: false,
    };
    r.speed = 0;
    r.targetSpeed = 0;
    r.escape = null;
    r.trapped = true;
    r.spinExtra = 0;
    r.squish = 0.7;
    r.setExpr('effort', 12);
    g.sound.bump();
    g.sound.startWheelGrind();
    g.shake(1.5);
  },

  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!st?.roomId || r.roomId !== st.roomId) {
      this.finished = true;
      return;
    }

    st.t += dt;
    if (st.phase === 'jammed') {
      r.speed = 0;
      r.targetSpeed = 0;
      r.spinExtra = Math.sin(st.t * 18) * 0.075;
      r.squish = Math.max(r.squish, 0.45 + Math.abs(Math.sin(st.t * 14)) * 0.2);
      r.brushSpin += dt * 24;
      if (st.t >= st.autoFreeAt) beginRecovery(this, g, false);
      return;
    }

    r.speed = 0;
    r.targetSpeed = 0;
    if (st.phase === 'recover' && st.t >= 0.65) this.finished = true;
  },

  onTap(g, x, y) {
    const r = g.robot;
    if (this.state?.phase !== 'jammed' ||
        dist(x, y, r.x, r.y - r.z) >= r.radius + 46) return false;
    beginRecovery(this, g, true);
    return true;
  },

  end(g) {
    const r = g.robot;
    r.trapped = false;
    r.spinExtra = 0;
    r.speed = 0;
    r.targetSpeed = 0;
    g.sound.stopWheelGrind();
  },
};

export default MatJam;
