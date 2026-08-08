import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { TidyToy } from '../src/game/actions/chores.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';
import { Dock } from '../src/game/entities/Dock.js';
import { Robot } from '../src/game/entities/Robot.js';
import House from '../src/game/world/House.js';

const noop = () => {};

function withSeed(seed, callback) {
  const originalRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function makeSeekGame() {
  const game = {
    time: 0,
    dt: 1 / 60,
    freezeBattery: true,
    mopDirt: 0,
    pendingMop: false,
    actions: { current: null },
    roomDirty: true,
    finalVacuumRoomId: null,
    stats: { pickups: 0 },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    sfx: { play: () => true },
    particles: new Proxy({}, { get: () => noop }),
    smears: { count: 0, stamp: noop },
    dog: {
      roomId: 'living', state: 'sit', pooping: () => false, startle: noop,
    },
    modeHasVac: () => true,
    say: noop,
    shake: noop,
    onPickup: noop,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.robot = new Robot(game);
  game.dirt = new DirtSystem(game);
  game.house.activate('kitchen');
  return game;
}

function cleanTarget({ start, target, seconds = 30 }) {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: start.x,
    y: start.y,
    heading: 0,
    state: 'seek',
    controlled: false,
    battery: 1,
    bin: 0,
  });
  const dirt = game.dirt.spawn('cereal', target.x, target.y, {
    roomId: 'kitchen',
    playerMade: true,
  });
  dirt.scale = dirt.targetScale;
  game.robot.seekDirt = dirt;

  for (let frame = 0; frame < seconds / game.dt; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.dirt.update(game.dt);
    if (!game.dirt.items.includes(dirt)) return game.time;
  }
  return Infinity;
}

function cleanPlayerSprinkle({
  roomId,
  typeIndex,
  tap,
  start,
  seconds = 45,
  seed = 1,
}) {
  const game = makeSeekGame();
  game.house.activate(roomId);
  Object.assign(game.robot, {
    roomId,
    x: start.x,
    y: start.y,
    heading: 0,
    state: 'clean',
    controlled: false,
    battery: 1,
    bin: 0,
    seekCheckT: 0,
  });
  game.dirt.tapCycleIdx = typeIndex;
  withSeed(seed, () => game.dirt.playerSprinkle(tap.x, tap.y, roomId));
  const spawned = [...game.dirt.items];

  for (let frame = 0; frame < seconds / game.dt; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.dirt.update(game.dt);
    if (spawned.every((item) => !game.dirt.items.includes(item))) {
      return { game, spawned, seconds: game.time };
    }
  }
  return { game, spawned, seconds: Infinity };
}

function makeKitchenTapGame() {
  const landingPoints = [];
  const game = {
    scale: 1,
    offX: 0,
    offY: 0,
    canvas: { clientHeight: 1050, height: 1050 },
    dock: null,
    robot: { radius: 62, x: 840, y: 860, notifyNewDirt: noop },
    sound: new Proxy({}, { get: () => noop }),
    particles: new Proxy({}, { get: () => noop }),
    dirt: {
      items: [],
      spawn(type, x, y, opts) {
        const item = { type, x, y, ...opts };
        this.items.push(item);
        return item;
      },
      toss(_item, x, y) {
        landingPoints.push({ x, y });
      },
      nearestVac: () => null,
    },
  };
  game.house = new House(game);
  game.house.activate('kitchen');
  game.roomFurniture = Game.prototype.roomFurniture;
  game.floorPointNear = Game.prototype.floorPointNear;
  return { game, landingPoints };
}

test('vacuum seeking routes around kitchen furniture to stranded debris', () => {
  const cabinetEdgeSeconds = cleanTarget({
    start: { x: 1210, y: 850 },
    target: { x: 1131.6, y: 277.9 },
  });
  assert.ok(cabinetEdgeSeconds < 25, `cabinet-edge cereal took ${cabinetEdgeSeconds}s`);

  const lowerWallSeconds = cleanTarget({
    start: { x: 300, y: 640 },
    target: { x: 1280, y: 870 },
  });
  assert.ok(lowerWallSeconds < 20, `lower-wall crumbs took ${lowerWallSeconds}s`);
});

