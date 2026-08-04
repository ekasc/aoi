import { describe, it, expect } from 'vitest';

import {
  approvalReducer,
  IDLE_APPROVAL,
  type ApprovalState,
} from '@/features/location/approval';

const pending: ApprovalState = { status: 'pending' };
const granting: ApprovalState = { status: 'granting' };
const sent: ApprovalState = { status: 'sent' };

describe('approvalReducer', () => {
  it('starts idle', () => {
    expect(IDLE_APPROVAL.status).toBe('idle');
  });

  it('shows the prompt when a request arrives while idle', () => {
    expect(approvalReducer(IDLE_APPROVAL, { type: 'request_received' })).toEqual(pending);
  });

  it('never stacks prompts — a repeat request while deciding stays pending', () => {
    expect(approvalReducer(pending, { type: 'request_received' })).toEqual(pending);
  });

  it('ignores late requests once a grant is underway or sent', () => {
    expect(approvalReducer(granting, { type: 'request_received' })).toEqual(granting);
    expect(approvalReducer(sent, { type: 'request_received' })).toEqual(sent);
  });

  it('moves pending → granting on approve, and only from pending', () => {
    expect(approvalReducer(pending, { type: 'approve' })).toEqual(granting);
    expect(approvalReducer(IDLE_APPROVAL, { type: 'approve' })).toEqual(IDLE_APPROVAL);
    expect(approvalReducer(sent, { type: 'approve' })).toEqual(sent);
  });

  it('moves granting → sent on granted, and only from granting', () => {
    expect(approvalReducer(granting, { type: 'granted' })).toEqual(sent);
    expect(approvalReducer(pending, { type: 'granted' })).toEqual(pending);
  });

  it('lets "Not now" quietly dismiss a pending prompt', () => {
    expect(approvalReducer(pending, { type: 'decline' })).toEqual(IDLE_APPROVAL);
  });

  it('silently absorbs a failed grant — decline from granting settles to idle', () => {
    expect(approvalReducer(granting, { type: 'decline' })).toEqual(IDLE_APPROVAL);
  });

  it('does not decline from idle or sent', () => {
    expect(approvalReducer(IDLE_APPROVAL, { type: 'decline' })).toEqual(IDLE_APPROVAL);
    expect(approvalReducer(sent, { type: 'decline' })).toEqual(sent);
  });

  it('reset returns to idle from anywhere (the sent confirmation lingers, then fades)', () => {
    expect(approvalReducer(sent, { type: 'reset' })).toEqual(IDLE_APPROVAL);
    expect(approvalReducer(pending, { type: 'reset' })).toEqual(IDLE_APPROVAL);
    expect(approvalReducer(granting, { type: 'reset' })).toEqual(IDLE_APPROVAL);
  });

  it('walks the whole happy path in order', () => {
    let state: ApprovalState = IDLE_APPROVAL;
    state = approvalReducer(state, { type: 'request_received' });
    expect(state.status).toBe('pending');
    state = approvalReducer(state, { type: 'approve' });
    expect(state.status).toBe('granting');
    state = approvalReducer(state, { type: 'granted' });
    expect(state.status).toBe('sent');
    state = approvalReducer(state, { type: 'reset' });
    expect(state.status).toBe('idle');
  });
});
