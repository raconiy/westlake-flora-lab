import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hash,model,roles} from './artifact.mjs';
import {inferenceServer} from './inference.mjs';
import {durableAttempt} from './worker.mjs';

const record={id:'fixed',subject:'root',property:'contact',value:'0',unit:'m',provenance:'engineering_prior',basis:'fixture',acceptance:'in contact'};
const artifact={title:'contact',summary:'test measured displacement',records:['r1','r2','r3'].map(id=>({...record,id})),limitations:['uncalibrated']};
const task={id:randomUUID(),kind:'research',title:'root contact',prompt:'asset data',role:'physics',priorDeliveries:[]};
const raw=JSON.stringify(artifact);
function gatewayResponse({text=raw,usage={input_tokens:4,output_tokens:16}}={}){
  return Response.json({id:'r1',status:'completed',model,output:[{type:'message',content:[{type:'output_text',text}]}],usage},{headers:{'x-request-id':'req-fixture'}});
}
async function helper(t,fetcher){
  const server=inferenceServer({token:'backend-only',publicContext:Object.fromEntries(roles.map(role=>[role,{source:'approved public input'}])),fetcher});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  return (body,path='/research')=>fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
}
test('a role generates data with receipts and never forwards shell/tools or lease material',async t=>{
  let calls=0;
  const send=await helper(t,async(url,init)=>{
    calls++;assert.equal(url,'http://127.0.0.1:3001/v1/responses');
    const request=JSON.parse(init.body);assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.reasoning.effort,'high');
    assert.equal(request.tools,undefined);assert.ok(!init.body.includes('secret-lease'));assert.equal(request.text.format.strict,true);
    return gatewayResponse();
  });
  const r=await send({...task,leaseToken:'secret-lease'});assert.equal(r.status,200);
  const result=await r.json();assert.equal(result.kind,'research_artifact');assert.deepEqual(result.artifact,artifact);assert.equal(result.modelOutput,raw);
  assert.equal(result.fullOutput.sha256,hash(raw));assert.equal(result.inferenceReceipt.requestId,'req-fixture');assert.equal(result.merged,false);
  assert.equal(calls,1);
});
test('invalid role, code tasks, admin routes, missing usage and malformed records are rejected',async t=>{
  let n=0;const send=await helper(t,async()=>{n++;return n===1?gatewayResponse({usage:null}):gatewayResponse({text:JSON.stringify({...artifact,records:[]})});});
  for(const changed of [{role:'bad'},{kind:'code'},{id:'../../tmp'}])assert.equal((await send({...task,...changed})).status,400);
  assert.equal((await send(task,'/api/groups')).status,404);
  assert.equal((await (await send(task)).json()).error,'missing_usage');assert.equal((await (await send(task)).json()).error,'invalid_artifact');
  assert.equal(n,2);
});
test('persisted completion is reused, ambiguous inference is fenced across retry',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'research-receipt-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let calls=0;const once=()=>{calls++;return {status:'completed',result:artifact};};
  const saved=await durableAttempt(dir,task,once);assert.deepEqual(await durableAttempt(dir,task,once),saved);assert.equal(calls,1);
  const second={...task,id:randomUUID()};await assert.rejects(durableAttempt(dir,second,async()=>{throw Error('crash during upstream call');}));await assert.rejects(durableAttempt(dir,second,once),/requires_review/);assert.equal(calls,1);
});
