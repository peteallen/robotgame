// Persistent wet floor decals: poop tracks, milk spills, kitchen dog vomit,
// and the sparkling clean "shine" marks the mop leaves.
import { TAU, rand, clamp } from '../core/math.js';
import { MilkField } from './MilkField.js';

const MAX_SMEARS = 160;

export class Smears {
  constructor(game) {
    this.game = game;
    this.items = []; // {x, y, roomId, kind, rot, len, w, alpha, shade}
    this.fluids = []; // dynamic milk fields; vomit and poop stay as decals
    this.shines = []; // {x, y, roomId, age, life, rot}
  }

  activeRoomId() {
    return this.game.house?.activeRoomId ?? this.game.robot?.roomId ?? this.game.room?.id ?? 'living';
  }

  robotRoomId() {
    return this.game.robot?.roomId ?? this.game.house?.activeRoomId ?? this.game.room?.id ?? 'living';
  }

  get count() {
    return this.items.length + this.fluids.filter((field) => field.active).length;
  }

  countIn(roomId = this.robotRoomId()) {
    return this.items.filter((s) => s.roomId === roomId).length +
      this.fluids.filter((field) => field.roomId === roomId && field.active).length;
  }

  hasIn(roomId, predicate = () => true) {
    return this.items.some((s) => s.roomId === roomId && predicate(s)) ||
      this.fluids.some((field) => {
        if (field.roomId !== roomId || !field.active) return false;
        const target = field.representative();
        return !!target && predicate(target);
      });
  }

  findAny(predicate = () => true) {
    const item = this.items.find(predicate);
    if (item) return item;
    for (const field of this.fluids) {
      if (!field.active) continue;
      const target = field.representative();
      if (target && predicate(target)) return target;
    }
    return undefined;
  }

  findPuddle(predicate = () => true) {
    const item = this.items.find((candidate) => candidate.puddle && predicate(candidate));
    if (item) return item;
    for (const field of this.fluids) {
      if (!field.moppable) continue;
      const target = field.representative();
      if (target?.puddle && predicate(target)) return target;
    }
    return undefined;
  }

  mopTargetsIn(roomId = this.robotRoomId()) {
    const targets = this.items.filter((item) => item.roomId === roomId);
    for (const field of this.fluids) {
      if (field.roomId === roomId && field.active) targets.push(...field.mopTargets());
    }
    return targets;
  }

  hasReadyForMop() {
    return this.items.length > 0 || this.fluids.some((field) => field.moppable);
  }

  containsTarget(target) {
    if (this.items.includes(target)) return true;
    return this.fluids.some((field) => field.containsTarget(target));
  }

  hasSpill(id) {
    return !!id && this.fluids.some((field) => field.id === id && field.active);
  }

  milkField(id) {
    return this.fluids.find((field) => field.id === id) ?? null;
  }

  makeRoom(roomId) {
    let i = this.items.findIndex((s) => s.roomId === roomId && !s.puddle);
    if (i < 0) i = this.items.findIndex((s) => s.roomId === roomId && !s.primary);
    if (i < 0) i = this.items.findIndex((s) => s.roomId === roomId);
    if (this.countIn(roomId) >= MAX_SMEARS && i >= 0) this.items.splice(i, 1);
  }

  rearmVictory() {
    this.game.roomDirty = true;
    this.game.finalVacuumRoomId = null;
  }

  queueWetCleanup(roomId) {
    this.rearmVictory();
    // An already-running mop emergency scans all rooms dynamically. Leaving a
    // second pending flag behind would start the same cleanup twice.
    if (this.game.actions?.current?.name === 'mopMode') return;
    this.game.pendingMop = true;
    this.game.pendingMopRoomId = roomId;
  }

