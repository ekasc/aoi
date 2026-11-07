/**
 * Voice capture as one explicit state machine.
 *
 * The component used to carry a `phase` ref plus two error booleans, with the
 * legal transitions spread across the press handler, the native status
 * callback, the stop path, and two effects. The rules that mattered were:
 *
 *   - only one operation may own the recorder at a time;
 *   - a start that is cancelled (disable, unmount, newer attempt) may not
 *     revive when it settles;
 *   - a failed stop leaves the phase in `recording` when the native recorder
 *     is still running, so the next press retries the stop rather than
 *     starting a second recording;
 *   - permission denial and start failure are different messages, and neither
 *     may be overwritten by the other while it is still true.
 *
 * `phase` is the operation that owns capture. `failure` is the last thing the
 * reader needs to know, and it clears only on the event that actually resolves
 * it (a granted permission, or a fresh start attempt).
 */

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'stopping';

export type VoiceFailure = 'permission' | 'start' | null;

export type VoiceRecorderState = {
  phase: VoicePhase;
  failure: VoiceFailure;
};

export type VoiceRecorderEvent =
  /** A press that may begin capture. Ignored unless idle. */
  | { type: 'press' }
  /** Permission was granted; the denial copy can retire. */
  | { type: 'permissionGranted' }
  | { type: 'permissionDenied' }
  /** Mode, prepare, or record threw. */
  | { type: 'startFailed' }
  /** `recorder.record()` returned. */
  | { type: 'started' }
  /** A start was cancelled before it owned capture. */
  | { type: 'startAborted' }
  /** `recorder.stop()` was called. */
  | { type: 'stopRequested' }
  /** `recorder.stop()` settled; `stillRecording` is the native truth. */
  | { type: 'stopSettled'; stillRecording: boolean }
  /** The native recorder reported it finished. */
  | { type: 'nativeFinished' };

export const VOICE_RECORDER_INITIAL: VoiceRecorderState = {
  phase: 'idle',
  failure: null,
};

export function voiceRecorderReducer(
  state: VoiceRecorderState,
  event: VoiceRecorderEvent
): VoiceRecorderState {
  switch (event.type) {
    case 'press':
      if (state.phase !== 'idle') return state;
      return {
        phase: 'starting',
        // A start failure belongs to the attempt that produced it. A permission
        // denial does not: it is still true until the system says otherwise.
        failure: state.failure === 'start' ? null : state.failure,
      };
    case 'permissionGranted':
      return state.failure === 'permission' ? { ...state, failure: null } : state;
    case 'permissionDenied':
      if (state.phase !== 'starting') return state;
      return { phase: 'idle', failure: 'permission' };
    case 'startFailed':
      if (state.phase !== 'starting') return state;
      return { phase: 'idle', failure: 'start' };
    case 'started':
      return state.phase === 'starting' ? { ...state, phase: 'recording' } : state;
    case 'startAborted':
      return state.phase === 'starting' ? { ...state, phase: 'idle' } : state;
    case 'stopRequested':
      return state.phase === 'recording' ? { ...state, phase: 'stopping' } : state;
    case 'stopSettled':
      if (state.phase !== 'stopping') return state;
      return { ...state, phase: event.stillRecording ? 'recording' : 'idle' };
    case 'nativeFinished':
      // A stop in flight owns the phase until its own promise settles; the
      // status callback must not hand ownership back early.
      return state.phase === 'stopping' ? state : { ...state, phase: 'idle' };
    default:
      return state;
  }
}

/** Busy is derived, never stored: it is exactly the two non-capture waits. */
export function voiceRecorderBusy(state: VoiceRecorderState): boolean {
  return state.phase === 'starting' || state.phase === 'stopping';
}
