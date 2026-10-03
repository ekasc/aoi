import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { enrollSoloFace, pairEnrollment, scanAutomaticAlbum, emptyScanProgress, type AlbumEnrollment, type ScanProgress } from '@/features/album/automatic-album';
import { scanPauseReason } from '@/features/album/album-scan-conditions';
import { checkPhotoCrops, type PhotoCheck } from '@/features/album/photo-check';
import { alignedFacePreview } from '@/features/album/aligned-face-preview';
import { getAutomaticAlbumStorage } from '@/features/album/automatic-album-storage';
import { AutomaticAlbumContext, type AutoStatus } from '@/features/album/automatic-album-state';
import { automaticPhotoLibrary } from '@/features/album/automatic-photo-library';
import type { Faceprint } from '@/features/album/face-pipeline';
import { assessReferencePhoto, type ReferencePreviews } from '@/features/album/reference-assessment';
import { inspectFaceReference, referencePhotoStore } from '@/features/album/reference-photo';
import { createLocalFaceRecognition } from '@/features/album/local-face-recognition';
import { skyPhotoScopeKey } from '@/features/album/sky-photo-repository';
import { getSkyPhotoRepository } from '@/features/album/sky-photo-store';
import { useSession } from '@/features/session/session-context';
import { useSpace } from '@/features/space/space-context';
import { parseRelationshipStart, startOfDay } from '@/features/calendar/calendar-date-utils';

const EMPTY_PROGRESS = emptyScanProgress();

export function AutomaticAlbumProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const { space } = useSpace();
  // Real-photo accuracy is not calibrated. Do not start discovery in a production build.
  if (typeof __DEV__ === 'undefined' || !__DEV__) return children;
  if (!user || !space) return children;
  const scope = { userId: user.id, spaceId: space.id };
  const startDate = space.relationshipStartDate ? parseRelationshipStart(space.relationshipStartDate) : null;
  const since = startDate ? startOfDay(startDate).getTime() : null;
  return <ScopedAutomaticAlbum key={`${skyPhotoScopeKey(scope)}:${since}`} scope={scope} since={since}>{children}</ScopedAutomaticAlbum>;
}

