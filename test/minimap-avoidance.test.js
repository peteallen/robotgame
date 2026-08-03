import assert from 'node:assert/strict';
import test from 'node:test';

import { rectDist } from '../src/game/core/math.js';
import { Game } from '../src/game/Game.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';
import { Dog } from '../src/game/entities/Dog.js';
import { Smears } from '../src/game/fx/Smears.js';
import { Minimap } from '../src/game/ui/Minimap.js';
import {
  MINIMAP_BOUNDS,
  MINIMAP_SAFE_BOTTOM_PX,
  minimapPlayfieldBounds,
} from '../src/game/ui/minimapLayout.js';
import House from '../src/game/world/House.js';
import { WORLD_H, WORLD_W } from '../src/game/world/Room.js';

const VIEWPORTS = [
  { name: 'tablet landscape', width: 1194, height: 834 },
  { name: 'compact phone landscape', width: 844, height: 390 },
];

function makeGame({ width, height }) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H);
  const game = {
    scale,
    offX: (width - WORLD_W * scale) / 2,
    offY: (height - WORLD_H * scale) / 2,
    dpr: 1,
    canvas: { clientHeight: height, height },
    assets: { get: () => null },
    dock: null,
    robot: { roomId: 'living', x: 300, y: 650, state: 'clean' },
    particles: {},
    sfx: { play: () => true },
    sound: {},
  };
  game.house = new House(game);
  return game;
}

function recordingContext() {
  const translations = [];
  const context = new Proxy({}, {
    get(_target, property) {
      if (property === 'translate') {
        return (x, y) => translations.push({ x, y });
      }
      return () => {};
    },
    set() {
      return true;
    },
  });
  return { context, translations };
}

test('the minimap draw, hit target, and playfield exclusion share responsive bounds', () => {
  for (const viewport of VIEWPORTS) {
    const game = makeGame(viewport);
    const minimap = new Minimap(game);
    const bounds = minimapPlayfieldBounds(game);
    const { context, translations } = recordingContext();

    minimap.draw(context);

    assert.equal(bounds.x, MINIMAP_BOUNDS.x, viewport.name);
    assert.equal(bounds.y, MINIMAP_BOUNDS.y + minimap.verticalOffset(), viewport.name);
    assert.ok(
      translations.some(({ x, y }) => x === 0 && y === minimap.verticalOffset()),
      `${viewport.name} draw must use the same vertical offset as collision`,
    );
    assert.equal(minimap.hitTest(bounds.x, bounds.y), true, viewport.name);
    assert.equal(minimap.hitTest(bounds.x + bounds.w, bounds.y + bounds.h), true, viewport.name);
    assert.equal(minimap.hitTest(bounds.x - 0.01, bounds.y + bounds.h / 2), false, viewport.name);
    assert.equal(minimap.hitTest(bounds.x + bounds.w / 2, bounds.y - 0.01), false, viewport.name);

    const screenBottom = game.offY + (bounds.y + bounds.h) * game.scale;
    assert.ok(
      viewport.height - screenBottom >= MINIMAP_SAFE_BOTTOM_PX - 1e-9,
      `${viewport.name} minimap must clear the physical bottom safe edge`,
    );
  }
});

test('the opaque minimap area is not navigable in either room', () => {
  for (const viewport of VIEWPORTS) {
    const game = makeGame(viewport);
    const bounds = minimapPlayfieldBounds(game);
    const center = {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2,
    };

    for (const roomId of game.house.roomIds) {
      const room = game.house.room(roomId);
      assert.equal(
        room.isFree(center.x, center.y, 0, { ignoreDock: true }),
        false,
        `${viewport.name} ${roomId} floor beneath the map must be blocked`,
      );
      assert.equal(
        room.collisionNormal(center.x, center.y, 62, { ignoreDock: true })?.what,
        'hud',
        `${viewport.name} ${roomId} collision must identify the HUD`,
      );

      const tangent = { x: bounds.x - 62, y: center.y };
      assert.equal(room.isHudFree(tangent.x, tangent.y, 62), false, `${viewport.name} tangent`);
      assert.equal(
        room.collisionNormal(tangent.x, tangent.y, 62, { ignoreDock: true })?.what,
        'hud',
        `${viewport.name} tangent collision must agree with isHudFree`,
      );
    }
  }
});