test('a living-room sparkle beside the plant and minimap remains vacuum-reachable', () => {
  const result = cleanPlayerSprinkle({
    roomId: 'living',
    typeIndex: 3,
    tap: { x: 1312, y: 889 },
    start: { x: 300, y: 640 },
  });

  assert.equal(result.spawned[0]?.type, 'sparkle');
  assert.ok(result.seconds < 45,
    `the living-room sparkle cluster remained after ${result.seconds}s`);
  assert.ok(result.spawned.every((item) => !result.game.dirt.items.includes(item)),
    'every sparkle made by the tap should reach the suction mouth');
});

test('a kitchen leaf between the refrigerator and bin remains vacuum-reachable', () => {
  const result = cleanPlayerSprinkle({
    roomId: 'kitchen',
    typeIndex: 4,
    tap: { x: 1438, y: 567 },
    start: { x: 285, y: 640 },
  });

  assert.equal(result.spawned[0]?.type, 'leaf');
  assert.ok(result.seconds < 45,
    `the kitchen leaf cluster remained after ${result.seconds}s`);
  assert.ok(result.spawned.every((item) => !result.game.dirt.items.includes(item)),
    'every leaf made by the tap should reach the suction mouth');
});

test('target selection uses the shortest drivable route, independent of drop order', () => {
  for (const reverse of [false, true]) {
    const game = makeSeekGame();
    Object.assign(game.robot, {
      roomId: 'kitchen',
      x: 500,
      y: 850,
      state: 'clean',
      battery: 1,
      bin: 0,
    });
    const blockedNear = game.dirt.spawn('cereal', 1120, 620, {
      roomId: 'kitchen',
      playerMade: true,
    });
    const routeNear = game.dirt.spawn('cereal', 1200, 850, {
      roomId: 'kitchen',
      playerMade: true,
    });
    if (reverse) game.dirt.items.reverse();

    const straightToBlocked = Math.hypot(
      blockedNear.x - game.robot.x,
      blockedNear.y - game.robot.y,
    );
    const straightToRoute = Math.hypot(
      routeNear.x - game.robot.x,
      routeNear.y - game.robot.y,
    );
    assert.ok(straightToBlocked < straightToRoute, 'the island-side item is deceptively nearer');

    const choice = game.robot.chooseVacuumTarget();
    assert.equal(choice?.target, routeNear,
      `route-aware choice should ignore ${reverse ? 'reversed' : 'original'} insertion order`);
  }
});

test('target-specific grid overlays preserve a narrow kitchen approach lane', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 300,
    y: 700,
    state: 'clean',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 688, 438, {
    roomId: 'kitchen',
    playerMade: true,
  });

  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, target);
  let previous = game.robot;
  for (const point of choice.path) {
    assert.equal(game.robot.travelSegmentFree(game.robot.roomFor(), previous, point), true);
    previous = point;
  }
});

test('grid overlays include the robot start lane as well as the target lane', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 822.71,
    y: 484.78,
    state: 'clean',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 1354.48, 815.52, {
    roomId: 'kitchen',
    playerMade: true,
  });

  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, target);
  assert.ok(choice.length < 620,
    `start-lane overlay should avoid the ${choice.length.toFixed(2)}px detour`);
});

test('base connector selection compares every simplified route', () => {
  const game = makeSeekGame();
  game.house.activate('living');
  Object.assign(game.robot, {
    roomId: 'living',
    x: 1263.90,
    y: 676.89,
    state: 'clean',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 340.89, 710.40, {
    roomId: 'living',
    playerMade: true,
  });

  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, target);
  assert.ok(choice.length < 880,
    `simplified connector route remained ${choice.length.toFixed(2)}px`);
});

