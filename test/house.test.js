import assert from 'node:assert/strict';
import test from 'node:test';

import House from '../src/game/world/House.js';
import KitchenRoom from '../src/game/world/KitchenRoom.js';
import {
  MINIMAP_BOUNDS,
  MINIMAP_SAFE_BOTTOM_PX,
  minimapVerticalOffset,
} from '../src/game/ui/Minimap.js';
import { Room, WORLD_H, WORLD_W } from '../src/game/world/Room.js';

function makeGame() {
  return {
    assets: { get: () => null },
    dock: null,
  };
}

function assertPoint(point, label) {
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), `${label} must be an { x, y } point`);
}

function assertRect(rect, label) {
  assert.ok(
    rect
      && Number.isFinite(rect.x)
      && Number.isFinite(rect.y)
      && Number.isFinite(rect.w)
      && Number.isFinite(rect.h)
      && rect.w > 0
      && rect.h > 0,
    `${label} must be a non-empty { x, y, w, h } rectangle`,
  );
}

function obstacleCenter(room) {
  for (const furniture of room.furniture) {
    if (furniture.foot) {
      return {
        x: furniture.foot.x + furniture.foot.w / 2,
        y: furniture.foot.y + furniture.foot.h / 2,
      };
    }
    if (furniture.legs?.length) {
      const leg = furniture.legs[0];
      return { x: leg.x + leg.w / 2, y: leg.y + leg.h / 2 };
    }
  }
  assert.fail(`${room.id} must contain at least one furniture collision footprint`);
}

test('the house contains the living room and kitchen and activates either one', () => {
  const house = new House(makeGame());

  assert.deepEqual([...house.rooms.keys()].sort(), ['kitchen', 'living']);
  assert.ok(house.room('living') instanceof Room);
  assert.ok(house.room('kitchen') instanceof KitchenRoom);
  assert.equal(house.activeRoomId, 'living');
  assert.equal(house.activeRoom, house.room('living'));

  house.activate('kitchen');
  assert.equal(house.activeRoomId, 'kitchen');
  assert.equal(house.activeRoom, house.room('kitchen'));

  house.activate('living');
  assert.equal(house.activeRoomId, 'living');
  assert.equal(house.activeRoom, house.room('living'));
});

test('the living room and kitchen doorway connection is reciprocal', () => {
  const house = new House(makeGame());
  const livingPortal = house.portal('living', 'kitchen');
  const kitchenPortal = house.portal('kitchen', 'living');

  assert.ok(livingPortal, 'living room must have a portal to the kitchen');
  assert.ok(kitchenPortal, 'kitchen must have a portal to the living room');
  assert.equal(house.connectedRoomId('living', livingPortal.id), 'kitchen');
  assert.equal(house.connectedRoomId('kitchen', kitchenPortal.id), 'living');
  assert.equal(house.pairedPortal('living', livingPortal.id), kitchenPortal);
  assert.equal(house.pairedPortal('kitchen', kitchenPortal.id), livingPortal);

  const outward = house.connection('living', 'kitchen');
  const homeward = house.connection('kitchen', 'living');
  assert.equal(outward.fromPortal, livingPortal);
  assert.equal(outward.toPortal, kitchenPortal);
  assert.equal(outward.arrivalEntry, kitchenPortal.entry);
  assert.equal(outward.arrival, kitchenPortal.arrival);
  assert.equal(homeward.fromPortal, kitchenPortal);
  assert.equal(homeward.toPortal, livingPortal);
  assert.equal(homeward.arrivalEntry, livingPortal.entry);
  assert.equal(homeward.arrival, livingPortal.arrival);
});

test('both sides of the doorway use drivable approach and arrival anchors', () => {
  const house = new House(makeGame());

  for (const [fromId, toId] of [['living', 'kitchen'], ['kitchen', 'living']]) {
    const room = house.room(fromId);
    const portal = house.portal(fromId, toId);

    assert.equal(room.portal(toId), portal);
    assertRect(portal.trigger, `${fromId} portal trigger`);
    assertRect(portal.opening, `${fromId} portal opening`);

    for (const anchorName of ['approach', 'threshold', 'entry', 'arrival']) {
      const anchor = portal[anchorName];
      assertPoint(anchor, `${fromId} portal ${anchorName}`);
      assert.equal(
        room.isFree(anchor.x, anchor.y, 46, { ignoreDock: true }),
        true,
        `${fromId} portal ${anchorName} must be reachable`,
      );
    }

    assertPoint(portal.exit, `${fromId} portal exit`);
  }
});

