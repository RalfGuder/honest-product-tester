const KEPT_ATTRIBUTES = ["class", "title", "aria-label", "alt", "role", "href"];
const MAX_HTML_LENGTH = 2500;

/**
 * Browser-side script for browser_inspect: returns the markup around a visible text, reduced
 * to tags, classes and descriptive attributes. Reveals state that is only visual or hidden from
 * the accessibility tree (e.g. presence dots inside an aria-hidden avatar).
 */
export function buildInspectScript(text: string) {
  return `(() => {
  const text = ${JSON.stringify(text.trim())};
  const kept = ${JSON.stringify(KEPT_ATTRIBUTES)};
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = node.textContent.trim();
    if (!content.includes(text) || !node.parentElement) continue;
    candidates.push({ el: node.parentElement, exact: content === text });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
  if (!candidates[0]) return JSON.stringify({ found: false, count: 0 });

  // Climb from the text to the enclosing row (e.g. avatar + name + role), but stop before
  // the container also holds neighbouring rows.
  let row = candidates[0].el;
  while (row.parentElement && row.parentElement !== document.body &&
    row.parentElement.innerText.trim().length <= text.length + 60) {
    row = row.parentElement;
  }

  const clone = row.cloneNode(true);
  clone.querySelectorAll("script, style, svg path").forEach((el) => el.remove());
  for (const el of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of [...el.attributes]) {
      if (!kept.includes(attribute.name) && !attribute.name.startsWith("data-")) {
        el.removeAttribute(attribute.name);
      }
    }
  }
  const html = clone.outerHTML.replace(/<!--.*?-->/g, "").replace(/\\s+/g, " ");
  return JSON.stringify({
    found: true,
    count: candidates.length,
    html: html.length > ${MAX_HTML_LENGTH} ? html.slice(0, ${MAX_HTML_LENGTH}) + " …" : html,
  });
})()`;
}

export type InspectResult = { found: boolean; count: number; html?: string };

export function describeInspect(text: string, result: InspectResult) {
  if (!result.found || !result.html) {
    return `"${text}" was not found on the page.`;
  }

  const others = result.count > 1 ? ` (${result.count} places contain this text; showing the best match)` : "";

  return `Markup around "${text}"${others}:\n${result.html}`;
}
