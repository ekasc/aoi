/**
 * The app's press feedback, as style fragments.
 *
 * There were three different treatments in the codebase: buttons and icon
 * buttons dipped to 0.92 and scaled, moment rows dipped to 0.92 with no
 * scale, and the floating add button dipped to 0.85. A control that answers
 * a touch noticeably differently from its neighbour is the kind of thing a
 * reader feels without being able to name, so the values live here now and
 * every tappable thing reads from the same two lines.
 *
 * 0.92 is deliberately shallow. It is there to say "yes, that registered" on
 * a surface that is already a photograph or a sheet; it is not there to be
 * seen. Anything that wants to be seen wants a scale, which is why
 * `scaled` is the companion rather than an alternative.
 *
 * `scaled` is gated on reduced motion at the call site: a press that moves
 * geometry is exactly what the preference asks us not to do.
 */
export const Pressed = {
  /** The acknowledgement every control gets. */
  at: { opacity: 0.92 },
  /** Plus the movement, for controls where the press should be felt. */
  scaled: { transform: [{ scale: 0.97 }] },
  /** For controls sitting on imagery, where 0.92 would be lost. */
  onMedia: { opacity: 0.7 },
} as const;
