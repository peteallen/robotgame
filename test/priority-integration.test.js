import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';
import { Dock } from '../src/game/entities/Dock.js';
import { Robot } from '../src/game/entities/Robot.js';
import { Smears } from '../src/game/fx/Smears.js';
import { Minimap } from '../src/game/ui/Minimap.js';
import House from '../src/game/world/House.js';

const noop = () => {};

function makeGame({ hz = 60 } = {}) {
  const forcedActions = [];
  const game = {
    _lastW: 1680,
    _lastH: 1050,
    scale: 1,
    offX: 0,
    offY: 0,
    dpr: 1,
    canvas: { clientHeight: 1050, height: 1050 },
    time: 0,
    dt: 1 / hz,
    freezeBattery: true,
    userMode: 'vac',
    mopDirt: 0,
    mopComplained: false,
    pendingMop: false,
    pendingMopRoomId: null,
    mopIncidentRoomId: null,
    roomDirty: false,
    finalVacuumRoomId: null,
    dim: 0,
    dimTarget: 0,
    shakeAmt: 0,
    shakeCouch: 0,
    hatTime: 0,
    celebration: null,
    sockFetchT: 999,
    fateT: 999,
    toyTidyT: 999,
    dogChaseT: 999,
    trapT: 999,
    autoEventT: 999,
    stats: { pickups: 0 },
    pointerDown: false,
    pointerCapture: null,
    robotDrag: null,
    pendingSockDrag: false,
    dragSock: null,
    downPos: null,
    lastCrumb: null,
    dragSpawned: 0,
    splash: { active: false, fading: false, update: noop },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => target[key] ?? noop,
    }),
    sfx: { play: () => true },
    particles: new Proxy({ update: noop }, {
      get: (target, key) => target[key] ?? noop,
    }),
    dog: {
      roomId: 'living',
      state: 'sit',
      update: noop,
      pooping: () => false,
      startle: noop,
    },
    actions: {
      busy: false,
      current: null,
      update: noop,
      force(name) {
        forcedActions.push(name);
        return false;
      },
      triggerByName: noop,
    },
    ambience: { update: noop },
    milkBottle: { update: noop },
    cutaway: { update: noop },
    hud: { update: noop },
    syncRoomInteractionState: noop,
    updateMatJam: noop,
    addBasketSock: noop,
    say: noop,
    shake: noop,
    onPickup: noop,
    modeNeedsPads: Game.prototype.modeNeedsPads,
    modeHasVac: Game.prototype.modeHasVac,
    canWetClean: Game.prototype.canWetClean,
    messActive: Game.prototype.messActive,
    showRoom: Game.prototype.showRoom,
    cancelPointerInteraction: Game.prototype.cancelPointerInteraction,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.smears = new Smears(game);
  game.robot = new Robot(game);
  game.dirt = new DirtSystem(game);
  return { forcedActions, game };
}

function placeRobot(game, roomId, { x, y }, heading = 0) {
  game.house.activate(roomId);
  Object.assign(game.robot, {
    roomId,
    x,
    y,
    heading,
    speed: 0,
    targetSpeed: 0,
    state: 'clean',
    controlled: false,
    battery: 1,
    bin: 0,
  });
  return game.robot;
}

test('real Robot.update abandons ordinary cleaning on the frame battery becomes critical', () => {
  const { game } = makeGame();
  const robot = placeRobot(game, 'living', { x: 900, y: 700 });
  const target = game.dirt.spawn('cereal', 1000, 700, { roomId: 'living' });
  let suctionAttempts = 0;
  game.dirt.trySuck = () => suctionAttempts++;
  game.freezeBattery = false;
  Object.assign(robot, {
    state: 'seek',
    seekDirt: target,
    suctionOn: true,
    battery: 0.16 + game.dt / 300,
  });

  assert.ok(robot.battery > 0.16);
  game.time += game.dt;
  robot.update(game.dt);

  assert.ok(robot.battery <= 0.16);
  assert.equal(robot.state, 'godock');
  assert.equal(robot.dockReason, 'battery');
  assert.equal(robot.seekDirt, null);
  assert.equal(robot.suctionOn, false);
  assert.equal(suctionAttempts, 0);
  assert.equal(robot.roomTravel, null);
  assert.equal(robot.controlled, false);
});

