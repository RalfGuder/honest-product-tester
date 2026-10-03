export type ParseOutcome<T> =
  | { ok: true; value: T; attempts: string[] }
  | { ok: false; error: Error; attempts: string[] };

// Added to every JSON report prompt: German answers tend to close „…" with an ASCII quote,
// which breaks the JSON string.
export const JSON_STRING_RULE =
  "- Never put the ASCII double quote character inside a JSON string value; write „…“ or '…' instead.";

/**
 * Parses the persona's final answer. If it is not valid, asks the persona once for corrected
 * JSON via `requestRepair`, so a long browsing session is not lost to a typo in the report.
 */
export async function parseWithRepair<T>(
  rawText: string,
  parse: (text: string) => T,
  requestRepair: (errorMessage: string) => Promise<string>,
): Promise<ParseOutcome<T>> {
  const attempts = [rawText];

  try {
    return { ok: true, value: parse(rawText), attempts };
  } catch (firstError) {
    const error = toError(firstError);
    let repaired: string;

    try {
      repaired = await requestRepair(error.message);
    } catch {
      return { ok: false, error, attempts };
    }

    attempts.push(repaired);

    try {
      return { ok: true, value: parse(repaired), attempts };
    } catch (secondError) {
      return { ok: false, error: toError(secondError), attempts };
    }
  }
}

export function buildRepairPrompt(errorMessage: string) {
  return `Your last answer was not valid JSON (${errorMessage}). Do not call any tools. Return only the corrected JSON in exactly the requested shape, nothing else. Never put the ASCII double quote character inside a string value.`;
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
