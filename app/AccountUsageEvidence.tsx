import {useEffect,useState} from 'react';
type Usage={observedAt:string;periodStart:string;accounts:{slot:number;remaining:number|null;count:number;output:number}[]};
/** Published, anonymized account-level evidence. This is a dated snapshot,
 * separate from worker availability and the provider's quota percentages. */
export function AccountUsageEvidence(){
 const[data,setData]=useState<Usage|null>(null);
 useEffect(()=>{const controller=new AbortController();fetch(`${import.meta.env.BASE_URL}account-usage.json`,{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(j=>{
  if(!Array.isArray(j.accounts)||!Number.isFinite(Date.parse(j.observedAt))||!Number.isFinite(Date.parse(j.periodStart)))return;
  const accounts=j.accounts.filter((a:any)=>Number.isSafeInteger(a.slot)&&a.slot>0&&Number.isSafeInteger(a.successfulRequests?.count)&&Number.isSafeInteger(a.successfulRequests?.outputTokens)).map((a:any)=>({slot:a.slot,count:a.successfulRequests.count,output:a.successfulRequests.outputTokens,remaining:Number.isFinite(a.quota?.[0]?.remaining)?a.quota[0].remaining:null}));
  setData({observedAt:j.observedAt,periodStart:j.periodStart,accounts});
 }).catch(()=>{});return()=>controller.abort();},[]);
 if(!data)return null;
 const format=(s:string)=>new Date(s).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
 return <details className="fh-proof"><summary>查看账号级请求与额度快照（{data.accounts.length} 个已记录）</summary><p>{format(data.periodStart)} — {format(data.observedAt)} · 已核验快照 · 非实时</p><table className="fh-account-table"><caption>账号级成功请求与上游额度，非 worker 计数</caption><thead><tr><th>账号</th><th>成功请求</th><th>输出 token</th><th>上游剩余</th></tr></thead><tbody>{data.accounts.map(a=><tr key={a.slot}><th>#{a.slot}</th><td>{a.count.toLocaleString()}</td><td>{a.output.toLocaleString()}</td><td>{a.remaining===null?'未观测':`${a.remaining}%`}</td></tr>)}</tbody></table><p>额度百分比来自上游观测；成功请求与输出 token 来自 GPT-Load 日志。两项分别展示，百分比差异原因仍待核实。</p><a href={`${import.meta.env.BASE_URL}account-usage.json`} target="_blank" rel="noreferrer">核对原始匿名快照 ↗</a></details>;
}
