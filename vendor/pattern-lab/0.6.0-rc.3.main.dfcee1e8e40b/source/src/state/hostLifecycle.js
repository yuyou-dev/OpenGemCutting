/** Stop waiting when the host leaves, even if its I/O cannot be cancelled.
 * The host also receives the signal to cancel work it has already started. */
export function untilAborted(work, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
