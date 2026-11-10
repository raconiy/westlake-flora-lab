import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtemp,readdir,rm,stat} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createRelay} from './remote-reply.mjs';
import {openJobs} from './relay-jobs.mjs';

async function privateDir(t){
 const dir=await mkdtemp(join(tmpdir(),'relay-jobs-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));return dir;
}
async function until(fn){
 for(let i=0;i<200;i++){if(await fn())return;await wait(5);}
 throw Error('test state transition timed out');
}
async function listening(t,upstream,stateDir){
 const server=createRelay({token:'site-token',gatewayToken:'gateway',readAdminKey:async()=>'admin',stateDir,
  fetchImpl:(url,options)=>url.pathname.includes('/credentials')
   ?Promise.resolve(Response.json({code:0,data:{items:[]}})):upstream(options)});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 return async(path,body,token='site-token')=>{
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json()};
 };
}
const answer=()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'根系锚定。'}]}]});

test('authenticated async POST/GET, canonical idempotency, receipt layout and capability advertisement',async t=>{
 const dir=await privateDir(t),id=randomUUID(),path='/jobs/'+id;
 let resolveCall,count=0;
 const call=await listening(t,()=>{count++;return new Promise(resolve=>{resolveCall=resolve;});},dir);
 assert.equal((await call('/health')).data.asyncJobs,true);
 assert.equal((await call(path,undefined,'wrong')).status,401);
 assert.equal((await call(path,{input:'不能新增'},'wrong')).status,401);
 assert.equal((await call(path)).status,404);
 const b={input:'树为什么不移位？',scenario:{age:12,wind:4}};
 assert.deepEqual(await call(path,b),{status:202,data:{status:'queued'}});
 await until(()=>resolveCall);
 assert.deepEqual(await call(path.toUpperCase().replace('/JOBS/','/jobs/'),{input:b.input,scenario:{wind:4,age:12}}),{status:202,data:{status:'running'}});
 assert.equal((await call(path,{input:'另一条'})).status,409);
 assert.equal((await call(path)).data.status,'running');
 resolveCall(answer());await until(async()=>(await call(path)).data.status==='completed');
 const completed={status:200,data:{status:'completed',reply:'根系锚定。',suggestions:[]}};
 assert.deepEqual(await call(path,b),completed);assert.deepEqual(await call(path),completed);assert.equal(count,1);
 for(const file of await readdir(dir)){assert.equal((await stat(join(dir,file))).mode&0o077,0);}
 const db=new DatabaseSync(join(dir,'jobs.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(db.prepare('SELECT payload FROM jobs').get().payload,null);}
 finally{db.close();}
 const old=await listening(t,answer);
 assert.equal((await old('/health')).data.asyncJobs,undefined);assert.equal((await old(path,b)).status,404);
});
test('model and synchronous clients share five calls, backpressure does not drop queued requests',async t=>{
 const dir=await privateDir(t),gates=[];let active=0,peak=0;
 const call=await listening(t,async()=>{active++;peak=Math.max(peak,active);
  await new Promise(r=>gates.push(r));active--;return answer();},dir);
 const sync=call('/complete',{input:'旧客户端'});await until(()=>gates.length===1);
 const paths=Array.from({length:6},()=>'/jobs/'+randomUUID());
 await Promise.all(paths.map(p=>call(p,{input:'排队'})));
 await until(()=>gates.length===5);
 const states=await Promise.all(paths.map(p=>call(p)));
 assert.equal(states.filter(s=>s.data.status==='queued').length,2);
 assert.equal((await call('/complete',{input:'额外同步请求'})).status,429);
 gates[0]();await sync;await until(()=>gates.length===6);gates[1]();await until(()=>gates.length===7);
 gates.forEach(release=>release());await until(async()=>(await Promise.all(paths.map(p=>call(p)))).every(x=>x.data.status==='completed'));assert.equal(peak,5);
});
test('upstream unavailability becomes a persistent terminal failed receipt',async t=>{
 const dir=await privateDir(t),p='/jobs/'+randomUUID();let calls=0;
 const call=await listening(t,()=>{calls++;return Promise.resolve(new Response(null,{status:503}));},dir);
 await call(p,{input:'模拟'});await until(async()=>(await call(p)).data.status==='failed');
 const failure={status:200,data:{status:'failed',error:'gateway_http_503'}};
 assert.deepEqual(await call(p),failure);assert.deepEqual(await call(p,{input:'模拟'}),failure);assert.equal(calls,1);
});
test('exclusive startup, restart recovery, queue bound and expiration at retention deadline',async t=>{
 const dir=await privateDir(t);let slots=0,time=10,resume;
 const a=randomUUID(),b=randomUUID(),c=randomUUID();
 let q=openJobs({dir,maxPending:2,maxTotal:2,ttl:100,now:()=>time,hasSlot:()=>slots>0,
  run:()=>{slots--;return new Promise(resolve=>{resume=resolve;});}});
 assert.throws(()=>openJobs({dir,hasSlot:()=>false,run:()=>{}}));
 try{
  q.submit(a,{input:'a'});q.submit(b,{input:'b'});
  assert.throws(()=>q.submit(c,{input:'c'}),{status:503,code:'job_capacity_exceeded'});
  slots=1;q.wake();await until(()=>resume);assert.equal(q.get(a).status,'running');assert.equal(q.get(b).status,'queued');
 }finally{q.close();}
 slots=1;let seen=[];q=openJobs({dir,maxPending:2,maxTotal:2,ttl:100,now:()=>time,hasSlot:()=>slots>0,
  run:async job=>{slots--;seen.push(job.input);return {reply:'保留',suggestions:[]};}});
 try{
  resume({reply:'旧进程'});await until(()=>q.get(b).status==='completed');
  assert.deepEqual(q.get(a),{status:'failed',error:'relay_restarted'});assert.deepEqual(seen,['b']);
  assert.throws(()=>q.submit(c,{input:'c'}),{status:503});
  time=109;assert.equal(q.get(b).reply,'保留');time=110;assert.equal(q.get(a),null);assert.equal(q.get(b),null);
  assert.deepEqual(q.submit(c,{input:'c'}),{status:'queued'});
 }finally{q.close();}
});
test('SIGKILL and real process restart return failed in-flight receipts and execute the persisted queue once',async t=>{
 const {spawn}=await import('node:child_process');
 const {createServer}=await import('node:http');
 const {fileURLToPath}=await import('node:url');
 const {writeFile}=await import('node:fs/promises');
 const dir=await privateDir(t);
 const adminFile=join(dir,'fixture-auth');
 await writeFile(adminFile,'test-status',{mode:0o600});
 const seen=new Map();let recovering=false;
 const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const prompt=JSON.parse(Buffer.concat(chunks).toString());
  const {user}=JSON.parse(prompt.input);seen.set(user,(seen.get(user)||0)+1);
  if(recovering){res.writeHead(200,{'content-type':'application/json'});res.end(await answer().text());}
 });
 provider.listen(0,'127.0.0.1');await once(provider,'listening');
 t.after(()=>{provider.closeAllConnections();return new Promise(r=>provider.close(r));});
 const portProbe=createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');
 const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
 async function start(){
  const sub=spawn(process.execPath,[fileURLToPath(new URL('./remote-reply.mjs',import.meta.url))],{
   env:{RELAY_PORT:String(port),GPT_LOAD_URL:'http://127.0.0.1:'+provider.address().port+'/v1/responses',
    COMMUNITY_RELAY_TOKEN:'site-token',GPT_LOAD_ACCESS_KEY:'test-key',GPT_LOAD_STATUS_KEY_FILE:adminFile,WESTLAKE_RELAY_STATE_DIR:dir},
   stdio:['ignore','pipe','ignore']});
  const started=once(sub.stdout,'data'),died=once(sub,'exit');
  await Promise.race([started,died.then(()=>{throw Error('Fixture relay exited before listening');})]);
  return sub;
 }
 async function call(path,body){
  const r=await fetch('http://127.0.0.1:'+port+path,{method:body?'POST':'GET',headers:{authorization:'Bearer site-token','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(r.ok);return r.json();
 }
 const paths=Array.from({length:6},()=>'/jobs/'+randomUUID());
 let child=await start();
 t.after(async()=>{if(child.exitCode==null&&child.signalCode==null){const died=once(child,'exit');child.kill('SIGKILL');await died;}});
 for(const [i,path] of paths.entries())await call(path,{input:'plant-'+i});
 await until(()=>seen.size===5);assert.equal((await call(paths[5])).status,'queued');
 const died=once(child,'exit');child.kill('SIGKILL');await died;
 recovering=true;child=await start();await until(async()=>(await call(paths[5])).status==='completed');
 for(const path of paths.slice(0,5))assert.deepEqual(await call(path),{status:'failed',error:'relay_restarted'});
 assert.equal(seen.size,6);assert.deepEqual([...seen.values()],[1,1,1,1,1,1]);
});
