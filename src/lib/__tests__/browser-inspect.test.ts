import { describe, expect, it } from "vitest";

import { buildInspectScript, describeInspect } from "@/lib/browser-inspect";

describe("buildInspectScript", () => {
  it("embeds the search text safely", () => {
    expect(buildInspectScript(' Person "14" ')).toContain('const text = "Person \\"14\\"";');
  });
});

describe("describeInspect", () => {
  it("returns the markup", () => {
    expect(
      describeInspect("Person 14", {
        found: true,
        count: 1,
        html: '<span class="ffp-presence ffp-presence-active"></span>',
      }),
    ).toBe('Markup around "Person 14":\n<span class="ffp-presence ffp-presence-active"></span>');
  });

  it("mentions further matches", () => {
    expect(describeInspect("Person 1", { found: true, count: 3, html: "<b></b>" })).toMatch(
      /3 places/,
    );
  });

  it("reports a missing text", () => {
    expect(describeInspect("Person 99", { found: false, count: 0 })).toMatch(/not found/);
  });
});
