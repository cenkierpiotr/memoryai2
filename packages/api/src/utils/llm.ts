/**
 * Shared LLM caller for background workers (distillation & consolidation).
 *
 * Resilience chain:
 *   1. Primary provider (callLLM)
 *   2. Fallback provider (DISTILL_FALLBACK_PROVIDER, if configured)
 *   3. Emergency rule-based extraction (never throws)
 */

import { config } from '../config.js';

type Provider = 'ollama' | 'gemini' | 'openai' | 'anthropic';

async function callProvider(
  provider: Provider,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);

  switch (provider) {
    case 'gemini': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.distillation.geminiApiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 },
          }),
          signal,
        }
      );
      if (!res.ok) throw new Error(`Gemini LLM call failed: ${res.status}`);
      const data = await res.json() as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      return data.candidates[0]?.content.parts[0]?.text ?? '';
    }

    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.distillation.openaiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
        signal,
      });
      if (!res.ok) throw new Error(`OpenAI LLM call failed: ${res.status}`);
      const data = await res.json() as { choices: Array<{ message: { content: string } }> };
      return data.choices[0]?.message.content ?? '';
    }

    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.distillation.anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Anthropic LLM call failed: ${res.status}`);
      const data = await res.json() as { content: Array<{ text: string }> };
      return data.content[0]?.text ?? '';
    }

    default: {
      // ollama
      const res = await fetch(`${config.distillation.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.1 },
        }),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama LLM call failed: ${res.status}`);
      const data = await res.json() as { response: string };
      return data.response;
    }
  }
}

export async function callLLM(prompt: string, timeoutMs = 120_000): Promise<string> {
  return callProvider(
    config.distillation.provider as Provider,
    config.distillation.model,
    prompt,
    timeoutMs,
  );
}

/**
 * Calls the primary LLM; on failure tries the fallback provider (if configured).
 * Always resolves — returns empty string only when both fail.
 */
export async function callLLMWithFallback(prompt: string, timeoutMs = 120_000): Promise<string> {
  try {
    return await callProvider(
      config.distillation.provider as Provider,
      config.distillation.model,
      prompt,
      timeoutMs,
    );
  } catch (primaryErr) {
    const fb = config.distillation.fallbackProvider;
    if (fb) {
      process.stderr.write(`[llm] primary failed (${(primaryErr as Error).message}), trying fallback ${fb}\n`);
      try {
        return await callProvider(
          fb as Provider,
          config.distillation.fallbackModel,
          prompt,
          timeoutMs,
        );
      } catch (fbErr) {
        process.stderr.write(`[llm] fallback also failed: ${(fbErr as Error).message}\n`);
      }
    } else {
      process.stderr.write(`[llm] primary failed (${(primaryErr as Error).message}), no fallback configured\n`);
    }
    return '';
  }
}
