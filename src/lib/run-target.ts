// Dependency-free run target model, safe to import from client components.

export type WebTarget = { kind: "web"; url: string };
// Snapshot of the allowlist entry at run start, so later edits do not change a past run.
export type DesktopTarget = {
  kind: "desktop";
  appId: string;
  appName: string;
  exePath: string;
  args: string[];
  workingDir?: string;
};
export type RunTarget = WebTarget | DesktopTarget;

/** What the run form asks for; createRun resolves a desktop app id against the allowlist. */
export type RunTargetInput = { kind: "web"; url: string } | { kind: "desktop"; appId: string };

/** Short, human-readable name of a run target: the URL or the app name. */
export function describeTarget(target: RunTarget) {
  return target.kind === "web" ? target.url : target.appName;
}
