import { describe, expect, it } from "vitest";

import { settleWithLimit } from "@/lib/concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("settleWithLimit", () => {
  it("never runs more tasks at once than the limit", async () => {
    let running = 0;
    let peak = 0;

    await settleWithLimit([1, 2, 3, 4, 5], 2, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });

    expect(peak).toBe(2);
  });

  it("runs everything at once without a limit", async () => {
    let running = 0;
    let peak = 0;

    await settleWithLimit([1, 2, 3], Number.POSITIVE_INFINITY, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
    });

    expect(peak).toBe(3);
  });

  it("keeps the order of the items and isolates failures", async () => {
    const results = await settleWithLimit([3, 1, 2], 1, async (item) => {
      if (item === 1) {
        throw new Error("one failed");
      }

      return item * 10;
    });

    expect(results).toEqual([
      { status: "fulfilled", value: 30 },
      { status: "rejected", reason: new Error("one failed") },
      { status: "fulfilled", value: 20 },
    ]);
  });

  it("returns nothing for no items", async () => {
    expect(await settleWithLimit([], 2, async () => 1)).toEqual([]);
  });
});
