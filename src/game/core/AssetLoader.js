// Loads sprite images. Every sprite is optional: entities fall back to
// procedural canvas drawing until the generated art lands in public/assets.
const MANIFEST = {
  room: 'room.png',
  rug: 'rug.png',
  window: 'window.png',
  tv: 'tv.png',
  robot: 'robot.png',
  dock: 'dock.png',
  couch: 'couch.png',
  table: 'table.png',
  plant: 'plant.png',
  toybox: 'toybox.png',
  catbed: 'catbed.png',
  basket: 'basket.png',
  sparkle: 'sparkle.png',
  cat_sit: 'cat_sit.png',
  cat_walk: 'cat_walk.png',
  cat_sleep: 'cat_sleep.png',
  dustbunny: 'dustbunny.png',
  crumbs: 'crumbs.png',
  cereal: 'cereal.png',
  leaf: 'leaf.png',
  sock: 'sock.png',
  toy_ball: 'toy_ball.png',
  toy_block: 'toy_block.png',
  disco_ball: 'disco_ball.png',
};

export class AssetLoader {
  constructor() {
    this.images = {};
  }

  async loadAll(onProgress) {
    const names = Object.keys(MANIFEST);
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        this.images[name] = await loadImage(`/assets/sprites/${MANIFEST[name]}`);
        done++;
        onProgress?.(done / names.length);
      })
    );
    return this.images;
  }

  get(name) {
    return this.images[name] || null;
  }

  // Tinted copy of a sprite (multiply keeps shading, alpha restored after).
  // Cached per name+tint. Returns null if the sprite is missing.
  getTinted(name, tint) {
    const img = this.get(name);
    if (!img) return null;
    if (!tint) return img;
    this._tinted = this._tinted || {};
    const key = `${name}|${tint}`;
    if (this._tinted[key]) return this._tinted[key];
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = tint;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(img, 0, 0);
    this._tinted[key] = c;
    return c;
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // missing art is fine — procedural fallback
    img.src = src;
  });
}
