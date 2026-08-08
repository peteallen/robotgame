import assert from 'node:assert/strict';
import test from 'node:test';

import { Dock } from '../src/game/entities/Dock.js';
import { Dog } from '../src/game/entities/Dog.js';
import { Robot } from '../src/game/entities/Robot.js';
import House from '../src/game/world/House.js';

const noop = () => {};

function makeGame({ hz = 60, modeHasVac = false } = {}) {
  const game = {
    time: 0,
    dt: 1 / hz,
    freezeBattery: true,
    mopDirt: 0,
    pendingMop: false,
    actions: { current: null },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    sfx: { play: () => false },
    particles: new Proxy({}, { get: () => noop }),
    smears: { stamp: noop },
    dirt: {
      items: [],
      trySuck: noop,
      nearestVac: () => null,
    },
    dog: {
      roomId: 'living',
      state: 'sit',
      pooping: () => false,
      startle: noop,
    },
    modeHasVac: () => modeHasVac,
    say: noop,
    shake: noop,
    onPickup: noop,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.robot = new Robot(game);
  return game;
}

function placeRobot(game, roomId, { x, y }, heading = 0, controlled = false) {
  const robot = game.robot;
  game.house.activate(roomId);
  robot.roomId = roomId;
  robot.x = x;
  robot.y = y;
  robot.heading = heading;
  robot.speed = 0;
  robot.targetSpeed = 0;
  robot.state = controlled ? 'action' : 'clean';
  robot.controlled = controlled;
  return robot;
}

function simulateTravel(game, targetRoomId, { controlled = false, seconds = 20 } = {}) {
  const robot = game.robot;
  if (!controlled) assert.equal(robot.requestRoom(targetRoomId, 'manual'), true);
  const frames = Math.ceil(seconds / game.dt);
  for (let frame = 0; frame < frames; frame++) {
    game.time += game.dt;
    const controlledDone = controlled
      ? robot.travelToRoomStep(targetRoomId, game.dt)
      : false;
    robot.update(game.dt);
    if ((controlledDone || !robot.roomTravel) && robot.roomId === targetRoomId) {
      return (frame + 1) * game.dt;
    }
    if (!controlled && !robot.roomTravel) break;
  }
  return Infinity;
}

const KITCHEN_STARTS = [
  { x: 1180, y: 640 },
  { x: 1210, y: 850 },
  { x: 880, y: 480 },
  // A tangent position beside the island that exposed coarse path sampling.
  { x: 571.055, y: 829.829 },
  // A physically valid but tight corridor between cabinets and island.
  { x: 752.3684166092426, y: 477.47713175136596 },
];

test('normal and controlled kitchen travel complete from varied starts at 30 and 60 Hz', () => {
  for (const hz of [30, 60]) {
    for (const controlled of [false, true]) {
      for (const start of KITCHEN_STARTS) {
        for (const heading of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2]) {
          const game = makeGame({ hz });
          placeRobot(game, 'kitchen', start, heading, controlled);
          const elapsed = simulateTravel(game, 'living', { controlled });
          assert.ok(
            elapsed < 20,
            `${controlled ? 'controlled' : 'normal'} ${hz}Hz travel timed out from ` +
              `${start.x},${start.y} heading ${heading}`,
          );
        }
      }
    }
  }
});

test('the local dog potty sequence blocks both travel owners until it finishes', () => {
  for (const controlled of [false, true]) {
    let pooping = true;
    const game = makeGame();
    game.dog = {
      roomId: 'kitchen',
      state: 'squat',
      pooping: () => pooping,
      startle: noop,
    };
    const robot = placeRobot(game, 'kitchen', { x: 1180, y: 640 }, 0, controlled);
    const accepted = controlled
      ? robot.travelToRoomStep('living', game.dt)
      : robot.requestRoom('living', 'manual');
    assert.equal(accepted, false);
    assert.equal(robot.roomTravel, null);

    pooping = false;
    game.dog.state = 'sit';
    const elapsed = simulateTravel(game, 'living', { controlled });
    assert.ok(elapsed < 20);
  }
});

test('room controls cannot bypass a deliberate dock nap', () => {
  for (const reason of ['manual', 'map', 'doorway']) {
    const game = makeGame();
    const robot = placeRobot(game, 'living', {
      x: game.dock.x,
      y: game.dock.parkY,
    });
    robot.state = 'docked';
    robot.stayDocked = true;

    assert.equal(robot.requestRoom('kitchen', reason), false);
    assert.equal(robot.state, 'docked');
    assert.equal(robot.stayDocked, true);
    assert.equal(robot.roomId, 'living');
    assert.equal(robot.roomTravel, null);
  }

  const awakeGame = makeGame();
  const awakeRobot = placeRobot(awakeGame, 'living', {
    x: awakeGame.dock.x,
    y: awakeGame.dock.parkY,
  });
  awakeRobot.state = 'docked';
  awakeRobot.stayDocked = true;
  awakeRobot.wake();
  assert.equal(awakeRobot.stayDocked, false, 'an explicit robot wake still releases the nap');
  assert.equal(awakeRobot.requestRoom('kitchen', 'map'), true);
  assert.equal(awakeRobot.roomTravel?.reason, 'map');

  const returningGame = makeGame();
  const returningRobot = placeRobot(returningGame, 'kitchen', { x: 1180, y: 640 });
  returningRobot.state = 'godock';
  returningRobot.stayDocked = true;
  assert.equal(returningRobot.requestRoom('living', 'dock'), true);
  assert.equal(returningRobot.roomTravel?.reason, 'dock');
});

