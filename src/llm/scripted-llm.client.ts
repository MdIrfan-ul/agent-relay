import { Injectable } from '@nestjs/common';
import type { LlmClient, LlmResponse, Message } from './llm.types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class ScriptedLlmClient implements LlmClient {
  async generate(messages: Message[]): Promise<LlmResponse> {
    await sleep(Number(process.env.SCRIPTED_LLM_DELAY_MS ?? 500));

    // Decide from the history, not from internal state, so a resumed run on a
    // different worker follows the same script.
    const first = messages[0];
    const withEffect = first?.role === 'user' && first.content.includes('[effect]');
    const turns = messages.filter((m) => m.role === 'assistant').length;
    const finalTurn = withEffect ? 3 : 2;

    if (turns === 0) {
      return { text: '', toolCalls: [{ id: 'call_0', name: 'get_time', args: {} }], tokensIn: 50, tokensOut: 10 };
    }
    if (turns === 1) {
      return {
        text: '',
        toolCalls: [{ id: 'call_1', name: 'calculator', args: { op: 'mul', a: 6, b: 7 } }],
        tokensIn: 80,
        tokensOut: 12,
      };
    }
    if (withEffect && turns === 2) {
      return {
        text: '',
        toolCalls: [{ id: 'call_2', name: 'record_event', args: { label: 'chaos' } }],
        tokensIn: 100,
        tokensOut: 12,
      };
    }
    const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
    return {
      text: `Finished. Last tool result: ${lastTool?.content ?? 'none'}`,
      toolCalls: [],
      tokensIn: turns >= finalTurn ? 120 : 0,
      tokensOut: turns >= finalTurn ? 15 : 0,
    };
  }
}