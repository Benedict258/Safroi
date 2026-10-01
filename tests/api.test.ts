import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

// Hermetic end-to-end tests: the real server runs against fake NVIDIA NIM and N-ATLaS servers.

const NATLAS_KEY = 'test-natlas-key-1234567890';
let natlasUp = true;
let natlasHits = 0;
let server: ChildProcess;
let base = '';
const servers: http.Server[] = [];

function listen(handler: http.RequestListener): Promise<number> {
  return new Promise(resolve => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => { servers.push(s); resolve((s.address() as AddressInfo).port); });
  });
}
const readBody = (req: http.IncomingMessage) => new Promise<string>(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); });
const json = (res: http.ServerResponse, body: unknown, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

before(async () => {
  const nimPort = await listen(async (req, res) => {
    if (req.url?.endsWith('/models')) return json(res, { object: 'list', data: [] });
    const body = JSON.parse((await readBody(req)) || '{}');
    if (req.url?.endsWith('/embeddings')) return json(res, { data: (body.input as string[]).map((_, i) => ({ index: i, embedding: [1, 0, 0] })) });
    const last = body.messages.at(-1).content as string;
    const text = last.includes('TEXT TO TRANSLATE:') ? 'NIM:' + last.split('TEXT TO TRANSLATE:\n').pop() : '{"summary":"ok","risk_score":5,"risks":[]}';
    json(res, { choices: [{ message: { role: 'assistant', content: text } }] });
  });
  const natlasPort = await listen(async (req, res) => {
    if (req.url === '/health') return json(res, { status: 'ok' });
    if (req.url?.includes('chat')) natlasHits++;
    if (!natlasUp) { res.destroy(); return; }
    if (req.headers.authorization !== `Bearer ${NATLAS_KEY}`) return json(res, {}, 401);
    const body = JSON.parse(await readBody(req));
    json(res, { choices: [{ message: { content: 'NATLAS:' + (body.messages.at(-1).content as string).split('TEXT TO TRANSLATE:\n').pop() } }] });
  });

  const port = await listen((_q, r) => r.end()); // reserve a free port number for the app
  servers.pop()!.close();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', process.env.SERVER_ENTRY || 'server.ts'], {
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'test', JWT_SECRET: 'test-secret',
      NVIDIA_API_KEY: 'nvapi-test', NIM_BASE_URL: `http://127.0.0.1:${nimPort}/v1`,
      NATLAS_BASE_URL: `http://127.0.0.1:${natlasPort}/v1`, NATLAS_API_KEY: NATLAS_KEY,
      NATLAS_COOLDOWN_MS: '600', ANON_SCANS_PER_DAY: '2', FREE_SCANS_PER_MONTH: '2', MONGODB_URI: process.env.TEST_MONGODB_URI || '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 40000);
    server.stdout!.on('data', d => { if (/Server running|API running/.test(String(d))) { clearTimeout(t); resolve(); } });
    server.on('exit', c => reject(new Error('server exited ' + c)));
  });
});

after(() => { server?.kill(); servers.forEach(s => s.close()); });

// server-api.ts (production) has no in-memory fallback, so tests that touch users/history/documents need MongoDB.
const needsDb: string | false = process.env.SERVER_ENTRY === 'server-api.ts' && !process.env.TEST_MONGODB_URI
  ? 'server-api.ts needs MongoDB: set TEST_MONGODB_URI to run this test' : false;

