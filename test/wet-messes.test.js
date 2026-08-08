import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanVictoryReady, Game } from '../src/game/Game.js';
import { ActionRegistry } from '../src/game/actions/ActionRegistry.js';
import { ModeSwitch, MopMode, WashTrip } from '../src/game/actions/dockTrips.js';
import { Dock } from '../src/game/entities/Dock.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';
import { Dog } from '../src/game/entities/Dog.js';
import { MilkBottle } from '../src/game/entities/MilkBottle.js';
import { Robot } from '../src/game/entities/Robot.js';
import { MilkField } from '../src/game/fx/MilkField.js';
import { Smears } from '../src/game/fx/Smears.js';
import House from '../src/game/world/House.js';

const noop = () => {};

function makeSmearGame(roomId = 'kitchen') {
  return {
    house: { activeRoomId: roomId },
    robot: { roomId },
    actions: { current: null },
    roomDirty: false,
    finalVacuumRoomId: 'living',
    pendingMop: false,
    pendingMopRoomId: null,
  };
}

function makeDogScenario(roomId) {
  const spawned = [];
  const vomit = [];
  const room = {
    id: roomId,
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    furniture: [],
    randomFloorPoint: () => ({ x: 620, y: 620 }),
    isFree: () => true,
    isHudFree: () => true,
    nearestFreePoint: (x, y) => ({ x, y }),
  };
  const game = {
    house: {
      activeRoomId: roomId,
      room: () => room,
    },
    room,
    robot: { roomId, x: 200, y: 300, isRoomTraveling: () => false },
    sfx: { play: () => true },
    sound: new Proxy({}, { get: () => noop }),
    particles: new Proxy({}, { get: () => noop }),
    dirt: {
      spawn(type, x, y, opts) {
        spawned.push({ type, x, y, ...opts });
      },
    },
    smears: {
      spillVomit(x, y, opts) {
        vomit.push({ x, y, ...opts });
      },
    },
  };
  const dog = new Dog(game);
  game.dog = dog;
  dog.roomId = roomId;
  dog.x = 320;
  dog.y = 620;
  dog.state = 'sit';
  return { game, dog, spawned, vomit };
}

function makeRealKitchenDogScenario() {
  const width = 1194;
  const height = 834;
  const game = {
    scale: Math.min(width / 1680, height / 1050),
    offX: 0,
    offY: 0,
    canvas: { clientHeight: height, height },
    dock: null,
    robot: { roomId: 'kitchen', x: 840, y: 650, isRoomTraveling: () => false },
    actions: { current: null },
    roomDirty: false,
    finalVacuumRoomId: null,
    pendingMop: false,
    pendingMopRoomId: null,
    sfx: { play: () => true },
    sound: new Proxy({}, { get: () => noop }),
    particles: new Proxy({}, { get: () => noop }),
    dirt: { items: [], spawn: noop },
  };
  game.house = new House(game);
  game.house.activate('kitchen');
  game.smears = new Smears(game);
  game.dog = new Dog(game);
  game.dog.roomId = 'kitchen';
  return game;
}

function runInstalledPadCleanup({ start, kind, spill, seconds = 30 }) {
  const game = {
    time: 0,
    dt: 1 / 60,
    freezeBattery: true,
    mopDirt: 0,
    pendingMop: false,
    pendingMopRoomId: 'kitchen',
    mopIncidentRoomId: null,
    actions: { current: { name: 'mopMode' } },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    sfx: { play: () => true },
    particles: new Proxy({}, { get: () => noop }),
    dirt: {
      items: [],
      find(predicate, roomId) {
        return this.items.find((item) =>
          (!roomId || item.roomId === roomId) && predicate(item));
      },
      findAny: (predicate = () => true) => game.dirt.items.find(predicate),
      hasIn: (roomId, predicate = () => true) =>
        game.dirt.items.some((item) => item.roomId === roomId && predicate(item)),
      trySuck: noop,
      nearestVac: () => null,
    },
    dog: {
      roomId: 'living', state: 'sit', pooping: () => false, startle: noop,
    },
    modeHasVac: () => false,
    say: noop,
    shake: noop,
    onPickup: noop,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.smears = new Smears(game);
  game.robot = new Robot(game);
  game.house.activate('kitchen');
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: start.x,
    y: start.y,
    heading: 0,
    state: 'action',
    controlled: true,
    mopMode: true,
    battery: 1,
    bin: 0,
    smearT: 0,
  });
  if (kind === 'vomit') {
    game.smears.spillVomit(spill.x, spill.y, { roomId: 'kitchen' });
  } else {
    game.smears.spillMilk(spill.x, spill.y, { roomId: 'kitchen', duration: 0 });
    // Let the finite pour settle into a representative full-size footprint
    // before testing Robo's route across it.
    for (let frame = 0; frame < 6 / game.dt; frame++) game.smears.update(game.dt);
  }

  const action = Object.create(MopMode);
  action.finished = false;
  action.state = {};
  action.start(game);
  for (let frame = 0; frame < seconds / game.dt; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.smears.update(game.dt);
    action.update(game, game.dt);
    game.smears.wipeAt(game.robot.x, game.robot.y, 64, game.robot.roomId);
    if (game.smears.count === 0) return game.time;
  }
  return Infinity;
}

