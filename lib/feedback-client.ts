import type {Scenario} from './species';

export const COMMUNITY_API = 'https://westlake-flora-lab-yungu.sableborage.chatgpt.site/api/community';
export const FEEDBACK_LIMIT = 2000;
export const POLL_INTERVAL = 4000;
export const feedbackStatuses = {
  received: '已接收', triaging: '正在分流', awaiting_review: '等待审核',
  queued: '排队中', running: '处理中', validating: '验证中', review: '等待复核',
  failed: '处理失败', deployed: '已部署',
} as const;
export type FeedbackStatus = keyof typeof feedbackStatuses;
export type Suggestion = {
  id: string; text: string; species: string; status: string; createdAt: string;
  summary?: string; taskId?: string; error?: string; deploymentUrl?: string;
};
export type ChatJob = {id: string; status: string; reply?: string; error?: string; suggestions?: {title:string;prompt:string;kind:'code'|'research'}[]};
export type CommunityHealth = {ok: boolean; relay: {
  online: boolean; model?: string; reasoningEffort?: string;
  availableAccounts?: number; workers?: unknown; lastSeen?: string | number | null;
}};
export type FeedbackPayload = {scenario: Scenario; idempotencyKey: string};
type Session = {sessionId: string; token: string};
const SESSION_KEY = 'westlake-flora-community-session-v1';

export class FeedbackError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

export function statusLabel(status: string) {
  return feedbackStatuses[status as FeedbackStatus] ?? '状态待确认';
}

export function isFinished(status: string) { return status === 'failed' || status === 'deployed'; }

export function feedbackError(error: unknown): string {
  return error instanceof FeedbackError ? error.message : '暂时无法连接社区服务，请稍后重试。';
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validSession(value: unknown): value is Session {
  return object(value) && typeof value.sessionId === 'string' && !!value.sessionId &&
    typeof value.token === 'string' && !!value.token && !/[\r\n]/.test(value.token);
}
function validSuggestion(value: unknown): value is Suggestion {
  return object(value) && ['id', 'text', 'species', 'status', 'createdAt'].every(key => typeof value[key] === 'string') &&
    ['summary', 'taskId', 'error', 'deploymentUrl'].every(key => value[key] === undefined || typeof value[key] === 'string');
}
function validJob(value: unknown): value is ChatJob {
  return object(value) && typeof value.id === 'string' && !!value.id && typeof value.status === 'string' &&
    (value.reply === undefined || typeof value.reply === 'string') &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.suggestions === undefined || (Array.isArray(value.suggestions) && value.suggestions.every(p=>object(p)&&typeof p.title==='string'&&typeof p.prompt==='string'&&['code','research'].includes(String(p.kind)))));
}
function invalidResponse(): never { throw new FeedbackError('服务返回的数据不完整，请稍后重试。'); }

/** Only visitor session credentials are stored; public reads never send Authorization. */
export class FeedbackClient {
  private session: Session | null = null;
  private sessionRequest: Promise<Session> | null = null;

  private async request(path: string, options: {body?: unknown; token?: string; signal?: AbortSignal} = {}): Promise<Record<string, unknown>> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 12000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetch(`${COMMUNITY_API}${path}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
        headers: {...(options.body === undefined ? {} : {'Content-Type': 'application/json'}),
          ...(options.token ? {Authorization: `Bearer ${options.token}`} : {})},
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? '访客会话已失效，请重试。'
          : response.status === 429 ? '提交太频繁，请稍等片刻再重试。'
          : response.status === 404 ? '社区接口尚未就绪，请稍后重试。'
          : response.status === 409 ? '这次提交与已有请求冲突，请刷新处理状态。'
          : response.status >= 500 ? '社区服务暂时不可用，请稍后重试。'
          : '请求未被接受，请检查内容后重试。';
        throw new FeedbackError(message, response.status);
      }
      const data: unknown = await response.json();
      if (!object(data)) invalidResponse();
      return data;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof FeedbackError) throw error;
      throw new FeedbackError(timeout.signal.aborted ? '连接超时，结果尚未确认，请重试查询或提交。' : '暂时无法连接社区服务，请检查网络或稍后重试。');
    } finally { clearTimeout(timer); }
  }

  private async visitor(signal?: AbortSignal): Promise<Session> {
    if (this.session) return this.session;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (validSession(saved)) return (this.session = saved);
    } catch { /* Private browsing / disabled storage: keep session in memory. */ }
    if (!this.sessionRequest) {
      this.sessionRequest = this.request('/sessions', {body: {}, signal}).then(data => {
        if (!validSession(data)) invalidResponse();
        this.session = {sessionId: data.sessionId, token: data.token};
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch { /* memory only */ }
        return this.session;
      }).finally(() => { this.sessionRequest = null; });
    }
    return this.sessionRequest;
  }

  private async authenticated(path: string, body: unknown | undefined, signal?: AbortSignal) {
    const session = await this.visitor(signal);
    try { return await this.request(path, {body, token: session.token, signal}); }
    catch (error) {
      if (error instanceof FeedbackError && error.status === 401) {
        // Do not replay an uncertain POST with a new visitor identity.
        this.session = null;
        try { localStorage.removeItem(SESSION_KEY); } catch { /* memory only */ }
      }
      throw error;
    }
  }

  async health(signal?: AbortSignal): Promise<CommunityHealth> {
    const data = await this.request('/health', {signal});
    if (typeof data.ok !== 'boolean' || !object(data.relay) || typeof data.relay.online !== 'boolean') invalidResponse();
    return data as CommunityHealth;
  }
  async suggestions(signal?: AbortSignal): Promise<Suggestion[]> {
    const data = await this.request('/suggestions', {signal});
    if (!Array.isArray(data.suggestions) || !data.suggestions.every(validSuggestion)) invalidResponse();
    return data.suggestions as Suggestion[];
  }
  async suggest(payload: FeedbackPayload & {text: string; species: string}, signal?: AbortSignal): Promise<Suggestion> {
    this.validateText(payload.text);
    const data = await this.authenticated('/suggestions', payload, signal);
    if (!validSuggestion(data.suggestion)) invalidResponse();
    return data.suggestion;
  }
  async chat(payload: FeedbackPayload & {message: string}, signal?: AbortSignal): Promise<ChatJob> {
    this.validateText(payload.message);
    const data = await this.authenticated('/chat', payload, signal);
    if (!validJob(data.job)) invalidResponse();
    return data.job;
  }
  async chatJob(id: string, signal?: AbortSignal): Promise<ChatJob> {
    const data = await this.authenticated(`/chat/${encodeURIComponent(id)}`, undefined, signal);
    if (!validJob(data.job) || data.job.id !== id) invalidResponse();
    return data.job;
  }
  private validateText(text: string) {
    if (!text.trim() || text.length > FEEDBACK_LIMIT) throw new FeedbackError(`请输入 1–${FEEDBACK_LIMIT} 字的内容。`);
  }
}
