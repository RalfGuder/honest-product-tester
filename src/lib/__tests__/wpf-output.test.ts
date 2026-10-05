import { describe, expect, it } from "vitest";

import { findElementRef, parseSnapshot, parseWindows } from "@/lib/drivers/wpf-output";

// Real output of agent-wpf 0.1.0 against a WPF login window.
const loginSnapshot = `- window "RIB TC Framework 2.0.0" [ref=e1] [id=MainWindow] [focused]
  - menuitem "Systemmenü" [ref=e2] [collapsed]
  - button "Schließen" [ref=e5] [id=Close]
  - edit [ref=e6] [id=Login.Username] value="s-lierka"
  - edit [ref=e7] [id=Login.Password] value="***"
  - checkbox "Anmeldedaten merken" [ref=e8] [id=Login.RememberMe] [checked]
  - button "Login" [ref=e9] [id=Login.Submit]
  - hyperlink " " [ref=e10] [id=Login.FooterLink]`;

describe("parseSnapshot", () => {
  it("reads role, name, ref, id, value, states and depth", () => {
    const elements = parseSnapshot(loginSnapshot);

    expect(elements).toHaveLength(8);
    expect(elements[0]).toEqual({
      depth: 0,
      role: "window",
      name: "RIB TC Framework 2.0.0",
      ref: "@e1",
      automationId: "MainWindow",
      value: undefined,
      states: ["focused"],
    });
    expect(elements[3]).toMatchObject({
      depth: 1,
      role: "edit",
      name: undefined,
      automationId: "Login.Username",
      value: "s-lierka",
    });
    expect(elements[5].states).toEqual(["checked"]);
  });

  it("unescapes quoted names and values", () => {
    const [element] = parseSnapshot(String.raw`- text "Say \"hi\"\nC:\\temp" [ref=e3] value="a\tb"`);

    expect(element.name).toBe('Say "hi"\nC:\\temp');
    expect(element.value).toBe("a\tb");
  });

  it("skips comment and summary lines", () => {
    const text = [
      '# 2 windows; showing "Fehler" (modal). Run windows to list them.',
      '- window "Fehler" [ref=e9] [id=ErrorDialog]',
      "  - (12 more items, virtualized; use table or scroll)",
      "# popup",
    ].join("\r\n");

    expect(parseSnapshot(text).map((element) => element.ref)).toEqual(["@e9"]);
  });
});

describe("parseWindows", () => {
  it("reads titles and flags", () => {
    const text = [
      '- window "Main" [ref=e1]',
      '- window "Speichern unter" [ref=e20] [modal] [active]',
      '- window "Menu" [ref=e31] [popup]',
    ].join("\n");

    expect(parseWindows(text)).toEqual([
      { title: "Main", ref: "@e1", modal: false, popup: false, active: false },
      { title: "Speichern unter", ref: "@e20", modal: true, popup: false, active: true },
      { title: "Menu", ref: "@e31", modal: false, popup: true, active: false },
    ]);
  });

  it("returns nothing for an app without windows", () => {
    expect(parseWindows("no windows\n")).toEqual([]);
  });
});

describe("findElementRef", () => {
  it("finds an element by AutomationId", () => {
    expect(findElementRef(loginSnapshot, "Login.Password")).toBe("@e7");
  });

  it("falls back to the element name", () => {
    expect(findElementRef(loginSnapshot, "Login")).toBe("@e9");
  });

  it("prefers the AutomationId over a name", () => {
    const text = '- button "Close" [ref=e2]\n- button "X" [ref=e3] [id=Close]';

    expect(findElementRef(text, "Close")).toBe("@e3");
  });

  it("returns undefined when nothing matches", () => {
    expect(findElementRef(loginSnapshot, "Login.Domain")).toBeUndefined();
  });
});