function makeVacuumOnlyTrackingScenario(kind) {
  const forcedActions = [];
  let wipeCalls = 0;
  const room = {
    id: 'kitchen',
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    update: noop,
    isFree: () => true,
    collisionNormal: () => ({ nx: -1, ny: 0 }),
  };
  const game = {
    _lastW: 1680,
    _lastH: 1050,
    time: 0,
    dt: 1 / 60,
    freezeBattery: true,
    userMode: 'vac',
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
    fateT: 999,
    toyTidyT: 999,
    dogChaseT: 999,
    trapT: 999,
    autoEventT: 999,
    splash: { active: false, fading: false, update: noop },
    room,
    house: { activeRoomId: 'kitchen', room: () => room },
    dock: {
      x: 180,
      parkY: 300,
      roomId: 'kitchen',
      update: noop,
      anyAlert: () => false,
      canMop: () => true,
    },
    actions: {
      busy: false,
      current: null,
      update: noop,
      force(name) {
        forcedActions.push(name);
        return true;
      },
      triggerByName: noop,
    },
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    particles: new Proxy({ update: noop }, { get: (target, key) => target[key] ?? noop }),
    dirt: {
      items: [],
      update: noop,
      trySuck: noop,
      remove(item) {
        const index = this.items.indexOf(item);
        if (index >= 0) this.items.splice(index, 1);
      },
    },
    dog: { roomId: 'living', state: 'sit', update: noop, pooping: () => false },
    ambience: { update: noop },
    milkBottle: { update: noop },
    cutaway: { update: noop },
    hud: { update: noop },
    syncRoomInteractionState: noop,
    updateMatJam: noop,
    shake: noop,
    modeNeedsPads: Game.prototype.modeNeedsPads,
    modeHasVac: Game.prototype.modeHasVac,
    canWetClean: Game.prototype.canWetClean,
    messActive: Game.prototype.messActive,
  };
  game.smears = new Smears(game);
  const wipeAt = game.smears.wipeAt.bind(game.smears);
  game.smears.wipeAt = (...args) => {
    wipeCalls++;
    return wipeAt(...args);
  };
  game.robot = new Robot(game);
  Object.assign(game.robot, {
    roomId: 'kitchen',
    x: 300,
    y: 600,
    heading: 0,
    state: 'clean',
    controlled: true,
    speed: 120,
    targetSpeed: 120,
    battery: 1,
    bin: 0,
    mopMode: false,
  });

  if (kind === 'vomit') {
    game.smears.spillVomit(game.robot.x, game.robot.y, { roomId: 'kitchen' });
  } else {
    game.smears.splat(game.robot.x, game.robot.y, { roomId: 'kitchen', kind: 'poop' });
  }

  return {
    game,
    forcedActions,
    wipeCalls: () => wipeCalls,
  };
}

function updateGameFrames(game, frames, dt = 1 / 60) {
  for (let frame = 0; frame < frames; frame++) {
    Game.prototype.update.call(game, dt);
  }
}

function makeWetModeSelectionScenario() {
  const actionStarts = [];
  const cutaways = [];
  const game = {
    _lastW: 1680,
    _lastH: 1050,
    scale: 1,
    offX: 0,
    offY: 0,
    canvas: { clientHeight: 1050, height: 1050 },
    time: 0,
    dt: 1 / 60,
    freezeBattery: true,
    userMode: 'vac',
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
    fateT: 999,
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
      roomId: 'living', state: 'sit', update: noop, pooping: () => false, startle: noop,
    },
    ambience: { update: noop },
    milkBottle: { update: noop },
    cutaway: {
      done: false,
      show(kind) {
        cutaways.push(kind);
        this.done = true;
      },
      update: noop,
      dismiss() {
        this.done = false;
      },
    },
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
    requestMode: Game.prototype.requestMode,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.smears = new Smears(game);
  game.dirt = new DirtSystem(game);
  game.robot = new Robot(game);
  game.actions = new ActionRegistry(game);
  game.actions.register(ModeSwitch);
  game.actions.register(MopMode);

  const begin = game.actions.begin.bind(game.actions);
  game.actions.begin = (action) => {
    const started = begin(action);
    if (started) actionStarts.push({ name: action.name, pads: game.robot.mopMode });
    return started;
  };

  Object.assign(game.robot, {
    roomId: 'living',
    x: game.dock.approach.x,
    y: game.dock.approach.y,
    heading: Math.PI / 2,
    state: 'clean',
    controlled: false,
    pauseT: 999,
    speed: 0,
    targetSpeed: 0,
    mopMode: false,
    battery: 1,
    bin: 0,
  });
  game.smears.spillVomit(850, 790, { roomId: 'living' });
  return { game, actionStarts, cutaways };
}

