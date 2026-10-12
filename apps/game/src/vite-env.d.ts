/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** iDos title for local development; on iDos hosting the title comes from the host name. */
  readonly VITE_IDOS_TITLE_ID?: string;
  /** Grimoire relayer, e.g. https://grimoire-relayer.vercel.app. */
  readonly VITE_RELAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
