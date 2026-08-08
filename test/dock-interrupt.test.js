import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { ActionRegistry } from '../src/game/actions/ActionRegistry.js';
import { SockGrab, TidyToy } from '../src/game/actions/chores.js';
import { Robot } from '../src/game/entities/Robot.js';
import { Hud, HUD_HOME_BUTTON } from '../src/game/ui/Hud.js';

const noop = () => {};

function makeActionGame() {
  const events = [];
  const floor = [];
  const game = {
    time: 0,
    dock: { x: 1330, parkY: 300 },
    room: {
      id: 'living',
      bounds: { minX: 100, maxX: 1500, minY: 100, maxY: 900 },
    },
    house: {
      activeRoomId: 'living',
      transition: null,
      cancelTransition() {
        events.push('abort-travel');
        this.transition = null;
      },
    },
    sound: {
      ackBeep() { events.push('ack-dock'); },
    },
    particles: {},
    say(name) { events.push(`say:${name}`); },
    cancelPointerInteraction() { events.push('cancel-pointer'); },
    dirt: {
      items: floor,
      spawn(type, x, y, options = {}) {
        const item = { type, x, y, ...options };
        floor.push(item);
        return item;
      },
    },
  };
  game.robot = new Robot(game);
  game.robot.battery = 0.8;
  game.actions = new ActionRegistry(game);
  return { events, floor, game, robot: game.robot, actions: game.actions };
}

function installHeldAction(game, actionDefinition, state) {
  const action = Object.create(actionDefinition);
  action.elapsed = 0;
  action.finished = false;
  action.state = state;
  game.actions.current = action;
  game.robot.controlled = true;
  game.robot.state = 'action';
  return action;
}

test('the HUD home command cancels controlled travel before cleanup and starts a summoned dock return', () => {
  const { actions, events, game, robot } = makeActionGame();
  let endCount = 0;
  actions.register({
    name: 'testAction',
    start() { events.push('start'); },
    end() {
      endCount++;
      events.push(actions.current === null ? 'end-detached' : 'end-owned');
    },
  });

  assert.equal(actions.triggerByName('testAction'), true);
  robot.roomTravel = {
    owner: 'controlled',
    fromRoomId: 'living',
    targetRoomId: 'kitchen',
    phase: 'cross',
  };
  robot.x = 760;
  robot.y = 640;
  game.house.transition = { fromRoomId: 'living', toRoomId: 'kitchen' };

  const hud = new Hud(game);
  assert.equal(hud.onTap(HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy), true);

  assert.deepEqual(events.slice(0, 4), [
    'start',
    'cancel-pointer',
    'abort-travel',
    'end-detached',
  ]);
  assert.equal(endCount, 1);
  assert.equal(actions.current, null);
  assert.equal(robot.roomTravel, null);
  assert.equal(robot.controlled, false);
  assert.equal(robot.state, 'godock');
  assert.equal(robot.dockReason, 'summon');
  assert.equal(robot.stayDocked, true);
  assert.equal(hud.homeBtnPop, 1);

  hud.onTap(HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy);
  assert.equal(endCount, 1, 'a repeated home command cannot clean up the same action twice');
});

test('a dock summon immediately abandons unrelated state-owned room travel', () => {
  const { events, game, robot } = makeActionGame();
  robot.x = 760;
  robot.y = 640;
  robot.state = 'travel';
  robot.roomTravel = {
    owner: 'state',
    reason: 'cleaning',
    fromRoomId: 'living',
    targetRoomId: 'kitchen',
    phase: 'cross',
    resume: { state: 'clean' },
  };
  game.house.transition = { fromRoomId: 'living', toRoomId: 'kitchen' };

  robot.summon();

  assert.deepEqual(events.slice(-3), [
    'say:go_dock',
    'ack-dock',
    'abort-travel',
  ]);
  assert.equal(robot.roomTravel, null);
  assert.equal(game.house.transition, null);
  assert.equal(robot.state, 'godock');
  assert.equal(robot.dockReason, 'summon');
  assert.equal(robot.stayDocked, true);
});

test('summoning while SockGrab holds a sock restores one floor sock exactly once', () => {
  const { floor, game, robot } = makeActionGame();
  const action = installHeldAction(game, SockGrab, {
    phase: 'carry',
    t: 0,
    roomId: 'living',
    sock: { x: 620, y: 460, z: 0, tint: '#8fd7ff' },
    item: null,
    sockOwner: 'action',
    pickedUp: true,
    arm: { ext: 0.25, claw: 0, tx: 620, ty: 460, holding: true },
    dropZ: 0,
  });

  robot.x = 540;
  robot.y = 610;
  robot.summon();
  robot.summon();

  assert.equal(floor.length, 1);
  assert.equal(floor[0].type, 'sock');
  assert.equal(floor[0].tint, '#8fd7ff');
  assert.equal(floor[0].roomId, 'living');
  assert.equal(action.state.sockOwner, 'floor');
  assert.equal(action.state.arm.holding, false);
});

