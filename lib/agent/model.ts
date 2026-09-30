// Picks the model from MODEL ("provider:model-id") and prices its tokens.
import { openai } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL = "openai:gpt-6.1-sol";

export function modelSpec(): string {
  return process.env.MODEL || DEFAULT_MODEL;
}

export function getModel(spec: string): LanguageModel {
  const [provider, id] = spec.split(":");
  if (provider === "openai") return openai(id);
  if (provider === "xai") return xai(id);
  throw new Error(`Unknown provider in MODEL=${spec}. Use openai:<model-id> or xai:<model-id>.`);
}

// USD per million tokens (input, output). Public list prices, checked 2026-09-30.
const PRICES: Record<string, [number, number]> = {
  "openai:gpt-6.1-sol": [2, 10],
  "openai:gpt-6-sol": [2, 10],
  "openai:gpt-6-luna": [0.1, 0.5],
};

// Null when the model has no known price (the trace then shows tokens only).
export function costUsd(spec: string, tokensIn: number, tokensOut: number): number | null {
  const price = PRICES[spec];
  if (!price) return null;
  return (tokensIn * price[0] + tokensOut * price[1]) / 1_000_000;
}
