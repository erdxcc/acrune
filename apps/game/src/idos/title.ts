/**
 * Which iDos title this build runs as:
 * - `{titleid}.idos.games` → TITLEID, `{titleid}-dev.idos.games` → TITLEID-DEV;
 * - otherwise `?title=` in the URL, then VITE_IDOS_TITLE_ID (local development).
 * Null means no title: the game runs offline with local saves.
 */
export function detectTitleId(location: Pick<Location, 'hostname' | 'search'> = window.location): string | null {
  const host = /^([a-z0-9]+?)(-dev)?\.idos\.games$/i.exec(location.hostname);
  if (host) return `${host[1]!.toUpperCase()}${host[2] ? '-DEV' : ''}`;
  const fromQuery = new URLSearchParams(location.search).get('title');
  if (fromQuery) return fromQuery;
  return import.meta.env.VITE_IDOS_TITLE_ID || null;
}

/** Inside an iframe (idosgames.com embeds the game): the wallet signs only through the site. */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
