import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, PageHead, useToast } from '../components/ui';
import { useFetch } from '../hooks';
import { fmtDate } from '../types';

interface Source {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  data: unknown;
}
interface Mem {
  id: string;
  text: string;
  category?: string;
  source: 'hindsight' | 'local';
  createdAt?: string;
}
interface Reply {
  answer: string;
  mode: 'llm' | 'offline';
  model?: string;
  sources: Source[];
  memoriesUsed: Mem[];
  memoryBackend: string;
  memoriesRetained: Mem[];
  warnings: string[];
}
interface Status {
  llm: { configured: boolean; provider: string; model: string | null };
  hindsight: { configured: boolean; reachable: boolean; bank: string };
  mode: 'llm' | 'offline';
  tools: string[];
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  reply?: Reply;
  error?: boolean;
}

const SUGGESTIONS = [
  'Which facility generated the most waste?',
  'How much red-category waste was generated this month?',
  'Show me delayed transports',
  'Which waste records are still pending disposal?',
  "Summarize this week's operational problems",
  'Compare this month with last month',
  'What are the most common compliance issues?',
  'What was the issue we saw with that facility earlier?',
];

const LABELS: Record<string, { cls: string; hint: string }> = {
  'Database fact': { cls: 'green', hint: 'Read directly from PostgreSQL' },
  Memory: { cls: 'violet', hint: 'Recalled from long-term memory - may be outdated' },
  Inference: { cls: 'amber', hint: "The assistant's own reasoning - not a stored fact" },
  Uncertainty: { cls: 'red', hint: 'Unavailable or unverified information' },
};

/** Renders the labelled answer format (**Label:** text) with a coloured chip per statement type. */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="answer">
      {blocks.map((b, i) => {
        const m = b.match(/^\*\*(Database fact|Memory|Inference|Uncertainty):\*\*\s*([\s\S]*)$/);
        if (!m) return <p key={i}>{b.replace(/\*\*/g, '')}</p>;
        const l = LABELS[m[1]];
        return (
          <p key={i} className="answer-line">
            <span className={`badge ${l.cls}`} title={l.hint}>
              {m[1]}
            </span>{' '}
            {m[2]}
          </p>
        );
      })}
    </div>
  );
}

