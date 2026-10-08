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

  wetContactAt(x, y, radius = 0, roomId = this.robotRoomId()) {
    for (const field of this.fluids) {
      if (field.roomId === roomId && field.active && field.touchesCircle(x, y, radius)) {
        return { kind: field.kind, roomId, fieldId: field.id };
      }
    }
    for (const item of this.items) {
      if (item.roomId !== roomId) continue;
      const reach = Math.max(0, radius) + Math.max(item.len ?? 0, item.w ?? 0) * 0.45;
      if ((item.x - x) ** 2 + (item.y - y) ** 2 <= reach * reach) {
        return { kind: item.kind ?? 'poop', roomId };
      }
    }
    return null;
  }

  transferMilk(fieldId, from, to, cap = 0.08) {
    const field = this.milkField(fieldId);
    if (!field || !from || !to) return 0;
    return field.transferAlong(from.x, from.y, to.x, to.y, cap);
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
    // the mess: lumpy, shaded, glossy wet blobs rather than flat ovals
    for (const s of this.items) {
      if (s.roomId !== roomId) continue;
      drawWetBlob(ctx, s);
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

function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Closed, slightly lumpy outline inside an len x w ellipse (seeded so it
// holds still frame to frame).
function lumpyPath(ctx, rx, ry, rnd, lumps = 12, wobble = 0.16) {
  const pts = [];
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * TAU;
    const k = 1 - wobble + rnd() * wobble * 2;
    pts.push([Math.cos(a) * rx * k, Math.sin(a) * ry * k]);
  }
  ctx.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(pts[lumps - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < lumps; i++) {
    const m = mid(pts[i], pts[(i + 1) % lumps]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

function drawWetBlob(ctx, s) {
  s.seed ??= (Math.random() * 4294967296) >>> 0;
  const rnd = seededRandom(s.seed);
  const palette = smearPalette(s.kind, s.shade);
  const rx = s.len / 2;
  const ry = s.w / 2;
  const big = rx > 26;
  const milk = s.kind === 'milk';
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.rot);
  // soft contact shadow so the mess sits ON the floor
  ctx.globalAlpha = s.alpha * 0.35;
  ctx.fillStyle = 'rgba(60, 35, 20, 0.5)';
  ctx.beginPath();
  ctx.ellipse(1.5, 2.5, rx * 1.04, ry * 1.1, 0, 0, TAU);
  ctx.fill();
  // body with a darker rim that pools at the edge
  lumpyPath(ctx, rx, ry, rnd, big ? 14 : 9, big ? 0.14 : 0.2);
  const body = ctx.createRadialGradient(-rx * 0.15, -ry * 0.2, ry * 0.1, 0, 0, Math.max(rx, ry));
  body.addColorStop(0, palette.core);
  body.addColorStop(0.7, palette.outer);
  body.addColorStop(1, palette.rim);
  ctx.globalAlpha = Math.min(1, s.alpha + 0.2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.globalAlpha = s.alpha * 0.9;
  ctx.strokeStyle = palette.edge ?? palette.rim;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (s.primary || big) {
    // chunky bits and satellite droplets that flicked off the main blob
    ctx.globalAlpha = Math.min(1, s.alpha + 0.15);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * TAU;
      const d = 0.9 + rnd() * 0.5;
      const r = 1.6 + rnd() * 2.6;
      ctx.fillStyle = palette.rim;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rx * d, Math.sin(a) * ry * d * 1.1, r, 0, TAU);
      ctx.fill();
    }
    if (s.kind === 'vomit') {
      ctx.fillStyle = '#d9b55c';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc((rnd() - 0.5) * rx * 1.2, (rnd() - 0.5) * ry * 1.1, 2.4 + rnd() * 2.6, 0, TAU);
        ctx.fill();
      }
    }
  }
  // wet gloss: a curved window-light streak and a pinprick sparkle
  ctx.globalAlpha = milk ? 0.8 : 0.55;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1.6, ry * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.62, ry * 0.58, 0, Math.PI * 1.1, Math.PI * 1.55);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.28, -ry * 0.3, Math.max(1.4, rx * 0.07), Math.max(1, ry * 0.07), -0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function smearPalette(kind = 'poop', shade = 0) {
  if (kind === 'milk') {
    return {
      outer: tintedRgb(244, 241, 222, shade),
      core: tintedRgb(218, 229, 223, shade),
      edge: 'rgba(106,148,145,0.48)',
      rim: tintedRgb(190, 196, 178, shade),
    };
  }
  if (kind === 'vomit') {
    return {
      outer: tintedRgb(170, 164, 73, shade),
      core: tintedRgb(121, 126, 55, shade),
      edge: 'rgba(82,100,43,0.5)',
      rim: tintedRgb(104, 110, 40, shade),
    };
  }
  return {
    outer: tintedRgb(107, 66, 38, shade),
    core: tintedRgb(88, 52, 28, shade),
    edge: null,
    rim: tintedRgb(66, 38, 20, shade),
  };
}

function tintedRgb(r, g, b, shade) {
  return `rgb(${clamp(r + shade, 0, 255)}, ${clamp(g + shade, 0, 255)}, ${clamp(b + shade, 0, 255)})`;
}
