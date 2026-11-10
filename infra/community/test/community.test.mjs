import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';

async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())db.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 const statement=(sql,args=[])=>({bind(...v){return statement(sql,v);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}});
 const env={COMMUNITY_RELAY_TOKEN:'fixture-relay-token-with-sufficient-length',DB:{prepare:statement,async batch(stmts){db.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const api=async(path,body,token,origin='https://raconiy.github.io',ctx)=>{const r=await worker.fetch(new Request('https://flora.example/api/community'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);return {status:r.status,body:await r.json(),headers:r.headers};};
 const session=async()=>{const r=await api('/sessions',{});assert.equal(r.status,201);return r.body.token;};
 return {api,session,env,db};
}
test('separate visitors share suggestions, deduplicate submissions, and cannot read each other’s chats',async()=>{
 const {api,session}=await fixture(),a=await session(),b=await session();
 const item={text:'桂花叶柄应从相同叶节相对生长',species:'osmanthus',scenario:{species:'osmanthus',age:2,secret:'not persisted'},idempotencyKey:'first'};
 const one=await api('/suggestions',item,a),again=await api('/suggestions',item,a);
 assert.equal(one.status,201);assert.equal(again.status,200);assert.equal(one.body.suggestion.id,again.body.suggestion.id);
 assert.equal((await api('/suggestions')).body.suggestions.length,1);
 assert.ok(!JSON.stringify(one.body).includes(a));assert.ok(!JSON.stringify(one.body).includes('session'));
 const chat=await api('/chat',{message:'银杏为什么会落叶？',idempotencyKey:'chat',scenario:{}},a);
 assert.equal(chat.status,202);assert.equal((await api('/chat/'+chat.body.job.id,undefined,b)).status,404);
 assert.equal((await api('/chat/'+chat.body.job.id,undefined,a)).body.job.status,'queued');
});
test('leases are exclusive and fenced; public callers cannot complete or claim jobs',async()=>{
 const {api,session,env,db}=await fixture(),token=await session(),admin=env.COMMUNITY_RELAY_TOKEN;
 await api('/suggestions',{text:'检查幼苗枝条比例',species:'ginkgo',idempotencyKey:'x'},token);
 assert.equal((await api('/relay/claim',{},token)).status,401);
 const first=await api('/relay/claim',{},admin),second=await api('/relay/claim',{},admin);
 assert.ok(first.body.job);assert.equal(second.body.job,null);
 const id=first.body.job.id;
 assert.equal((await api('/relay/'+id+'/complete',{leaseToken:'stale',reply:'ok'},admin)).status,409);
 assert.equal((await api('/relay/'+id+'/complete',{leaseToken:first.body.job.leaseToken,reply:'已整理：请先校验幼树侧枝与主轴的比例',suggestions:[{title:'比例验证',prompt:'扫描年龄并检验',kind:'code'}]},admin)).status,200);
 assert.equal((await api('/suggestions')).body.suggestions[0].status,'awaiting_review');
 assert.equal((await api('/relay/'+id+'/complete',{leaseToken:first.body.job.leaseToken,reply:'重复'},admin)).status,409);
 await api('/chat',{message:'一项问题',idempotencyKey:'expire'},token);
 const lease=(await api('/relay/claim',{},admin)).body.job;
 db.prepare('UPDATE community_jobs SET lease_until=0 WHERE id=?').run(lease.id);
 assert.equal((await api('/relay/claim',{},admin)).body.job,null);
 assert.equal((await api('/chat/'+lease.id,undefined,token)).body.job.status,'failed');
});
test('origins, session authentication, secret rejection, limits and deployment evidence are enforced',async()=>{
 const {api,session,env}=await fixture(),token=await session();
 assert.equal((await api('/suggestions',{},undefined)).status,401);
 assert.equal((await api('/health',undefined,undefined,'https://untrusted.example')).status,403);
 assert.equal((await api('/suggestions',{text:'password=do-not-store',idempotencyKey:'x'},token)).status,400);
 assert.equal((await api('/moderate/unknown',{status:'deployed'},env.COMMUNITY_RELAY_TOKEN)).status,400);
 assert.equal((await api('/moderate/unknown',{status:'deployed',deploymentUrl:'https://untrusted.example/'},env.COMMUNITY_RELAY_TOKEN)).status,400);
 const health=await api('/health');assert.equal(health.body.relay.online,false);assert.equal(health.headers.get('access-control-allow-origin'),'https://raconiy.github.io');
 await api('/relay/heartbeat',{model:'gpt-6.1-sol',reasoningEffort:'high',availableAccounts:3,workers:3},env.COMMUNITY_RELAY_TOKEN);
 assert.equal((await api('/health')).body.relay.online,true);
 assert.equal((await api('/health')).body.relay.availableAccounts,3);
});
test('conversation recovery and model context stay scoped to the originating visitor',async()=>{
 const {api,session,env}=await fixture(),a=await session(),b=await session(),admin=env.COMMUNITY_RELAY_TOKEN;
 await api('/chat',{message:'桂花叶序？',idempotencyKey:'a1',scenario:{species:'osmanthus'}},a);
 const job=(await api('/relay/claim',{},admin)).body.job;
 await api('/relay/'+job.id+'/complete',{leaseToken:job.leaseToken,reply:'桂花的叶对生。',suggestions:[]},admin);
 await api('/chat',{message:'那叶柄呢？',idempotencyKey:'a2',scenario:{species:'osmanthus'}},a);
 const next=(await api('/relay/claim',{},admin)).body.job;
 assert.deepEqual(next.history,[{role:'user',content:'桂花叶序？'},{role:'assistant',content:'桂花的叶对生。'}]);
 assert.equal((await api('/history',undefined,a)).body.turns.length,2);
 assert.equal((await api('/history',undefined,b)).body.turns.length,0);
});

test('direct delivery returns its durable job immediately and shares one lease across retries and consumers',async t=>{
 const {api,session,env,db}=await fixture(),visitor=await session(),admin=env.COMMUNITY_RELAY_TOKEN;
 Object.assign(env,{REMOTE_RELAY_URL:'https://relay.example',REMOTE_RELAY_TOKEN:'fixture'});
 const sent=Promise.withResolvers(),finish=Promise.withResolvers(),background=[];
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://relay.example/complete');
  const data=JSON.parse(options.body);
  assert.equal(data.jobId,options.headers['idempotency-key']);
  calls++;sent.resolve(data);
  await finish.promise;
  return Response.json({reply:'叶片在短枝端部成簇。',suggestions:[]});
 });
 const input={message:'银杏的叶子长在哪？',idempotencyKey:'slow-chat'};
 const posted=await api('/chat',input,visitor,undefined,{waitUntil:p=>background.push(p)});
 const {job}=posted.body;assert.equal(posted.status,202);assert.equal(job.status,'running');
 const forwarded=await sent.promise;assert.equal(forwarded.jobId,job.id);assert.equal(forwarded.kind,'chat');
 assert.equal((await api('/relay/claim',{},admin)).body.job,null);
 const replay=await api('/chat',input,visitor);
 assert.equal(replay.body.job.id,job.id);assert.equal(replay.body.job.status,'running');assert.equal(calls,1);
 finish.resolve();await Promise.all(background);
 assert.equal((await api('/chat/'+job.id,undefined,visitor)).body.job.reply,'叶片在短枝端部成簇。');
 assert.equal(db.prepare('SELECT attempts FROM community_jobs WHERE id=?').get(job.id).attempts,1);
});

test('fresh consumer heartbeats select the persistent queue even with a configured /complete endpoint',async t=>{
 const {api,session,env}=await fixture(),visitor=await session(),admin=env.COMMUNITY_RELAY_TOKEN;
 Object.assign(env,{REMOTE_RELAY_URL:'https://relay.example',REMOTE_RELAY_TOKEN:'fixture'});
 const remote=t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected relay fetch');});
 await api('/relay/heartbeat',{availableAccounts:3,workers:1},admin);
 assert.equal((await api('/health')).body.relay.transport,'queue');
 const received=await api('/suggestions',{text:'调整桂花叶柄。',idempotencyKey:'proposal'},visitor);
 assert.equal(received.body.suggestion.status,'received');
 const job=(await api('/relay/claim',{},admin)).body.job;
 assert.equal(job.suggestionId,received.body.suggestion.id);
 assert.equal((await api('/relay/'+job.id+'/complete',{leaseToken:job.leaseToken,reply:'已记录叶柄调整建议。'},admin)).status,200);
 assert.equal((await api('/suggestions')).body.suggestions[0].status,'awaiting_review');
 assert.equal(remote.mock.callCount(),0);
});

test('remote failures become terminal and visible to both suggestions and chats without a second model call',async t=>{
 const {api,session,env}=await fixture(),visitor=await session(),admin=env.COMMUNITY_RELAY_TOKEN;
 Object.assign(env,{REMOTE_RELAY_URL:'https://relay.example',REMOTE_RELAY_TOKEN:'fixture'});
 const kinds=[];
 const remote=t.mock.method(globalThis,'fetch',async(_,options)=>{kinds.push(JSON.parse(options.body).kind);return new Response('private diagnostic',{status:503});});
 const msg={message:'树干为什么弯曲？',idempotencyKey:'error'};
 const chat=await api('/chat',msg,visitor);
 assert.equal(chat.body.job.status,'failed');assert.match(chat.body.job.error,/HTTP 503/);
 assert.equal((await api('/chat',msg,visitor)).body.job.id,chat.body.job.id);
 const suggestion=await api('/suggestions',{text:'调整树干弯度。',idempotencyKey:'proposal'},visitor);
 assert.equal(suggestion.body.suggestion.status,'failed');assert.match(suggestion.body.suggestion.error,/HTTP 503/);
 assert.ok(!suggestion.body.suggestion.error.includes('private diagnostic'));
 assert.equal((await api('/relay/claim',{},admin)).body.job,null);
 assert.equal(remote.mock.callCount(),2);assert.deepEqual(kinds,['chat','triage']);
});

test('polling expires an abandoned direct lease and fences a late upstream result',async t=>{
 const {api,session,env,db}=await fixture(),visitor=await session();
 Object.assign(env,{REMOTE_RELAY_URL:'https://relay.example',REMOTE_RELAY_TOKEN:'fixture'});
 const finish=Promise.withResolvers(),background=[];
 t.mock.method(globalThis,'fetch',async()=>{await finish.promise;return Response.json({reply:'late answer'});});
 const receipt=await api('/suggestions',{text:'校核植物比例。',idempotencyKey:'expiry'},visitor,undefined,{waitUntil:p=>background.push(p)});
 db.prepare('UPDATE community_jobs SET lease_until=0 WHERE suggestion_id=?').run(receipt.body.suggestion.id);
 assert.equal((await api('/suggestions')).body.suggestions[0].status,'failed');
 finish.resolve();await Promise.all(background);
 assert.equal((await api('/suggestions')).body.suggestions[0].status,'failed');
 assert.equal(db.prepare('SELECT status,reply FROM community_jobs WHERE suggestion_id=?').get(receipt.body.suggestion.id).reply,null);
});

test('offline queued jobs eventually surface a terminal reason to the visitor',async()=>{
 const {api,session,db}=await fixture(),visitor=await session();
 const submitted=await api('/chat',{message:'校园树冠是怎样分布的？',idempotencyKey:'unclaimed'},visitor);
 db.prepare('UPDATE community_jobs SET created_at=0 WHERE id=?').run(submitted.body.job.id);
 const expired=await api('/chat/'+submitted.body.job.id,undefined,visitor);
 assert.equal(expired.body.job.status,'failed');assert.match(expired.body.job.error,/未接单/);
});

test('concurrent visitors cannot exceed the queue limit or leave an orphaned suggestion',async()=>{
 const {api,session,db}=await fixture(),visitor=await session();
 const now=Date.now();
 for(let i=0;i<39;i++)db.prepare("INSERT INTO community_jobs(id,session_id,kind,input,scenario,status,created_at,updated_at,idempotency) VALUES(?,'old','chat','x','{}','queued',?,?,?)").run(String(i),now,now,String(i));
 const requests=await Promise.all([
  api('/chat',{message:'树冠密度？',idempotencyKey:'limit-chat'},visitor),
  api('/suggestions',{text:'检查叶序。',idempotencyKey:'limit-suggestion'},visitor),
 ]);
 assert.equal(requests.filter(r=>r.status===429).length,1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM community_jobs').get().n,40);
 assert.equal(db.prepare('SELECT count(*) AS n FROM community_suggestions s WHERE NOT EXISTS (SELECT 1 FROM community_jobs j WHERE j.suggestion_id=s.id)').get().n,0);
});
