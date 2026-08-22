/**
 * Open the floating assistant chat from anywhere in the app and, optionally,
 * auto-send a prefilled prompt. This is a plain DOM/UI event (NOT an agent
 * action): Chat.tsx listens for `lms:openchat`, opens the panel, and if a
 * `prompt` is present auto-sends it after a short delay so the open animation
 * settles first.
 */
export function openChatWithPrompt(prompt?: string): void {
  window.dispatchEvent(new CustomEvent('lms:openchat', { detail: { prompt } }));
}
