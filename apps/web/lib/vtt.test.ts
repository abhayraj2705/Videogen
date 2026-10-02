import { describe, expect, it } from "vitest";
import { vttToPlainText } from "./vtt";

describe("vttToPlainText", () => {
  it("drops header, ids, timings and NOTE blocks", () => {
    const vtt = "WEBVTT\n\nNOTE generated\n\n1\n00:00:00.000 --> 00:00:02.000\nHello there.\n\n2\n00:00:02.000 --> 00:00:04.000\nGeneral Kenobi.\n";
    expect(vttToPlainText(vtt)).toBe("Hello there. General Kenobi.");
  });

  it("strips inline tags and decodes entities", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v Narrator>Capture, sort &amp; search</v> <c.hi>now</c>\n";
    expect(vttToPlainText(vtt)).toBe("Capture, sort & search now");
  });

  it("collapses consecutive duplicate lines and CRLF input", () => {
    const vtt = "WEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\nSame line\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nSame line\r\n";
    expect(vttToPlainText(vtt)).toBe("Same line");
  });

  it("returns empty for a header-only file", () => {
    expect(vttToPlainText("WEBVTT\n")).toBe("");
  });
});