test('aged remote raw poop is work, while local raw poop prevents unrelated departure', () => {
  const game = makeGame();
  const robot = placeRobot(game, 'kitchen', { x: 1180, y: 640 });
  game.dirt.items.push({
    type: 'poop', roomId: 'living', x: 800, y: 700, age: 5, drop: 0,
  });
  assert.equal(robot.otherCleaningWorkRoomId(), 'living');

  game.dirt.items.push({
    type: 'poop', roomId: 'kitchen', x: 400, y: 700, age: 5, drop: 0,
  });
  assert.equal(robot.otherCleaningWorkRoomId(), null);
});

test('every planned doorway segment is collision-free at the physics radius', () => {
  const game = makeGame();
  const room = game.house.room('kitchen');
  const portal = room.portal('living');
  for (const start of KITCHEN_STARTS) {
    const robot = placeRobot(game, 'kitchen', start);
    const path = robot.planRoomTravelPath(
      portal.approach.x,
      portal.approach.y,
      { ignoreDock: true },
    );
    assert.ok(path?.length, `a path must exist from ${start.x},${start.y}`);
    let from = start;
    for (const waypoint of path) {
      assert.equal(
        robot.travelSegmentFree(room, from, waypoint, { ignoreDock: true }, robot.radius),
        true,
        `segment from ${from.x},${from.y} to ${waypoint.x},${waypoint.y} must be clear`,
      );
      from = waypoint;
    }
  }
});

test('a collision-checked fate route reaches its exact raw pile without stealing another', () => {
  for (const hz of [30, 60]) {
    const game = makeGame({ hz });
    const robot = placeRobot(game, 'kitchen', { x: 175, y: 315 });
    const pile = {
      type: 'poop', roomId: 'kitchen', x: 900, y: 850, age: 5, drop: 0, fated: true,
    };
    const otherPile = {
      type: 'poop', roomId: 'kitchen', x: 1250, y: 500, age: 5, drop: 0, fated: true,
    };
    game.dirt.items.push(pile, otherPile);
    const angle = Math.atan2(pile.y - robot.y, pile.x - robot.x);
    robot.fateTarget = {
      x: pile.x + Math.cos(angle) * 150,
      y: pile.y + Math.sin(angle) * 150,
      roomId: pile.roomId,
      pile,
    };

    let splatted = false;
    for (let frame = 0; frame < 20 * hz; frame++) {
      game.time += game.dt;
      robot.update(game.dt);
      if (Math.abs(robot.speed) > 25 &&
          Math.hypot(robot.x - pile.x, robot.y - pile.y) < robot.radius * 0.85) {
        game.dirt.items.splice(game.dirt.items.indexOf(pile), 1);
        robot.fateTarget = null;
        splatted = true;
        break;
      }
    }
    assert.equal(
      splatted,
      true,
      `${hz}Hz should reach the tracked pile; stopped at ${robot.x},${robot.y} with ` +
        `${JSON.stringify(robot.fateTarget?.path)}`,
    );
    assert.equal(otherPile.fated, true, 'the unrelated pile remains independently owned');
  }
});

test('a riding dog stays attached and cannot hop off during room travel', () => {
  const game = makeGame();
  const robot = placeRobot(game, 'kitchen', { x: 1180, y: 640 });
  const dog = new Dog(game);
  game.dog = dog;
  dog.roomId = 'kitchen';
  dog.state = 'ride';
  dog.rideT = 0.01;
  dog.x = robot.x;
  dog.y = robot.y - 26;
  assert.equal(robot.requestRoom('living', 'manual'), true);

  const initialRideT = dog.rideT;
  let sawOutOfBoundsPose = false;
  for (let frame = 0; frame < 20 / game.dt; frame++) {
    game.time += game.dt;
    robot.update(game.dt);
    dog.update(game.dt);
    if (robot.roomTravel) {
      sawOutOfBoundsPose ||= robot.x < game.room.bounds.minX || robot.x > game.room.bounds.maxX;
      assert.equal(dog.state, 'ride');
      assert.equal(dog.rideT, initialRideT);
      assert.equal(dog.x, robot.x);
      assert.equal(dog.y, robot.y - 26);
    }
    if (!robot.roomTravel && robot.roomId === 'living') break;
  }
  assert.equal(robot.roomId, 'living');
  assert.equal(dog.roomId, 'living');
  assert.equal(dog.state, 'ride');
  assert.equal(sawOutOfBoundsPose, true);
  assert.equal(
    game.house.activeRoomId,
    'kitchen',
    'the physical doorway trip must not pull the camera after the robot',
  );

  dog.update(game.dt);
  assert.equal(dog.state, 'walk', 'the paused ride timer resumes after arrival');
});
