// N-ATLaS (NCAIR1/N-ATLaS): Llama-3 8B fine-tune for Hausa, Yoruba, Igbo.
// Served by our own OpenAI-compatible endpoint (see deploy/natlas_colab.ipynb).
// N-ATLaS is an initiative of the Federal Ministry of Communications, Innovation and Digital Economy,
// and powered by Awarri Technologies.

export const NATLAS_LANGUAGES = new Set(['Hausa', 'Yoruba', 'Igbo']);
// Model context is ~8k tokens; keep inputs well under it.
export const NATLAS_MAX_INPUT_CHARS = 6000;

const COOLDOWN_MS = 60_000;
let downUntil = 0;

export function natlasConfigured(): boolean {
  return !!process.env.NATLAS_BASE_URL && !!process.env.NATLAS_API_KEY;
}

/** False while the circuit breaker is open, so a dead server doesn't add a long timeout to every request. */
export function natlasAvailable(): boolean {
  return natlasConfigured() && Date.now() >= downUntil;
}

export async function natlasChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  if (!natlasConfigured()) throw new Error('N-ATLaS is not configured');
  const base = process.env.NATLAS_BASE_URL!.replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? Number(process.env.NATLAS_TIMEOUT_MS || 120_000));
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NATLAS_API_KEY}` },
      body: JSON.stringify({
        model: process.env.NATLAS_MODEL || 'NCAIR1/N-ATLaS',
        messages,
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.1,
      }),
    });
    if (!res.ok) throw new Error(`N-ATLaS HTTP ${res.status}`);
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (!text || !String(text).trim()) throw new Error('N-ATLaS returned empty content');
    return String(text);
  } catch (err) {
    // 4xx from our own server (e.g. input too long) is the request's fault, not an outage.
    if (!(err instanceof Error && /HTTP 4\d\d/.test(err.message))) downUntil = Date.now() + COOLDOWN_MS;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function natlasHealth(): Promise<boolean> {
  if (!natlasConfigured()) return false;
  try {
    const base = process.env.NATLAS_BASE_URL!.replace(/\/+$/, '').replace(/\/v1$/, '');
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch { return false; }
}
