// The kitchen's player-caused milk incident. The bottle is deliberately kept
// separate from the floor simulation: it owns the three-poke countertop story,
// while Smears remains the authority for room ownership, mopping and victory.
import { clamp, damp, easeInOutSine } from '../core/math.js';
import { roundRect } from '../world/Room.js';

const FALL_SECONDS = 0.62;
const POUR_SECONDS = 2.65;
const RESET_SECONDS = 2.2;
const LEAN_ANGLES = [0, 0.18, 0.39];

export class MilkBottle {
  constructor(game) {
    this.game = game;
    this.roomId = 'kitchen';
    this.state = 'upright';
    this.pokeLevel = 0;
    this.angle = 0;
    this.targetAngle = 0;
    this.wobble = 0;
    this.holdT = 0;
    this.stateT = 0;
    this.spillId = null;
    this.resetT = 0;
    this.baseX = 1026;
    this.baseY = 500;
    this.spillPoint = { x: 1200, y: 575 };
    this.syncLayout();
  }

  room() {
    return this.game.house?.room?.(this.roomId) ??
      (this.game.room?.id === this.roomId ? this.game.room : null);
  }

  syncLayout() {
    const room = this.room();
    const island = room?.getFurniture?.('island') ??
      room?.furniture?.find?.((item) => item.name === 'island');
    if (!island) return;
    // The generated island deliberately leaves its right half empty. The base
    // stays on the top while the neck reaches over the right edge when fallen.
    this.baseX = island.cx + island.w * 0.36;
    this.baseY = island.cy - island.h * 0.34;
    this.islandBaseline = island.baseline;
  }

  baseline(room = this.room()) {
    const island = room?.getFurniture?.('island') ??
      room?.furniture?.find?.((item) => item.name === 'island');
    return (island?.baseline ?? this.islandBaseline ?? this.baseY) + 0.01;
  }

  contains(x, y, roomId = this.game.house?.activeRoomId ?? this.game.room?.id) {
    if (roomId !== this.roomId || this.state === 'resetting') return false;
    // This is the swept area from upright to horizontal, padded to remain an
    // easy tablet target even when a small finger hides the bottle itself.
    return x >= this.baseX - 68 && x <= this.baseX + 155 &&
      y >= this.baseY - 162 && y <= this.baseY + 52;
  }

  poke() {
    if (this.state === 'falling' || this.state === 'pouring') {
      this.game.sound?.pop?.();
      return false;
    }
    if (this.state === 'empty') {
      this.game.sound?.squeak?.();
      this.wobble = Math.max(this.wobble, 0.22);
      return false;
    }
    if (this.state === 'resetting') return false;

    this.state = 'leaning';
    this.pokeLevel++;
    this.holdT = 7;
    this.wobble = 0.55;
    if (this.pokeLevel < 3) {
      this.targetAngle = LEAN_ANGLES[this.pokeLevel];
      this.game.sound?.pop?.();
      this.game.particles?.sparkle?.(
        this.baseX + 8,
        this.baseY - 112,
        3,
        this.roomId,
      );
      return true;
    }

    this.state = 'falling';
    this.stateT = 0;
    this.fallStartAngle = this.angle;
    this.targetAngle = Math.PI * 0.51;
    this.game.sound?.whoosh?.();
    return true;
  }

  update(dt) {
    this.syncLayout();
    this.stateT += dt;
    this.wobble = Math.max(0, this.wobble - dt * 1.8);

    if (this.state === 'upright' || this.state === 'leaning') {
      this.angle = damp(this.angle, this.targetAngle, 9, dt);
      if (this.state === 'leaning') {
        this.holdT -= dt;
        if (this.holdT <= 0) {
          this.pokeLevel = 0;
          this.targetAngle = 0;
        }
        if (this.pokeLevel === 0 && Math.abs(this.angle) < 0.012) {
          this.angle = 0;
          this.state = 'upright';
        }
      }
      return;
    }

    if (this.state === 'falling') {
      const progress = clamp(this.stateT / FALL_SECONDS, 0, 1);
      this.angle = this.fallStartAngle +
        (this.targetAngle - this.fallStartAngle) * easeInOutSine(progress);
      if (progress >= 1) this.beginPour();
      return;
    }

    if (this.state === 'pouring') {
      if (this.stateT >= POUR_SECONDS) {
        this.state = 'empty';
        this.stateT = 0;
      }
      return;
    }

    if (this.state === 'empty') {
      if (this.game.smears?.hasSpill?.(this.spillId)) {
        this.resetT = 0;
        return;
      }
      this.resetT += dt;
      if (this.resetT >= RESET_SECONDS) {
        this.state = 'resetting';
        this.stateT = 0;
        this.targetAngle = 0;
        this.game.sound?.whoosh?.();
      }
      return;
    }

    if (this.state === 'resetting') {
      this.angle = damp(this.angle, 0, 8, dt);
      if (this.stateT >= 0.75 || Math.abs(this.angle) < 0.01) this.reset();
    }
  }

