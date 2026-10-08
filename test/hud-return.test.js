import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game/Game.js';
import { Hud, HUD_HOME_BUTTON } from '../src/game/ui/Hud.js';

function makeHudGame() {
  const calls = { modes: [], summons: 0 };
  const game = {
    scale: 1,
    offY: 0,
    dpr: 1,
    canvas: { clientHeight: 1050, height: 1050 },
    house: { activeRoomId: 'living', transition: null },
    room: { id: 'living' },
    robot: {
      roomId: 'living',
      stayDocked: false,
      summon() { calls.summons++; },
    },
    requestMode(mode) { calls.modes.push(mode); },
    sound: {
      muted: false,
      toggleMute: () => false,
      ackBeep() {},
    },
  };
  return { game, calls, hud: new Hud(game) };
}

test('the large home control summons without changing cleaning mode', () => {
  for (const roomId of ['living', 'kitchen']) {
    const { game, calls, hud } = makeHudGame();
    game.house.activeRoomId = roomId;
    game.room.id = roomId;

    assert.equal(hud.hitTest(HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy), true);
    assert.equal(hud.onTap(HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy), true);
    assert.equal(calls.summons, 1);
    assert.deepEqual(calls.modes, []);
  }
});

test('the home hit halo is compact-safe and does not overlap the mode picker', () => {
  const compactScale = Math.min(844 / 1680, 390 / 1050);
  assert.ok(
    HUD_HOME_BUTTON.hitRadius * 2 * compactScale >= 44,
    'compact landscape still needs a 44 CSS pixel touch target',
  );

  const lastModeHitRight = 22 + 10 + 1 * 92 + 82 + 6;
  const homeHitLeft = HUD_HOME_BUTTON.cx - HUD_HOME_BUTTON.hitRadius;
  assert.ok(homeHitLeft > lastModeHitRight, 'home and the vacuum/mop switches must not overlap');

  const { hud } = makeHudGame();
  assert.equal(hud.hitTest(HUD_HOME_BUTTON.cx + 59, HUD_HOME_BUTTON.cy), true);
  assert.equal(hud.hitTest(HUD_HOME_BUTTON.cx + 61, HUD_HOME_BUTTON.cy), false);
});

test('HUD capture makes return-home available during robot room travel', () => {
  const { game, calls, hud } = makeHudGame();
  Object.assign(game, {
    hud,
    splash: { active: false },
    time: 12,
    screenToWorld: (x, y) => ({ x, y }),
    sound: { ...game.sound, unlock() {} },
    robot: {
      ...game.robot,
      x: 900,
      y: 700,
      z: 0,
      radius: 62,
      isRoomTraveling: () => true,
      summon() { calls.summons++; },
    },
    house: { activeRoomId: 'kitchen', transition: { progress: 0.2 } },
    room: { id: 'kitchen' },
    pointerDown: false,
    pointerCapture: null,
    robotDrag: null,
    pendingSockDrag: false,
    lastCrumb: null,
    downPos: null,
  });
  hud.game = game;
  hud.minimap.game = game;

  Game.prototype.onPointerDown.call(game, HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy);
  assert.deepEqual(game.pointerCapture, { kind: 'hud' });

  Game.prototype.onPointerUp.call(game, HUD_HOME_BUTTON.cx, HUD_HOME_BUTTON.cy);
  assert.equal(calls.summons, 1);
  assert.equal(game.pointerCapture, null);
});

test('vacuum and mop are independent switches that never both turn off', async () => {
  const { nextMode } = await import('../src/game/ui/Hud.js');
  assert.equal(nextMode('vac', 'mop'), 'both');
  assert.equal(nextMode('mop', 'vac'), 'both');
  assert.equal(nextMode('both', 'vac'), 'mop');
  assert.equal(nextMode('both', 'mop'), 'vac');
  assert.equal(nextMode('vac', 'vac'), 'vac');
  assert.equal(nextMode('mop', 'mop'), 'mop');
});

test('tapping the vacuum and mop switches requests the matching combined mode', () => {
  const { game, calls, hud } = makeHudGame();
  const vacX = 22 + 10 + 41;
  const mopX = 22 + 10 + 92 + 41;
  const y = 90 + 8 + 25;

  game.userMode = 'vac';
  hud.onTap(mopX, y);
  game.userMode = 'both';
  hud.onTap(vacX, y);
  game.userMode = 'mop';
  hud.onTap(vacX, y);
  assert.deepEqual(calls.modes, ['both', 'mop', 'both']);
});
