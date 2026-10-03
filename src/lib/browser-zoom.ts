export type FocusRect = { x: number; y: number; width: number; height: number };

export type FocusResult = {
  found: boolean;
  rect?: FocusRect;
  viewport?: { width: number; height: number };
  devicePixelRatio?: number;
};

/**
 * Browser-side script for browser_zoom: finds the visible element showing `text`
 * (an exact match wins over a partial one, so "Person 1" does not hit "Person 14")
 * and returns its position in the viewport.
 */
export function buildFocusScript(text: string) {
  return `(() => {
  const text = ${JSON.stringify(text.trim())};
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth;
  };
  const candidates = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const content = node.textContent.trim();
    if (!content.includes(text) || !node.parentElement || !isVisible(node.parentElement)) continue;
    candidates.push({ el: node.parentElement, exact: content === text });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
  const match = candidates[0];
  if (!match) return JSON.stringify({ found: false });
  const rect = match.el.getBoundingClientRect();
  return JSON.stringify({
    found: true,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio: devicePixelRatio,
  });
})()`;
}

/** The screenshot area around the text in device pixels, clamped to the viewport. */
export function toCropRegion(
  rect: FocusRect,
  margin: number,
  viewport: { width: number; height: number },
  devicePixelRatio: number,
) {
  const left = Math.max(0, rect.x - margin);
  const top = Math.max(0, rect.y - margin);
  const right = Math.min(viewport.width, rect.x + rect.width + margin);
  const bottom = Math.min(viewport.height, rect.y + rect.height + margin);

  if (right <= left || bottom <= top) {
    return undefined;
  }

  return {
    left: Math.round(left * devicePixelRatio),
    top: Math.round(top * devicePixelRatio),
    width: Math.round((right - left) * devicePixelRatio),
    height: Math.round((bottom - top) * devicePixelRatio),
  };
}
