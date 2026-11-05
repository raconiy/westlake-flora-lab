'use client';

import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {Leaf, MessageCircle, Send, X, RefreshCw, ChevronRight, LoaderCircle, Lightbulb} from 'lucide-react';
import {getSpecies, type Scenario} from '../lib/species';
import {FeedbackClient, FEEDBACK_LIMIT, POLL_INTERVAL, feedbackError, isFinished, statusLabel,
  type ChatJob, type CommunityHealth, type Suggestion} from '../lib/feedback-client';
import './feedback.css';

type Turn = {key: string; text: string; scenario: Scenario; job?: ChatJob; error?: string; sending?: boolean};
type SuggestionAttempt = {key: string; text: string; scenario: Scenario; result?: Suggestion; error?: string};
const speciesNames: Record<string, string> = {ginkgo: '银杏', osmanthus: '桂花', iris: '鸢尾', oxalis: '酢浆草', camphor: '香樟', acer: '鸡爪槭', ophiopogon: '麦冬'};
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间待确认' : date.toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}
function deploymentLink(value?: string) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password && (url.origin==='https://raconiy.github.io'&&url.pathname.startsWith('/westlake-flora-lab/')) ? url.href : undefined; }
  catch { return undefined; }
}
function Status({status}: {status: string}) {
  return <span className={`fh-status ${status === 'deployed' ? 'fh-success' : status === 'failed' ? 'fh-failed' : ''}`}>{statusLabel(status)}</span>;
}

