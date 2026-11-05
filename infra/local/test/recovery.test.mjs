import {mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{resolve}from'node:path';
import test from'node:test';import assert from'node:assert/strict';import{executeTask}from'../worker.mjs';
function isolated(t){const root=mkdtempSync(resolve(tmpdir(),'flora-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return{root,stateDir:resolve(root,'.runtime'),resultDir:resolve(root,'.runtime/task-results'),timeoutMs:60000};}
const task={id:'research-fixture',kind:'research',prompt:'read source only'};
test('explicit pre-connect failure gets one bounded continuation with receipt and unchanged sandbox',async t=>{const config=isolated(t);
 let calls=0;const result=await executeTask(task,config,{runCodex:async(prompt,options)=>{calls++;assert.equal(options.sandbox,'read-only');if(calls===1)throw Error('gateway upstream_connect_failed');assert.match(prompt,/所有已保存改动保留/);return{text:'review completed',backend:'gpt-load',model:'gpt-6.1-sol',reasoningEffort:'high',usage:{output_tokens:3}};}});
 assert.equal(calls,2);assert.equal(result.status,'completed');assert.equal(result.result.transportRecovery.length,1);assert.equal(result.result.modelBackend,'gpt-load');
});
test('authentication, ambiguous stream failures, timeouts and cancellation never trigger continuation',async t=>{const config=isolated(t);
 for(const message of ['401 unauthorized','stream disconnected','Codex execution timed out']){let calls=0;const result=await executeTask(task,config,{runCodex:async()=>{calls++;throw Error(message)}});assert.equal(calls,1);assert.equal(result.status,'failed');}
 const c=new AbortController();c.abort();let calls=0;const result=await executeTask(task,{...config,signal:c.signal},{runCodex:async()=>{calls++;throw Error('upstream_connect_failed')}});assert.equal(calls,0);assert.equal(result.status,'failed');
});
test('repeated connection failures stop at the bound and retain their failure record',async t=>{const config=isolated(t);let calls=0;const result=await executeTask(task,config,{runCodex:async()=>{calls++;throw Error('upstream_connect_failed')}});assert.equal(calls,2);assert.equal(result.status,'failed');assert.equal(result.result.transportRecovery.length,1);assert.match(result.result.error,/upstream_connect_failed/);});
