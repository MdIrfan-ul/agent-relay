import type { LlmClient, LlmResponse, Message, ToolSpec } from './llm.types';

interface Options {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}

type WireMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface WireToolCall {
  id?: string;
  function: { name: string; arguments?: unknown };
}

interface WireResponse {
  choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toWire(m: Message): WireMessage {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      };
    case 'user':
      return { role: 'user', content: m.content };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (isPlainObject(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) return parsed;
    } catch {
      // fall through: the tool will report bad arguments back to the model
    }
  }
  return {};
}

export class OpenAiCompatLlmClient implements LlmClient {
  constructor(private readonly opts: Options) {}

  async generate(messages: Message[], tools: ToolSpec[]): Promise<LlmResponse> {
    const body = {
      model: this.opts.model,
      messages: messages.map(toWire),
      ...(tools.length > 0 && {
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      }),
    };

    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as WireResponse;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('LLM returned no message');

    return {
      text: msg.content ?? '',
      toolCalls: (msg.tool_calls ?? []).map((tc, i) => ({
        id: tc.id ?? `call_${i}`,
        name: tc.function.name,
        args: parseArgs(tc.function.arguments),
      })),
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}