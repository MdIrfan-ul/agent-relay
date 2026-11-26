import type { ToolSpec } from '../llm/llm.types';

export interface ToolContext {
  idempotencyKey: string;
  runId: string;
  /** Performs the side effect, deduplicated downstream by the idempotency key. */
  recordEffect(label: string): Promise<void>;
}

export interface Tool {
  spec: ToolSpec;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const getTime: Tool = {
  spec: {
    name: 'get_time',
    description: 'Returns the current time (ISO 8601).',
    inputSchema: { type: 'object', properties: {} },
  },
  execute: async () => ({ now: new Date().toISOString() }),
};

const calculator: Tool = {
  spec: {
    name: 'calculator',
    description: 'Basic arithmetic on two numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'sub', 'mul', 'div'] },
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['op', 'a', 'b'],
    },
  },
  execute: async (args) => {
    const a = Number(args.a);
    const b = Number(args.b);
    switch (args.op) {
      case 'add': return { value: a + b };
      case 'sub': return { value: a - b };
      case 'mul': return { value: a * b };
      case 'div':
        if (b === 0) throw new Error('division by zero');
        return { value: a / b };
      default:
        throw new Error(`unknown op: ${String(args.op)}`);
    }
  },
};
const recordEvent: Tool = {
  spec: {
    name: 'record_event',
    description: 'Records an event with a label. This is a real side effect.',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
    },
  },
  execute: async (args, ctx) => {
    const label = typeof args.label === 'string' ? args.label : 'event';
    await ctx.recordEffect(label);
    return { recorded: true, label };
  },
};

export const TOOLS: Tool[] = [getTime, calculator,recordEvent];