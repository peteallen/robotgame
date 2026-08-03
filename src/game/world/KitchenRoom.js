// The second full-size room. Generated kitchen art is optional: the procedural
// scene keeps the same rounded, warm, toy-like visual language as the living
// room and remains completely playable on its own.
import { TAU, pointInRect } from '../core/math.js';
import { Room, WORLD_W, WORLD_H, WALL_H, roundRect } from './Room.js';

export class KitchenRoom extends Room {
  constructor(game) {
    super(game);
    this.id = 'kitchen';
    this.name = 'Kitchen';
    this.type = 'kitchen';
    this.bounds = { minX: 100, maxX: 1580, minY: 245, maxY: 950 };
    this.window = { x: 640, y: 22, w: 300, h: 126 };
    this.rug = { x: 625, y: 802, w: 420, h: 112 };

    this.furniture = [
      {
        name: 'back_cabinets', sprite: null, partOfBaseArtwork: true,
        cx: 770, cy: 300, w: 830, h: 300,
        foot: { x: 365, y: 326, w: 810, h: 88 },
        baseline: 414,
      },
      {
        name: 'sink', sprite: null, partOfBaseArtwork: true,
        cx: 790, cy: 307, w: 310, h: 225,
        foot: null,
        baseline: 416,
      },
      {
        name: 'fridge', sprite: 'kitchen_fridge',
        cx: 1420, cy: 330, w: 284, h: 396,
        foot: { x: 1282, y: 345, w: 280, h: 160 },
        baseline: 516,
      },
      {
        name: 'island', sprite: 'kitchen_island',
        cx: 835, cy: 625, w: 530, h: 365,
        foot: { x: 600, y: 565, w: 470, h: 210 },
        baseline: 804,
      },
      {
        name: 'trash', sprite: 'kitchen_bin',
        // Keep the bin against the right wall so it reads as part of the room
        // edge and leaves the bottle's fall, stream and spreading milk clear.
        // It still finishes above the compact landscape minimap card.
        cx: 1470, cy: 714, w: 172, h: 220,
        foot: { x: 1403, y: 659, w: 134, h: 112 },
        baseline: 814,
      },
    ];
    this.couch = null;
    this.table = this.getFurniture('island');
    // The island is already a fully solid footprint; do not inherit the
    // living-room coffee-table special case.
    this.tableSolidFootprint = false;

    this.portals = [
      {
        id: 'kitchen-to-living',
        targetRoomId: 'living',
        targetPortalId: 'living-to-kitchen',
        side: 'left',
        trigger: { x: 0, y: 430, w: 230, h: 410 },
        opening: { x: 0, y: 485, w: 150, h: 315 },
        approach: { x: 255, y: 640 },
        threshold: { x: 110, y: 640 },
        entry: { x: 170, y: 640 },
        arrival: { x: 285, y: 640 },
        exit: { x: -40, y: 640 },
        angle: Math.PI,
      },
    ];

    this.clock = 0;
    this.fridgeWobble = 0;
    this.trashWobble = 0;
    this.sinkTime = 0;
    this.cabinetBounce = 0;
  }

  update(dt) {
    this.clock += dt;
    this.fridgeWobble = Math.max(0, this.fridgeWobble - dt);
    this.trashWobble = Math.max(0, this.trashWobble - dt);
    this.sinkTime = Math.max(0, this.sinkTime - dt);
    this.cabinetBounce = Math.max(0, this.cabinetBounce - dt);
  }

  tapFurniture(x, y) {
    // Check front-most, smaller targets first. All zones are deliberately
    // forgiving and extend beyond the painted object.
    const zones = [
      ['trash', { x: 1363, y: 582, w: 220, h: 270 }],
      ['island', { x: 545, y: 438, w: 590, h: 385 }],
      ['fridge', { x: 1260, y: 92, w: 330, h: 430 }],
      ['sink', { x: 610, y: 174, w: 360, h: 260 }],
      ['back_cabinets', { x: 330, y: 148, w: 880, h: 300 }],
    ];
    for (const [name, zone] of zones) if (pointInRect(x, y, zone)) return name;
    return null;
  }

  activateFurniture(name) {
    if (name === 'fridge') this.fridgeWobble = 0.8;
    else if (name === 'trash') this.trashWobble = 0.7;
    else if (name === 'sink') this.sinkTime = 1.6;
    else if (name === 'back_cabinets') this.cabinetBounce = 0.65;
    else if (name !== 'island') return false;
    return true;
  }

