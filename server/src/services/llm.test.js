import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { promptJSON, registerMock } from './llm.js';

describe('LLM Service (llm.js)', () => {
  it('returns valid parsed JSON from registered mock in mock mode', async () => {
    registerMock('test-agent', (ctx) => ({
      message: `Hello ${ctx.name}`,
      score: 95,
    }));

    const schema = z.object({
      message: z.string(),
      score: z.number().min(0).max(100),
    });

    const result = await promptJSON({
      agent: 'test-agent',
      system: 'Test system prompt',
      user: 'Test user prompt',
      schema,
      context: { name: 'World' },
    });

    expect(result.data).toEqual({ message: 'Hello World', score: 95 });
    expect(result.raw).toContain('Hello World');
  });

  it('throws when mock data fails Zod validation', async () => {
    registerMock('bad-mock', () => ({
      score: 'not-a-number',
    }));

    const schema = z.object({ score: z.number() });

    await expect(
      promptJSON({
        agent: 'bad-mock',
        system: 'sys',
        user: 'usr',
        schema,
      }),
    ).rejects.toThrow();
  });

  it('throws error when no mock is registered for an agent', async () => {
    const schema = z.object({ ok: z.boolean() });

    await expect(
      promptJSON({
        agent: 'unregistered-agent-xyz',
        system: 'sys',
        user: 'usr',
        schema,
      }),
    ).rejects.toThrow(/No mock registered/);
  });
});