let ipCounter = 10;
const newIp = () => `203.0.113.${++ipCounter}`;
async function api(path: string, opts: { method?: string; body?: unknown; token?: string; ip?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': opts.ip || newIp(), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any = null; try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data, headers: res.headers };
}
async function signup(email: string) {
  const r = await api('/api/auth/signup', { body: { email, password: 'Passw0rd!x', name: 'Test' } });
  assert.equal(r.status, 200);
  return { token: r.data.token as string, uid: r.data.uid as string };
}
const contract = { type: 'contract', value: 'Landlord may evict at any time without notice.' };

function tinyPng(): string {
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(8, 255)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test('health', async () => {
  const r = await api('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'ok');
});

test('auth: signup, duplicate, login, wrong password, /me', { skip: needsDb }, async () => {
  const { token } = await signup('auth@example.com');
  assert.equal((await api('/api/auth/signup', { body: { email: 'auth@example.com', password: 'Passw0rd!x', name: 'T' } })).status, 409);
  assert.equal((await api('/api/auth/login', { body: { email: 'auth@example.com', password: 'Passw0rd!x' } })).status, 200);
  assert.equal((await api('/api/auth/login', { body: { email: 'auth@example.com', password: 'nope' } })).status, 401);
  const me = await api('/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.data.email, 'auth@example.com');
  assert.equal(me.data.plan, 'free');
  assert.equal((await api('/api/auth/me')).status, 401);
});

test('history: requires auth, owner-only, cannot hijack ids', { skip: needsDb }, async () => {
  const a = await signup('hist-a@example.com');
  const b = await signup('hist-b@example.com');
  assert.equal((await api('/api/history', { body: { analysis: { id: 'h1' } } })).status, 401);
  assert.equal((await api('/api/history', { token: a.token, body: { userId: 'spoofed', analysis: { id: 'h1', title: 'mine' } } })).status, 200);
  const own = await api(`/api/history/${a.uid}`, { token: a.token });
  assert.equal(own.status, 200);
  assert.equal(own.data[0].title, 'mine');
  assert.equal((await api(`/api/history/${a.uid}`, { token: b.token })).status, 403);
  assert.equal((await api(`/api/history/${a.uid}`)).status, 401);
  assert.equal((await api('/api/history', { token: b.token, body: { analysis: { id: 'h1', title: 'pwned' } } })).status, 409);
  assert.equal((await api(`/api/history/${a.uid}`, { token: a.token })).data[0].title, 'mine');
});

test('jwt: forged token with a different secret is rejected', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const forged = jwt.sign({ userId: 'x' }, 'wrong-secret');
  assert.equal((await api('/api/auth/me', { token: forged })).status, 401);
});

test('ocr: corrupt or non-image input is a 400, not a 500 or crash', async () => {
  assert.equal((await api('/api/ocr-analyze', { body: { image: 'data:image/png;base64,iVBORw0KGgo=' } })).status, 400);
  assert.equal((await api('/api/ocr-analyze', { body: { image: 'data:image/png;base64,aGVsbG8gd29ybGQgbm90IGFuIGltYWdl' } })).status, 400);
  assert.equal((await api('/api/health')).status, 200); // still alive
});

test('ocr: a valid image goes through the vision path', async () => {
  const r = await api('/api/ocr-analyze', { body: { image: `data:image/png;base64,${tinyPng()}`, useDirectImage: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.path, 'multimodal');
});

test('analyze: validation errors do not consume quota', async () => {
  const ip = newIp();
  for (let i = 0; i < 5; i++) assert.equal((await api('/api/analyze', { ip, body: { type: 'contract' } })).status, 400);
  assert.equal((await api('/api/analyze', { ip, body: contract })).status, 200);
});

test('quota: guests get ANON_SCANS_PER_DAY per IP, and IPs are counted separately', async () => {
  const ipA = newIp(), ipB = newIp();
  assert.equal((await api('/api/analyze', { ip: ipA, body: contract })).status, 200);
  assert.equal((await api('/api/analyze', { ip: ipA, body: contract })).status, 200);
  const blocked = await api('/api/analyze', { ip: ipA, body: contract });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.code, 'scan_limit_reached');
  assert.equal((await api('/api/analyze', { ip: ipB, body: contract })).status, 200);
});

test('quota: free users get FREE_SCANS_PER_MONTH, tracked per account', { skip: needsDb }, async () => {
  const free = await signup('quota-free@example.com');
  const ip = newIp();
  for (let i = 0; i < 2; i++) assert.equal((await api('/api/analyze', { ip, token: free.token, body: contract })).status, 200);
  assert.equal((await api('/api/analyze', { ip, token: free.token, body: contract })).status, 429);

  // the user's quota follows the account, not the IP
  assert.equal((await api('/api/analyze', { ip: newIp(), token: free.token, body: contract })).status, 429);
});

test('translation routing: N-ATLaS for Hausa, NIM for French, NIM when N-ATLaS is down', async () => {
  natlasUp = true;
  const ha = await api('/api/translate', { body: { text: 'Pay rent monthly.', targetLanguage: 'Hausa' } });
  assert.equal(ha.data.provider, 'natlas');
  assert.match(ha.data.translatedText, /^NATLAS:/);

  const fr = await api('/api/translate', { body: { text: 'Pay rent monthly.', targetLanguage: 'French' } });
  assert.equal(fr.data.provider, 'nim');

  natlasUp = false;
  const ig = await api('/api/translate', { body: { text: 'Cancel with notice.', targetLanguage: 'Igbo' } });
  assert.equal(ig.data.provider, 'nim');
  assert.match(ig.data.translatedText, /^NIM:/);

  const en = await api('/api/translate', { body: { text: 'Hello', targetLanguage: 'English' } });
  assert.equal(en.data.translatedText, 'Hello');
  natlasUp = true;
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('translation: circuit breaker skips a dead N-ATLaS, then recovers', async () => {
  await sleep(700); // let any earlier cooldown expire
  natlasUp = false;
  natlasHits = 0;
  const first = await api('/api/translate', { body: { text: 'Breaker sentence one.', targetLanguage: 'Hausa' } });
  assert.equal(first.data.provider, 'nim');
  assert.equal(natlasHits, 1);
  const second = await api('/api/translate', { body: { text: 'Breaker sentence two.', targetLanguage: 'Hausa' } });
  assert.equal(second.data.provider, 'nim');
  assert.equal(natlasHits, 1, 'N-ATLaS must not be called again during the cooldown');
  natlasUp = true;
  await sleep(700);
  const third = await api('/api/translate', { body: { text: 'Breaker sentence three.', targetLanguage: 'Hausa' } });
  assert.equal(third.data.provider, 'natlas');
});

test('translation: results are cached', async () => {
  const body = { text: 'Unique cached sentence.', targetLanguage: 'Yoruba' };
  await sleep(700);
  natlasUp = true;
  const first = await api('/api/translate', { body });
  natlasUp = false;
  const second = await api('/api/translate', { body });
  assert.equal(second.data.translatedText, first.data.translatedText);
  assert.equal(second.data.provider, 'natlas');
  natlasUp = true;
});

test('document chat: ingest requires auth and answers from the document', { skip: needsDb }, async () => {
  assert.equal((await api('/api/documents')).status, 401);
  const u = await signup('docs@example.com');
  const ing = await api('/api/documents/ingest', { token: u.token, body: { type: 'text', title: 'Lease', value: 'The deposit of 100,000 NGN is non-refundable.' } });
  assert.equal(ing.status, 200);
  const chat = await api(`/api/documents/${ing.data.documentId}/chat`, { token: u.token, body: { message: 'deposit?' } });
  assert.equal(chat.status, 200);
  assert.ok(chat.data.sources.length > 0);
  const other = await signup('docs-other@example.com');
  assert.notEqual((await api(`/api/documents/${ing.data.documentId}/chat`, { token: other.token, body: { message: 'deposit?' } })).status, 200);
});
