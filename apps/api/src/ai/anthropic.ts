import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ModelPort } from './review.js';
import { reviewSchema } from './schema.js';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class ModelCallError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ModelCallError';
  }
}

type ErrorShape = { status?: unknown; type?: unknown; error?: { type?: unknown } | null; message?: unknown; name?: unknown };

const isOverload = (e: unknown) => {
  const shape = e as ErrorShape | null;
  const type = shape?.type ?? shape?.error?.type;
  const message = shape?.message;
  return type === 'overloaded_error' || (typeof message === 'string' && /overload/i.test(message));
};

export function isRetryableModelError(e: unknown): boolean {
  if (e instanceof ModelCallError) return e.retryable;
  const shape = e as ErrorShape | null;
  if (e instanceof z.ZodError || shape?.name === 'ZodError') return false;
  if (isOverload(e)) return true;
  const name = shape?.name;
  if (name === 'APIConnectionError' || name === 'APITimeoutError' || name === 'APIConnectionTimeoutError') return true;
  const status = shape?.status;
  return typeof status === 'number' && (status === 429 || status >= 500);
}

export function isPermanentModelError(e: unknown): boolean {
  if (e instanceof ModelCallError) return !e.retryable;
  const shape = e as ErrorShape | null;
  if (e instanceof z.ZodError || shape?.name === 'ZodError') return true;
  if (isOverload(e)) return false;
  const status = shape?.status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

const modelCallError = (e: unknown) => new ModelCallError(e instanceof Error ? e.message : String(e), isRetryableModelError(e));

/** Structured output via forced tool use. Not exercised against the real API yet (needs ANTHROPIC_API_KEY). */
export function anthropicModel(apiKey: string, model = DEFAULT_MODEL): ModelPort {
  const client = new Anthropic({ apiKey });
  const input_schema = z.toJSONSchema(reviewSchema) as Anthropic.Tool.InputSchema;
  return {
    async complete(system, user) {
      try {
        const res = await client.messages.create({
          model, max_tokens: 2048, system,
          tools: [{ name: 'submit_review', description: 'Submit the structured advisory review.', input_schema }],
          tool_choice: { type: 'tool', name: 'submit_review' },
          messages: [{ role: 'user', content: user }],
        });
        const block = res.content.find((b) => b.type === 'tool_use');
        return { output: block && block.type === 'tool_use' ? block.input : undefined, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      } catch (e) {
        throw modelCallError(e);
      }
    },
  };
}
