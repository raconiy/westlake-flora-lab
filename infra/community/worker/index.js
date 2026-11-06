const species = new Set(['ginkgo','osmanthus','iris','oxalis','camphor','acer','ophiopogon']);
const stages = new Set(['received','triaging','awaiting_review','queued','running','validating','review','failed','deployed']);
const base='/api/community';
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const hash=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const random=()=>crypto.randomUUID();
class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
const text=(s,max=6000)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw new ApiError(400,'请输入有效文本，最多 '+max+' 字符');return s.trim();};
function checkSecrets(s){if(/(?:password|密码|验证码|2fa)\s*[:：=]\s*\S+|\bsk-[\w-]{12,}|-----BEGIN .*PRIVATE KEY/i.test(s))throw new ApiError(400,'请勿提交密码、验证码或密钥');}
function scenario(s){const out={};if(s&&typeof s==='object'){if(species.has(s.species))out.species=s.species;for(const k of ['age','day','seed','density','wind','gravity','stiffness','moisture','compaction','soilDepth'])if(typeof s[k]==='number'&&Number.isFinite(s[k]))out[k]=s[k];}return JSON.stringify(out);}
// A member id is a public author label, never permission to recover a session.
// Legacy rows used opaque UUIDs as session ids and remain readable.
const memberOf=id=>id.split('.')[0];
const publicSuggestion=r=>({id:r.id,text:r.text,species:r.species,memberId:memberOf(r.session_id),status:r.status,summary:r.summary??undefined,taskId:r.task_id??undefined,error:r.error??undefined,deploymentUrl:r.deployment_url??undefined,createdAt:new Date(r.created_at).toISOString(),updatedAt:new Date(r.updated_at).toISOString()});
const publicJob=r=>({id:r.id,status:r.status,reply:r.reply??undefined,error:r.error??undefined,suggestions:r.proposals?JSON.parse(r.proposals):[],createdAt:r.created_at});
export default {async fetch(request,env){
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
  if(method==='GET'&&path==='/health'){const row=await db.prepare('SELECT * FROM community_relay WHERE id=?').bind('leader').first();const value=row?JSON.parse(row.payload):{};return reply(200,{ok:true,storage:'D1',relay:{...value,online:!!row&&now-row.last_seen<45000,lastSeen:row?.last_seen??null}});}
  if(method==='GET'&&path==='/suggestions'){const rows=await db.prepare('SELECT * FROM community_suggestions ORDER BY created_at DESC LIMIT 100').all();return reply(200,{suggestions:rows.results.map(publicSuggestion)});}
  if(method==='POST'&&path==='/sessions'){
   if(!secret)throw new ApiError(503,'共享服务尚未配置');const requested=await body();
   const ip=await hash(secret+':'+(request.headers.get('cf-connecting-ip')||'unknown'));await rate('sessions:'+ip,12,600000);
   const requestedMember=typeof requested.memberId==='string'&&/^m_[A-Za-z0-9_-]{16,80}$/.test(requested.memberId)?requested.memberId:null;
   const existing=requestedMember?await db.prepare('SELECT id FROM community_sessions WHERE substr(id,1,?)=? LIMIT 1').bind(requestedMember.length+1,requestedMember+'.').first():null;
   const memberId=existing?requestedMember:'m_'+random().replaceAll('-','');
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
   await rate('submit:'+sid,8,600000);await rate('daily-inference',120,86400000);
   const waiting=await db.prepare("SELECT COUNT(*) AS n FROM community_jobs WHERE status IN ('queued','running')").first();if(waiting.n>=40)throw new ApiError(429,'执行队列已满，请稍后再试');
   const id=random(),suggestionId=isSuggestion?random():null;
   const statements=[];
   if(isSuggestion)statements.push(db.prepare('INSERT INTO community_suggestions(id,session_id,text,species,scenario,status,created_at,updated_at,idempotency) VALUES(?,?,?,?,?,?,?,?,?)').bind(suggestionId,sid,input,sp,s,'received',now,now,idem));
   statements.push(db.prepare('INSERT INTO community_jobs(id,session_id,suggestion_id,kind,input,scenario,status,created_at,updated_at,idempotency) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,sid,suggestionId,isSuggestion?'triage':'chat',input,s,'queued',now,now,idem));
   try{await db.batch(statements);}catch(error){const existing=isSuggestion?await db.prepare('SELECT * FROM community_suggestions WHERE session_id=? AND idempotency=?').bind(sid,idem).first():await db.prepare('SELECT * FROM community_jobs WHERE session_id=? AND kind=? AND idempotency=?').bind(sid,'chat',idem).first();if(existing)return reply(200,isSuggestion?{suggestion:publicSuggestion(existing)}:{job:publicJob(existing)});throw error;}
   return isSuggestion?reply(201,{suggestion:publicSuggestion(await db.prepare('SELECT * FROM community_suggestions WHERE id=?').bind(suggestionId).first())}):reply(202,{job:{id,status:'queued'}});
  }
  if(method==='GET'&&path==='/history'){const sid=await session();const rows=await db.prepare("SELECT * FROM community_jobs WHERE session_id=? AND kind='chat' ORDER BY created_at DESC LIMIT 12").bind(sid).all();return reply(200,{turns:rows.results.reverse().map(r=>({text:r.input,scenario:JSON.parse(r.scenario),job:publicJob(r)}))});}
  const chat=path.match(/^\/chat\/([\w-]+)$/);
  if(method==='GET'&&chat){const sid=await session(),row=await db.prepare('SELECT * FROM community_jobs WHERE id=? AND session_id=? AND kind=?').bind(chat[1],sid,'chat').first();if(!row)throw new ApiError(404,'对话不存在');return reply(200,{job:publicJob(row)});}
  if(!admin)throw new ApiError(401,'需要协调服务授权');
  if(method==='POST'&&path==='/relay/heartbeat'){const b=await body();const config={model:typeof b.model==='string'?b.model.slice(0,50):null,reasoningEffort:b.reasoningEffort==='high'?'high':null,availableAccounts:Math.max(0,Math.min(5,Number(b.availableAccounts)||0)),workers:Math.max(0,Math.min(20,Number(b.workers)||0))};await db.prepare('INSERT INTO community_relay VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,last_seen=excluded.last_seen').bind('leader',JSON.stringify(config),now).run();return reply(200,{ok:true});}
  if(method==='POST'&&path==='/relay/claim'){
   await body();
   // Never re-execute an ambiguous paid call when a relay dies after forwarding it.
   await db.batch([db.prepare("UPDATE community_suggestions SET status='failed',error='执行租约中断；结果待核查，不自动重复调用',updated_at=? WHERE id IN (SELECT suggestion_id FROM community_jobs WHERE status='running' AND lease_until<?)").bind(now,now),db.prepare("UPDATE community_jobs SET status='failed',error='执行租约中断；结果待核查，不自动重复调用',lease_token=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<?").bind(now,now)]);
   const token=random();const row=await db.prepare("UPDATE community_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=(SELECT id FROM community_jobs WHERE status='queued' ORDER BY created_at LIMIT 1) AND status='queued' RETURNING *").bind(token,now+240000,now).first();
   if(row?.suggestion_id)await db.prepare("UPDATE community_suggestions SET status='triaging',updated_at=? WHERE id=?").bind(now,row.suggestion_id).run();
   let history=[];if(row?.kind==='chat'){const previous=await db.prepare("SELECT input,reply FROM community_jobs WHERE session_id=? AND kind='chat' AND status='completed' AND id<>? ORDER BY created_at DESC LIMIT 6").bind(row.session_id,row.id).all();history=previous.results.reverse().flatMap(r=>[{role:'user',content:r.input},{role:'assistant',content:r.reply}]);}
   return reply(200,{job:row?{id:row.id,kind:row.kind,input:row.input,scenario:JSON.parse(row.scenario),history,suggestionId:row.suggestion_id,leaseToken:token}:null});
  }
  const completion=path.match(/^\/relay\/([\w-]+)\/complete$/);
  if(method==='POST'&&completion){const b=await body(),answer=b.error?null:text(b.reply,16000);const proposals=Array.isArray(b.suggestions)?b.suggestions.slice(0,5).map(p=>({title:text(p.title,200),prompt:text(p.prompt,8000),kind:['code','research'].includes(p.kind)?p.kind:'research'})):[];const error=b.error?'执行失败，请稍后联系主控核查本次记录':null;
   const row=await db.prepare("UPDATE community_jobs SET status=?,reply=?,proposals=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_until>? RETURNING *").bind(error?'failed':'completed',answer,JSON.stringify(proposals),error,now,completion[1],b.leaseToken,now).first();if(!row)throw new ApiError(409,'租约已失效，拒绝覆盖其他执行结果');
   if(row.suggestion_id)await db.prepare('UPDATE community_suggestions SET status=?,summary=?,error=?,updated_at=? WHERE id=?').bind(error?'failed':'awaiting_review',answer,error,now,row.suggestion_id).run();return reply(200,{ok:true});
  }
  if(method==='GET'&&path==='/relay/review'){const rows=await db.prepare("SELECT s.*,j.proposals FROM community_suggestions s JOIN community_jobs j ON j.suggestion_id=s.id WHERE s.status='awaiting_review' ORDER BY s.created_at LIMIT 30").all();return reply(200,{suggestions:rows.results.map(r=>({...publicSuggestion(r),proposals:JSON.parse(r.proposals||'[]')}))});}
  const progress=path.match(/^\/moderate\/([\w-]+)$/);
  if(method==='POST'&&progress){const b=await body();if(!stages.has(b.status))throw new ApiError(400,'无效状态');const deployment=b.deploymentUrl?new URL(b.deploymentUrl):null;if(deployment&&(deployment.origin!=='https://raconiy.github.io'||!deployment.pathname.startsWith('/westlake-flora-lab/')))throw new ApiError(400,'无效发布地址');if(b.status==='deployed'&&!deployment)throw new ApiError(400,'发布状态需要可核验地址');const summary=b.summary?text(b.summary,12000):null;await db.prepare('UPDATE community_suggestions SET status=?,summary=COALESCE(?,summary),task_id=COALESCE(?,task_id),error=?,deployment_url=COALESCE(?,deployment_url),updated_at=? WHERE id=?').bind(b.status,summary,b.taskId?text(b.taskId,100):null,b.error?text(b.error,1000):null,deployment?.href||null,now,progress[1]).run();return reply(200,{ok:true});}
  throw new ApiError(404,'接口不存在');
 }catch(error){return reply(error.status||500,{error:error.status?error.message:'共享服务暂时未能完成请求，请稍后重试'});}
}};