test('critical battery preserves a state trip already crossing toward the dock room', () => {
  const { game } = makeGame();
  const portal = game.house.portal('kitchen', 'living');
  const robot = placeRobot(game, 'kitchen', portal.approach, portal.angle);

  assert.equal(robot.requestRoom('living', 'cleaning'), true);
  for (let frame = 0;
    frame < 180 && (!game.house.transition || game.house.transition.progress < 0.6);
    frame++) {
    game.time += game.dt;
    robot.update(game.dt);
  }

  const dockwardTravel = robot.roomTravel;
  const dockwardTransition = game.house.transition;
  assert.equal(dockwardTravel?.owner, 'state');
  assert.equal(dockwardTravel?.reason, 'cleaning');
  assert.equal(dockwardTravel?.phase, 'cross');
  assert.ok(dockwardTransition?.progress >= 0.6);
  assert.equal(robot.roomId, 'living');

  robot.battery = 0.16 + game.dt / 300;
  game.freezeBattery = false;
  game.time += game.dt;
  robot.update(game.dt);

  assert.ok(robot.battery <= 0.16);
  assert.equal(robot.dockReason, 'battery');
  assert.equal(game.house.transition, dockwardTransition);
  assert.equal(game.house.lastTransition, null);
  assert.equal(robot.roomTravel, dockwardTravel);
  assert.equal(robot.state, 'travel');
  assert.equal(robot.roomTravel?.owner, 'state');
  assert.equal(robot.roomTravel?.reason, 'cleaning');
  assert.equal(robot.roomTravel?.targetRoomId, 'living');
  assert.equal(robot.roomTravel?.resume?.state, 'godock');
});

test('manual summon preserves a state trip already crossing toward the dock room', () => {
  const { game } = makeGame();
  const portal = game.house.portal('kitchen', 'living');
  const robot = placeRobot(game, 'kitchen', portal.approach, portal.angle);

  assert.equal(robot.requestRoom('living', 'cleaning'), true);
  for (let frame = 0;
    frame < 180 && (!game.house.transition || game.house.transition.progress < 0.6);
    frame++) {
    game.time += game.dt;
    robot.update(game.dt);
  }

  const dockwardTravel = robot.roomTravel;
  const dockwardTransition = game.house.transition;
  assert.equal(dockwardTravel?.owner, 'state');
  assert.equal(dockwardTravel?.reason, 'cleaning');
  assert.equal(dockwardTravel?.phase, 'cross');
  assert.ok(dockwardTransition?.progress >= 0.6);

  robot.summon();

  assert.equal(robot.dockReason, 'summon');
  assert.equal(robot.stayDocked, true);
  assert.equal(game.house.transition, dockwardTransition);
  assert.equal(game.house.lastTransition, null);
  assert.equal(robot.roomTravel, dockwardTravel);
  assert.equal(robot.state, 'travel');
  assert.equal(robot.roomTravel?.reason, 'cleaning');
  assert.equal(robot.roomTravel?.targetRoomId, 'living');
  assert.equal(robot.roomTravel?.resume?.state, 'godock');
});

test('battery and manual dock commands leave during a local dog accident', () => {
  for (const command of ['battery', 'summon']) {
    const { game } = makeGame();
    game.dog = {
      roomId: 'kitchen',
      state: 'poop',
      update: noop,
      pooping: () => true,
      startle: noop,
    };
    const robot = placeRobot(game, 'kitchen', { x: 1180, y: 640 });
    robot.speed = 120;
    robot.targetSpeed = 120;

    if (command === 'battery') robot.goDock('battery');
    else robot.summon();

    assert.equal(robot.targetSpeed, 0, `${command} takes over the old motion immediately`);
    assert.equal(robot.state, 'godock');
    game.time += game.dt;
    robot.update(game.dt);

    assert.equal(robot.dockReason, command);
    assert.equal(robot.state, 'travel');
    assert.equal(robot.roomTravel?.owner, 'state');
    assert.equal(robot.roomTravel?.reason, 'dock');
    assert.equal(robot.roomTravel?.targetRoomId, 'living');
    assert.equal(robot.roomTravel?.resume?.state, 'godock');
  }
});

