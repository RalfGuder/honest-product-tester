import { describe, expect, it } from "vitest";

import { buildFocusScript, toCropRegion } from "@/lib/browser-zoom";

const viewport = { width: 1280, height: 569 };

describe("toCropRegion", () => {
  it("adds the margin around the text and converts to device pixels", () => {
    expect(
      toCropRegion({ x: 400, y: 300, width: 80, height: 20 }, 100, viewport, 1),
    ).toEqual({ left: 300, top: 200, width: 280, height: 220 });

    expect(
      toCropRegion({ x: 400, y: 300, width: 80, height: 20 }, 100, viewport, 2),
    ).toEqual({ left: 600, top: 400, width: 560, height: 440 });
  });

  it("clamps the region to the visible viewport", () => {
    expect(toCropRegion({ x: 10, y: 540, width: 80, height: 20 }, 100, viewport, 1)).toEqual({
      left: 0,
      top: 440,
      width: 190,
      height: 129,
    });
  });

  it("returns undefined when the text is outside the viewport", () => {
    expect(toCropRegion({ x: 400, y: 800, width: 80, height: 20 }, 50, viewport, 1)).toBeUndefined();
  });
});

describe("buildFocusScript", () => {
  it("embeds the search text safely", () => {
    expect(buildFocusScript('Person "14"')).toContain('const text = "Person \\"14\\"";');
  });
});