  // one wheel-track streak
  stamp(x, y, rot, opts = {}) {
    const roomId = typeof opts === 'string' ? opts : (opts?.roomId ?? this.robotRoomId());
    const kind = typeof opts === 'string' ? 'poop' : (opts?.kind ?? 'poop');
    this.makeRoom(roomId);
    this.items.push({
      x: x + rand(-3, 3),
      y: y + rand(-3, 3),
      roomId,
      kind,
      rot: rot + rand(-0.16, 0.16),
      len: rand(24, 42),
      w: rand(9, 14),
      alpha: rand(0.35, 0.55),
      shade: rand(-14, 14) | 0,
    });
  }

  // the initial squish site — a big ugly blob with spatter
  splat(x, y, opts = {}) {
    const roomId = typeof opts === 'string' ? opts : (opts?.roomId ?? this.robotRoomId());
    const kind = typeof opts === 'string' ? 'poop' : (opts?.kind ?? 'poop');
    this.rearmVictory();
    for (let i = 0; i < 7; i++) {
      const a = rand(0, TAU);
      const d = i === 0 ? 0 : rand(10, 46);
      this.makeRoom(roomId);
      this.items.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        roomId,
        kind,
        rot: rand(0, TAU),
        len: i === 0 ? rand(46, 58) : rand(14, 30),
        w: i === 0 ? rand(30, 38) : rand(8, 16),
        alpha: i === 0 ? 0.6 : rand(0.3, 0.5),
        shade: rand(-14, 14) | 0,
      });
    }
  }

  // Direct wet spills are already puddles, so they skip the raw-poop wheel
  // collision and go straight into the room-aware mop cleanup pipeline.
  spill(x, y, opts = {}) {
    const roomId = typeof opts === 'string' ? opts : (opts?.roomId ?? this.robotRoomId());
    const kind = typeof opts === 'string' ? 'milk' : (opts?.kind ?? 'milk');
    if (kind === 'milk') {
      const milkOpts = typeof opts === 'string' ? { roomId } : { ...opts, roomId };
      return this.spillMilk(x, y, milkOpts);
    }
    const count = kind === 'vomit' ? 9 : 11;
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const d = i === 0 ? 0 : rand(18, kind === 'vomit' ? 54 : 66);
      this.makeRoom(roomId);
      this.items.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        roomId,
        kind,
        puddle: true,
        primary: i === 0,
        rot: rand(0, TAU),
        len: i === 0 ? rand(82, 98) : rand(13, 34),
        w: i === 0 ? rand(48, 58) : rand(9, 22),
        alpha: i === 0 ? 0.8 : rand(0.48, 0.7),
        shade: rand(-10, 10) | 0,
      });
    }
    this.queueWetCleanup(roomId);
  }

  spillMilk(x, y, opts = {}) {
    const roomId = typeof opts === 'string' ? opts : (opts?.roomId ?? this.robotRoomId());
    const normalized = typeof opts === 'string' ? { roomId } : { ...opts, roomId };
    const field = new MilkField(this.game, x, y, normalized);
    if (!field.active) return null;
    this.fluids.push(field);
    field.cleanupQueued = !field.sourceActive;
    if (field.cleanupQueued) this.queueWetCleanup(roomId);
    else this.rearmVictory();
    return field.id;
  }

  spillVomit(x, y, opts = {}) {
    this.spill(x, y, { ...opts, kind: 'vomit' });
  }

  nearest(x, y, roomId = this.robotRoomId()) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.mopTargetsIn(roomId)) {
      if (s.roomId !== roomId) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // mop pass: remove smears within radius, leave a brief sparkle-clean shine
  wipeAt(x, y, radius, roomId = this.robotRoomId()) {
    let wiped = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const s = this.items[i];
      if (s.roomId !== roomId) continue;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < radius * radius) {
        this.items.splice(i, 1);
        this.shines.push({
          x: s.x,
          y: s.y,
          roomId: s.roomId,
          age: 0,
          life: rand(1.2, 2),
          rot: rand(0, TAU),
        });
        wiped++;
      }
    }
    for (const field of this.fluids) {
      if (field.roomId !== roomId || !field.active) continue;
      const result = field.wipeAt(x, y, radius);
      wiped += result.amount;
      for (const point of result.points) {
        this.shines.push({
          x: point.x,
          y: point.y,
          roomId,
          age: 0,
          life: rand(1.2, 2),
          rot: rand(0, TAU),
        });
      }
    }
    this.fluids = this.fluids.filter((field) => field.active);
    return wiped;
  }

  update(dt) {
    for (const field of this.fluids) {
      field.update(dt);
      if (field.active && !field.sourceActive && !field.cleanupQueued) {
        field.cleanupQueued = true;
        this.queueWetCleanup(field.roomId);
      }
    }
    this.fluids = this.fluids.filter((field) => field.active);
    for (let i = this.shines.length - 1; i >= 0; i--) {
      const sh = this.shines[i];
      sh.age += dt;
      if (sh.age >= sh.life) this.shines.splice(i, 1);
    }
  }

  draw(ctx) {
    const roomId = this.activeRoomId();
    for (const field of this.fluids) {
      if (field.roomId === roomId && field.active) field.draw(ctx);
    }
    // the mess
    for (const s of this.items) {
      if (s.roomId !== roomId) continue;
      const palette = smearPalette(s.kind, s.shade);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = palette.outer;
      ctx.beginPath();
      ctx.ellipse(0, 0, s.len / 2, s.w / 2, 0, 0, TAU);
      ctx.fill();
      if (palette.edge) {
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = s.kind === 'milk' ? 2.5 : 2;
        ctx.stroke();
      }
      // streaky core
      ctx.globalAlpha = s.alpha * 0.7;
      ctx.fillStyle = palette.core;
      ctx.beginPath();
      ctx.ellipse(s.len * 0.12, 0, s.len * 0.3, s.w * 0.28, 0, 0, TAU);
      ctx.fill();
      if (s.primary && s.kind === 'milk') {
        ctx.globalAlpha = s.alpha * 0.72;
        ctx.fillStyle = 'rgba(255,255,248,0.92)';
        ctx.beginPath();
        ctx.ellipse(-s.len * 0.18, -s.w * 0.16, s.len * 0.16, s.w * 0.11, 0, 0, TAU);
        ctx.fill();
      } else if (s.primary && s.kind === 'vomit') {
        ctx.globalAlpha = s.alpha * 0.9;
        ctx.fillStyle = '#d9b55c';
        for (const [cx, cy, radius] of [[-17, -5, 5], [7, 8, 4], [20, -7, 3.5]]) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // freshly mopped gleam
    for (const sh of this.shines) {
      if (sh.roomId !== roomId) continue;
      const t = sh.age / sh.life;
      const a = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75;
      ctx.save();
      ctx.translate(sh.x, sh.y);
      ctx.rotate(sh.rot);
      ctx.globalAlpha = clamp(a, 0, 1) * 0.5;
      ctx.fillStyle = '#e8f7ff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 7, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = clamp(a, 0, 1) * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-8, 0); ctx.lineTo(-2, -2.5); ctx.lineTo(0, -8); ctx.lineTo(2, -2.5);
      ctx.lineTo(8, 0); ctx.lineTo(2, 2.5); ctx.lineTo(0, 8); ctx.lineTo(-2, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  reconcileLayout() {
    for (const field of this.fluids) field.reconcileLayout();
  }
}

function smearPalette(kind = 'poop', shade = 0) {
  if (kind === 'milk') {
    return {
      outer: tintedRgb(244, 241, 222, shade),
      core: tintedRgb(218, 229, 223, shade),
      edge: 'rgba(106,148,145,0.48)',
    };
  }
  if (kind === 'vomit') {
    return {
      outer: tintedRgb(170, 164, 73, shade),
      core: tintedRgb(121, 126, 55, shade),
      edge: 'rgba(82,100,43,0.5)',
    };
  }
  return {
    outer: tintedRgb(107, 66, 38, shade),
    core: tintedRgb(88, 52, 28, shade),
    edge: null,
  };
}

function tintedRgb(r, g, b, shade) {
  return `rgb(${clamp(r + shade, 0, 255)}, ${clamp(g + shade, 0, 255)}, ${clamp(b + shade, 0, 255)})`;
}
