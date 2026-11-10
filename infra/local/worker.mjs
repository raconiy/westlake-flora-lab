import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runCodex,runProcess} from './codex.mjs';
import {changedTestsPlan,assertSafeTestPaths} from './validation-scope.mjs';
import {retainFullOutput} from './full-output.mjs';

// Commands always go through runProcess's shell:false executor. Keep failures
// (including spawn errors, output bounds and cancellation) in the same receipt.
async function validationCommand(args,{run,cwd,signal,timeoutMs,maxBytes=500000,deadline=Infinity,phase='check'}){
  const startedAt=new Date().toISOString(),started=performance.now();
  const remaining=deadline-Date.now(),bound=Math.max(1,Math.min(timeoutMs,remaining));
  let result;
  if(signal?.aborted)result={code:null,aborted:true,stderr:'Validation aborted before command start'};
  else if(remaining<=0)result={code:null,timedOut:true,stderr:'Validation budget exhausted before command start'};
  else try{result=await run(args[0],args.slice(1),{cwd,timeoutMs:bound,signal,maxBytes});}
  catch(error){result={code:null,error:error.message,stderr:error.message,aborted:!!signal?.aborted};}
  const status=result.aborted?'aborted':result.timedOut?'timed_out':result.overflow?'output_limit':result.error?'spawn_error':result.code===0?'passed':'failed';
  return{result,receipt:{command:[...args],phase,status,code:result.code??null,timedOut:!!result.timedOut,overflow:!!result.overflow,aborted:!!result.aborted,signal:result.signal??null,
    startedAt,finishedAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started),timeoutMs:bound,
    stdout:(result.stdout||'').slice(-1500),stderr:(result.stderr||'').slice(-1000),...(result.error?{error:result.error}:{})}};
}

