// This view is specific to the five successful, single-attempt CAP17 R3 requests.
const roles = {botany:'植物',physics:'力学',scene:'场景',infra:'基础设施',qa:'测试'};
const tokenCount = n => Number.isSafeInteger(n) && n >= 0;
export function summarizeCaptureBatch(data) {
  const rows = data?.requests;
  if (data?.scene !== 'yungu-capture17-v3' || !Array.isArray(rows) || rows.length !== 5) {
    throw Error('批次数据缺失');
  }
  const ids=new Set(), requests=new Set(), seenRoles=new Set();
  for (const r of rows) {
    if (r.state !== 'completed' || r.code !== 200 || !Number.isSafeInteger(r.credentialId) || r.credentialId < 1 ||
        !Object.hasOwn(roles,r.role) || !r.requestId || ids.has(r.credentialId) || requests.has(r.requestId) || seenRoles.has(r.role) ||
        !Number.isSafeInteger(r.upstreamAttemptStartMs) || !Number.isSafeInteger(r.upstreamAttemptEndMs) ||
        r.upstreamAttemptStartMs < 0 || r.upstreamAttemptEndMs <= r.upstreamAttemptStartMs ||
        ![r.inputTokens,r.outputTokens,r.reasoningTokens].every(tokenCount) || r.reasoningTokens > r.outputTokens) {
      throw Error('账号调用回执不完整');
    }
    ids.add(r.credentialId);requests.add(r.requestId);seenRoles.add(r.role);
  }
  const start=Math.min(...rows.map(r=>r.upstreamAttemptStartMs)), end=Math.max(...rows.map(r=>r.upstreamAttemptEndMs));
  const common=Math.max(0,Math.min(...rows.map(r=>r.upstreamAttemptEndMs))-Math.max(...rows.map(r=>r.upstreamAttemptStartMs)));
  const sum=rows.reduce((s,r)=>s+r.upstreamAttemptEndMs-r.upstreamAttemptStartMs,0);
  const tokens=rows.reduce((s,r)=>({input:s.input+r.inputTokens,output:s.output+r.outputTokens,reasoning:s.reasoning+r.reasoningTokens}),{input:0,output:0,reasoning:0});
  if (common !== data.commonUpstreamOverlapMs || tokens.output !== data.totalOutputTokens || ids.size !== data.verifiedAccountCount) throw Error('汇总与逐笔回执不符');
  return {rows:[...rows].sort((a,b)=>a.credentialId-b.credentialId), start,end,common,wall:end-start,sum,tokens};
}

const clock = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'});
const day = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const number = new Intl.NumberFormat('zh-CN');
const seconds = n => (n/1000).toFixed(3);

async function readJson(path){
  const response=await fetch(path,{cache:'no-cache'});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
}

async function loadView(capturePromise) {
  const status=document.getElementById('status');
  try {
    const data=await capturePromise,s=summarizeCaptureBatch(data);
    const put=(id,value)=>{document.getElementById(id).textContent=value;};
    put('period',day.format(s.start)+' · 北京时间 '+clock.format(s.start)+' 至 '+clock.format(s.end)+' · '+data.model+' / '+data.reasoningEffort);
    put('common',seconds(s.common));put('wall',seconds(s.wall));put('sum',seconds(s.sum));
    put('tokens','共 '+s.rows.length+' 次成功请求，输入 '+number.format(s.tokens.input)+' token，输出 '+number.format(s.tokens.output)+' token，其中推理占 '+number.format(s.tokens.reasoning)+' token。');
    const body=document.getElementById('requests');
    for (const r of s.rows) {
      const tr=document.createElement('tr');
      for (const [i,v] of ['#'+r.credentialId+' '+roles[r.role],1,clock.format(r.upstreamAttemptStartMs),clock.format(r.upstreamAttemptEndMs),seconds(r.upstreamAttemptEndMs-r.upstreamAttemptStartMs),number.format(r.inputTokens),number.format(r.outputTokens),number.format(r.reasoningTokens)].entries()) {
        const td=document.createElement(i===0?'th':'td');
        if(i===0)td.scope='row';td.textContent=String(v);tr.append(td);
      }
      body.append(tr);
    }
    put('occupancy','按五个账号在整批时段内均可用计算，这五次请求占可用账号时间的 '+(100*s.sum/(s.wall*s.rows.length)).toFixed(2)+'%。');
    status.hidden=true;document.getElementById('evidence').hidden=false;
  } catch {
    status.textContent='未能核验本批回执。请刷新页面，或查看下方匿名原始记录。';
  }
}

