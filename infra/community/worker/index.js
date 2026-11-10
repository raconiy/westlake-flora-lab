const species = new Set(['ginkgo','osmanthus','iris','oxalis','camphor','acer','ophiopogon']);
const stages = new Set(['received','triaging','awaiting_review','queued','running','validating','review','failed','deployed']);
const base='/api/community';
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const hash=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>crypto.randomUUID();
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const text=(s,max=6000)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw new ApiError(400,'请输入有效文本，最多 '+max+' 字符');return s.trim();};
function checkSecrets(s){if(/(?:password|密码|验证码|2fa)\s*[:：=]\s*\S+|\bsk-[\w-]{12,}|-----BEGIN .*PRIVATE KEY/i.test(s))throw new ApiError(400,'请勿提交密码、验证码或密钥');}
function scenario(s){const out={};const bounds={age:[0,200],day:[1,365],seed:[-2147483648,2147483647],density:[.15,2],wind:[0,25],gravity:[0,3],stiffness:[.1,4],moisture:[0,1],compaction:[0,1],soilDepth:[.1,5]};if(s&&typeof s==='object'){if(species.has(s.species))out.species=s.species;for(const k of Object.keys(bounds)){if(typeof s[k]!=='number'||!Number.isFinite(s[k]))continue;const [lo,hi]=bounds[k];if(s[k]<lo||s[k]>hi)throw new ApiError(400,`场景参数 ${k} 超出范围`);out[k]=s[k];}}return JSON.stringify(out);}
// A member id is a public author label, never permission to recover a session.
// Legacy rows used opaque UUIDs as session ids and remain readable.
const memberOf=id=>id.split('.')[0];
const publicSuggestion=r=>({id:r.id,text:r.text,species:r.species,memberId:memberOf(r.session_id),status:r.status,summary:r.summary??undefined,taskId:r.task_id??undefined,error:r.error??undefined,deploymentUrl:r.deployment_url??undefined,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()});
const publicJob=r=>({id:r.id,status:r.status,reply:r.reply??undefined,error:r.error??undefined,suggestions:r.proposals?JSON.parse(r.proposals):[],createdAt:r.created_at});
const claimMs=240_000;
const remoteTimeoutMs=120_000;
const queueTtlMs=30*60_000;

async function expireJobs(db,now){
 // Queued work is safe to claim. Running work may already have used the upstream.
 const expired="(status='running' AND lease_until<=? OR status='queued' AND created_at<=?)";
 const cutoff=now-queueTtlMs;
 if(!await db.prepare('SELECT id FROM community_jobs WHERE '+expired+' LIMIT 1').bind(now,cutoff).first())return;
 const reason="CASE WHEN status='running' THEN '执行连接已中断，未取得可确认的答复。请联系主控核查。' ELSE '助手在等待期间未接单，请重新提交。' END";
 await db.batch([
  db.prepare("UPDATE community_suggestions SET status='failed',error=(SELECT "+reason+" FROM community_jobs WHERE suggestion_id=community_suggestions.id),updated_at=? WHERE id IN (SELECT suggestion_id FROM community_jobs WHERE "+expired+")").bind(now,now,cutoff),
  db.prepare("UPDATE community_jobs SET error="+reason+",status='failed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE "+expired).bind(now,now,cutoff),
 ]);
}

async function finishLease(db,id,token,answer,proposals,error){
 const now=Date.now();
 const owner="id=? AND status='running' AND lease_token=? AND lease_until>?";
 const [_,result]=await db.batch([
  db.prepare("UPDATE community_suggestions SET status=?,summary=?,error=?,updated_at=? WHERE id IN (SELECT suggestion_id FROM community_jobs WHERE "+owner+")").bind(error?'failed':'awaiting_review',answer,error,now,id,token,now),
  db.prepare("UPDATE community_jobs SET status=?,reply=?,proposals=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE "+owner).bind(error?'failed':'completed',answer,JSON.stringify(proposals),error,now,id,token,now),
 ]);
 return result.meta.changes===1;
}

async function chatHistory(db,sid,id,through=Date.now()){
 const previous=await db.prepare("SELECT input,reply FROM community_jobs WHERE session_id=? AND kind='chat' AND status='completed' AND id<>? AND updated_at<=? ORDER BY created_at DESC,id DESC LIMIT 6").bind(sid,id,through).all();
 return previous.results.reverse().flatMap(r=>[{role:'user',content:r.input},{role:'assistant',content:r.reply}]);
}