test('one grid step of excess triggers a shorter start-axis route', () => {
  const game = makeSeekGame();
  game.house.activate('living');
  Object.assign(game.robot, {
    roomId: 'living',
    x: 932.76,
    y: 281.49,
    state: 'clean',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 1147.64, 704.04, {
    roomId: 'living',
    playerMade: true,
  });

  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, target);
  assert.ok(choice.length < 420,
    `start-axis comparison left a ${choice.length.toFixed(2)}px route`);
  let previous = game.robot;
  for (const point of choice.path) {
    assert.equal(game.robot.travelSegmentFree(game.robot.roomFor(), previous, point), true);
    previous = point;
  }
});

test('vacuum targets retain the tighter 72-pixel approach ring', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 100,
    y: 245,
    state: 'clean',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 424, 269, {
    roomId: 'kitchen',
    playerMade: true,
  });

  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, target);
});

test('target ordering compares the actual simplified routes in either insertion order', () => {
  for (const reverse of [false, true]) {
    const game = makeSeekGame();
    Object.assign(game.robot, {
      roomId: 'kitchen',
      x: 128.24,
      y: 825.01,
      state: 'clean',
      battery: 1,
      bin: 0,
    });
    const longer = game.dirt.spawn('cereal', 1037.25, 814.33, {
      roomId: 'kitchen',
      playerMade: true,
    });
    const shorter = game.dirt.spawn('cereal', 421.15, 271.98, {
      roomId: 'kitchen',
      playerMade: true,
    });
    if (reverse) game.dirt.items.reverse();

    const choice = game.robot.chooseVacuumTarget();
    assert.equal(choice?.target, shorter,
      `simplified route should win with ${reverse ? 'reversed' : 'original'} insertion order`);
    let routeLength = 0;
    let previous = game.robot;
    for (const point of choice.path) {
      routeLength += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
    assert.ok(Math.abs(choice.length - routeLength) < 0.001,
      'reported length should match the path the robot will drive');
    assert.notEqual(choice.target, longer);
  }
});

test('new debris does not redirect a valid committed cleaning route', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 300,
    y: 700,
    state: 'seek',
    battery: 1,
    bin: 0,
  });
  const committed = game.dirt.spawn('cereal', 1220, 850, {
    roomId: 'kitchen',
    playerMade: true,
  });
  const choice = game.robot.chooseVacuumTarget();
  assert.equal(choice?.target, committed);
  game.robot.commitVacuumTarget(choice);

  const closer = game.dirt.spawn('cereal', 360, 700, {
    roomId: 'kitchen',
    playerMade: true,
  });
  assert.ok(
    Math.hypot(closer.x - game.robot.x, closer.y - game.robot.y) <
      Math.hypot(committed.x - game.robot.x, committed.y - game.robot.y),
    'the new item should be tempting enough to expose target switching',
  );
  game.robot.notifyNewDirt();

  assert.equal(game.robot.seekDirt, committed);
});

test('landing debris keeps a short navigation retry cadence', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 300,
    y: 700,
    state: 'clean',
    battery: 1,
    bin: 0,
    seekCheckT: 0,
  });
  game.dirt.spawn('cereal', 500, 760, {
    roomId: 'living',
    playerMade: true,
    drop: 90,
  });
  assert.equal(game.robot.hasLandingVacuumTarget(), false,
    'airborne dirt in another room must not accelerate local scans');
  const landing = game.dirt.spawn('cereal', 500, 760, {
    roomId: 'kitchen',
    playerMade: true,
    drop: 90,
  });

  let landedAt = null;
  let soughtAt = null;
  for (let frame = 0; frame < 120; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.dirt.update(game.dt);
    if (landing.drop <= 0 && landedAt == null) landedAt = game.time;
    if (game.robot.seekDirt === landing) {
      soughtAt = game.time;
      break;
    }
  }

  assert.notEqual(landedAt, null, 'the test crumb should land');
  assert.notEqual(soughtAt, null, 'the robot should notice the landed crumb');
  assert.ok(soughtAt - landedAt <= 0.2,
    `landed debris waited ${(soughtAt - landedAt).toFixed(3)}s`);
});