  drawBase(ctx, assets) {
    const roomArtwork = assets.get('kitchen_room');
    if (roomArtwork) {
      ctx.drawImage(roomArtwork, 0, 0, WORLD_W, WORLD_H);
      drawKitchenWindow(ctx, this.window);
      this.drawKitchenMat(ctx);
    } else {
      this.drawProceduralKitchen(ctx);
    }
    this.drawDoorways(ctx, assets);
  }

  // The game asks every room for a television layer. The kitchen intentionally
  // has no television, so this preserves the shared room interface as a no-op.
  drawTV() {}

  drawFurniture(ctx, assets, furniture) {
    const image = furniture.sprite ? assets?.get?.(furniture.sprite) : null;
    const wobble = furniture.name === 'fridge'
      ? Math.sin(this.fridgeWobble * 27) * 0.025 * this.fridgeWobble
      : furniture.name === 'trash'
        ? Math.sin(this.trashWobble * 32) * 0.055 * this.trashWobble
        : 0;
    const bounce = (furniture.name === 'back_cabinets' || furniture.name === 'sink')
      ? Math.sin(this.cabinetBounce * 22) * 5 * this.cabinetBounce
      : 0;

    ctx.save();
    ctx.translate(furniture.cx, furniture.cy + bounce);
    if (wobble) {
      ctx.translate(0, furniture.h / 2);
      ctx.rotate(wobble);
      ctx.translate(0, -furniture.h / 2);
    }
    if (image) {
      ctx.drawImage(image, -furniture.w / 2, -furniture.h / 2, furniture.w, furniture.h);
    } else {
      switch (furniture.name) {
        case 'back_cabinets': drawBackCabinets(ctx, furniture); break;
        case 'sink': drawSink(ctx, furniture, this.clock, this.sinkTime); break;
        case 'fridge': drawFridge(ctx, furniture, this.clock, this.fridgeWobble); break;
        case 'island': drawIsland(ctx, furniture); break;
        case 'trash': drawTrash(ctx, furniture, this.clock, this.trashWobble); break;
      }
    }
    ctx.restore();
  }

  drawProceduralKitchen(ctx) {
    // Warm cream wall, matching the living room rather than feeling like a
    // separate game screen.
    const wall = ctx.createLinearGradient(0, 0, 0, WALL_H + 80);
    wall.addColorStop(0, '#f7e7d5');
    wall.addColorStop(1, '#efd7bf');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, WORLD_W, WALL_H + 80);

    // Pale honey tile keeps dirt readable while distinguishing this room from
    // the living room's wooden boards.
    const floor = ctx.createLinearGradient(0, WALL_H, 0, WORLD_H);
    floor.addColorStop(0, '#efd0a3');
    floor.addColorStop(1, '#deb37e');
    ctx.fillStyle = floor;
    ctx.fillRect(0, WALL_H, WORLD_W, WORLD_H - WALL_H);
    ctx.strokeStyle = 'rgba(135, 91, 51, 0.15)';
    ctx.lineWidth = 3;
    const tile = 118;
    for (let y = WALL_H; y < WORLD_H; y += tile) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_W, y);
      ctx.stroke();
      const offset = ((y - WALL_H) / tile) % 2 ? tile / 2 : 0;
      for (let x = offset; x < WORLD_W; x += tile) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, Math.min(y + tile, WORLD_H));
        ctx.stroke();
      }
    }

    // Wide baseboard with the same soft highlight used in the original room.
    ctx.fillStyle = '#fff4e5';
    ctx.fillRect(0, WALL_H - 18, WORLD_W, 24);
    ctx.fillStyle = 'rgba(111,74,44,0.13)';
    ctx.fillRect(0, WALL_H + 3, WORLD_W, 4);

    drawKitchenWindow(ctx, this.window);

    this.drawKitchenMat(ctx);
  }

  drawKitchenMat(ctx) {
    // Coral anti-fatigue mat echoes the living-room rug without competing with
    // crumbs, cereal or mop shine effects.
    ctx.fillStyle = 'rgba(116,70,46,0.16)';
    roundRect(ctx, this.rug.x + 5, this.rug.y + 11, this.rug.w, this.rug.h, 34);
    ctx.fill();
    const mat = ctx.createLinearGradient(this.rug.x, 0, this.rug.x + this.rug.w, 0);
    mat.addColorStop(0, '#e86c76');
    mat.addColorStop(0.5, '#f58c8f');
    mat.addColorStop(1, '#e86c76');
    ctx.fillStyle = mat;
    roundRect(ctx, this.rug.x, this.rug.y, this.rug.w, this.rug.h, 34);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 5;
    roundRect(ctx, this.rug.x + 18, this.rug.y + 17, this.rug.w - 36, this.rug.h - 34, 23);
    ctx.stroke();
  }
}

