import { env } from '../config/env.js';

/**
 * LLM service.
 *
 * A single wrapper behind which the real provider (Anthropic / Gemini) and a
 * mock mode live. Agent code calls `promptJSON()` and gets back Zod-parsed
 * JSON — never raw text.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  Why a wrapper?                                                     │
 * │  • Switch providers with one env var (LLM_PROVIDER + LLM_MODEL).    │
 * │  • All tests and the offline demo use LLM_MODE=mock — deterministic │
 * │    outputs, no API key needed.                                      │
 * │  • Zod validation + one retry live here, not in every agent.        │
 * │  • The LLM key never leaves this file.                              │
 * └──────────────────────────────────────────────────────────────────────┘
 */

// ── Config ───────────────────────────────────────────────────────────────────

const LLM_MODE = process.env.LLM_MODE || 'mock';
const LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const LLM_MODEL = process.env.LLM_MODEL || '';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

// ── Live provider calls ──────────────────────────────────────────────────────

async function callAnthropic(systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': LLM_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text ?? '';
}

async function callGemini(systemPrompt, userPrompt) {
  const model = LLM_MODEL || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${LLM_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function callLive(systemPrompt, userPrompt) {
  if (LLM_PROVIDER === 'gemini') return callGemini(systemPrompt, userPrompt);
  return callAnthropic(systemPrompt, userPrompt);
}

// ── Mock provider ────────────────────────────────────────────────────────────

// Registry keyed by agent name (set by the agents themselves).
const mockResponses = {};

/**
 * Register a deterministic mock response for an agent (used by each agent
 * module so all mock data lives close to the agent that defines it).
 */
export function registerMock(agentName, fn) {
  mockResponses[agentName] = fn;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a structured prompt to the LLM (or mock) and return parsed+validated
 * JSON. If validation fails, retries ONCE with the error appended.
 *
 * @param {object}  opts
 * @param {string}  opts.agent       Agent name (for logging and mock lookup).
 * @param {string}  opts.system      System prompt.
 * @param {string}  opts.user        User prompt (data from DB, never inventions).
 * @param {import('zod').ZodSchema} opts.schema  Expected output shape.
 * @param {object}  [opts.context]   Extra context passed to mock function.
 * @returns {Promise<{data: any, raw: string}>}
 */
export async function promptJSON({ agent, system, user, schema, context }) {
  // Mock mode — deterministic, no API key.
  if (LLM_MODE === 'mock') {
    const mockFn = mockResponses[agent];
    if (!mockFn) {
      throw new Error(`No mock registered for agent "${agent}". Register one with registerMock().`);
    }
    const mockData = mockFn(context);
    const parsed = schema.parse(mockData);
    return { data: parsed, raw: JSON.stringify(mockData) };
  }

  // Live mode — call the real provider.
  const fullSystem = `${system}\n\nIMPORTANT: respond with valid JSON only, no markdown fences, no extra text.`;

  let raw = await callLive(fullSystem, user);
  // Strip markdown code fences if present.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Retry once with the parsing error.
    const retryPrompt = `${user}\n\n[SYSTEM: Your previous response was not valid JSON. Please respond with ONLY valid JSON, no extra text.]`;
    raw = await callLive(fullSystem, retryPrompt);
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(raw); // if this throws, the caller's try/catch handles it
  }

  // Zod validation with one retry.
  const result = schema.safeParse(parsed);
  if (result.success) {
    return { data: result.data, raw };
  }

  // Retry with the validation error message appended.
  const zodErrors = JSON.stringify(result.error.flatten());
  const retryPrompt = `${user}\n\n[SYSTEM: Your previous JSON output failed validation:\n${zodErrors}\nPlease fix and respond with valid JSON only.]`;
  const retryRaw = await callLive(fullSystem, retryPrompt);
  const retryClean = retryRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const retryParsed = JSON.parse(retryClean);
  const retryResult = schema.safeParse(retryParsed);
  if (retryResult.success) {
    return { data: retryResult.data, raw: retryClean };
  }

  // Two failures — throw so the agent can escalate.
  throw new Error(`LLM output failed Zod validation after retry: ${JSON.stringify(retryResult.error.flatten())}`);
}
