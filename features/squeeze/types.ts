export type Squeeze = {
  id: string;
  /** Who the squeeze is conceptually from: your partner's reply. */
  fromRole: 'you' | 'partner';
  sentAt: string;
};

export type SqueezeContextValue = {
  /** Send a wordless squeeze to your partner. */
  sendSqueeze: () => Promise<void>;
  /** A squeeze received from the partner (drives the overlay). */
  incomingSqueeze: Squeeze | null;
  dismissIncoming: () => void;
  lastSentAt: string | null;
  isSending: boolean;
  /** Whether the delivery backend is available (needs push; stub simulates). */
  deliveryAvailable: boolean;
};