test('dynamic milk and decal vomit are room-owned mop puddles that re-arm victory', () => {
  const game = makeSmearGame();
  const smears = new Smears(game);

  const spillId = smears.spillMilk(1240, 560, { roomId: 'kitchen', duration: 0 });

  const milk = smears.milkField(spillId);
  assert.ok(milk);
  assert.equal(milk.roomId, 'kitchen');
  assert.ok(milk.mass > 0);
  assert.equal(smears.findPuddle((item) => item.kind === 'milk')?.roomId, 'kitchen');
  assert.equal(game.roomDirty, true);
  assert.equal(game.finalVacuumRoomId, null);
  assert.equal(game.pendingMop, true);
  assert.equal(game.pendingMopRoomId, 'kitchen');

  smears.spillVomit(700, 700, { roomId: 'living' });
  const vomit = smears.items.filter((item) => item.kind === 'vomit');
  assert.ok(vomit.length >= 7);
  assert.ok(vomit.every((item) => item.roomId === 'living' && item.puddle));

  const wiped = smears.wipeAt(1240, 560, 180, 'kitchen');
  assert.ok(wiped > 0);
  assert.equal(smears.items.some((item) => item.kind === 'milk'), false);
  assert.equal(smears.items.some((item) => item.kind === 'vomit'), true);
});

test('the fridge only wobbles now that visible milk comes from the counter bottle', () => {
  const calls = [];
  const furniture = { name: 'fridge', cx: 1420, cy: 330, w: 284, h: 396 };
  const game = {
    room: { id: 'kitchen', activateFurniture: (name) => calls.push(['activate', name]) },
    roomFurniture: () => furniture,
    floorPointNear: () => ({ x: 1235, y: 560 }),
    smears: {
      spillMilk: (x, y, opts) => calls.push(['milk', x, y, opts.roomId]),
    },
    sound: new Proxy({}, { get: (_target, key) => () => calls.push(['sound', key]) }),
    particles: {
      burst: (x, y, kind) => calls.push(['burst', x, y, kind]),
      sparkle: (x, y) => calls.push(['sparkle', x, y]),
    },
    dirt: {
      spawn: () => calls.push(['unexpected dirt']),
      nearestVac: () => null,
    },
    robot: { x: 900, y: 600, notifyNewDirt: noop },
  };

  assert.equal(Game.prototype.tapKitchenFurniture.call(game, 'fridge'), true);
  assert.equal(calls.some((call) => call[0] === 'milk'), false);
  assert.equal(calls.some((call) => call[0] === 'unexpected dirt'), false);
  assert.ok(calls.some((call) => call[0] === 'sound' && call[1] === 'pop'));
});

test('three forgiving bottle pokes tip, topple, and start exactly one kitchen pour', () => {
  const calls = [];
  const island = { name: 'island', cx: 835, cy: 625, w: 530, h: 365, baseline: 804 };
  const room = {
    id: 'kitchen',
    furniture: [island],
    getFurniture: () => island,
    isFree: () => true,
  };
  const game = {
    time: 0,
    room,
    house: { activeRoomId: 'kitchen', room: () => room },
    sound: new Proxy({}, { get: (_target, key) => () => calls.push(['sound', key]) }),
    particles: new Proxy({}, { get: () => noop }),
    smears: {
      spillMilk(x, y, opts) {
        calls.push(['spill', x, y, opts]);
        return 'milk-test';
      },
      hasSpill: () => true,
    },
  };
  const bottle = new MilkBottle(game);

  bottle.poke();
  bottle.update(0.2);
  assert.equal(bottle.state, 'leaning');
  assert.equal(calls.some((call) => call[0] === 'spill'), false);
  bottle.poke();
  bottle.update(0.2);
  assert.equal(calls.some((call) => call[0] === 'spill'), false);
  bottle.poke();
  for (let frame = 0; frame < 50; frame++) {
    game.time += 1 / 60;
    bottle.update(1 / 60);
  }

  const spills = calls.filter((call) => call[0] === 'spill');
  assert.equal(bottle.state, 'pouring');
  assert.equal(spills.length, 1);
  assert.deepEqual(spills[0].slice(1, 3), [1200, 575],
    'the visible pour should land naturally beyond the island');
  assert.equal(spills[0][3].roomId, 'kitchen');
  assert.equal(spills[0][3].duration > 2, true);
});

test('milk pours first, conserves volume, then spreads slowly to a bounded footprint', () => {
  const room = {
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    isFree: () => true,
  };
  const game = { robot: { radius: 62 }, house: { room: () => room } };
  const field = new MilkField(game, 1200, 575, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 2.65,
  });
  const footprint = () => {
    const points = [];
    for (let index = 0; index < field.height.length; index++) {
      if (field.height[index] > 0.0015) points.push(field.cellPoint(index));
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      cells: points.length,
      span: points.length
        ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
        : 0,
    };
  };

  for (let frame = 0; frame < 15; frame++) field.update(1 / 30);
  const early = footprint();
  assert.ok(early.span >= 72 && early.span <= 120, `early span ${early.span}`);
  assert.ok(field.remainingSource > 0, 'the bottle should still be pouring at half a second');

  for (let frame = 15; frame < 300; frame++) field.update(1 / 30);
  const settled = footprint();
  assert.ok(settled.span >= 216 && settled.span <= 288, `settled span ${settled.span}`);
  assert.ok(settled.cells < 110, `settled cells ${settled.cells}`);
  assert.ok(Math.abs(field.mass - 9) < 0.00002, `mass ${field.mass}`);
});