/** Embed with <FeedbackHub scenario={scenario} />. No page wiring or existing state is required. */
export default function FeedbackHub({scenario,inline=false}: {scenario: Scenario;inline?:boolean}) {
  const [client] = useState(() => new FeedbackClient());
  const [open, setOpen] = useState(false);
  const visible=inline||open;
  const [mode, setMode] = useState<'chat' | 'suggest'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [suggestInput, setSuggestInput] = useState('');
  const [health, setHealth] = useState<CommunityHealth | null>(null);
  const [proof,setProof]=useState<{proven:boolean;distinctAccounts:number;model:string;reasoningEffort:string;overlapMs:number;verifiedAt:string;accounts:{slot:string;requestId:string;httpStatus:number}[]}|null>(null);
  const [healthError, setHealthError] = useState('');
  const [historyError,setHistoryError]=useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [boardError, setBoardError] = useState('');
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [boardUpdated, setBoardUpdated] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [attempt, setAttempt] = useState<SuggestionAttempt | null>(null);
  const [sendingSuggestion, setSendingSuggestion] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const lastAttempt = useRef<SuggestionAttempt | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const panelId = useId();
  const activeTurn = turns.find(turn => turn.job && !isFinished(turn.job.status) && !turn.job.reply && !turn.job.error);
  const chatBlocked = turns.some(turn => turn.sending || !!turn.error || (turn.job && !isFinished(turn.job.status) && !turn.job.reply && !turn.job.error));

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => { controller.abort(); lifetime.current = null; };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const results = await Promise.allSettled([client.health(controller.signal), client.suggestions(controller.signal)]);
      if (controller.signal.aborted) return;
      const [healthResult, boardResult] = results;
      if (healthResult.status === 'fulfilled') { setHealth(healthResult.value); setHealthError(''); }
      else { setHealth(null); setHealthError(feedbackError(healthResult.reason)); }
      if (boardResult.status === 'fulfilled') {
        setSuggestions(boardResult.value); setBoardError(''); setBoardLoaded(true);
        setBoardUpdated(new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit'}));
      } else setBoardError(feedbackError(boardResult.reason));
      timer = setTimeout(refresh, POLL_INTERVAL);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, visible, refreshTick]);

  const historyLoaded=useRef(false);
  useEffect(()=>{if(!visible||historyLoaded.current)return;const controller=new AbortController();client.history(controller.signal).then(history=>{if(controller.signal.aborted)return;historyLoaded.current=true;setHistoryError('');setTurns(current=>[...history.filter(h=>!current.some(t=>t.job?.id===h.job.id)).map(h=>({key:h.job.id,...h})),...current]);}).catch(error=>{if(!controller.signal.aborted)setHistoryError(feedbackError(error));});return()=>controller.abort();},[client,visible,refreshTick]);

  useEffect(()=>{if(!visible)return;const controller=new AbortController();fetch(`${import.meta.env.BASE_URL}execution-evidence.json`,{signal:controller.signal}).then(r=>r.ok?r.json():null).then(value=>{if(!controller.signal.aborted&&value?.proven===true&&value.distinctAccounts===3&&Array.isArray(value.accounts))setProof(value);}).catch(()=>{});return()=>controller.abort();},[visible]);

  const jobId = activeTurn?.job?.id;
  const turnKey = activeTurn?.key;
  useEffect(() => {
    if (!jobId || !turnKey) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const job = await client.chatJob(jobId!, controller.signal);
        if (controller.signal.aborted) return;
        setTurns(items => items.map(turn => turn.key === turnKey ? {...turn, job, error: undefined} : turn));
        if (job.reply || job.error || isFinished(job.status)) { setRefreshTick(n => n + 1); return; }
      } catch (error) {
        if (controller.signal.aborted) return;
        setTurns(items => items.map(turn => turn.key === turnKey ? {...turn, error: feedbackError(error)} : turn));
      }
      timer = setTimeout(poll, POLL_INTERVAL);
    }
    timer = setTimeout(poll, POLL_INTERVAL);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [client, jobId, turnKey, pollTick]);

  useEffect(() => {
    const show=()=>{setMode('suggest');setOpen(true);};
    window.addEventListener('flora:feedback',show);
    return()=>window.removeEventListener('flora:feedback',show);
  },[]);

  useEffect(() => {
    if (!visible) return;
    textarea.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape'&&!inline) { setOpen(false); opener.current?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [visible]);

  async function sendChat(turn: Turn) {
    const signal = lifetime.current?.signal;
    if (sendLock.current || !signal || signal.aborted) return;
    sendLock.current = true;
    setTurns(items => items.some(item => item.key === turn.key)
      ? items.map(item => item.key === turn.key ? {...item, error: undefined, sending: true} : item)
      : [...items, {...turn, sending: true}]);
    try {
      const job = await client.chat({message: turn.text, scenario: turn.scenario, idempotencyKey: turn.key}, signal);
      if (!signal.aborted) setTurns(items => items.map(item => item.key === turn.key ? {...item, job, sending: false} : item));
    } catch (error) {
      if (!signal.aborted) setTurns(items => items.map(item => item.key === turn.key ? {...item, error: feedbackError(error), sending: false} : item));
    } finally { sendLock.current = false; }
  }

  async function sendSuggestion(value: SuggestionAttempt) {
    const signal = lifetime.current?.signal;
    if (sendLock.current || !signal || signal.aborted) return;
    sendLock.current = true; setSendingSuggestion(true);
    setAttempt(value); lastAttempt.current = value;
    try {
      const result = await client.suggest({text: value.text, species: value.scenario.species, scenario: value.scenario, idempotencyKey: value.key}, signal);
      if (signal.aborted) return;
      const next = {...value, result, error: undefined};
      setAttempt(next); lastAttempt.current = next;
      setSuggestInput(current => current.trim() === value.text ? '' : current);
      setRefreshTick(n => n + 1);
    } catch (error) {
      if (!signal.aborted) {
        const next = {...value, error: feedbackError(error)};
        setAttempt(next); lastAttempt.current = next;
      }
    } finally { sendLock.current = false; if (!signal.aborted) setSendingSuggestion(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = (mode === 'chat' ? chatInput : suggestInput).trim();
    if (!text || text.length > FEEDBACK_LIMIT || sendLock.current) return;
    if (mode === 'chat') {
      if (chatBlocked) return;
      void sendChat({key: crypto.randomUUID(), text, scenario: {...scenario}}); setChatInput('');
    } else {
      const previous = lastAttempt.current;
      const same = previous && previous.text === text && JSON.stringify(previous.scenario) === JSON.stringify(scenario);
      if (same && previous.result) { setAttempt(previous); return; }
      void sendSuggestion(same ? previous : {key: crypto.randomUUID(), text, scenario: {...scenario}});
    }
  }

  const input = mode === 'chat' ? chatInput : suggestInput;
  const serviceLabel = healthError ? '社区服务暂不可达' : !health ? '连接状态待检测'
    : !health.ok ? '社区服务暂未就绪' : health.relay.online ? '助手服务已连接' : '助手暂离线 · 建议可尝试提交';

  return <div className={`feedback-hub ${inline?'fh-inline':''}`}>
    {!inline&&<button ref={opener} type="button" className="fh-launcher" aria-expanded={open} aria-controls={panelId}
      onClick={() => setOpen(value => !value)}><MessageCircle size={19} aria-hidden="true"/><span>建议与助手</span><span className="fh-launcher-dot" aria-hidden="true"/></button>}
    {visible && <aside ref={panel} id={panelId} className="fh-panel" role={inline?'region':'dialog'} aria-label="植物社区建议与助手" aria-labelledby={titleId}>
      <header className="fh-header"><div className="fh-mark"><Leaf size={22} aria-hidden="true"/></div><div><span className="fh-eyebrow">WESTLAKE · COMMUNITY</span><h2 id={titleId}>一起，让生境更真实。</h2></div>
        {!inline&&<button type="button" className="fh-icon-button" aria-label="关闭建议与助手" onClick={() => {setOpen(false); opener.current?.focus();}}><X size={20}/></button>}</header>
      <div className="fh-connection" role="status"><span className={`fh-dot ${health?.ok && health.relay.online && !healthError ? 'fh-connected' : ''}`}/><span>{serviceLabel}</span>
        <button type="button" onClick={() => setRefreshTick(n => n + 1)} aria-label="重新检测连接并刷新建议"><RefreshCw size={13}/></button></div>
      {health?.relay.online&&<div className="fh-model-evidence"><b>{health.relay.model} / {health.relay.reasoningEffort}</b><span>{health.relay.availableAccounts??'—'} 个可用账号 · {typeof health.relay.workers==='number'?health.relay.workers:'—'} 个执行器 · 云端共享记录</span></div>}
      {proof&&<details className="fh-proof"><summary>已核验 {proof.distinctAccounts} 个账号同时调用 · {proof.model} / {proof.reasoningEffort}</summary><p>本轮上游转发区间共同重叠 {(proof.overlapMs/1000).toFixed(3)} 秒；验收时间 {new Date(proof.verifiedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。</p>{proof.accounts.map(a=><p key={a.slot}>匿名账号 {a.slot} · HTTP {a.httpStatus} · 请求 {a.requestId.slice(0,8)}</p>)}<p>这是已完成调用的日志验收；当前连接与可用账号数以上方健康状态为准。</p><a href={`${import.meta.env.BASE_URL}execution-evidence.json`} target="_blank" rel="noreferrer">查看可核对回执 ↗</a><p><a href={`${import.meta.env.BASE_URL}collaboration-evidence.json`} target="_blank" rel="noreferrer">查看分工、同事交接与三个账号的审查原文 ↗</a></p></details>}
      {historyError&&<p className="fh-network-note">历史对话暂未恢复：{historyError}<button type="button" onClick={()=>setRefreshTick(n=>n+1)}>重新读取</button></p>}
      {healthError && <p className="fh-network-note">{healthError}</p>}
      <div className="fh-tabs" role="group" aria-label="选择问助手或提建议">
        <button type="button" aria-pressed={mode === 'chat'} className={mode === 'chat' ? 'fh-selected' : ''} onClick={() => setMode('chat')}><MessageCircle size={15}/>问助手</button>
        <button type="button" aria-pressed={mode === 'suggest'} className={mode === 'suggest' ? 'fh-selected' : ''} onClick={() => setMode('suggest')}><Lightbulb size={15}/>提建议</button>
      </div>
      <div className="fh-scroll">
        <section className="fh-conversation" aria-label={mode === 'chat' ? '助手对话' : '提交公开建议'}>
          {mode === 'chat' ? <>
            {!turns.length && <div className="fh-intro"><span className="fh-intro-icon"><Leaf size={24}/></span><h3>从一株植物的问题开始</h3><p>询问当前场景、讨论形态与模拟。请求由云端异步处理，收到真实回复后会显示在这里。</p></div>}
            {turns.map(turn => <article className="fh-turn" key={turn.key}>
              <div className="fh-user"><small>你 · {speciesNames[turn.scenario.species]}</small><p>{turn.text}</p></div>
              <div className="fh-assistant">
                {turn.sending ? <p className="fh-pending" role="status"><LoaderCircle size={14} className="fh-spin"/>正在发送，请勿重复提交…</p> : <>
                  {turn.job && <div className="fh-job-state"><Status status={turn.job.status}/><small title={turn.job.id}>请求 {turn.job.id.slice(0,8)}</small>{!turn.job.reply && !turn.job.error && !isFinished(turn.job.status) && <span>尚未收到回复 · 每 4 秒查询</span>}</div>}
                  {turn.job?.reply && <><small>助手回复</small><p className="fh-reply">{turn.job.reply}</p></>}
                  {(turn.job?.error || turn.job?.status === 'failed') && <p className="fh-error">本次助手处理失败。可复制上方问题，重新发起对话。</p>}
                  {turn.job && isFinished(turn.job.status) && !turn.job.reply && !turn.job.error && turn.job.status !== 'failed' && <p className="fh-note">服务处理已结束，但未返回助手正文。</p>}
                  {turn.error && <div className="fh-error" role="alert"><p>{turn.error}</p><button type="button" disabled={sendLock.current} onClick={() => turn.job ? setPollTick(n => n + 1) : void sendChat(turn)}>{turn.job ? '重试查询' : '重试同一请求'}</button>{!turn.job && <button type="button" onClick={() => setTurns(items => items.filter(item => item.key !== turn.key))}>取消重试</button>}</div>}
                  {!!turn.job?.suggestions?.length && <p className="fh-note">助手整理了 {turn.job.suggestions.length} 条修改提案；展开检查并编辑为公开建议。</p>}
                  {turn.job?.suggestions?.map((proposal,i)=><details className="fh-proposal" key={i}><summary>{proposal.kind==='code'?'代码提案':'研究提案'} · {proposal.title}</summary><p>{proposal.prompt}</p><button type="button" onClick={()=>{setSuggestInput(`${proposal.title}\n${proposal.prompt}`);setMode('suggest');textarea.current?.focus();}}>编辑为公开建议</button></details>)}
                </>}
              </div>
            </article>)}
          </> : <div className="fh-suggest-intro"><h3>把观察变成下一步改进</h3><p>描述哪里不准确、期望怎样改进。建议及关联物种会公开给其他访客；当前场景参数会随提交发送。</p><p className="fh-note">请勿填写个人隐私、密钥或本机文件路径。已接收表示服务收到建议，后续仍需审核、处理和验证。</p>
            {attempt && <div className="fh-receipt" aria-live="polite">{sendingSuggestion ? <p className="fh-pending"><LoaderCircle size={14} className="fh-spin"/>正在提交建议…</p> : attempt.error ? <><p className="fh-error">{attempt.error}</p><button type="button" onClick={() => void sendSuggestion(attempt)}>重试同一建议</button></> : attempt.result ? <><Status status={attempt.result.status}/><p>服务已返回建议记录，可在下方看板跟进最新状态。</p></> : null}</div>}
          </div>}
        </section>
        <form className="fh-composer" onSubmit={submit}>
          <label htmlFor={`${panelId}-input`}>{mode === 'chat' ? '向助手提问' : '填写公开建议'}<span>当前物种 · {getSpecies(scenario.species).name}</span></label>
          <textarea ref={textarea} id={`${panelId}-input`} value={input} maxLength={FEEDBACK_LIMIT} rows={3} placeholder={mode === 'chat' ? '例如：当前桂花的叶序有哪些依据？' : '例如：希望补充枝条分叉角度的实测对照…'}
            onChange={event => mode === 'chat' ? setChatInput(event.target.value) : setSuggestInput(event.target.value)}
            aria-describedby={`${panelId}-hint`}/>
          <div className="fh-composer-footer"><small id={`${panelId}-hint`}>{input.length}/{FEEDBACK_LIMIT} · {mode === 'chat' ? '仅显示服务返回的回复' : '提交后公开可见'}</small>
            <button className="fh-send" type="submit" disabled={!input.trim() || sendingSuggestion || turns.some(turn => turn.sending) || (mode === 'chat' && chatBlocked)}><Send size={14}/>{mode === 'chat' ? '发送问题' : '提交建议'}</button></div>
          {mode === 'chat' && chatBlocked && <p className="fh-note">请等待当前请求返回；连接失败时可在消息下重试。</p>}
        </form>
        <section className="fh-board" aria-label="所有访客的公开建议看板"><div className="fh-board-heading"><div><span className="fh-eyebrow">OPEN SUGGESTIONS</span><h3>大家的建议 <span>{boardLoaded ? suggestions.length : '—'}</span></h3></div><button type="button" className="fh-icon-button" aria-label="刷新公开建议" onClick={() => setRefreshTick(n => n + 1)}><RefreshCw size={15}/></button></div>
          <p className="fh-note">所有访客共享 · 每 4 秒更新{boardUpdated ? ` · 上次 ${boardUpdated}` : ''}</p>
          {boardError && <div className="fh-error" role="alert"><p>{boardError}{boardLoaded ? ' 下方保留上次读取的记录。' : ''}</p><button type="button" onClick={() => setRefreshTick(n => n + 1)}>重试读取</button></div>}
          {!boardLoaded && !boardError && <p className="fh-empty">正在读取公开建议…</p>}
          {boardLoaded && !suggestions.length && <p className="fh-empty">暂时没有公开建议，欢迎分享你的第一条观察。</p>}
          {suggestions.map(item => { const url = deploymentLink(item.deploymentUrl); return <article className="fh-card" key={item.id}><div className="fh-card-top"><span>{speciesNames[item.species] || '其他物种'}</span><Status status={item.status}/></div><p>{item.text}</p>{item.summary && <p className="fh-summary">处理摘要：{item.summary}</p>}{item.status === 'failed' && <p className="fh-error">本条建议处理未完成，等待维护者跟进。</p>}<div className="fh-card-footer"><code title={item.id}>记录 {item.id.slice(0,8)}{item.taskId?` · 任务 ${item.taskId.slice(0,8)}`:''}</code><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>{item.status === 'deployed' && url && <a href={url} target="_blank" rel="noopener noreferrer">查看部署<ChevronRight size={12}/></a>}</div></article>; })}
        </section>
        <p className="fh-privacy">访客会话仅用于本次交流，可保存在此浏览器。会话凭据不在公开看板显示。</p>
      </div>
    </aside>}
  </div>;
}
