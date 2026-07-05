import { Game } from './game/Game.js';
import { AssetLoader } from './game/core/AssetLoader.js';
import { startVersionWatcher } from './game/core/VersionWatcher.js';

async function boot() {
  const canvas = document.getElementById('game');
  const assets = new AssetLoader();
  await assets.loadAll();

  const game = new Game(canvas, assets);
  window.__game = game; // handy for debugging
  startVersionWatcher();

  window.addEventListener('resize', () => game.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 100));

  // pointer input
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    game.onPointerDown(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    e.preventDefault();
    game.onPointerMove(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    game.onPointerUp(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointercancel', () => {
    game.pointerDown = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // save battery: pause audio when the tab is hidden
  document.addEventListener('visibilitychange', () => {
    const ctx = game.sound.ctx;
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  // fade out the loading screen
  const loading = document.getElementById('loading');
  loading.classList.add('hidden');
  setTimeout(() => loading.remove(), 700);
}

boot();
