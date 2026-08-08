// A small deterministic shallow-puddle simulation for milk. It deliberately
// models only what this game needs: a finite pour that creeps across reachable
// floor, settles, and can be removed by a circular mop pass. The fixed grid is
// cheap enough for tablets and keeps gameplay state inspectable for tests.
import { clamp } from '../core/math.js';
import { contours } from 'd3-contour';

export const MILK_CELL_SIZE = 24;
export const MILK_FIXED_DT = 1 / 30;

const CLEAN_EPSILON = 0.018;
const SOURCE_EPSILON = 1e-7;
const WET_EPSILON = 0.0015;
const SURFACE_TENSION = 0.052;
const FLOW_RATE = 1.05;
const MAX_EDGE_FRACTION = 0.1;
const MAX_STEPS_PER_UPDATE = 4;
const MOP_WIPE_RADIUS = 64;
const TARGET_COVER_RADIUS = 48;
const MAX_TARGETS = 16;
const RENDER_FULL_VOLUME = 0.35;

let nextFieldId = 1;

export class MilkField {
  constructor(game, x, y, {
    roomId = game?.robot?.roomId ?? game?.house?.activeRoomId ?? 'kitchen',
    totalVolume = 9,
    duration = 2.6,
    cellSize = MILK_CELL_SIZE,
  } = {}) {
    this.game = game;
    this.id = `milk-${nextFieldId++}`;
    this.kind = 'milk';
    this.roomId = roomId;
    this.cellSize = cellSize;
    this.source = { x, y };
    this.totalPlannedVolume = Math.max(0.1, totalVolume);
    this.sourceDuration = Math.max(0, duration);
    this.remainingSource = this.totalPlannedVolume;
    this.sourceRate = this.sourceDuration > 0
      ? this.totalPlannedVolume / this.sourceDuration
      : Infinity;
    this.accumulator = 0;
    this.mass = 0;
    this.settled = false;
    this.revision = 0;
    this.targetPool = [];
    this.workProxy = {
      id: `${this.id}:pouring`, fieldId: this.id, roomId: this.roomId,
      kind: 'milk', puddle: true, primary: true, _milkField: this, _active: true,
    };
    this.targets = [];
    this.targetsRevision = -1;
    this.renderRevision = -1;
    this.renderCells = [];
    this.renderContours = [];

    this.configureGrid(this.room());
    this.sourceIndex = this.nearestAllowedIndex(x, y);
    if (this.sourceIndex < 0) {
      this.remainingSource = 0;
      this.sourceRate = 0;
      this.settled = true;
      this.failed = true;
      return;
    }

    // Floor contact is visible immediately. The rest enters at a fixed rate,
    // so an installed mop cannot create a one-frame "all clean" gap between
    // glugs from the bottle.
    const firstDrop = this.sourceDuration > 0
      ? Math.min(this.remainingSource, Math.max(0.12, this.totalPlannedVolume * 0.025))
      : this.remainingSource;
    this.deposit(firstDrop);
    this.remainingSource -= firstDrop;
    if (this.remainingSource <= SOURCE_EPSILON) this.remainingSource = 0;
  }

  room() {
    return this.game?.house?.room?.(this.roomId) ?? this.game?.room ?? null;
  }

