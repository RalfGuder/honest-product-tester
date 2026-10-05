import { describe, expect, it } from "vitest";

import { parseDesktopApps } from "@/lib/desktop-apps";

const exePath = process.platform === "win32" ? "C:\\Apps\\Demo.exe" : "/opt/apps/demo";

describe("parseDesktopApps", () => {
  it("reads apps and fills defaults", () => {
    expect(parseDesktopApps({ apps: [{ id: "demo", exePath }] })).toEqual([
      { id: "demo", name: "demo", exePath, defaultArgs: [], workingDir: undefined },
    ]);
  });

  it("keeps name, default args and working dir", () => {
    const [app] = parseDesktopApps({
      apps: [
        {
          id: "demo",
          name: " Demo App ",
          exePath,
          defaultArgs: ["--lang", "de"],
          workingDir: " C:\\Apps ",
        },
      ],
    });

    expect(app).toMatchObject({
      name: "Demo App",
      defaultArgs: ["--lang", "de"],
      workingDir: "C:\\Apps",
    });
  });

  it("requires an apps array", () => {
    expect(() => parseDesktopApps([])).toThrow(/"apps" array/);
  });

  it("rejects invalid and duplicate ids", () => {
    expect(() => parseDesktopApps({ apps: [{ id: "My App", exePath }] })).toThrow(/"id"/);
    expect(() =>
      parseDesktopApps({ apps: [{ id: "demo", exePath }, { id: "demo", exePath }] }),
    ).toThrow(/used twice/);
  });

  it("requires an absolute exe path", () => {
    expect(() => parseDesktopApps({ apps: [{ id: "demo", exePath: "demo.exe" }] })).toThrow(
      /absolute path/,
    );
  });

  it("rejects default args that are not strings", () => {
    expect(() =>
      parseDesktopApps({ apps: [{ id: "demo", exePath, defaultArgs: "--lang de" }] }),
    ).toThrow(/defaultArgs/);
  });
});
