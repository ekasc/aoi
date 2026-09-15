import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { isAllowedMediaMimeType, MOMENT_ATTACHMENT_MAX } from '@aoi/shared';

import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { useMoments } from '@/features/moments/moments-context';
import { newDraftClientId } from '@/features/moments/draft-identity';
import { uploadMediaAsset } from '@/features/media/media-upload-service';
import type { CreateMomentInput } from '@/features/moments/types';
import type {
  ComposerDraft,
  ComposerScope,
  PendingRecord,
  PickerAssetDescriptor,
  StagedAsset,
  UploadFn,
} from '@/features/composer/types';
import {
  buildPendingFromDraft,
  canAutoRetry,
  classifySendError,
  isDraftEmpty,
  moveAssetIndex,
  newEmptyDraft,
  recoverSendingToQueued,
  userSafeMessage,
} from '@/features/composer/composer-machine';
import { COMPOSER_BODY_MAX, scopeEquals, scopeKey } from '@/features/composer/validate';
import {
  ComposerStore,
  extForMime,
  stagedDirFor,
  stagedPathFor,
} from '@/features/composer/composer-store';
import { createDefaultComposerStore as createStore } from '@/features/composer/secure-draft-store';
import { sendPendingRecord, type CreateFn, type SlotCheckpoint } from '@/features/composer/send-pipeline';

export type ComposerDeps = {
  upload?: UploadFn;
  create?: CreateFn;
  store?: ComposerStore;
  now?: () => string;
};

export type ComposerValue = {
  draft: ComposerDraft | null;
  hydrating: boolean;
  pending: PendingRecord[];
  sendingIds: string[];
  error: string | null;
  updateBody: (body: string) => Promise<void>;
  setOccurredAt: (iso: string) => Promise<void>;
  addAssets: (descriptors: PickerAssetDescriptor[]) => Promise<void>;
  removeAsset: (stagedId: string) => Promise<void>;
  reorderAsset: (fromIndex: number, toIndex: number) => Promise<void>;
  save: () => Promise<{ clientId: string }>;
  discardDraft: () => Promise<void>;
  retry: (clientId: string) => Promise<void>;
  editPending: (clientId: string) => Promise<void>;
  discardPending: (clientId: string) => Promise<void>;
  acknowledgeDelivered: (clientId: string) => Promise<void>;
  resetCorrupt: () => Promise<void>;
};

const ComposerContext = createContext<ComposerValue | undefined>(undefined);

type InternalState = {
  draft: ComposerDraft | null;
  pending: PendingRecord[];
  hydrating: boolean;
  error: string | null;
  sendingIds: string[];
  scopeKey: string | null;
};

function codedError(code: string): Error & { code?: string } {
  const err = new Error(code) as Error & { code?: string };
  err.code = code;
  return err;
}

// Stable empty arrays for the stale-scope visible derivation (no per-render alloc).
const EMPTY_PENDING: PendingRecord[] = [];
const EMPTY_SENDING_IDS: string[] = [];