export function readQuotaSnapshot(data) {
  if (!Array.isArray(data) || data.length!==5) throw Error('额度快照缺失');
  const ids=new Set();
  for (const r of data) {
    if (!Number.isInteger(r.credentialId) || r.credentialId<1 || ids.has(r.credentialId) ||
        r.windowSeconds!==604800 || !Number.isFinite(Date.parse(r.observedAt)) ||
        !Number.isFinite(r.remainingPercent) || r.remainingPercent<0 || r.remainingPercent>100) throw Error('额度快照不完整');
    ids.add(r.credentialId);
  }
  return [...data].sort((a,b)=>a.credentialId-b.credentialId);
}

async function loadQuota() {
  const status=document.getElementById('quota-status');
  try {
    const response=await fetch('./quota-20261110-2045.json',{cache:'no-cache'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const rows=readQuotaSnapshot(await response.json());
    const first=Math.min(...rows.map(r=>Date.parse(r.observedAt)));
    const last=Math.max(...rows.map(r=>Date.parse(r.observedAt)));
    document.getElementById('quota-time').textContent=day.format(first)+' · 北京时间 '+clock.format(first)+' 至 '+clock.format(last)+' 单独读取，覆盖各账号的七天窗口。';
    const body=document.getElementById('quota-rows');
    for(const r of rows){
      const tr=document.createElement('tr');
      for(const [i,v] of ['#'+r.credentialId,clock.format(Date.parse(r.observedAt)),r.remainingPercent+'%'].entries()){
        const td=document.createElement(i===0?'th':'td');if(i===0)td.scope='row';td.textContent=v;tr.append(td);
      }
      body.append(tr);
    }
    status.hidden=true;document.getElementById('quota-data').hidden=false;
  }catch{
    status.textContent='未能核验额度快照。请刷新，或下载下方快照文件查看。';
  }
}

/** Later requests are a separate ledger. Only identities actually present are shown. */
export function summarizePostrender(data,initial){
  if(!data || !Array.isArray(data.requests) || !data.requests.length) throw Error('暂无可核对的后续成功请求');
  const stamped=Date.parse(data.asOfUtc),old=summarizeCaptureBatch(initial);
  if(!Number.isFinite(stamped)||!tokenCount(data.acceptedArtifacts))throw Error('后续回执批次头不完整');
  const baselineRequests=new Set(old.rows.map(r=>r.requestId)), baselineTasks=new Set(old.rows.map(r=>r.task));
  const requests=new Set(),tasks=new Set(),accounts=new Map();
  let tokens=0;
  const text=v=>typeof v==='string'&&v.trim().length>0;
  for(const r of data.requests){
    if(!r || !Number.isSafeInteger(r.credentialId)||r.credentialId<=0||r.statusCode!==200 ||
       !text(r.requestId)||!text(r.taskId)||!text(r.stage)||!text(r.role)||!tokenCount(r.outputTokens) ||
       !Number.isSafeInteger(r.startMs)||!Number.isSafeInteger(r.endMs)||r.startMs<old.end||r.endMs<=r.startMs||r.endMs>stamped ||
       !Array.isArray(r.parents)||!r.parents.every(text)||new Set(r.parents).size!==r.parents.length||r.parents.includes(r.taskId)) {
      throw Error('后续回执字段或时间不完整');
    }
    if(requests.has(r.requestId)||baselineRequests.has(r.requestId)||baselineTasks.has(r.taskId)) throw Error('发现重复请求或混入初次分工的任务');
    requests.add(r.requestId);tasks.add(r.taskId);tokens+=r.outputTokens;
    const a=accounts.get(r.credentialId)??{credentialId:r.credentialId,count:0,outputTokens:0,stages:new Set()};
    a.count++;a.outputTokens+=r.outputTokens;a.stages.add(r.stage);accounts.set(r.credentialId,a);
  }
  if(data.acceptedArtifacts>tasks.size)throw Error('已接收交付超过回执中的独立任务数');
  const list=[...accounts.values()].sort((a,b)=>a.credentialId-b.credentialId);
  const events=data.requests.flatMap(r=>[[r.startMs,r.credentialId,1],[r.endMs,r.credentialId,-1]]).sort((a,b)=>a[0]-b[0]);
  const active=new Map();let cursor=events[0][0],accountMs=0,quietMs=0,allFiveMs=0;
  for(const [time,id,delta] of events){
    const elapsed=time-cursor,count=active.size;
    accountMs+=elapsed*count;if(!count)quietMs+=elapsed;if(count===5)allFiveMs+=elapsed;
    const next=(active.get(id)||0)+delta;if(next)active.set(id,next);else active.delete(id);cursor=time;
  }
  const elapsedMs=cursor-events[0][0];
  return {timing:{elapsedMs,accountMs,quietMs,allFiveMs},asOf:stamped,rows:[...data.requests].sort((a,b)=>a.startMs-b.startMs),accounts:list,
    accepted:data.acceptedArtifacts,output:tokens,repeated:list.filter(a=>a.count>1).length};
}

async function loadPostrender(capturePromise){
  const status=document.getElementById('postrender-status');
  try{
    const [initial,data]=await Promise.all([capturePromise,readJson('./postrender-work.json')]);
    const batch=summarizePostrender(data,initial);
    const dateTime=t=>day.format(t)+' '+clock.format(t);
    const {elapsedMs,accountMs,quietMs,allFiveMs}=batch.timing;
    document.getElementById('work-clock').textContent='从首笔发出到末笔返回 '+(elapsedMs/1000).toFixed(3)+' 秒，其中有 '+(quietMs/1000).toFixed(3)+' 秒没有本批请求在途。五个账号同时在途共 '+(allFiveMs/1000).toFixed(3)+' 秒。这批请求占五个账号可用时长的 '+(100*accountMs/(5*elapsedMs)).toFixed(1)+'%；不含其他任务，也不代表订阅扣费。';
    const summary=batch.repeated
      ? batch.repeated+' 个账号各有至少两次成功请求。'
      : '当前记录中的每个账号仅有一次成功请求。';
    document.getElementById('postrender-summary').textContent=batch.accounts.length+' 个账号有回执，共 '+batch.rows.length+' 次成功请求，输出 '+number.format(batch.output)+' token，已接收 '+batch.accepted+' 份交付。'+summary;
    document.getElementById('postrender-asof').textContent='统计截至北京时间 '+dateTime(batch.asOf)+'。';
    const body=document.getElementById('postrender-accounts');
    for(const a of batch.accounts){
      const tr=document.createElement('tr');
      for(const [i,v] of ['#'+a.credentialId,a.count,number.format(a.outputTokens),[...a.stages].join('、')].entries()){
        const td=document.createElement(i===0?'th':'td');if(i===0)td.scope='row';td.textContent=String(v);tr.append(td);
      }
      body.append(tr);
    }
    const list=document.getElementById('postrender-list');
    for(const r of batch.rows){
      const item=document.createElement('li');
      item.textContent='#'+r.credentialId+' · '+(roles[r.role]??r.role)+' · '+r.stage+' · 输出 '+number.format(r.outputTokens)+' token';
      const timing=document.createElement('small');timing.textContent='北京时间 '+dateTime(r.startMs)+' 至 '+dateTime(r.endMs)+' · HTTP 200';
      const ids=document.createElement('small');ids.textContent='请求 ID '+r.requestId+' · 任务 ID '+r.taskId;
      item.append(timing,ids);
      if(r.parents.length){const parent=document.createElement('small');parent.textContent='前置任务 '+r.parents.join('、');item.append(parent);}
      list.append(item);
    }
    status.hidden=true;document.getElementById('postrender-data').hidden=false;
  }catch{
    status.textContent='目前无法核验后续成功请求。暂不展示接力次数或 token 汇总。';
  }
}

if (typeof document !== 'undefined') {
  const capture=readJson('./account-receipts.json?v=r3-attempts-1');
  const firstHash=location.hash;
  Promise.allSettled([loadView(capture),loadQuota(),loadPostrender(capture)]).then(()=>{
    if(location.hash===firstHash && ['#postrender-work','#quota-title'].includes(firstHash))
      document.getElementById(firstHash.slice(1))?.scrollIntoView();
  });
}
