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

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.current) {
      this.current.elapsed += dt;
      this.current.update?.(this.game, dt);
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
    const a = this.actions.find((x) => x.name === name);
    if (!a || this.current) return false;
    if (a.canRun && !a.canRun(this.game)) return false;
    this.begin(a);
    return true;
  }

  // emergency override: cancel whatever is running and start this action
  force(name) {
    const a = this.actions.find((x) => x.name === name);
    if (!a) return false;
    if (this.current) {
      this.current.end?.(this.game);
      this.current = null;
    }
    this.begin(a);
    return true;
  }

  trigger() {
    const g = this.game;
    if (this.current || this.cooldown > 0) return false;
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
    this.begin(chosen);
    return true;
  }

  begin(action) {
    this.current = Object.create(action);
    this.current.elapsed = 0;
    this.current.finished = false;
    this.current.state = {};
    this.game.robot.takeControl();
    this.current.start(this.game);
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
