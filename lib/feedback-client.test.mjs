import test, {afterEach, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {COMMUNITY_API, FeedbackClient, FEEDBACK_LIMIT, POLL_INTERVAL, feedbackError, isFinished, statusLabel} from './feedback-client.ts';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let stored;
beforeEach(() => {
  stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  }});
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
});
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const scenario = {species: 'ginkgo', age: 10, day: 180, seed: 42, density: 1, wind: 3, gravity: 1, stiffness: 1, moisture: .6, compaction: .2, soilDepth: 2};
const suggestion = {id: 's1', text: '<script>alert(1)</script>', species: 'ginkgo', status: 'received', createdAt: '2026-11-05T00:00:00Z'};

test('public reads omit credentials; concurrent writes share one visitor session and use Bearer authorization', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, ...options});
    if (url.endsWith('/sessions')) { await new Promise(resolve => setTimeout(resolve, 5)); return json({sessionId: 'visitor', token: 'visitor-token'}); }
    if (url.endsWith('/health')) return json({ok: true, relay: {online: false}});
    if (url.endsWith('/suggestions') && options.method === 'GET') return json({suggestions: [suggestion]});
    if (url.endsWith('/suggestions')) return json({suggestion});
    return json({job: {id: 'j1', status: 'queued'}});
  };
  const client = new FeedbackClient();
  await Promise.all([client.health(), client.suggestions()]);
  await Promise.all([
    client.suggest({text: '观察建议', species: scenario.species, scenario, idempotencyKey: 's-key'}),
    client.chat({message: '叶序是什么？', scenario, idempotencyKey: 'c-key'}),
  ]);
  await client.chatJob('j1');
  assert.equal(calls.filter(call => call.url.endsWith('/sessions')).length, 1);
  for (const call of calls) {
    assert.ok(call.url.startsWith(COMMUNITY_API));
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'error');
    const publicCall = call.url.endsWith('/sessions') || (call.method === 'GET' && !call.url.includes('/chat/'));
    assert.equal(call.headers.Authorization, publicCall ? undefined : 'Bearer visitor-token');
  }
  const sessionBody = JSON.parse(calls.find(call => call.url.endsWith('/sessions')).body);
  assert.match(sessionBody.memberId, /^m_[A-Za-z0-9_-]{16,80}$/);
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/chat')).body).idempotencyKey, 'c-key');
  assert.equal(stored.size, 1);
  // No markup interpretation or sanitization that could change the public content.
  assert.equal((await client.suggestions())[0].text, suggestion.text);
});

test('retry preserves the exact payload and idempotency key after an uncertain network result', async () => {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/sessions')) return json({sessionId: 'visitor', token: 'visitor-token'});
    bodies.push(options.body);
    if (bodies.length === 1) throw new TypeError('internal network details');
    return json({suggestion});
  };
  const client = new FeedbackClient();
  const payload = {text: '观察建议', species: scenario.species, scenario, idempotencyKey: 'stable-key'};
  await assert.rejects(client.suggest(payload), /暂时无法连接/);
  assert.equal((await client.suggest(payload)).status, 'received');
  assert.equal(bodies[0], bodies[1]);
});

test('backend errors never expose tokens or internal file paths and do not silently replay POST', async () => {
  let writes = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/sessions')) return json({sessionId: 'visitor', token: 'visitor-token'});
    writes++;
    return json({error: 'visitor-token /Users/private/internal.txt'}, 401);
  };
  const client = new FeedbackClient();
  await assert.rejects(client.chat({message: '问题', scenario, idempotencyKey: 'key'}), error => {
    assert.equal(error.status, 401);
    assert.equal(feedbackError(error), '访客会话已失效，请重试。');
    return true;
  });
  assert.equal(writes, 1);
  assert.equal(stored.size, 0);
});

test('blocked browser storage falls back to the same in-memory visitor session', async () => {
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() { throw new Error('disabled'); }});
  let sessions = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/sessions')) { sessions++; return json({sessionId: 'v', token: 't'}); }
    return json({job: {id: 'j1', status: 'queued'}});
  };
  const client = new FeedbackClient();
  await client.chat({message: '问题', scenario, idempotencyKey: 'key'});
  await client.chatJob('j1');
  assert.equal(sessions, 1);
});

test('rejects malformed data, mismatched jobs and overlong or empty input', async () => {
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    if (url.endsWith('/sessions')) return json({sessionId: 'v', token: 't'});
    if (url.endsWith('/health')) return json({ok: true, relay: {online: 'yes'}});
    if (url.endsWith('/suggestions')) return json({suggestions: [{id: 'bad'}]});
    return json({job: {id: 'wrong-id', status: 'running'}});
  };
  const client = new FeedbackClient();
  await assert.rejects(client.chat({message: 'x'.repeat(FEEDBACK_LIMIT + 1), scenario, idempotencyKey: 'key'}), /请输入/);
  await assert.rejects(client.suggest({text: '  ', species: 'ginkgo', scenario, idempotencyKey: 'key'}), /请输入/);
  assert.equal(calls, 0);
  await assert.rejects(client.health(), /数据不完整/);
  await assert.rejects(client.suggestions(), /数据不完整/);
  await assert.rejects(client.chatJob('expected-id'), /数据不完整/);
});

test('caller cancellation reaches fetch so unmount can stop pending reads', async () => {
  let signal;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true}));
  };
  const controller = new AbortController();
  const request = new FeedbackClient().suggestions(controller.signal);
  controller.abort();
  await assert.rejects(request, {name: 'AbortError'});
  assert.equal(signal.aborted, true);
});

test('received is an acknowledgement; all contracted states and unknown states remain explicit', () => {
  assert.equal(POLL_INTERVAL, 4000);
  for (const status of ['received', 'triaging', 'awaiting_review', 'queued', 'running', 'validating', 'review']) {
    assert.equal(isFinished(status), false);
    assert.notEqual(statusLabel(status), '状态待确认');
  }
  assert.equal(statusLabel('received'), '已接收');
  assert.equal(statusLabel('unknown'), '状态待确认');
  assert.equal(isFinished('failed'), true);
  assert.equal(isFinished('deployed'), true);
});