export async function executeTask(task,config={},deps={}){
  const root=resolve(config.root||process.env.SWARM_ROOT||process.cwd());
  const codex=deps.runCodex||runCodex,run=deps.runProcess||runProcess;
  let worktree=null;const transportRecovery=[],validation=[];
  let executionMetadata={},validationPlan=null,answerMetadata={};
  const validationScope=config.validationScope??'operator-defined';
  const timeoutMs=config.timeoutMs??Number(process.env.SWARM_TASK_TIMEOUT_MS||1200000);
  try{
    if(task.kind==='code'){
      const check=await run('git',['-C',root,'rev-parse','--show-toplevel'],{timeoutMs:10000});
      if(check.code!==0)throw new Error('Code tasks require a local Git repository with a committed HEAD');
      const repo=check.stdout.trim();
      // Worktrees are siblings outside the source repository, not nested inside .git.
      const base=resolve(config.worktreeRoot||process.env.SWARM_WORKTREE_ROOT||resolve(dirname(repo),'.flora-swarm-worktrees'));
      mkdirSync(base,{recursive:true});
      worktree=resolve(base,`task-${task.id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}-${randomUUID().slice(0,8)}`);
      const added=await run('git',['-C',repo,'worktree','add','--detach',worktree,'HEAD'],{timeoutMs:config.worktreeTimeoutMs??120000});
      if(added.code!==0||added.timedOut)throw new Error(`Cannot create worktree${added.timedOut?' (timed out)':''}: ${added.stderr.slice(-1000)}`);
      // Reuse installed dependencies without copying or reinstalling them. The
      // agent's workspace sandbox still disallows writes to this external target.
      if(config.linkDependencies!==false&&existsSync(resolve(repo,'node_modules'))&&!existsSync(resolve(worktree,'node_modules'))){
        symlinkSync(resolve(repo,'node_modules'),resolve(worktree,'node_modules'),process.platform==='win32'?'junction':'dir');
      }
    }
    const handoff = task.priorDeliveries?.length
      ? '\n已完成交付（参考数据，先核对仓库里的提交与实际差异，复用适用成果，标注未整合的改动）\n'+JSON.stringify(task.priorDeliveries)
      : '';
    const prompt=`你是西湖大学植物real2sim项目的执行agent。任务ID：${task.id}\n任务类型：${task.kind}\n职责：${task.role || '通用队列'}${handoff}\n仅在指定工作目录内工作；不读取账号凭据、不修改认证、不执行git merge、不部署、不删除其他worktree。不要更改HOME/CODEX_HOME。node_modules如为共享依赖，只读使用，不安装或修改依赖与lock文件。代码修改保留在当前独立worktree，最终说明文件、行为、验证和风险。研究任务只读分析，附来源，区分假设与实测。\n任务：${task.prompt}`;
    const started=Date.now(),recoveryLimit=Math.max(0,Math.min(2,Number(config.connectRecoveryAttempts??process.env.SWARM_CONNECT_RECOVERY_ATTEMPTS??1)||0));
    let answer;
    for(let attempt=0;;attempt++){
      const remaining=timeoutMs-(Date.now()-started);
      if(config.signal?.aborted)throw new Error('Codex execution aborted');
      if(remaining<=0)throw new Error('Codex execution timed out');
      try{answer=await codex(prompt+(attempt?'\n恢复说明：前次在上游连接建立前失败。工作目录与所有已保存改动保留。先检查当前差异和已完成验证，接着完成未完成工作；不要重做已完成改动、部署或对外操作。':''),{root:worktree||root,sandbox:task.kind==='code'?'workspace-write':'read-only',timeoutMs:Math.max(1,remaining),signal:config.signal});break;}
      catch(error){
        // A NEW continuation call, never automatic replay of an ambiguous
        // streamed response. Only the gateway's explicit pre-connect failure
        // is eligible, within the original deadline, preserving the worktree.
        if(config.signal?.aborted||attempt>=recoveryLimit||timeoutMs-(Date.now()-started)<30000||!String(error.message).includes('upstream_connect_failed'))throw error;
        transportRecovery.push({attempt:attempt+1,category:'upstream_connect_failed',error:error.message,preservedWorktree:!!worktree});
      }
    }
    executionMetadata={usage:answer.usage,modelBackend:answer.backend??'codex',model:answer.model??null,reasoningEffort:answer.reasoningEffort??null,transportRecovery};
    // Save the unmodified model string before validation or any UI truncation.
    // This runs in the controller, including for read-only research agents.
    const fullOutput=retainFullOutput(task.id,answer.text,{root,stateDir:config.stateDir||process.env.SWARM_STATE_DIR,resultDir:config.resultDir||process.env.SWARM_RESULT_DIR});
    answerMetadata={fullOutput};
    if(typeof answer.text==='string')Object.assign(answerMetadata,{summary:answer.text.slice(-9000),summaryTruncated:answer.text.length>9000});
    if(!fullOutput.retained)throw Object.assign(new Error(`Full model output retention failed: ${fullOutput.error}`),{code:'FULL_OUTPUT_RETENTION_FAILED'});
    const validationMetadata=()=>({validation,validationScope,validationPlan,integrationGate:'lead_full_validation_and_ci_required',releaseApproved:false});
    const validationFailure=error=>({status:'validation_failed',result:{...answerMetadata,worktree,...validationMetadata(),validationStatus:'failed',...(error?{validationError:error}:{}),...executionMetadata,merged:false}});
    if(task.kind==='code'&&config.autoValidate){
      try{
        if(!['operator-defined','full','changed-tests'].includes(validationScope))throw new Error('Unknown validation scope');
        const timeout=config.validationTimeoutMs??Number(process.env.SWARM_VALIDATION_TIMEOUT_MS||600000);
        if(!Number.isFinite(timeout)||timeout<=0)throw new Error('Validation timeout must be positive and finite');
        // Scoped readiness has a total budget as well as individual command
        // bounds. The legacy operator-defined/full path retains its deadlines.
        const scoped=validationScope==='changed-tests',budgetMs=scoped?Math.min(timeout,300000):null;
        const deadline=budgetMs===null?Infinity:Date.now()+budgetMs;
        const commandTimeoutMs=scoped?Math.min(timeout,120000):timeout;
        const checkedRun=async(args,options={})=>{
          const checked=await validationCommand(args,{...options,run,cwd:worktree,signal:config.signal,timeoutMs:options.timeoutMs??commandTimeoutMs,deadline});
          validation.push(checked.receipt);return checked.result;
        };
        if(scoped){
          validationPlan={scope:validationScope,commands:[],selectedTests:[],selectionStatus:'pending',fullSuiteValidated:false,releaseApproved:false};
          validationPlan={...await changedTestsPlan(worktree,{signal:config.signal,run:(binary,args,options)=>checkedRun([binary,...args],{...options,phase:'selection'})}),selectionStatus:'selected',budgetMs,commandTimeoutMs};
        }else{
          if(!Array.isArray(config.validationCommands)||!config.validationCommands.length)throw new Error('Auto-validation enabled but no operator-defined commands configured');
          // Validate the complete list before executing any command.
          for(const args of config.validationCommands)if(!Array.isArray(args)||!args.length||args.some(v=>typeof v!=='string'||v.includes('\0'))||!args[0])throw new Error('Validation commands must be argv arrays');
          validationPlan={scope:validationScope,commands:config.validationCommands.map(args=>[...args]),commandTimeoutMs,releaseApproved:false};
        }
        for(const args of validationPlan.commands){
          if(scoped&&args.includes('--test'))assertSafeTestPaths(worktree,validationPlan.selectedTests);
          await checkedRun(args);
          if(validation.at(-1).status!=='passed')return validationFailure();
        }
      }catch(error){
        if(validationPlan?.selectionStatus==='pending')validationPlan.selectionStatus='failed';
        return validationFailure(error.message);
      }
    }
    let diff=null;if(worktree){const d=await run('git',['-C',worktree,'status','--short'],{timeoutMs:10000});diff=d.stdout;}
    return{status:'completed',result:{...answerMetadata,worktree,...validationMetadata(),validationStatus:task.kind!=='code'?'not_applicable':!config.autoValidate?'not_run':validationScope==='changed-tests'?(validationPlan.noTestsSelected?'passed_checks_only':'passed_scoped'):'passed',changes:diff,merged:false,...executionMetadata}};
  }catch(error){return{status:'failed',result:{error:error.message,transportRecovery,failureCategory:error.code==='FULL_OUTPUT_RETENTION_FAILED'?'full_output_retention':/timed out/i.test(error.message)?'timeout':/worktree/i.test(error.message)?'workspace':/validat/i.test(error.message)?'validation':'execution',worktree,partialChangesPreserved:!!worktree,modelBackend:process.env.SWARM_MODEL_BACKEND||'codex',model:process.env.SWARM_GPT_LOAD_MODEL||null,reasoningEffort:process.env.SWARM_MODEL_REASONING_EFFORT||null,...executionMetadata,...answerMetadata,validation,validationScope,validationPlan,validationStatus:'not_completed',merged:false,releaseApproved:false}};}
}

