import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { WinParty } from '../src/game/actions/celebrations.js';
import { SockGrab, TidyToy } from '../src/game/actions/chores.js';
import { BubbleParty, HoverMode, Sneeze, TurboZoom, UnderCouch } from '../src/game/actions/stunts.js';
import { Trapped } from '../src/game/actions/trapped.js';
import { Dock } from '../src/game/entities/Dock.js';
import { Dog } from '../src/game/entities/Dog.js';

const noop = () => {};

function actionGame() {
  const livingPoint = { x: 310, y: 610 };
  const kitchenPoint = { x: 1310, y: 410 };
  const couch = {
    name: 'couch',
    cx: 330,
    cy: 858,
    w: 520,
    h: 340,
    foot: { x: 95, y: 762, w: 470, h: 200 },
  };
  const basket = { name: 'basket', cx: 1545, cy: 288, w: 170, h: 170 };
  const toybox = {
    name: 'toybox',
    cx: 1100,
    cy: 310,
    w: 230,
    h: 190,
    foot: { x: 1005, y: 260, w: 190, h: 115 },
  };
  const living = {
    id: 'living',
    bounds: { minX: 100, maxX: 500, minY: 245, maxY: 700 },
    furniture: [couch, basket, toybox],
    getFurniture: (name) => [couch, basket, toybox].find((item) => item.name === name) ?? null,
    randomFloorPoint: () => ({ ...livingPoint }),
    isFree: () => true,
  };
  const kitchen = {
    id: 'kitchen',
    bounds: { minX: 900, maxX: 1500, minY: 245, maxY: 900 },
    furniture: [],
    getFurniture: () => null,
    randomFloorPoint: () => ({ ...kitchenPoint }),
    isFree: () => true,
  };
  const floor = [
    { id: 1, type: 'sock', roomId: 'living', x: 280, y: 540, drop: 0, tint: '#8fd7ff' },
    {
      id: 2,
      type: 'toy_block',
      roomId: 'living',
      x: 360,
      y: 560,
      drop: 0,
      tint: '#ffe08a',
      vx: 0,
      vy: 0,
    },
  ];
  const spawned = [];
  const sparkles = [];
  const robot = {
    roomId: 'living',
    x: 300,
    y: 560,
    z: 0,
    heading: Math.PI / 2,
    radius: 62,
    battery: 1,
    speed: 0,
    targetSpeed: 0,
    trailMode: null,
    actionSuction: false,
    isRoomTraveling: () => false,
    setExpr: noop,
    faceAngle: () => true,
    driveTo: () => true,
    mouthPos: () => ({ x: 300, y: 540 }),
  };
  const game = {
    room: kitchen,
    house: {
      activeRoomId: 'kitchen',
      room: (roomId) => roomId === 'living' ? living : kitchen,
    },
    robot,
    dirt: {
      items: floor,
      remove(item) {
        const index = floor.indexOf(item);
        if (index >= 0) floor.splice(index, 1);
      },
      spawn(type, x, y, options = {}) {
        const item = { type, x, y, ...options };
        floor.push(item);
        spawned.push(item);
        return item;
      },
    },
    sound: new Proxy({}, { get: () => noop }),
    particles: new Proxy({
      sparkle(x, y, count, roomId) {
        sparkles.push({ x, y, count, roomId });
      },
    }, { get: (target, key) => target[key] ?? noop }),
    addBasketSock: noop,
    say: noop,
    celebrate: noop,
    shake: noop,
  };
  return { floor, game, kitchen, kitchenPoint, living, livingPoint, spawned, sparkles };
}

function startAction(definition, game) {
  const action = Object.create(definition);
  action.state = {};
  action.elapsed = 0;
  action.finished = false;
  action.start(game);
  return action;
}