function parseProposals(list){
 return Array.isArray(list)?list.slice(0,5).map(p=>({title:text(p?.title,200),prompt:text(p?.prompt,8000),kind:p?.kind==='code'?'code':'research'})):[];
}

// A push lease belongs exclusively to the durable remote job. A timeout may
// lose the acknowledgement, so every recovery addresses the very same UUID.
async function syncRemoteJob(db,env,row,submit=false){
 if(row?.status!=='running'||!row.lease_token?.startsWith('push:'))return;
 const now=Date.now();
 if(!submit){
  const lock=await db.prepare("UPDATE community_jobs SET updated_at=? WHERE id=? AND status='running' AND lease_token=? AND updated_at<=? AND lease_until>?")
   .bind(now,row.id,row.lease_token,now-3000,now).run();
  if(lock.meta.changes!==1)return;
 }
 const url=env.REMOTE_RELAY_URL.replace(/\/$/,'')+'/jobs/'+encodeURIComponent(row.id);
 const headers={authorization:'Bearer '+env.REMOTE_RELAY_TOKEN,'content-type':'application/json'};
 const send=async(init={})=>fetch(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(3800)});
 try{
  let result=submit?null:await send();
  if(!result||result.status===404){
   const history=row.kind==='chat'?await chatHistory(db,row.session_id,row.id,row.created_at):[];
   const payload={input:row.input,scenario:JSON.parse(row.scenario),kind:row.kind,history:[]};
   const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
   if(bytes(payload)>17500){await finishLease(db,row.id,row.lease_token,null,[],'问题和场景合计过长，请缩短后重新提交。');return;}
   for(let i=history.length-2;i>=0;i-=2){
    const candidate=[...history.slice(i,i+2),...payload.history];
    if(bytes({...payload,history:candidate})>17500)break;
    payload.history=candidate;
   }
   result=await send({method:'POST',body:JSON.stringify(payload)});
  }
  if(!result.ok)return;
  const value=await result.json();
  if(value.status==='completed')await finishLease(db,row.id,row.lease_token,text(value.reply,16000),parseProposals(value.suggestions),null);
  if(value.status==='failed')await finishLease(db,row.id,row.lease_token,null,[],'模型任务未能完成，请联系主控核查这条记录。');
 }catch{ /* D1 retains the lease. The next poll recovers through the same UUID. */ }
}
async function syncOldestPush(db,env,kind){
 const now=Date.now();
 const row=await db.prepare("SELECT * FROM community_jobs WHERE status='running' AND lease_token LIKE 'push:%' AND updated_at<=? AND lease_until>? AND (? IS NULL OR kind=?) ORDER BY updated_at LIMIT 1")
  .bind(now-3000,now,kind,kind).first();
 if(row)await syncRemoteJob(db,env,row);
}

