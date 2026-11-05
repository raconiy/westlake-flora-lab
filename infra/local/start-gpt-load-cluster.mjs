import {spawn} from 'node:child_process';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {status as gatewayStatus} from './gpt-load-client.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const workspace=resolve(here,'../..');
const root=workspace;
const runtime=resolve(workspace,'work/gpt-load-cluster');
const lock=resolve(runtime,'cluster.lock');
const children=[];
let ownsLock=false,stopping=false;

async function stop(){
  if(stopping)return;stopping=true;
  for(const child of children)child.kill('SIGTERM');
  await Promise.all(children.map(child=>new Promise(resolveExit=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolveExit();
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(timer);resolveExit();});
  })));
  if(ownsLock)await unlink(lock).catch(()=>{});
}

try{
  await mkdir(runtime,{recursive:true,mode:0o700});
  try{
    const fd=await open(lock,'wx',0o600);await fd.writeFile(JSON.stringify({pid:process.pid}));await fd.close();ownsLock=true;
  }catch(error){
    if(error.code!=='EEXIST')throw error;
    const prior=JSON.parse(await readFile(lock,'utf8'));
    try{process.kill(prior.pid,0);}catch(error){
      if(error.code==='ESRCH'){await unlink(lock);throw new Error('Removed stale launcher lock; run the launcher again');}throw error;
    }
    throw new Error(`Cluster launcher already running (PID ${prior.pid})`);
  }
  const health=await fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(5000)});
  if(!health.ok)throw new Error('GPT-Load is unavailable; start it first');
  const state=await gatewayStatus();
  if(!state.connectedDistinctAccounts)throw new Error('GPT-Load has no connected accounts');
  let occupied=false;
  try{await fetch('http://127.0.0.1:8788/api/health',{signal:AbortSignal.timeout(2000)});occupied=true;}catch{}
  if(occupied)throw new Error('Coordinator port 8788 is already in use; stop the existing coordinator before replacing it');
  const env={...process.env,
    PATH:dirname(process.execPath)+':'+(process.env.PATH||''),
    CODEX_BIN:process.env.CODEX_BIN||'codex',
    SWARM_ROOT:root,SWARM_DB:resolve(workspace,'.runtime/swarm.sqlite'),SWARM_AUTO_VALIDATE:'1',SWARM_VALIDATION_COMMANDS:JSON.stringify([['node','node_modules/typescript/bin/tsc','--noEmit'],['node','--test']]),SWARM_TASK_TIMEOUT_MS:'1200000',SWARM_HOST:'127.0.0.1',SWARM_PORT:'8788',SWARM_MODEL_BACKEND:'gpt-load',SWARM_GPT_LOAD_MODEL:'gpt-6.1-sol',SWARM_MODEL_REASONING_EFFORT:'high',
  };
  const launch=(file,extra={})=>{
    const child=spawn(process.execPath,[resolve(here,file)],{cwd:here,env:{...env,...extra},stdio:'inherit'});
    children.push(child);
    child.on('error',error=>{console.error(error.message);void stop().finally(()=>process.exit(1));});
    child.on('exit',code=>{if(!stopping){console.error(`${file} stopped (${code}); stopping cluster`);void stop().finally(()=>process.exit(1));}});
    return child;
  };
  launch('coordinator.mjs');
  let ready=false;
  for(let n=0;n<30;n++){
    try{const r=await fetch('http://127.0.0.1:8788/api/health',{signal:AbortSignal.timeout(1000)});const h=await r.json();if(r.ok&&h.modelBackend==='gpt-load'){ready=true;break;}}catch{}
    await new Promise(resolveDelay=>setTimeout(resolveDelay,200));
  }
  if(!ready)throw new Error('Gateway-backed coordinator did not start');
  const requestedCount=Number(process.env.SWARM_WORKER_COUNT||3);
  if(!Number.isInteger(requestedCount)||requestedCount<1||requestedCount>5)throw new Error('SWARM_WORKER_COUNT must be 1–5');
  const count=Math.min(requestedCount,state.connectedDistinctAccounts);
  for(let n=1;n<=count;n++)launch('worker.mjs',{
    SWARM_WORKER_ID:`gpt-load-worker-${n}`,SWARM_WORKER_LABEL:`GPT-Load 执行器 ${n}`,
    SWARM_STATE_DIR:resolve(runtime,`worker-${n}`),
  });
  console.log(`Cluster active: modelBackend=gpt-load, connected accounts=${state.connectedDistinctAccounts}, execution workers=${count}; coordinator=http://127.0.0.1:8788`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop().finally(()=>process.exit(0)));
}catch(error){console.error(error.message);await stop();process.exitCode=1;}
