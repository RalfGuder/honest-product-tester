import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDesktopPersona } from "@/lib/credentials";
import { createDesktopDriver, REAL_INPUT_DISABLED_MESSAGE } from "@/lib/drivers/desktop-driver";
import { runCli } from "@/lib/drivers/spawn-cli";
import type { ToolRunner } from "@/lib/drivers/types";
import type { Persona } from "@/lib/personas";
import type { DesktopTarget } from "@/lib/run-target";
import { EXPLORE_SCENARIO, type Scenario } from "@/lib/scenario-format";

vi.mock("@/lib/drivers/spawn-cli", () => ({ runCli: vi.fn() }));
vi.mock("@/lib/credentials", () => ({ getDesktopPersona: vi.fn() }));
vi.mock("@/lib/runs", () => ({ updateCellRecord: vi.fn(async () => undefined) }));

const runCliMock = vi.mocked(runCli);
const getDesktopPersonaMock = vi.mocked(getDesktopPersona);

const target: DesktopTarget = {
  kind: "desktop",
  appId: "demo",
  appName: "Demo",
  exePath: "C:\\Apps\\Demo\\Demo.exe",
  args: ["--test", "Case 2"],
};
const scenario: Scenario = { ...EXPLORE_SCENARIO, startArgs: ["--lang", "de"] };
const persona = { id: "alice" } as Persona;

const loginSnapshot = `- window "Demo" [ref=e1] [id=MainWindow]
  - edit [ref=e6] [id=Login.Username] value=""
  - edit [ref=e7] [id=Login.Password] value=""
  - button "Login" [ref=e9] [id=Login.Submit]`;

function createDriver(overrides: { realInput?: boolean } = {}) {
  return createDesktopDriver({
    cellId: "alice__explore",
    realInput: overrides.realInput ?? true,
    runId: "run-1",
    screenshotDir: "C:\\runs\\run-1\\screenshots",
    target,
  });
}

// Answers agent-wpf commands by their first argument after --session <name>.
function answer(outputs: Record<string, string>) {
  runCliMock.mockImplementation(async (_bin, _label, args) => ({
    stdout: outputs[args[2]] ?? "ok",
    stderr: "",
  }));
}

const calls = () => runCliMock.mock.calls.map(([, , args, options]) => ({ args, options }));