test('padless wheel tracks stretch milk while conserving its volume', () => {
  const room = {
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    isFree: () => true,
  };
  const game = { robot: { radius: 62 }, house: { room: () => room } };
  const field = new MilkField(game, 1200, 575, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 0,
  });
  for (let frame = 0; frame < 240; frame++) field.update(1 / 30);

  const initialCells = field.occupiedCellCount();
  const initialMass = field.height.reduce((sum, value) => sum + value, 0);
  const source = field.cellPoint(field.sourceIndex);
  const dragLine = (dx, dy) => {
    let from = source;
    for (let step = 1; step <= 5; step++) {
      const to = { x: source.x + dx * step, y: source.y + dy * step };
      assert.ok(field.transferAlong(from.x, from.y, to.x, to.y, 0.12) > 0);
      from = to;
    }
  };

  dragLine(0, 48);
  const firstPassCells = field.occupiedCellCount();
  dragLine(48, 0);
  const secondPassCells = field.occupiedCellCount();
  const finalMass = field.height.reduce((sum, value) => sum + value, 0);

  assert.ok(firstPassCells > initialCells, 'the first crossing should extend the wet footprint');
  assert.ok(secondPassCells > firstPassCells, 'another crossing should make the problem worse');
  assert.ok(Math.abs(finalMass - initialMass) < 0.000002,
    `tracked milk changed mass from ${initialMass} to ${finalMass}`);
});

test('repeated milk tracking still leaves targets that can clean every last trace', () => {
  const room = {
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    isFree: () => true,
  };
  const game = { robot: { radius: 62 }, house: { room: () => room } };
  const field = new MilkField(game, 800, 550, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 0,
  });
  for (let frame = 0; frame < 240; frame++) field.update(1 / 30);

  for (let pass = 0; pass < 10; pass++) {
    let from = field.cellPoint(field.sourceIndex);
    const angle = pass * 2.399;
    for (let step = 1; step <= 14; step++) {
      const to = {
        x: from.x + Math.cos(angle) * 24,
        y: from.y + Math.sin(angle) * 24,
      };
      field.transferAlong(from.x, from.y, to.x, to.y, 0.08);
      field.update(1 / 30);
      from = to;
    }
    for (let frame = 0; frame < 96; frame++) field.update(1 / 30);
  }

  let wipes = 0;
  while (field.active && wipes < 200) {
    const target = field.mopTargets()[0];
    assert.ok(target, `active milk lost its cleanup target after ${wipes} wipes`);
    field.wipeAt(target.x, target.y, 64);
    field.update(1 / 30);
    wipes++;
  }

  assert.equal(field.active, false, 'all tracked milk should be cleanable');
  assert.equal(field.mass, 0);
  assert.ok(wipes < 200, 'cleanup should finish without cycling forever');
});

for (const kind of ['poop', 'vomit']) {
  test(`vacuum-only contact progressively tracks ${kind}, then stops for a cooldown`, () => {
    const previousWindow = globalThis.window;
    globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
    try {
      const scenario = makeVacuumOnlyTrackingScenario(kind);
      const { game, forcedActions } = scenario;
      const initialCount = game.smears.count;

      updateGameFrames(game, 1);
      assert.equal(game.robot.smearKind, kind, 'floor contact should load the matching mess');
      assert.ok(game.robot.smearT > 0, 'contact should start a finite tracking burst');

      updateGameFrames(game, 90);
      const firstPassCount = game.smears.count;
      assert.ok(firstPassCount > initialCount, 'moving dirty wheels should add matching tracks');

      updateGameFrames(game, 180);
      const completedCount = game.smears.count;
      assert.ok(completedCount > firstPassCount, 'the mess should worsen as the burst continues');
      assert.ok(game.smears.items.slice(initialCount).every((item) => item.kind === kind));
      assert.ok(game.robot.smearT <= 0, 'wheel tracking must end after its bounded duration');
      assert.ok(game.robot.wetTrackCooldown > 0, 'the finished burst should arm a cooldown');
      assert.equal(
        game.smears.wetContactAt(
          game.robot.x,
          game.robot.y,
          game.robot.radius * 0.45,
          game.robot.roomId,
        )?.kind,
        kind,
        'Robo should still be touching its newest track when the cooldown starts',
      );

      updateGameFrames(game, 60);
      assert.equal(game.robot.smearT <= 0, true, 'fresh tracks cannot immediately retrigger');
      assert.equal(game.smears.count, completedCount, 'the cooldown keeps the burst finite');
      assert.equal(game.robot.mopMode, false, 'vacuum-only contact cannot install pads');
      assert.equal(scenario.wipeCalls(), 0, 'vacuum-only travel cannot mop the mess');
      assert.deepEqual(forcedActions, [], 'wet contact cannot request a dock or mop action');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });
}

test('the settled kitchen milk contour remains visible beside the wall-side trash can', () => {
  const game = { robot: { radius: 62 } };
  game.house = new House(game);
  game.house.activate('kitchen');
  const room = game.house.room('kitchen');
  const field = new MilkField(game, 1200, 575, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 0,
  });
  for (let frame = 0; frame < 300; frame++) field.update(1 / 30);

  const ctx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    quadraticCurveTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    ellipse: noop,
  };
  field.draw(ctx);
  const rightEdge = field.renderContours[0].coordinates
    .flat(2)
    .reduce((edge, point) => Math.max(
      edge,
      field.bounds.minX + (point[0] - 0.5) * field.cellSize,
    ), -Infinity);
  const trash = room.getFurniture('trash');
  const trashLeft = trash.cx - trash.w / 2;

  assert.ok(
    rightEdge <= trashLeft - 8,
    `milk contour at ${rightEdge} should clear trash artwork at ${trashLeft}`,
  );
});

