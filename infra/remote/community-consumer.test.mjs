import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {countAvailable,completionBody,createConsumer,curlConfig} from './community-consumer.mjs';

function job(){return {id:randomUUID(),leaseToken:randomUUID(),input:'桂花是什么叶序？',scenario:{species:'osmanthus'},kind:'chat',history:[]};}
async function directory(t){const path=await mkdtemp(join(tmpdir(),'flora-result-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}

test('counts distinct available credential IDs from management status and requires a recognizable response',()=>{
 assert.equal(countAvailable({code:0,data:{items:[{credential_id:1,effective_status:'available',auth_state:'ready'},{credential_id:1,effective_status:'available'},{credential_id:2,effective_status:'cooldown'},{credential_id:3,effective_status:'available',auth_state:'invalid'}]}}),1);
 assert.throws(()=>countAvailable({availableAccounts:5}));assert.throws(()=>countAvailable({code:0,data:{items:[{}]}}));
});

test('model completion survives consumer restart and transient D1 failure without a second inference',async t=>{
 const dir=await directory(t),queued=[job()],id=queued[0].id;
 queued[0].kind='triage';
 let infer=0,deliver=0,clock=0;const beats=[],answers=[];
 const cfg={dir,report:()=>{},now:()=>clock,probe:async()=>1,complete:async body=>{infer++;assert.equal(body.jobId,id);assert.equal(body.kind,'triage');return {reply:'桂花的叶片对生。'};},
  callCommunity:async(path,b)=>{
   if(path==='/relay/heartbeat'){beats.push(b);return {};}
   if(path==='/relay/claim')return {job:queued.shift()||null};
   assert.equal(path,'/relay/'+id+'/complete');deliver++;
   if(deliver===1)throw Object.assign(Error(),{status:503});
   answers.push(b);return {ok:true};
  }};
 const first=createConsumer(cfg);await first.tick();await first.drain();
 assert.deepEqual(await readdir(dir),[id+'.json']);
 const restarted=createConsumer(cfg);
 await restarted.tick();await restarted.tick();assert.equal(deliver,1);
 clock+=2_000;await restarted.tick();
 assert.equal(infer,1);assert.equal(deliver,2);assert.equal(answers[0].reply,'桂花的叶片对生。');assert.deepEqual(await readdir(dir),[]);
 assert.equal(beats[0].availableAccounts,1);
});

test('gateway and relay outages publish zero capacity and do not claim; recovery claims only actual capacity',async t=>{
 const dir=await directory(t),queued=[job(),job(),job()];let clock=0,claims=0,online=false;
 const heartbeats=[],unblock=Promise.withResolvers();
 const consumer=createConsumer({dir,report:()=>{},now:()=>clock,probe:async()=>{if(!online)throw Error();return 2;},
  callCommunity:async(path,b)=>{if(path==='/relay/heartbeat'){heartbeats.push(b);return {};}if(path==='/relay/claim'){claims++;return {job:queued.shift()||null};}return {};},
  complete:()=>unblock.promise});
 await consumer.tick();assert.equal(heartbeats.at(-1).availableAccounts,0);assert.equal(claims,0);
 online=true;clock+=13_000;await consumer.tick();assert.equal(heartbeats.at(-1).availableAccounts,2);assert.equal(claims,2);
 unblock.resolve({reply:'已处理'});await consumer.drain();await consumer.deliver();
});

test('a lost D1 acknowledgement receives fencing, and an unavailable model returns one failed lease',async t=>{
 const dir=await directory(t),queued=[job()];let clock=0,calls=0,acks=0;
 const consumer=createConsumer({dir,report:()=>{},now:()=>clock,probe:async()=>1,
  complete:async()=>{calls++;throw Error('connection interrupted');},
  callCommunity:async(path,b)=>{
   if(path==='/relay/heartbeat')return {};
   if(path==='/relay/claim')return {job:queued.shift()||null};
   acks++;assert.equal(b.error,true);
   if(acks===1)throw TypeError('answer not confirmed');
   throw Object.assign(Error(),{status:409});
  }});
 await consumer.tick();await consumer.drain();await consumer.deliver();
 clock+=2_000;await consumer.deliver();assert.equal(calls,1);assert.equal(acks,2);assert.deepEqual(await readdir(dir),[]);
});

test('large Chinese replies and proposals fit D1 byte limits without breaking Unicode',()=>{
 const body=completionBody('lease',{reply:'🌿'.repeat(15_000),suggestions:[{title:'调整',kind:'code',prompt:'植'.repeat(8_000)}]});
 assert.ok(Buffer.byteLength(JSON.stringify(body))<=17_500);assert.ok(body.reply.endsWith('已截短。）'));assert.ok(!body.reply.includes('�'));
 assert.throws(()=>completionBody('lease',{reply:'已收到建议，但没有生成可展示的回复。'}));
});

test('curl reads the private config over stdin and preserves quoted, multiline member text',async t=>{
 const data={reply:'「叶片」\n"quoted"\\path\tline',suggestions:[]};
 const received=Promise.withResolvers();
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  received.resolve({auth:req.headers.authorization,body:JSON.parse(Buffer.concat(chunks).toString())});res.end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const child=spawn('/usr/bin/curl',['--disable','--silent','--noproxy','*','--max-time','3','--config','-','http://127.0.0.1:'+server.address().port],{stdio:['pipe','ignore','ignore']});
 child.stdin.end(curlConfig('fixture-token',data));
 const [code]=await once(child,'exit');assert.equal(code,0);
 assert.deepEqual(await received.promise,{auth:'Bearer fixture-token',body:data});
 assert.throws(()=>curlConfig('token\nheader = "extra"',{}));
});
