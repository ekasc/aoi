/**
 * Handing an invite code from the route that receives it to the flow that owns
 * the field.
 *
 * A link arrives as a route param on the setup screen, but the code field
 * belongs to the onboarding flow. Routing it through a module store rather than
 * a prop means the flow can read it wherever it is mounted, which is the same
 * shape the dev preview store already uses for the same reason: the stub
 * providers live at the root layout, above any route, and context cannot reach
 * them.
 *
 * One code at a time. A second invite replaces the first, because someone who
 * taps a second link means the second one.
 */

let pending: string | null = null;

/** Called by the route when a link hands it a code. */
export function publishInvite(code: string): void {
  pending = code;
}

/**
 * Called by the flow, which takes the code once and clears it.
 *
 * Clearing is the point: a second mount of the wizard must not resurrect an
 * invite that has already been acted on, or a reload would refill a field the
 * reader had since cleared.
 */
export function takeInvite(): string | null {
  const code = pending;
  pending = null;
  return code;
}
