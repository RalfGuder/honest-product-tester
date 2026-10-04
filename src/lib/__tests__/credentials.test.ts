import { describe, expect, it } from "vitest";

import { loginAppliesTo, selectPersonaLogin, type CredentialsFile } from "@/lib/credentials";

describe("loginAppliesTo", () => {
  const loginUrl = "https://staging.example.com/login";

  it("accepts the same host", () => {
    expect(loginAppliesTo(loginUrl, "https://staging.example.com/dashboard")).toBe(true);
  });

  it("ignores host case", () => {
    expect(loginAppliesTo(loginUrl, "https://STAGING.example.com/")).toBe(true);
  });

  it("accepts a parent domain of the login host", () => {
    expect(loginAppliesTo(loginUrl, "https://example.com/")).toBe(true);
  });

  it("accepts a subdomain of the login host", () => {
    expect(loginAppliesTo("https://example.com/login", "https://app.example.com/")).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(loginAppliesTo(loginUrl, "https://other-site.de/")).toBe(false);
  });

  it("rejects hosts that only share a suffix", () => {
    expect(loginAppliesTo("https://example.com/login", "https://notexample.com/")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(loginAppliesTo(loginUrl, "not a url")).toBe(false);
  });
});

describe("selectPersonaLogin", () => {
  const legacyFile = {
    loginUrl: "https://staging.example.com/login",
    usernameSelector: "#email",
    personas: { alice: { username: "alice@staging", password: "pw-a" } },
  };

  const multiSiteFile: CredentialsFile = {
    sites: [
      {
        loginUrl: "https://example.com/login",
        personas: { alice: { username: "alice@root", password: "pw-root" } },
      },
      {
        loginUrl: "https://staging.example.com/login",
        basicAuth: { username: "gate", password: "gate-pw" },
        personas: { alice: { username: "alice@staging", password: "pw-staging" } },
      },
      {
        loginUrl: "https://shop.test/signin",
        personas: {
          alice: { username: "alice@shop", password: "pw-shop" },
          bob: { username: "bob@shop", password: "pw-bob" },
        },
      },
    ],
  };

  it("reads the flat legacy format as a single site", () => {
    const result = selectPersonaLogin(legacyFile, "alice", "https://staging.example.com/");

    expect(result).toEqual({
      kind: "login",
      login: expect.objectContaining({
        loginUrl: "https://staging.example.com/login",
        username: "alice@staging",
        password: "pw-a",
        usernameSelector: "#email",
      }),
    });
  });

  it("picks the site matching the target host", () => {
    const result = selectPersonaLogin(multiSiteFile, "alice", "https://shop.test/products");

    expect(result.kind === "login" && result.login.username).toBe("alice@shop");
  });

  it("prefers the exact host over a parent or subdomain match", () => {
    const staging = selectPersonaLogin(multiSiteFile, "alice", "https://staging.example.com/");
    const root = selectPersonaLogin(multiSiteFile, "alice", "https://example.com/");

    expect(staging.kind === "login" && staging.login.username).toBe("alice@staging");
    expect(staging.kind === "login" && staging.login.basicAuth?.username).toBe("gate");
    expect(root.kind === "login" && root.login.username).toBe("alice@root");
  });

  it("prefers the closest related host when nothing matches exactly", () => {
    const result = selectPersonaLogin(multiSiteFile, "alice", "https://app.staging.example.com/");

    expect(result.kind === "login" && result.login.username).toBe("alice@staging");
  });

  it("reports the configured hosts when no site matches", () => {
    expect(selectPersonaLogin(multiSiteFile, "alice", "https://other-site.de/")).toEqual({
      kind: "otherHost",
      loginHosts: ["example.com", "staging.example.com", "shop.test"],
    });
  });

  it("fails when the matching site has no login for the persona", () => {
    expect(() => selectPersonaLogin(multiSiteFile, "bob", "https://example.com/")).toThrow(
      "No login configured for persona bob on example.com.",
    );
  });

  it("allows the same username on different sites", () => {
    const file = {
      sites: [
        { loginUrl: "https://a.test/login", personas: { alice: { username: "x", password: "1" } } },
        { loginUrl: "https://b.test/login", personas: { alice: { username: "x", password: "2" } } },
      ],
    };

    expect(selectPersonaLogin(file, "alice", "https://b.test/").kind).toBe("login");
  });

  it("rejects a shared username within one site", () => {
    const file = {
      sites: [
        {
          loginUrl: "https://a.test/login",
          personas: {
            alice: { username: "same", password: "1" },
            bob: { username: "Same", password: "2" },
          },
        },
      ],
    };

    expect(() => selectPersonaLogin(file, "alice", "https://a.test/")).toThrow(
      "Personas alice and bob share the same login on a.test.",
    );
  });

  it("rejects a site without loginUrl", () => {
    expect(() => selectPersonaLogin({ sites: [{ personas: {} }] }, "alice", "https://a.test/")).toThrow(
      "Credentials site #1 is missing loginUrl.",
    );
  });
});
