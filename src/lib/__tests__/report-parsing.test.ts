import { describe, expect, it, vi } from "vitest";

import { parseWithRepair } from "@/lib/report-parsing";
import { parseCellReport } from "@/lib/scenario-verdict";

const valid = '{"verdict":"passed","quote":"Läuft"}';
const broken = '{"verdict":"passed","frictionPoints":["Klick auf „Senden" ging nicht"]}';

describe("parseWithRepair", () => {
  it("parses valid output without asking for a repair", async () => {
    const repair = vi.fn();
    const result = await parseWithRepair(valid, parseCellReport, repair);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.quote).toBe("Läuft");
    expect(result.attempts).toEqual([valid]);
    expect(repair).not.toHaveBeenCalled();
  });

  it("asks once for corrected JSON and uses it", async () => {
    const repair = vi.fn().mockResolvedValue(valid);
    const result = await parseWithRepair(broken, parseCellReport, repair);

    expect(result.ok).toBe(true);
    expect(result.attempts).toEqual([broken, valid]);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][0]).toMatch(/JSON/);
  });

  it("gives up after the repair also fails", async () => {
    const repair = vi.fn().mockResolvedValue(broken);
    const result = await parseWithRepair(broken, parseCellReport, repair);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/JSON|Expected/);
    expect(result.attempts).toEqual([broken, broken]);
  });

  it("reports the original error when the repair request itself fails", async () => {
    const repair = vi.fn().mockRejectedValue(new Error("session closed"));
    const result = await parseWithRepair(broken, parseCellReport, repair);

    expect(result.ok).toBe(false);
    expect(result.attempts).toEqual([broken]);
  });
});
