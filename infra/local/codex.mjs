import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
const here=dirname(fileURLToPath(import.meta.url));

// Uses the operator's existing official Codex login. No authentication files are read.
export function runProcess(binary,args,{cwd,input='',timeoutMs=180000,signal,maxBytes=2_000_000,env}={}) {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(binary,args,{cwd,env,stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
    let stdout='',stderr='',bytes=0,settled=false,timedOut=false,overflow=false,hardTimer;
    const kill=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}catch{}if(!hardTimer)hardTimer=setTimeout(()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},2000);};
    const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
    const abort=()=>kill(); signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>{clearTimeout(timer);clearTimeout(hardTimer);signal?.removeEventListener('abort',abort);};
    const collect=(which,chunk)=>{bytes+=chunk.length;if(bytes>maxBytes){overflow=true;kill();return;}if(which==='out')stdout+=chunk;else stderr+=chunk;};
    child.stdout.on('data',c=>collect('out',c));child.stderr.on('data',c=>collect('err',c));
    child.stdin.on('error',()=>{});
    child.on('error',error=>{if(settled)return;settled=true;cleanup();reject(new Error(`Cannot start ${binary}: ${error.message}`));});
    child.on('close',(code,exitSignal)=>{if(settled)return;settled=true;cleanup();resolveResult({stdout,stderr,code,signal:exitSignal,timedOut,overflow,aborted:!!signal?.aborted});});
    child.stdin.end(input);if(signal?.aborted)kill();
  });
}

export async function runCodex(prompt,{root=process.cwd(),sandbox='read-only',timeoutMs=180000,signal,schema,binary=process.env.CODEX_BIN||'codex',backend=process.env.SWARM_MODEL_BACKEND||'codex',gatewayBaseUrl=process.env.SWARM_GPT_LOAD_BASE_URL||'http://127.0.0.1:3001/v1',gatewayKeyFile=process.env.SWARM_GPT_LOAD_KEY_FILE||resolve(here,'../../work/gpt-load-runtime/data/westlake-client.key'),model=process.env.SWARM_GPT_LOAD_MODEL||'gpt-6.1-sol',reasoningEffort=process.env.SWARM_MODEL_REASONING_EFFORT||'high'}={}) {
  if(!['codex','gpt-load'].includes(backend))throw new Error('Unknown model backend');
  const args=['exec','--json','--ephemeral','--sandbox',sandbox,'-C',resolve(root),'--skip-git-repo-check'];
  let env,secret='';
  if(backend==='gpt-load'){
    const url=new URL(gatewayBaseUrl);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname.replace(/\/$/,'')!=='/v1')throw new Error('GPT-Load backend must use a loopback /v1 endpoint');
    secret=(await readFile(gatewayKeyFile,'utf8')).trim();
    if(!secret)throw new Error('GPT-Load client AccessKey file is empty');
    env={...process.env,GPT_LOAD_ACCESS_KEY:secret};
    const overrides={
      model_provider:'westlake_gpt_load',model,model_reasoning_effort:reasoningEffort,
      'model_providers.westlake_gpt_load.name':'Westlake GPT-Load',
      'model_providers.westlake_gpt_load.base_url':url.href.replace(/\/$/,''),
      'model_providers.westlake_gpt_load.env_key':'GPT_LOAD_ACCESS_KEY',
      'model_providers.westlake_gpt_load.wire_api':'responses',
      'model_providers.westlake_gpt_load.requires_openai_auth':false,
      'model_providers.westlake_gpt_load.request_max_retries':0,
      'model_providers.westlake_gpt_load.stream_max_retries':0,
      'cli_auth_credentials_store':'ephemeral',
      // Preserve operator include/exclude rules and enable default KEY/TOKEN filtering.
      'shell_environment_policy.ignore_default_excludes':false,
    };
    for(const[key,value]of Object.entries(overrides))args.push('-c',`${key}=${JSON.stringify(value)}`);
  }
  if(schema)args.push('--output-schema',resolve(schema));
  args.push('-');
  const execution=await runProcess(binary,args,{cwd:root,input:prompt,timeoutMs,signal,env});
  const redact=value=>secret?String(value).split(secret).join('[redacted-gateway-key]'):String(value);
  if(execution.timedOut)throw new Error('Codex execution timed out');
  if(execution.overflow)throw new Error('Codex output exceeded the configured limit');
  if(execution.aborted)throw new Error('Codex execution aborted');
  const events=execution.stdout.split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
  const messages=events.filter(e=>e.type==='item.completed'&&e.item?.type==='agent_message').map(e=>e.item.text);
  const failure=events.find(e=>e.type==='turn.failed'||e.type==='error');
  if(execution.code!==0||failure)throw new Error(`Codex failed (exit ${execution.code}): ${redact(failure?.error?.message||failure?.message||execution.stderr.slice(-1500)||'no error detail')}`);
  if(!messages.length)throw new Error('Codex completed without an assistant message');
  return {text:redact(messages.at(-1)),usage:events.findLast(e=>e.type==='turn.completed')?.usage??null,backend,model:backend==='gpt-load'?model:null,reasoningEffort:backend==='gpt-load'?reasoningEffort:null};
}

export const chatSchema=resolve(here,'chat.schema.json');
