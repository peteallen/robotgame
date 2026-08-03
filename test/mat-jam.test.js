import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MatJam,
  createMatJamTriggerState,
  matJamClockEligible,
  matJamEligible,
  robotOnKitchenMat,
  updateMatJamTrigger,
} from '../src/game/actions/matJam.js';
import { registerDefaultActions } from '../src/game/actions/index.js';
import { Game } from '../src/game/Game.js';
import { SoundEngine } from '../src/game/core/SoundEngine.js';

const MAT = { x: 625, y: 802, w: 420, h: 112 };

function makeGame() {
  const calls = [];
  const robot = {
    roomId: 'kitchen',
    x: 700,
    y: 850,
    z: 0,
    radius: 62,
    state: 'clean',
    speed: 90,
    targetSpeed: 90,
    stayDocked: false,
    trapped: false,
    spinExtra: 0,
    squish: 0,
    brushSpin: 0,
    escape: null,
    traveling: false,
    isRoomTraveling() { return this.traveling; },
    setExpr(expr, duration) { calls.push(['expr', expr, duration]); },
    hop(force) { calls.push(['hop', force]); },
  };
  const actions = {
    busy: false,
    force(name) {
      calls.push(['force', name]);
      return true;
    },
  };
  const sound = new Proxy({}, {
    get: (_target, name) => (...args) => calls.push(['sound', name, ...args]),
  });
  const particles = new Proxy({}, {
    get: (_target, name) => (...args) => calls.push(['particles', name, ...args]),
  });
  return {
    game: {
      robot,
      actions,
      house: { room: (id) => id === 'kitchen' ? { rug: MAT } : null },
      sound,
      particles,
      shake: (amount) => calls.push(['shake', amount]),
    },
    robot,
    actions,
    calls,
  };
}

test('mat eligibility is kitchen-only and requires an ordinary moving traversal', () => {
  const { game, robot, actions } = makeGame();
  assert.equal(robotOnKitchenMat(game), true);
  assert.equal(matJamClockEligible(game), true);
  assert.equal(matJamEligible(game), true);

  robot.roomId = 'living';
  assert.equal(robotOnKitchenMat(game), false, 'matching coordinates in the living room are not the kitchen mat');
  robot.roomId = 'kitchen';
  robot.x = MAT.x - 1;
  assert.equal(matJamEligible(game), false, 'the robot center must be on the authored mat');
  robot.x = MAT.x;

  robot.speed = 25;
  assert.equal(matJamEligible(game), false, 'a stopped or barely moving robot is not traversing');
  robot.speed = 90;
  robot.state = 'action';
  assert.equal(matJamEligible(game), false, 'another action cannot be interrupted');
  robot.state = 'clean';
  robot.traveling = true;
  assert.equal(matJamEligible(game), false, 'doorway travel cannot be interrupted');
  robot.traveling = false;
  robot.stayDocked = true;
  assert.equal(matJamEligible(game), false, 'a deliberate dock nap cannot jam');
  robot.stayDocked = false;
  actions.busy = true;
  assert.equal(matJamEligible(game), false, 'a busy registry blocks the environmental action');
});

test('the cooldown advances only during ordinary moving kitchen cleaning', () => {
  const { game, robot, actions } = makeGame();
  const state = createMatJamTriggerState(20);
  robot.x = MAT.x - 20;

  robot.roomId = 'living';
  updateMatJamTrigger(game, state, 8);
  assert.equal(state.cooldown, 20, 'living-room time must not arm a kitchen jam');

  robot.roomId = 'kitchen';
  robot.traveling = true;
  updateMatJamTrigger(game, state, 4);
  assert.equal(state.cooldown, 20, 'doorway travel must not advance the clock');
  robot.traveling = false;
  actions.busy = true;
  updateMatJamTrigger(game, state, 3);
  assert.equal(state.cooldown, 20, 'other actions must pause the clock');
  actions.busy = false;
  robot.speed = 0;
  updateMatJamTrigger(game, state, 2);
  assert.equal(state.cooldown, 20, 'parked time is not cleaning traversal time');

  robot.speed = 90;
  game.messActive = () => true;
  updateMatJamTrigger(game, state, 5);
  assert.equal(state.cooldown, 20, 'active wet work must pause the independent jam clock');
  game.messActive = () => false;
  updateMatJamTrigger(game, state, 5);
  assert.equal(state.cooldown, 15, 'normal moving kitchen cleaning advances the clock');
});

