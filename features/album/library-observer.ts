/**
 * The one thing that needs a bare native module.
 *
 * `expo-media-library` can read a library but cannot tell you when it
 * changes, and this design has to be automatic: a couple keeps taking
 * photos, and the album cannot depend on anyone opening a picker again.
 *
 * PhotoKit has exactly the right primitive and Expo does not wrap it:
 *
 *   register(_ observer: PHPhotoLibraryChangeObserver)
 *   photoLibraryDidChange(_ changeInstance: PHChange)
 *   var currentChangeToken: PHPersistentChangeToken
 *   func fetchPersistentChanges(since: PHPersistentChangeToken)
 *
 * The persistent token is the part that makes this work. A live observer
 * only fires while the app is running, so without the token anything taken
 * while the app was closed would be missed forever. The token survives: you
 * persist it, and on next launch you ask what changed since. Nothing is
 * polled and nothing is missed.
 *
 * Written and ready. It does not run until there is a dev build, and the
 * screen that wants it says so.
 *
 * The module exposes three methods and no more:
 *
 *   startObserving()                  register the observer
 *   currentChangeToken(): Promise<string | null>
 *   changesSince(token): Promise<{ token: string | null; changed: boolean; insertedIds: string[]; removedIds: string[] }>
 *
 * Only identifiers cross the bridge. No image data, no thumbnails, no
 * metadata — this stays a notification channel and the work happens in JS
 * where the keys are.
 */

/** What the observer reports. No pixels, no metadata, by design. */
export type LibraryChange = {
  /**
   * The new token. Persist it the moment you see a change, even if you do
   * nothing with it, or the same change is reported forever.
   */
  token: string | null;
  /** False when the library has not moved since the token you passed. */
  changed: boolean;
  /** Local identifiers of assets that appeared since the token. */
  insertedIds: string[];
  removedIds: string[];
};

export type LibraryObserver = {
  /** Begin watching. Idempotent. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Read the token to persist before doing anything else. */
  currentToken: () => Promise<string | null>;
  /**
   * What changed since the token. Returns `changed: false` and the same
   * token when nothing has, so calling it on every foreground is cheap and
   * idempotent.
   */
  changesSince: (token: string | null) => Promise<LibraryChange>;
  /** Fired when the library moves while the app is open. */
  subscribe: (listener: (change: LibraryChange) => void) => () => void;
};

/**
 * The token lives with the space, not the device. It is not a secret — it is
 * a cursor — and losing it means re-reading the library once, which the
 * album can absorb because it is all local to this device anyway.
 */
export const CHANGE_TOKEN_KEY = 'aoi.album.change-token.v1.';
