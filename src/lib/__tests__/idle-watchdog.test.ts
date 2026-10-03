import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createIdleWatchdog } from "@/lib/idle-watchdog";

describe("createIdleWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after the idle time without activity", () => {
    const onIdle = vi.fn();
    const watchdog = createIdleWatchdog({ idleMs: 60_000, checkEveryMs: 5_000, onIdle });

    vi.advanceTimersByTime(59_000);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(watchdog.fired).toBe(true);

    vi.advanceTimersByTime(120_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("is kept alive by activity", () => {
    const onIdle = vi.fn();
    const watchdog = createIdleWatchdog({ idleMs: 60_000, checkEveryMs: 5_000, onIdle });

    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(50_000);
      watchdog.touch();
    }

    expect(onIdle).not.toHaveBeenCalled();
    expect(watchdog.fired).toBe(false);
  });

  it("never fires after it was stopped", () => {
    const onIdle = vi.fn();
    const watchdog = createIdleWatchdog({ idleMs: 60_000, checkEveryMs: 5_000, onIdle });

    watchdog.stop();
    vi.advanceTimersByTime(300_000);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
