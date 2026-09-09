/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHARE_API?: string;
  /** If set (e.g. 5), new server share links allow “Make my own copy” only until this many days after upload. Omit or 0 = no limit. */
  readonly VITE_SHARE_EDIT_DAYS?: string;
  /**
   * Set to "true" only on your private seller/studio build. Customer-facing production builds
   * must omit this so they cannot create new share links from the UI.
   */
  readonly VITE_ENABLE_PUBLISH_LINK?: string;
  /**
   * Must match server env SHARE_CREATE_SECRET when the server requires it. Only in seller builds;
   * never ship this in the bundle you give to buyers.
   */
  readonly VITE_SHARE_CREATE_SECRET?: string;
  /** Optional GIPHY API key for GIF search in editor. */
  readonly VITE_GIPHY_API_KEY?: string;
  /** Optional Pixabay API key for graphic/vector search. */
  readonly VITE_PIXABAY_API_KEY?: string;
  /**
   * Set to "true" to show the studio password lock screen at all. Not secret —
   * the actual password is server-only (STUDIO_PASSWORD on share-server.mjs) and
   * checked via POST /api/studio/unlock, never compared client-side.
   */
  readonly VITE_STUDIO_LOCK_ENABLED?: string;
  /** Optional fixed server id for main studio website data. */
  readonly VITE_STUDIO_ROOT_SHARE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