test('milk renders its scalar field as a smooth conserved contour', () => {
  const room = {
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    isFree: () => true,
  };
  const game = { robot: { radius: 62 }, house: { room: () => room } };
  const field = new MilkField(game, 1200, 575, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 0,
  });
  for (let frame = 0; frame < 180; frame++) field.update(1 / 30);

  const calls = { curves: 0, fillRules: [] };
  const ctx = {
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    quadraticCurveTo() { calls.curves++; },
    closePath: noop,
    fill(rule) { calls.fillRules.push(rule); },
    stroke: noop,
    ellipse: noop,
  };
  const massBeforeDraw = field.mass;
  field.draw(ctx);

  assert.ok(calls.curves > 8, 'the puddle should use a rounded contour path');
  assert.ok(calls.fillRules.includes('evenodd'));
  assert.equal(field.mass, massBeforeDraw, 'rendering must not alter simulated milk volume');
});

test('milk refuses impossible source layouts instead of leaving permanent dirty work', () => {
  const room = {
    bounds: { minX: 100, maxX: 220, minY: 245, maxY: 365 },
    isFree: () => false,
  };
  const game = { robot: { radius: 62 }, house: { room: () => room } };
  const field = new MilkField(game, 160, 300, { roomId: 'kitchen' });

  assert.equal(field.failed, true);
  assert.equal(field.active, false);
  assert.equal(field.remainingSource, 0);
});

