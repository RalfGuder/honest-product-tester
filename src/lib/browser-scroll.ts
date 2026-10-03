export type ScrollResult = {
  scrolled: "page" | "container" | "none";
  moved: number;
  atEnd: boolean;
  // Visible text at the start of the scrolled container, to tell the model which area moved.
  label?: string;
};

/**
 * Browser-side script for browser_scroll. The page scroll alone misses lists inside dialogs
 * and sidebars, and the snapshot gives those lists no refs. So: with `withinText`, scroll the
 * scrollable area that contains that text; otherwise scroll the page, and if the page cannot
 * move, scroll the largest visible scrollable area instead.
 */
export function buildScrollScript(pixels: number, withinText?: string) {
  return `(() => {
  const dy = ${JSON.stringify(pixels)};
  const withinText = ${JSON.stringify(withinText?.trim() || null)};
  const isScrollable = (el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
  };
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  };
  const atEndOf = (el, down) =>
    down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 1 : el.scrollTop <= 0;
  const result = (scrolled, el, moved) => JSON.stringify({
    scrolled,
    moved: Math.round(moved),
    atEnd: el ? atEndOf(el, dy > 0) : true,
    label: el && el !== document.scrollingElement
      ? (el.innerText || "").trim().split("\\n")[0].slice(0, 60)
      : undefined,
  });

  let target = null;

  if (withinText) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes(withinText)) {
        let el = walker.currentNode.parentElement;
        while (el && !isScrollable(el)) el = el.parentElement;
        if (el) { target = el; break; }
      }
    }
  }

  if (!target) {
    const page = document.scrollingElement;
    const before = page.scrollTop;
    page.scrollBy(0, dy);
    if (page.scrollTop !== before) return result("page", page, page.scrollTop - before);
    target = [...document.querySelectorAll("body *")]
      .filter((el) => isScrollable(el) && isVisible(el))
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
  }

  if (!target) return result("none", null, 0);

  const before = target.scrollTop;
  target.scrollBy(0, dy);
  return result("container", target, target.scrollTop - before);
})()`;
}

/** Tells the model what happened, so it knows when a list has been seen completely. */
export function describeScroll(result: ScrollResult, direction: "up" | "down") {
  const end = direction === "down" ? "bottom" : "top";

  if (result.scrolled === "none") {
    return `Nothing could be scrolled ${direction} any further: everything is already at the ${end}.`;
  }

  const area =
    result.scrolled === "page"
      ? "the page"
      : `the scrollable area starting with "${result.label ?? "?"}"`;

  if (result.moved === 0) {
    return `${area[0].toUpperCase()}${area.slice(1)} is already at the ${end}; there is nothing more ${direction === "down" ? "below" : "above"}.`;
  }

  return `Scrolled ${area} by ${Math.abs(result.moved)}px. ${
    result.atEnd ? `Reached the ${end} of it.` : `There is more content further ${direction}.`
  }`;
}
