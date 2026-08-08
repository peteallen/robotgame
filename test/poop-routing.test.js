import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { ActionRegistry } from '../src/game/actions/ActionRegistry.js';
import { MopMode } from '../src/game/actions/dockTrips.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';
import { Dock } from '../src/game/entities/Dock.js';
import { Robot } from '../src/game/entities/Robot.js';
import { Smears } from '../src/game/fx/Smears.js';
import House from '../src/game/world/House.js';

const noop = () => {};

function makePoopGame({ hz = 60, roomId = 'living', start }) {
  const game = {
    _lastW: 1680,
    _lastH: 1050,
    time: 0,
    dt: 1 / hz,
    freezeBattery: true,
    userMode: 'mop',
    pendingMop: false,
    pendingMopRoomId: null,
    mopIncidentRoomId: null,
    mopDirt: 0,
    mopComplained: false,
    roomDirty: false,
    finalVacuumRoomId: null,
    dim: 0,
    dimTarget: 0,
    shakeAmt: 0,
    shakeCouch: 0,
    hatTime: 0,
    celebration: null,
    sockFetchT: 999,
    fateT: 0,
    toyTidyT: 999,
    dogChaseT: 999,
    trapT: 999,
    autoEventT: 999,
    splash: { active: false, fading: false, update: noop },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    sfx: { play: () => true },
    particles: new Proxy({ update: noop }, {
      get: (target, key) => target[key] ?? noop,
    }),
    dog: {
      roomId,
      state: 'sit',
      update: noop,
      pooping: () => false,
      startle: noop,
      startChase: noop,
    },
    ambience: { update: noop },
    milkBottle: { update: noop },
    cutaway: { done: false, update: noop, dismiss: noop },
    hud: { update: noop },
    syncRoomInteractionState: noop,
    updateMatJam: noop,
    say: noop,
    shake: noop,
    onPickup: noop,
    modeNeedsPads: Game.prototype.modeNeedsPads,
    modeHasVac: Game.prototype.modeHasVac,
    canWetClean: Game.prototype.canWetClean,
    messActive: Game.prototype.messActive,
    roomFurniture: Game.prototype.roomFurniture,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.house.activate(roomId);
  game.smears = new Smears(game);
  game.dirt = new DirtSystem(game);
  game.robot = new Robot(game);
  game.actions = new ActionRegistry(game);
  game.actions.register(MopMode);
  Object.assign(game.robot, {
    roomId,
    x: start.x,
    y: start.y,
    heading: 0,
    state: 'clean',
    controlled: false,
    speed: 0,
    targetSpeed: 0,
    mopMode: true,
    battery: 1,
    bin: 0,
  });
  return game;
}

function spawnAgedPile(game, roomId, point) {
  const pile = game.dirt.spawn('poop', point.x, point.y, { roomId });
  pile.age = 5;
  pile.scale = pile.targetScale;
  return pile;
}

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

test('the exact living-room pile uses a collision-checked route, smears, then mops', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  try {
    const game = makePoopGame({
      roomId: 'living',
      start: { x: 412.9495, y: 318.1725 },
    });
    const pile = spawnAgedPile(game, 'living', {
      x: 1083.7507,
      y: 762.3829,
    });
    let plannedPath = null;
    let sawSplat = false;
    let sawTracking = false;
    let sawMopMode = false;

    for (let frame = 0; frame < 60 * 60; frame++) {
      Game.prototype.update.call(game, game.dt);
      if (!plannedPath && game.robot.fateTarget?.path) {
        plannedPath = game.robot.fateTarget.path.map((point) => ({ ...point }));
      }
      sawSplat ||= !game.dirt.items.includes(pile) && game.smears.count > 0;
      sawTracking ||= game.robot.smearKind === 'poop' && game.robot.smearT > 0;
      sawMopMode ||= game.actions.current?.name === 'mopMode';
      if (sawMopMode && game.smears.count === 0 && !game.actions.busy) break;
    }

    assert.ok(plannedPath?.length > 1, 'the blocked straight line should use routed waypoints');
    let from = { x: 412.9495, y: 318.1725 };
    const room = game.house.room('living');
    for (const waypoint of plannedPath) {
      assert.equal(
        game.robot.travelSegmentFree(room, from, waypoint),
        true,
        `fate segment ${from.x},${from.y} -> ${waypoint.x},${waypoint.y} must be clear`,
      );
      from = waypoint;
    }
    assert.equal(sawSplat, true, 'Robo should run over and splat the exact raw pile');
    assert.equal(sawTracking, true, 'the initial collision should dirty the wheels in mop mode too');
    assert.equal(sawMopMode, true, 'directed mopping should begin after the full tracking burst');
    assert.equal(game.dirt.items.includes(pile), false);
    assert.equal(game.smears.count, 0, 'the installed pads should finish the resulting cleanup');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('mandatory raw-pile approaches reach contact in either room at 30 and 60 Hz', () => {
  const scenarios = [
    {
      roomId: 'living',
      start: { x: 412.9495, y: 318.1725 },
      pile: { x: 1083.7507, y: 762.3829 },
    },
    {
      roomId: 'kitchen',
      start: { x: 175, y: 315 },
      pile: { x: 900, y: 850 },
    },
    {
      // The dog is smaller than Robo, so a valid potty spot can leave the
      // pile center too close to furniture for Robo's center. A nearby routed
      // contact point must still cross the splat radius.
      roomId: 'living',
      start: { x: 600, y: 700 },
      pile: { x: 280, y: 400 },
    },
    {
      roomId: 'living',
      start: { x: 454.4871170269123, y: 568.2428182179049 },
      pile: { x: 631.1807529827139, y: 896.985933680661 },
    },
    {
      roomId: 'living',
      start: { x: 1149.116288045351, y: 483.0908715366321 },
      pile: { x: 616.5032172276503, y: 652.4413646722893 },
    },
  ];

  for (const hz of [30, 60]) {
    for (const scenario of scenarios) {
      const game = makePoopGame({ hz, roomId: scenario.roomId, start: scenario.start });
      const pile = spawnAgedPile(game, scenario.roomId, scenario.pile);
      pile.fated = true;
      game.robot.fateTarget = {
        x: pile.x,
        y: pile.y,
        roomId: pile.roomId,
        pile,
      };

      let contacted = false;
      for (let frame = 0; frame < hz * 20; frame++) {
        game.time += game.dt;
        game.robot.update(game.dt);
        if (Math.abs(game.robot.speed) > 25 &&
            Math.hypot(game.robot.x - pile.x, game.robot.y - pile.y) < game.robot.radius * 0.85) {
          contacted = true;
          break;
        }
      }
      assert.equal(
        contacted,
        true,
        `${scenario.roomId} ${hz}Hz route from ${scenario.start.x},${scenario.start.y} ` +
          `to ${scenario.pile.x},${scenario.pile.y} should enter the raw-pile splat radius`,
      );
    }
  }
});

test('200 valid living-room dog placements all retain a drivable pile contact', () => {
  withSeed(0x5eedc0de, () => {
    const failures = [];
    for (let caseIndex = 0; caseIndex < 200; caseIndex++) {
      let game;
      let room;
      let start;
      let dog;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const candidateStart = {
          x: 120 + Math.random() * 1440,
          y: 260 + Math.random() * 680,
        };
        const candidateDog = {
          x: 120 + Math.random() * 1440,
          y: 410 + Math.random() * 510,
        };
        game = makePoopGame({ roomId: 'living', start: candidateStart });
        room = game.house.room('living');
        if (!room.isFree(candidateStart.x, candidateStart.y, game.robot.radius) ||
            !room.isHudFree(candidateStart.x, candidateStart.y, game.robot.radius) ||
            !room.isFree(candidateDog.x, candidateDog.y, 60, { solidTable: true }) ||
            !room.isHudFree(candidateDog.x, candidateDog.y, 60) ||
            Math.hypot(
              candidateStart.x - candidateDog.x,
              candidateStart.y - candidateDog.y,
            ) <= 200) {
          continue;
        }
        start = candidateStart;
        dog = candidateDog;
        break;
      }
      assert.ok(start && dog, `case ${caseIndex} should find a valid authored setup`);

      const heading = Math.random() < 0.5 ? 0 : Math.PI;
      const pilePoint = {
        x: dog.x - Math.cos(heading) * 44,
        y: dog.y + 16,
      };
      const pile = spawnAgedPile(game, 'living', pilePoint);
      pile.fated = true;
      const angle = Math.atan2(pile.y - start.y, pile.x - start.x);
      const beyond = {
        x: pile.x + Math.cos(angle) * 150,
        y: pile.y + Math.sin(angle) * 150,
      };
      const target = room.isFree(beyond.x, beyond.y, 60) ? beyond : pile;
      game.robot.fateTarget = {
        x: target.x,
        y: target.y,
        roomId: 'living',
        pile,
      };

      let contacted = false;
      for (let frame = 0; frame < 60 * 60; frame++) {
        game.time += game.dt;
        game.robot.update(game.dt);
        if (Math.abs(game.robot.speed) > 25 &&
            Math.hypot(game.robot.x - pile.x, game.robot.y - pile.y) <
              game.robot.radius * 0.85) {
          contacted = true;
          break;
        }
      }
      if (!contacted) failures.push({ caseIndex, start, dog, pile: pilePoint });
    }
    assert.deepEqual(failures, []);
  });
});