test('the minimap changes only the view, then remote dirt brings the real robot over', () => {
  const { game } = makeGame({ hz: 30 });
  const robot = placeRobot(game, 'living', { x: 300, y: 640 });
  Object.assign(robot, {
    seekCheckT: 0,
    modeTimer: 60,
    chirpT: 60,
  });
  const before = { roomId: robot.roomId, x: robot.x, y: robot.y };
  const minimap = new Minimap(game);

  assert.equal(minimap.onTap(1576, 947), true);
  assert.equal(game.house.activeRoomId, 'kitchen');
  assert.equal(game.room.id, 'kitchen');
  assert.deepEqual({ roomId: robot.roomId, x: robot.x, y: robot.y }, before);
  assert.equal(robot.roomTravel, null);

  const remote = game.dirt.spawn('cereal', 300, 640, {
    roomId: 'kitchen',
    playerMade: true,
  });
  let sawCleaningTrip = false;
  let sawDoorwayTransition = false;
  for (let frame = 0; frame < 15 / game.dt && game.dirt.items.includes(remote); frame++) {
    game.time += game.dt;
    robot.update(game.dt);
    game.dirt.update(game.dt);
    sawCleaningTrip ||= robot.roomTravel?.owner === 'state' &&
      robot.roomTravel?.reason === 'cleaning';
    sawDoorwayTransition ||= !!game.house.transition;
    assert.equal(game.house.activeRoomId, 'kitchen');
    assert.equal(game.room.id, 'kitchen');
    if (game.house.transition) {
      assert.equal(game.house.transitionFrame().roomId, 'kitchen');
    }
  }

  assert.equal(sawCleaningTrip, true);
  assert.equal(sawDoorwayTransition, true);
  assert.equal(game.dirt.items.includes(remote), false);
  assert.equal(robot.roomId, 'kitchen');
  assert.equal(game.house.activeRoomId, 'kitchen');
});

test('vacuum-only Game contact loads real wheels that transfer and spread real milk', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  try {
    const { forcedActions, game } = makeGame();
    const robot = placeRobot(game, 'kitchen', { x: 200, y: 850 });
    Object.assign(robot, {
      controlled: true,
      speed: 120,
      targetSpeed: 120,
      mopMode: false,
    });
    const fieldId = game.smears.spillMilk(robot.x, robot.y, {
      roomId: 'kitchen',
      duration: 0,
    });
    const field = game.smears.milkField(fieldId);
    const initialMass = field.height.reduce((sum, value) => sum + value, 0);
    let transferred = 0;
    let transferCalls = 0;
    const transferMilk = game.smears.transferMilk.bind(game.smears);
    game.smears.transferMilk = (...args) => {
      transferCalls++;
      const amount = transferMilk(...args);
      transferred += amount;
      return amount;
    };

    Game.prototype.update.call(game, game.dt);
    assert.equal(robot.smearKind, 'milk');
    assert.equal(robot.smearFieldId, fieldId);
    assert.ok(robot.smearT > 0);
    const contactCells = field.occupiedCellCount();

    for (let frame = 0; frame < 120; frame++) {
      Game.prototype.update.call(game, game.dt);
    }

    const finalMass = field.height.reduce((sum, value) => sum + value, 0);
    assert.ok(transferCalls > 0, 'real wheel updates should reach the milk transfer API');
    assert.ok(transferred > 0, 'the wheels should move real milk volume');
    assert.ok(field.occupiedCellCount() > contactCells,
      'dragged milk should cover more floor than it did at first contact');
    assert.ok(Math.abs(finalMass - initialMass) < 0.00002,
      `tracked milk changed mass from ${initialMass} to ${finalMass}`);
    assert.equal(robot.mopMode, false);
    assert.deepEqual(forcedActions, []);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
