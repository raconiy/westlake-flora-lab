import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {runProcess} from '../codex.mjs';
import {executeTask as workerExecuteTask} from '../worker.mjs';

// A node:test parent sets a recursive-run guard in the inherited environment.
// These self-contained fixture test children need a clean environment to run
// actual assertions, as they do under the standalone production worker.
const fixtureProcess=(binary,args,options)=>runProcess(binary,args,{...options,...(args.includes('--test')?{env:{}}:{})});
const executeTask=(task,config,deps)=>workerExecuteTask(task,config,{runProcess:fixtureProcess,...deps});

const task={id:'worker-validation-fixture',kind:'code',prompt:'fixture only',validationScope:'full',validationCommands:[['untrusted-model-command']]};
const answer={text:'fixture answer; model suggests arbitrary shell commands',backend:'gpt-load',model:'gpt-6.1-sol',reasoningEffort:'high',usage:{output_tokens:7},selectedTests:['untrusted-model-test.test.mjs']};
async function fixture(t){
  const folder=mkdtempSync(resolve(tmpdir(),'flora-worker-scope-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const repo=resolve(folder,'repo');mkdirSync(repo);
  const git=async(root,...args)=>{const r=await runProcess('git',['-C',root,...args],{timeoutMs:10000});assert.equal(r.code,0,r.stderr);return r;};
  const put=(root,path,text)=>{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),text);};
  await git(repo,'init');put(repo,'.gitignore','node_modules\n');put(repo,'README.md','fixture\n');put(repo,'feature.mjs','export const value=1;\n');
  put(repo,'feature.test.mjs',"import test from 'node:test'; test('related fixture',()=>{});\n");
  put(repo,'unrelated.test.mjs',`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(resolve(folder,'unrelated-ran'))},'ran');\n`);
  await git(repo,'add','.');await git(repo,'-c','user.name=Worker fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  const compiler=(root,code=0)=>put(root,'node_modules/typescript/bin/tsc',`if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--noEmit']))throw Error('wrong compiler args');console.log('fixture typecheck');process.exit(${code});\n`);
  const config={root:repo,worktreeRoot:resolve(folder,'trees'),linkDependencies:false,autoValidate:true,validationScope:'changed-tests',validationCommands:[[process.execPath,'-e','process.exit(23)']]};
  return{folder,repo,git,put,compiler,config};
}

test('scoped worker uses real argv commands, literal test filenames and explicit readiness receipts',async t=>{
  const f=await fixture(t),calls=[],literal='space\n$(literal).test.mjs';
  const output=await executeTask(task,f.config,{
    runProcess:async(binary,args,options)=>{calls.push({binary,args,options});return fixtureProcess(binary,args,options);},
    runCodex:async(_prompt,{root})=>{f.compiler(root);f.put(root,'feature.mjs','export const value=2;\n');f.put(root,literal,"import test from 'node:test';test('literal test path',()=>{});\n");return answer;},
  });
  assert.equal(output.status,'completed');const r=output.result;
  assert.equal(r.validationScope,'changed-tests');assert.equal(r.validationStatus,'passed_scoped');assert.equal(r.merged,false);assert.equal(r.releaseApproved,false);
  assert.equal(r.validationPlan.fullSuiteValidated,false);assert.equal(r.integrationGate,'lead_full_validation_and_ci_required');
  assert.deepEqual(r.validationPlan.selectedTests,['feature.test.mjs',literal]);
  assert.equal(r.modelBackend,'gpt-load');assert.equal(r.model,'gpt-6.1-sol');assert.equal(r.reasoningEffort,'high');assert.deepEqual(r.usage,answer.usage);
  assert.equal(existsSync(resolve(f.folder,'unrelated-ran')),false);
  assert.deepEqual(r.validationPlan.commands.at(-1),[process.execPath,'--test','--test-concurrency=1','--','./feature.test.mjs',`./${literal}`]);
  const testCall=calls.find(c=>c.args.includes('--test'));
  assert.equal(testCall.binary,process.execPath);assert.deepEqual(testCall.args,r.validationPlan.commands.at(-1).slice(1));assert.equal(testCall.options.cwd,r.worktree);
  assert.ok(calls.every(c=>!c.args.includes('-e')&&!c.args.includes('untrusted-model-command')));
  assert.equal(r.validation.length,5);assert.equal(r.validation[0].phase,'selection');
  assert.deepEqual(r.validation.slice(1).map(v=>v.command),r.validationPlan.commands);
  assert.match(r.validation.at(-1).stdout,/related fixture/);assert.match(r.validation.at(-1).stdout,/literal test path/);
  for(const receipt of r.validation){assert.equal(receipt.status,'passed');assert.equal(receipt.timedOut,false);assert.ok(receipt.durationMs>=0);assert.ok(receipt.timeoutMs<=120000);assert.ok(Date.parse(receipt.startedAt)<=Date.parse(receipt.finishedAt));}
  assert.equal(r.validationPlan.budgetMs,300000);assert.equal((await f.git(f.repo,'status','--porcelain')).stdout,'');
});

test('targeted assertion failure keeps original output, usage and pre-connect recovery metadata',async t=>{
  const f=await fixture(t);let attempts=0;
  const output=await executeTask(task,{...f.config,timeoutMs:60000},{runCodex:async(_prompt,{root})=>{
    if(++attempts===1)throw Error('gateway upstream_connect_failed');
    f.compiler(root);f.put(root,'failing.test.mjs',"import test from 'node:test';import assert from 'node:assert/strict';test('original-target-failure',()=>assert.equal(1,2));\n");return answer;
  }});
  const r=output.result;assert.equal(output.status,'validation_failed',JSON.stringify(output));assert.equal(r.validationStatus,'failed');assert.equal(r.validationScope,'changed-tests');
  assert.deepEqual(r.validationPlan.selectedTests,['failing.test.mjs']);assert.equal(r.validation.at(-1).code,1);assert.equal(r.validation.at(-1).status,'failed');
  assert.match(r.validation.at(-1).stdout,/original-target-failure/);assert.equal(r.transportRecovery.length,1);assert.equal(r.transportRecovery[0].preservedWorktree,true);
  assert.deepEqual(r.usage,answer.usage);assert.equal(r.model,'gpt-6.1-sol');assert.equal(r.merged,false);assert.equal(r.releaseApproved,false);
});

test('no selected tests still runs real typecheck and both diff checks without claiming full validation',async t=>{
  const f=await fixture(t);
  const output=await executeTask(task,f.config,{runCodex:async(_prompt,{root})=>{f.compiler(root);rmSync(resolve(root,'feature.test.mjs'));f.put(root,'README.md','changed\n');return answer;}});
  const r=output.result;assert.equal(output.status,'completed');assert.equal(r.validationStatus,'passed_checks_only');assert.equal(r.validationScope,'changed-tests');
  assert.equal(r.validationPlan.noTestsSelected,true);assert.deepEqual(r.validationPlan.deletedTests,['feature.test.mjs']);assert.equal(r.validationPlan.commands.length,3);
  assert.equal(r.validation.length,4);assert.ok(r.validation[1].stdout.includes('fixture typecheck'));assert.ok(r.validation.every(v=>!v.command.includes('--test')));
  assert.equal(r.validationPlan.fullSuiteValidated,false);assert.equal(r.releaseApproved,false);
});

test('scoped typecheck failure is explicit and selected tests stay visible without running',async t=>{
  const f=await fixture(t);
  const output=await executeTask(task,f.config,{runCodex:async(_prompt,{root})=>{f.compiler(root,7);f.put(root,'feature.mjs','export const value=2;\n');return answer;}});
  const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validation.at(-1).code,7);assert.equal(r.validation.length,2);
  assert.deepEqual(r.validationPlan.selectedTests,['feature.test.mjs']);assert.equal(r.validationPlan.commands.length,4);assert.equal(r.modelBackend,'gpt-load');
});

test('staged and unstaged whitespace failures both remain real failures',async t=>{
  for(const staged of [false,true]){
    const f=await fixture(t);
    const output=await executeTask(task,f.config,{runCodex:async(_prompt,{root})=>{f.compiler(root);f.put(root,'README.md','bad trailing whitespace  \n');if(staged)await f.git(root,'add','README.md');return answer;}});
    const r=output.result;assert.equal(output.status,'validation_failed');assert.match(r.validation.at(-1).stdout,/trailing whitespace/);
    assert.equal(r.validation.at(-1).command.includes('--cached'),staged);
  }
});

test('default and explicit full scope execute operator argv unchanged and retain passed status',async t=>{
  for(const scope of [undefined,'full']){
    const f=await fixture(t),command=[process.execPath,'-e',"console.log('operator full fixture')"];
    const output=await executeTask(task,{...f.config,validationScope:scope,validationCommands:[command]},{runCodex:async()=>answer});
    const r=output.result;assert.equal(output.status,'completed');assert.equal(r.validationStatus,'passed');assert.equal(r.validationScope,scope??'operator-defined');
    assert.deepEqual(r.validationPlan.commands,[command]);assert.deepEqual(r.validation[0].command,command);assert.equal(r.validation.length,1);assert.equal(r.validation[0].timeoutMs,600000);
    assert.match(r.validation[0].stdout,/operator full fixture/);assert.equal(r.releaseApproved,false);
  }
});

test('real validation timeout and spawn errors preserve scoped plan and execution metadata',async t=>{
  for(const mode of ['timeout','spawn']){
    const f=await fixture(t);
    const output=await executeTask(task,{...f.config,validationScope:undefined,validationTimeoutMs:50,validationCommands:[mode==='timeout'?[process.execPath,'-e','setInterval(()=>{},1000)']:['/definitely-missing-worker-fixture']]},{runCodex:async()=>answer});
    const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validation.at(-1).status,mode==='timeout'?'timed_out':'spawn_error');
    assert.equal(r.validation.at(-1).timedOut,mode==='timeout');assert.equal(r.validation.at(-1).timeoutMs,50);assert.deepEqual(r.usage,answer.usage);assert.equal(r.validationPlan.commands.length,1);
  }
});

test('scoped total deadline bounds a real hanging targeted test',async t=>{
  const f=await fixture(t),started=performance.now();
  const output=await executeTask(task,{...f.config,validationTimeoutMs:1000},{runCodex:async(_prompt,{root})=>{
    f.compiler(root);f.put(root,'hanging.test.mjs',"import test from 'node:test';test('hanging fixture',async()=>new Promise(()=>{}));setInterval(()=>{},1000);\n");return answer;
  }});
  const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validationScope,'changed-tests');
  assert.equal(r.validationPlan.budgetMs,1000);assert.equal(r.validationPlan.commandTimeoutMs,1000);
  assert.equal(r.validation.at(-1).status,'timed_out');assert.ok(r.validation.at(-1).command.includes('--test'));
  assert.ok(r.validation.at(-1).timeoutMs<1000);assert.ok(performance.now()-started<5000);assert.deepEqual(r.usage,answer.usage);
});

test('real output limit cannot become a passed check even when the child exits zero',async t=>{
  const f=await fixture(t);
  const output=await executeTask(task,{...f.config,validationScope:undefined,validationTimeoutMs:1000,validationCommands:[[process.execPath,'-e',"process.stdout.write('x'.repeat(600000))"]]},{runCodex:async()=>answer});
  assert.equal(output.status,'validation_failed');assert.equal(output.result.validation[0].status,'output_limit');assert.equal(output.result.validation[0].overflow,true);
});

test('cancellation during a real scoped test aborts the process and retains its selected command',async t=>{
  const f=await fixture(t),controller=new AbortController();
  const output=await executeTask(task,{...f.config,signal:controller.signal},{
    runCodex:async(_prompt,{root})=>{f.compiler(root);f.put(root,'hanging.test.mjs','setInterval(()=>{},1000);\n');return answer;},
    runProcess:async(binary,args,options)=>{
      if(!args.includes('--test'))return fixtureProcess(binary,args,options);
      const timer=setTimeout(()=>controller.abort(),50);try{return await fixtureProcess(binary,args,options);}finally{clearTimeout(timer);}
    },
  });
  const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validation.at(-1).status,'aborted');assert.equal(r.validation.at(-1).aborted,true);
  assert.equal(r.validation.at(-1).timedOut,false);assert.deepEqual(r.validationPlan.selectedTests,['hanging.test.mjs']);assert.equal(r.releaseApproved,false);
});

test('aborted scoped validation does not spawn status or checks after model completion',async t=>{
  const f=await fixture(t),controller=new AbortController(),calls=[];
  const output=await executeTask(task,{...f.config,signal:controller.signal},{runProcess:async(binary,args,options)=>{calls.push(args);return runProcess(binary,args,options);},runCodex:async()=>{controller.abort();return answer;}});
  const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validationScope,'changed-tests');assert.equal(r.validationPlan.selectionStatus,'failed');
  assert.equal(r.validation[0].status,'aborted');assert.equal(r.validation[0].aborted,true);assert.equal(calls.some(args=>args.includes('--porcelain=v1')),false);assert.deepEqual(r.usage,answer.usage);
});

test('unsafe selection fails validation and retains model metadata without executing checks',async t=>{
  const f=await fixture(t);
  const output=await executeTask(task,f.config,{runCodex:async(_prompt,{root})=>{f.compiler(root);symlinkSync(resolve(root,'feature.test.mjs'),resolve(root,'unsafe.test.mjs'));return answer;}});
  const r=output.result;assert.equal(output.status,'validation_failed');assert.equal(r.validationStatus,'failed');assert.match(r.validationError,/symlink/);
  assert.equal(r.validationPlan.selectionStatus,'failed');assert.equal(r.validation.length,1);assert.deepEqual(r.usage,answer.usage);assert.equal(r.releaseApproved,false);
});
