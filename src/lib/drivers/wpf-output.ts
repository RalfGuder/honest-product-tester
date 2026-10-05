// Parsers for the text output of agent-wpf. Its --json mode only wraps the same text, so the
// lines are parsed here (structured JSON: RalfGuder/agent-wpf#4).

export type WpfElement = {
  depth: number;
  role: string;
  name?: string;
  ref: string;
  automationId?: string;
  value?: string;
  states: string[];
};

export type WpfWindow = {
  title: string;
  ref: string;
  modal: boolean;
  popup: boolean;
  active: boolean;
};

const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
// - <role> "<name>" [ref=eN] [id=<AutomationId>] value="<value>" [state] ...
const ELEMENT_LINE = new RegExp(
  String.raw`^( *)- (\S+)(?: ${QUOTED})? \[ref=(e\d+)\](?: \[id=([^\]]*)\])?(?: value=${QUOTED})?(.*)$`,
);

function unescape(text: string) {
  return text.replace(/\\(.)/g, (_match, char: string) =>
    char === "n" ? "\n" : char === "r" ? "\r" : char === "t" ? "\t" : char,
  );
}

/** Element lines of a `snapshot` (or `windows`) output; comment and summary lines are skipped. */
export function parseSnapshot(text: string): WpfElement[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = ELEMENT_LINE.exec(line);

    if (!match) {
      return [];
    }

    const [, indent, role, name, ref, automationId, value, rest] = match;

    return [
      {
        depth: indent.length / 2,
        role,
        name: name === undefined ? undefined : unescape(name),
        ref: `@${ref}`,
        automationId: automationId || undefined,
        value: value === undefined ? undefined : unescape(value),
        states: [...rest.matchAll(/\[([a-z]+)\]/g)].map(([, state]) => state),
      },
    ];
  });
}

/** The output of `agent-wpf windows`. */
export function parseWindows(text: string): WpfWindow[] {
  return parseSnapshot(text)
    .filter((element) => element.role === "window")
    .map((element) => ({
      title: element.name ?? "",
      ref: element.ref,
      modal: element.states.includes("modal"),
      popup: element.states.includes("popup"),
      active: element.states.includes("active"),
    }));
}

/**
 * Ref of the element whose AutomationId, or else whose name, equals the selector.
 * agent-wpf only accepts refs, so configured selectors are resolved here (RalfGuder/agent-wpf#3).
 */
export function findElementRef(snapshotText: string, selector: string) {
  const elements = parseSnapshot(snapshotText);

  return (
    elements.find((element) => element.automationId === selector) ??
    elements.find((element) => element.name === selector)
  )?.ref;
}