function Details({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="details">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export default function Assistant() {
  const { can } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const status = useFetch(() => api<Status>('/ai/status'), []);
  const ledger = useFetch(() => (can('ADMIN', 'AUDITOR') ? api<Mem[]>('/ai/memories') : Promise.resolve({ data: [] as Mem[] })), []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (q.length < 2 || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api<Reply>('/ai/chat', { method: 'POST', body: { message: q, history } });
      setMsgs((m) => [...m, { role: 'assistant', text: r.data.answer, reply: r.data }]);
      if (r.data.memoriesRetained.length) ledger.reload();
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: (e as Error).message, error: true }]);
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <>
      <PageHead title="AI compliance assistant" subtitle="Ask about waste, facilities, transports, alerts and compliance. Answers come from live database queries." />

      <div className="card ai-status" aria-label="Assistant status">
        {s ? (
          <>
            <span>
              Reasoning:{' '}
              {s.llm.configured ? <Badge raw value={`LLM · ${s.llm.provider}:${s.llm.model}`} tone="green" /> : <Badge raw value="Data-only mode (no LLM key configured)" tone="amber" />}
            </span>
            <span>
              Long-term memory:{' '}
              {s.hindsight.configured ? (
                <Badge raw value={s.hindsight.reachable ? 'Hindsight connected' : 'Hindsight unreachable - using local ledger'} tone={s.hindsight.reachable ? 'green' : 'amber'} />
              ) : (
                <Badge raw value="Local ledger (Hindsight not configured)" tone="slate" />
              )}
            </span>
            <span className="muted">{s.tools.length} read-only tools · no free-form SQL</span>
          </>
        ) : (
          <span className="muted">{status.error ?? 'Checking assistant status…'}</span>
        )}
      </div>

      <div className="grid chat-grid">
        <Card className="chat-card">
          <div className="chat" role="log" aria-live="polite">
            {msgs.length === 0 && (
              <div className="chat-empty">
                <Empty title="Ask a question about your operations" hint="Try one of the suggestions below." />
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role} ${m.error ? 'err' : ''}`}>
                {m.role === 'user' ? (
                  m.text
                ) : m.error ? (
                  m.text
                ) : (
                  <>
                    <Answer text={m.text} />
                    {m.reply && (
                      <div className="reply-meta">
                        {m.reply.warnings.map((w, j) => (
                          <div key={j} className="error-box" style={{ margin: '8px 0 0' }}>
                            {w}
                          </div>
                        ))}
                        {m.reply.sources.length > 0 && (
                          <Details summary={`Sources: ${m.reply.sources.length} database quer${m.reply.sources.length > 1 ? 'ies' : 'y'}`}>
                            {m.reply.sources.map((src, j) => (
                              <div key={j} className="source">
                                <div>
                                  <span className="mono">{src.tool}</span> <span className="muted mono">{JSON.stringify(src.args)}</span> {!src.ok && <Badge raw value="failed" tone="red" />}
                                </div>
                                <div className="muted">{src.summary}</div>
                                <details>
                                  <summary className="muted">raw data</summary>
                                  <pre>{JSON.stringify(src.data, null, 2).slice(0, 4000)}</pre>
                                </details>
                              </div>
                            ))}
                          </Details>
                        )}
                        {m.reply.memoriesUsed.length > 0 && (
                          <Details summary={`Memories recalled (${m.reply.memoryBackend === 'hindsight' ? 'Hindsight' : 'local ledger'}): ${m.reply.memoriesUsed.length}`}>
                            {m.reply.memoriesUsed.map((x) => (
                              <p key={x.id} className="muted">
                                • {x.text}
                              </p>
                            ))}
                          </Details>
                        )}
                        {m.reply.memoriesRetained.length > 0 && (
                          <p className="muted">
                            💾 Saved to memory: {m.reply.memoriesRetained.map((x) => x.text).join(' | ')}
                          </p>
                        )}
                        <p className="muted" style={{ fontSize: 11.5 }}>
                          {m.reply.mode === 'llm' ? `Generated by ${m.reply.model}` : 'Data-only answer (no language model used)'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {busy && <div className="bubble assistant muted">Querying the database…</div>}
            <div ref={bottom} />
          </div>

          <div className="chips">
            {SUGGESTIONS.map((q) => (
              <button key={q} className="btn sm" onClick={() => send(q)} disabled={busy}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="row gap"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder='Ask a question, or say "remember that I prefer …"' maxLength={1000} aria-label="Question" />
            <button className="btn primary" disabled={busy || input.trim().length < 2}>
              Ask
            </button>
          </form>
        </Card>

        <div>
          <Card title="How to read answers">
            {Object.entries(LABELS).map(([k, v]) => (
              <p key={k}>
                <span className={`badge ${v.cls}`}>{k}</span> <span className="muted">{v.hint}</span>
              </p>
            ))}
          </Card>
          {can('ADMIN', 'AUDITOR') && (
            <Card title="Memory ledger" actions={<button className="btn sm" onClick={ledger.reload}>Refresh</button>}>
              <p className="muted">Everything the assistant has chosen to remember. Raw conversations are never stored.</p>
              {ledger.data && ledger.data.length === 0 && <Empty title="No memories yet" hint='Ask about facilities or alerts, or say "remember …".' />}
              {ledger.data?.slice(0, 8).map((m) => (
                <div key={m.id} className="mem">
                  <Badge value={m.category ?? 'MEMORY'} tone="violet" /> <span className="muted">{fmtDate(m.createdAt)} · {m.source}</span>
                  <div>{m.text}</div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
