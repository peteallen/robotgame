import assert from 'node:assert/strict';
import test from 'node:test';

import { ModeSwitch, WashTrip } from '../src/game/actions/dockTrips.js';

function dockTripScenario({
  actionDefinition = ModeSwitch,
  padsInstalled = false,
  requestedPads = true,
  mopDirt = 0,
} = {}) {
  let latestRequest = requestedPads;
  let cutawayDone = false;
  const cutaways = [];
  const travelTargets = [];
  const spoken = [];

  const robot = {
    x: 400,
    y: 500,
    roomId: 'kitchen',
    mopMode: padsInstalled,
    speed: 0,
    targetSpeed: 0,
    heading: 0,
    spinExtra: 0,
    actionDockOk: false,
    setExpr() {},
    faceAngle() { return true; },
    driveTo() { return true; },
    isRoomTraveling() { return false; },
    travelToRoomStep(roomId) {
      travelTargets.push(roomId);
      this.roomId = roomId;
      return true;
    },
  };
  const game = {
    robot,
    room: { id: 'kitchen' },
    mopDirt,
    modeNeedsPads: () => latestRequest,
    dock: {
      roomId: 'living',
      x: 300,
      parkY: 520,
      approach: { x: 300, y: 650 },
      cleanWater: 1,
      dirtyWater: 0,
      canMop: () => true,
    },
    cutaway: {
      show(mode) {
        cutaways.push(mode);
        cutawayDone = false;
      },
      get done() { return cutawayDone; },
      dismiss() {},
    },
    sound: {
      backupBeep() {},
      dockChime() {},
      tada() {},
    },
    particles: { sparkle() {} },
    say(line) { spoken.push(line); },
  };

  const action = Object.create(actionDefinition);
  action.finished = false;
  action.state = {};
  action.start(game);

  return {
    action,
    game,
    robot,
    cutaways,
    travelTargets,
    spoken,
    requestPads(value) { latestRequest = value; },
    finishCutaway() { cutawayDone = true; },
    arriveAtDock() {
      robot.roomId = 'living';
      robot.y = game.dock.parkY;
      action.state.dockPhase = 'back';
      action.update(game, 0.016);
    },
  };
}

function leaveAndReturn(scenario) {
  const { action, game } = scenario;
  action.update(game, 0.016);
  assert.equal(action.state.phase, 'return');
  action.update(game, 0.016);
}

test('a kitchen mode trip uses the latest request when it reaches the dock', () => {
  const scenario = dockTripScenario({ padsInstalled: false, requestedPads: true });

  scenario.requestPads(false);
  scenario.arriveAtDock();

  assert.equal(scenario.action.state.originRoomId, 'kitchen');
  assert.equal(scenario.action.state.phase, 'leave');
  assert.equal(scenario.robot.mopMode, false);
  assert.deepEqual(scenario.cutaways, [], 'no stale install animation should run');

  leaveAndReturn(scenario);
  assert.equal(scenario.action.finished, true);
  assert.equal(scenario.robot.roomId, 'kitchen');
  assert.deepEqual(scenario.travelTargets, ['kitchen']);
});

test('a mode change during service is reconciled at the dock with matching animations', () => {
  const scenario = dockTripScenario({ padsInstalled: false, requestedPads: true });
  scenario.arriveAtDock();
  assert.deepEqual(scenario.cutaways, ['install']);

  scenario.requestPads(false);
  scenario.finishCutaway();
  scenario.action.update(scenario.game, 0.016);

  assert.equal(scenario.robot.mopMode, true, 'the completed install animation is applied first');
  assert.equal(scenario.action.state.phase, 'service');
  assert.equal(scenario.action.state.serviceInstall, false);
  assert.deepEqual(scenario.cutaways, ['install', 'remove']);

  scenario.finishCutaway();
  scenario.action.update(scenario.game, 0.016);
  assert.equal(scenario.robot.mopMode, false);
  assert.equal(scenario.action.state.phase, 'leave');

  leaveAndReturn(scenario);
  assert.equal(scenario.action.finished, true);
  assert.equal(scenario.robot.roomId, 'kitchen');
  assert.deepEqual(scenario.travelTargets, ['kitchen']);
});

test('dirty installed pads still wash before the latest removal request', () => {
  const scenario = dockTripScenario({
    padsInstalled: true,
    requestedPads: false,
    mopDirt: 0.8,
  });
  scenario.arriveAtDock();

  assert.equal(scenario.action.state.phase, 'wash');
  assert.deepEqual(scenario.cutaways, ['wash']);
  assert.equal(scenario.robot.mopMode, true);

  scenario.finishCutaway();
  scenario.action.update(scenario.game, 4.6);
  assert.equal(scenario.game.mopDirt, 0);
  assert.equal(scenario.action.state.phase, 'service');
  assert.deepEqual(scenario.cutaways, ['wash', 'remove']);

  scenario.finishCutaway();
  scenario.action.update(scenario.game, 0.016);
  assert.equal(scenario.robot.mopMode, false);
  assert.equal(scenario.action.state.phase, 'leave');
});

test('a kitchen wash trip removes pads at the dock when the latest mode no longer needs them', () => {
  const scenario = dockTripScenario({
    actionDefinition: WashTrip,
    padsInstalled: true,
    requestedPads: true,
    mopDirt: 1,
  });
  scenario.arriveAtDock();
  assert.equal(scenario.action.state.originRoomId, 'kitchen');
  assert.equal(scenario.action.state.phase, 'wash');
  assert.deepEqual(scenario.cutaways, ['wash']);

  scenario.requestPads(false);
  scenario.finishCutaway();
  scenario.action.update(scenario.game, 4.6);

  assert.equal(scenario.game.mopDirt, 0);
  assert.equal(scenario.robot.mopMode, true, 'pads remain installed until removal is shown');
  assert.equal(scenario.action.state.phase, 'service');
  assert.equal(scenario.action.state.serviceInstall, false);
  assert.deepEqual(scenario.cutaways, ['wash', 'remove']);

  scenario.finishCutaway();
  scenario.action.update(scenario.game, 0.016);
  assert.equal(scenario.robot.mopMode, false);
  assert.equal(scenario.action.state.phase, 'leave');

  leaveAndReturn(scenario);
  assert.equal(scenario.action.finished, true);
  assert.equal(scenario.robot.roomId, 'kitchen');
  assert.deepEqual(scenario.travelTargets, ['kitchen']);
});
