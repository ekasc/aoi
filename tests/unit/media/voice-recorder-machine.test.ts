import { describe, expect, it } from 'vitest';

import {
  VOICE_RECORDER_INITIAL,
  voiceRecorderBusy,
  voiceRecorderReducer,
  type VoiceRecorderEvent,
  type VoiceRecorderState,
} from '@/features/media/voice-recorder-machine';

function run(events: VoiceRecorderEvent[], from: VoiceRecorderState = VOICE_RECORDER_INITIAL) {
  return events.reduce(voiceRecorderReducer, from);
}

describe('voice recorder machine', () => {
  it('runs idle -> starting -> recording -> stopping -> idle', () => {
    expect(run([{ type: 'press' }]).phase).toBe('starting');
    expect(run([{ type: 'press' }, { type: 'started' }]).phase).toBe('recording');
    expect(
      run([{ type: 'press' }, { type: 'started' }, { type: 'stopRequested' }]).phase
    ).toBe('stopping');
    expect(
      run([
        { type: 'press' },
        { type: 'started' },
        { type: 'stopRequested' },
        { type: 'stopSettled', stillRecording: false },
      ]).phase
    ).toBe('idle');
  });

  it('serializes duplicate presses while a start or stop is in flight', () => {
    const starting = run([{ type: 'press' }, { type: 'press' }]);
    expect(starting.phase).toBe('starting');

    const stopping = run([
      { type: 'press' },
      { type: 'started' },
      { type: 'stopRequested' },
      { type: 'stopRequested' },
    ]);
    expect(stopping.phase).toBe('stopping');
  });

  it('treats a failed stop that leaves native capture running as still recording', () => {
    const state = run([
      { type: 'press' },
      { type: 'started' },
      { type: 'stopRequested' },
      { type: 'stopSettled', stillRecording: true },
    ]);
    expect(state.phase).toBe('recording');
    expect(voiceRecorderBusy(state)).toBe(false);
  });

  it('keeps a permission denial until the system grants it, and only clears a start failure on a new attempt', () => {
    const denied = run([{ type: 'press' }, { type: 'permissionDenied' }]);
    expect(denied).toEqual({ phase: 'idle', failure: 'permission' });

    // A retry keeps the denial copy while the request is being answered.
    expect(run([{ type: 'press' }], denied).failure).toBe('permission');
    expect(run([{ type: 'press' }, { type: 'permissionGranted' }], denied).failure).toBeNull();

    const failed = run([{ type: 'press' }, { type: 'startFailed' }]);
    expect(failed.failure).toBe('start');
    expect(run([{ type: 'press' }], failed).failure).toBeNull();
  });

  it('clears a start failure when a fresh attempt begins, and does not resurrect it on cancellation', () => {
    const failed = run([{ type: 'press' }, { type: 'startFailed' }]);
    const cancelled = run([{ type: 'press' }, { type: 'startAborted' }], failed);
    expect(cancelled).toEqual({ phase: 'idle', failure: null });
  });

  it('keeps a permission denial through a cancelled attempt, because the system has not answered yet', () => {
    const denied = run([{ type: 'press' }, { type: 'permissionDenied' }]);
    const cancelled = run([{ type: 'press' }, { type: 'startAborted' }], denied);
    expect(cancelled).toEqual({ phase: 'idle', failure: 'permission' });
  });

  it('does not let the native finish callback reclaim a stop in flight', () => {
    const stopping = run([
      { type: 'press' },
      { type: 'started' },
      { type: 'stopRequested' },
    ]);
    expect(run([{ type: 'nativeFinished' }], stopping).phase).toBe('stopping');

    const recording = run([{ type: 'press' }, { type: 'started' }]);
    expect(run([{ type: 'nativeFinished' }], recording).phase).toBe('idle');
  });

  it('ignores a late start success after cancellation', () => {
    const cancelled = run([{ type: 'press' }, { type: 'startAborted' }]);
    expect(run([{ type: 'started' }], cancelled)).toEqual(cancelled);
  });

  it('reports busy only for the two waits that are not capture', () => {
    expect(voiceRecorderBusy({ phase: 'idle', failure: null })).toBe(false);
    expect(voiceRecorderBusy({ phase: 'starting', failure: null })).toBe(true);
    expect(voiceRecorderBusy({ phase: 'recording', failure: null })).toBe(false);
    expect(voiceRecorderBusy({ phase: 'stopping', failure: null })).toBe(true);
  });
});