  beginPour() {
    if (this.state === 'pouring' || this.spillId) return;
    const room = this.room();
    // The neck reaches beyond the island so the falling stream lands naturally
    // in the open floor strip now kept clear by the wall-side trash can.
    const authored = { x: 1200, y: 575 };
    this.spillPoint = room?.isFree?.(authored.x, authored.y, 90, { solidTable: true })
      ? authored
      : room?.nearestFreePoint?.(authored.x, authored.y, 90, { solidTable: true }) ?? authored;
    this.state = 'pouring';
    this.stateT = 0;
    this.spillId = this.game.smears?.spillMilk?.(
      this.spillPoint.x,
      this.spillPoint.y,
      {
        roomId: this.roomId,
        totalVolume: 9,
        duration: POUR_SECONDS,
      },
    ) ?? null;
    this.game.sound?.glug?.();
    this.game.sound?.splat?.();
    this.game.particles?.burst?.(this.spillPoint.x, this.spillPoint.y, 'dot', 10, {
      speedMin: 30,
      speedMax: 100,
      spreadY: 0.5,
      lifeMin: 0.35,
      lifeMax: 0.75,
      sizeMin: 5,
      sizeMax: 10,
      color: '#fff9e8',
      roomId: this.roomId,
      extra: { ay: 180 },
    });
  }

  reset() {
    this.state = 'upright';
    this.pokeLevel = 0;
    this.angle = 0;
    this.targetAngle = 0;
    this.wobble = 0;
    this.holdT = 0;
    this.stateT = 0;
    this.spillId = null;
    this.resetT = 0;
    this.game.particles?.sparkle?.(this.baseX, this.baseY - 75, 5, this.roomId);
  }

  displayAngle() {
    if (this.wobble <= 0) return this.angle;
    return this.angle + Math.sin((this.game.time ?? 0) * 22) * 0.035 * this.wobble;
  }

  milkLevel() {
    if (this.state === 'empty' || this.state === 'resetting') return 0;
    if (this.state !== 'pouring') return 1;
    return clamp(1 - this.stateT / POUR_SECONDS, 0, 1);
  }

  draw(ctx) {
    if ((this.game.house?.activeRoomId ?? this.game.room?.id) !== this.roomId) return;
    const angle = this.displayAngle();
    if (this.state === 'pouring') this.drawPour(ctx, angle);

    ctx.save();
    ctx.translate(this.baseX, this.baseY);
    ctx.fillStyle = 'rgba(91, 56, 36, 0.2)';
    ctx.beginPath();
    ctx.ellipse(28, 8, 48, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(angle);

    // Milk inside the translucent bottle. It drains from the bottom upward;
    // the glass highlight and thick outline keep it readable at game scale.
    const level = this.milkLevel();
    if (level > 0) {
      ctx.save();
      roundRect(ctx, -24, -91, 48, 82, 17);
      ctx.clip();
      const fillTop = -10 - 76 * level;
      const milk = ctx.createLinearGradient(0, fillTop, 0, -7);
      milk.addColorStop(0, '#fffdf0');
      milk.addColorStop(1, '#e8eadb');
      ctx.fillStyle = milk;
      ctx.fillRect(-25, fillTop, 50, 84);
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.ellipse(0, fillTop, 23, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const glass = ctx.createLinearGradient(-28, 0, 28, 0);
    glass.addColorStop(0, 'rgba(183, 222, 219, 0.82)');
    glass.addColorStop(0.45, 'rgba(245, 255, 250, 0.38)');
    glass.addColorStop(1, 'rgba(116, 170, 166, 0.72)');
    ctx.fillStyle = glass;
    roundRect(ctx, -28, -96, 56, 91, 19);
    ctx.fill();
    ctx.strokeStyle = '#6faaa4';
    ctx.lineWidth = 4;
    roundRect(ctx, -28, -96, 56, 91, 19);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.56)';
    roundRect(ctx, -17, -86, 8, 58, 4);
    ctx.fill();

    ctx.fillStyle = '#d8eee6';
    roundRect(ctx, -15, -116, 30, 28, 9);
    ctx.fill();
    ctx.strokeStyle = '#78aaa5';
    ctx.lineWidth = 3;
    roundRect(ctx, -15, -116, 30, 28, 9);
    ctx.stroke();

    ctx.fillStyle = '#f17c79';
    roundRect(ctx, -19, -124, 38, 13, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    roundRect(ctx, -14, -121, 22, 4, 2);
    ctx.fill();

    // A simple no-text label: cream circle, tiny coral heart and mint border.
    ctx.fillStyle = '#fff8dd';
    ctx.beginPath();
    ctx.arc(0, -55, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8fc2ad';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#ef7d7d';
    ctx.beginPath();
    ctx.arc(-4, -57, 4, 0, Math.PI * 2);
    ctx.arc(4, -57, 4, 0, Math.PI * 2);
    ctx.moveTo(-8, -55);
    ctx.lineTo(0, -45);
    ctx.lineTo(8, -55);
    ctx.fill();
    ctx.restore();
  }

  drawPour(ctx, angle) {
    const neck = { x: 0, y: -124 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const startX = this.baseX + neck.x * cos - neck.y * sin;
    const startY = this.baseY + neck.x * sin + neck.y * cos;
    const progress = clamp(this.stateT / POUR_SECONDS, 0, 1);
    const pulse = 0.82 + Math.sin((this.game.time ?? 0) * 18) * 0.12;

    ctx.save();
    ctx.strokeStyle = `rgba(255, 252, 231, ${0.78 * (1 - progress * 0.35)})`;
    ctx.lineWidth = (10 - progress * 4) * pulse;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX + 26,
      startY + 10,
      this.spillPoint.x - 28,
      this.spillPoint.y - 28,
      this.spillPoint.x,
      this.spillPoint.y,
    );
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.34 * (1 - progress * 0.45)})`;
    ctx.lineWidth = Math.max(2, (10 - progress * 4) * 0.32);
    ctx.stroke();
    ctx.restore();
  }
}

export default MilkBottle;
