import OpenAI from 'openai';

const BASE_URL = process.env.NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';

// Model ids are overridable: NVIDIA retires/renames free-tier models, so verify against GET /v1/models.
export const NIM_MODELS = {
  get analysis() { return process.env.NIM_ANALYSIS_MODEL || 'nvidia/nemotron-3-super-120b-a12b'; },
  get fallback() { return process.env.NIM_FALLBACK_MODEL || 'google/gemma-4-31b-it'; },
  get vision() { return process.env.NIM_VISION_MODEL || 'meta/llama-3.2-11b-vision-instruct'; },
  get embedding() { return process.env.NIM_EMBEDDING_MODEL || 'nvidia/nemotron-3-embed-1b'; },
};

let client: OpenAI | null = null;

export function nimConfigured(): boolean {
  return !!process.env.NVIDIA_API_KEY;
}

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.NVIDIA_API_KEY) throw new Error('NVIDIA_API_KEY is not set');
    client = new OpenAI({ baseURL: BASE_URL, apiKey: process.env.NVIDIA_API_KEY, timeout: 90_000, maxRetries: 1 });
  }
  return client;
}

export type ChatContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface NimChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** The SDK retries once by default, doubling the worst-case wait; interactive calls like translation set 0. */
  maxRetries?: number;
  /** Reasoning models spend the token budget on hidden thinking; off by default for fast, direct output. */
  thinking?: boolean;
}

export async function nimChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatContent }>,
  opts: NimChatOptions = {},
): Promise<string> {
  const model = opts.model || NIM_MODELS.analysis;
  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 4096,
    stream: false,
  };
  if (!opts.thinking) body.chat_template_kwargs = { enable_thinking: false };
  const completion = await getClient().chat.completions.create(body, { timeout: opts.timeoutMs ?? 90_000, maxRetries: opts.maxRetries });
  const text = (completion as any).choices?.[0]?.message?.content;
  if (!text || !String(text).trim()) throw new Error(`NIM model ${model} returned empty content`);
  return String(text);
}

/** Embed texts in batches. `type` matters: NVIDIA's retrieval models embed queries and passages differently. */
export async function nimEmbed(texts: string[], type: 'query' | 'passage'): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await getClient().embeddings.create({
      model: NIM_MODELS.embedding,
      input: texts.slice(i, i + BATCH),
      encoding_format: 'float',
      input_type: type,
      truncate: 'END',
    } as any);
    out.push(...res.data.map(d => d.embedding as unknown as number[]));
  }
  return out;
}

/** Startup check: confirm the configured models exist in the live catalog. */
export async function nimCheckModels(): Promise<void> {
  if (!nimConfigured()) { console.warn('[NIM] NVIDIA_API_KEY not set; NIM models unavailable.'); return; }
  try {
    const list = await getClient().models.list();
    const ids = new Set<string>();
    for await (const m of list) ids.add(m.id);
    for (const [role, id] of Object.entries({ analysis: NIM_MODELS.analysis, fallback: NIM_MODELS.fallback, vision: NIM_MODELS.vision, embedding: NIM_MODELS.embedding })) {
      console.log(ids.has(id) ? `[NIM] ${role}: ${id} OK` : `[NIM] WARNING ${role}: ${id} is not in the live catalog`);
    }
  } catch (err) {
    console.warn('[NIM] Could not verify models:', err instanceof Error ? err.message : err);
  }
}
