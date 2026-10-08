import { config } from '../config';

/** Provider-neutral conversation format. Adapters translate to/from each vendor's wire format. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; results: { id: string; name: string; content: string }[] };
export interface LlmReply {
  text: string | null;
  toolCalls: ToolCall[];
}

export const llmConfigured = () => config.ai.provider !== 'none' && !!config.ai.apiKey && !!config.ai.model;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM provider returned ${res.status}${json?.error?.message ? `: ${json.error.message}` : ''}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function chatOpenAI(system: string, turns: Turn[], tools: ToolSpec[]): Promise<LlmReply> {
  const messages: unknown[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant')
      messages.push({
        role: 'assistant',
        content: t.text ?? null,
        ...(t.toolCalls?.length
          ? { tool_calls: t.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    else for (const r of t.results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  const json = await post(`${config.ai.baseUrl}/chat/completions`, { Authorization: `Bearer ${config.ai.apiKey}` }, {
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    temperature: 0.1,
    messages,
    tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  });
  const msg = json.choices?.[0]?.message ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments || '{}');
    } catch {
      /* malformed args are reported back to the model by the tool validator */
    }
    return { id: c.id, name: c.function?.name, args };
  });
  return { text: msg.content ?? null, toolCalls };
}

async function chatAnthropic(system: string, turns: Turn[], tools: ToolSpec[]): Promise<LlmReply> {
  const messages: unknown[] = [];
  for (const t of turns) {
    if (t.role === 'user') messages.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') {
      const content: unknown[] = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      for (const c of t.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      messages.push({ role: 'assistant', content });
    } else messages.push({ role: 'user', content: t.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) });
  }
  const json = await post(`${config.ai.baseUrl}/v1/messages`, { 'x-api-key': config.ai.apiKey!, 'anthropic-version': '2023-06-01' }, {
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    temperature: 0.1,
    system,
    messages,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = json.content ?? [];
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || null,
    toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
  };
}

/** The only LLM entry point. Switching provider/model is purely an environment change. */
export function chat(system: string, turns: Turn[], tools: ToolSpec[]): Promise<LlmReply> {
  return config.ai.provider === 'anthropic' ? chatAnthropic(system, turns, tools) : chatOpenAI(system, turns, tools);
}
