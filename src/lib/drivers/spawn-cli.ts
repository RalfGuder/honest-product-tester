import { spawn } from "node:child_process";

import type { ExecResult } from "@/lib/drivers/types";

export type RunCliOptions = {
  stdin?: string;
  timeoutMs: number;
  cwd?: string;
  // The arguments contain a secret (e.g. a password): keep them out of error messages.
  secret?: boolean;
};

/**
 * Runs a CLI once and collects its output. Fails with `<label> <args> failed (<code>): <output>`.
 *
 * Resolves on "exit", not "close": a CLI may spawn a daemon that inherits stdout/stderr,
 * so the pipes never close and "close" never fires.
 */
export function runCli(
  bin: string,
  label: string,
  args: string[],
  { stdin, timeoutMs, cwd, secret = false }: RunCliOptions,
) {
  const command = secret ? `${label} ${args[0] ?? ""} (arguments hidden)` : `${label} ${args.join(" ")}`;

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();

      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) =>
      finish(secret ? new Error(`${command} could not be started.`) : error),
    );
    child.on("exit", (code) => {
      // Give buffered output a moment to arrive before the streams are destroyed.
      setTimeout(() => {
        finish(
          code === 0
            ? undefined
            : new Error(
                secret
                  ? `${command} failed (${code}).`
                  : `${command} failed (${code}): ${(stderr || stdout).trim()}`,
              ),
        );
      }, 50);
    });

    child.stdin.end(stdin ?? "");
  });
}
