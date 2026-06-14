import { describe, it, expect } from "vitest";
import { ocrResultsToCandidates, mergeOcrCandidates } from "../lib/ocrChannel";

describe("ocrResultsToCandidates", () => {
  it("maps name + score to candidates and clamps confidence to [0,1]", () => {
    const out = ocrResultsToCandidates([
      { name: "Charizard", score: 0.61 },
      { name: "Blastoise", score: 1.7 },
      { name: "Venusaur", score: -0.2 },
    ]);
    expect(out).toEqual([
      { value: "Charizard", conf: 0.61 },
      { value: "Blastoise", conf: 1 },
      { value: "Venusaur", conf: 0 },
    ]);
  });

  it("drops empty names and dedupes case-insensitively, keeping the first", () => {
    const out = ocrResultsToCandidates([
      { name: "Pikachu", score: 0.9 },
      { name: "  ", score: 0.5 },
      { name: "pikachu", score: 0.4 },
      { name: undefined, score: 0.3 },
    ]);
    expect(out).toEqual([{ value: "Pikachu", conf: 0.9 }]);
  });
});

describe("mergeOcrCandidates", () => {
  it("appends OCR candidates not already present and not equal to the primary name", () => {
    const existing = [{ value: "Pikachu", conf: 0.95 }];
    const ocr = [
      { value: "Pikachu", conf: 0.6 }, // dup of existing
      { value: "Raichu", conf: 0.55 }, // primary name
      { value: "Charizard", conf: 0.7 }, // new
    ];
    const merged = mergeOcrCandidates(existing, ocr, "Raichu");
    expect(merged).toEqual([
      { value: "Pikachu", conf: 0.95 },
      { value: "Charizard", conf: 0.7 },
    ]);
  });

  it("handles an undefined existing list", () => {
    const merged = mergeOcrCandidates(undefined, [{ value: "Mewtwo", conf: 0.8 }], "Pikachu");
    expect(merged).toEqual([{ value: "Mewtwo", conf: 0.8 }]);
  });

  it("dedupes OCR candidates against each other (case-insensitive)", () => {
    const merged = mergeOcrCandidates(
      [],
      [
        { value: "Snorlax", conf: 0.7 },
        { value: "snorlax", conf: 0.3 },
      ],
      "Pikachu",
    );
    expect(merged).toEqual([{ value: "Snorlax", conf: 0.7 }]);
  });
});
