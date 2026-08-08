import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from 'vite';

const DEFAULT_SOCKS = ['#ff8fa3', '#8fd7ff'];

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

async function withBrowserGlobals({ storedSocks = null, fetchImpl }, run) {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const values = new Map();
  if (storedSocks !== null) values.set('robo_socks', storedSocks);

  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchImpl ?? (() => Promise.reject(new Error('unexpected fetch'))),
  });

  try {
    return await run({ storage });
  } finally {
    restoreGlobal('fetch', fetchDescriptor);
    restoreGlobal('localStorage', localStorageDescriptor);
  }
}

function makeSockGame(Game, basketSocks) {
  return {
    basketSocks: [...basketSocks],
    _sockRevision: 0,
    _sockSaveChain: Promise.resolve(),
    dragSock: null,
    pendingSockDrag: false,
    saveSocks: Game.prototype.saveSocks,
  };
}

test('sock persistence recovers empty saved state without losing newer changes', async (t) => {
  // Vite supplies import.meta.env.BASE_URL, which the browser methods use when
  // publishing to the optional development-server sock stash.
  const vite = await createServer({
    root: process.cwd(),
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  t.after(async () => vite.close());
  const { Game } = await vite.ssrLoadModule('/src/game/Game.js');

  await t.test('stored empty basket restores the default pair', async () => {
    await withBrowserGlobals({ storedSocks: '[]' }, async () => {
      const socks = Game.prototype.loadSocks.call({});

      assert.deepEqual(socks, DEFAULT_SOCKS);
      assert.notEqual(socks, DEFAULT_SOCKS, 'the game should return its own mutable copy');
    });
  });

  await t.test('initial empty server state is repaired and republished', async () => {
    const requests = [];
    await withBrowserGlobals({
      storedSocks: '[]',
      fetchImpl: async (url, options = {}) => {
        requests.push({ url, options });
        if (options.method === 'POST') return { ok: true };
        return { ok: true, json: async () => [] };
      },
    }, async ({ storage }) => {
      const game = makeSockGame(Game, Game.prototype.loadSocks.call({}));

      await Game.prototype.syncSocks.call(game, true);
      await game._sockSaveChain;

      assert.deepEqual(game.basketSocks, DEFAULT_SOCKS);
      assert.equal(storage.getItem('robo_socks'), JSON.stringify(DEFAULT_SOCKS));
      const posts = requests.filter(({ options }) => options.method === 'POST');
      assert.equal(posts.length, 1);
      assert.equal(posts[0].options.body, JSON.stringify(DEFAULT_SOCKS));
    });
  });

  await t.test('valid nonempty server state wins during initial sync', async () => {
    const sharedSocks = ['#b8f2a4', '#ffe08a'];
    const requests = [];
    await withBrowserGlobals({
      storedSocks: '[]',
      fetchImpl: async (url, options = {}) => {
        requests.push({ url, options });
        return { ok: true, json: async () => sharedSocks };
      },
    }, async ({ storage }) => {
      const game = makeSockGame(Game, Game.prototype.loadSocks.call({}));

      await Game.prototype.syncSocks.call(game, true);

      assert.deepEqual(game.basketSocks, sharedSocks);
      assert.equal(storage.getItem('robo_socks'), JSON.stringify(sharedSocks));
      assert.equal(requests.length, 1, 'adopting shared state should not publish it again');
    });
  });

  await t.test('stale deferred sync cannot overwrite a newer local mutation', async () => {
    let resolveGet;
    const deferredGet = new Promise((resolve) => {
      resolveGet = resolve;
    });
    const requests = [];
    await withBrowserGlobals({
      storedSocks: JSON.stringify(DEFAULT_SOCKS),
      fetchImpl: (url, options = {}) => {
        requests.push({ url, options });
        if (options.method === 'POST') return Promise.resolve({ ok: true });
        return deferredGet;
      },
    }, async ({ storage }) => {
      const game = makeSockGame(Game, DEFAULT_SOCKS);
      const sync = Game.prototype.syncSocks.call(game, false);

      Game.prototype.addBasketSock.call(game, '#b8f2a4');
      resolveGet({ ok: true, json: async () => [] });

      await sync;
      await game._sockSaveChain;

      const expected = [...DEFAULT_SOCKS, '#b8f2a4'];
      assert.deepEqual(game.basketSocks, expected);
      assert.equal(storage.getItem('robo_socks'), JSON.stringify(expected));
      assert.equal(game._sockRevision, 1);
      assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
    });
  });

  await t.test('sync waits for an already queued save before reading shared state', async () => {
    const addedSock = '#b8f2a4';
    let serverSocks = [...DEFAULT_SOCKS];
    let acknowledgePost;
    let signalPostStarted;
    const postStarted = new Promise((resolve) => {
      signalPostStarted = resolve;
    });
    const requests = [];

    await withBrowserGlobals({
      storedSocks: JSON.stringify(DEFAULT_SOCKS),
      fetchImpl: (url, options = {}) => {
        requests.push({ url, options });
        if (options.method === 'POST') {
          signalPostStarted();
          return new Promise((resolve) => {
            acknowledgePost = () => {
              serverSocks = JSON.parse(options.body);
              resolve({ ok: true });
            };
          });
        }

        // Capture the stash at request time, just as a real GET response does.
        const responseSocks = [...serverSocks];
        return Promise.resolve({ ok: true, json: async () => responseSocks });
      },
    }, async ({ storage }) => {
      const game = makeSockGame(Game, DEFAULT_SOCKS);
      Game.prototype.addBasketSock.call(game, addedSock);
      await postStarted;

      const sync = Game.prototype.syncSocks.call(game, false);
      await Promise.resolve();

      const expected = [...DEFAULT_SOCKS, addedSock];
      assert.deepEqual(game.basketSocks, expected);
      assert.equal(
        requests.filter(({ options }) => options.method !== 'POST').length,
        0,
        'the shared stash should not be read until the pending save is acknowledged',
      );

      acknowledgePost();
      await sync;
      await game._sockSaveChain;

      assert.deepEqual(game.basketSocks, expected);
      assert.equal(storage.getItem('robo_socks'), JSON.stringify(expected));
      assert.deepEqual(serverSocks, expected);
      assert.deepEqual(
        requests.map(({ options }) => options.method ?? 'GET'),
        ['POST', 'GET'],
      );
    });
  });
});
