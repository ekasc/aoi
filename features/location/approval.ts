/**
 * The on-request approval flow, as a small pure state machine.
 *
 * A request arrives by push (`request_received`) and the partner sees a
 * gentle prompt: Approve (one tap → grant a one-time position) or Not now
 * (one tap → quiet dismissal). No guilt copy, no confirmation dialogs.
 */

export type ApprovalStatus = 'idle' | 'pending' | 'granting' | 'sent';

export type ApprovalState = {
  status: ApprovalStatus;
};

export type ApprovalAction =
  | { type: 'request_received' }
  | { type: 'approve' }
  | { type: 'granted' }
  | { type: 'decline' }
  | { type: 'reset' };

export const IDLE_APPROVAL: ApprovalState = { status: 'idle' };

export function approvalReducer(
  state: ApprovalState,
  action: ApprovalAction
): ApprovalState {
  switch (action.type) {
    case 'request_received':
      // A repeat request while deciding simply stays pending — never a
      // stack of prompts.
      if (state.status === 'idle' || state.status === 'pending') {
        return { status: 'pending' };
      }
      return state;

    case 'approve':
      if (state.status === 'pending') {
        return { status: 'granting' };
      }
      return state;

    case 'granted':
      if (state.status === 'granting') {
        return { status: 'sent' };
      }
      return state;

    case 'decline':
      // "Not now" is always allowed while deciding — and quietly cancels a
      // grant that failed to send (a location that fails to send is
      // silently absorbed, never an error).
      if (state.status === 'pending' || state.status === 'granting') {
        return { status: 'idle' };
      }
      return state;

    case 'reset':
      return IDLE_APPROVAL;
  }
}
