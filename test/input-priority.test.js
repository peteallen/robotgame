import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { MatJam } from '../src/game/actions/matJam.js';

const LIVING_DOORWAY = { targetRoomId: 'kitchen' };

function pointerScenario({ hudHit = false, robotX = 1540, robotY = 640 } = {}) {
  return {
    splash: { active: false },
    sound: { unlock() {} },
    time: 12,
    screenToWorld: (x, y) => ({ x, y }),
    hud: { hitTest: () => hudHit },
    robot: {
      roomId: 'living',
      x: robotX,
      y: robotY,
      z: 0,
      radius: 58,
      isRoomTraveling: () => false,
    },
    house: { activeRoomId: 'living', transition: null },
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

test('physical robot travel does not block input in the selected room', () => {
  const game = pointerScenario({ robotX: 1000, robotY: 700 });
  game.robot.isRoomTraveling = () => true;
  game.house.transition = { fromRoomId: 'living', toRoomId: 'kitchen' };

  Game.prototype.onPointerDown.call(game, 1540, 640);

  assert.deepEqual(game.pointerCapture, {
    kind: 'doorway',
    targetRoomId: 'kitchen',
  });

  let selectedRoom = null;
  game.hud.onTap = () => false;
  game.tapDock = () => false;
  game.showRoom = (roomId) => { selectedRoom = roomId; };
  Game.prototype.tap.call(game, 1540, 640);
  assert.equal(selectedRoom, 'kitchen');
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

test('a tap on a mat-jammed robot helps the running action before the generic robot reaction', () => {
  let genericRobotTaps = 0;
  let helpedHops = 0;
  const robot = {
    roomId: 'kitchen',
    x: 820,
    y: 620,
    z: 0,
    radius: 62,
    stayDocked: false,
    trapped: true,
    spinExtra: 0.05,
    speed: 0,
    targetSpeed: 0,
    isRoomTraveling: () => false,
    setExpr() {},
    hop(amount) {
      if (amount === 190) helpedHops++;
    },
  };
  const action = Object.create(MatJam);
  action.state = {
    phase: 'jammed',
    roomId: 'kitchen',
    t: 2,
    helped: false,
  };
  const game = {
    robot,
    house: { activeRoomId: 'kitchen', transition: null },
    hud: { onTap: () => false },
    dock: { roomId: 'living' },
    room: { tapDoorway: () => null },
    actions: {
      onTap(x, y) {
        return action.onTap(game, x, y);
      },
    },
    sound: {
      stopWheelGrind() {},
      happyBeeps() {},
    },
    particles: { hearts() {} },
    tapDock: Game.prototype.tapDock,
    tapRobot() {
      genericRobotTaps++;
    },
  };

  Game.prototype.tap.call(game, robot.x, robot.y);

  assert.equal(action.state.phase, 'recover');
  assert.equal(action.state.helped, true);
  assert.equal(helpedHops, 1);
  assert.equal(genericRobotTaps, 0);
});