test('a completed transition moves the robot without replacing the selected room', () => {
  const house = new House(makeGame());
  const robot = { x: 0, y: 0, angle: 0, roomId: 'living' };

  for (const [fromId, toId] of [['living', 'kitchen'], ['kitchen', 'living']]) {
    house.activate(fromId);
    const destination = house.portal(toId, fromId);
    const transition = house.beginTransition(toId, {
      fromRoomId: fromId,
      duration: 1,
      robot,
    });

    assert.ok(transition, `${fromId} to ${toId} transition must start`);
    house.updateTransition(0.49);
    assert.equal(house.activeRoomId, fromId);

    house.updateTransition(0.02);
    assert.equal(house.activeRoomId, fromId);
    assert.equal(robot.roomId, toId, 'the robot crosses physically at the midpoint');

    house.updateTransition(0.49);
    assert.equal(house.transition, null);
    assert.equal(house.activeRoomId, fromId);
    assert.equal(robot.roomId, toId);
    assert.equal(robot.x, destination.arrival.x);
    assert.equal(robot.y, destination.arrival.y);
  }
});

test('a robot transition keeps the chosen camera frame stable', () => {
  const house = new House(makeGame());
  const robot = { x: 0, y: 0, angle: 0, roomId: 'living' };
  house.beginTransition('kitchen', {
    fromRoomId: 'living',
    duration: 1,
    robot,
  });

  house.updateTransition(0.49);
  house.activate('kitchen');
  for (const dt of [0, 0.02, 0.49]) {
    house.updateTransition(dt);
    const frame = house.transitionFrame();
    assert.equal(house.activeRoomId, 'kitchen');
    assert.equal(frame.roomId, 'kitchen');
    assert.equal(frame.room, house.room('kitchen'));
    assert.equal(frame.offsetX, 0);
    assert.equal(frame.sceneScale, 1);
    assert.equal(frame.alpha, 1);
    assert.equal(frame.overlayAlpha, 0);
  }

  const returnTrip = house.beginTransition('living', {
    fromRoomId: 'kitchen',
    duration: 1,
    robot,
  });
  assert.ok(returnTrip);
  house.activate('living');
  house.updateTransition(0.6);
  house.activate('kitchen');
  house.cancelTransition();
  assert.equal(house.activeRoomId, 'kitchen', 'cancelling travel also preserves the view');
  assert.equal(robot.roomId, 'kitchen', 'cancelling restores only the physical robot');

  const compactScale = Math.min(844 / WORLD_W, 390 / WORLD_H);
  const compactOffset = minimapVerticalOffset(compactScale, 0, 390);
  const bottomClearance = 390 - (MINIMAP_BOUNDS.y + compactOffset + MINIMAP_BOUNDS.h) * compactScale;
  assert.ok(
    bottomClearance >= MINIMAP_SAFE_BOTTOM_PX,
    'minimap must keep its compact-screen safe clearance at 844x390',
  );

  const tabletScale = Math.min(1194 / WORLD_W, 834 / WORLD_H);
  const tabletOffY = (834 - WORLD_H * tabletScale) / 2;
  assert.equal(
    minimapVerticalOffset(tabletScale, tabletOffY, 834),
    0,
    'tablet letterboxing must preserve the authored bottom-right composition',
  );
});

test('living room and kitchen collision maps keep the robot inside and out of furniture', () => {
  const house = new House(makeGame());

  for (const roomId of ['living', 'kitchen']) {
    const room = house.room(roomId);
    const bounds = room.bounds;
    const midX = (bounds.minX + bounds.maxX) / 2;
    const midY = (bounds.minY + bounds.maxY) / 2;

    assert.equal(room.isFree(bounds.minX - 1, midY, 0, { ignoreDock: true }), false);
    assert.equal(room.isFree(bounds.maxX + 1, midY, 0, { ignoreDock: true }), false);
    assert.equal(room.isFree(midX, bounds.minY - 1, 0, { ignoreDock: true }), false);
    assert.equal(room.isFree(midX, bounds.maxY + 1, 0, { ignoreDock: true }), false);

    const obstacle = obstacleCenter(room);
    assert.equal(
      room.isFree(obstacle.x, obstacle.y, 1, { ignoreDock: true }),
      false,
      `${roomId} furniture footprint must block movement`,
    );

    for (let sample = 0; sample < 12; sample++) {
      const floor = room.randomFloorPoint(46);
      assertPoint(floor, `${roomId} random floor point`);
      assert.equal(
        room.isFree(floor.x, floor.y, 46, { ignoreDock: true }),
        true,
        `${roomId} random floor points must be drivable`,
      );
    }
  }
});
