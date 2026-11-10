import http from 'node:http';
import {open,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {roles,uuid} from './artifact.mjs';
import {socket} from './inference.mjs';

const coordinator='http://127.0.0.1:8788';

export function infer(task,signal){
  return new Promise((resolve,reject)=>{
    // Deliberately pass only task data. The lease token and coordinator bearer
    // never reach the model or the inference helper.
    const {id,title,kind,role,prompt,priorDeliveries}=task;
    const req=http.request({socketPath:socket,path:'/research',method:'POST',signal,headers:{'content-type':'application/json'}},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>64_000)res.destroy(Error('invalid_helper_size'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode!==200)throw Error(data.error||'inference_error');resolve(data);}catch(e){reject(e);}});
    });
    req.on('error',reject);
    req.end(JSON.stringify({id,title,kind,role,prompt,priorDeliveries}));
  });
}

export async function durableAttempt(dir,task,perform){
  if(!uuid.test(task.id))throw Error('bad_task_id');
  const stem=join(dir,task.id),resultFile=stem+'.json';
  try{return JSON.parse(await readFile(resultFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  let marker;
  try{marker=await open(stem+'.attempt','wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('prior_attempt_requires_review');throw e;}
  try{await marker.writeFile(String(Date.now()));await marker.sync();}finally{await marker.close();}
  async function syncDirectory(){const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}}
  await syncDirectory();
  const receipt=await perform();
  const out=await open(stem+'.tmp','wx',0o600);
  try{await out.writeFile(JSON.stringify(receipt));await out.sync();}finally{await out.close();}
  await rename(stem+'.tmp',resultFile);await syncDirectory();
  return receipt;
}

async function main(){
  const role=process.argv[2];
  if(!roles.includes(role))throw Error('bad_role');
  const id='research-'+role,dir=process.env.STATE_DIRECTORY;
  const token=(await readFile(join(process.env.CREDENTIALS_DIRECTORY,'worker-token'),'utf8')).trim();
  if(!dir||!token)throw Error('missing_worker_configuration');
  const call=async(path,body)=>{
    const res=await fetch(coordinator+path,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(6_000)});
    if(!res.ok){await res.body?.cancel();const error=Error('queue_http_'+res.status);error.status=res.status;throw error;}
    return res.json();
  };
  const stop=new AbortController();
  for(const evt of ['SIGTERM','SIGINT'])process.once(evt,()=>stop.abort());
  const heartbeat='/api/workers/'+id+'/heartbeat';
  let registered=false,idleBeat=0;
  while(!stop.signal.aborted){
    let delay=2500;
    try{
      if(!registered){await call('/api/workers/register',{id,label:role,roles:[role]});registered=true;}
      if(Date.now()>=idleBeat){await call(heartbeat,{});idleBeat=Date.now()+15000;}
      const {task}=await call('/api/lease',{workerId:id});
      if(task){
        if(task.kind!=='research'||task.role!==role||!uuid.test(task.id))throw Error('unexpected_lease_scope');
        const lost=new AbortController(),inferenceSignal=AbortSignal.any([stop.signal,lost.signal,AbortSignal.timeout(255_000)]);
        const lease={workerId:id,taskId:task.id,leaseToken:task.leaseToken};
        const renew=setInterval(()=>call(heartbeat,lease).catch(e=>{if([403,404,409].includes(e.status))lost.abort();}),12000);
        try{
          const payload=await durableAttempt(dir,task,async()=>{
            try{return {status:'completed',result:await infer(task,inferenceSignal)};}
            catch(e){const code=/^(gateway_http_[0-9]+|gateway_timeout|invalid_artifact|invalid_limitations|invalid_record|missing_usage|incomplete_or_unexpected_upstream|gateway_result_unavailable|missing_or_oversized_output|completion_exceeds_queue_limit)$/.test(e.message)?e.message:'inference_interrupted';
              return {status:'failed',result:{summary:code,kind:'research_failure'}};}
          }).catch(e=>{if(e.message==='prior_attempt_requires_review')return {status:'failed',result:{summary:e.message,kind:'research_failure'}};throw e;});
          await call('/api/tasks/'+task.id+'/complete',{...lease,...payload});
          console.log(JSON.stringify({task:task.id,role,status:payload.status}));
        }finally{clearInterval(renew);}
      }
    }catch(e){if(e.status===404)registered=false;delay=5000;console.error(JSON.stringify({role,error:e.status?'queue_http_'+e.status:'poll_interrupted'}));}
    if(!stop.signal.aborted)await sleep(delay,undefined,{signal:stop.signal}).catch(()=>{});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Research worker initialization failed');process.exitCode=1;});
