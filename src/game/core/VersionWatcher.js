import { BUILD_VERSION, publicAssetUrl } from './assetUrl.js';

const RELOAD_PARAM = 'rgv';

export function startVersionWatcher() {
  if (!BUILD_VERSION) return;

  let checking = false;
  let reloading = false;

  const check = async () => {
    if (checking || reloading || document.hidden) return;
    checking = true;
    try {
      const res = await fetch(`${publicAssetUrl('version.json', { versioned: false })}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const info = await res.json();
      const nextVersion = typeof info.version === 'string' ? info.version : '';
      if (!nextVersion || nextVersion === BUILD_VERSION) return;

      reloading = true;
      const url = new URL(window.location.href);
      url.searchParams.set(RELOAD_PARAM, nextVersion.slice(0, 12));
      window.location.replace(url.toString());
    } catch (e) {
      // Static hosting can lag briefly while a Pages build is rolling out.
    } finally {
      checking = false;
    }
  };

  setTimeout(check, 30000);
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
}
