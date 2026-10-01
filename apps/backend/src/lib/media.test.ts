import { describe, expect, it } from "vitest";
import { localPathFromFileUrl, parseRangeHeader } from "./media.js";

describe("parseRangeHeader", () => {
  const size = 1000;

  it("serves the whole file without a usable Range header", () => {
    expect(parseRangeHeader(undefined, size)).toBeUndefined();
    expect(parseRangeHeader("bytes=-", size)).toBeUndefined();
    expect(parseRangeHeader("items=0-1", size)).toBeUndefined();
    expect(parseRangeHeader("bytes=0-1,5-9", size)).toBeUndefined();
  });

  it("parses closed, open-ended and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=500-", size)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", size)).toEqual({ start: 900, end: 999 });
    expect(parseRangeHeader("bytes=-5000", size)).toEqual({ start: 0, end: 999 });
  });

  it("clamps the end to the file size", () => {
    expect(parseRangeHeader("bytes=900-5000", size)).toEqual({ start: 900, end: 999 });
  });

  it("flags unsatisfiable ranges", () => {
    expect(parseRangeHeader("bytes=1000-", size)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=10-5", size)).toBe("unsatisfiable");
    expect(parseRangeHeader("bytes=-0", size)).toBe("unsatisfiable");
  });
});

describe("localPathFromFileUrl", () => {
  it("strips the local driver's file:// prefix", () => {
    expect(localPathFromFileUrl("file:///data/renders/a.mp4")).toBe("/data/renders/a.mp4");
    expect(localPathFromFileUrl("file://C:\\data\\renders\\a.mp4")).toBe("C:\\data\\renders\\a.mp4");
    expect(localPathFromFileUrl("https://r2.example/x")).toBeUndefined();
  });
});
