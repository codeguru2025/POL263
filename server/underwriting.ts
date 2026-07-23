/**
 * Applicant risk assessment (Phase 3c of the multi-vertical platform work). A product version
 * carries its own configurable question set (shared/schema.ts's productVersions.underwritingQuestions);
 * each answer option declares its own outcome, so evaluation is a straightforward "worst outcome
 * wins" fold — no separate scoring/threshold model to configure or explain. Products that don't
 * opt in via requiresUnderwriting never call this at all (see server/routes.ts POST /api/policies).
 */

export type UnderwritingOutcome = "accept" | "rate_up" | "decline";

export interface UnderwritingQuestionOption {
  value: string;
  label: string;
  outcome: UnderwritingOutcome;
  /** Only meaningful when outcome === "rate_up"; percentage added to the base premium. */
  loadingPercent?: number;
}

export interface UnderwritingQuestion {
  id: string;
  text: string;
  options: UnderwritingQuestionOption[];
}

export interface TriggeredAnswer {
  questionId: string;
  questionText: string;
  selectedValue: string;
  outcome: UnderwritingOutcome;
  loadingPercent?: number;
}

export interface UnderwritingEvaluationResult {
  status: "accepted" | "rated_up" | "declined";
  /** Sum of all triggered rate_up loadings; 0 for accepted/declined. */
  loadingPercent: number;
  triggeredQuestions: TriggeredAnswer[];
}

/** Pure — no DB access. Unanswered or unrecognized questions/options are silently skipped rather
 *  than treated as a decline, so a partially-configured question set never blocks an applicant. */
export function evaluateUnderwriting(
  questions: UnderwritingQuestion[] | null | undefined,
  answers: Record<string, string> | null | undefined,
): UnderwritingEvaluationResult {
  const triggeredQuestions: TriggeredAnswer[] = [];
  let worstOutcome: UnderwritingOutcome = "accept";
  let loadingPercent = 0;

  for (const q of questions || []) {
    const selectedValue = (answers || {})[q.id];
    if (selectedValue == null) continue;
    const option = q.options?.find((o) => o.value === selectedValue);
    if (!option) continue;

    if (option.outcome === "decline") {
      worstOutcome = "decline";
      triggeredQuestions.push({ questionId: q.id, questionText: q.text, selectedValue, outcome: option.outcome });
    } else if (option.outcome === "rate_up") {
      if (worstOutcome === "accept") worstOutcome = "rate_up";
      loadingPercent += Number(option.loadingPercent ?? 0);
      triggeredQuestions.push({
        questionId: q.id, questionText: q.text, selectedValue, outcome: option.outcome,
        loadingPercent: option.loadingPercent,
      });
    }
  }

  return {
    status: worstOutcome === "decline" ? "declined" : worstOutcome === "rate_up" ? "rated_up" : "accepted",
    loadingPercent: worstOutcome === "decline" ? 0 : loadingPercent,
    triggeredQuestions,
  };
}
