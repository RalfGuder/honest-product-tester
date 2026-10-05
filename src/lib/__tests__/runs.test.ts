import { describe, expect, it } from "vitest";

import { upgradeManifest, type RunManifest } from "@/lib/runs";

const base = {
  id: "run-1",
  createdAt: "2026-10-05T00:00:00.000Z",
  status: "completed" as const,
  orchestration: "parallel" as const,
  personas: ["alice"],
};

describe("upgradeManifest", () => {
  it("turns the url of older runs into a web target", () => {
    expect(upgradeManifest({ ...base, url: "https://example.com/" })).toEqual({
      ...base,
      target: { kind: "web", url: "https://example.com/" },
    });
  });

  it("keeps manifests that already have a target", () => {
    const manifest: RunManifest = {
      ...base,
      target: {
        kind: "desktop",
        appId: "demo",
        appName: "Demo",
        exePath: "C:\\Apps\\Demo.exe",
        args: [],
      },
    };

    expect(upgradeManifest(manifest)).toBe(manifest);
  });
});
