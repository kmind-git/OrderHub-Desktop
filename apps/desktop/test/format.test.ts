import { describe, expect, it } from "vitest";
import { formatBytes, formatNanos, shortId } from "../src/lib/format";

describe("display formatting", () => {
  it("formats byte strings without losing the large-value boundary", () => {
    expect(formatBytes("0")).toBe("0 B");
    expect(formatBytes("1024")).toBe("1.0 KiB");
    expect(formatBytes("87654321")).toBe("83.6 MiB");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("formats Unix nanosecond strings exactly before converting for display", () => {
    const millionMs = formatNanos("1000000000000000000");
    expect(millionMs).toContain("2001");
    expect(formatNanos("not-a-number")).toBe("not-a-number");
    expect(formatNanos(null)).toBe("—");
  });

  it("shortens opaque ids but preserves both ends", () => {
    const id = "O-8123456789012345678-000000000011";
    const shortened = shortId(id, 24);
    expect(shortened.startsWith("O-81234")).toBe(true);
    expect(shortened.endsWith("000011")).toBe(true);
    expect(shortened.length).toBeLessThan(id.length);
  });
});
