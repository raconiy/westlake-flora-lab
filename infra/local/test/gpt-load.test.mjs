import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runCodex} from '../codex.mjs';
import {executeTask} from '../worker.mjs';
import {createCoordinator} from '../coordinator.mjs';

function fixture(t,fail=false){
  const folder=mkdtempSync(resolve(tmpdir(),'flora-gateway-'));
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const keyFile=resolve(folder,'client.key'),binary=resolve(folder,'codex'),countFile=resolve(folder,'calls');
  writeFileSync(keyFile,'fixture-private-key\n',{mode:0o600});
  writeFileSync(binary,`#!${process.execPath}
import fs from 'node:fs';
import assert from 'node:assert/strict';
fs.appendFileSync(${JSON.stringify(countFile)},'1');
const args=process.argv.slice(2),config=args.flatMap((v,i)=>v==='-c'?[args[i+1]]:[]);
assert.ok(config.includes('model_provider="westlake_gpt_load"'));
assert.ok(config.includes('model_reasoning_effort="high"'));
assert.ok(config.includes('model_providers.westlake_gpt_load.requires_openai_auth=false'));
assert.ok(config.includes('model_providers.westlake_gpt_load.wire_api="responses"'));
assert.ok(config.includes('model_providers.westlake_gpt_load.request_max_retries=0'));
assert.ok(config.includes('model_providers.westlake_gpt_load.stream_max_retries=0'));
assert.ok(config.includes('shell_environment_policy.ignore_default_excludes=false'));
assert.ok(config.includes('cli_auth_credentials_store="ephemeral"'));
assert.ok(!config.some(value=>value.startsWith('shell_environment_policy.exclude=')));
assert.ok(!args.join(' ').includes('fixture-private-key'));
assert.equal(process.env.GPT_LOAD_ACCESS_KEY,'fixture-private-key');
process.stdin.resume();process.stdin.on('end',()=>{
  if(${fail}){console.error('upstream rejected '+process.env.GPT_LOAD_ACCESS_KEY);process.exitCode=1;return;}
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'gateway fixture completed'}}));
  console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}));
});
`,{mode:0o755});
  return{folder,keyFile,binary,countFile};
}

test('gateway provider uses process-local config and a private environment key; task receipts name backend',async t=>{
  const f=fixture(t);
  const options={root:f.folder,binary:f.binary,backend:'gpt-load',gatewayKeyFile:f.keyFile};
  const answer=await runCodex('read-only review',options);
  assert.equal(answer.backend,'gpt-load');assert.equal(answer.model,'gpt-6.1-sol');
  assert.equal(answer.usage.input_tokens,10);
  const result=await executeTask({id:'gateway-test',kind:'research',prompt:'review'},
    {root:f.folder,stateDir:resolve(f.folder,'.runtime'),resultDir:resolve(f.folder,'.runtime/task-results')},{runCodex:(prompt,opts)=>runCodex(prompt,{...options,...opts})});
  assert.equal(result.status,'completed');assert.equal(result.result.modelBackend,'gpt-load');
  assert.equal(result.result.worktree,null);assert.equal(result.result.merged,false);
});

test('gateway failures are redacted and never fall back to saved Codex authentication or repeat',async t=>{
  const f=fixture(t,true);
  await assert.rejects(runCodex('review',{root:f.folder,binary:f.binary,backend:'gpt-load',gatewayKeyFile:f.keyFile}),
    error=>error.message.includes('[redacted-gateway-key]')&&!error.message.includes('fixture-private-key'));
  assert.equal(readFileSync(f.countFile,'utf8'),'1');
  await assert.rejects(runCodex('review',{root:f.folder,binary:f.binary,backend:'gpt-load',gatewayKeyFile:resolve(f.folder,'missing.key')}),/ENOENT/);
  assert.equal(readFileSync(f.countFile,'utf8'),'1');
});

test('gateway endpoint validation prevents sending its key to a remote or embedded-credential URL',async t=>{
  const f=fixture(t);
  for(const url of ['http://evil.example/v1','http://user:pass@127.0.0.1:3001/v1','http://127.0.0.1:3001/v1?key=x']){
    await assert.rejects(runCodex('review',{root:f.folder,binary:f.binary,backend:'gpt-load',gatewayKeyFile:f.keyFile,gatewayBaseUrl:url}),/loopback/);
  }
});

test('coordinator reports gateway transport in health and structured assistant replies',async t=>{
  const app=createCoordinator({dbPath:':memory:',modelBackend:'gpt-load',gatewayStatus:async()=>({group:'fixture',connectedDistinctAccounts:3,requiredDistinctAccounts:5,fiveAccountRequirementMet:false,credentials:[{status:'available'},{status:'available'},{status:'cooldown'}]}),runCodex:async()=>({backend:'gpt-load',model:'gpt-6.1-sol',text:JSON.stringify({reply:'已连接网关',suggestions:[]})})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const health=await(await fetch(base+'/api/health')).json();
  assert.equal(health.modelBackend,'gpt-load');assert.equal(health.gateway.connectedAccounts,3);assert.equal(health.gateway.availableAccounts,2);assert.equal(health.gateway.fiveAccountRequirementMet,false);
  const response=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'检查连接',autoEnqueue:false})});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.modelBackend,'gpt-load');assert.equal(body.tasks.length,0);
});
