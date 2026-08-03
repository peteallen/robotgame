import assert from 'node:assert/strict';
import test from 'node:test';

import { SockGrab } from '../src/game/actions/chores.js';

function makeGame() {
  const floor = [];
  const basket = [];
  const basketFurniture = { name: 'basket', cx: 700, cy: 300, w: 180, h: 120 };
  return {
    floor,
    basket,
    room: {
      id: 'living',
      bounds: { minX: 100, maxX: 1500, minY: 100, maxY: 900 },
      getFurniture: (name) => name === 'basket' ? basketFurniture : null,
      randomFloorPoint: () => ({ x: 260, y: 360 }),
      isFree: () => true,
    },
    robot: {
      x: 420,
      y: 500,
      roomId: 'living',
      faceAngle: () => true,
      setExpr() {},
    },
    dirt: {
      items: floor,
      find(predicate) {
        return floor.find(predicate);
      },
      remove(item) {
        const index = floor.indexOf(item);
        if (index >= 0) floor.splice(index, 1);
      },
      spawn(type, x, y, options) {
        const item = { type, x, y, ...options };
        floor.push(item);
        return item;
      },
    },
    addBasketSock(tint) {
      basket.push(tint);
    },
    sound: {
      ackBeep() {},
      whoosh() {},
      squeak() {},
      tada() {},
      pop() {},
      dockChime() {},
    },
    particles: {
      confettiBurst() {},
      sparkle() {},
    },
  };
}

function actionAtBasket() {
  const action = Object.create(SockGrab);
  action.state = {
    phase: 'deposit',
    t: 0,
    roomId: 'living',
    basketTarget: {
      face: { x: 700, y: 300 },
      drop: { x: 700, y: 250 },
      effect: { x: 700, y: 260 },
    },
    sock: { x: 680, y: 270, z: 0, tint: '#ff8fa3' },
    item: null,
    sockOwner: 'action',
    pickedUp: true,
    arm: { ext: 1, claw: 0, tx: 680, ty: 270, holding: true },
    dropZ: 0,
  };
  return action;
}

test('the action keeps exactly one sock owner before and after pickup', () => {
  const floorGame = makeGame();
  const original = { type: 'sock', x: 300, y: 400, drop: 0, tint: '#8fd7ff', roomId: 'living' };
  floorGame.floor.push(original);
  const floorAction = Object.create(SockGrab);

  floorAction.start(floorGame);
  floorAction.end(floorGame);
  floorAction.end(floorGame);

  assert.deepEqual(floorGame.floor, [original], 'a sock not yet picked up remains floor-owned');

  floorAction.state.phase = 'grab';
  floorAction.state.t = 0;
  floorAction.update(floorGame, 0.36);
  assert.equal(floorGame.floor.length, 0, 'pickup transfers the original sock out of the floor system');

  floorAction.end(floorGame);
  floorAction.end(floorGame);
  assert.equal(floorGame.floor.length, 1, 'interrupting after pickup restores one floor sock');
  assert.equal(floorGame.floor[0].tint, '#8fd7ff');

  const incomingGame = makeGame();
  const incomingAction = Object.create(SockGrab);
  incomingAction.start(incomingGame);
  incomingAction.end(incomingGame);
  incomingAction.end(incomingGame);

  assert.equal(incomingGame.floor.length, 1, 'an interrupted fly-in sock materializes exactly once');
  assert.equal(incomingGame.floor[0].x, 260);
  assert.equal(incomingGame.floor[0].y, 360);
});

test('interrupting the visible basket drop returns the sock to the floor exactly once', () => {
  const game = makeGame();
  const action = actionAtBasket();

  action.update(game, 0.01);

  assert.equal(action.state.phase, 'release');
  assert.equal(action.state.arm.holding, false, 'the open claw must preserve the drop animation');
  assert.equal(game.basket.length, 0, 'the falling sock is not in the basket yet');

  action.end(game);
  action.end(game);

  assert.equal(game.floor.length, 1, 'a repeated interruption must create only one floor sock');
  assert.equal(game.floor[0].tint, '#ff8fa3');
  assert.equal(game.floor[0].roomId, 'living');
  assert.equal(game.basket.length, 0);
});

test('after the visible drop commits, interruption cannot duplicate the basket sock', () => {
  const game = makeGame();
  const action = actionAtBasket();

  action.update(game, 0.01);
  action.update(game, 0.24);

  assert.equal(action.state.released, true);
  assert.deepEqual(game.basket, ['#ff8fa3']);

  action.end(game);
  action.end(game);

  assert.equal(game.floor.length, 0);
  assert.deepEqual(game.basket, ['#ff8fa3']);
});
