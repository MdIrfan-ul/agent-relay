export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmResponse {
  text: string;
  toolCalls: ToolCallRequest[];
  tokensIn: number;
  tokensOut: number;
}

export interface LlmClient {
  generate(messages: Message[], tools: ToolSpec[]): Promise<LlmResponse>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');