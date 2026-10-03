import { describe, expect, it } from "vitest";

import { de } from "@/i18n/dictionaries/de";
import { en } from "@/i18n/dictionaries/en";
import { renderLiveText } from "@/i18n/live";

describe("renderLiveText", () => {
  it("passes plain strings from older runs through unchanged", () => {
    expect(renderLiveText("Persona run started.", de)).toBe("Persona run started.");
  });

  it("translates a message key with parameters", () => {
    expect(renderLiveText({ key: "loggedIn", params: { username: "tom" } }, de)).toBe(
      "Angemeldet als tom.",
    );
    expect(renderLiveText({ key: "loggedIn", params: { username: "tom" } }, en)).toBe(
      "Logged in as tom.",
    );
  });

  it("translates verdict and status parameters", () => {
    expect(renderLiveText({ key: "scenarioFinished", params: { verdict: "gave_up" } }, de)).toBe(
      "Szenario beendet: Aufgegeben.",
    );
  });

  it("translates the title of the built-in free exploration", () => {
    const message = {
      key: "scenarioNamed" as const,
      params: { title: "Free exploration", scenarioId: "explore" },
    };

    expect(renderLiveText(message, de)).toBe("Szenario: Freie Erkundung.");
    expect(
      renderLiveText({ ...message, params: { title: "Checkout", scenarioId: "checkout" } }, de),
    ).toBe("Szenario: Checkout.");
  });

  it("shows unknown keys instead of crashing", () => {
    expect(renderLiveText({ key: "doesNotExist" as never }, en)).toBe("doesNotExist");
  });
});
