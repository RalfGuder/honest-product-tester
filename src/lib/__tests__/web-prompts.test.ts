import { describe, expect, it } from "vitest";

import { buildMissionPrompt, buildPersonaPrompt } from "@/lib/drivers/web-prompts";
import type { Persona } from "@/lib/personas";
import { EXPLORE_SCENARIO, type Scenario } from "@/lib/scenario-format";

const persona = {
  id: "tester",
  name: "Tester",
  prompt: "You are Tester, a careful person.",
  patience: "low",
} as Persona;

const scenario: Scenario = {
  ...EXPLORE_SCENARIO,
  id: "save-favorite",
  title: "Save a favorite",
  mission: "Save a recipe as a favorite.",
  successCriteria: "The recipe is in the favorites list",
  maxSteps: 12,
};

// Guards the exact web prompt texts while prompt blocks are shared with other drivers.
describe("web prompts", () => {
  it.each([
    ["explore, public", () => buildPersonaPrompt(persona, "https://example.com/", false, "en")],
    ["explore, logged in", () => buildPersonaPrompt(persona, "https://example.com/", true, "de")],
    [
      "mission, submit forbidden",
      () => buildMissionPrompt(persona, scenario, "https://example.com/a", false, undefined),
    ],
    [
      "mission, submit allowed",
      () =>
        buildMissionPrompt(persona, { ...scenario, allowSubmit: true }, "https://example.com/a", true, "de"),
    ],
  ])("%s", (_label, build) => {
    expect(build()).toMatchSnapshot();
  });
});
