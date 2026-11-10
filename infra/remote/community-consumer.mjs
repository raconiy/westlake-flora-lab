import {spawn} from 'node:child_process';
import {open, readFile, readdir, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const community = 'https://westlake-flora-lab-yungu.sableborage.chatgpt.site/api/community';
const gateway = 'http://127.0.0.1:3001';
const maxSlots = 5;
const heartbeatPeriod = 12_000;
const maxBody = 17_500; // The D1 API and the local relay both limit JSON body size.
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const size = value => Buffer.byteLength(JSON.stringify(value));

class UpstreamError extends Error {
 constructor(status) {super('HTTP '+status); this.status=status;}
}
async function json(url,{token,body,timeout=7_000}={}) {
 const headers={};
 if(token)headers.authorization='Bearer '+token;
 if(body!==undefined)headers['content-type']='application/json';
 const response=await fetch(url,{method:body===undefined?'GET':'POST',redirect:'error',headers,
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 if(!response.ok){await response.body?.cancel();throw new UpstreamError(response.status);}
 return response.json();
}
// curl supports HTTPS CONNECT on the older Node installations used for the
// GPU server. Its stdin config keeps both the D1 bearer and member text out of
// argv, stderr and the service journal. TLS validation remains enabled.
export function curlConfig(token,body){
 if (/[\r\n\x00]/.test(token))throw Error('Invalid D1 credential');
 const quote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t')+'"';
 return 'header = '+quote('Authorization: Bearer '+token)+'\nheader = "Content-Type: application/json"\ndata-binary = '+quote(JSON.stringify(body))+'\n';
}
async function communityThroughProxy(url,token,body,proxy){
 const config=curlConfig(token,body);
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/curl',['--disable','--silent','--proto','=https','--proxy',proxy,'--noproxy','','--connect-timeout','4','--max-time','10','--write-out','\\n%{http_code}','--config','-',url],{stdio:['pipe','pipe','ignore']});
  let size=0;const chunks=[];
  child.stdout.on('data',chunk=>{
   size+=chunk.length;if(size>1_000_000){child.kill();return;}chunks.push(chunk);
  });
  child.on('error',reject);
  child.stdin.on('error',()=>{});
  child.on('close',code=>{
   if(code!==0||size>1_000_000){reject(Error('Proxy transport failed'));return;}
   const output=Buffer.concat(chunks).toString('utf8'),at=output.lastIndexOf('\n');
   const status=Number(output.slice(at+1));
   if(status<200||status>=300){reject(new UpstreamError(status));return;}
   try{resolve(JSON.parse(output.slice(0,at)));}catch(e){reject(e);}
  });
  child.stdin.end(config);
 });
}
function log(event,details={}){console.log(JSON.stringify({event,...details}));}
const failureCode = error => error?.status || error?.name || 'error';

export function countAvailable(payload) {
 if(payload?.code!==0||!Array.isArray(payload.data?.items))throw Error('Unrecognized credential status');
 const ready=new Set();
 for(const row of payload.data.items){
  if(!Number.isSafeInteger(row.credential_id)||row.credential_id<1)throw Error('Missing credential identity');
  if(row.effective_status==='available' && (!row.auth_state || row.auth_state==='ready'))ready.add(row.credential_id);
 }
 return ready.size;
}

function relayBody(job){
 const body={jobId:job.id,input:job.input,scenario:job.scenario,history:[]};
 if(size(body)>maxBody)throw Error('Input exceeds local relay envelope');
 const history=Array.isArray(job.history)?job.history:[];
 for(let i=history.length-2;i>=0;i-=2){
  const pair=history.slice(i,i+2);
  if(pair[0]?.role!=='user'||pair[1]?.role!=='assistant')continue;
  const previous=body.history;
  body.history=[...pair,...previous];
  if(size(body)>maxBody){body.history=previous;break;}
 }
 return body;
}

export function completionBody(token,answer){
 if(typeof answer?.reply!=='string'||!answer.reply.trim()||answer.reply.trim()==='已收到建议，但没有生成可展示的回复。')throw Error('Empty model result');
 const body={leaseToken:token,reply:answer.reply.trim(),suggestions:[]};
 const suffix='\n（回复超过页面长度限制，已截短。）';
 if(body.reply.length>16_000||size(body)>maxBody){
  const chars=Array.from(body.reply);
  let low=0,high=Math.min(chars.length,16_000);
  while(low<high){
   const mid=Math.ceil((low+high)/2);
   const reply=chars.slice(0,mid).join('')+suffix;
   if(reply.length<=16_000&&size({...body,reply})<=maxBody)low=mid;else high=mid-1;
  }
  body.reply=chars.slice(0,low).join('')+suffix;
 }
 for(const candidate of (Array.isArray(answer.suggestions)?answer.suggestions:[]).slice(0,5)){
  if(!['code','research'].includes(candidate?.kind)||typeof candidate.title!=='string'||!candidate.title.trim()||typeof candidate.prompt!=='string'||!candidate.prompt.trim())continue;
  const item={title:candidate.title.slice(0,200),prompt:candidate.prompt.slice(0,8000),kind:candidate.kind};
  if(size({...body,suggestions:[...body.suggestions,item]})<=maxBody)body.suggestions.push(item);
 }
 return body;
}

// Only completed model attempts enter the outbox. Recovery can resend their
// fenced D1 completion, but never re-submit an inference to the local relay.
async function saveReceipt(dir,id,body){
 const file=join(dir,id+'.json'),tmp=join(dir,id+'.tmp');
 const fd=await open(tmp,'wx',0o600);
 try{await fd.writeFile(JSON.stringify(body));await fd.sync();}finally{await fd.close();}
 await rename(tmp,file);
 const parent=await open(dir,'r');try{await parent.sync();}finally{await parent.close();}
}

export function createConsumer({dir,callCommunity,probe,complete,report=log,now=Date.now}){
 const active=new Set();
 let capacity=0,healthDue=0,deliveryDue=0,deliveryDelay=0;
 async function publishHealth(stopping=false){
  try{capacity=stopping?0:Math.min(maxSlots,await probe());}
  catch(e){capacity=0;report('probe-failed',{error:failureCode(e)});}
  await callCommunity('/relay/heartbeat',{availableAccounts:capacity,workers:stopping?0:maxSlots,
   model:'gpt-6.1-sol',reasoningEffort:'high'});
  healthDue=now()+heartbeatPeriod;
 }
 async function deliver(){
  if(now()<deliveryDue)return false;
  const files=await readdir(dir);
  for(const file of files.filter(name=>name.endsWith('.json')||name.endsWith('.tmp'))){
   const id=file.slice(0,-(file.endsWith('.tmp')?4:5));
   if(!idPattern.test(id)||active.has(id))continue;
   // Never resurrect an incomplete write after a process restart.
   if(file.endsWith('.tmp')){await rename(join(dir,file),join(dir,id+'.interrupted'));continue;}
   try{
    const body=JSON.parse(await readFile(join(dir,file),'utf8'));
    await callCommunity('/relay/'+id+'/complete',body);
    report('result-delivered',{id,modelError:!!body.error});
   }catch(e){
    if(e.status===409){report('completion-fenced',{id});}
    else if(e.status===400||e.status===413||e instanceof SyntaxError){
     await rename(join(dir,file),join(dir,id+'.rejected'));report('completion-rejected',{id,error:failureCode(e)});continue;
    }else{
     deliveryDelay=Math.min(30_000,Math.max(1000,deliveryDelay*2));
     deliveryDue=now()+deliveryDelay;report('delivery-deferred',{id,error:failureCode(e)});return false;
    }
   }
   await unlink(join(dir,file));
  }
  deliveryDelay=0;deliveryDue=0;
  return true;
 }
 const pending=new Set();
 async function runJob(job){
  let body;
  try{body=completionBody(job.leaseToken,await complete(relayBody(job)));}
  catch(e){report('model-result-unavailable',{id:job.id,error:failureCode(e)});body={leaseToken:job.leaseToken,error:true};}
  await saveReceipt(dir,job.id,body);
 }
 async function tick(){
  if(now()>=healthDue)await publishHealth();
  if(!await deliver())return;
  while(active.size<capacity){
   const {job}=await callCommunity('/relay/claim',{});
   if(!job)break;
   if(!idPattern.test(job.id)||typeof job.leaseToken!=='string'||!job.leaseToken||active.has(job.id))throw Error('Invalid lease');
   active.add(job.id);report('job-claimed',{id:job.id,kind:job.kind});
   const run=runJob(job).catch(e=>report('outbox-write-failed',{id:job.id,error:failureCode(e)}))
    .finally(()=>{active.delete(job.id);pending.delete(run);});
   pending.add(run);
  }
 }
 return {tick,deliver,publishHealth,drain:()=>Promise.allSettled([...pending])};
}

async function main(){
 const credentials=process.env.CREDENTIALS_DIRECTORY,state=process.env.STATE_DIRECTORY;
 const relayToken=process.env.COMMUNITY_RELAY_TOKEN;
 if(!credentials||!state||!relayToken)throw Error('Required consumer service configuration is missing');
 const d1=(await readFile(join(credentials,'community-token'),'utf8')).trim();
 const admin=(await readFile(join(credentials,'gateway-status-token'),'utf8')).trim();
 if(!d1||!admin)throw Error('Required credential file is empty');
 const relay=new URL(process.env.LOCAL_RELAY_URL||'http://127.0.0.1:80');
 if(relay.protocol!=='http:'||relay.hostname!=='127.0.0.1'||relay.username||relay.password||relay.pathname!=='/'||relay.search||relay.hash)throw Error('Expected loopback relay origin');
 const proxy=process.env.COMMUNITY_HTTPS_PROXY;
 if(proxy&&!/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(proxy))throw Error('Expected loopback HTTP proxy');
 const consumer=createConsumer({dir:state,
  callCommunity:(path,body)=>proxy?communityThroughProxy(community+path,d1,body,proxy):json(community+path,{token:d1,body}),
  complete:body=>json(relay.origin+'/complete',{token:relayToken,body,timeout:175_000}),
  probe:async()=>{
   const [health,credentials]=await Promise.all([json(relay.origin+'/health'),json(gateway+'/api/groups/1/credentials',{token:admin})]);
   if(health?.ok!==true)throw Error('Local relay unavailable');
   return countAvailable(credentials);
  }});
 const controller=new AbortController();
 const stop=()=>controller.abort();
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 let delay=1_800;
 while(!controller.signal.aborted){
  try{await consumer.tick();delay=1_800;}
  catch(e){delay=Math.min(30_000,delay*2);log('poll-deferred',{error:failureCode(e)});}
  if(!controller.signal.aborted)await sleep(delay,undefined,{signal:controller.signal}).catch(()=>{});
 }
 await consumer.publishHealth(true).catch(e=>log('offline-heartbeat-deferred',{error:failureCode(e)}));
 await consumer.drain();await consumer.deliver();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main().catch(e=>{log('consumer-failed',{error:failureCode(e)});process.exitCode=1;});
}
