import { promises as fs } from "node:fs";
import path from "node:path";

export type BasicAuth = {
  username: string;
  password: string;
};

export type PersonaLogin = {
  loginUrl: string;
  basicAuth?: BasicAuth;
  username: string;
  password: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  loggedInSelector?: string;
};

type CredentialsFile = {
  loginUrl?: string;
  // Shared HTTP Basic Auth gate in front of the site (e.g. a staging proxy).
  basicAuth?: { username?: string; password?: string };
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  // Element that only exists after a successful login; checked after submitting the form.
  loggedInSelector?: string;
  personas?: Record<string, { username?: string; password?: string }>;
};

function getCredentialsPath() {
  return (
    process.env.HPT_CREDENTIALS_FILE ??
    path.join(process.cwd(), "credentials.local.json")
  );
}

async function readCredentialsFile(): Promise<CredentialsFile | undefined> {
  const filePath = getCredentialsPath();
  let raw: string;

  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  try {
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    throw new Error(`Credentials file ${filePath} is not valid JSON.`);
  }
}

function assertUniqueUsernames(personas: CredentialsFile["personas"]) {
  const seen = new Map<string, string>();

  for (const [personaId, entry] of Object.entries(personas ?? {})) {
    const username = entry.username?.trim().toLowerCase();

    if (!username) {
      continue;
    }

    const otherId = seen.get(username);

    if (otherId) {
      throw new Error(
        `Personas ${otherId} and ${personaId} share the same login. Every persona needs its own account.`,
      );
    }

    seen.set(username, personaId);
  }
}

/**
 * Returns the login for a persona, or undefined when no credentials file exists.
 * The file is read on every call so edits apply without restarting the server.
 */
export async function getPersonaLogin(
  personaId: string,
): Promise<PersonaLogin | undefined> {
  const file = await readCredentialsFile();

  if (!file) {
    return undefined;
  }

  if (!file.loginUrl) {
    throw new Error("Credentials file is missing loginUrl.");
  }

  assertUniqueUsernames(file.personas);

  const entry = file.personas?.[personaId];

  if (!entry?.username || !entry.password) {
    throw new Error(`No login configured for persona ${personaId}.`);
  }

  if (file.basicAuth && (!file.basicAuth.username || !file.basicAuth.password)) {
    throw new Error("basicAuth needs both username and password.");
  }

  return {
    loginUrl: file.loginUrl,
    basicAuth: file.basicAuth as BasicAuth | undefined,
    username: entry.username,
    password: entry.password,
    usernameSelector: file.usernameSelector,
    passwordSelector: file.passwordSelector,
    submitSelector: file.submitSelector,
    loggedInSelector: file.loggedInSelector,
  };
}