test('the Game-level mat watchdog starts the registered action on an armed crossing', () => {
  const { game, robot, calls } = makeGame();
  game.matJamTriggerState = createMatJamTriggerState(0);
  robot.x = MAT.x - 20;

  assert.equal(Game.prototype.updateMatJam.call(game, 1 / 60), false);
  robot.x = MAT.x + 10;
  assert.equal(Game.prototype.updateMatJam.call(game, 1 / 60), true);
  assert.equal(calls.filter((call) => call[0] === 'force' && call[1] === 'matJam').length, 1);
});

test('the trigger fires once per crossing and respects its deterministic cooldown', () => {
  const { game, robot, calls } = makeGame();
  const state = createMatJamTriggerState(0);
  robot.x = MAT.x - 20;

  assert.equal(updateMatJamTrigger(game, state, 1 / 60, { nextDelay: () => 123 }), false);
  robot.x = MAT.x + 10;
  assert.equal(updateMatJamTrigger(game, state, 1 / 60, { nextDelay: () => 123 }), true);
  assert.equal(state.cooldown, 123);
  assert.equal(calls.filter((call) => call[0] === 'force').length, 1);

  assert.equal(updateMatJamTrigger(game, state, 3, { nextDelay: () => 123 }), false,
    'remaining on the mat cannot retrigger');
  robot.x = MAT.x - 20;
  updateMatJamTrigger(game, state, 1 / 60, { nextDelay: () => 123 });
  robot.x = MAT.x + 10;
  assert.equal(updateMatJamTrigger(game, state, 1 / 60, { nextDelay: () => 123 }), false,
    're-entry during cooldown stays quiet');

  robot.x = MAT.x - 20;
  state.cooldown = 0;
  updateMatJamTrigger(game, state, 0, { nextDelay: () => 77 });
  robot.x = MAT.x + 10;
  assert.equal(updateMatJamTrigger(game, state, 0, { nextDelay: () => 77 }), true);
  assert.equal(state.cooldown, 77);
  assert.equal(calls.filter((call) => call[0] === 'force').length, 2);
});

test('the jam grinds in place and self-frees after its fixed test deadline', () => {
  const { game, robot, calls } = makeGame();
  const action = Object.create(MatJam);
  action.finished = false;
  action.state = {};
  action.start(game);
  action.state.autoFreeAt = 0.1;

  assert.equal(robot.speed, 0);
  assert.equal(robot.targetSpeed, 0);
  assert.equal(robot.trapped, true);
  assert.equal(calls.filter((call) => call[0] === 'sound' && call[1] === 'startWheelGrind').length, 1);

  action.update(game, 0.11);
  assert.equal(action.state.phase, 'recover');
  assert.equal(robot.trapped, false);
  assert.equal(calls.filter((call) => call[0] === 'sound' && call[1] === 'stopWheelGrind').length, 1,
    'self-recovery stops the grinding loop immediately');
  assert.ok(calls.some((call) => call[0] === 'hop'));
  assert.ok(calls.some((call) => call[0] === 'sound' && call[1] === 'ackBeep'));

  action.update(game, 0.66);
  assert.equal(action.finished, true);
  action.end(game);
  assert.equal(robot.trapped, false);
  assert.equal(robot.spinExtra, 0);
  assert.equal(robot.speed, 0);
  assert.equal(robot.targetSpeed, 0);
  assert.equal(calls.filter((call) => call[0] === 'sound' && call[1] === 'stopWheelGrind').length, 2,
    'end remains an idempotent cleanup path');
});

