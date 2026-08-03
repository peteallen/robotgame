import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
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
