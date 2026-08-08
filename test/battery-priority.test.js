import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { ActionRegistry } from '../src/game/actions/ActionRegistry.js';
import { ModeSwitch, WashTrip } from '../src/game/actions/dockTrips.js';
import { Robot } from '../src/game/entities/Robot.js';

const noop = () => {};

test('critical battery interrupts before the action update and clears travel and pointer ownership', () => {
  const events = [];
  const robot = {
    x: 420,
    y: 680,
    z: 0,
    battery: 1,
    controlled: false,
    state: 'clean',
    roomTravel: null,
    takeControl() {
      this.controlled = true;
      this.state = 'action';
    },
    abortRoomTravel() {
      events.push('abort-travel');
      this.roomTravel = null;
    },
    release(reason) {
      events.push(`release:${reason}`);
      this.controlled = false;
      this.state = 'godock';
      this.dockReason = reason;
    },
  };
  const game = {
    robot,
    room: { id: 'living' },
    pointerDown: false,
    pointerCapture: null,
    robotDrag: null,
    pendingSockDrag: false,
    dragSock: null,
    downPos: null,
    lastCrumb: null,
    dragSpawned: 0,
    addBasketSock(tint) {
      events.push(`return-sock:${tint}`);
    },
    cancelPointerInteraction: Game.prototype.cancelPointerInteraction,
  };
  const registry = new ActionRegistry(game);
  game.actions = registry;
  registry.register({
    name: 'trapped',
    weight: 1,
    start() {
      events.push('start');
      this.state = { phase: 'held', roomId: 'living' };
    },
    update() {
      events.push('update');
    },
    place() {
      events.push('place-robot');
      this.state.phase = 'placed';
    },
    end() {
      events.push('end');
    },
  });

  assert.equal(registry.triggerByName('trapped'), true);
  const interrupted = registry.current;
  game.pointerDown = true;
  game.pointerCapture = { kind: 'blocked' };
  game.robotDrag = { moved: true };
  game.pendingSockDrag = true;
  game.dragSock = { tint: '#ff8fa3' };
  game.downPos = { x: 400, y: 650 };
  game.lastCrumb = { x: 400, y: 650 };
  game.dragSpawned = 3;
  robot.roomTravel = { owner: 'controlled', phase: 'cross' };
  robot.battery = 0.16;

  registry.update(1 / 60);

  assert.deepEqual(events, [
    'start',
    'return-sock:#ff8fa3',
    'place-robot',
    'abort-travel',
    'end',
    'release:battery',
  ]);
  assert.equal(interrupted.state.phase, 'placed', 'the lifted robot is put down before cleanup');
  assert.equal(registry.current, null);
  assert.equal(robot.roomTravel, null);
  assert.equal(robot.controlled, false);
  assert.equal(robot.state, 'godock');
  assert.equal(robot.dockReason, 'battery');
  assert.equal(game.pointerDown, false);
  assert.equal(game.pointerCapture, null);
  assert.equal(game.robotDrag, null);
  assert.equal(game.dragSock, null);
  assert.equal(game.pendingSockDrag, false);
  assert.equal(game.downPos, null);
  assert.equal(game.lastCrumb, null);
  assert.equal(game.dragSpawned, 0);
});

test('every registry start path refuses actions while the battery is critical', () => {
  let starts = 0;
  const robot = {
    battery: 0.16,
    takeControl() {
      throw new Error('critical battery must never hand control to an action');
    },
  };
  const game = { robot };
  const registry = new ActionRegistry(game);
  const action = {
    name: 'surprise',
    weight: 1,
    start() {
      starts++;
    },
  };
  registry.register(action);

  assert.equal(registry.triggerByName('surprise'), false);
  assert.equal(registry.force('surprise'), false);
  assert.equal(registry.trigger(), false);
  assert.equal(registry.begin(action), false);
  assert.equal(registry.current, null);
  assert.equal(starts, 0);

  robot.battery = 0.17;
  robot.takeControl = noop;
  assert.equal(registry.triggerByName('surprise'), true, 'actions become available after recovery');
  assert.equal(starts, 1);
});

function makeDockGame() {
  const game = {
    time: 0,
    mopDirt: 0.8,
    mopComplained: false,
    dock: {
      roomId: 'living',
      x: 1330,
      parkY: 300,
      approach: { x: 1330, y: 480 },
      glow: 0,
      needsBag: () => true,
      needsClean: () => false,
      needsDirty: () => false,
      canMop: () => true,
    },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => target[key] ?? noop,
    }),
    particles: new Proxy({}, { get: () => noop }),
    cutaway: { show: noop, dismiss: noop },
    say: noop,
  };
  game.robot = new Robot(game);
  return game;
}

