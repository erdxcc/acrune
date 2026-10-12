/** Subdomains of idos.games that belong to the platform, not to a title. */
const PLATFORM_HOSTS = new Set(['static', 'www', 'api', 'site', 'cdn']);

/**
 * Which iDos title this build runs as:
 * - an uploaded build on static.idos.games/drive/app/{TITLEID}/v/{build}/ → TITLEID;
 * - `{titleid}.idos.games` → TITLEID, `{titleid}-dev.idos.games` → TITLEID-DEV;
 * - otherwise `?title=` in the URL, then VITE_IDOS_TITLE_ID (set at build time).
 * Null means no title: the game runs offline with local saves.
 */
export function detectTitleId(location: Pick<Location, 'hostname' | 'pathname' | 'search'> = window.location): string | null {
  const onPlatform = /(^|\.)idos\.games$/i.test(location.hostname);
  const path = /\/app\/([a-z0-9]+(?:-dev)?)\//i.exec(location.pathname);
  if (onPlatform && path) return path[1]!.toUpperCase();
  const host = /^([a-z0-9]+?)(-dev)?\.idos\.games$/i.exec(location.hostname);
  if (host && !PLATFORM_HOSTS.has(host[1]!.toLowerCase())) return `${host[1]!.toUpperCase()}${host[2] ? '-DEV' : ''}`;
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
