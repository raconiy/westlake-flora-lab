import http from 'node:http';
import {chmod,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {boundedText,decodeResponse,hash,requestBody,roles,uuid} from './artifact.mjs';

export const socket='/run/westlake-research-infer/infer.sock';
const contexts='/opt/westlake-swarm/research/context';

function validTask(t){
  return t?.kind==='research'&&uuid.test(t.id)&&roles.includes(t.role)&&boundedText(t.title,200)&&boundedText(t.prompt,16000)&&Array.isArray(t.priorDeliveries)&&t.priorDeliveries.length<=8;
}

export function inferenceServer({token,publicContext,gateway='http://127.0.0.1:3001/v1/responses',fetcher=fetch}){
  const active=new Set();
  return http.createServer(async(req,res)=>{
    const reply=(status,body)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));}};
    if(req.method!=='POST'||req.url!=='/research')return reply(404,{error:'unknown_route'});
    let role=null;
    try{
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>64_000)return reply(413,{error:'too_large'});chunks.push(chunk);}
      let task;
      try{task=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'invalid_json'});}
      if(!validTask(task))return reply(400,{error:'invalid_research_task'});
      if(active.has(task.role))return reply(429,{error:'role_busy'});
      role=task.role;active.add(role);
      const controller=new AbortController();
      res.once('close',()=>{if(!res.writableEnded)controller.abort();});
      const context=publicContext[role],start=Date.now();
      const upstream=await fetcher(gateway,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(240_000),controller.signal]),
        headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(requestBody(task,context))});
      if(!upstream.ok){await upstream.body?.cancel();return reply(502,{error:'gateway_http_'+upstream.status});}
      const result=decodeResponse(await upstream.json(),upstream.headers,start,Date.now(),task,hash(JSON.stringify(context)));
      return reply(200,result);
    }catch(e){
      const allowed=['invalid_artifact','invalid_limitations','invalid_record','incomplete_or_unexpected_upstream','missing_or_oversized_output','missing_usage','completion_exceeds_queue_limit'];
      return reply(502,{error:allowed.includes(e.message)?e.message:e.name==='TimeoutError'?'gateway_timeout':'gateway_result_unavailable'});
    }finally{if(role)active.delete(role);}
  });
}

async function main(){
  const token=(await readFile(join(process.env.CREDENTIALS_DIRECTORY,'inference-key'),'utf8')).trim();
  const publicContext=JSON.parse(await readFile(join(contexts,'approved.json'),'utf8'));
  if(!token||roles.some(role=>!publicContext[role]))throw Error('missing configuration');
  await unlink(socket).catch(e=>{if(e.code!=='ENOENT')throw e;});
  const server=inferenceServer({token,publicContext});
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  server.listen(socket,async()=>{try{await chmod(socket,0o660);console.log('Restricted research inference socket ready');}catch{process.exit(1);}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Research inference initialization failed');process.exitCode=1;});
