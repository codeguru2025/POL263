import { describe, it, expect } from "vitest";
import { evaluateUnderwriting, type UnderwritingQuestion } from "../../server/underwriting";

const SMOKER_Q: UnderwritingQuestion = {
  id: "smoker",
  text: "Do you smoke?",
  options: [
    { value: "no", label: "No", outcome: "accept" },
    { value: "yes", label: "Yes", outcome: "rate_up", loadingPercent: 15 },
  ],
};

const TERMINAL_ILLNESS_Q: UnderwritingQuestion = {
  id: "terminal_illness",
  text: "Have you been diagnosed with a terminal illness?",
  options: [
    { value: "no", label: "No", outcome: "accept" },
    { value: "yes", label: "Yes", outcome: "decline" },
  ],
};

const CHRONIC_CONDITION_Q: UnderwritingQuestion = {
  id: "chronic",
  text: "Do you have a chronic condition?",
  options: [
    { value: "none", label: "None", outcome: "accept" },
    { value: "managed", label: "Managed with medication", outcome: "rate_up", loadingPercent: 10 },
    { value: "unmanaged", label: "Unmanaged", outcome: "decline" },
  ],
};

describe("evaluateUnderwriting — no questions or no answers", () => {
  it("accepts with zero loading when there are no questions configured", () => {
    const result = evaluateUnderwriting([], {});
    expect(result).toEqual({ status: "accepted", loadingPercent: 0, triggeredQuestions: [] });
  });

  it("accepts when questions exist but none were answered", () => {
    const result = evaluateUnderwriting([SMOKER_Q], {});
    expect(result.status).toBe("accepted");
    expect(result.triggeredQuestions).toEqual([]);
  });

  it("treats null questions/answers as empty rather than throwing", () => {
    expect(evaluateUnderwriting(null, null)).toEqual({ status: "accepted", loadingPercent: 0, triggeredQuestions: [] });
  });
});

describe("evaluateUnderwriting — accept path", () => {
  it("accepts when every answered question resolves to accept", () => {
    const result = evaluateUnderwriting([SMOKER_Q, TERMINAL_ILLNESS_Q], { smoker: "no", terminal_illness: "no" });
    expect(result.status).toBe("accepted");
    expect(result.loadingPercent).toBe(0);
    expect(result.triggeredQuestions).toEqual([]);
  });
});

describe("evaluateUnderwriting — rate_up path", () => {
  it("rates up and reports the loading for a single triggered question", () => {
    const result = evaluateUnderwriting([SMOKER_Q], { smoker: "yes" });
    expect(result.status).toBe("rated_up");
    expect(result.loadingPercent).toBe(15);
    expect(result.triggeredQuestions).toEqual([
      { questionId: "smoker", questionText: "Do you smoke?", selectedValue: "yes", outcome: "rate_up", loadingPercent: 15 },
    ]);
  });

  it("sums loading across multiple triggered rate_up questions", () => {
    const result = evaluateUnderwriting([SMOKER_Q, CHRONIC_CONDITION_Q], { smoker: "yes", chronic: "managed" });
    expect(result.status).toBe("rated_up");
    expect(result.loadingPercent).toBe(25);
    expect(result.triggeredQuestions).toHaveLength(2);
  });
});

describe("evaluateUnderwriting — decline path", () => {
  it("declines outright regardless of other accept/rate_up answers", () => {
    const result = evaluateUnderwriting(
      [SMOKER_Q, TERMINAL_ILLNESS_Q],
      { smoker: "yes", terminal_illness: "yes" },
    );
    expect(result.status).toBe("declined");
    expect(result.loadingPercent).toBe(0);
  });

  it("a decline anywhere wins over rate_up loadings elsewhere, even when decline is answered first", () => {
    const result = evaluateUnderwriting(
      [TERMINAL_ILLNESS_Q, SMOKER_Q],
      { terminal_illness: "yes", smoker: "yes" },
    );
    expect(result.status).toBe("declined");
    expect(result.loadingPercent).toBe(0);
  });
});

describe("evaluateUnderwriting — malformed input tolerance", () => {
  it("skips an answer that doesn't match any configured option", () => {
    const result = evaluateUnderwriting([SMOKER_Q], { smoker: "maybe" });
    expect(result.status).toBe("accepted");
    expect(result.triggeredQuestions).toEqual([]);
  });

  it("skips an answer keyed to a question id that isn't configured", () => {
    const result = evaluateUnderwriting([SMOKER_Q], { nonexistent_question: "yes" });
    expect(result.status).toBe("accepted");
  });
});
