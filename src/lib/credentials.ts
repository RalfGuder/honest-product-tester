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

type CredentialsSite = {
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

// Either one site at the top level (original format) or a list of sites, one per host.
export type CredentialsFile = CredentialsSite & {
  sites?: CredentialsSite[];
};

export type PersonaLoginResult =
  | { kind: "none" }
  | { kind: "otherHost"; loginHosts: string[] }
  | { kind: "login"; login: PersonaLogin };

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

function assertUniqueUsernames(personas: CredentialsSite["personas"], host: string) {
  const seen = new Map<string, string>();

  for (const [personaId, entry] of Object.entries(personas ?? {})) {
    const username = entry.username?.trim().toLowerCase();

    if (!username) {
      continue;
    }

    const otherId = seen.get(username);

    if (otherId) {
      throw new Error(
        `Personas ${otherId} and ${personaId} share the same login on ${host}. Every persona needs its own account.`,
      );
    }

    seen.set(username, personaId);
  }
}

function getHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/**
 * A login only applies when the target URL is on the login host, a subdomain of it,
 * or one of its parent domains.
 */
export function loginAppliesTo(loginUrl: string, targetUrl: string) {
  const loginHost = getHost(loginUrl);
  const targetHost = getHost(targetUrl);

  if (!loginHost || !targetHost) {
    return false;
  }

  return (
    loginHost === targetHost ||
    loginHost.endsWith(`.${targetHost}`) ||
    targetHost.endsWith(`.${loginHost}`)
  );
}

// 0 for the exact host, otherwise how many labels the hosts differ by.
function hostDistance(loginUrl: string, targetUrl: string) {
  const loginLabels = getHost(loginUrl)?.split(".").length ?? 0;
  const targetLabels = getHost(targetUrl)?.split(".").length ?? 0;
  return Math.abs(loginLabels - targetLabels);
}

function getSites(file: CredentialsFile): CredentialsSite[] {
  const sites = file.sites ?? [file];

  sites.forEach((site, index) => {
    if (!site.loginUrl) {
      throw new Error(
        file.sites
          ? `Credentials site #${index + 1} is missing loginUrl.`
          : "Credentials file is missing loginUrl.",
      );
    }
  });

  return sites;
}

/**
 * Picks the site whose loginUrl belongs to the target URL and returns the persona's login there.
 * The exact host wins over subdomains and parent domains.
 */
export function selectPersonaLogin(
  file: CredentialsFile,
  personaId: string,
  targetUrl: string,
): PersonaLoginResult {
  const sites = getSites(file);
  const site = sites
    .filter((candidate) => loginAppliesTo(candidate.loginUrl!, targetUrl))
    .sort(
      (left, right) =>
        hostDistance(left.loginUrl!, targetUrl) - hostDistance(right.loginUrl!, targetUrl),
    )[0];

  if (!site) {
    return {
      kind: "otherHost",
      loginHosts: sites.map((candidate) => getHost(candidate.loginUrl!) ?? candidate.loginUrl!),
    };
  }

  const loginUrl = site.loginUrl!;
  const host = getHost(loginUrl) ?? loginUrl;

  assertUniqueUsernames(site.personas, host);

  const entry = site.personas?.[personaId];

  if (!entry?.username || !entry.password) {
    throw new Error(`No login configured for persona ${personaId} on ${host}.`);
  }

  if (site.basicAuth && (!site.basicAuth.username || !site.basicAuth.password)) {
    throw new Error(`basicAuth for ${host} needs both username and password.`);
  }

  return {
    kind: "login",
    login: {
      loginUrl,
      basicAuth: site.basicAuth as BasicAuth | undefined,
      username: entry.username,
      password: entry.password,
      usernameSelector: site.usernameSelector,
      passwordSelector: site.passwordSelector,
      submitSelector: site.submitSelector,
      loggedInSelector: site.loggedInSelector,
    },
  };
}

/**
 * Returns the persona's login for the target URL. The file is read on every call so edits
 * apply without restarting the server.
 */
export async function getPersonaLogin(
  personaId: string,
  targetUrl: string,
): Promise<PersonaLoginResult> {
  const file = await readCredentialsFile();
  return file ? selectPersonaLogin(file, personaId, targetUrl) : { kind: "none" };
}
