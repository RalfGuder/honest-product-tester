/**
 * Calls `onIdle` once when `touch()` has not been called for `idleMs`. Catches sessions that
 * hang, e.g. on a model request that never returns, long before the cell's overall time limit.
 */
export function createIdleWatchdog({
  idleMs,
  checkEveryMs = 5_000,
  onIdle,
}: {
  idleMs: number;
  checkEveryMs?: number;
  onIdle: () => void;
}) {
  let lastActivity = Date.now();
  let fired = false;

  const timer = setInterval(() => {
    if (!fired && Date.now() - lastActivity >= idleMs) {
      fired = true;
      clearInterval(timer);
      onIdle();
    }
  }, checkEveryMs);

  return {
    touch() {
      lastActivity = Date.now();
    },
    stop() {
      clearInterval(timer);
    },
    get fired() {
      return fired;
    },
  };
}