test('random dirt and action targets keep their full clearance from the minimap', () => {
  for (const viewport of VIEWPORTS) {
    const game = makeGame(viewport);
    for (const roomId of game.house.roomIds) {
      const room = game.house.room(roomId);
      const hud = room.hudAvoidanceRect();

      for (const radius of [40, 70]) {
        const requiredClearance = Math.max(62, radius);
        for (let sample = 0; sample < 80; sample++) {
          const point = room.randomFloorPoint(radius);
          assert.ok(
            rectDist(point.x, point.y, hud) > requiredClearance,
            `${viewport.name} ${roomId} radius ${radius} sample must clear the map`,
          );
          assert.equal(
            room.isFree(point.x, point.y, radius, { ignoreDock: true }),
            true,
            `${viewport.name} ${roomId} radius ${radius} sample must remain usable`,
          );
        }
      }
    }
  }
});

test('a walking dog cannot cross into the minimap exclusion', () => {
  for (const viewport of VIEWPORTS) {
    const game = makeGame(viewport);
    const bounds = minimapPlayfieldBounds(game);
    const dog = new Dog(game);
    game.dog = dog;

    dog.roomId = 'living';
    dog.state = 'walk';
    dog.hurry = true;
    dog.heading = Math.PI / 2;
    dog.x = bounds.x + bounds.w / 2;
    dog.y = bounds.y - 63;
    dog.target = { x: dog.x, y: bounds.y + bounds.h / 2 };
    const previous = { x: dog.x, y: dog.y };

    dog.update(1 / 60);

    assert.deepEqual({ x: dog.x, y: dog.y }, previous, viewport.name);
    assert.equal(game.room.isHudFree(dog.x, dog.y, 62), true, viewport.name);
    assert.equal(game.room.isHudFree(dog.target.x, dog.target.y, 62), true, viewport.name);

    dog.state = 'goPotty';
    dog.target = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    dog.reconcileHudAvoidance();
    assert.ok(
      rectDist(dog.target.x, dog.target.y, bounds) > 114,
      `${viewport.name} potty retarget must preserve circling and rear clearance`,
    );
  }
});

test('player sprinkles and rolling toys cannot enter beneath the minimap', () => {
  const game = makeGame(VIEWPORTS[1]);
  game.roomDirty = false;
  game.finalVacuumRoomId = null;
  game.particles = { dustPuff() {}, sparkle() {} };
  game.sound = { boing() {} };
  game.dirt = new DirtSystem(game);
  const bounds = minimapPlayfieldBounds(game);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    game.dirt.playerSprinkle(bounds.x - 10, bounds.y + 50, 'living');
  } finally {
    Math.random = originalRandom;
  }
  assert.ok(game.dirt.items.length > 0);
  for (const item of game.dirt.items) {
    assert.ok(game.room.isHudFree(item.x, item.y, 24), 'sprinkle item must clear the card');
  }

  const toy = game.dirt.spawn('toy_ball', bounds.x - 25, bounds.y + 90, {
    roomId: 'living',
  });
  toy.scale = toy.targetScale;
  toy.vx = 180;
  toy.vy = 0;
  const safeX = toy.x;
  game.dirt.update(0.1);

  assert.equal(toy.x, safeX, 'toy must return to its last safe point');
  assert.ok(toy.vx < 0, 'toy must bounce away from the card');
  assert.equal(game.room.isHudFree(toy.x, toy.y, 24), true);
});

