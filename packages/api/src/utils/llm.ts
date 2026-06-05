/**
 * Shared LLM caller for background workers (distillation & consolidation).
 *
 * Centralises provider selection and enforces a timeout on every request
 * so workers never hang indefinitely waiting for an LLM response.
 */

import { config } from '../config.js';

/**
 * Call the configured LLM provider with the given prompt.
 *
 * @param prompt     The full prompt string to send.
 * @param timeoutMs  Maximum time to wait for a response (default: 2 minutes).
 */
export async function callLLM(prompt: string, timeoutMs = 120_000): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);

  switch (config.distillation.provider) {
    case 'gemini': {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.distillation.model}:generateContent`,
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
          model: config.distillation.model,
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
          model: config.distillation.model,
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
      // ollama (local)
      const res = await fetch(`${config.distillation.ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.distillation.model,
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