test('summoning while TidyToy holds a toy restores one floor toy exactly once', () => {
  const { floor, game, robot } = makeActionGame();
  const action = installHeldAction(game, TidyToy, {
    phase: 'carry',
    t: 0,
    roomId: 'living',
    held: { type: 'toy_ball', tint: '#3ddad7', rot: 0.4 },
    released: false,
  });

  robot.x = 760;
  robot.y = 640;
  robot.summon();
  robot.summon();

  assert.equal(floor.length, 1);
  assert.equal(floor[0].type, 'toy_ball');
  assert.equal(floor[0].tint, '#3ddad7');
  assert.equal(floor[0].roomId, 'living');
  assert.equal(action.state.held, null);
});

test('the physical dock captures taps during travel, services its tapped zone, and outranks actions', () => {
  let actionTaps = 0;
  let pointerCancellations = 0;
  let services = 0;
  let summons = 0;
  const dockPoint = { x: 1330, y: 120 };
  const game = {
    splash: { active: false },
    sound: { unlock: noop },
    time: 12,
    screenToWorld: (x, y) => ({ x, y }),
    hud: { hitTest: () => false, onTap: () => false },
    house: { activeRoomId: 'living', transition: { phase: 'departing' } },
    robot: {
      roomId: 'kitchen',
      x: 500,
      y: 600,
      z: 0,
      radius: 62,
      isRoomTraveling: () => true,
      summon() { summons++; },
    },
    dock: {
      roomId: 'living',
      beacon: 0,
      contains: (x, y) => Math.abs(x - dockPoint.x) < 100 && Math.abs(y - dockPoint.y) < 100,
      tapZone: () => 'bag',
      service() {
        services++;
        return true;
      },
    },
    actions: {
      onTap() {
        actionTaps++;
        return true;
      },
    },
    say: noop,
    onDockServiced: noop,
    pointerDown: false,
    pointerCapture: null,
    pendingSockDrag: false,
    downPos: null,
    lastCrumb: null,
    _interactionRoomId: 'living',
    _roomTravelInputLocked: true,
    cancelPointerInteraction() {
      pointerCancellations++;
      this.pointerDown = false;
      this.pointerCapture = null;
    },
    tapDock: Game.prototype.tapDock,
  };

  Game.prototype.onPointerDown.call(game, dockPoint.x, dockPoint.y);
  assert.deepEqual(game.pointerCapture, {
    kind: 'dock',
    roomId: 'living',
    x: dockPoint.x,
    y: dockPoint.y,
  });

  // An autonomous doorway crossing can switch the visible scene while the
  // dock finger is still down. The already-captured physical control remains
  // bound to the living-room dock rather than being discarded with the room.
  game.house.activeRoomId = 'kitchen';
  Game.prototype.syncRoomInteractionState.call(game);
  assert.equal(pointerCancellations, 0);
  assert.equal(game.pointerCapture?.kind, 'dock');

  game.time += 0.1;
  Game.prototype.onPointerUp.call(game, dockPoint.x, dockPoint.y);

  assert.equal(services, 1);
  assert.equal(summons, 1);
  assert.equal(game.dock.beacon, 1.2);

  game.house.activeRoomId = 'living';
  Game.prototype.tap.call(game, dockPoint.x, dockPoint.y);
  assert.equal(summons, 2, 'the dock command runs before the normal travel input lock');
  assert.equal(actionTaps, 0, 'a running action cannot consume a physical dock tap');
});

test('a sleeping robot body on the dock keeps its tap-to-wake priority', () => {
  let actionTaps = 0;
  let summons = 0;
  let wakes = 0;
  const robot = {
    roomId: 'living',
    x: 1330,
    y: 300,
    z: 0,
    radius: 62,
    stayDocked: true,
    isRoomTraveling: () => false,
    wake() {
      wakes++;
      this.stayDocked = false;
    },
    summon() { summons++; },
  };
  const game = {
    splash: { active: false },
    sound: { unlock: noop },
    time: 20,
    screenToWorld: (x, y) => ({ x, y }),
    hud: { hitTest: () => false, onTap: () => false },
    house: { activeRoomId: 'living', transition: null },
    robot,
    dock: {
      roomId: 'living',
      contains: () => true,
      tapZone: () => null,
      beacon: 0,
    },
    room: { tapDoorway: () => null },
    actions: {
      current: null,
      busy: false,
      onTap() {
        actionTaps++;
        return true;
      },
    },
    basketHit: () => false,
    pointerDown: false,
    pointerCapture: null,
    robotDrag: null,
    pendingSockDrag: false,
    dragSock: null,
    downPos: null,
    lastCrumb: null,
    dragSpawned: 0,
    tap: Game.prototype.tap,
    tapDock: Game.prototype.tapDock,
    tapRobot: Game.prototype.tapRobot,
  };

  Game.prototype.onPointerDown.call(game, robot.x, robot.y);
  assert.equal(game.pointerCapture, null, 'the robot body must not be captured as dock chrome');
  game.time += 0.1;
  Game.prototype.onPointerUp.call(game, robot.x, robot.y);

  assert.equal(wakes, 1);
  assert.equal(summons, 0);
  assert.equal(actionTaps, 0, 'sleeping wake-up runs before action-specific robot taps');
  assert.equal(robot.stayDocked, false);
});