test('a generous robot tap helps early while a distant tap remains available to the room', () => {
  const { game, robot, calls } = makeGame();
  const action = Object.create(MatJam);
  action.finished = false;
  action.state = {};
  action.start(game);

  assert.equal(action.onTap(game, robot.x + robot.radius + 80, robot.y), false);
  assert.equal(action.state.phase, 'jammed');
  assert.equal(action.onTap(game, robot.x + robot.radius + 30, robot.y), true);
  assert.equal(action.state.phase, 'recover');
  assert.equal(action.state.helped, true);
  assert.equal(calls.filter((call) => call[0] === 'sound' && call[1] === 'stopWheelGrind').length, 1,
    'help stops grinding before the recovery reaction');
  assert.ok(calls.some((call) => call[0] === 'sound' && call[1] === 'happyBeeps'));
  assert.ok(calls.some((call) => call[0] === 'particles' && call[1] === 'hearts'));
});

test('mat jam is registered only as a forced action', () => {
  const registered = [];
  registerDefaultActions({ register: (action) => registered.push(action) });
  const jams = registered.filter((action) => action.name === 'matJam');
  assert.equal(jams.length, 1);
  assert.equal(jams[0].weight, 0);
  assert.equal(jams[0].canRun(), false);
  assert.equal(jams[0].blocksWetCleanup, true);
});

test('cancelling a jam always stops grinding and clears distress state', () => {
  const { game, robot, calls } = makeGame();
  const action = Object.create(MatJam);
  action.finished = false;
  action.state = {};
  action.start(game);
  robot.spinExtra = 0.2;

  action.end(game);

  assert.equal(robot.trapped, false);
  assert.equal(robot.spinExtra, 0);
  assert.equal(calls.filter((call) => call[0] === 'sound' && call[1] === 'stopWheelGrind').length, 1);
});

test('the grinding audio graph starts once and stops every looping source', () => {
  const stopped = [];
  let sourceCount = 0;
  const audioParam = (value = 0) => ({
    value,
    setValueAtTime(next) { this.value = next; },
    linearRampToValueAtTime(next) { this.value = next; },
    exponentialRampToValueAtTime(next) { this.value = next; },
    cancelScheduledValues() {},
  });
  const connectable = () => ({ connect() {} });
  const ctx = {
    currentTime: 4,
    sampleRate: 100,
    createBuffer: () => ({ getChannelData: () => new Float32Array(22) }),
    createBufferSource: () => {
      const id = `source-${++sourceCount}`;
      return {
        ...connectable(),
        buffer: null,
        loop: false,
        start() {},
        stop(at) { stopped.push([id, at]); },
      };
    },
    createBiquadFilter: () => ({
      ...connectable(),
      type: '',
      frequency: audioParam(),
      Q: audioParam(),
    }),
    createOscillator: () => {
      const id = `oscillator-${++sourceCount}`;
      return {
        ...connectable(),
        type: '',
        frequency: audioParam(),
        start() {},
        stop(at) { stopped.push([id, at]); },
      };
    },
    createGain: () => ({ ...connectable(), gain: audioParam() }),
  };
  const sound = new SoundEngine();
  sound.ctx = ctx;
  sound.master = {};

  sound.startWheelGrind();
  const active = sound.wheelGrindNodes;
  sound.startWheelGrind();
  assert.equal(sound.wheelGrindNodes, active, 'a second start cannot stack another loop');
  assert.equal(sourceCount, 3, 'one noise source and two oscillators make up the grind');

  sound.stopWheelGrind();
  assert.equal(sound.wheelGrindNodes, null);
  assert.equal(stopped.length, 3);
  assert.ok(stopped.every(([, at]) => at === 4.05));
  sound.stopWheelGrind();
  assert.equal(stopped.length, 3, 'repeated cleanup cannot touch already-stopped sources');
});