async function completeRemotely(db,env,{id,sid,token,input,scenarioValue,isSuggestion}){
 let failure='远程连接中断，未取得可确认的答复。请联系主控核查。',answer,proposals;
 try{
  const history=isSuggestion?[]:await chatHistory(db,sid,id);
  const r=await fetch(env.REMOTE_RELAY_URL.replace(/\/$/,'')+'/complete',{
   method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+env.REMOTE_RELAY_TOKEN,'idempotency-key':id},
   body:JSON.stringify({jobId:id,kind:isSuggestion?'triage':'chat',input,scenario:JSON.parse(scenarioValue),history}),signal:AbortSignal.timeout(remoteTimeoutMs),
  });
  if(!r.ok){
   failure='远程助手返回 HTTP '+r.status+'，本次调用未取得答复。';
   throw new Error('relay response');
  }
  failure='远程助手返回了无法读取的答复，请联系主控核查。';
  const value=await r.json();
  answer=text(value.reply,16000);
  proposals=parseProposals(value.suggestions);
 }catch{
  await finishLease(db,id,token,null,[],failure);
  return;
 }
 await finishLease(db,id,token,answer,proposals,null);
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),origin=request.headers.get('origin');
 const allowed=new Set(['https://raconiy.github.io',url.origin,'http://127.0.0.1:5173','http://localhost:5173']);
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
 if(origin&&allowed.has(origin))headers['access-control-allow-origin']=origin;
 const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
 try{
  if(origin&&!allowed.has(origin))throw new ApiError(403,'来源未获许可');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Authorization'}});
  if(url.pathname==='/'&&!url.search)return Response.redirect('https://raconiy.github.io/westlake-flora-lab/',302);
  if(!url.pathname.startsWith(base+'/'))throw new ApiError(404,'接口不存在');
  if(!env.DB)throw new ApiError(503,'共享数据库尚未就绪');
  const db=env.DB,now=Date.now(),path=url.pathname.slice(base.length),method=request.method;
  const bearer=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const secret=env.COMMUNITY_RELAY_TOKEN;
  const admin=!!secret&&bearer.length===secret.length&&await hash(bearer)===await hash(secret);
  const session=async()=>{if(!bearer)throw new ApiError(401,'请重新建立访客会话');const s=await db.prepare('SELECT id FROM community_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(bearer),now).first();if(!s)throw new ApiError(401,'访客会话已失效，请重新连接');return s.id;};
  const rate=async(key,max,window=60000)=>{const bucket=Math.floor(now/window);const row=await db.prepare('INSERT INTO community_rate(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key+':'+bucket,now+window*2).first();if(row.count>max)throw new ApiError(429,'提交较频繁，请稍后再试');};
  const body=async()=>{if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'请使用 JSON');if(Number(request.headers.get('content-length')||0)>18000)throw new ApiError(413,'请求过大');const reader=request.body?.getReader();let size=0,chunks=[];if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>18000){await reader.cancel();throw new ApiError(413,'请求过大');}chunks.push(value);}const data=new Uint8Array(size);let n=0;for(const c of chunks){data.set(c,n);n+=c.length;}try{const b=JSON.parse(new TextDecoder().decode(data)||'{}');if(!b||typeof b!=='object'||Array.isArray(b))throw 0;return b;}catch{throw new ApiError(400,'JSON 格式错误');}};
  const remoteHealth=async()=>{if(!env.REMOTE_RELAY_URL||!env.REMOTE_RELAY_TOKEN)return null;try{const r=await fetch(`${env.REMOTE_RELAY_URL.replace(/\/$/,'')}/health`,{signal:AbortSignal.timeout(2500)});if(!r.ok)return null;return await r.json();}catch{return null;}};
  const push=env.REMOTE_JOB_API==='durable-v1'&&!!env.REMOTE_RELAY_URL&&!!env.REMOTE_RELAY_TOKEN;
  const relayState=async()=>{
   const row=await db.prepare('SELECT * FROM community_relay WHERE id=?').bind('leader').first();
   const value=row?JSON.parse(row.payload):{},fresh=!!row&&now-row.last_seen<45000;
   return {...value,heartbeatOnline:fresh,online:fresh&&Number(value.availableAccounts)>0&&Number(value.workers)>0,lastSeen:row?.last_seen??null};
  };
  if(method==='GET'&&path==='/health'){
   if(push){
    const remote=await remoteHealth();
    return reply(200,{ok:true,storage:'D1',relay:{model:remote?.model,reasoningEffort:remote?.reasoningEffort,availableAccounts:remote?.availableAccounts??null,transport:'durable',online:remote?.asyncJobs===true&&Number(remote.availableAccounts)>0,lastSeen:remote?.ok?now:null}});
   }
   const consumer=await relayState();if(consumer.online)return reply(200,{ok:true,storage:'D1',relay:{...consumer,transport:'queue'}});
   const remote=await remoteHealth();
   if(remote?.ok)return reply(200,{ok:true,storage:'D1',relay:{...remote,heartbeatOnline:consumer.heartbeatOnline,online:Number(remote.availableAccounts)>0,transport:'direct',lastSeen:now}});
   return reply(200,{ok:true,storage:'D1',relay:consumer});
  }
  if(method==='GET'&&(path==='/history'||path==='/suggestions'||path.startsWith('/chat/')))await expireJobs(db,now);
  if(method==='GET'&&path==='/suggestions'){await syncOldestPush(db,env,'triage');const rows=await db.prepare('SELECT * FROM community_suggestions ORDER BY created_at DESC LIMIT 100').all();return reply(200,{suggestions:rows.results.map(publicSuggestion)});}
  if(method==='POST'&&path==='/sessions'){
   if(!secret)throw new ApiError(503,'共享服务尚未配置');await body();
   const ip=await hash(secret+':'+(request.headers.get('cf-connecting-ip')||'unknown'));await rate('sessions:'+ip,12,600000);
   const memberId='m_'+random().replaceAll('-','');
   // Every page session gets independent credentials and private chat history.
   // Reusing a public member label cannot rotate another session's token.
   const id=memberId+'.'+random(),token=random()+random();
   await db.prepare('INSERT INTO community_sessions VALUES(?,?,?,?)').bind(id,await hash(token),now,now+14*86400000).run();
   return reply(201,{memberId,token});
  }
  if(method==='POST'&&(path==='/suggestions'||path==='/chat')){
   const sid=await session(),b=await body(),isSuggestion=path==='/suggestions',input=text(isSuggestion?b.text:b.message);checkSecrets(input);const idem=text(b.idempotencyKey,100),s=scenario(b.scenario),sp=species.has(b.species)?b.species:JSON.parse(s).species||'ginkgo';
   if(isSuggestion){const existing=await db.prepare('SELECT * FROM community_suggestions WHERE session_id=? AND idempotency=?').bind(sid,idem).first();if(existing)return reply(200,{suggestion:publicSuggestion(existing)});}
   else{const existing=await db.prepare('SELECT * FROM community_jobs WHERE session_id=? AND kind=? AND idempotency=?').bind(sid,'chat',idem).first();if(existing)return reply(200,{job:publicJob(existing)});}
   await expireJobs(db,now);
   await rate('submit:'+sid,8,600000);
   const waiting=await db.prepare("SELECT COUNT(*) AS n FROM community_jobs WHERE status IN ('queued','running')").first();if(waiting.n>=40)throw new ApiError(429,'执行队列已满，请稍后再试');
   await rate('daily-inference',120,86400000);
   const id=random(),suggestionId=isSuggestion?random():null;
   const direct=push||env.REMOTE_RELAY_URL&&env.REMOTE_RELAY_TOKEN&&!(await relayState()).online;
   const token=push?'push:'+random():direct?random():null;
   // D1 executes the batch in one transaction. The count belongs inside the
   // write as several visitors can pass the earlier, cheap admission check.
   const statements=[
    db.prepare(`INSERT INTO community_jobs(id,session_id,suggestion_id,kind,input,scenario,status,created_at,updated_at,idempotency,lease_token,lease_until,attempts)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM community_jobs WHERE status IN ('queued','running'))<40`)
     .bind(id,sid,suggestionId,isSuggestion?'triage':'chat',input,s,direct?'running':'queued',now,now,idem,token,push?now+queueTtlMs:direct?now+remoteTimeoutMs+15_000:null,direct?1:0),
   ];
   if(isSuggestion)statements.push(db.prepare(`INSERT INTO community_suggestions(id,session_id,text,species,scenario,status,created_at,updated_at,idempotency)
    SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM community_jobs WHERE id=?)`)
    .bind(suggestionId,sid,input,sp,s,direct?'triaging':'received',now,now,idem,id));
   try{
    const [created]=await db.batch(statements);
    if(created.meta.changes!==1)throw new ApiError(429,'执行队列已满，请稍后再试');
   }catch(error){
    const existing=isSuggestion?await db.prepare('SELECT * FROM community_suggestions WHERE session_id=? AND idempotency=?').bind(sid,idem).first():await db.prepare('SELECT * FROM community_jobs WHERE session_id=? AND kind=? AND idempotency=?').bind(sid,'chat',idem).first();
    if(existing)return reply(200,isSuggestion?{suggestion:publicSuggestion(existing)}:{job:publicJob(existing)});
    throw error;
   }
   if(direct){
    const work=push?syncRemoteJob(db,env,{id,session_id:sid,input,scenario:s,kind:isSuggestion?'triage':'chat',status:'running',lease_token:token,created_at:now},true):completeRemotely(db,env,{id,sid,token,input,scenarioValue:s,isSuggestion});
    if(ctx?.waitUntil)ctx.waitUntil(work);else await work;
   }
   if(isSuggestion)return reply(201,{suggestion:publicSuggestion(await db.prepare('SELECT * FROM community_suggestions WHERE id=?').bind(suggestionId).first())});
   const record=await db.prepare('SELECT * FROM community_jobs WHERE id=?').bind(id).first();
   return reply(['failed','completed'].includes(record.status)?200:202,{job:publicJob(record)});
  }
  if(method==='GET'&&path==='/history'){const sid=await session();const rows=await db.prepare("SELECT * FROM community_jobs WHERE session_id=? AND kind='chat' ORDER BY created_at DESC LIMIT 12").bind(sid).all();return reply(200,{turns:rows.results.reverse().map(r=>({text:r.input,scenario:JSON.parse(r.scenario),job:publicJob(r)}))});}
  const chat=path.match(/^\/chat\/([\w-]+)$/);
  if(method==='GET'&&chat){
   const sid=await session(),query=db.prepare("SELECT * FROM community_jobs WHERE id=? AND session_id=? AND kind='chat'").bind(chat[1],sid);
   const row=await query.first();if(!row)throw new ApiError(404,'对话不存在');
   await syncRemoteJob(db,env,row);
   return reply(200,{job:publicJob(await query.first())});
  }
  if(!admin)throw new ApiError(401,'需要协调服务授权');
  if(method==='POST'&&path==='/relay/heartbeat'){const b=await body();const config={model:typeof b.model==='string'?b.model.slice(0,50):null,reasoningEffort:b.reasoningEffort==='high'?'high':null,availableAccounts:Math.max(0,Math.min(5,Number(b.availableAccounts)||0)),workers:Math.max(0,Math.min(20,Number(b.workers)||0))};await db.prepare('INSERT INTO community_relay VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,last_seen=excluded.last_seen').bind('leader',JSON.stringify(config),now).run();return reply(200,{ok:true});}
  if(method==='POST'&&path==='/relay/claim'){
   await body();
   await expireJobs(db,now);
   const sync=syncOldestPush(db,env,null);
   if(ctx?.waitUntil)ctx.waitUntil(sync);else await sync;
   const token=random();const row=await db.prepare("UPDATE community_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM community_jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *").bind(token,now+claimMs,now).first();
   if(row?.suggestion_id)await db.prepare("UPDATE community_suggestions SET status='triaging',updated_at=? WHERE id=?").bind(now,row.suggestion_id).run();
   const history=row?.kind==='chat'?await chatHistory(db,row.session_id,row.id):[];
   return reply(200,{job:row?{id:row.id,kind:row.kind,input:row.input,scenario:JSON.parse(row.scenario),history,suggestionId:row.suggestion_id,leaseToken:token}:null});
  }
  const completion=path.match(/^\/relay\/([\w-]+)\/complete$/);
  if(method==='POST'&&completion){
   const b=await body(),error=b.error?'执行失败，请稍后联系主控核查本次记录':null;
   const done=await finishLease(db,completion[1],text(b.leaseToken,120),error?null:text(b.reply,16000),error?[]:parseProposals(b.suggestions),error);
   if(!done)throw new ApiError(409,'租约已失效，拒绝覆盖其他执行结果');
   return reply(200,{ok:true});
  }
  if(method==='GET'&&path==='/relay/review'){const rows=await db.prepare("SELECT s.*,j.proposals FROM community_suggestions s JOIN community_jobs j ON j.suggestion_id=s.id WHERE s.status='awaiting_review' ORDER BY s.created_at LIMIT 30").all();return reply(200,{suggestions:rows.results.map(r=>({...publicSuggestion(r),proposals:JSON.parse(r.proposals||'[]')}))});}
  const progress=path.match(/^\/moderate\/([\w-]+)$/);
  if(method==='POST'&&progress){const b=await body();if(!stages.has(b.status))throw new ApiError(400,'无效状态');let deployment=null;try{deployment=b.deploymentUrl?new URL(b.deploymentUrl):null;}catch{throw new ApiError(400,'无效发布地址');}if(deployment&&(deployment.origin!=='https://raconiy.github.io'||!deployment.pathname.startsWith('/westlake-flora-lab/')))throw new ApiError(400,'无效发布地址');if(b.status==='deployed'&&!deployment)throw new ApiError(400,'发布状态需要可核验地址');const summary=b.summary?text(b.summary,12000):null;await db.prepare('UPDATE community_suggestions SET status=?,summary=COALESCE(?,summary),task_id=COALESCE(?,task_id),error=?,deployment_url=COALESCE(?,deployment_url),updated_at=? WHERE id=?').bind(b.status,summary,b.taskId?text(b.taskId,100):null,b.error?text(b.error,1000):null,deployment?.href||null,now,progress[1]).run();return reply(200,{ok:true});}
  throw new ApiError(404,'接口不存在');
 }catch(error){return reply(error.status||500,{error:error.status?error.message:'共享服务暂时未能完成请求，请稍后重试'});}
}};
