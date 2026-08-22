/**
 * Recognise a failure caused by the user having no Claude token saved.
 *
 * Three separate backend paths can fail this way — the build-start guard, the
 * agent's own check at run time, and the chat runtime — and none of them carries
 * a machine-readable code, only prose. All three name the token, so the message
 * itself is what the page has to match on.
 */
export function isMissingTokenError(message: string | null): boolean {
  return !!message && /claude (subscription )?token/i.test(message);
}