function ScopedAutomaticAlbum({ scope, since, children }: PropsWithChildren<{ scope: { userId: string; spaceId: string }; since: number | null }>) {
  const scopeKey = skyPhotoScopeKey(scope);
  const { userId, spaceId } = scope;
  const storage = useMemo(() => getAutomaticAlbumStorage(scopeKey), [scopeKey]);
  const previewStore = useMemo(() => referencePhotoStore(scopeKey), [scopeKey]);
  const repository = useMemo(() => getSkyPhotoRepository({ userId, spaceId }), [userId, spaceId]);
  const [status, setStatus] = useState<AutoStatus>('loading');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<'full' | 'limited' | null>(null);
  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [references, setReferences] = useState({ you: false, partner: false });
  const [referencePhase, setReferencePhase] = useState<{ person: Faceprint['person']; label: string } | null>(null);
  const [previews, setPreviews] = useState<ReferencePreviews>({ you: null, partner: null });
  const previewRef = useRef<ReferencePreviews>({ you: null, partner: null });
  const committedPreviews = useRef<ReferencePreviews>({ you: null, partner: null });
  const [referenceIssue, setReferenceIssue] = useState<{ person: Faceprint['person']; message: string } | null>(null);
  const [editingReferences, setEditingReferences] = useState(false);
  const [photoCheck, setPhotoCheck] = useState<PhotoCheck | null>(null);
  const photoAction = useRef<AbortController | null>(null);
  const [checkingPhoto, setCheckingPhoto] = useState(false);
  const mounted = useRef(false);
  const enrollment = useRef<AlbumEnrollment | null>(null);
  const drafts = useRef<{ you: Faceprint | null; partner: Faceprint | null }>({ you: null, partner: null });
  const scan = useRef<{ abort: AbortController; done: Promise<void> } | null>(null);
  const action = useRef<AbortController | null>(null);
  const restart = useRef(false);
  const paused = useRef(false);
  const trigger = useRef<() => void>(() => {});

  const beginScan = useCallback(() => {
    if (!mounted.current || !enrollment.current || action.current || paused.current || AppState.currentState !== 'active') return;
    if (scan.current) { restart.current = true; return; }
    if (since === null) { setStatus('date-required'); return; }
    const reason = scanPauseReason();
    if (reason) {
      setStatus('paused'); setError(reason === 'heat' ? 'Discovery paused to let your phone cool down. Resume when it is cooler.' : 'Discovery paused while Low Power Mode is on.'); return;
    }
    const abort = new AbortController();
    const activeEnrollment = enrollment.current;
    const engine = createLocalFaceRecognition();
    setStatus('scanning'); setError(null);
    const done = (async () => {
      try {
        const result = await scanAutomaticAlbum({ engine, enrollment: activeEnrollment, storage, library: automaticPhotoLibrary, repository, signal: abort.signal,
          since,
          yieldWork: async () => {
            const reason = scanPauseReason();
            if (reason) {
              paused.current = true; abort.abort();
              if (mounted.current) setError(reason === 'heat' ? 'Discovery paused to let your phone cool down. Resume when it is cooler.' : 'Discovery paused while Low Power Mode is on.');
            }
          },
          onProgress: (value) => { if (mounted.current && !abort.signal.aborted) setProgress(value); },
          onPhotosChanged: () => { if (mounted.current) setRevision((value) => value + 1); },
        });
        if (!mounted.current) return;
        if (abort.signal.aborted) { setStatus('paused'); return; }
        switch (result.kind) {
          case 'complete':
            setStatus('ready'); setAccess(result.access);
            break;
          case 'partial': setStatus('partial'); setAccess(result.access); break;
          case 'queued':
            setStatus('queued'); setAccess(result.access); restart.current = true;
            break;
          case 'cancelled': setStatus('ready'); break;
          case 'permission-denied': setStatus('permission-denied'); setAccess(null); break;
          case 'unavailable': setStatus('unavailable'); break;
          case 'enrollment-required': setStatus('failed'); setError('Face setup needs updating. Turn discovery off, then set it up again.'); break;
          case 'failed': setStatus('failed'); setError('Could not finish checking your photos. Your progress is saved.'); break;
        }
      } finally {
        await engine.dispose().catch(() => {});
        if (scan.current?.abort === abort) scan.current = null;
        if (restart.current && mounted.current && enrollment.current && !action.current) {
          restart.current = false;
          trigger.current();
        }
      }
    })();
    scan.current = { abort, done };
  }, [storage, repository, since]);
  useEffect(() => { trigger.current = beginScan; }, [beginScan]);

  useEffect(() => {
    mounted.current = true;
    const init = new AbortController();
    void storage.loadEnrollment().then((value) => {
      if (!mounted.current || init.signal.aborted) return;
      enrollment.current = value;
      setEnabled(value !== null);
      setStatus(since === null ? 'date-required' : value ? 'ready' : 'off');
      if (value) void previewStore.load(value.referenceId).then((loaded) => {
        if (!mounted.current || init.signal.aborted) return;
        previewRef.current = loaded; committedPreviews.current = loaded; setPreviews(loaded);
      }).catch(() => {});
      if (value) beginScan();
    }).catch(() => {
      if (!mounted.current || init.signal.aborted) return;
      setStatus('failed'); setError('Could not restore face setup. Try again or turn discovery off to reset it.');
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') beginScan();
      else {
        scan.current?.abort.abort(); restart.current = false;
        setStatus((value) => value === 'scanning' || value === 'queued' ? 'paused' : value);
      }
    });
    return () => {
      mounted.current = false; init.abort(); scan.current?.abort.abort(); action.current?.abort(); restart.current = false;
      drafts.current.you?.embedding.fill(0); drafts.current.partner?.embedding.fill(0);
      for (const person of ['you', 'partner'] as const) {
        const preview = previewRef.current[person];
        if (preview?.id !== committedPreviews.current[person]?.id) previewStore.discard(preview);
      }
      const pending = scan.current?.done ?? Promise.resolve();
      void pending.finally(() => { enrollment.current?.prints.forEach((print) => print.embedding.fill(0)); repository.dispose(); }).catch(() => {});
      subscription.remove();
    };
  }, [storage, repository, beginScan, previewStore, since]);

  useEffect(() => {
    if (!enabled) return;
    return automaticPhotoLibrary.subscribe(() => {
      if (scan.current) { restart.current = true; scan.current.abort.abort(); }
      else beginScan();
    });
  }, [enabled, beginScan]);

  const chooseReference = useCallback(async (person: Faceprint['person']) => {
    if (action.current || (enabled && !editingReferences)) return;
    if (since === null) { setStatus('date-required'); return; }
    const abort = new AbortController(); action.current = abort; setBusy(true); setError(null);
    setReferencePhase({ person, label: 'Preparing face recognition…' });
    setReferenceIssue(null);
    const engine = createLocalFaceRecognition();
    try {
      if (!await engine.isAvailable()) { setStatus('unavailable'); return; }
      if (abort.signal.aborted) return;
      setReferencePhase({ person, label: 'Choose a clear solo photo' });
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, exif: false });
      if (result.canceled || abort.signal.aborted) return;
      drafts.current[person]?.embedding.fill(0); drafts.current[person] = null;
      setReferences((value) => ({ ...value, [person]: false }));
      setReferencePhase({ person, label: 'Checking face and photo quality…' });
      const inspected = await inspectFaceReference(result.assets[0].uri);
      const assessment = assessReferencePhoto(inspected);
      const preview = await previewStore.create(result.assets[0].uri, inspected, assessment);
      if (abort.signal.aborted) { previewStore.discard(preview); return; }
      const oldPreview = previewRef.current[person];
      if (oldPreview?.id !== committedPreviews.current[person]?.id) previewStore.discard(oldPreview);
      previewRef.current = { ...previewRef.current, [person]: preview }; setPreviews(previewRef.current);
      if (assessment.grade === 'rejected') { setReferenceIssue({ person, message: assessment.notes[0] }); return; }
      setReferencePhase({ person, label: 'Creating your face reference…' });
      const print = await enrollSoloFace(engine, result.assets[0].uri, person, abort.signal);
      if (abort.signal.aborted) { print.embedding.fill(0); return; }
      drafts.current[person] = print;
      setReferences((value) => ({ ...value, [person]: true }));
      setStatus('off');
    } catch (caught) {
      if (mounted.current && !abort.signal.aborted) setReferenceIssue({ person, message: caught instanceof Error && /^(Choose|Face recognition)/.test(caught.message) ? caught.message : 'Could not read this reference photo. Try a different clear photo.' });
    } finally {
      await engine.dispose().catch(() => {});
      if (action.current === abort) action.current = null;
      if (mounted.current) { setBusy(false); setReferencePhase(null); }
    }
  }, [enabled, editingReferences, previewStore, since]);

  const enable = useCallback(async () => {
    if (action.current || (enabled && !editingReferences) || !drafts.current.you || !drafts.current.partner) return;
    if (since === null) { setStatus('date-required'); return; }
    const abort = new AbortController(); action.current = abort; setBusy(true); setError(null);
    try {
      const value = pairEnrollment(drafts.current.you, drafts.current.partner);
      const permission = await automaticPhotoLibrary.permission(true);
      if (abort.signal.aborted) return;
      if (permission === 'denied') { setStatus('permission-denied'); return; }
      await previewStore.save(previewRef.current, value.referenceId ?? 'legacy');
      await storage.saveEnrollment(value);
      if (abort.signal.aborted) return;
      enrollment.current?.prints.forEach((print) => print.embedding.fill(0));
      enrollment.current = value; drafts.current = { you: null, partner: null };
      committedPreviews.current = previewRef.current;
      setPhotoCheck(null);
      paused.current = false; setEditingReferences(false); setEnabled(true); setAccess(permission); setStatus('ready');
    } catch (caught) {
      if (mounted.current && !abort.signal.aborted) setError(caught instanceof Error && caught.message.startsWith('These references') ? caught.message : 'Could not save face setup. Please try again.');
    } finally {
      if (action.current === abort) action.current = null;
      if (mounted.current) { setBusy(false); beginScan(); }
    }
  }, [enabled, editingReferences, storage, beginScan, previewStore, since]);

  const disable = useCallback(async () => {
    if (action.current) return;
    const abort = new AbortController(); action.current = abort; setBusy(true); setError(null);
    paused.current = true; restart.current = false; scan.current?.abort.abort();
    try {
      await scan.current?.done;
      await storage.forgetEnrollment();
      await previewStore.clear(); previewRef.current = { you: null, partner: null }; committedPreviews.current = previewRef.current;
      enrollment.current?.prints.forEach((print) => print.embedding.fill(0));
      enrollment.current = null;
      setPhotoCheck(null);
      drafts.current.you?.embedding.fill(0); drafts.current.partner?.embedding.fill(0); drafts.current = { you: null, partner: null };
      if (mounted.current) { setEnabled(false); setEditingReferences(false); setPreviews(previewRef.current); setReferences({ you: false, partner: false }); setStatus('off'); setProgress(EMPTY_PROGRESS); }
    } catch { if (mounted.current) { setStatus('failed'); setError('Could not remove face setup. Scanning is paused. Try turning it off again.'); } }
    finally { if (action.current === abort) action.current = null; if (mounted.current) setBusy(false); }
  }, [storage, previewStore]);

  const retry = useCallback(() => {
    if (action.current || editingReferences) return;
    paused.current = false;
    if (enrollment.current) { beginScan(); return; }
    setStatus('loading'); setError(null);
    void storage.loadEnrollment().then((value) => {
      if (!mounted.current) return;
      enrollment.current = value; setEnabled(value !== null); setStatus(value ? 'ready' : 'off');
      if (value) beginScan();
    }).catch(() => { if (mounted.current) { setStatus('failed'); setError('Could not restore face setup. Try again or turn discovery off to reset it.'); } });
  }, [beginScan, storage, editingReferences]);
  const pause = useCallback(() => {
    paused.current = true; restart.current = false; scan.current?.abort.abort();
    setStatus('paused');
  }, []);
  const editReferences = useCallback(async () => {
    if (action.current) return;
    pause(); await scan.current?.done;
    if (mounted.current) { setEditingReferences(true); setReferences({ you: false, partner: false }); }
  }, [pause]);
  const checkPhoto = useCallback(async () => {
    if (action.current || !enrollment.current || editingReferences) return;
    const abort = new AbortController(); action.current = abort; photoAction.current = abort;
    setBusy(true); setCheckingPhoto(true); setPhotoCheck(null);
    pause();
    const engine = createLocalFaceRecognition();
    try {
      await scan.current?.done;
      if (abort.signal.aborted) return;
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, allowsEditing: false, quality: 1, exif: false });
      if (result.canceled || abort.signal.aborted) return;
      const report = await checkPhotoCrops({ engine, uri: result.assets[0].uri, signal: abort.signal, preview: alignedFacePreview });
      if (mounted.current && !abort.signal.aborted) setPhotoCheck(report);
    } catch {
      if (mounted.current && !abort.signal.aborted) setPhotoCheck({ kind: 'failed', message: 'Could not check this photo. Try choosing it again.' });
    } finally {
      await engine.dispose().catch(() => {});
      if (action.current === abort) action.current = null;
      if (photoAction.current === abort) photoAction.current = null;
      if (mounted.current) { setBusy(false); setCheckingPhoto(false); }
    }
  }, [editingReferences, pause]);
  const clearPhotoCheck = useCallback(() => { photoAction.current?.abort(); setPhotoCheck(null); }, []);
  const cancelPhotoCheck = useCallback(() => {
    if (!photoAction.current) return;
    photoAction.current.abort(); setPhotoCheck({ kind: 'cancelled' });
  }, []);
  const value = useMemo(() => ({ status, enabled, busy, access, progress, error, revision, references, referencePhase, previews, referenceIssue, editingReferences, editReferences, chooseReference, enable, disable, retry, pause, photoCheck, checkPhoto, clearPhotoCheck, checkingPhoto, cancelPhotoCheck }),
    [status, enabled, busy, access, progress, error, revision, references, referencePhase, previews, referenceIssue, editingReferences, editReferences, chooseReference, enable, disable, retry, pause, photoCheck, checkPhoto, clearPhotoCheck, checkingPhoto, cancelPhotoCheck]);
  return <AutomaticAlbumContext.Provider value={value}>{children}</AutomaticAlbumContext.Provider>;
}
