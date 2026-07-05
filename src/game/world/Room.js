// The living room: layout, furniture footprints (collision), tap zones and
// procedural fallback rendering until generated art arrives.
import { TAU, clamp, rectDist, pointInRect, rand } from '../core/math.js';

export const WORLD_W = 1680;
export const WORLD_H = 1050;
export const WALL_H = 170; // wall band across the top

export class Room {
  constructor(game) {
    this.game = game;
    // Robot-center driving bounds
    this.bounds = { minX: 100, maxX: 1580, minY: 245, maxY: 950 };
    this.rug = { x: 540, y: 400, w: 640, h: 360 };
    this.window = { x: 300, y: 18, w: 340, h: 132 };
    this.tv = { x: 740, y: 26, w: 320, h: 122, on: 0 }; // on = seconds remaining
    this.tvWobble = 0;

    this.furniture = [
      {
        name: 'couch', sprite: 'couch',
        cx: 330, cy: 858, w: 520, h: 340,
        foot: { x: 95, y: 762, w: 470, h: 200 },
        baseline: 968,
      },
      {
        name: 'table', sprite: 'table',
        cx: 840, cy: 565, w: 360, h: 290,
        // Only the legs collide — the robot drives UNDER the tabletop!
        // Boxes measured from the actual painted feet in table.png
        // (scripts/measure: sprite 560x450 -> world via cx/cy/w/h mapping).
        foot: null,
        legs: [
          { x: 682, y: 598, w: 38, h: 28 },  // back-left foot
          { x: 753, y: 644, w: 40, h: 28 },  // front-left foot
          { x: 960, y: 586, w: 37, h: 28 },  // right foot
        ],
        baseline: 673, // lowest painted foot: south of this = in front of the table
      },
      {
        name: 'plant', sprite: 'plant',
        cx: 1562, cy: 852, w: 220, h: 280,
        foot: { x: 1490, y: 820, w: 145, h: 105 },
        baseline: 925,
      },
      {
        name: 'toybox', sprite: 'toybox',
        cx: 1535, cy: 585, w: 230, h: 190,
        foot: { x: 1440, y: 535, w: 190, h: 115 },
        baseline: 652,
      },
      {
        name: 'catbed', sprite: 'catbed',
        cx: 165, cy: 330, w: 200, h: 150,
        foot: { x: 80, y: 285, w: 170, h: 100 },
        baseline: 388,
      },
      {
        name: 'basket', sprite: 'basket',
        cx: 1545, cy: 288, w: 170, h: 170,
        foot: { x: 1470, y: 240, w: 150, h: 105 },
        baseline: 348,
      },
    ];
    this.couch = this.furniture[0];
    this.table = this.furniture[1];
    this.plantSway = 0;
  }

  update(dt) {
    if (this.tv.on > 0) this.tv.on -= dt;
    this.tvWobble += dt;
    if (this.plantSway > 0) this.plantSway = Math.max(0, this.plantSway - dt);
  }

  // Solid zone used when the robot must NOT slip under the coffee table
  // (e.g. carrying a sock overhead).
  static TABLE_SOLID = { x: 665, y: 450, w: 340, h: 225 };

  // Is this a valid position for a circle of radius r? (furniture + walls)
  isFree(x, y, r, { ignoreDock = false, ignoreCouch = false, solidTable = false } = {}) {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
    for (const f of this.furniture) {
      if (ignoreCouch && f.name === 'couch') continue;
      if (f.foot && rectDist(x, y, f.foot) < r) return false;
      if (f.legs) {
        // legs are solid at full radius — the robot slips BETWEEN them,
        // never through them
        for (const leg of f.legs) if (rectDist(x, y, leg) < r) return false;
      }
    }
    if (solidTable && rectDist(x, y, Room.TABLE_SOLID) < r) return false;
    if (!ignoreDock && this.game.dock && rectDist(x, y, this.game.dock.footprint) < r) return false;
    return true;
  }

