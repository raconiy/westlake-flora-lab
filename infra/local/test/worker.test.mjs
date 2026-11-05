import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,symlinkSync,readFileSync,statSync,readdirSync,chmodSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
  await git(repo,'init');put(repo,'.gitignore','node_modules\n.runtime/\n');put(repo,'README.md','fixture\n');put(repo,'feature.mjs','export const value=1;\n');
  put(repo,'feature.test.mjs',"import test from 'node:test'; test('related fixture',()=>{});\n");
  put(repo,'unrelated.test.mjs',`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(resolve(folder,'unrelated-ran'))},'ran');\n`);
  await git(repo,'add','.');await git(repo,'-c','user.name=Worker fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  const compiler=(root,code=0)=>put(root,'node_modules/typescript/bin/tsc',`if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--noEmit']))throw Error('wrong compiler args');console.log('fixture typecheck');process.exit(${code});\n`);
  const config={root:repo,stateDir:resolve(repo,'.runtime'),resultDir:resolve(repo,'.runtime/task-results'),worktreeRoot:resolve(folder,'trees'),linkDependencies:false,autoValidate:true,validationScope:'changed-tests',validationCommands:[[process.execPath,'-e','process.exit(23)']]};
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

const longText=JSON.stringify({header:'完整研究报告：桂花叶姿连续性',body:('中文🌿 research\n\r\t').repeat(1800),footer:'原文结束'});
const outputPath=(directory,id)=>resolve(directory,`task-${createHash('sha256').update(id).digest('hex')}.txt`);
function assertFullOutput(result,text=longText){
  const receipt=result.fullOutput,bytes=readFileSync(receipt.path);
  assert.equal(receipt.retained,true);assert.equal(bytes.toString('utf8'),text);
  assert.deepEqual(bytes,Buffer.from(text,'utf8'));
  assert.equal(receipt.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(receipt.utf8Bytes,Buffer.byteLength(text,'utf8'));assert.equal(receipt.charCount,text.length);
  assert.equal(receipt.charCountUnit,'UTF-16 code units');assert.equal(receipt.encoding,'utf8');
  assert.equal(result.summary,text.slice(-9000));assert.equal(result.summaryTruncated,text.length>9000);
  assert.equal(statSync(receipt.path).mode&0o777,0o600);assert.equal(statSync(dirname(receipt.path)).mode&0o777,0o700);
}

test('full Chinese JSON survives research/code completion and failing code validation before checks run',async t=>{
  for(const mode of ['research','code','validation_failed']){
    const f=await fixture(t),directory=resolve(f.config.stateDir,'task-results');
    const command=[process.execPath,'-e','process.exit(9)'];let checked=false;
    const output=await executeTask({...task,kind:mode==='research'?'research':'code'},
      {...f.config,autoValidate:mode==='validation_failed',validationScope:'operator-defined',validationCommands:[command]},
      {runCodex:async(_prompt,options)=>{assert.equal(options.sandbox,mode==='research'?'read-only':'workspace-write');return{...answer,text:longText};},
        runProcess:async(binary,args,options)=>{
          if(args[0]==='-e'){
            // Observe disk at validation entry, rather than testing a helper in isolation.
            assert.equal(readFileSync(outputPath(directory,task.id),'utf8'),longText);checked=true;
          }
          return fixtureProcess(binary,args,options);
        }});
    assert.equal(output.status,mode==='validation_failed'?'validation_failed':'completed');assertFullOutput(output.result);
    assert.deepEqual(JSON.parse(readFileSync(output.result.fullOutput.path,'utf8')),JSON.parse(longText));
    assert.equal(output.result.fullOutput.path,outputPath(realpathSync(directory),task.id));
    assert.equal(checked,mode==='validation_failed');assert.deepEqual(output.result.usage,answer.usage);
    if(checked){assert.equal(output.result.validation[0].code,9);assert.equal(output.result.validation[0].status,'failed');}
  }
});

test('validation configuration errors and errors after the answer retain full output receipts',async t=>{
  for(const mode of ['validation_config','status_error']){
    const f=await fixture(t);
    const output=await executeTask(task,{...f.config,autoValidate:mode==='validation_config',validationScope:'invalid-scope'},
      {runCodex:async()=>({...answer,text:longText}),runProcess:async(binary,args,options)=>{
        if(mode==='status_error'&&args.includes('--short'))throw Error('status inspection failed after answer');
        return fixtureProcess(binary,args,options);
      }});
    assert.equal(output.status,mode==='validation_config'?'validation_failed':'failed');assertFullOutput(output.result);
    assert.deepEqual(output.result.usage,answer.usage);
    if(mode==='validation_config')assert.match(output.result.validationError,/Unknown validation scope/);
    else assert.match(output.result.error,/status inspection failed/);
  }
});

function researchFixture(t){
  const root=mkdtempSync(resolve(tmpdir(),'flora-worker-retention-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  return{root,stateDir:resolve(root,'.runtime'),resultDir:resolve(root,'.runtime/task-results')};
}
const researchTask=id=>({id,kind:'research',prompt:'injected fixture only'});
const modelText=text=>({runCodex:async()=>({...answer,text})});

test('hashed task IDs contain traversal and avoid sanitized-ID collisions; duplicate bytes are reusable',async t=>{
  const config=researchFixture(t),directory=resolve(config.stateDir,'task-results'),paths=[];
  for(const id of ['../../escaped','..\\..\\escaped','../escaped','escaped','中文/任务']){
    const first=await executeTask(researchTask(id),config,modelText(longText));assert.equal(first.status,'completed');assertFullOutput(first.result);
    assert.equal(dirname(first.result.fullOutput.path),realpathSync(directory));assert.equal(first.result.fullOutput.reused,false);paths.push(first.result.fullOutput.path);
    const second=await executeTask(researchTask(id),config,modelText(longText));assert.equal(second.status,'completed');assertFullOutput(second.result);
    assert.equal(second.result.fullOutput.path,first.result.fullOutput.path);assert.equal(second.result.fullOutput.reused,true);
  }
  assert.equal(new Set(paths).size,paths.length);assert.equal(readdirSync(directory).length,paths.length);
  assert.equal(existsSync(resolve(config.root,'escaped')),false);
});

test('different output on the same task ID fails explicitly without replacing the original or failure history',async t=>{
  const config=researchFixture(t),item=researchTask('duplicate-conflict');let calls=0;
  const first=await executeTask(item,config,modelText(longText));assertFullOutput(first.result);
  const second=await executeTask(item,{...config,timeoutMs:60000},{runCodex:async()=>{
    if(++calls===1)throw Error('upstream_connect_failed');return{...answer,text:longText+'different'};
  }});
  assert.equal(second.status,'failed');assert.equal(second.result.failureCategory,'full_output_retention');
  assert.equal(second.result.fullOutput.retained,false);assert.equal(second.result.fullOutput.errorCode,'FULL_OUTPUT_CONFLICT');
  assert.equal(second.result.fullOutput.path,first.result.fullOutput.path);assert.equal(readFileSync(first.result.fullOutput.path,'utf8'),longText);
  assert.equal(second.result.transportRecovery.length,1);assert.match(second.result.transportRecovery[0].error,/upstream_connect_failed/);
  assert.deepEqual(second.result.usage,answer.usage);assert.equal(readdirSync(dirname(first.result.fullOutput.path)).length,1);
});

test('filesystem failure after a code answer prevents validation and cannot claim full retention',async t=>{
  const f=await fixture(t),blocked=resolve(f.folder,'not-a-directory');writeFileSync(blocked,'keep original');let validations=0;
  const output=await executeTask(task,{...f.config,resultDir:resolve(blocked,'results')},
    {runCodex:async()=>({...answer,text:longText}),runProcess:async(binary,args,options)=>{
      if(args.includes('--porcelain=v1')||args[0]==='-e')validations++;
      return fixtureProcess(binary,args,options);
    }});
  const r=output.result;assert.equal(output.status,'failed');assert.equal(r.failureCategory,'full_output_retention');
  assert.equal(r.fullOutput.retained,false);assert.match(r.fullOutput.errorCode,/ENOTDIR|EEXIST/);assert.match(r.error,/retention failed/);
  assert.equal(r.fullOutput.utf8Bytes,Buffer.byteLength(longText));assert.equal(r.fullOutput.charCount,longText.length);
  assert.equal(validations,0);assert.deepEqual(r.validation,[]);assert.deepEqual(r.usage,answer.usage);
  assert.equal(readFileSync(blocked,'utf8'),'keep original');assert.equal(r.partialChangesPreserved,true);
});

test('private custom directory works and public, dist, symlink, or permissive destinations fail closed',async t=>{
  const config=researchFixture(t),id='private-path';
  const good=await executeTask(researchTask(id),{...config,resultDir:resolve(config.root,'owned-results')},modelText(longText));
  assert.equal(good.status,'completed');assertFullOutput(good.result);
  const external=resolve(config.root,'external.txt');writeFileSync(external,'never replace',{mode:0o600});
  const fileLinkDir=resolve(config.root,'file-link-results');mkdirSync(fileLinkDir,{mode:0o700});symlinkSync(external,outputPath(fileLinkDir,id));
  const directoryLink=resolve(config.root,'directory-link');symlinkSync(dirname(good.result.fullOutput.path),directoryLink);
  const permissive=resolve(config.root,'permissive');mkdirSync(permissive,{mode:0o700});chmodSync(permissive,0o755);
  for(const resultDir of [resolve(config.root,'public','reports'),resolve(config.root,'dist','reports'),fileLinkDir,directoryLink,permissive]){
    const output=await executeTask(researchTask(id),{...config,resultDir},modelText(longText));
    assert.equal(output.status,'failed');assert.equal(output.result.failureCategory,'full_output_retention');assert.equal(output.result.fullOutput.retained,false);
  }
  assert.equal(readFileSync(external,'utf8'),'never replace');assertFullOutput(good.result);
  assert.deepEqual(readdirSync(fileLinkDir),[outputPath(fileLinkDir,id).split('/').at(-1)]);
});

test('short and empty successful answers retain exact bytes with an explicit nontruncated summary',async t=>{
  const config=researchFixture(t);
  for(const text of ['', '桂花 short 🌿']){
    const output=await executeTask(researchTask(`short-${text}`),config,modelText(text));
    assert.equal(output.status,'completed');assertFullOutput(output.result,text);assert.equal(output.result.summaryTruncated,false);
  }
});

test('same ID cannot replace the artifact from an earlier validation failure',async t=>{
  const f=await fixture(t),config={...f.config,validationScope:'operator-defined',validationCommands:[[process.execPath,'-e','process.exit(8)']]};
  const first=await executeTask(task,config,modelText(longText));assert.equal(first.status,'validation_failed');assertFullOutput(first.result);
  const originalReceipt=JSON.stringify(first.result);
  const second=await executeTask(task,config,modelText(longText+'new answer'));
  assert.equal(second.status,'failed');assert.equal(second.result.fullOutput.errorCode,'FULL_OUTPUT_CONFLICT');
  assert.equal(readFileSync(first.result.fullOutput.path,'utf8'),longText);assert.equal(JSON.stringify(first.result),originalReceipt);
  assert.equal(first.result.validation[0].code,8);assert.deepEqual(second.result.validation,[]);
});

test('invalid task IDs and unrepresentable model strings fail explicitly rather than claiming exact UTF-8 retention',async t=>{
  const config=researchFixture(t);
  for(const [id,text,errorCode] of [[null,longText,'FULL_OUTPUT_INVALID_TASK_ID'],['',longText,'FULL_OUTPUT_INVALID_TASK_ID'],['\ud800',longText,'FULL_OUTPUT_INVALID_TASK_ID'],['bad-text','prefix\ud800suffix','FULL_OUTPUT_INVALID_TEXT'],['not-string',null,'FULL_OUTPUT_INVALID_TEXT']]){
    const output=await executeTask(researchTask(id),config,modelText(text));
    assert.equal(output.status,'failed');assert.equal(output.result.failureCategory,'full_output_retention');
    assert.equal(output.result.fullOutput.retained,false);assert.equal(output.result.fullOutput.errorCode,errorCode);
  }
  assert.equal(existsSync(config.stateDir),false);
});