test('a compact resize relocates persistent actors and floor mess from the raised card', () => {
  const game = makeGame(VIEWPORTS[0]);
  game.robot = {
    roomId: 'living',
    x: 1500,
    y: 800,
    radius: 62,
    isRoomTraveling: () => false,
  };
  game.dirt = { items: [{ roomId: 'living', x: 1500, y: 840, sucking: false }] };
  game.smears = { items: [{ roomId: 'living', x: 1540, y: 840 }] };
  game.dog = new Dog(game);
  game.dog.state = 'sit';
  game.dog.x = 1450;
  game.dog.y = 800;

  const compact = VIEWPORTS[1];
  game.scale = Math.min(compact.width / WORLD_W, compact.height / WORLD_H);
  game.offX = (compact.width - WORLD_W * game.scale) / 2;
  game.offY = (compact.height - WORLD_H * game.scale) / 2;
  game.canvas.clientHeight = compact.height;
  game.canvas.height = compact.height;

  Game.prototype.reconcileMinimapOverlap.call(game);

  assert.equal(game.room.isHudFree(game.robot.x, game.robot.y, 62), true, 'robot');
  assert.equal(game.room.isHudFree(game.dog.x, game.dog.y, 62), true, 'dog');
  assert.equal(
    game.room.isHudFree(game.dirt.items[0].x, game.dirt.items[0].y, 24),
    true,
    'dirt',
  );
  assert.equal(
    game.room.isHudFree(game.smears.items[0].x, game.smears.items[0].y, 18),
    true,
    'smear',
  );
});

test('a compact resize during retching keeps the projected vomit outside the raised card', () => {
  const game = makeGame(VIEWPORTS[0]);
  game.robot.roomId = 'kitchen';
  game.robot.isRoomTraveling = () => false;
  game.house.activate('kitchen');
  game.actions = { current: null };
  game.roomDirty = false;
  game.finalVacuumRoomId = null;
  game.pendingMop = false;
  game.pendingMopRoomId = null;
  game.dirt = { items: [] };
  game.smears = new Smears(game);
  game.sound = new Proxy({}, { get: () => () => {} });
  game.particles = new Proxy({}, { get: () => () => {} });
  game.dog = new Dog(game);
  Object.assign(game.dog, {
    roomId: 'kitchen',
    state: 'retch',
    stateT: 0,
    messKind: 'vomit',
    delivered: false,
    heading: 0,
    // Safe beneath the tablet map, but the compact map rises into the future
    // puddle while leaving the dog's smaller body technically unobstructed.
    x: 1450,
    y: 764,
    vomitSpot: { heading: 0 },
  });
  game.dog.reconcileHudAvoidance();
  const tabletPlan = { ...game.dog.vomitSpot };
  assert.equal(game.room.isHudFree(tabletPlan.x, tabletPlan.y, 76), true, 'tablet plan');

  const compact = VIEWPORTS[1];
  game.scale = Math.min(compact.width / WORLD_W, compact.height / WORLD_H);
  game.offX = (compact.width - WORLD_W * game.scale) / 2;
  game.offY = (compact.height - WORLD_H * game.scale) / 2;
  game.canvas.clientHeight = compact.height;
  game.canvas.height = compact.height;

  Game.prototype.reconcileMinimapOverlap.call(game);

  const compactPlan = { ...game.dog.vomitSpot };
  assert.equal(game.room.isHudFree(compactPlan.x, compactPlan.y, 76), true, 'compact plan');
  game.dog.update(0.91);
  assert.equal(game.smears.items.length, 9);
  for (const item of game.smears.items) {
    const radius = Math.max(item.len, item.w) / 2 + 4;
    assert.equal(
      game.room.isHudFree(item.x, item.y, radius),
      true,
      'every painted vomit component must clear the resized minimap',
    );
    assert.ok(
      Math.hypot(item.x - compactPlan.x, item.y - compactPlan.y) <= 54,
      'every component remains reachable from the reserved mop anchor',
    );
  }
});

test('responsive minimap avoidance leaves every doorway travel anchor reachable', () => {
  for (const viewport of VIEWPORTS) {
    const game = makeGame(viewport);
    for (const roomId of game.house.roomIds) {
      const room = game.house.room(roomId);
      const portal = room.portal();
      for (const anchorName of ['approach', 'threshold', 'entry', 'arrival']) {
        const anchor = portal[anchorName];
        assert.equal(
          room.isFree(anchor.x, anchor.y, 46, { ignoreDock: true }),
          true,
          `${viewport.name} ${roomId} ${anchorName} must stay reachable`,
        );
      }
    }
  }
});
