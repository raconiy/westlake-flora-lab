import {test} from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createCoordinator} from '../coordinator.mjs';
import {runCodex,runProcess} from '../codex.mjs';
import {executeTask} from '../worker.mjs';

async function start(t,options={}){const app=createCoordinator({dbPath:':memory:',...options});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;const req=async(path,body,headers={})=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};return{app,req,base};}

test('queue persistence, exclusive worker lease, expiry fencing and retry exhaustion',async t=>{
  let time=1000;const{req}=await start(t,{now:()=>time,leaseSeconds:2,maxAttempts:2});
  const{data:{task}}=await req('/api/suggestions',{text:'完善银杏长短枝形态',kind:'code'});
  await req('/api/workers/register',{id:'a',label:'甲'});await req('/api/workers/register',{id:'b',label:'乙'});
  const first=(await req('/api/lease',{workerId:'a'})).data.task;
  assert.equal(first.id,task.id);assert.equal((await req('/api/lease',{workerId:'a'})).status,409);
  assert.equal((await req('/api/lease',{workerId:'b'})).data.task,null);
  time+=3000;const second=(await req('/api/lease',{workerId:'b'})).data.task;
  assert.equal(second.attempts,2);assert.notEqual(first.leaseToken,second.leaseToken);
  assert.equal((await req(`/api/tasks/${task.id}/complete`,{workerId:'a',leaseToken:first.leaseToken,status:'completed',result:{}})).status,409);
  time+=3000;assert.equal((await req('/api/tasks')).data.tasks[0].status,'failed');
});

test('heartbeat extends lease, completed results persist, cancellation fences completion',async t=>{
  let time=1000;const{req}=await start(t,{now:()=>time,leaseSeconds:2});await req('/api/workers/register',{id:'a',label:'甲'});
  const id=(await req('/api/suggestions',{text:'测量叶长'})).data.task.id;
  const leased=(await req('/api/lease',{workerId:'a'})).data.task;time+=1500;
  assert.equal((await req('/api/workers/a/heartbeat',{taskId:id,leaseToken:leased.leaseToken})).status,200);
  time+=1000;assert.equal((await req(`/api/tasks/${id}/complete`,{workerId:'a',leaseToken:leased.leaseToken,status:'validation_failed',result:{error:'test failed'}})).status,200);
  assert.equal((await req('/api/tasks')).data.tasks[0].status,'validation_failed');
  const cancelled=(await req('/api/suggestions',{text:'取消这个测试'})).data.task;const l2=(await req('/api/lease',{workerId:'a'})).data.task;
  await req(`/api/tasks/${cancelled.id}/cancel`,{});
  assert.equal((await req(`/api/tasks/${cancelled.id}/complete`,{workerId:'a',leaseToken:l2.leaseToken,status:'completed',result:{}})).status,409);
});

test('CORS, host rejection, token check, JSON size and shared snapshots',async t=>{
  const{req,base}=await start(t,{token:'a'.repeat(24)});
  assert.equal((await req('/api/health')).status,401);
  const auth={Authorization:`Bearer ${'a'.repeat(24)}`};
  assert.equal((await req('/api/health',undefined,{...auth,Origin:'https://evil.example'})).status,403);
  const rebound=await new Promise(resolve=>{http.get(base+'/api/health',{headers:{...auth,Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);});});assert.equal(rebound,403);
  const good=await fetch(base+'/api/health',{headers:{...auth,Origin:'http://127.0.0.1:5173'}});assert.equal(good.headers.get('access-control-allow-origin'),'http://127.0.0.1:5173');
  assert.equal((await req('/api/suggestions',{text:'a'.repeat(70000)},auth)).status,413);
  assert.equal((await req('/api/snapshots',{label:'银杏秋季',scenario:{ageYears:12,dayOfYear:300}},auth)).status,201);
  assert.equal((await req('/api/snapshots',undefined,auth)).data.snapshots[0].scenario.dayOfYear,300);
});

test('chat model adapter receives read-only sandbox and atomically queues structured suggestions',async t=>{
  let calls=0;const{req}=await start(t,{runCodex:async(prompt,options)=>{calls++;assert.equal(options.sandbox,'read-only');assert.ok(prompt.includes('扇形'));return{text:JSON.stringify({reply:'已整理建议。',suggestions:[{title:'改进银杏叶',prompt:'将银杏叶生成器改成扇形，并检查叶序。',kind:'code'}]}),usage:null};}});
  const result=await req('/api/chat',{message:'将叶片改为扇形',scenario:{species:'ginkgo'}});assert.equal(result.status,200);assert.equal(result.data.tasks.length,1);assert.equal(calls,1);
  assert.equal((await req('/api/messages')).data.messages.length,2);
});

test('malformed model output creates no partial queue records',async t=>{
  const{req}=await start(t,{runCodex:async()=>({text:JSON.stringify({reply:'x',suggestions:[{title:'valid',prompt:'valid',kind:'code'},{title:'invalid',prompt:'invalid',kind:'shell'}]})})});
  assert.equal((await req('/api/chat',{message:'修改'})).status,502);assert.equal((await req('/api/tasks')).data.tasks.length,0);
});

test('SQLite records survive coordinator restart',async()=>{
  const folder=mkdtempSync(resolve(tmpdir(),'flora-db-')),dbPath=resolve(folder,'swarm.sqlite');
  const a=createCoordinator({dbPath});a.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?)').run('id','label','{"x":1}',1);a.db.close();
  const b=createCoordinator({dbPath});assert.equal(b.db.prepare('SELECT label FROM snapshots').get().label,'label');b.db.close();rmSync(folder,{recursive:true,force:true});
});

test('process timeout and Codex JSONL extraction use real child processes with test fixtures',async t=>{
  const folder=mkdtempSync(resolve(tmpdir(),'flora-cli-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const fixture=resolve(folder,'codex-fixture');writeFileSync(fixture,`#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture answer'}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1}}));});\n`,{mode:0o755});
  const result=await runCodex('hello',{root:folder,binary:fixture});assert.equal(result.text,'fixture answer');
  const timed=await runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:30});assert.equal(timed.timedOut,true);
});

test('code task runs in an isolated Git worktree; failing validation is explicit and never merges',async t=>{
  const folder=mkdtempSync(resolve(tmpdir(),'flora-worktree-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));const repo=resolve(folder,'repo');
  const run=(args)=>runProcess('git',args,{timeoutMs:10000});
  await run(['init',repo]);await run(['-C',repo,'config','user.email','test@example.invalid']);await run(['-C',repo,'config','user.name','Infra test']);writeFileSync(resolve(repo,'plant.txt'),'original');await run(['-C',repo,'add','.']);await run(['-C',repo,'commit','-m','initial']);
  const result=await executeTask({id:'task-test',kind:'code',prompt:'change plant'},{root:repo,worktreeRoot:resolve(folder,'trees'),autoValidate:true,validationCommands:[[process.execPath,'-e','process.exit(2)']]},{runCodex:async(_prompt,opts)=>{assert.equal(opts.sandbox,'workspace-write');assert.notEqual(opts.root,repo);writeFileSync(resolve(opts.root,'plant.txt'),'modified');return{text:'changed',usage:null};}});
  assert.equal(result.status,'validation_failed');assert.equal(result.result.merged,false);assert.equal((await run(['-C',repo,'status','--porcelain'])).stdout,'');
});