test('chores and traps use the robot room while another room is viewed', () => {
  const { game, living } = actionGame();

  assert.equal(SockGrab.canRun(game), true);
  const sock = startAction(SockGrab, game);
  assert.equal(sock.state.roomId, 'living');
  assert.equal(sock.state.item.type, 'sock');
  assert.deepEqual(sock.state.basketTarget.effect, { x: 1545, y: 260.8 });

  assert.equal(TidyToy.canRun(game), true);
  const toy = startAction(TidyToy, game);
  assert.equal(toy.state.roomId, 'living');
  assert.equal(toy.state.toy.type, 'toy_block');
  assert.equal(living.isFree(toy.state.toyboxTarget.approach.x, toy.state.toyboxTarget.approach.y, 70, {
    solidTable: true,
  }), true);

  assert.equal(Trapped.canForce(game), true);
  const trapped = startAction(Trapped, game);
  assert.equal(trapped.state.roomId, 'living');
  assert.equal(trapped.state.kind, 'couch');

  game.robot.roomId = 'kitchen';
  game.room = living;
  game.house.activeRoomId = 'living';
  assert.equal(SockGrab.canRun(game), false, 'the viewed basket is not physically available');
  assert.equal(TidyToy.canRun(game), false, 'the viewed toybox is not physically available');
  assert.equal(Trapped.canForce(game), false, 'the viewed couch cannot trap a kitchen robot');
});

test('moving stunts retain physical-room geometry after the view changes', () => {
  const { game, kitchenPoint, living, livingPoint, spawned } = actionGame();

  const turbo = startAction(TurboZoom, game);
  assert.deepEqual(turbo.state.target, livingPoint);
  turbo.update(game, 1 / 60);
  assert.deepEqual(turbo.state.target, livingPoint);

  const bubbles = startAction(BubbleParty, game);
  assert.deepEqual(bubbles.state.target, livingPoint);
  bubbles.state.bubbles.push({ x: 80, y: 80, size: 30, age: 0, life: 3 });
  assert.equal(bubbles.onTap(game, 80, 80), false, 'offscreen bubbles do not consume kitchen taps');

  const hover = startAction(HoverMode, game);
  hover.state.phase = 'fly';
  hover.elapsed = 9;
  hover.update(game, 1 / 60);
  assert.deepEqual(hover.state.landing, livingPoint);

  const underCouch = startAction(UnderCouch, game);
  assert.equal(underCouch.state.roomId, 'living');
  assert.equal(underCouch.state.couch.name, 'couch');

  const sneeze = startAction(Sneeze, game);
  sneeze.state.t = 1.5;
  sneeze.update(game, 0.02);
  assert.equal(spawned.length, 3);
  assert.ok(spawned.every((item) => item.roomId === 'living'));
  assert.ok(spawned.every((item) => item.y <= living.bounds.maxY));

  assert.notDeepEqual(livingPoint, kitchenPoint);
});

test('the win party gleams in the robot room rather than the viewed room', () => {
  const { game, livingPoint, sparkles } = actionGame();
  game.robot.spinExtra = 0;
  game.robot.hop = noop;
  const party = startAction(WinParty, game);

  party.update(game, 0.2);

  assert.equal(party.state.roomId, 'living');
  assert.deepEqual(sparkles, [{ ...livingPoint, count: 2, roomId: 'living' }]);
});

test('an offscreen dog keeps moving and reacting physically but cannot be tapped', () => {
  const room = {
    id: 'living',
    bounds: { minX: 100, maxX: 1580, minY: 245, maxY: 950 },
    furniture: [],
    randomFloorPoint: () => ({ x: 700, y: 620 }),
    isFree: () => true,
    isHudFree: () => true,
    nearestFreePoint: (x, y) => ({ x, y }),
  };
  let chased = 0;
  const game = {
    house: { activeRoomId: 'kitchen', room: () => room },
    room: { ...room, id: 'kitchen' },
    robot: {
      roomId: 'living',
      state: 'clean',
      x: 900,
      y: 620,
      isRoomTraveling: () => false,
      onChased: () => chased++,
    },
    sound: new Proxy({}, { get: () => noop }),
    sfx: { play: () => true },
    particles: new Proxy({}, { get: () => noop }),
  };
  const dog = new Dog(game);
  game.dog = dog;
  Object.assign(dog, {
    roomId: 'living',
    state: 'walk',
    x: 300,
    y: 620,
    heading: 0,
    target: { x: 700, y: 620 },
  });

  dog.update(0.5);
  assert.ok(dog.x > 300, 'walking continues outside the selected room');
  assert.equal(dog.contains(dog.x, dog.y), false, 'offscreen geometry is not interactive');

  dog.state = 'sit';
  assert.equal(dog.startChase(), true);
  assert.equal(chased, 1, 'physical robot contact does not depend on the camera');
});