test('a repeatedly stalled committed route is eventually shunned', () => {
  const game = makeSeekGame();
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 300,
    y: 700,
    state: 'seek',
    battery: 1,
    bin: 0,
  });
  const target = game.dirt.spawn('cereal', 1220, 850, {
    roomId: 'kitchen',
    playerMade: true,
  });
  const waypoint = { x: 500, y: 700 };
  game.robot.commitVacuumTarget({ target, path: [waypoint], length: 200 });
  game.robot.driveTravelWaypoint = () => false;
  game.robot.planSeekRoute = () => ({ path: [waypoint], length: 200 });

  for (let attempt = 0; attempt < 8 && game.robot.seekDirt; attempt++) {
    game.time += 2.3;
    game.robot.followSeekPath(target, 2.3);
  }

  assert.equal(game.robot.seekDirt, null);
  assert.equal(game.robot.state, 'clean');
  assert.ok(target.shunned > game.time, 'the stalled item should pause before another attempt');
});

test('island and trash spills reserve full robot clearance', () => {
  for (const interaction of ['island', 'trash']) {
    for (let seed = 1; seed <= 40; seed++) {
      const { game, landingPoints } = makeKitchenTapGame();
      withSeed(seed, () => {
        assert.equal(Game.prototype.tapKitchenFurniture.call(game, interaction), true);
      });
      assert.ok(landingPoints.length > 0, `${interaction} seed ${seed} should spill`);
      for (const point of landingPoints) {
        assert.equal(
          game.room.isFree(point.x, point.y, game.robot.radius + 8, { solidTable: true }),
          true,
          `${interaction} seed ${seed} landing ${point.x},${point.y}`,
        );
      }
    }
  }
});

test('startup dirt reserves full robot clearance in both rooms', () => {
  const game = makeSeekGame();
  for (const roomId of game.house.roomIds) {
    const room = game.house.room(roomId);
    for (let seed = 1; seed <= 80; seed++) {
      game.dirt.items.length = 0;
      withSeed(seed, () => game.dirt.spawnRandom(roomId));
      const dirt = game.dirt.items[0];
      assert.equal(
        room.isFree(dirt.x, dirt.y, game.robot.radius + 8, { ignoreDock: true }),
        true,
        `${roomId} seed ${seed}`,
      );
    }
  }
});

test('a tapped toy block cannot roll inside the couch beyond the grabber arm', () => {
  const game = makeSeekGame();
  game.house.activate('living');
  Object.assign(game.robot, {
    roomId: 'living',
    x: 700,
    y: 700,
    heading: 0,
    state: 'clean',
    controlled: false,
    battery: 1,
    bin: 0,
  });
  const room = game.house.room('living');
  assert.equal(room.isFree(610, 850, 45, { solidTable: true }), true,
    'the toy begins at a legal launch landing');
  const toy = game.dirt.spawn('toy_block', 610, 850, {
    roomId: 'living',
    vx: -220,
  });

  for (let frame = 0; frame < 5 / game.dt; frame++) {
    game.time += game.dt;
    game.dirt.update(game.dt);
  }
  assert.equal(room.isFree(toy.x, toy.y, 24), true,
    'rolling toy physics must keep the block outside furniture');

  const action = Object.create(TidyToy);
  action.finished = false;
  action.state = {};
  game.robot.takeControl();
  action.start(game);
  for (let frame = 0; frame < TidyToy.maxDur / game.dt && !action.finished; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.dirt.update(game.dt);
    action.update(game, game.dt);
  }

  assert.equal(game.dirt.items.includes(toy), false,
    'the arm should collect the settled block before the tidy action times out');
});