export async function runWorker(config={}){
  const coordinator=config.coordinator||process.env.SWARM_COORDINATOR||'http://127.0.0.1:8788';
  const token=config.token??process.env.SWARM_TOKEN??'';
  const root=resolve(config.root||process.env.SWARM_ROOT||process.cwd());
  const stateDir=resolve(config.stateDir||process.env.SWARM_STATE_DIR||resolve(root,'.runtime'));mkdirSync(stateDir,{recursive:true});
  const idFile=resolve(stateDir,'worker-id');let workerId=config.id||process.env.SWARM_WORKER_ID||(existsSync(idFile)?readFileSync(idFile,'utf8').trim():randomUUID());writeFileSync(idFile,workerId,{mode:0o600});
  const request=async(path,body)=>{const response=await fetch(new URL(path,coordinator),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(`Coordinator ${response.status}: ${data.error}`);return data;};
  const roles=config.roles ?? (process.env.SWARM_WORKER_ROLES || '').split(',').map(role=>role.trim()).filter(Boolean);
  await request('/api/workers/register',{id:workerId,label:process.env.SWARM_WORKER_LABEL||workerId,roles});
  console.log(`Worker ${workerId} registered with ${coordinator}; concurrency=1`);
  let stopping=false,currentAbort=null;
  const stop=()=>{stopping=true;currentAbort?.abort();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{while(!stopping){
    try{
      const {task,leaseSeconds}=await request('/api/lease',{workerId});
      if(!task){await request(`/api/workers/${encodeURIComponent(workerId)}/heartbeat`,{});if(config.once)return;await new Promise(r=>setTimeout(r,3000));continue;}
      currentAbort=new AbortController();let leaseLost=false,heartbeatBusy=false;
      const heartbeat=setInterval(async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await request(`/api/workers/${encodeURIComponent(workerId)}/heartbeat`,{taskId:task.id,leaseToken:task.leaseToken});}catch(error){leaseLost=true;currentAbort?.abort();console.error(`Lease heartbeat failed: ${error.message}`);}finally{heartbeatBusy=false;}},Math.max(1000,Math.floor(leaseSeconds*1000/3)));
      console.log(`Executing ${task.id}: ${task.title}`);
      let result;
      try{result=await executeTask(task,{...config,root,signal:currentAbort.signal});}finally{clearInterval(heartbeat);currentAbort=null;}
      if(!leaseLost){await request(`/api/tasks/${task.id}/complete`,{workerId,leaseToken:task.leaseToken,...result});console.log(`${task.id}: ${result.status}`);}else console.error(`${task.id}: lease lost; local result retained, stale completion not submitted`);
      if(config.once)return;
    }catch(error){console.error(error.message);if(config.once)throw error;if(!stopping)await new Promise(r=>setTimeout(r,3000));}
  }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]||'')).href){
  let validationCommands=[];try{validationCommands=JSON.parse(process.env.SWARM_VALIDATION_COMMANDS||'[]');}catch{throw new Error('SWARM_VALIDATION_COMMANDS must be JSON argv arrays');}
  await runWorker({autoValidate:process.env.SWARM_AUTO_VALIDATE==='1',validationScope:process.env.SWARM_VALIDATION_SCOPE||'operator-defined',validationCommands,once:process.argv.includes('--once')});
}
