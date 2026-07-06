// Trips back to the dock for the mop gear: swapping pads on/off (ModeSwitch),
// washing dirty pads (WashTrip), and the forced mop-the-mess emergency
// (MopMode). All lean on the shared dockManeuverStep back-in maneuver.
import { clamp } from '../core/math.js';
import { dockManeuverStep } from './helpers.js';

// ----------------------- equipment change trip (player picked a new mode) ---
export const ModeSwitch = {
  name: 'modeSwitch',
  weight: 0,
  canRun: () => false,
  maxDur: 60,
  start(g) {
    const r = g.robot;
    const install = g.modeNeedsPads();
    if (r.mopMode === install) {
      this.finished = true;
      return;
    }
    this.state = {
      phase: 'toDock', dockPhase: 'go', t: 0, install,
      // dirty pads get washed before coming off, like the real thing
      washFirst: !install && g.mopDirt > 0.3 && g.dock.canMop(),
    };
    r.actionDockOk = true;
    r.setExpr('determined', 4);
    g.say(install ? 'go_mop_install' : 'remove_pads');
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!st) return;
    st.t += dt;
    switch (st.phase) {
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          if (st.washFirst) {
            st.phase = 'wash';
            g.cutaway.show('wash');
            g.say('washing');
          } else {
            st.phase = 'service';
            g.cutaway.show(st.install ? 'install' : 'remove');
          }
          st.t = 0;
        }
        break;
      }
      case 'wash': {
        r.targetSpeed = 0;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 4.6), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 4.6), 0, 1);
        if (g.cutaway.done) {
          g.mopDirt = 0;
          st.phase = 'service';
          st.t = 0;
          g.cutaway.show(st.install ? 'install' : 'remove');
        }
        break;
      }
      case 'service': {
        r.targetSpeed = 0;
        if (g.cutaway.done) {
          r.mopMode = st.install;
          if (st.install) g.say('mop_installed');
          g.particles.sparkle(r.x, r.y + 20, 6);
          st.phase = 'leave';
          st.t = 0;
        }
        break;
      }
      case 'leave': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 24, 130, 26, { ignoreDock: true })) {
          this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    g.robot.actionDockOk = false;
    g.cutaway.dismiss();
  },
};

// -------------------------------- wash trip (pads dirty from mopping) -------
export const WashTrip = {
  name: 'washTrip',
  weight: 0,
  canRun: () => false,
  maxDur: 60,
  start(g) {
    const r = g.robot;
    if (!g.dock.canMop()) {
      // no water service — complain once, keep working with dirty pads
      g.say(g.dock.needsClean() ? 'clean_empty' : 'dirty_full', { force: true });
      g.sound.errorBuzz();
      g.mopComplained = true;
      this.state = { phase: 'giveup', t: 0 };
      return;
    }
    this.state = { phase: 'toDock', dockPhase: 'go', t: 0 };
    r.actionDockOk = true;
    r.setExpr('determined', 4);
    g.say('go_mop_wash');
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    if (!st) return;
    st.t += dt;
    switch (st.phase) {
      case 'giveup': {
        r.targetSpeed = 0;
        if (st.t > 1.2) this.finished = true;
        break;
      }
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          st.phase = 'wash';
          st.t = 0;
          g.cutaway.show('wash');
          g.say('washing');
        }
        break;
      }
      case 'wash': {
        r.targetSpeed = 0;
        r.spinExtra = Math.sin(st.t * 10) * 0.03;
        g.dock.cleanWater = clamp(g.dock.cleanWater - dt * (0.35 / 4.6), 0, 1);
        g.dock.dirtyWater = clamp(g.dock.dirtyWater + dt * (0.35 / 4.6), 0, 1);
        if (g.cutaway.done) {
          g.mopDirt = 0;
          r.spinExtra = 0;
          g.say('mop_done');
          g.sound.tada();
          g.particles.sparkle(r.x, r.y - 40, 10);
          r.setExpr('happy', 2);
          st.phase = 'leave';
          st.t = 0;
        }
        break;
      }
      case 'leave': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 24, 130, 26, { ignoreDock: true })) {
          this.finished = true;
        }
        break;
      }
    }
  },
  end(g) {
    g.robot.actionDockOk = false;
    g.robot.spinExtra = 0;
    g.cutaway.dismiss();
  },
};

