import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanVictoryReady, Game } from '../src/game/Game.js';
import { DirtSystem } from '../src/game/entities/DirtSystem.js';

function victoryScenario(overrides = {}) {
  const robot = {
    roomId: 'kitchen',
    state: 'clean',
    dockReason: null,
    roomTravel: null,
    stayDocked: false,
    smearT: 0,
    ...overrides.robot,
  };
  const game = {
    robot,
    roomDirty: true,
    finalVacuumRoomId: null,
    actions: { busy: false },
    smears: { count: 0 },
    pendingMop: false,
    dog: { pooping: () => false },
    dirt: { items: [] },
    ...overrides.game,
  };
  return { game, robot };
}

test('the normal whole-house clean state remains eligible for the victory party', () => {
  for (const state of ['clean', 'seek']) {
    const { game, robot } = victoryScenario({ robot: { state } });
    assert.equal(cleanVictoryReady(game, robot), true);
  }
});

test('the pickup hook records the room only when vacuuming removed the final house item', () => {
  const game = {
    stats: { pickups: 0 },
    dirt: { items: [{ roomId: 'living' }] },
    robot: { roomId: 'kitchen', smearT: 0 },
    smears: { count: 0 },
    pendingMop: false,
    dog: { pooping: () => false },
    finalVacuumRoomId: null,
  };

  Game.prototype.onPickup.call(game, { roomId: 'kitchen' });
  assert.equal(game.stats.pickups, 1);
  assert.equal(game.finalVacuumRoomId, null);

  game.dirt.items.length = 0;
  Game.prototype.onPickup.call(game, { roomId: 'kitchen' });
  assert.equal(game.stats.pickups, 2);
  assert.equal(game.finalVacuumRoomId, 'kitchen');

  game.finalVacuumRoomId = null;
  game.smears.count = 1;
  Game.prototype.onPickup.call(game, { roomId: 'kitchen' });
  assert.equal(game.finalVacuumRoomId, null, 'an unfinished smear is still the final cleaning work');
});

test('new debris clears a pending final-vacuum marker', () => {
  const game = { roomDirty: false, finalVacuumRoomId: 'kitchen' };
  const dirt = new DirtSystem(game);

  dirt.spawn('crumbs', 100, 100, { roomId: 'living' });

  assert.equal(game.roomDirty, true);
  assert.equal(game.finalVacuumRoomId, null);
});

test('a final kitchen pickup lets a new bin or battery dock trip yield to victory', () => {
  for (const dockReason of ['bin', 'battery']) {
    const { game, robot } = victoryScenario({
      robot: { state: 'godock', dockReason },
      game: { finalVacuumRoomId: 'kitchen' },
    });
    assert.equal(cleanVictoryReady(game, robot), true);
  }
});

test('a final pickup can preempt only the automatic dock-owned doorway trip', () => {
  const dockTravel = {
    state: 'travel',
    dockReason: 'battery',
    roomTravel: { owner: 'state', reason: 'dock', targetRoomId: 'living' },
  };
  const { game, robot } = victoryScenario({
    robot: dockTravel,
    game: { finalVacuumRoomId: 'kitchen' },
  });
  assert.equal(cleanVictoryReady(game, robot), true);

  robot.roomTravel = { owner: 'state', reason: 'manual', targetRoomId: 'living' };
  assert.equal(cleanVictoryReady(game, robot), false);

  robot.roomTravel = { owner: 'controlled', reason: 'action', targetRoomId: 'living' };
  assert.equal(cleanVictoryReady(game, robot), false);
});

test('the dock exception is tied to the final pickup room and does not interrupt other work', () => {
  const { game, robot } = victoryScenario({
    robot: { state: 'godock', dockReason: 'battery' },
    game: { finalVacuumRoomId: 'kitchen' },
  });

  robot.roomId = 'living';
  assert.equal(cleanVictoryReady(game, robot), false, 'the robot has already left the cleaned room');

  robot.roomId = 'kitchen';
  robot.dockReason = 'summon';
  assert.equal(cleanVictoryReady(game, robot), false, 'a player summon remains authoritative');

  robot.dockReason = 'battery';
  game.actions.busy = true;
  assert.equal(cleanVictoryReady(game, robot), false, 'a running action is not interrupted');

  game.actions.busy = false;
  game.dirt.items.push({ roomId: 'living' });
  assert.equal(cleanVictoryReady(game, robot), false, 'remote debris still blocks house-wide victory');
});