function drawKitchenWindow(ctx, window) {
  ctx.fillStyle = '#b98356';
  roundRect(ctx, window.x - 13, window.y - 12, window.w + 26, window.h + 25, 15);
  ctx.fill();
  const sky = ctx.createLinearGradient(0, window.y, 0, window.y + window.h);
  sky.addColorStop(0, '#8ed8f8');
  sky.addColorStop(1, '#e5f7ff');
  ctx.fillStyle = sky;
  roundRect(ctx, window.x, window.y, window.w, window.h, 8);
  ctx.fill();
  ctx.fillStyle = '#ffe06a';
  ctx.beginPath();
  ctx.arc(window.x + 58, window.y + 42, 23, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(window.x + 206, window.y + 58, 50, 20, 0, 0, TAU);
  ctx.ellipse(window.x + 240, window.y + 49, 32, 17, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#b98356';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(window.x + window.w / 2, window.y);
  ctx.lineTo(window.x + window.w / 2, window.y + window.h);
  ctx.stroke();
}

function drawShadow(ctx, width, height, y) {
  ctx.fillStyle = 'rgba(93,55,31,0.2)';
  ctx.beginPath();
  ctx.ellipse(0, y, width / 2, height / 2, 0, 0, TAU);
  ctx.fill();
}

function drawBackCabinets(ctx, furniture) {
  drawShadow(ctx, furniture.w * 0.96, 38, furniture.h * 0.42);

  // A continuous tiled backsplash visually joins the wall cupboards, sink,
  // counter and lower cabinets. Without this shared backing, the individual
  // cupboard doors read as unrelated floating rectangles.
  const backsplashX = -furniture.w / 2 + 6;
  const backsplashY = -132;
  const backsplashW = furniture.w - 12;
  const backsplashH = 116;
  ctx.save();
  roundRect(ctx, backsplashX, backsplashY, backsplashW, backsplashH, 14);
  ctx.clip();
  // Warm subway tile keeps this area recognizably architectural. The earlier
  // flat mint panel looked like an unexplained status display behind the sink.
  const backsplash = ctx.createLinearGradient(0, backsplashY, 0, backsplashY + backsplashH);
  backsplash.addColorStop(0, '#fffaf0');
  backsplash.addColorStop(1, '#e9dfcc');
  ctx.fillStyle = backsplash;
  ctx.fillRect(backsplashX, backsplashY, backsplashW, backsplashH);
  ctx.strokeStyle = 'rgba(126,137,112,0.2)';
  ctx.lineWidth = 2;
  const tileH = 38;
  const tileW = 72;
  for (let row = 0, y = backsplashY; y <= backsplashY + backsplashH; row++, y += tileH) {
    ctx.beginPath();
    ctx.moveTo(backsplashX, y);
    ctx.lineTo(backsplashX + backsplashW, y);
    ctx.stroke();
    const offset = row % 2 ? tileW / 2 : 0;
    for (let x = backsplashX + offset; x < backsplashX + backsplashW; x += tileW) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, Math.min(y + tileH, backsplashY + backsplashH));
      ctx.stroke();
    }
  }
  const tileGlow = ctx.createLinearGradient(0, backsplashY, 0, backsplashY + backsplashH);
  tileGlow.addColorStop(0, 'rgba(255,255,255,0.38)');
  tileGlow.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = tileGlow;
  ctx.fillRect(backsplashX, backsplashY, backsplashW, backsplashH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(112,126,104,0.24)';
  ctx.lineWidth = 3;
  roundRect(ctx, backsplashX, backsplashY, backsplashW, backsplashH, 14);
  ctx.stroke();

  // Lower cabinet doors share one carcass and toe kick instead of looking like
  // anonymous vertical divisions below the counter.
  const baseX = -furniture.w / 2;
  const baseY = -6;
  const baseH = 134;
  const base = ctx.createLinearGradient(0, baseY, 0, baseY + baseH);
  base.addColorStop(0, '#fff8e9');
  base.addColorStop(1, '#ebdfca');
  ctx.fillStyle = base;
  roundRect(ctx, baseX, baseY, furniture.w, baseH, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(124,104,76,0.22)';
  ctx.lineWidth = 3;
  roundRect(ctx, baseX, baseY, furniture.w, baseH, 18);
  ctx.stroke();
  const baseInset = 14;
  const baseGap = 10;
  const baseDoorW = (furniture.w - baseInset * 2 - baseGap * 3) / 4;
  for (let index = 0; index < 4; index++) {
    const doorX = baseX + baseInset + index * (baseDoorW + baseGap);
    ctx.fillStyle = 'rgba(255,252,241,0.65)';
    roundRect(ctx, doorX, 12, baseDoorW, 92, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,117,84,0.22)';
    ctx.lineWidth = 3;
    roundRect(ctx, doorX, 12, baseDoorW, 92, 10);
    ctx.stroke();
    ctx.fillStyle = '#d9ae50';
    roundRect(ctx, doorX + baseDoorW / 2 - 14, 24, 28, 7, 4);
    ctx.fill();
  }
  ctx.fillStyle = '#d4c2a7';
  roundRect(ctx, baseX + 22, 113, furniture.w - 44, 12, 6);
  ctx.fill();

  // Two clearly framed cupboard banks flank the window and sink. Keeping the
  // middle open makes the room layout immediately legible at game scale.
  const upperY = -furniture.h / 2;
  const bankW = 245;
  const bankH = 116;
  const doorGap = 8;
  const casing = 10;
  const doorW = (bankW - casing * 2 - doorGap) / 2;
  const doorFill = ctx.createLinearGradient(0, upperY, 0, upperY + bankH);
  doorFill.addColorStop(0, '#9bc9b0');
  doorFill.addColorStop(1, '#77ad91');
  for (const bankX of [-390, 185]) {
    ctx.fillStyle = 'rgba(92,62,43,0.16)';
    roundRect(ctx, bankX + 4, upperY + 7, bankW, bankH, 20);
    ctx.fill();
    ctx.fillStyle = '#f7eddd';
    roundRect(ctx, bankX, upperY, bankW, bankH, 20);
    ctx.fill();
    ctx.strokeStyle = '#d4b990';
    ctx.lineWidth = 4;
    roundRect(ctx, bankX, upperY, bankW, bankH, 20);
    ctx.stroke();

    for (let index = 0; index < 2; index++) {
      const doorX = bankX + casing + index * (doorW + doorGap);
      ctx.fillStyle = doorFill;
      roundRect(ctx, doorX, upperY + casing, doorW, bankH - casing * 2, 13);
      ctx.fill();
      ctx.strokeStyle = 'rgba(65,110,87,0.36)';
      ctx.lineWidth = 3;
      roundRect(ctx, doorX, upperY + casing, doorW, bankH - casing * 2, 13);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(242,250,240,0.58)';
      ctx.lineWidth = 3;
      roundRect(ctx, doorX + 10, upperY + casing + 10, doorW - 20, bankH - casing * 2 - 28, 9);
      ctx.stroke();

      const handleX = index === 0 ? doorX + doorW - 13 : doorX + 13;
      ctx.fillStyle = '#edc45d';
      roundRect(ctx, handleX - 3, upperY + bankH - 34, 6, 18, 3);
      ctx.fill();
    }

    ctx.fillStyle = '#d7b77f';
    roundRect(ctx, bankX + 16, upperY + bankH - 5, bankW - 32, 9, 5);
    ctx.fill();
  }

  // Butcher-block counter and small colorful canisters.
  const counter = ctx.createLinearGradient(0, -15, 0, 22);
  counter.addColorStop(0, '#dba469');
  counter.addColorStop(1, '#b97842');
  ctx.fillStyle = counter;
  roundRect(ctx, -furniture.w / 2 - 14, -22, furniture.w + 28, 42, 15);
  ctx.fill();
  ctx.fillStyle = 'rgba(113,66,35,0.22)';
  roundRect(ctx, -furniture.w / 2, 11, furniture.w, 9, 5);
  ctx.fill();
  for (const [x, color, height] of [[-300, '#e86c76', 42], [268, '#f4c84c', 54], [326, '#71b9c5', 38]]) {
    ctx.fillStyle = color;
    roundRect(ctx, x - 17, -24 - height, 34, height, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    roundRect(ctx, x - 20, -29 - height, 40, 9, 5);
    ctx.fill();
  }
}

function drawSink(ctx, furniture, clock, sinkTime) {
  // Keep the entire metal rim inside the butcher-block top. The old, deeper
  // pill extended over the counter's front edge and read like a control panel.
  ctx.fillStyle = 'rgba(79,72,57,0.18)';
  roundRect(ctx, -121, -23, 242, 34, 13);
  ctx.fill();
  const rim = ctx.createLinearGradient(0, -27, 0, 9);
  rim.addColorStop(0, '#f2f5ef');
  rim.addColorStop(1, '#bdceca');
  ctx.fillStyle = rim;
  roundRect(ctx, -118, -27, 236, 36, 13);
  ctx.fill();
  ctx.strokeStyle = '#8fa8a6';
  ctx.lineWidth = 3;
  roundRect(ctx, -118, -27, 236, 36, 13);
  ctx.stroke();
  const basin = ctx.createLinearGradient(0, -21, 0, 2);
  basin.addColorStop(0, '#c8d7d5');
  basin.addColorStop(1, '#8fa9ad');
  ctx.fillStyle = basin;
  roundRect(ctx, -96, -21, 192, 23, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  roundRect(ctx, -91, -18, 182, 14, 6);
  ctx.stroke();
  ctx.fillStyle = '#69878b';
  ctx.beginPath();
  ctx.arc(0, -7, 5, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(226,238,235,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -7, 2.5, 0, TAU);
  ctx.stroke();

  // A compact gooseneck faucet has a dark silhouette, bright metal face and a
  // visible nozzle, so it no longer resembles an unsupported curved blob.
  const faucetPath = () => {
    ctx.beginPath();
    ctx.moveTo(54, -23);
    ctx.bezierCurveTo(54, -92, -38, -92, -38, -40);
    ctx.lineTo(-38, -32);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(70,96,94,0.34)';
  ctx.lineWidth = 20;
  faucetPath();
  ctx.stroke();
  ctx.strokeStyle = '#c9d8d4';
  ctx.lineWidth = 13;
  faucetPath();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.62)';
  ctx.lineWidth = 4;
  faucetPath();
  ctx.stroke();
  ctx.fillStyle = '#9eb5b2';
  roundRect(ctx, -46, -39, 16, 21, 6);
  ctx.fill();
  ctx.fillStyle = '#dce6e2';
  ctx.beginPath();
  ctx.ellipse(54, -21, 15, 10, 0, 0, TAU);
  ctx.fill();

  // Small warm lever provides a familiar control without adding visual noise.
  ctx.fillStyle = '#e9bd5b';
  roundRect(ctx, 74, -40, 9, 30, 5);
  ctx.fill();
  ctx.fillStyle = '#f5db8a';
  roundRect(ctx, 69, -42, 19, 8, 4);
  ctx.fill();

  if (sinkTime > 0) {
    const pulse = 0.65 + Math.sin(clock * 12) * 0.2;
    ctx.strokeStyle = `rgba(91,197,233,${pulse})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    // The water must fall from the visible oval nozzle at x=54, not from the
    // support anchored to the counter at x=-38.
    ctx.moveTo(54, -12);
    ctx.lineTo(54, 1);
    ctx.stroke();
    // Keep the little splashes inside the basin instead of letting them float
    // over the rim and cabinet face.
    ctx.save();
    roundRect(ctx, -96, -21, 192, 23, 8);
    ctx.clip();
    for (let index = 0; index < 4; index++) {
      ctx.fillStyle = `rgba(174,232,247,${0.45 + index * 0.1})`;
      ctx.beginPath();
      ctx.arc(
        -69 + index * 38,
        -8 + Math.sin(clock * 8 + index) * 2.5,
        4 + index * 0.8,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawFridge(ctx, furniture, clock, wobbleTime) {
  drawShadow(ctx, furniture.w * 0.86, 46, furniture.h * 0.46);
  const body = ctx.createLinearGradient(-furniture.w / 2, 0, furniture.w / 2, 0);
  body.addColorStop(0, '#e8f0eb');
  body.addColorStop(0.5, '#fffdf4');
  body.addColorStop(1, '#d9e7df');
  ctx.fillStyle = body;
  roundRect(ctx, -furniture.w / 2, -furniture.h / 2, furniture.w, furniture.h, 32);
  ctx.fill();
  ctx.strokeStyle = '#86b69f';
  ctx.lineWidth = 8;
  roundRect(ctx, -furniture.w / 2 + 4, -furniture.h / 2 + 4, furniture.w - 8, furniture.h - 8, 28);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(91,120,104,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -furniture.h / 2 + 10);
  ctx.lineTo(0, furniture.h / 2 - 12);
  ctx.stroke();

  ctx.strokeStyle = '#d2b35f';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-28, -64);
  ctx.lineTo(-28, 46);
  ctx.moveTo(28, -64);
  ctx.lineTo(28, 46);
  ctx.stroke();

  // Magnets make the large appliance feel playful and readable.
  const jiggle = wobbleTime > 0 ? Math.sin(clock * 30) * 3 * wobbleTime : 0;
  ctx.save();
  ctx.translate(jiggle, 0);
  for (const [x, y, color] of [[-73, -110, '#e86c76'], [73, -68, '#f4c84c'], [-68, 86, '#71b9c5']]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x - 4, y - 5, 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawIsland(ctx, furniture) {
  drawShadow(ctx, furniture.w * 0.9, 65, furniture.h * 0.42);
  ctx.fillStyle = '#70a98f';
  roundRect(ctx, -furniture.w * 0.39, -furniture.h * 0.08, furniture.w * 0.78, furniture.h * 0.42, 24);
  ctx.fill();
  ctx.fillStyle = '#8bc0a7';
  for (const x of [-120, 0, 120]) {
    roundRect(ctx, x - 48, -12, 96, 112, 15);
    ctx.fill();
    ctx.fillStyle = '#f4d16b';
    ctx.beginPath();
    ctx.arc(x + 31, 44, 5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#8bc0a7';
  }

  const top = ctx.createLinearGradient(0, -furniture.h / 2, 0, -furniture.h * 0.18);
  top.addColorStop(0, '#e0aa70');
  top.addColorStop(1, '#bd7d45');
  ctx.fillStyle = top;
  roundRect(ctx, -furniture.w / 2, -furniture.h / 2, furniture.w, furniture.h * 0.34, 32);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(ctx, -furniture.w / 2 + 18, -furniture.h / 2 + 13, furniture.w - 36, 18, 9);
  ctx.fill();

  // Bowl and cereal box are obvious future dirt-producing tap targets.
  ctx.fillStyle = '#f7efe2';
  ctx.beginPath();
  ctx.ellipse(-80, -furniture.h * 0.33, 55, 22, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f0bf4d';
  ctx.beginPath();
  ctx.ellipse(-80, -furniture.h * 0.34, 38, 12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#e86c76';
  roundRect(ctx, 50, -furniture.h * 0.48, 72, 112, 10);
  ctx.fill();
  ctx.fillStyle = '#fff2c9';
  roundRect(ctx, 61, -furniture.h * 0.39, 50, 45, 8);
  ctx.fill();
  ctx.fillStyle = '#f0bf4d';
  ctx.beginPath();
  ctx.arc(86, -furniture.h * 0.325, 15, 0, TAU);
  ctx.fill();
}

function drawTrash(ctx, furniture, clock, wobbleTime) {
  drawShadow(ctx, furniture.w * 0.82, 42, furniture.h * 0.38);
  const body = ctx.createLinearGradient(-furniture.w / 2, 0, furniture.w / 2, 0);
  body.addColorStop(0, '#7eb2b8');
  body.addColorStop(0.5, '#a9d2d2');
  body.addColorStop(1, '#689da5');
  ctx.fillStyle = body;
  roundRect(ctx, -furniture.w * 0.38, -furniture.h * 0.28, furniture.w * 0.76, furniture.h * 0.62, 30);
  ctx.fill();
  ctx.fillStyle = '#5d8f97';
  roundRect(ctx, -furniture.w * 0.43, -furniture.h * 0.36, furniture.w * 0.86, 35, 16);
  ctx.fill();
  ctx.fillStyle = '#d9b65e';
  roundRect(ctx, -31, furniture.h * 0.24, 62, 13, 7);
  ctx.fill();

  if (wobbleTime > 0) {
    const alpha = Math.min(1, wobbleTime * 2);
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.72})`;
    ctx.lineWidth = 6;
    for (let index = 0; index < 2; index++) {
      const radius = 44 + index * 22 + Math.sin(clock * 12) * 4;
      ctx.beginPath();
      ctx.arc(0, -furniture.h * 0.29, radius, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  }
}

export default KitchenRoom;
