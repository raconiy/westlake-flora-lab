'use client';
import {ExternalLink,RefreshCw,ChevronDown,AlertCircle} from 'lucide-react';

export type ClusterHealth = {
 modelBackend?:string; model?:string; reasoningEffort?:string;
 gateway?:{availableAccounts?:number; requiredAccounts?:number};
};
export type QueueTask = {
 id:string; title:string; status:string; kind?:string; createdAt?:string;
 workerId?:string; model?:string; reasoningEffort?:string; validationStatus?:string;
 merged?:boolean; error?:unknown; failureReason?:unknown; validationError?:unknown;
 result?:{summary?:string; workerId?:string; model?:string; reasoningEffort?:string;
  validationStatus?:string; merged?:boolean; error?:unknown; failureReason?:unknown; validationError?:unknown};
};
export function isGPTLoad(health:ClusterHealth|null){return /gpt[\s_-]*load/i.test(health?.modelBackend||'');}
const display=(value:unknown)=>typeof value==='string'&&value.trim()?value:'未报告';
function reason(value:unknown):string|null{
 if(typeof value==='string'&&value.trim())return value;
 if(value&&typeof value==='object'&&'message' in value&&typeof value.message==='string')return value.message;
 return null;
}
export function ConnectionEvidence({health,online,error}:{health:ClusterHealth|null;online:boolean;error:string}){
 const gateway=isGPTLoad(health);
 const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:'未报告';
 return <section className="cluster-evidence" aria-label="协调服务实际配置">
  <div className="cluster-heading"><div><span className="eyebrow">LIVE COORDINATOR HEALTH</span><h2>执行配置与连接证据</h2></div><span className={`cluster-state ${online?'ready':'unavailable'}`}>{online?'健康接口已连接':'连接未确认'}</span></div>
  {online&&health?<><dl className="cluster-metrics"><div><dt>modelBackend · 后端</dt><dd>{display(health.modelBackend)}</dd></div><div><dt>model · 模型</dt><dd>{display(health.model)}</dd></div><div><dt>reasoningEffort · 推理强度</dt><dd>{display(health.reasoningEffort)}</dd></div></dl>
   {gateway?<div className="gateway-evidence"><div><h3>GPT-Load 网关账号</h3><p><strong>{count(health.gateway?.availableAccounts)}</strong> 可用 / <strong>{count(health.gateway?.requiredAccounts)}</strong> 所需</p><small>来自 /api/health 的 gateway；worker 数与账号数分别统计。</small></div><a href="http://127.0.0.1:3001/groups" target="_blank" rel="noreferrer">本机 GPTLoad 组管理 <ExternalLink size={15}/><small>默认端口 3001</small></a></div>:<p className="cluster-note">配置由 /api/health 返回。下方独立 Codex 账号池单独统计，不代表网关容量。</p>}
  </>:<p className="evidence-error" role="status"><AlertCircle size={16}/>{error||'正在读取 /api/health；尚无已确认的后端与账号数据。'}</p>}
 </section>;
}
const states:Record<string,string>={queued:'待领取',pending:'待领取',leased:'执行中',running:'执行中',completed:'执行已返回',failed:'执行失败',validation_failed:'验证未通过',cancelled:'已取消'};
export function TaskEvidence({tasks,online,error,onRefresh}:{tasks:QueueTask[];online:boolean;error:string;onRefresh:()=>void}){
 return <section className="queue-panel evidence-queue" aria-label="共享任务与交付证据"><div className="queue-header"><div><span className="eyebrow">SHARED TASK QUEUE</span><h2>每一次建议，都有去向。</h2></div><button className="subtle-button" onClick={onRefresh}><RefreshCw size={16}/>刷新</button></div>
  <p className="queue-explainer">展开查看执行结果与验证记录。模型返回、验证通过、代码合并是不同状态；合并标记也不代表已部署。</p>
  {error&&<p className="evidence-error" role="status"><AlertCircle size={16}/>{error}{tasks.length?'；以下为上次读取的任务，状态可能已变化。':''}</p>}
  {tasks.length?<div className="evidence-tasks">{tasks.map(task=>{
   const result=task.result,validation=result?.validationStatus??task.validationStatus;
   const merged=task.merged===true||result?.merged===true;
   const failure=reason(task.error)||reason(task.failureReason)||reason(task.validationError)||reason(result?.error)||reason(result?.failureReason)||reason(result?.validationError);
   const failed=['failed','validation_failed'].includes(task.status)||/fail|error|reject/i.test(validation||'');
   return <details className="evidence-task" key={task.id}><summary><span className={`task-status ${task.status}`} aria-hidden="true"/><span className="task-heading"><b>{task.title}</b><small>{task.id} · {task.kind||'类型未报告'}</small></span><span className="task-badges"><span className={failed?'failure-badge':''}>{states[task.status]||task.status}</span><span>{merged?'已标记合并':'未确认合并'}</span></span><ChevronDown className="task-chevron" size={18}/></summary>
    <div className="task-evidence-body"><dl><div><dt>workerId</dt><dd>{display(result?.workerId??task.workerId)}</dd></div><div><dt>model</dt><dd>{display(result?.model??task.model)}</dd></div><div><dt>reasoningEffort</dt><dd>{display(result?.reasoningEffort??task.reasoningEffort)}</dd></div><div><dt>validationStatus</dt><dd>{display(validation)}</dd></div><div><dt>merged · 合并标记</dt><dd>{merged?'true · 服务标记已合并':task.merged===false||result?.merged===false?'false · 尚未合并':'未报告 · 尚未确认合并'}</dd></div></dl>
    <h3>result.summary · 执行摘要</h3><p className="task-summary">{result?.summary?.trim()||'尚无执行摘要。'}</p>
    {(failed||failure)&&<div className="task-failure"><b>失败原因</b><p>{failure||'服务未提供具体失败原因，请查看协调服务或 worker 日志。'}</p></div>}
    <p className="merge-note">{merged?'服务已报告合并；网站是否部署需另行确认。':'尚未确认合并，不能视为网站已实施。'}</p></div>
   </details>;
  })}</div>:<div className="empty-state"><p>{error?'任务读取失败，暂时无法确认队列内容。':online?'任务队列为空。提交第一条改进意见。':'连接协调服务后查看真实共享任务。'}</p></div>}
 </section>;
}
