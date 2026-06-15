import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseJudgeJson, clampScore, JUDGE_FAILED } from "../lib/eval/judge";

describe("parseJudgeJson", () => {
  it("parses a plain JSON object", () => {
    expect(parseJudgeJson('{"score":5,"reason":"fully grounded"}')).toEqual({
      score: 5,
      reason: "fully grounded",
    });
  });

  it("strips ```json code fences", () => {
    expect(parseJudgeJson('```json\n{"score":2,"reason":"invented"}\n```')).toEqual({
      score: 2,
      reason: "invented",
    });
  });

  it("tolerates surrounding prose", () => {
    const raw = 'Here is my judgement:\n{"score":4,"reason":"ok"}\nDone.';
    expect(parseJudgeJson(raw)).toEqual({ score: 4, reason: "ok" });
  });

  it("returns null for non-JSON / empty / array input", () => {
    expect(parseJudgeJson("")).toBeNull();
    expect(parseJudgeJson("no json here")).toBeNull();
    expect(parseJudgeJson("[1,2,3]")).toBeNull();
  });
});

describe("clampScore", () => {
  it("passes through in-range integers", () => {
    expect(clampScore(1)).toBe(1);
    expect(clampScore(3)).toBe(3);
    expect(clampScore(5)).toBe(5);
  });

  it("clamps out-of-range numbers into 1..5", () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(-4)).toBe(1);
    expect(clampScore(9)).toBe(5);
  });

  it("rounds and accepts numeric strings", () => {
    expect(clampScore(4.4)).toBe(4);
    expect(clampScore("2")).toBe(2);
    expect(clampScore(" 5 ")).toBe(5);
  });

  it("returns null for non-numeric / missing values", () => {
    expect(clampScore("abc")).toBeNull();
    expect(clampScore(undefined)).toBeNull();
    expect(clampScore(null)).toBeNull();
    expect(clampScore(NaN)).toBeNull();
  });
});

describe("judgeGroundedness", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a clamped score + reason from a parsed judge reply", async () => {
    const routed = vi.fn(async () => '{"score":5,"reason":"all claims supported"}');
    vi.doMock("../lib/llm/router", () => ({ chatRouted: routed }));
    const { judgeGroundedness } = await import("../lib/eval/judge");
    const res = await judgeGroundedness({
      context: "Total cards: 10",
      question: "How many cards?",
      answer: "You own 10 cards.",
    });
    expect(res).toEqual({ score: 5, reason: "all claims supported" });
    expect(routed).toHaveBeenCalledTimes(1);
  });

  it("clamps an out-of-range score from the model", async () => {
    const routed = vi.fn(async () => '{"score":9,"reason":"x"}');
    vi.doMock("../lib/llm/router", () => ({ chatRouted: routed }));
    const { judgeGroundedness } = await import("../lib/eval/judge");
    const res = await judgeGroundedness({ context: "c", question: "q", answer: "a" });
    expect(res.score).toBe(5);
  });

  it("scores a grounded answer higher than a hallucinated one (mocked)", async () => {
    // The mocked judge keys off the answer text so we can assert ordering
    // without a real LLM.
    const routed = vi.fn(async (messages: { content: string }[]) => {
      const user = messages[messages.length - 1].content;
      return user.includes("INVENTED")
        ? '{"score":1,"reason":"fabricated facts"}'
        : '{"score":5,"reason":"grounded"}';
    });
    vi.doMock("../lib/llm/router", () => ({ chatRouted: routed }));
    const { judgeGroundedness } = await import("../lib/eval/judge");
    const grounded = await judgeGroundedness({
      context: "Total cards: 10",
      question: "How many?",
      answer: "You own 10 cards.",
    });
    const hallucinated = await judgeGroundedness({
      context: "Total cards: 10",
      question: "How many?",
      answer: "You own 999 cards. INVENTED",
    });
    expect(grounded.score).toBeGreaterThan(hallucinated.score);
  });

  it("returns the sentinel (score 0) when the judge throws", async () => {
    const routed = vi.fn(async () => {
      throw new Error("no provider");
    });
    vi.doMock("../lib/llm/router", () => ({ chatRouted: routed }));
    const { judgeGroundedness } = await import("../lib/eval/judge");
    const res = await judgeGroundedness({ context: "c", question: "q", answer: "a" });
    expect(res).toEqual(JUDGE_FAILED);
    expect(res.score).toBe(0);
  });

  it("returns the sentinel when the reply has no usable score", async () => {
    const routed = vi.fn(async () => "I cannot evaluate this.");
    vi.doMock("../lib/llm/router", () => ({ chatRouted: routed }));
    const { judgeGroundedness } = await import("../lib/eval/judge");
    const res = await judgeGroundedness({ context: "c", question: "q", answer: "a" });
    expect(res.score).toBe(0);
  });
});
