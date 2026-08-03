import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';

const LIVING_DOORWAY = { targetRoomId: 'kitchen' };

function pointerScenario({ hudHit = false, robotX = 1540, robotY = 640 } = {}) {
  return {
    splash: { active: false },
    sound: { unlock() {} },
    time: 12,
    screenToWorld: (x, y) => ({ x, y }),
    hud: { hitTest: () => hudHit },
    robot: {
      x: robotX,
      y: robotY,
      z: 0,
      radius: 58,
      isRoomTraveling: () => false,
    },
    house: { transition: null },
    room: {
      tapDoorway: (x, y) => x >= 1450 && x <= 1680 && y >= 430 && y <= 840
        ? LIVING_DOORWAY
        : null,
    },
    actions: {
      current: {
        name: 'trapped',
        grabbable: () => true,
        poke() {
          this.poked = true;
        },
      },
    },
    pointerDown: false,
    pointerCapture: null,
    robotDrag: null,
    pendingSockDrag: false,
    lastCrumb: null,
    downPos: null,
  };
}

test('a placed trapped robot on the living-room doorway runway can finish its rescue tap', () => {
  const game = pointerScenario();

  Game.prototype.onPointerDown.call(game, 1540, 640);

  assert.deepEqual(game.robotDrag, { moved: false });
  assert.equal(game.pointerDown, true);
  assert.equal(game.pointerCapture, null, 'the broad doorway target must not capture the robot press');

  Game.prototype.onPointerUp.call(game, 1540, 640);
  assert.equal(game.actions.current.poked, true, 'the release must reach the trapped rescue action');
  assert.equal(game.robotDrag, null);
});

test('doorway and HUD presses retain their normal capture behavior away from the trapped robot', () => {
  const doorwayGame = pointerScenario({ robotX: 1000, robotY: 700 });
  Game.prototype.onPointerDown.call(doorwayGame, 1540, 640);
  assert.deepEqual(doorwayGame.pointerCapture, {
    kind: 'doorway',
    targetRoomId: 'kitchen',
  });
  assert.equal(doorwayGame.robotDrag, null);

  const hudGame = pointerScenario({ hudHit: true });
  Game.prototype.onPointerDown.call(hudGame, 1540, 640);
  assert.deepEqual(hudGame.pointerCapture, { kind: 'hud' });
  assert.equal(hudGame.robotDrag, null, 'HUD controls remain above the room scene');
});

test('a bottle press is captured before it can become a floor crumb drag', () => {
  const game = pointerScenario({ robotX: 400, robotY: 700 });
  game.room.tapDoorway = () => null;
  game.milkBottle = {
    pokes: 0,
    contains: (x, y) => x >= 900 && x <= 1120 && y >= 330 && y <= 560,
    poke() { this.pokes++; },
  };

  Game.prototype.onPointerDown.call(game, 1020, 470);
  assert.deepEqual(game.pointerCapture, { kind: 'milkBottle' });
  assert.equal(game.lastCrumb, null);

  Game.prototype.onPointerUp.call(game, 1040, 482);
  assert.equal(game.milkBottle.pokes, 1);
  assert.equal(game.pointerCapture, null);
});
