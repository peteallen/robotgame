// Weighted random pick of tap-actions, avoiding immediate repeats so every
// tap feels like a new surprise.
export class ActionRegistry {
  constructor(game) {
    this.game = game;
    this.actions = [];
    this.current = null;
    this.recent = [];
    this.cooldown = 0;
  }

  register(action) {
    this.actions.push(action);
  }

  get busy() {
    return !!this.current;
  }

  batteryCritical() {
    const robot = this.game.robot;
    if (typeof robot?.isBatteryCritical === 'function') return robot.isBatteryCritical();
    return Number.isFinite(robot?.battery) && robot.battery <= 0.16;
  }

  actionStartBlocked() {
    return this.batteryCritical() || !!this.game.robot?.stayDocked;
  }

  cancelCurrent({ dockReason = null } = {}) {
    if (!this.current) return false;

    // End any gesture while the action still owns it. In particular, the
    // trapped-robot rescue path needs its live action in order to put a lifted
    // robot down safely before the action's cleanup clears that state.
    this.game.cancelPointerInteraction?.();

    // Controlled doorway travel is advanced only by its action. Restore the
    // source-room anchor before releasing that action, otherwise the abandoned
    // trip would have no owner to finish the crossing.
    const robot = this.game.robot;
    if (robot.roomTravel?.owner === 'controlled') robot.abortRoomTravel?.();

    const interrupted = this.current;
    // Clear ownership before cleanup so an end hook that indirectly requests
    // the dock cannot re-enter this path and restore the same held item twice.
    this.current = null;
    interrupted.end?.(this.game);
    robot.release(dockReason);
    this.cooldown = 0.5;
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.current && this.batteryCritical()) {
      this.cancelCurrent({ dockReason: 'battery' });
      return;
    }
    if (this.current) {
      this.current.elapsed += dt;
      this.current.update?.(this.game, dt);
      // Crossing a doorway is travel time, not part of the surprise itself.
      // In particular, a dock or mop action must not hit its safety timeout
      // simply because the robot started in the other room.
      if (this.game.robot.roomTravel?.owner === 'controlled') {
        this.current.elapsed = Math.max(0, this.current.elapsed - dt);
      }
      const timeUp = this.current.elapsed > (this.current.maxDur ?? 20);
      if (this.current.finished || timeUp) {
        this.current.end?.(this.game);
        this.current = null;
        this.game.robot.release();
        this.cooldown = 0.5;
      }
    }
  }

  triggerByName(name) {
    if (this.actionStartBlocked()) return false;
    const a = this.actions.find((x) => x.name === name);
    if (!a || this.current) return false;
    if (a.canRun && !a.canRun(this.game)) return false;
    return this.begin(a);
  }

  // emergency override: cancel whatever is running and start this action
  force(name) {
    if (this.actionStartBlocked()) return false;
    const a = this.actions.find((x) => x.name === name);
    if (!a) return false;
    if (a.canForce && !a.canForce(this.game)) return false;
    if (this.current) {
      this.current.end?.(this.game);
      this.current = null;
    }
    return this.begin(a);
  }

  trigger() {
    const g = this.game;
    if (this.actionStartBlocked() || this.current || this.cooldown > 0) return false;
    const pool = this.actions.filter(
      (a) => !this.recent.includes(a.name) && (a.canRun ? a.canRun(g) : true)
    );
    if (!pool.length) return false;
    const totalW = pool.reduce((s, a) => s + (a.weight ?? 1), 0);
    let roll = Math.random() * totalW;
    let chosen = pool[0];
    for (const a of pool) {
      roll -= a.weight ?? 1;
      if (roll <= 0) {
        chosen = a;
        break;
      }
    }
    this.recent.push(chosen.name);
    if (this.recent.length > 2) this.recent.shift();
    return this.begin(chosen);
  }

  begin(action) {
    if (!action || this.actionStartBlocked()) return false;
    this.current = Object.create(action);
    this.current.elapsed = 0;
    this.current.finished = false;
    this.current.state = {};
    this.game.robot.takeControl();
    this.current.start(this.game);
    return true;
  }

  // Give the running action a chance to consume taps (e.g. popping bubbles)
  onTap(x, y) {
    if (this.current?.onTap) return this.current.onTap(this.game, x, y);
    return false;
  }

  drawUnder(ctx) {
    this.current?.drawUnder?.(this.game, ctx);
  }

  drawOver(ctx) {
    this.current?.drawOver?.(this.game, ctx);
  }
}