// ---------------------------------------------- mop emergency (poopocalypse)
// Never picked randomly — the game FORCES it once the robot realizes what it
// has been driving through. Installs pads if needed and mops the mess; the
// wash trip and any pad removal follow on their own via the mode watchdogs.
export const MopMode = {
  name: 'mopMode',
  weight: 0,
  canRun: () => false,
  maxDur: 90,
  start(g) {
    const r = g.robot;
    this.state = { phase: 'notice', t: 0, dockPhase: null, beepT: 0, success: false };
    r.targetSpeed = 0;
    r.actionDockOk = true;
    r.setExpr('dizzy', 2.2);
    g.sound.alarm();
    g.shake(3);
  },
  update(g, dt) {
    const r = g.robot;
    const st = this.state;
    st.t += dt;
    switch (st.phase) {
      case 'notice': {
        // the horrified realization
        r.targetSpeed = 0;
        r.spinExtra = Math.sin(st.t * 24) * 0.05;
        if (st.t > 0.5 && !st.saidUhOh) {
          st.saidUhOh = true;
          g.say('uh_oh', { force: true });
        }
        if (st.t > 1.7) {
          r.spinExtra = 0;
          st.t = 0;
          if (r.mopMode) {
            // pads already on — straight to work
            r.setExpr('determined', 4);
            st.phase = 'mop';
          } else if (!g.dock.canMop()) {
            // no water service — complain and leave the mess for the human
            g.say(g.dock.needsClean() ? 'clean_empty' : 'dirty_full', { force: true });
            g.sound.errorBuzz();
            g.mopComplained = true;
            r.setExpr('sleepy', 2.5);
            st.phase = 'giveup';
          } else {
            g.say('go_mop_install');
            r.setExpr('determined', 4);
            st.phase = 'toDock';
            st.dockPhase = 'go';
          }
        }
        break;
      }
      case 'giveup': {
        r.targetSpeed = 0;
        if (st.t > 1.4) this.finished = true;
        break;
      }
      case 'toDock': {
        if (dockManeuverStep(g, st, dt)) {
          st.phase = 'install';
          st.t = 0;
          g.cutaway.show('install');
        }
        break;
      }
      case 'install': {
        // pads clip on at the dock (undercarriage cam shows the whole thing)
        r.targetSpeed = 0;
        if (g.cutaway.done) {
          r.mopMode = true;
          g.say('mop_installed');
          st.phase = 'leaveDock';
          st.t = 0;
        }
        break;
      }
      case 'leaveDock': {
        if (r.driveTo(g.dock.approach.x, g.dock.approach.y + 30, 130, 26, { ignoreDock: true })) {
          st.phase = 'mop';
          st.t = 0;
        }
        break;
      }
      case 'mop': {
        // ambient pad-wiping (in Game.update) does the cleaning — this just
        // drives the robot over every last smear
        const pile = g.dirt.find((d) => d.type === 'poop');
        const smear = g.smears.nearest(r.x, r.y);
        const target = smear || pile;
        if (!target) {
          st.success = true;
          g.mopDirt = 1; // filthy pads — the wash trip follows on its own
          g.sound.happyBeeps(2);
          this.finished = true;
          break;
        }
        r.driveTo(target.x, target.y, 165, 26);
        break;
      }
    }
  },
  end(g) {
    const r = g.robot;
    r.actionDockOk = false;
    r.spinExtra = 0;
    g.cutaway.dismiss();
    if (this.state?.success) {
      r.setExpr('happy', 2);
    }
  },
};