test('offscreen dock effects stay attached to the dock room', () => {
  const particles = [];
  const game = {
    robot: { roomId: 'kitchen' },
    particles: { add: (particle) => particles.push(particle) },
  };
  const dock = new Dock(game);

  dock.pullDust({ x: dock.x, y: dock.parkY });

  assert.equal(particles.length, 3);
  assert.ok(particles.every((particle) => particle.roomId === 'living'));
});

test('Game advances offscreen actors and routes poop in the robot room', () => {
  globalThis.window = { innerWidth: 1680, innerHeight: 1050 };
  const calls = { dock: 0, dog: 0, physicalFree: 0, viewedFree: 0 };
  const physicalRoom = {
    id: 'living',
    isFree() {
      calls.physicalFree++;
      return true;
    },
  };
  const room = {
    id: 'kitchen',
    update: noop,
    isFree() {
      calls.viewedFree++;
      return false;
    },
  };
  const pile = {
    type: 'poop',
    roomId: 'living',
    x: 760,
    y: 620,
    age: 5,
    drop: 0,
    fated: false,
  };
  const robot = {
    roomId: 'living',
    x: 300,
    y: 600,
    z: 0,
    radius: 62,
    speed: 0,
    smearT: 0,
    wetTrackCooldown: 0,
    state: 'clean',
    stayDocked: false,
    mopMode: false,
    battery: 1,
    bin: 0,
    trailMode: null,
    dockReason: null,
    roomTravel: null,
    update: noop,
    isRoomTraveling: () => false,
  };
  const game = {
    _lastW: 1680,
    _lastH: 1050,
    time: 0,
    dt: 1 / 60,
    userMode: 'vac',
    mopDirt: 0,
    mopComplained: false,
    pendingMop: false,
    pendingMopRoomId: null,
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
    room,
    house: {
      activeRoomId: 'kitchen',
      room: (roomId) => roomId === 'living' ? physicalRoom : room,
    },
    dock: {
      roomId: 'living',
      update: () => calls.dock++,
      anyAlert: () => false,
      canMop: () => true,
    },
    robot,
    dog: {
      roomId: 'living',
      state: 'sit',
      update: () => calls.dog++,
      pooping: () => false,
    },
    actions: {
      busy: false,
      current: null,
      update: noop,
      force: () => false,
      triggerByName: noop,
    },
    dirt: { items: [pile], update: noop },
    smears: {
      count: 0,
      update: noop,
      findPuddle: () => null,
      hasReadyForMop: () => false,
      wetContactAt: () => null,
    },
    milkBottle: { update: noop },
    ambience: { update: noop },
    particles: { update: noop },
    cutaway: { update: noop },
    hud: { update: noop },
    sound: new Proxy({}, { get: () => noop }),
    syncRoomInteractionState: noop,
    updateMatJam: noop,
    modeNeedsPads: Game.prototype.modeNeedsPads,
    modeHasVac: Game.prototype.modeHasVac,
    canWetClean: Game.prototype.canWetClean,
    messActive: Game.prototype.messActive,
    roomFurniture: Game.prototype.roomFurniture,
  };

  Game.prototype.update.call(game, 1 / 60);

  assert.deepEqual(calls, { dock: 1, dog: 1, physicalFree: 1, viewedFree: 0 });
  assert.equal(pile.fated, true);
  assert.equal(robot.fateTarget?.roomId, 'living');
});
