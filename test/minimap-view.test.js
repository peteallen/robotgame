import assert from 'node:assert/strict';
import test from 'node:test';

import { Minimap } from '../src/game/ui/Minimap.js';

const ROOM_CENTER = {
  living: { x: 1422, y: 947 },
  kitchen: { x: 1576, y: 947 },
};

function makeGame({ activeRoomId = 'living', robotRoomId = 'living' } = {}) {
  const calls = { showRoom: [], requestRoom: [] };
  const game = {
    scale: 1,
    offY: 0,
    dpr: 1,
    canvas: { clientHeight: 1050, height: 1050 },
    room: { id: activeRoomId },
    house: { activeRoomId, transition: null },
    robot: { roomId: robotRoomId, targetRoomId: null },
    showRoom(roomId, source) {
      calls.showRoom.push([roomId, source]);
      this.house.activeRoomId = roomId;
      this.room = { id: roomId };
    },
    requestRoom(...args) {
      calls.requestRoom.push(args);
    },
  };
  return { game, calls };
}

function noOpContext() {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) target[property] = () => {};
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

test('a minimap room tap changes the view without requesting robot travel', () => {
  const { game, calls } = makeGame();
  const minimap = new Minimap(game);

  assert.equal(minimap.onTap(ROOM_CENTER.kitchen.x, ROOM_CENTER.kitchen.y), true);
  assert.deepEqual(calls.showRoom, [['kitchen', 'map']]);
  assert.deepEqual(calls.requestRoom, []);
  assert.equal(game.house.activeRoomId, 'kitchen');
  assert.equal(game.robot.roomId, 'living');
});

test('the selected-room highlight and physical robot marker use separate rooms', () => {
  const { game } = makeGame({ activeRoomId: 'kitchen', robotRoomId: 'living' });
  const minimap = new Minimap(game);
  const tileStates = [];
  let markerRoomId = null;

  minimap.drawConnector = () => {};
  minimap.drawRoomTile = (_ctx, roomId, activeRoomId) => {
    tileStates.push({ roomId, activeRoomId });
  };
  minimap.drawRobotMarker = (_ctx, roomId) => {
    markerRoomId = roomId;
  };
  minimap.draw(noOpContext());

  assert.equal(minimap.activeRoomId(), 'kitchen');
  assert.equal(minimap.robotRoomId(), 'living');
  assert.deepEqual(tileStates, [
    { roomId: 'living', activeRoomId: 'kitchen' },
    { roomId: 'kitchen', activeRoomId: 'kitchen' },
  ]);
  assert.equal(markerRoomId, 'living');

  game.house.transition = { toRoomId: 'kitchen', elapsed: 0.25, duration: 1 };
  assert.deepEqual(minimap.readTransition(), {
    fromRoomId: 'living',
    toRoomId: 'kitchen',
    progress: 0.25,
  });
});