  configureGrid(room) {
    const bounds = room?.bounds ?? { minX: 100, maxX: 1580, minY: 245, maxY: 950 };
    this.bounds = { ...bounds };
    this.cols = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / this.cellSize) + 1);
    this.rows = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / this.cellSize) + 1);
    const length = this.cols * this.rows;
    this.height = new Float32Array(length);
    this.nextHeight = new Float32Array(length);
    this.allowed = new Uint8Array(length);
    this.contourGenerator = contours()
      .size([this.cols, this.rows])
      .smooth(true)
      .thresholds([WET_EPSILON, 0.055]);
    this.rebuildAllowedMask(room);
  }

  cellPoint(index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    return {
      x: this.bounds.minX + col * this.cellSize,
      y: this.bounds.minY + row * this.cellSize,
    };
  }

  indexAt(x, y) {
    const col = clamp(Math.round((x - this.bounds.minX) / this.cellSize), 0, this.cols - 1);
    const row = clamp(Math.round((y - this.bounds.minY) / this.cellSize), 0, this.rows - 1);
    return row * this.cols + col;
  }

  touchesCircle(x, y, radius = 0) {
    const reach = Math.max(0, radius) + this.cellSize * 0.72;
    const reachSq = reach * reach;
    for (let index = 0; index < this.height.length; index++) {
      if (this.height[index] <= WET_EPSILON) continue;
      const point = this.cellPoint(index);
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy <= reachSq) return true;
    }
    return false;
  }

  nearestWetIndex(x, y, radius = this.cellSize * 2) {
    const radiusSq = radius * radius;
    let best = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < this.height.length; index++) {
      if (this.height[index] <= WET_EPSILON) continue;
      const point = this.cellPoint(index);
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = dx * dx + dy * dy;
      if (distance <= radiusSq && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  // A padless wheel drags a fraction of the liquid from its previous contact
  // point to its new one. Volume moves between grid cells instead of being
  // created, so repeated crossings stretch the puddle without violating the
  // fluid simulation's conservation guarantee.
  transferAlong(fromX, fromY, toX, toY, cap = 0.08) {
    if (!this.active || !(cap > 0)) return 0;
    const source = this.nearestWetIndex(fromX, fromY);
    const destination = this.nearestAllowedIndex(toX, toY);
    if (source < 0 || destination < 0 || source === destination) return 0;
    const available = this.height[source];
    const amount = Math.min(cap, available * 0.58);
    if (amount <= WET_EPSILON * 0.3) return 0;
    this.height[source] = Math.max(0, available - amount);
    this.height[destination] += amount;
    this.settled = false;
    this.markChanged();
    return amount;
  }

  rebuildAllowedMask(room = this.room()) {
    const robotRadius = (this.game?.robot?.radius ?? 62) + 8;
    const fluidRadius = Math.max(7, this.cellSize * 0.34);
    for (let index = 0; index < this.allowed.length; index++) {
      const point = this.cellPoint(index);
      const floorFree = !room?.isFree || room.isFree(point.x, point.y, fluidRadius);
      if (!floorFree) {
        this.allowed[index] = 0;
        continue;
      }

      // Puddles may reach closer to furniture than the robot's center, but
      // every occupied cell must remain within one mop radius of a position
      // that the full robot can actually occupy.
      let mopReachable = !room?.isFree || room.isFree(point.x, point.y, robotRadius);
      if (!mopReachable && room?.isFree) {
        // Match dockTrips.approachCandidates exactly. A looser mask can admit
        // milk that looks mop-close but has no routeable 48-unit approach.
        const anchorDistance = 48;
        for (let sample = 0; sample < 16 && !mopReachable; sample++) {
          const angle = sample * Math.PI / 8;
          const x = point.x + Math.cos(angle) * anchorDistance;
          const y = point.y + Math.sin(angle) * anchorDistance;
          mopReachable = room.isFree(x, y, robotRadius);
        }
      }
      this.allowed[index] = mopReachable ? 1 : 0;
    }
  }

  nearestAllowedIndex(x, y) {
    const start = this.indexAt(x, y);
    if (this.allowed[start]) return start;
    const startCol = start % this.cols;
    const startRow = Math.floor(start / this.cols);
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 1; ring < maxRing; ring++) {
      for (let row = startRow - ring; row <= startRow + ring; row++) {
        if (row < 0 || row >= this.rows) continue;
        for (let col = startCol - ring; col <= startCol + ring; col++) {
          if (col < 0 || col >= this.cols) continue;
          if (Math.abs(col - startCol) !== ring && Math.abs(row - startRow) !== ring) continue;
          const index = row * this.cols + col;
          if (this.allowed[index]) return index;
        }
      }
    }
    return -1;
  }

  get sourceActive() {
    return this.remainingSource > SOURCE_EPSILON;
  }

  get active() {
    return this.sourceActive || this.mass > CLEAN_EPSILON;
  }

  get moppable() {
    return this.active && !this.sourceActive;
  }

  deposit(amount) {
    if (!(amount > 0) || this.sourceIndex < 0) return;
    const sourcePoint = this.cellPoint(this.sourceIndex);
    const leadingIndex = this.nearestAllowedIndex(
      sourcePoint.x + this.cellSize,
      sourcePoint.y + this.cellSize,
    );
    const sideIndex = this.nearestAllowedIndex(
      sourcePoint.x + this.cellSize,
      sourcePoint.y,
    );
    const leadAmount = leadingIndex >= 0 && leadingIndex !== this.sourceIndex ? amount * 0.2 : 0;
    const sideAmount = sideIndex >= 0 && sideIndex !== this.sourceIndex && sideIndex !== leadingIndex
      ? amount * 0.08
      : 0;
    this.height[this.sourceIndex] += amount - leadAmount - sideAmount;
    if (leadAmount) this.height[leadingIndex] += leadAmount;
    if (sideAmount) this.height[sideIndex] += sideAmount;
    this.mass += amount;
    this.settled = false;
    this.markChanged();
  }

  update(dt) {
    if (!this.active || this.sourceIndex < 0) return;
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, dt || 0),
      MILK_FIXED_DT * MAX_STEPS_PER_UPDATE,
    );
    let steps = 0;
    while (this.accumulator + 1e-9 >= MILK_FIXED_DT && steps < MAX_STEPS_PER_UPDATE) {
      this.fixedStep(MILK_FIXED_DT);
      this.accumulator -= MILK_FIXED_DT;
      steps++;
    }
  }

  fixedStep(dt) {
    if (this.sourceActive) {
      const amount = Math.min(this.remainingSource, this.sourceRate * dt);
      this.deposit(amount);
      this.remainingSource -= amount;
      if (this.remainingSource <= SOURCE_EPSILON) this.remainingSource = 0;
    }

    if (this.settled && !this.sourceActive) return;
    this.nextHeight.set(this.height);
    let largestTransfer = 0;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        if (!this.allowed[index]) continue;
        if (col + 1 < this.cols) {
          largestTransfer = Math.max(
            largestTransfer,
            this.transferAcross(index, index + 1, -col * 0.00025, -(col + 1) * 0.00025, dt),
          );
        }
        if (row + 1 < this.rows) {
          largestTransfer = Math.max(
            largestTransfer,
            this.transferAcross(index, index + this.cols, -row * 0.0012, -(row + 1) * 0.0012, dt),
          );
        }
      }
    }

    let mass = 0;
    for (let index = 0; index < this.height.length; index++) {
      const value = this.allowed[index] ? Math.max(0, this.nextHeight[index]) : 0;
      this.height[index] = value;
      mass += value;
    }
    this.mass = mass;
    if (!this.sourceActive && this.mass <= CLEAN_EPSILON) {
      this.clear();
      return;
    }
    this.settled = !this.sourceActive && largestTransfer < 0.00001;
    if (largestTransfer > 0 || this.sourceActive) this.markChanged();
  }

  transferAcross(first, second, firstGround, secondGround, dt) {
    if (!this.allowed[second]) return 0;
    const firstHeight = this.height[first];
    const secondHeight = this.height[second];
    const difference = (firstHeight + firstGround) - (secondHeight + secondGround);
    const magnitude = Math.abs(difference) - SURFACE_TENSION;
    if (magnitude <= 0) return 0;
    const from = difference > 0 ? first : second;
    const to = difference > 0 ? second : first;
    const available = this.height[from];
    if (available <= 0) return 0;
    const amount = Math.min(
      magnitude * FLOW_RATE * dt,
      available * MAX_EDGE_FRACTION,
    );
    if (!(amount > 0)) return 0;
    this.nextHeight[from] -= amount;
    this.nextHeight[to] += amount;
    return amount;
  }

  clear() {
    this.height.fill(0);
    this.nextHeight.fill(0);
    this.mass = 0;
    this.remainingSource = 0;
    this.settled = true;
    this.markChanged();
    for (const target of this.targetPool) target._active = false;
    this.targets = [];
  }

  wipeAt(x, y, radius) {
    if (!this.moppable) return { amount: 0, points: [] };
    const radiusSq = radius * radius;
    let removed = 0;
    const points = [];
    for (let index = 0; index < this.height.length; index++) {
      const amount = this.height[index];
      if (amount <= 0) continue;
      const point = this.cellPoint(index);
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy >= radiusSq) continue;
      this.height[index] = 0;
      removed += amount;
      if (points.length < 4) points.push(point);
    }
    if (removed <= 0) return { amount: 0, points: [] };
    this.mass = Math.max(0, this.mass - removed);
    if (!this.sourceActive && this.mass <= CLEAN_EPSILON) this.clear();
    else {
      this.settled = false;
      this.markChanged();
    }
    return {
      // Keep the existing pad-dirt and sound callers on a familiar scale.
      amount: Math.max(0.25, removed * 1.5),
      points,
    };
  }

  reconcileLayout(room = this.room()) {
    if (!this.height?.length) return;
    this.rebuildAllowedMask(room);
    const displaced = [];
    for (let index = 0; index < this.height.length; index++) {
      if (this.allowed[index] || this.height[index] <= 0) continue;
      displaced.push([index, this.height[index]]);
      this.height[index] = 0;
    }
    for (const [index, amount] of displaced) {
      const point = this.cellPoint(index);
      const target = this.nearestAllowedIndex(point.x, point.y);
      if (target >= 0) this.height[target] += amount;
    }
    const sourcePoint = this.cellPoint(Math.max(0, this.sourceIndex));
    this.sourceIndex = this.nearestAllowedIndex(sourcePoint.x, sourcePoint.y);
    if (this.sourceIndex < 0) {
      this.clear();
      this.failed = true;
      return;
    }
    this.mass = this.height.reduce((sum, value) => sum + value, 0);
    this.settled = false;
    this.markChanged();
  }

  markChanged() {
    this.revision++;
    this.targetsRevision = -1;
    this.renderRevision = -1;
  }

  mopTargets() {
    if (!this.moppable) return [];
    if (this.targetsRevision === this.revision) return this.targets;

    const wet = [];
    for (let index = 0; index < this.height.length; index++) {
      if (this.height[index] > WET_EPSILON) wet.push(index);
    }
    // Wheel transfers can divide a trace of milk among cells that are each
    // below the visible-wet threshold while their combined mass still keeps
    // the field active. Once no visible cell remains, expose those positive
    // trace cells as work so directed mopping can finish instead of leaving an
    // invisible spill that permanently blocks the all-clean celebration.
    if (!wet.length && this.mass > CLEAN_EPSILON) {
      for (let index = 0; index < this.height.length; index++) {
        if (this.height[index] > 0) wet.push(index);
      }
    }
    if (!wet.length && this.sourceActive && this.sourceIndex >= 0) wet.push(this.sourceIndex);

    const uncovered = new Set(wet);
    const chosen = [];
    const coverSq = TARGET_COVER_RADIUS * TARGET_COVER_RADIUS;
    while (uncovered.size && chosen.length < MAX_TARGETS) {
      let best = null;
      let bestAmount = -1;
      if (!chosen.length && uncovered.has(this.sourceIndex)) {
        best = this.sourceIndex;
      } else {
        for (const index of uncovered) {
          const amount = this.height[index];
          if (amount > bestAmount) {
            best = index;
            bestAmount = amount;
          }
        }
      }
      if (best == null) break;
      chosen.push(best);
      const center = this.cellPoint(best);
      for (const index of uncovered) {
        const point = this.cellPoint(index);
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        if (dx * dx + dy * dy <= coverSq) uncovered.delete(index);
      }
    }

    this.targets = chosen.map((index, slot) => {
      const point = this.cellPoint(index);
      const target = this.targetPool[slot] ?? {
        id: `${this.id}:target-${slot}`,
        fieldId: this.id,
        roomId: this.roomId,
        kind: 'milk',
        puddle: true,
        primary: slot === 0,
        _milkField: this,
      };
      this.targetPool[slot] = target;
      target.x = point.x;
      target.y = point.y;
      target.primary = slot === 0;
      target._active = true;
      return target;
    });
    for (let slot = this.targets.length; slot < this.targetPool.length; slot++) {
      this.targetPool[slot]._active = false;
    }
    this.targetsRevision = this.revision;
    return this.targets;
  }

  containsTarget(target) {
    return !!(target && target._milkField === this && target._active && this.active);
  }

  representative() {
    if (!this.active) return null;
    if (this.sourceActive) {
      const point = this.cellPoint(this.sourceIndex);
      this.workProxy.x = point.x;
      this.workProxy.y = point.y;
      this.workProxy._active = true;
      return this.workProxy;
    }
    return this.mopTargets()[0] ?? null;
  }

  occupiedCellCount() {
    let count = 0;
    for (const value of this.height) if (value > WET_EPSILON) count++;
    return count;
  }

  draw(ctx) {
    if (this.mass <= CLEAN_EPSILON) return;
    if (this.renderRevision !== this.revision) {
      this.renderCells = [];
      for (let index = 0; index < this.height.length; index++) {
        const amount = this.height[index];
        if (amount <= WET_EPSILON) continue;
        const point = this.cellPoint(index);
        // Absolute sizing prevents edge cells from visibly swelling merely
        // because the mop removed a taller cell elsewhere in the field.
        const fullness = clamp(Math.sqrt(amount / RENDER_FULL_VOLUME), 0, 1);
        const cell = {
          ...point,
          radius: this.cellSize * (0.56 + fullness * 0.18),
          amount,
          index,
        };
        this.renderCells.push(cell);
      }
      this.renderContours = this.contourGenerator(this.height)
        .filter((contour) => contour.coordinates.length > 0);
      this.renderRevision = this.revision;
    }
    if (!this.renderCells.length || !this.renderContours.length) return;

    ctx.save();
    appendContourPath(ctx, this.renderContours[0], this.bounds, this.cellSize);
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#e9e4cf';
    ctx.fill('evenodd');
    ctx.globalAlpha = 0.48;
    ctx.strokeStyle = '#9f987f';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // A brighter high-volume interior makes the boundary read as a thin film
    // rather than a paper cutout, while the underlying field still owns the
    // exact amount and footprint.
    if (this.renderContours[1]) {
      appendContourPath(ctx, this.renderContours[1], this.bounds, this.cellSize);
      ctx.globalAlpha = 0.64;
      ctx.fillStyle = '#fffced';
      ctx.fill('evenodd');
    }

    // One long, low glint reads as a reflection on a shared liquid surface.
    // Several little ovals made the grid samples look like bubbles or foam.
    const highlight = this.renderCells.reduce((best, cell) =>
      !best || cell.amount > best.amount ? cell : best, null);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#ffffff';
    if (highlight) {
      ctx.beginPath();
      ctx.ellipse(
        highlight.x - highlight.radius * 0.18,
        highlight.y - highlight.radius * 0.24,
        highlight.radius * 0.72,
        highlight.radius * 0.1,
        -0.18,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  }
}

function appendContourPath(ctx, contour, bounds, cellSize) {
  ctx.beginPath();
  for (const polygon of contour.coordinates) {
    for (const ring of polygon) {
      const points = ring.map((point) => ({
        x: bounds.minX + (point[0] - 0.5) * cellSize,
        y: bounds.minY + (point[1] - 0.5) * cellSize,
      }));
      const closingPoint = points[points.length - 1];
      if (points.length > 1 &&
          points[0].x === closingPoint.x && points[0].y === closingPoint.y) {
        points.pop();
      }
      if (points.length < 3) continue;
      const last = points[points.length - 1];
      ctx.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
      for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const next = points[(index + 1) % points.length];
        ctx.quadraticCurveTo(
          point.x,
          point.y,
          (point.x + next.x) / 2,
          (point.y + next.y) / 2,
        );
      }
      ctx.closePath();
    }
  }
}

export default MilkField;