export function ComposerProvider({
  children,
  deps,
}: PropsWithChildren<{ deps?: ComposerDeps }>) {
  const { user } = useSession();
  const { space } = useSpace();
  const { addMoment } = useMoments();

  const userId = user?.id ?? null;
  const spaceId = space?.id ?? null;
  const scope = useMemo<ComposerScope | null>(
    () => (userId && spaceId ? { viewerId: userId, spaceId: spaceId } : null),
    [userId, spaceId]
  );
  const currentScopeKey = scope ? scopeKey(scope) : null;

  // Stable store: lazy once, never re-created per render.
  const [store] = useState<ComposerStore>(() => deps?.store ?? createStore());
  const nowFn = useMemo(() => deps?.now ?? (() => new Date().toISOString()), [deps?.now]);

  const [state, setState] = useState<InternalState>(() => ({
    draft: null,
    pending: [],
    hydrating: Boolean(user?.id && space?.id),
    error: null,
    sendingIds: [],
    scopeKey: user?.id && space?.id ? scopeKey({ viewerId: user.id, spaceId: space.id }) : null,
  }));

  // Latest-value mirrors: written only in layout effects / event callbacks,
  // never read or written during render.
  const uploadRef = useRef<UploadFn>(
    deps?.upload ?? ((input, onProgress, assertScope) => uploadMediaAsset(input, onProgress, assertScope))
  );
  const createRef = useRef<CreateFn>(deps?.create ?? ((input: CreateMomentInput) => addMoment(input)));
  const stateRef = useRef(state);
  const scopeRef = useRef(scope);
  useLayoutEffect(() => {
    uploadRef.current =
      deps?.upload ?? ((input, onProgress, assertScope) => uploadMediaAsset(input, onProgress, assertScope));
  }, [deps?.upload]);
  useLayoutEffect(() => {
    createRef.current = deps?.create ?? ((input: CreateMomentInput) => addMoment(input));
  }, [deps?.create, addMoment]);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  useLayoutEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  const sendChainRef = useRef(Promise.resolve());
  const mutationRef = useRef(Promise.resolve());

  const enqueueMutation = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationRef.current.then(fn, fn);
    mutationRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const setPartial = useCallback((patch: Partial<InternalState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const persist = useCallback(
    async (target: ComposerScope, draft: ComposerDraft | null, pending: PendingRecord[]) => {
      await store.saveManifest(target, draft, pending);
    },
    [store]
  );

  // Hydrate on scope change. Stale scope data is hidden immediately via the
  // scope-tagged visible derivation below (no ref read during render); disk
  // drafts are kept (never auto-deleted). Cancellation alone guards async
  // races — no scopeRef comparison needed.
  useEffect(() => {
    let cancelled = false;
    if (!scope) {
      setPartial({ draft: null, pending: [], hydrating: false, error: null, sendingIds: [], scopeKey: null });
      return;
    }
    const active: ComposerScope = { ...scope };
    const activeKey = scopeKey(active);
    (async () => {
      try {
        const loaded = await store.loadManifest(active);
        if (cancelled) return;
        const pending = recoverSendingToQueued(loaded?.pending ?? []);
        let draft = loaded?.draft ?? null;
        if (!draft) {
          draft = newEmptyDraft(newDraftClientId(), nowFn());
          try {
            await store.saveManifest(active, draft, pending);
          } catch {
            // Fresh-draft persist failure surfaces below on next write.
          }
        }
        if (cancelled) return;
        setPartial({ draft, pending, hydrating: false, error: null, scopeKey: activeKey });
        // Persist the sending->queued recovery when it changed anything.
        if ((loaded?.pending ?? []).some((p) => p.status === 'sending')) {
          try {
            await store.saveManifest(active, draft, pending);
          } catch {
            // Best-effort; next explicit write retries.
          }
        }
      } catch (err) {
        if (cancelled) return;
        const { message } = classifySendError(err);
        setPartial({ draft: null, pending: [], hydrating: false, error: message, scopeKey: activeKey });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, store, nowFn, setPartial]);

  const runSend = useCallback(
    (clientId: string) => {
      const task = sendChainRef.current.then(async () => {
        const currentScope = scopeRef.current;
        const snapshot = stateRef.current.pending.find((p) => p.clientId === clientId);
        // Fall back to disk when in-memory was cleared by a scope switch:
        // the send still belongs to its captured scope, never the new one.
        const record: PendingRecord | undefined = snapshot;
        if (!record) return;
        if (!scopeEquals(record.scope, currentScope)) {
          // Stale scope: leave the disk copy queued, touch nothing in memory.
          return;
        }
        if (!currentScope) return;
        setPartial({ sendingIds: [...stateRef.current.sendingIds, clientId] });
        const sending: PendingRecord = { ...record, status: 'sending', attempts: record.attempts + 1, updatedAt: nowFn(), errorCode: null, errorMessage: null };
        const nextPending = stateRef.current.pending.map((p) => (p.clientId === clientId ? sending : p));
        try {
          await persist(currentScope, stateRef.current.draft, nextPending);
        } catch (err) {
          const { message } = classifySendError(err);
          setPartial({
            pending: stateRef.current.pending.map((p) =>
              p.clientId === clientId ? { ...p, status: 'failed' as const, errorMessage: message } : p
            ),
            sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId),
            error: message,
          });
          return;
        }
        setPartial({ pending: nextPending });
        let latestSlots = sending.slots.map((s) => ({ ...s }));

        const onSlotUploaded = async (checkpoint: SlotCheckpoint) => {
          // Checkpoint reuse: persist each successful upload immediately so
          // a mid-upload crash/retry never re-uploads it. Memory is touched
          // only while the scope still matches; disk always patches the
          // RECORD's scope file so a mid-upload scope switch loses nothing.
          latestSlots = latestSlots.map((s) =>
            s.stagedId === checkpoint.stagedId ? { ...s, uploaded: checkpoint.uploaded } : s
          );
          if (scopeEquals(record.scope, scopeRef.current)) {
            const updated = stateRef.current.pending.map((p) =>
              p.clientId === clientId
                ? {
                    ...p,
                    slots: p.slots.map((s) =>
                      s.stagedId === checkpoint.stagedId ? { ...s, uploaded: checkpoint.uploaded } : s
                    ),
                    updatedAt: nowFn(),
                  }
                : p
            );
            setPartial({ pending: updated });
            const target = scopeRef.current;
            if (target) {
              try {
                await persist(target, stateRef.current.draft, updated);
              } catch {
                // Checkpoint persist failure: the upload still succeeded
                // server-side; retry will replay create idempotently.
              }
            }
            return;
          }
          try {
            const disk = await store.loadManifest(record.scope);
            if (!disk) return;
            const patched = (disk.pending ?? []).map((item) =>
              item.clientId === clientId
                ? {
                    ...item,
                    slots: item.slots.map((slot) =>
                      slot.stagedId === checkpoint.stagedId ? { ...slot, uploaded: checkpoint.uploaded } : slot
                    ),
                    updatedAt: nowFn(),
                  }
                : item
            );
            await store.saveManifest(record.scope, disk.draft ?? null, patched);
          } catch {
            // Best-effort; the retry still reuses the in-memory checkpoint
            // via latestSlots below if the scope returns.
          }
        };

        try {
          const moment = await sendPendingRecord(
            sending,
            {
              upload: uploadRef.current,
              create: createRef.current,
              getCurrentScope: () => scopeRef.current,
            },
            onSlotUploaded
          );
          // Delivered ONLY after the API returned. Retain as
          // `status: 'delivered'` with the server moment until the timeline
          // window renders the id and the screen acknowledges it — never
          // remove immediately (the fetch lands after the create). Staged
          // files are cleaned on acknowledge, not here, so the preview
          // survives. No bus, no navigation/scroll from the provider.
          const delivered: PendingRecord = {
            ...sending,
            status: 'delivered',
            deliveredMoment: moment,
            errorCode: null,
            errorMessage: null,
            updatedAt: nowFn(),
            slots: latestSlots.map((s) => ({ ...s })),
          };
          const stillCurrent = scopeEquals(record.scope, scopeRef.current) && scopeRef.current;
          if (stillCurrent) {
            const updated = stateRef.current.pending.map((item) =>
              item.clientId === clientId ? delivered : item
            );
            try {
              await persist(stillCurrent, stateRef.current.draft, updated);
            } catch {
              // Best-effort; the moment is already delivered.
            }
            setPartial({
              pending: updated,
              sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId),
              error: null,
            });
          } else {
            // Scope drifted mid-send: persist delivered on the RECORD's
            // scope file without touching new-scope memory or credentials.
            try {
              const disk = await store.loadManifest(record.scope);
              const base = recoverSendingToQueued(disk?.pending ?? []);
              const found = base.some((item) => item.clientId === clientId);
              const updated = found
                ? base.map((item) => (item.clientId === clientId ? delivered : item))
                : [...base, delivered];
              await store.saveManifest(record.scope, disk?.draft ?? null, updated);
            } catch {
              // Best-effort.
            }
            setPartial({ sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId) });
          }
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          if (code === 'SCOPE_CHANGED') {
            // Abort on scope change: re-queue on the RECORD's scope file
            // without touching new-scope memory or new credentials.
            try {
              const disk = await store.loadManifest(record.scope);
              const base = recoverSendingToQueued(disk?.pending ?? []);
              const found = base.some((p) => p.clientId === clientId);
              const requeued = found
                ? base.map((p) => (p.clientId === clientId ? { ...p, status: 'queued' as const } : p))
                : [...base, { ...sending, status: 'queued' as const }];
              await store.saveManifest(record.scope, disk?.draft ?? null, requeued);
            } catch {
              // Best-effort.
            }
            if (scopeEquals(record.scope, scopeRef.current)) {
              setPartial({
                pending: stateRef.current.pending.map((p) =>
                  p.clientId === clientId ? { ...p, status: 'queued' as const } : p
                ),
                sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId),
              });
            } else {
              setPartial({ sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId) });
            }
            return;
          }
          const { code: errCode, message } = classifySendError(err);
          // Quota + generic failures retain the draft/attachments and need
          // explicit retry (no auto loops / quota reattempts).
          const failed: PendingRecord = {
            ...sending,
            status: 'failed',
            errorCode: errCode,
            errorMessage: message,
            updatedAt: nowFn(),
            slots: latestSlots.map((s) => ({ ...s })),
          };
          if (scopeEquals(record.scope, scopeRef.current) && scopeRef.current) {
            const target = scopeRef.current;
            const updated = stateRef.current.pending.map((p) => (p.clientId === clientId ? failed : p));
            try {
              await persist(target, stateRef.current.draft, updated);
            } catch {
              // Best-effort; in-memory still reflects the failure.
            }
            setPartial({
              pending: updated,
              sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId),
              error: message,
            });
          } else {
            try {
              const disk = await store.loadManifest(record.scope);
              const updated = (disk?.pending ?? []).map((p) => (p.clientId === clientId ? failed : p));
              await store.saveManifest(record.scope, disk?.draft ?? null, updated);
            } catch {
              // Best-effort.
            }
            setPartial({ sendingIds: stateRef.current.sendingIds.filter((id) => id !== clientId) });
          }
        }
      });
      sendChainRef.current = task.then(
        () => undefined,
        () => undefined
      );
      return task;
    },
    [nowFn, persist, setPartial, store]
  );

  // Foreground-only auto retry: queued (never failed) while the same
  // authenticated scope is current. No OS background delivery promise.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const current = scopeRef.current;
      if (!current) return;
      const queued = stateRef.current.pending.filter(
        (p) => p.status === 'queued' && canAutoRetry(p.status, nextState) && scopeEquals(p.scope, current)
      );
      for (const item of queued) {
        void runSend(item.clientId);
      }
    });
    return () => subscription.remove();
  }, [runSend]);

  const updateBody = useCallback(
    async (body: string) => {
      return enqueueMutation(async () => {
        const target = scopeRef.current;
        if (!target) throw codedError('NO_SCOPE');
        const draft = stateRef.current.draft;
        if (!draft) throw codedError('STORE_UNAVAILABLE');
        const next: ComposerDraft = { ...draft, body: body.slice(0, COMPOSER_BODY_MAX), updatedAt: nowFn() };
        setPartial({ draft: next, error: null });
        await persist(target, next, stateRef.current.pending);
      });
    },
    [enqueueMutation, nowFn, persist, setPartial]
  );

  const setOccurredAt = useCallback(
    async (iso: string) => {
      return enqueueMutation(async () => {
        const target = scopeRef.current;
        if (!target) throw codedError('NO_SCOPE');
        if (Number.isNaN(Date.parse(iso))) throw new Error('Invalid occurredAt');
        const draft = stateRef.current.draft;
        if (!draft) throw codedError('STORE_UNAVAILABLE');
        const next: ComposerDraft = { ...draft, occurredAt: iso, updatedAt: nowFn() };
        setPartial({ draft: next, error: null });
        await persist(target, next, stateRef.current.pending);
      });
    },
    [enqueueMutation, nowFn, persist, setPartial]
  );

  const addAssets = useCallback(
    async (descriptors: PickerAssetDescriptor[]) => {
      return enqueueMutation(async () => {
      const target = scopeRef.current;
      if (!target) throw codedError('NO_SCOPE');
      const draft = stateRef.current.draft;
      if (!draft) throw codedError('STORE_UNAVAILABLE');
      if (draft.assets.length + descriptors.length > MOMENT_ATTACHMENT_MAX) {
        throw codedError('TOO_MANY_ASSETS');
      }
      for (const d of descriptors) {
        if (!isAllowedMediaMimeType(d.mimeType)) {
          throw codedError('UNSUPPORTED_MEDIA');
        }
        if (typeof d.uri !== 'string' || d.uri.length === 0) {
          throw codedError('UNSUPPORTED_MEDIA');
        }
      }
      const staged: StagedAsset[] = [];
      try {
        for (const d of descriptors) {
          const kind = d.mimeType.startsWith('audio/') ? 'audio' : 'image';
          const stagedId = `staged_${randomUUID()}`;
          const to = stagedPathFor(target, stagedId, extForMime(d.mimeType));
          await store.fileStore.copy(d.uri, to);
          staged.push({
            stagedId,
            kind,
            mimeType: d.mimeType,
            localUri: to,
            ...(d.width !== undefined ? { width: d.width } : {}),
            ...(d.height !== undefined ? { height: d.height } : {}),
            ...(d.durationMs !== undefined ? { durationMs: d.durationMs } : {}),
            uploaded: null,
          });
        }
      } catch (err) {
        // Roll back this batch's copies (owned files only).
        const dir = stagedDirFor(target);
        const owned = staged.map((s) => s.localUri).filter((uri) => uri.startsWith(dir));
        try {
          await store.deletePaths(owned);
        } catch {
          // Best-effort.
        }
        throw err;
      }
      const next: ComposerDraft = { ...draft, assets: [...draft.assets, ...staged], updatedAt: nowFn() };
      setPartial({ draft: next, error: null });
      await persist(target, next, stateRef.current.pending);
      });
    },
    [enqueueMutation, nowFn, persist, setPartial, store]
  );

  const removeAsset = useCallback(
    async (stagedId: string) => {
      return enqueueMutation(async () => {
      const target = scopeRef.current;
      if (!target) throw codedError('NO_SCOPE');
      const draft = stateRef.current.draft;
      if (!draft) throw codedError('STORE_UNAVAILABLE');
      const found = draft.assets.find((a) => a.stagedId === stagedId);
      const next: ComposerDraft = {
        ...draft,
        assets: draft.assets.filter((a) => a.stagedId !== stagedId),
        updatedAt: nowFn(),
      };
      setPartial({ draft: next, error: null });
      if (found) {
        const dir = stagedDirFor(target);
        if (found.localUri.startsWith(dir)) {
          try {
            await store.deletePaths([found.localUri]);
          } catch {
            // Best-effort.
          }
        }
      }
      await persist(target, next, stateRef.current.pending);
      });
    },
    [enqueueMutation, nowFn, persist, setPartial, store]
  );

  const reorderAsset = useCallback(
    async (fromIndex: number, toIndex: number) => {
      return enqueueMutation(async () => {
        const target = scopeRef.current;
        if (!target) throw codedError('NO_SCOPE');
        const draft = stateRef.current.draft;
        if (!draft) throw codedError('STORE_UNAVAILABLE');
        const next: ComposerDraft = {
          ...draft,
          assets: moveAssetIndex(draft.assets, fromIndex, toIndex),
          updatedAt: nowFn(),
        };
        setPartial({ draft: next, error: null });
        await persist(target, next, stateRef.current.pending);
      });
    },
    [enqueueMutation, nowFn, persist, setPartial]
  );

  const save = useCallback(async () => {
    return enqueueMutation(async () => {
      const target = scopeRef.current;
      if (!target) throw codedError('NO_SCOPE');
      const draft = stateRef.current.draft;
      if (!draft) throw codedError('STORE_UNAVAILABLE');
      if (isDraftEmpty(draft)) throw codedError('EMPTY_DRAFT');
      const record = buildPendingFromDraft(draft, target, nowFn());
      const fresh = newEmptyDraft(newDraftClientId(), nowFn());
      const nextPending = [...stateRef.current.pending, record];
      // Persisted-before-pending: the manifest write completes before any
      // network starts, so a crash mid-upload still resumes from disk.
      await persist(target, fresh, nextPending);
      setPartial({ draft: fresh, pending: nextPending, error: null });
      void runSend(record.clientId);
      return { clientId: record.clientId };
    });
  }, [enqueueMutation, nowFn, persist, runSend, setPartial]);

  const discardDraft = useCallback(async () => {
    return enqueueMutation(async () => {
      const target = scopeRef.current;
      if (!target) throw codedError('NO_SCOPE');
      const draft = stateRef.current.draft;
      // Fail closed on corrupt/key-lost (draft null): leave bytes for
      // explicit resetCorrupt; never auto-overwrite with fresh empty.
      if (!draft) throw codedError('STORE_UNAVAILABLE');
      const dir = stagedDirFor(target);
      const owned = draft.assets.map((a) => a.localUri).filter((uri) => uri.startsWith(dir));
      const fresh = newEmptyDraft(newDraftClientId(), nowFn());
      if (owned.length > 0) {
        try {
          await store.deletePaths(owned);
        } catch {
          // Best-effort.
        }
      }
      try {
        await persist(target, fresh, stateRef.current.pending);
      } catch (err) {
        const { message } = classifySendError(err);
        setPartial({ error: message });
        throw err;
      }
      setPartial({ draft: fresh, error: null });
    });
  }, [enqueueMutation, nowFn, persist, setPartial, store]);

  const retry = useCallback(
    async (clientId: string) => {
      const found = stateRef.current.pending.find((p) => p.clientId === clientId);
      if (!found) throw codedError('CORRUPT');
      if (found.status === 'sending' || found.status === 'delivered') return;
      // Explicit retry reuses the same clientId (idempotent replay) and any
      // uploaded checkpoints — never re-uploads successful assets.
      await runSend(clientId);
    },
    [runSend]
  );

  const editPending = useCallback(
    async (clientId: string) => {
      return enqueueMutation(async () => {
        const target = scopeRef.current;
        if (!target) throw codedError('NO_SCOPE');
        const found = stateRef.current.pending.find((p) => p.clientId === clientId);
        if (!found) throw codedError('CORRUPT');
        if (found.status === 'sending' || found.status === 'delivered') throw codedError('CORRUPT');
        if (!scopeEquals(found.scope, target)) throw codedError('SCOPE_CHANGED');
        // Never silently replace a nonempty draft (data loss). Explicit
        // reject; the caller must finish or discard first. Typed DRAFT_EXISTS.
        const current = stateRef.current.draft;
        if (current && !isDraftEmpty(current)) {
          const err = new Error('Finish or discard your current draft first.') as Error & {
            code?: string;
          };
          err.code = 'DRAFT_EXISTS';
          throw err;
        }
        const next: ComposerDraft = {
          clientId: found.clientId,
          body: found.body,
          occurredAt: found.occurredAt,
          assets: found.slots.map((s) => ({
            stagedId: s.stagedId,
            kind: s.kind,
            mimeType: s.mimeType,
            localUri: s.localUri,
            uploaded: s.uploaded,
          })),
          updatedAt: nowFn(),
        };
        const remaining = stateRef.current.pending.filter((p) => p.clientId !== clientId);
        await persist(target, next, remaining);
        setPartial({ draft: next, pending: remaining, error: null });
      });
    },
    [enqueueMutation, nowFn, persist, setPartial]
  );

  const discardPending = useCallback(
    async (clientId: string) => {
      return enqueueMutation(async () => {
        const target = scopeRef.current;
        if (!target) throw codedError('NO_SCOPE');
        const found = stateRef.current.pending.find((p) => p.clientId === clientId);
        if (!found) throw codedError('CORRUPT');
        if (found.status === 'sending' || found.status === 'delivered') throw codedError('CORRUPT');
        if (!scopeEquals(found.scope, target)) throw codedError('SCOPE_CHANGED');
        // Explicit safe discard: cleans only this record's owned staged
        // files, preserves the unrelated mutable draft and other pendings.
        const dir = stagedDirFor(target);
        const owned = found.slots.map((s) => s.localUri).filter((uri) => uri.startsWith(dir));
        const remaining = stateRef.current.pending.filter((p) => p.clientId !== clientId);
        if (owned.length > 0) {
          try {
            await store.deletePaths(owned);
          } catch {
            // Best-effort.
          }
        }
        await persist(target, stateRef.current.draft, remaining);
        setPartial({ pending: remaining, error: null });
      });
    },
    [enqueueMutation, persist, setPartial, store]
  );

  const acknowledgeDelivered = useCallback(
    async (clientId: string) => {
      return enqueueMutation(async () => {
        const found = stateRef.current.pending.find((p) => p.clientId === clientId);
        if (!found) return;
        if (found.status !== 'delivered') return;
        const target = scopeRef.current;
        if (!scopeEquals(found.scope, target)) {
          // Stale scope: clean the RECORD's scope file without touching
          // new-scope memory or credentials.
          try {
            const disk = await store.loadManifest(found.scope);
            if (disk) {
              const remaining = (disk.pending ?? []).filter((p) => p.clientId !== clientId);
              await store.saveManifest(found.scope, disk.draft ?? null, remaining);
            }
          } catch {
            // Best-effort.
          }
          try {
            const dir = stagedDirFor(found.scope);
            const owned = found.slots.map((s) => s.localUri).filter((uri) => uri.startsWith(dir));
            if (owned.length > 0) {
              await store.deletePaths(owned);
            }
          } catch {
            // Best-effort cleanup.
          }
          return;
        }
        if (!target) throw codedError('NO_SCOPE');
        const remaining = stateRef.current.pending.filter((p) => p.clientId !== clientId);
        try {
          await persist(target, stateRef.current.draft, remaining);
        } catch {
          // Best-effort; in-memory still drops the acknowledged row.
        }
        setPartial({ pending: remaining });
        const dir = stagedDirFor(found.scope);
        const owned = found.slots.map((s) => s.localUri).filter((uri) => uri.startsWith(dir));
        if (owned.length > 0) {
          try {
            await store.deletePaths(owned);
          } catch {
            // Best-effort cleanup.
          }
        }
      });
    },
    [enqueueMutation, persist, setPartial, store]
  );

  const resetCorrupt = useCallback(async () => {
    return enqueueMutation(async () => {
      const target = scopeRef.current;
      if (!target) throw codedError('NO_SCOPE');
      // Explicit recovery only: delete the manifest without needing the key,
      // then write a fresh empty state. Never auto-called; all other writes
      // fail closed on corrupt/key-lost so bytes survive until this runs.
      try {
        await store.deleteScopeFiles(target, []);
      } catch {
        // Best-effort; the fresh write below still fails explicit on error.
      }
      const fresh = newEmptyDraft(newDraftClientId(), nowFn());
      try {
        await persist(target, fresh, []);
      } catch (err) {
        const { message } = classifySendError(err);
        setPartial({ error: message });
        throw err;
      }
      setPartial({ draft: fresh, pending: [], hydrating: false, error: null, sendingIds: [], scopeKey: scopeKey(target) });
    });
  }, [enqueueMutation, nowFn, persist, setPartial, store]);

  // Scope-tagged visible state: while the scope key lags the current scope,
  // hide stale draft/pending immediately during render (no ref read, no
  // effect wait). Hydrating shows while stale with a live scope. Empty
  // arrays are module-stable so the value memo never churns per render.
  const isStaleScope = state.scopeKey !== currentScopeKey;
  const visibleDraft = isStaleScope ? null : state.draft;
  const visiblePending = useMemo(
    () => (isStaleScope ? EMPTY_PENDING : state.pending),
    [isStaleScope, state.pending]
  );
  const visibleHydrating = isStaleScope ? Boolean(scope) : state.hydrating;
  const visibleSendingIds = useMemo(
    () => (isStaleScope ? EMPTY_SENDING_IDS : state.sendingIds),
    [isStaleScope, state.sendingIds]
  );
  const visibleError = isStaleScope ? null : state.error;

  const value = useMemo<ComposerValue>(
    () => ({
      draft: visibleDraft,
      hydrating: visibleHydrating,
      pending: visiblePending,
      sendingIds: visibleSendingIds,
      error: visibleError,
      updateBody,
      setOccurredAt,
      addAssets,
      removeAsset,
      reorderAsset,
      save,
      discardDraft,
      retry,
      editPending,
      discardPending,
      acknowledgeDelivered,
      resetCorrupt,
    }),
    [
      visibleDraft,
      visibleHydrating,
      visiblePending,
      visibleSendingIds,
      visibleError,
      updateBody,
      setOccurredAt,
      addAssets,
      removeAsset,
      reorderAsset,
      save,
      discardDraft,
      retry,
      editPending,
      discardPending,
      acknowledgeDelivered,
      resetCorrupt,
    ]
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

export function useComposer(): ComposerValue {
  const ctx = useContext(ComposerContext);
  if (!ctx) {
    throw new Error('useComposer must be used within ComposerProvider');
  }
  return ctx;
}

/** Re-exported for tests: the exact user-safe contract (no extra surface). */
export { userSafeMessage };
