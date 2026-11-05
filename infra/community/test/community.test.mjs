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
 const api=async(path,body,token,origin='https://raconiy.github.io')=>{const r=await worker.fetch(new Request('https://flora.example/api/community'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,body:await r.json(),headers:r.headers};};
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
