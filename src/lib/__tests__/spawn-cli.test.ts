import path from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "@/lib/drivers/spawn-cli";

// The current Node binary stands in for a CLI: `node -e <script> <args>`.
const node = process.execPath;
const failing = "process.stderr.write('bad ' + process.argv.slice(1).join(' ')); process.exit(3)";

describe("runCli", () => {
  it("collects stdout of a successful run", async () => {
    const result = await runCli(node, "node", ["-e", "process.stdout.write('hello')"], {
      timeoutMs: 10_000,
    });

    expect(result.stdout).toBe("hello");
  });

  it("puts the arguments and output into the error", async () => {
    await expect(
      runCli(node, "tool", ["-e", failing, "visible-arg"], { timeoutMs: 10_000 }),
    ).rejects.toThrow(/^tool -e .* visible-arg failed \(3\): bad visible-arg$/);
  });

  it("keeps secret arguments and output out of the error", async () => {
    const error = await runCli(node, "tool", ["-e", failing, "hunter2"], {
      timeoutMs: 10_000,
      secret: true,
    }).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("tool -e (arguments hidden) failed (3).");
    expect((error as Error).message).not.toContain("hunter2");
  });

  it("keeps secret arguments out of the timeout message", async () => {
    const error = await runCli(node, "tool", ["-e", "setTimeout(() => {}, 5000)", "hunter2"], {
      timeoutMs: 200,
      secret: true,
    }).catch((caught: Error) => caught);

    expect((error as Error).message).toBe("tool -e (arguments hidden) timed out after 200 ms");
  });

  it("runs in the given working directory", async () => {
    const cwd = path.join(process.cwd(), "src");
    const { stdout } = await runCli(node, "node", ["-e", "process.stdout.write(process.cwd())"], {
      timeoutMs: 10_000,
      cwd,
    });

    expect(stdout).toBe(cwd);
  });
});