test('battery-requested or critical dock arrivals charge before emptying and washing', () => {
  for (const { battery, dockReason } of [
    { battery: 0.6, dockReason: 'battery' },
    { battery: 0.16, dockReason: 'bin' },
  ]) {
    const game = makeDockGame();
    const robot = game.robot;
    Object.assign(robot, {
      battery,
      dockReason,
      bin: 0.8,
      mopMode: true,
      state: 'align',
    });

    robot.arriveAtDock();

    assert.equal(robot.state, 'charge');
    assert.deepEqual(robot.dockPlan, ['empty', 'wash']);
    assert.equal(robot.waitingForBag, false, 'a full bag cannot block priority charging');
  }

  const releaseGame = makeDockGame();
  Object.assign(releaseGame.robot, {
    battery: 0.16,
    bin: 1,
    controlled: true,
    state: 'action',
  });
  releaseGame.robot.release('battery');
  assert.equal(releaseGame.robot.controlled, false);
  assert.equal(releaseGame.robot.state, 'charge');
  assert.deepEqual(releaseGame.robot.dockPlan, ['empty']);
  assert.equal(releaseGame.robot.dockReason, 'battery', 'battery outranks a simultaneous full bin');
});

test('interrupting dock equipment work preserves a parked or aligned dock pose', () => {
  for (const actionDefinition of [ModeSwitch, WashTrip]) {
    const parkedGame = makeDockGame();
    const parkedRobot = parkedGame.robot;
    parkedGame.actions = new ActionRegistry(parkedGame);
    Object.assign(parkedRobot, {
      battery: 0.16,
      bin: 0,
      controlled: true,
      state: 'action',
      actionDockOk: true,
    });
    const parkedAction = Object.create(actionDefinition);
    parkedAction.elapsed = 1;
    parkedAction.finished = false;
    parkedAction.state = { phase: 'service' };
    parkedGame.actions.current = parkedAction;

    parkedGame.actions.update(1 / 60);

    assert.equal(parkedGame.actions.current, null);
    assert.equal(parkedRobot.state, 'charge', `${actionDefinition.name} should charge in place`);
    assert.equal(parkedRobot.x, parkedGame.dock.x);
    assert.equal(parkedRobot.y, parkedGame.dock.parkY);
    assert.equal(parkedRobot.dockReason, 'battery');

    const summonedGame = makeDockGame();
    const summonedRobot = summonedGame.robot;
    summonedGame.actions = new ActionRegistry(summonedGame);
    Object.assign(summonedRobot, {
      battery: 1,
      bin: 0,
      controlled: true,
      state: 'action',
      actionDockOk: true,
    });
    const summonedAction = Object.create(actionDefinition);
    summonedAction.elapsed = 1;
    summonedAction.finished = false;
    summonedAction.state = { phase: 'service' };
    summonedGame.actions.current = summonedAction;

    summonedRobot.summon();

    assert.equal(summonedGame.actions.current, null);
    assert.equal(summonedRobot.state, 'docked', `${actionDefinition.name} should park in place`);
    assert.equal(summonedRobot.stayDocked, true);
    assert.equal(summonedRobot.x, summonedGame.dock.x);
    assert.equal(summonedRobot.y, summonedGame.dock.parkY);
    assert.equal(summonedRobot.dockReason, 'summon');

    const alignedGame = makeDockGame();
    const alignedRobot = alignedGame.robot;
    alignedGame.actions = new ActionRegistry(alignedGame);
    Object.assign(alignedRobot, {
      x: alignedGame.dock.x + 8,
      y: alignedGame.dock.parkY + 90,
      heading: Math.PI / 2,
      battery: 0.16,
      bin: 0,
      controlled: true,
      state: 'action',
      actionDockOk: true,
    });
    const alignedAction = Object.create(actionDefinition);
    alignedAction.elapsed = 1;
    alignedAction.finished = false;
    alignedAction.state = { phase: 'toDock', dockPhase: 'back' };
    alignedGame.actions.current = alignedAction;

    alignedGame.actions.update(1 / 60);

    assert.equal(alignedGame.actions.current, null);
    assert.equal(alignedRobot.state, 'align', `${actionDefinition.name} should keep backing in`);
    assert.equal(alignedRobot.dockReason, 'battery');
  }
});