describe("createDesktopDriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answer({});
    getDesktopPersonaMock.mockResolvedValue({});
  });

  const openArgs = () => calls().find(({ args }) => args[2] === "open")!.args.slice(7);

  it("opens the app with default and scenario args in its own folder", async () => {
    const driver = createDriver();

    await driver.resolvePersona(persona, scenario);
    await driver.start();

    expect(calls()[0]).toEqual({
      args: [
        "--session",
        "run-1-alice__explore",
        "open",
        "C:\\Apps\\Demo\\Demo.exe",
        "--timeout",
        "60000",
        "--",
        "--test",
        "Case 2",
        "--lang",
        "de",
      ],
      options: expect.objectContaining({ cwd: "C:\\Apps\\Demo" }),
    });
  });

  it("replaces default and scenario args with the persona's own", async () => {
    getDesktopPersonaMock.mockResolvedValue({ args: ["--test", "Case 7"] });
    const driver = createDriver();

    await driver.resolvePersona(persona, {
      ...scenario,
      personaStartArgs: { alice: ["--lang", "en"], bob: ["--lang", "fr"] },
    });
    await driver.start();

    expect(openArgs()).toEqual(["--test", "Case 7", "--lang", "en"]);
  });

  it("applies the persona's args in anonymous scenarios too", async () => {
    getDesktopPersonaMock.mockResolvedValue({ args: ["--guest"] });
    const driver = createDriver();

    expect(await driver.resolvePersona(persona, { ...scenario, login: "anonymous" })).toEqual({});
    await driver.start();

    expect(openArgs()).toEqual(["--guest", "--lang", "de"]);
  });

  it("logs in through the configured fields and hides the password", async () => {
    getDesktopPersonaMock.mockResolvedValue({
      login: {
        appId: "demo",
        username: "alice",
        password: "hunter2",
        usernameField: "Login.Username",
        passwordField: "Login.Password",
        submit: "Login",
        loggedInWindow: "^Demo – Start",
      },
    });
    answer({ snapshot: loginSnapshot });
    const driver = createDriver();

    expect(await driver.resolvePersona(persona, { ...scenario, login: "required" })).toEqual({
      username: "alice",
    });

    await driver.login();

    const steps = calls().map(({ args }) => args.slice(2));

    expect(steps).toEqual([
      ["snapshot", "--all-windows", "-i"],
      ["fill", "@e6", "alice"],
      ["fill", "@e7", "hunter2"],
      ["click", "@e9"],
      ["wait", "--window", "^Demo – Start", "--timeout", "30000"],
    ]);
    expect(calls()[2].options).toMatchObject({ secret: true });
    expect(calls().filter(({ options }) => !options.secret).flatMap(({ args }) => args)).not.toContain(
      "hunter2",
    );
  });

  it("names the missing field when the login dialog does not match", async () => {
    getDesktopPersonaMock.mockResolvedValue({
      login: {
        appId: "demo",
        username: "alice",
        password: "hunter2",
        usernameField: "UserBox",
        passwordField: "Login.Password",
        submit: "Login",
      },
    });
    answer({ snapshot: loginSnapshot });
    const driver = createDriver();

    await driver.resolvePersona(persona, scenario);

    await expect(driver.login()).rejects.toThrow(
      'Login as alice failed: Username field "UserBox" not found in Demo.',
    );
  });

  it("skips a required login when the persona has no account", async () => {
    getDesktopPersonaMock.mockResolvedValue({ args: ["--guest"] });

    expect(await createDriver().resolvePersona(persona, { ...scenario, login: "required" })).toEqual({
      skipReason: { key: "loginRequiredNoApp", params: { app: "Demo" } },
    });
  });

  it("starts without login when an auto scenario has no account", async () => {
    expect(await createDriver().resolvePersona(persona, scenario)).toEqual({});
  });

  it("skips a required login when the credentials are broken, fails otherwise", async () => {
    getDesktopPersonaMock.mockRejectedValue(new Error("bad file"));

    expect(await createDriver().resolvePersona(persona, { ...scenario, login: "required" })).toEqual({
      skipReason: { key: "loginRequiredError", params: { error: "bad file" } },
    });
    await expect(createDriver().resolvePersona(persona, scenario)).rejects.toThrow("bad file");
  });

  it("refuses real keyboard input while several testers run", async () => {
    const runTool: ToolRunner = vi.fn(async () => "ok");
    const press = createDriver({ realInput: false })
      .createTools(runTool)
      .find((tool) => tool.name === "desktop_press")!;

    await expect(
      press.execute("call-1", { keys: "Enter" }, undefined, undefined, undefined as never),
    ).rejects.toThrow(REAL_INPUT_DISABLED_MESSAGE);
    expect(runTool).not.toHaveBeenCalled();
  });

  it("passes --input only when real input is allowed and asked for", async () => {
    const runTool = vi.fn<ToolRunner>(async () => "ok");
    const click = createDriver()
      .createTools(runTool)
      .find((tool) => tool.name === "desktop_click")!;

    await click.execute("call-1", { target: "@e3" }, undefined, undefined, undefined as never);
    await click.execute(
      "call-2",
      { target: "@e3", realInput: true },
      undefined,
      undefined,
      undefined as never,
    );

    expect(runTool.mock.calls.map(([, args]) => args)).toEqual([
      ["click", "@e3"],
      ["click", "@e3", "--input"],
    ]);
  });

  it("reads the final windows and checks window titles and texts", async () => {
    answer({
      windows: '- window "Demo" [ref=e1]\n- window "Export complete" [ref=e20] [modal] [active]',
      snapshot: '- window "Export complete" [ref=e20]\n  - text "Saved to C:\\\\out.pdf" [ref=e21]',
    });
    const driver = createDriver();
    const evidence = await driver.readFinalEvidence();

    expect(evidence).toEqual({
      finalWindow: "Export complete",
      openWindows: ["Demo", "Export complete"],
    });

    const results = await driver.checkAssertions(
      [
        { type: "window_title_matches", value: "^Export( complete)?$" },
        { type: "window_title_matches", value: "^Demo$" },
        { type: "text_visible", value: "Saved to" },
        { type: "text_visible", value: "Failed" },
      ],
      evidence,
    );

    expect(results.map((result) => result.passed)).toEqual([true, false, true, false]);
    expect(results[0].detail).toBe("Export complete");
  });

  it("closes the app and stops the session even when closing fails", async () => {
    runCliMock.mockRejectedValueOnce(new Error("nothing attached"));

    await createDriver().close();

    expect(calls().map(({ args }) => args.slice(2))).toEqual([
      ["close", "--kill"],
      ["session", "stop"],
    ]);
  });
});
