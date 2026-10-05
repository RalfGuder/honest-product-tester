import { promises as fs } from "node:fs";
import path from "node:path";

import { APP_ID_PATTERN } from "@/lib/scenario-model";

/** A desktop app personas may test. Only apps in the allowlist file can be started. */
export type DesktopApp = {
  id: string;
  name: string;
  exePath: string;
  defaultArgs: string[];
  workingDir?: string;
};

function getDesktopAppsPath() {
  return (
    process.env.HPT_DESKTOP_APPS_FILE ??
    path.join(process.cwd(), "desktop-apps.local.json")
  );
}

/** Validates the allowlist file content; throws with the offending entry on bad input. */
export function parseDesktopApps(raw: unknown, source = "desktop apps file"): DesktopApp[] {
  const entries = (raw as { apps?: unknown })?.apps;

  if (!Array.isArray(entries)) {
    throw new Error(`${source} needs an "apps" array.`);
  }

  const seen = new Set<string>();

  return entries.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = `${source}, app #${index + 1}`;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const exePath = typeof item.exePath === "string" ? item.exePath.trim() : "";

    if (!APP_ID_PATTERN.test(id)) {
      throw new Error(`${label}: "id" must use only a-z, 0-9 and hyphens.`);
    }

    if (seen.has(id)) {
      throw new Error(`${label}: id "${id}" is used twice.`);
    }

    seen.add(id);

    if (!exePath || !path.isAbsolute(exePath)) {
      throw new Error(`${label} (${id}): "exePath" must be an absolute path.`);
    }

    if (
      item.defaultArgs !== undefined &&
      (!Array.isArray(item.defaultArgs) ||
        !item.defaultArgs.every((arg) => typeof arg === "string"))
    ) {
      throw new Error(`${label} (${id}): "defaultArgs" must be a list of strings.`);
    }

    if (item.workingDir !== undefined && typeof item.workingDir !== "string") {
      throw new Error(`${label} (${id}): "workingDir" must be a string.`);
    }

    return {
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
      exePath,
      defaultArgs: (item.defaultArgs as string[] | undefined) ?? [],
      workingDir: item.workingDir?.trim() || undefined,
    };
  });
}

/**
 * All allowlisted desktop apps; none when the file does not exist. The file is read on
 * every call so edits apply without restarting the server.
 */
export async function getDesktopApps(): Promise<DesktopApp[]> {
  const filePath = getDesktopAppsPath();
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Desktop apps file ${filePath} is not valid JSON.`);
  }

  return parseDesktopApps(parsed, filePath);
}

export async function getDesktopApp(appId: string) {
  return (await getDesktopApps()).find((app) => app.id === appId);
}
