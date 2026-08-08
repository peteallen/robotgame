import assert from 'node:assert/strict';
import test from 'node:test';

import { ActionRegistry } from '../src/game/actions/ActionRegistry.js';
import { HappyBeeps, SpinDance } from '../src/game/actions/celebrations.js';
import { HoverMode, Sneeze, UnderCouch } from '../src/game/actions/stunts.js';
import { Trapped } from '../src/game/actions/trapped.js';

test('interrupted spinning actions always clear their visual rotation', () => {
  for (const action of [SpinDance, HappyBeeps, Sneeze]) {
    const game = { robot: { spinExtra: 1.25 } };

    action.end(game);
    action.end(game);

    assert.equal(game.robot.spinExtra, 0, `${action.name} leaves no interrupted rotation behind`);
  }
});

function makeInterruptedGame() {
  const safe = { x: 980, y: 740 };
  const calls = { physicalNearest: 0, viewedNearest: 0, releases: [] };
  const physicalRoom = {
    id: 'kitchen',
    isFree(x, y, clearance) {
      assert.equal(clearance, 66);
      return x === safe.x && y === safe.y;
    },
    nearestFreePoint() {
      calls.physicalNearest++;
      return safe;
    },
  };
  const viewedRoom = {
    id: 'living',
    isFree: () => false,
    nearestFreePoint() {
      calls.viewedNearest++;
      return { x: 200, y: 200 };
    },
  };
  const robot = {
    roomId: 'kitchen',
    x: 500,
    y: 500,
    z: 96,
    vz: 12,
    radius: 62,
    speed: 80,
    targetSpeed: 60,
    controlled: true,
    roomTravel: null,
    allowUnderCouch: true,
    trapped: true,
    spinExtra: 0.4,
    release(reason) {
      calls.releases.push({
        reason,
        x: this.x,
        y: this.y,
        free: physicalRoom.isFree(this.x, this.y, this.radius + 4),
      });
      this.controlled = false;
    },
  };
  const game = {
    robot,
    room: viewedRoom,
    house: {
      room(roomId) {
        return roomId === 'kitchen' ? physicalRoom : viewedRoom;
      },
    },
    cancelPointerInteraction() {},
  };
  game.actions = new ActionRegistry(game);
  return { calls, game, physicalRoom, robot, safe };
}

for (const action of [HoverMode, UnderCouch, Trapped]) {
  test(`interrupting ${action.name} settles Robo in his physical room before docking`, () => {
    const { calls, game, physicalRoom, robot, safe } = makeInterruptedGame();
    game.actions.current = Object.create(action);

    assert.equal(game.actions.cancelCurrent({ dockReason: 'summon' }), true);

    assert.deepEqual({ x: robot.x, y: robot.y }, safe);
    assert.equal(physicalRoom.isFree(robot.x, robot.y, robot.radius + 4), true);
    assert.equal(robot.z, 0);
    assert.equal(robot.vz, 0);
    assert.equal(robot.speed, 0);
    assert.equal(robot.targetSpeed, 0);
    assert.equal(calls.physicalNearest, 1);
    assert.equal(calls.viewedNearest, 0, 'cleanup must not use the room Theo is viewing');
    assert.deepEqual(calls.releases, [{ reason: 'summon', ...safe, free: true }]);
    if (action === UnderCouch || action === Trapped) assert.equal(robot.allowUnderCouch, false);
    if (action === Trapped) {
      assert.equal(robot.trapped, false);
      assert.equal(robot.spinExtra, 0);
    }

    action.end(game);
    assert.deepEqual({ x: robot.x, y: robot.y }, safe);
    assert.equal(calls.physicalNearest, 1, 'repeated cleanup leaves an already-safe pose alone');
  });
}
