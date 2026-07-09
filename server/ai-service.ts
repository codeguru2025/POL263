/**
 * AI-powered note enhancement and data insights, via the Anthropic API.
 * ANTHROPIC_API_KEY stays server-side only. All calls degrade to a clean
 * "not configured" result when the key is unset — callers never crash.
 */

import Anthropic from "@anthropic-ai/sdk";
import { structuredLog } from "./logger";

const AI_MODEL = "claude-opus-4-8";
const AI_NOTE_TIMEOUT_MS = 15_000;
const AI_INSIGHTS_TIMEOUT_MS = 45_000;
const NOT_CONFIGURED_ERROR = "AI features are not configured for this environment.";

let client: Anthropic | null | undefined;

function getAnthropicClient(): Anthropic | null {
  if (client !== undefined) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  client = apiKey ? new Anthropic({ apiKey }) : null;
  return client;
}

type AiResult = { ok: true; text: string } | { ok: false; error: string };

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function friendlyError(err: any): string {
  if (err instanceof Anthropic.RateLimitError) return "AI service is busy right now — please try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Please try again.";
  return "AI request failed. Please try again.";
}

export async function enhanceNote(input: { draftText: string; contextSummary: string }): Promise<AiResult> {
  const c = getAnthropicClient();
  if (!c) return { ok: false, error: NOT_CONFIGURED_ERROR };
  const draft = input.draftText.trim();
  if (!draft) return { ok: false, error: "Enter a draft note first." };
  try {
    const message = await c.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system:
          "You expand short operational notes for an insurance company's daily report into a clear, " +
          "professional entry a manager reviewing the day would find useful. Keep the same facts and tone — " +
          "don't invent numbers or events not implied by the draft or context. Respond with only the improved " +
          "note text, no preamble, no quotation marks.",
        messages: [
          {
            role: "user",
            content: `Today's context:\n${input.contextSummary}\n\nDraft note to expand:\n${draft}`,
          },
        ],
      },
      { timeout: AI_NOTE_TIMEOUT_MS },
    );
    const text = extractText(message);
    if (!text) return { ok: false, error: "AI returned an empty response. Please try again." };
    return { ok: true, text };
  } catch (err: any) {
    structuredLog("error", "AI enhanceNote failed", { error: err?.message });
    return { ok: false, error: friendlyError(err) };
  }
}

export async function generateInsights(input: {
  datasetLabel: string;
  dataJson: unknown;
  question?: string;
}): Promise<AiResult> {
  const c = getAnthropicClient();
  if (!c) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    const message = await c.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 2048,
        output_config: { effort: "high" },
        system: [
          {
            type: "text",
            text:
              "You are an analyst for an insurance company's internal staff tool. You are given a JSON dataset " +
              "for one part of the business. Analyze it, summarize what matters in plain English, flag anything " +
              "unusual (numbers that look off, concerning trends, missing expected activity), and note any " +
              "forward-looking risk or trend worth watching. Be concrete — cite the actual numbers from the data. " +
              "If the data doesn't support a claim, say so rather than guessing. Keep it to a few short paragraphs.",
          },
          {
            // Cache the dataset itself so a follow-up question against the same data reuses the
            // cached prefix instead of repricing it — see shared/prompt-caching.md. Below Opus's
            // ~4096-token minimum this just silently won't cache; no error either way.
            type: "text",
            text: `Dataset (${input.datasetLabel}):\n${JSON.stringify(input.dataJson)}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              input.question?.trim() ||
              "Summarize this data, flag anything unusual, and note any trends worth watching.",
          },
        ],
      },
      { timeout: AI_INSIGHTS_TIMEOUT_MS },
    );
    const text = extractText(message);
    if (!text) return { ok: false, error: "AI returned an empty response. Please try again." };
    return { ok: true, text };
  } catch (err: any) {
    structuredLog("error", "AI generateInsights failed", { error: err?.message, datasetLabel: input.datasetLabel });
    return { ok: false, error: friendlyError(err) };
  }
}
