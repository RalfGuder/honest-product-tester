import { describe, expect, it } from "vitest";

import { buildScrollScript, describeScroll } from "@/lib/browser-scroll";

describe("buildScrollScript", () => {
  it("embeds the distance and the search text safely", () => {
    const script = buildScrollScript(-300, 'Person "11"');

    expect(script).toContain("const dy = -300;");
    expect(script).toContain('const withinText = "Person \\"11\\"";');
  });

  it("uses no search text when none is given", () => {
    expect(buildScrollScript(200, "  ")).toContain("const withinText = null;");
  });
});

describe("describeScroll", () => {
  it("tells when more content follows", () => {
    expect(
      describeScroll({ scrolled: "container", moved: 200, atEnd: false, label: "Mitglieder" }, "down"),
    ).toBe('Scrolled the scrollable area starting with "Mitglieder" by 200px. There is more content further down.');
  });

  it("tells when the end of a list is reached", () => {
    expect(describeScroll({ scrolled: "page", moved: 120, atEnd: true }, "down")).toBe(
      "Scrolled the page by 120px. Reached the bottom of it.",
    );
  });

  it("tells when the area did not move because it is already at the end", () => {
    expect(
      describeScroll({ scrolled: "container", moved: 0, atEnd: true, label: "Mitglieder" }, "down"),
    ).toBe('The scrollable area starting with "Mitglieder" is already at the bottom; there is nothing more below.');
  });

  it("tells when nothing is scrollable", () => {
    expect(describeScroll({ scrolled: "none", moved: 0, atEnd: true }, "up")).toMatch(/top/);
  });
});