  // What did a circle at (x, y) hit? Returns a push-away normal estimate.
  collisionNormal(x, y, r, opts = {}) {
    const b = this.bounds;
    if (x < b.minX) return { nx: 1, ny: 0, what: 'wall' };
    if (x > b.maxX) return { nx: -1, ny: 0, what: 'wall' };
    if (y < b.minY) return { nx: 0, ny: 1, what: 'wall' };
    if (y > b.maxY) return { nx: 0, ny: -1, what: 'wall' };
    const rects = [];
    for (const f of this.furniture) {
      if (opts.ignoreCouch && f.name === 'couch') continue;
      if (f.foot) rects.push({ r: f.foot, what: f.name });
      if (f.legs) for (const leg of f.legs) rects.push({ r: leg, what: 'leg', shrink: 1 });
    }
    if (!opts.ignoreDock && this.game.dock) rects.push({ r: this.game.dock.footprint, what: 'dock' });
    for (const { r: rect, what, shrink } of rects) {
      if (rectDist(x, y, rect) < r * (shrink ?? 1)) {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const dx = x - cx;
        const dy = y - cy;
        const len = Math.hypot(dx, dy) || 1;
        return { nx: dx / len, ny: dy / len, what };
      }
    }
    return null;
  }

  randomFloorPoint(r = 60) {
    for (let i = 0; i < 40; i++) {
      const x = rand(this.bounds.minX + 30, this.bounds.maxX - 30);
      const y = rand(this.bounds.minY + 30, this.bounds.maxY - 30);
      if (this.isFree(x, y, r)) return { x, y };
    }
    return { x: 840, y: 700 };
  }

  tapFurniture(x, y) {
    // Returns name of tappable furniture/wall object hit, or null
    if (pointInRect(x, y, { x: this.tv.x, y: this.tv.y, w: this.tv.w, h: this.tv.h + 40 })) return 'tv';
    for (const f of this.furniture) {
      const box = { x: f.cx - f.w / 2, y: f.cy - f.h / 2, w: f.w, h: f.h };
      if (pointInRect(x, y, box)) return f.name;
    }
    return null;
  }

  // ---- drawing -----------------------------------------------------------

  drawBase(ctx, assets) {
    const room = assets.get('room');
    if (room) {
      ctx.drawImage(room, 0, 0, WORLD_W, WORLD_H);
    } else {
      this.drawProcFloorWall(ctx);
    }
    const rug = assets.get('rug');
    if (rug) {
      ctx.drawImage(rug, this.rug.x - 24, this.rug.y - 18, this.rug.w + 48, this.rug.h + 40);
    } else {
      this.drawProcRug(ctx);
    }
    const win = assets.get('window');
    if (win) {
      ctx.drawImage(win, this.window.x - 24, this.window.y - 14, this.window.w + 48, this.window.h + 44);
    } else {
      this.drawProcWindow(ctx);
    }
  }

  drawProcFloorWall(ctx) {
    // Wall
    const wallGrad = ctx.createLinearGradient(0, 0, 0, WALL_H);
    wallGrad.addColorStop(0, '#f5e3cf');
    wallGrad.addColorStop(1, '#eed5bb');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, WORLD_W, WALL_H);
    // Baseboard
    ctx.fillStyle = '#fdf3e3';
    ctx.fillRect(0, WALL_H - 26, WORLD_W, 26);
    ctx.fillStyle = 'rgba(120,80,50,0.14)';
    ctx.fillRect(0, WALL_H - 4, WORLD_W, 4);

