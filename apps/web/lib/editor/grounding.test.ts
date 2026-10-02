import { describe, expect, it } from "vitest";
import type { FactLedger } from "@sitereel/shared";
import { factGrounds, groundNarration, groundText, normalizeText, sourceLabel, unknownFactIds } from "./grounding";

const ledger: FactLedger = [
  { id: "f1", kind: "feature", text: "Automatic transcription in 30 languages", sourceUrl: "https://acme.io/features", selector: "a" },
  { id: "f2", kind: "stat", text: "Trusted by 12,000 teams", sourceUrl: "https://acme.io/", selector: "b" },
  { id: "f3", kind: "feature", text: "Smart summaries after every call", sourceUrl: "https://acme.io/features", selector: "c" },
];

describe("fact badges", () => {
  it("normalizes case, punctuation and thousands separators", () => {
    expect(normalizeText("  Trusted — by 12,000 TEAMS! ")).toBe("trusted by 12 000 teams");
  });

  it("grounds verbatim / substring text against a cited fact", () => {
    const g = groundText("Transcription in 30 languages", ["f1"], ledger);
    expect(g.status).toBe("grounded");
    expect(g.facts.map((f) => f.id)).toEqual(["f1"]);
  });

  it("grounds paraphrases by content-word overlap", () => {
    expect(factGrounds("Smart call summaries", ledger[2]!)).toBe(true);
  });

  it("only considers facts the scene cites", () => {
    expect(groundText("Transcription in 30 languages", ["f2"], ledger).status).toBe("unverified");
  });

  it("flags numbers that are not in the fact", () => {
    expect(groundText("Trusted by 15,000 teams", ["f2"], ledger).status).toBe("unverified");
    expect(groundText("Trusted by 12,000 teams", ["f2"], ledger).status).toBe("grounded");
    expect(groundText("Best-rated in 2025", ["f2"], ledger).status).toBe("unverified");
  });

  it("marks unrelated user copy unverified", () => {
    expect(groundText("The fastest app on earth", ["f1", "f2", "f3"], ledger).status).toBe("unverified");
  });

  it("grounds narration against the union of cited facts", () => {
    const g = groundNarration("Automatic transcription and smart summaries after every call.", ["f1", "f3"], ledger);
    expect(g.status).toBe("grounded");
    expect(g.facts.map((f) => f.id).sort()).toEqual(["f1", "f3"]);
    expect(groundNarration("Anything", [], ledger).status).toBe("unverified");
  });

  it("finds unknown fact ids and labels sources", () => {
    expect(unknownFactIds(["f1", "nope"], ledger)).toEqual(["nope"]);
    expect(sourceLabel("https://acme.io/features/")).toBe("/features");
    expect(sourceLabel("https://acme.io/")).toBe("acme.io");
  });
});