test('every accepted milk cleanup target has a route-planner-compatible approach', () => {
  const game = {
    scale: 1,
    offX: 0,
    offY: 0,
    canvas: { clientHeight: 1050, height: 1050 },
    robot: { radius: 62, roomId: 'living' },
    actions: { current: null },
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  const room = game.house.room('living');
  const field = new MilkField(game, 1330, 300, { roomId: 'living', duration: 0 });

  const targets = field.mopTargets();
  assert.ok(targets.length > 0);
  for (const target of targets) {
    const approaches = [{ x: target.x, y: target.y }];
    for (let index = 0; index < 16; index++) {
      const angle = index * Math.PI / 8;
      approaches.push({
        x: target.x + Math.cos(angle) * 48,
        y: target.y + Math.sin(angle) * 48,
      });
    }
    assert.equal(
      approaches.some((point) => room.isFree(point.x, point.y, 70)),
      true,
      `unreachable target ${target.x},${target.y}`,
    );
  }
});

test('milk blocks victory while pouring but defers automatic mopping until the source ends', () => {
  const game = makeSmearGame('kitchen');
  const smears = new Smears(game);
  game.smears = smears;
  const spillId = smears.spillMilk(1200, 575, {
    roomId: 'kitchen',
    totalVolume: 9,
    duration: 2.65,
  });
  const field = smears.milkField(spillId);
  const initialMass = field.mass;

  assert.equal(smears.count, 1, 'an active source is still whole-house wet work');
  assert.equal(game.roomDirty, true);
  assert.equal(game.pendingMop, false);
  assert.equal(smears.findPuddle(), undefined);
  assert.equal(smears.wipeAt(1200, 575, 180, 'kitchen'), 0);
  assert.equal(field.mass, initialMass, 'pads cannot consume the pour before it finishes');

  for (let frame = 0; frame < 90; frame++) smears.update(1 / 30);
  assert.equal(field.sourceActive, false);
  assert.equal(game.pendingMop, true);
  assert.equal(game.pendingMopRoomId, 'kitchen');
  assert.equal(smears.findPuddle()?.roomId, 'kitchen');
});

test('living-room dog taps keep poop while kitchen dog taps retch into vomit', () => {
  const living = makeDogScenario('living');
  assert.equal(living.dog.startPottyRun(), true);
  assert.equal(living.dog.messKind, 'poop');
  living.dog.x = living.dog.target.x;
  living.dog.y = living.dog.target.y;
  living.dog.update(1 / 60);
  assert.equal(living.dog.state, 'circling');
  living.dog.update(1.71);
  assert.equal(living.dog.state, 'squat');
  living.dog.update(1.41);
  assert.equal(living.spawned.length, 1);
  assert.equal(living.spawned[0].type, 'poop');
  assert.equal(living.vomit.length, 0);

  const kitchen = makeDogScenario('kitchen');
  assert.equal(kitchen.dog.startPottyRun(), true);
  assert.equal(kitchen.dog.messKind, 'vomit');
  kitchen.dog.x = kitchen.dog.target.x;
  kitchen.dog.y = kitchen.dog.target.y;
  kitchen.dog.update(1 / 60);
  assert.equal(kitchen.dog.state, 'retch');
  assert.equal(kitchen.dog.pooping(), true);
  kitchen.dog.update(0.91);
  assert.equal(kitchen.vomit.length, 1);
  assert.equal(kitchen.vomit[0].roomId, 'kitchen');
  assert.equal(kitchen.spawned.length, 0);
  kitchen.dog.update(0.7);
  assert.equal(kitchen.dog.state, 'recover');
  assert.equal(kitchen.dog.pooping(), true);
  kitchen.dog.update(0.96);
  assert.equal(kitchen.dog.state, 'walk');
  assert.equal(kitchen.dog.pooping(), false);
});

test('projected kitchen vomit stays reachable around the island and bin', () => {
  const game = makeRealKitchenDogScenario();
  const room = game.room;
  // These poses previously projected the puddle into the island or trash-bin
  // footprint when the dog happened to face right.
  const poses = [
    { x: 541, y: 549, heading: 0 },
    { x: 1205, y: 609, heading: 0 },
  ];

  for (const pose of poses) {
    game.smears.items.length = 0;
    game.pendingMop = false;
    game.pendingMopRoomId = null;
    Object.assign(game.dog, {
      ...pose,
      state: 'retch',
      stateT: 0,
      messKind: 'vomit',
      delivered: false,
      vomitSpot: { heading: pose.heading },
    });

    game.dog.reconcileHudAvoidance();
    const anchor = { ...game.dog.vomitSpot };
    assert.equal(
      room.isFree(anchor.x, anchor.y, 76, { ignoreDock: true, solidTable: true }),
      true,
      `planned anchor for ${pose.x},${pose.y}`,
    );

    game.dog.update(0.91);
    assert.equal(game.smears.items.length, 9);
    for (const item of game.smears.items) {
      assert.ok(
        Math.hypot(item.x - anchor.x, item.y - anchor.y) <= 54,
        'every component must be within one 64-unit mop pass of the valid anchor',
      );
    }
  }
});

test('kitchen dog routes around furniture before retching at its chosen destination', () => {
  const game = makeRealKitchenDogScenario();
  const target = { x: 980, y: 844 };
  Object.assign(game.dog, {
    roomId: 'kitchen',
    x: 350,
    y: 500,
    heading: 0,
    state: 'goPotty',
    stateT: 0,
    messKind: 'vomit',
    delivered: false,
    target,
    vomitSpot: game.dog.vomitPlanAt(target.x, target.y, 0),
  });

  let plannedWaypointCount = 0;
  for (let frame = 0; frame < 600 && game.dog.state !== 'retch'; frame++) {
    game.dog.update(1 / 60);
    plannedWaypointCount = Math.max(plannedWaypointCount, game.dog.pottyRoute?.length ?? 0);
    assert.equal(
      game.room.isFree(game.dog.x, game.dog.y, 62, { solidTable: true }),
      true,
      `the dog's body must stay off kitchen furniture on frame ${frame}`,
    );
  }

  assert.ok(plannedWaypointCount > 1, 'the island-crossing line should be replaced by a detour');
  assert.equal(game.dog.state, 'retch');
  assert.deepEqual({ x: game.dog.x, y: game.dog.y }, target);
  game.dog.update(0.91);
  assert.equal(game.smears.items.filter((item) => item.kind === 'vomit').length, 9);
});

test('a nearby kitchen vomit destination completes instead of becoming an orbit', () => {
  const game = makeRealKitchenDogScenario();
  const target = { x: 306.1, y: 570 };
  Object.assign(game.dog, {
    roomId: 'kitchen',
    x: 320,
    y: 620,
    heading: 0,
    state: 'goPotty',
    stateT: 0,
    messKind: 'vomit',
    delivered: false,
    target,
    vomitSpot: game.dog.vomitPlanAt(target.x, target.y, 0),
  });

  for (let frame = 0; frame < 120 && game.dog.state !== 'retch'; frame++) {
    game.dog.update(1 / 60);
    assert.equal(
      game.room.isFree(game.dog.x, game.dog.y, 62, { solidTable: true }),
      true,
    );
  }

  assert.equal(game.dog.state, 'retch');
  assert.deepEqual({ x: game.dog.x, y: game.dog.y }, target);
  game.dog.update(0.91);
  assert.equal(game.smears.items.filter((item) => item.kind === 'vomit').length, 9);
});

test('cross-room puddles remain mop targets and block whole-house victory', () => {
  const game = makeSmearGame('living');
  game.house.room = () => ({});
  game.smears = new Smears(game);
  game.smears.spillMilk(1200, 560, { roomId: 'kitchen', duration: 0 });
  game.dirt = { hasIn: () => false, findAny: () => null, items: [] };
  game.pendingMopRoomId = 'kitchen';
  game.mopIncidentRoomId = null;
  game.sound = { alarm: noop };
  game.shake = noop;
  game.robot = {
    roomId: 'living',
    state: 'clean',
    stayDocked: false,
    smearT: 0,
    mopMode: true,
    targetSpeed: 0,
    setExpr: noop,
  };

  MopMode.start(game);
  assert.equal(MopMode.state.incidentRoomId, 'kitchen');

  game.actions = { busy: false };
  game.pendingMop = false;
  game.dog = { pooping: () => false };
  assert.equal(cleanVictoryReady(game, game.robot), false);

  game.smears.wipeAt(1200, 560, 180, 'kitchen');
  assert.equal(game.smears.count, 0);
  assert.equal(cleanVictoryReady(game, game.robot), true);
});

test('vacuum-only waits for Theo to select a mop mode before installing pads and cleaning', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  try {
    for (const selectedMode of ['mop', 'both']) {
      const { game, actionStarts, cutaways } = makeWetModeSelectionScenario();
      const spillCount = game.smears.count;

      updateGameFrames(game, 120);
      assert.deepEqual(actionStarts, [], `${selectedMode}: the incident cannot start an action`);
      assert.equal(game.actions.current, null);
      assert.equal(game.robot.mopMode, false, `${selectedMode}: vacuum-only cannot install pads`);
      assert.equal(game.smears.count, spillCount, `${selectedMode}: the wet mess must persist`);
      assert.equal(game.pendingMop, true, `${selectedMode}: cleanup must remain queued`);

      game.requestMode(selectedMode);
      for (let frame = 0; frame < 45 / game.dt && game.smears.count > 0; frame++) {
        Game.prototype.update.call(game, game.dt);
      }

      assert.deepEqual(actionStarts, [
        { name: 'modeSwitch', pads: false },
        { name: 'mopMode', pads: true },
      ], `${selectedMode}: the normal pad service must finish before directed cleanup`);
      assert.deepEqual(cutaways, ['install']);
      assert.equal(game.robot.mopMode, true);
      assert.equal(game.pendingMop, false);
      assert.equal(game.smears.count, 0, `${selectedMode}: directed mopping must remove the spill`);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('wet cleanup cannot override the selected mode or install pads', () => {
  const policy = (selectedPads, installedPads) => MopMode.canForce({
    robot: { mopMode: installedPads },
    modeNeedsPads: () => selectedPads,
  });
  assert.equal(policy(false, false), false, 'vacuum-only stays vacuum-only');
  assert.equal(policy(false, true), false, 'selecting vacuum stops wet cleanup immediately');
  assert.equal(policy(true, false), false, 'an incident cannot install missing pads');
  assert.equal(policy(true, true), true, 'an equipped mop mode can clean in place');

  const robot = {
    roomId: 'kitchen',
    mopMode: true,
    targetSpeed: 0,
    actionDockOk: false,
    setExpr: noop,
  };
  const game = {
    robot,
    modeNeedsPads: () => true,
    smears: { hasIn: () => true, findAny: () => ({ roomId: 'kitchen' }) },
    dirt: { hasIn: () => false, findAny: () => null },
    house: { room: () => ({}) },
  };
  const action = Object.create(MopMode);
  action.finished = false;
  action.state = {};
  action.start(game);

  assert.equal(action.state.phase, 'returnToIncident');
  assert.equal(robot.mopMode, true);
  assert.equal(robot.actionDockOk, false);
});

test('selecting vacuum during cross-room wet cleanup finishes the doorway before mode service', () => {
  let selectedMode = 'both';
  const game = {
    time: 0,
    dt: 1 / 60,
    freezeBattery: true,
    mopDirt: 0,
    pendingMop: false,
    pendingMopRoomId: 'kitchen',
    mopIncidentRoomId: null,
    sound: new Proxy({ ready: false }, {
      get: (target, key) => key in target ? target[key] : noop,
    }),
    sfx: { play: () => true },
    particles: new Proxy({}, { get: () => noop }),
    dirt: {
      items: [],
      findAny: () => null,
      hasIn: () => false,
      trySuck: noop,
    },
    dog: {
      roomId: 'living', state: 'sit', pooping: () => false, startle: noop,
    },
    cutaway: { dismiss: noop },
    modeNeedsPads: () => selectedMode !== 'vac',
    modeHasVac: () => selectedMode !== 'mop',
    canWetClean: Game.prototype.canWetClean,
    say: noop,
    shake: noop,
    onPickup: noop,
  };
  game.dock = new Dock(game);
  game.house = new House(game);
  game.smears = new Smears(game);
  game.robot = new Robot(game);
  game.actions = new ActionRegistry(game);
  game.actions.register(MopMode);
  game.actions.register(ModeSwitch);
  game.house.activate('living');
  Object.assign(game.robot, {
    roomId: 'living',
    x: 1100,
    y: 700,
    heading: 0,
    state: 'clean',
    mopMode: true,
    battery: 1,
    bin: 0,
  });
  game.smears.spillVomit(700, 700, { roomId: 'kitchen' });

  assert.equal(game.actions.force('mopMode'), true);
  let sawCrossing = false;
  for (let frame = 0; frame < 20 / game.dt; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.actions.update(game.dt);
    if (game.robot.roomTravel?.phase === 'cross') {
      sawCrossing = true;
      break;
    }
  }
  assert.equal(sawCrossing, true, 'wet cleanup should own a real doorway crossing');

  selectedMode = 'vac';
  for (let frame = 0; frame < 3 / game.dt && game.actions.busy; frame++) {
    game.time += game.dt;
    game.robot.update(game.dt);
    game.actions.update(game.dt);
  }

  assert.equal(game.robot.roomId, 'kitchen', 'the in-flight doorway handoff must finish');
  assert.equal(game.robot.roomTravel, null, 'the controlled trip cannot be orphaned');
  assert.equal(game.actions.busy, false, 'wet cleanup should release control on arrival');
  assert.equal(game.robot.controlled, false);
  assert.equal(game.robot.mopMode, true, 'mode selection does not silently change equipment');
  assert.equal(game.robot.state, 'clean', 'the mode-switch watchdog is unblocked');

  assert.equal(game.actions.force('modeSwitch'), true);
  assert.equal(game.actions.current?.name, 'modeSwitch');
});

test('wet cleanup waits for tracking and cannot preempt pad-service dock trips', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  try {
    for (const dockTrip of [ModeSwitch, WashTrip]) {
      const scenario = makeVacuumOnlyTrackingScenario('vomit');
      const { game, forcedActions } = scenario;
      game.userMode = 'both';
      game.robot.mopMode = true;
      game.robot.speed = 0;
      game.robot.targetSpeed = 0;
      game.robot.state = 'action';
      game.actions.busy = true;
      game.actions.current = dockTrip;

      updateGameFrames(game, 1);
      assert.equal(dockTrip.blocksWetCleanup, true);
      assert.deepEqual(
        forcedActions,
        [],
        `${dockTrip.name} must finish before directed wet cleanup starts`,
      );
    }

    const automaticWash = makeVacuumOnlyTrackingScenario('vomit');
    automaticWash.game.userMode = 'both';
    automaticWash.game.robot.mopMode = true;
    automaticWash.game.robot.controlled = false;
    automaticWash.game.robot.speed = 0;
    automaticWash.game.robot.targetSpeed = 0;
    automaticWash.game.robot.state = 'washpads';

    updateGameFrames(automaticWash.game, 1);
    assert.deepEqual(
      automaticWash.forcedActions,
      [],
      'directed wet cleanup cannot interrupt automatic pad washing at the dock',
    );
    assert.equal(automaticWash.game.robot.state, 'washpads');

    const scenario = makeVacuumOnlyTrackingScenario('poop');
    const { game, forcedActions } = scenario;
    game.userMode = 'both';
    game.roomDirty = false;
    game.robot.mopMode = true;
    game.robot.smearT = 2;
    game.robot.speed = 0;
    game.robot.targetSpeed = 0;
    game.robot.state = 'clean';

    updateGameFrames(game, 1);
    assert.deepEqual(forcedActions, [], 'directed cleanup must wait for dirty wheels to stop');
    assert.equal(MopMode.canForce(game), false);

    game.robot.smearT = 0;
    updateGameFrames(game, 1);
    assert.deepEqual(forcedActions, ['mopMode'], 'cleanup should start after tracking finishes');
    assert.equal(MopMode.canForce(game), true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('battery and summon returns suspend passive pad wiping immediately', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  try {
    for (const returnState of [
      { battery: 0.16, state: 'action', stayDocked: false },
      { battery: 1, state: 'godock', stayDocked: true },
    ]) {
      const scenario = makeVacuumOnlyTrackingScenario('vomit');
      const { game } = scenario;
      game.userMode = 'mop';
      Object.assign(game.robot, {
        ...returnState,
        mopMode: true,
        controlled: true,
        smearT: 0,
      });
      game.actions.busy = true;
      game.actions.current = { name: 'mopMode' };
      const wetBefore = game.smears.count;

      updateGameFrames(game, 1);

      assert.equal(game.smears.count, wetBefore);
      assert.equal(scenario.wipeCalls(), 0);
      assert.deepEqual(scenario.forcedActions, []);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('installed pads route around kitchen furniture to clean milk and vomit', () => {
  const milkSeconds = runInstalledPadCleanup({
    start: { x: 300, y: 640 },
    kind: 'milk',
    spill: { x: 1200, y: 575 },
  });
  assert.ok(milkSeconds < 22, `milk cleanup took ${milkSeconds}s`);

  const vomitSeconds = runInstalledPadCleanup({
    start: { x: 1213.47, y: 585.36 },
    kind: 'vomit',
    spill: { x: 485.18, y: 726.53 },
  });
  assert.ok(vomitSeconds < 15, `vomit cleanup took ${vomitSeconds}s`);
});