    // Floor: warm wood planks
    const floorGrad = ctx.createLinearGradient(0, WALL_H, 0, WORLD_H);
    floorGrad.addColorStop(0, '#e8b884');
    floorGrad.addColorStop(1, '#d9a06b');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, WALL_H, WORLD_W, WORLD_H - WALL_H);
    ctx.strokeStyle = 'rgba(140, 85, 45, 0.18)';
    ctx.lineWidth = 3;
    const plankH = 88;
    for (let y = WALL_H + plankH; y < WORLD_H; y += plankH) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
    }
    // plank seams
    ctx.lineWidth = 2;
    let row = 0;
    for (let y = WALL_H; y < WORLD_H; y += plankH) {
      const off = (row % 2) * 260;
      for (let x = 180 + off; x < WORLD_W; x += 520) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.min(y + plankH, WORLD_H));
        ctx.stroke();
      }
      row++;
    }

  }

  drawProcWindow(ctx) {
    const w = this.window;
    ctx.fillStyle = '#b98a5e';
    roundRect(ctx, w.x - 12, w.y - 12, w.w + 24, w.h + 24, 14);
    ctx.fill();
    const sky = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
    sky.addColorStop(0, '#8ed8f8');
    sky.addColorStop(1, '#d8f3ff');
    ctx.fillStyle = sky;
    roundRect(ctx, w.x, w.y, w.w, w.h, 8);
    ctx.fill();
    // sun + cloud
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.arc(w.x + 70, w.y + 44, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(w.x + 210, w.y + 60, 52, 22, 0, 0, TAU);
    ctx.ellipse(w.x + 250, w.y + 48, 38, 18, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#b98a5e';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(w.x + w.w / 2, w.y);
    ctx.lineTo(w.x + w.w / 2, w.y + w.h);
    ctx.stroke();
  }

  drawProcRug(ctx) {
    // Rug: two-tone with playful dots
    const r = this.rug;
    ctx.fillStyle = '#e8656f';
    roundRect(ctx, r.x, r.y, r.w, r.h, 38);
    ctx.fill();
    ctx.fillStyle = '#f2848d';
    roundRect(ctx, r.x + 22, r.y + 22, r.w - 44, r.h - 44, 28);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 24; i++) {
      const dx = r.x + 60 + ((i * 137) % (r.w - 120));
      const dy = r.y + 55 + ((i * 89) % (r.h - 110));
      ctx.beginPath();
      ctx.arc(dx, dy, 7, 0, TAU);
      ctx.fill();
    }
  }

  drawTV(ctx) {
    const tv = this.tv;
    const sprite = this.game.assets.get('tv');
    if (sprite) {
      ctx.drawImage(sprite, tv.x - 18, tv.y - 16, tv.w + 36, tv.h + 42);
    } else {
      ctx.fillStyle = '#3d3a45';
      roundRect(ctx, tv.x - 10, tv.y - 10, tv.w + 20, tv.h + 20, 12);
      ctx.fill();
    }
    if (tv.on > 0) {
      const t = this.tvWobble;
      const frames = [
        this.game.assets.get('tv_show1'),
        this.game.assets.get('tv_show2'),
        this.game.assets.get('tv_show3'),
      ].filter(Boolean);
      ctx.save();
      roundRect(ctx, tv.x, tv.y, tv.w, tv.h, 8);
      ctx.clip();
      if (frames.length) {
        // a real cartoon: each shot holds ~4s with a slow Ken Burns drift
        const SHOT = 4;
        const idx = Math.floor(t / SHOT) % frames.length;
        const shotT = (t % SHOT) / SHOT;
        const img = frames[idx];
        const zoom = 1.06 + 0.07 * (idx % 2 === 0 ? shotT : 1 - shotT);
        const panX = (idx % 2 === 0 ? 1 : -1) * (shotT - 0.5) * 14;
        const dw = tv.w * zoom;
        const dh = dw * (img.height / img.width);
        ctx.drawImage(img, tv.x + (tv.w - dw) / 2 + panX, tv.y + (tv.h - dh) / 2, dw, dh);
        // channel-flip flash
        const sinceCut = (t % SHOT);
        if (sinceCut < 0.14) {
          ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * (1 - sinceCut / 0.14)})`;
          ctx.fillRect(tv.x, tv.y, tv.w, tv.h);
        }
        // faint scanlines for TV feel
        ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
        for (let y = tv.y + 1; y < tv.y + tv.h; y += 3) {
          ctx.fillRect(tv.x, y, tv.w, 1);
        }
        // soft screen sheen
        const sheen = ctx.createLinearGradient(tv.x, tv.y, tv.x + tv.w * 0.6, tv.y + tv.h);
        sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
        sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(tv.x, tv.y, tv.w, tv.h);
      } else {
        // fallback: colorful bouncing shapes
        const g = ctx.createLinearGradient(tv.x, tv.y, tv.x + tv.w, tv.y + tv.h);
        g.addColorStop(0, `hsl(${(t * 40) % 360}, 80%, 72%)`);
        g.addColorStop(1, `hsl(${(t * 40 + 120) % 360}, 80%, 78%)`);
        ctx.fillStyle = g;
        ctx.fillRect(tv.x, tv.y, tv.w, tv.h);
        for (let i = 0; i < 4; i++) {
          const bx = tv.x + tv.w * (0.2 + 0.2 * i) + Math.sin(t * 2.2 + i * 1.9) * 24;
          const by = tv.y + tv.h * 0.5 + Math.cos(t * 3 + i * 2.3) * 26;
          ctx.fillStyle = `hsla(${(i * 90 + t * 90) % 360}, 90%, 55%, 0.9)`;
          ctx.beginPath();
          if (i % 2) ctx.arc(bx, by, 16 + Math.sin(t * 4 + i) * 5, 0, TAU);
          else ctx.rect(bx - 14, by - 14, 28, 28);
          ctx.fill();
        }
      }
      ctx.restore();
      // glow spilling onto the wall
      ctx.fillStyle = `rgba(180, 220, 255, ${0.08 + 0.03 * Math.sin(t * 7)})`;
      roundRect(ctx, tv.x - 16, tv.y - 16, tv.w + 32, tv.h + 60, 16);
      ctx.fill();
    } else if (!sprite) {
      const g = ctx.createLinearGradient(tv.x, tv.y, tv.x, tv.y + tv.h);
      g.addColorStop(0, '#20242e');
      g.addColorStop(1, '#12141b');
      ctx.fillStyle = g;
      roundRect(ctx, tv.x, tv.y, tv.w, tv.h, 8);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(tv.x + 20, tv.y + tv.h);
      ctx.lineTo(tv.x + 90, tv.y);
      ctx.lineTo(tv.x + 150, tv.y);
      ctx.lineTo(tv.x + 80, tv.y + tv.h);
      ctx.fill();
    }
  }

  drawFurniture(ctx, assets, f) {
    const img = assets.get(f.sprite);
    const sway = f.name === 'plant' && this.plantSway > 0 ? Math.sin(this.plantSway * 18) * 0.06 * this.plantSway : 0;
    ctx.save();
    ctx.translate(f.cx, f.cy);
    if (sway) {
      ctx.translate(0, f.h / 2);
      ctx.rotate(sway);
      ctx.translate(0, -f.h / 2);
    }
    if (img) {
      ctx.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
    } else {
      switch (f.name) {
        case 'couch': drawCouch(ctx, f); break;
        case 'table': drawTable(ctx, f); break;
        case 'plant': drawPlant(ctx, f); break;
        case 'toybox': drawToybox(ctx, f); break;
        case 'catbed': drawCatbed(ctx, f); break;
        case 'basket': drawBasket(ctx, f); break;
      }
    }
    if (f.name === 'basket') this.drawBasketSocks(ctx, f);
    ctx.restore();
  }

  // collected socks peek out over the basket rim
  drawBasketSocks(ctx, f) {
    const socks = this.game.basketSocks;
    if (!socks || !socks.length) return;
    const assets = this.game.assets;
    const t = this.tvWobble; // reuse the ambient clock
    const shown = Math.min(socks.length, 6);
    for (let i = 0; i < shown; i++) {
      const tint = socks[i];
      const lx = -44 + (i % 3) * 36 + (i > 2 ? 16 : 0);
      const ly = -f.h * 0.32 - (i % 2) * 9 - (i > 2 ? 4 : 0);
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((i % 2 ? 0.45 : -0.4) + Math.sin(t * 0.7 + i * 1.7) * 0.05);
      const img = assets.getTinted('sock', tint);
      if (img) {
        ctx.drawImage(img, -23, -23, 46, 46);
      } else {
        ctx.fillStyle = tint;
        roundRect(ctx, -8, -18, 16, 30, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        roundRect(ctx, -8, -18, 16, 9, 4.5);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function softShadow(ctx, w, h, dy = 0) {
  ctx.fillStyle = 'rgba(90, 50, 30, 0.22)';
  ctx.beginPath();
  ctx.ellipse(0, dy, w / 2, h / 2, 0, 0, TAU);
  ctx.fill();
}

function drawCouch(ctx, f) {
  softShadow(ctx, f.w * 0.95, 70, f.h * 0.32);
  // base
  ctx.fillStyle = '#4d96d9';
  roundRect(ctx, -f.w / 2, -f.h * 0.18, f.w, f.h * 0.5, 30);
  ctx.fill();
  // back
  ctx.fillStyle = '#3b7fc4';
  roundRect(ctx, -f.w / 2, -f.h / 2, f.w, f.h * 0.42, 30);
  ctx.fill();
  // cushions
  ctx.fillStyle = '#5ba5e8';
  roundRect(ctx, -f.w / 2 + 26, -f.h * 0.16, f.w / 2 - 34, f.h * 0.34, 22);
  ctx.fill();
  roundRect(ctx, 8, -f.h * 0.16, f.w / 2 - 34, f.h * 0.34, 22);
  ctx.fill();
  // arms
  ctx.fillStyle = '#3b7fc4';
  roundRect(ctx, -f.w / 2 - 6, -f.h * 0.3, 54, f.h * 0.62, 24);
  ctx.fill();
  roundRect(ctx, f.w / 2 - 48, -f.h * 0.3, 54, f.h * 0.62, 24);
  ctx.fill();
  // pillow
  ctx.save();
  ctx.translate(-f.w * 0.28, -f.h * 0.22);
  ctx.rotate(-0.15);
  ctx.fillStyle = '#ffd23f';
  roundRect(ctx, -38, -34, 76, 68, 18);
  ctx.fill();
  ctx.restore();
}

function drawTable(ctx, f) {
  softShadow(ctx, f.w * 0.85, 56, f.h * 0.42);
  // legs
  ctx.fillStyle = '#9c6b3f';
  for (const [lx, ly] of [[-120, -78], [120, -78], [-120, 72], [120, 72]]) {
    roundRect(ctx, lx - 12, ly - 6, 24, f.h * 0.42, 8);
    ctx.fill();
  }
  // top
  const g = ctx.createLinearGradient(0, -f.h * 0.5, 0, -f.h * 0.1);
  g.addColorStop(0, '#c98d55');
  g.addColorStop(1, '#b07640');
  ctx.fillStyle = g;
  roundRect(ctx, -f.w / 2, -f.h / 2, f.w, f.h * 0.42, 26);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  roundRect(ctx, -f.w / 2 + 14, -f.h / 2 + 10, f.w - 28, 18, 9);
  ctx.fill();
  // book on table
  ctx.fillStyle = '#e8656f';
  roundRect(ctx, 30, -f.h * 0.38, 90, 62, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  roundRect(ctx, 38, -f.h * 0.38 + 8, 74, 46, 4);
  ctx.fill();
}

function drawPlant(ctx, f) {
  softShadow(ctx, f.w * 0.6, 46, f.h * 0.36);
  // pot
  ctx.fillStyle = '#e07a4f';
  ctx.beginPath();
  ctx.moveTo(-52, f.h * 0.08);
  ctx.lineTo(52, f.h * 0.08);
  ctx.lineTo(38, f.h * 0.36);
  ctx.lineTo(-38, f.h * 0.36);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#c96540';
  roundRect(ctx, -58, f.h * 0.02, 116, 22, 10);
  ctx.fill();
  // leaves
  const leaves = [[-40, -60, -0.7], [40, -66, 0.7], [-18, -100, -0.25], [22, -104, 0.3], [0, -70, 0]];
  for (const [lx, ly, ang] of leaves) {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(ang);
    const lg = ctx.createLinearGradient(0, -60, 0, 30);
    lg.addColorStop(0, '#66bb6a');
    lg.addColorStop(1, '#388e3c');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(0, -30, 26, 58, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawToybox(ctx, f) {
  softShadow(ctx, f.w * 0.8, 50, f.h * 0.36);
  ctx.fillStyle = '#8862c9';
  roundRect(ctx, -f.w / 2 + 15, -f.h * 0.28, f.w - 30, f.h * 0.62, 18);
  ctx.fill();
  ctx.fillStyle = '#6f4cad';
  roundRect(ctx, -f.w / 2 + 8, -f.h * 0.34, f.w - 16, 30, 12);
  ctx.fill();
  // peeking toys
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(-40, -f.h * 0.36, 20, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ff5d8f';
  roundRect(ctx, 12, -f.h * 0.46, 34, 30, 8);
  ctx.fill();
  ctx.fillStyle = '#3ddad7';
  ctx.beginPath();
  ctx.moveTo(70, -f.h * 0.32);
  ctx.lineTo(88, -f.h * 0.56);
  ctx.lineTo(106, -f.h * 0.32);
  ctx.closePath();
  ctx.fill();
  // star on box
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  starPath(ctx, 0, f.h * 0.02, 5, 26, 12);
  ctx.fill();
}

function drawCatbed(ctx, f) {
  softShadow(ctx, f.w * 0.85, 44, f.h * 0.3);
  ctx.fillStyle = '#d97fa6';
  ctx.beginPath();
  ctx.ellipse(0, 0, f.w / 2, f.h * 0.44, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f3b3cf';
  ctx.beginPath();
  ctx.ellipse(0, f.h * 0.06, f.w / 2 - 26, f.h * 0.3, 0, 0, TAU);
  ctx.fill();
}

function drawBasket(ctx, f) {
  softShadow(ctx, f.w * 0.8, 42, f.h * 0.34);
  const g = ctx.createLinearGradient(-f.w / 2, 0, f.w / 2, 0);
  g.addColorStop(0, '#d9b380');
  g.addColorStop(0.5, '#eccb99');
  g.addColorStop(1, '#d9b380');
  ctx.fillStyle = g;
  roundRect(ctx, -f.w / 2 + 12, -f.h * 0.34, f.w - 24, f.h * 0.66, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 95, 45, 0.35)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-f.w / 2 + 16, -f.h * 0.2 + i * 26);
    ctx.lineTo(f.w / 2 - 16, -f.h * 0.2 + i * 26);
    ctx.stroke();
  }
  ctx.fillStyle = '#c49a63';
  roundRect(ctx, -f.w / 2 + 6, -f.h * 0.42, f.w - 12, 24, 12);
  ctx.fill();
  // sock hanging out
  ctx.save();
  ctx.translate(f.w * 0.24, -f.h * 0.36);
  ctx.rotate(0.5);
  ctx.fillStyle = '#ff8a5c';
  roundRect(ctx, -10, 0, 20, 44, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  roundRect(ctx, -10, 0, 20, 12, 6);
  ctx.fill();
  ctx.restore();
}

export function starPath(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}
