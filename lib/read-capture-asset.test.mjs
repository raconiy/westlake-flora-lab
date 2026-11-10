import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {readCaptureAsset} from '../app/readCaptureAsset.ts';

const MiB=1024*1024;
function geometry(size=6*MiB+320) {
  // A valid GLB v2 with a padded JSON chunk and deterministic, offset-sensitive BIN.
  const json=Buffer.from('{"asset":{"version":"2.0"}} ');
  const b=Buffer.alloc(size);b.write('glTF'); b.writeUInt32LE(2,4);b.writeUInt32LE(size,8);
  b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);
  const pos=20+json.length;b.writeUInt32LE(size-pos-8,pos);b.writeUInt32LE(0x004e4942,pos+4);
  let s=1234567;for(let i=pos+8;i<b.length;i++){s=(Math.imul(1664525,s)+1013904223)>>>0;b[i]=s>>>24;}
  return b;
}
const fixture=geometry();
const digest=b=>createHash('sha256').update(new Uint8Array(b)).digest('hex');
const expectBytes=(result,b=fixture)=>{assert.equal(result.byteLength,b.length);assert.equal(digest(result),digest(b));};

async function serverFor(t,bytes,handler){
  const requests=[];
  const server=http.createServer((req,res)=>{
    const m=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'');
    const start=m?+m[1]:0,end=m?Math.min(+m[2],bytes.length-1):bytes.length-1;
    const item={start,end,range:!!m,url:req.url,closed:false,finished:false};
    requests.push(item);res.on('close',()=>{item.closed=true;});res.on('finish',()=>{item.finished=true;});
    const body=bytes.subarray(start,end+1);
    const head=(len=body.length,s=start,e=end,os=bytes.length)=>res.writeHead(206,{'content-range':`bytes ${s}-${e}/${os}`,'content-length':String(len)});
    const ok=()=>{if(m){head();res.end(body);}else{res.writeHead(200,{'content-length':bytes.length});res.end(bytes);}};
    const cutoff=()=>{head();res.write(body.subarray(0,Math.min(8192,body.length-1)));const timer=setTimeout(()=>res.destroy(),14);res.once('close',()=>clearTimeout(timer));};
    try{handler({req,res,bytes,body,item,requests,head,ok,cutoff});}catch(err){res.destroy(err);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {url:'http://127.0.0.1:'+server.address().port+'/scene.glb?version=review',requests};
}
async function load(url,signal=AbortSignal.timeout(20000)){
  const progress=[];const buf=await readCaptureAsset(url,signal,n=>progress.push(n));
  assert.ok(progress.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
  return buf;
}

for (const stage of ['first','later']) test('recovers when real 206 body stream breaks after headers: '+stage,async t=>{
  let interrupted;
  const {url,requests}=await serverFor(t,fixture,o=>{
    if(interrupted===undefined&&o.item.range&&(stage==='first'?o.item.start===0:o.item.start>0)){
      interrupted=o.item.start;o.cutoff();return;
    }
    o.ok();
  });
  expectBytes(await load(url));assert.notEqual(interrupted,undefined);
  assert.ok(requests.filter(r=>r.start===interrupted).length>=2||requests.some(r=>!r.range),'missing failed offset was not recovered');
});

for(const fault of ['wrong offset','short complete body']) test('does not sew a corrupt 206 into the final asset: '+fault,async t=>{
  let injected=0;
  const {url}=await serverFor(t,fixture,o=>{
    if(injected===0&&o.item.range&&o.item.start>0){
      injected++;const {start,end}=o.item;
      if(fault==='wrong offset'){o.head(o.body.length,start-1,end-1);o.res.end(o.bytes.subarray(start-1,end));}
      else {const short=o.body.subarray(0,-37);o.head(short.length);o.res.end(short);}
      return;
    }
    o.ok();
  });
  expectBytes(await load(url));assert.equal(injected,1);
});

test('repeated interruptions end with an error and bounded traffic',async t=>{
  const b=geometry(96*1024);
  const {url,requests}=await serverFor(t,b,o=>{
    if(o.item.range)o.cutoff();
    else{o.res.writeHead(503);o.res.end();}
  });
  const signal=AbortSignal.timeout(17000);
  await assert.rejects(load(url,signal));
  assert.equal(signal.aborted,false,'an unbounded retry loop was only stopped by the test deadline');
  assert.ok(requests.length>=2&&requests.length<40,'unexpected attempt count '+requests.length);
});

test('aborting in-flight requests closes sibling streams and starts no new ranges',async t=>{
  let pending=0,started;const ready=new Promise(r=>{started=r;});
  const controller=new AbortController();
  const {url,requests}=await serverFor(t,fixture,o=>{
    if(!o.item.range||o.item.start===0){o.ok();return;}
    o.head();o.res.write(o.body.subarray(0,8));if(++pending===2)setTimeout(started,70);
  });
  const reading=load(url,controller.signal);
  const rejected=assert.rejects(reading);
  let timer;
  try{await Promise.race([ready,new Promise((_,rej)=>{timer=setTimeout(()=>rej(Error('parallel ranges never opened')),3500);})]);}
  finally{clearTimeout(timer);controller.abort();}
  await rejected;
  const n=requests.length;await sleep(180);
  assert.equal(requests.length,n,'queued ranges started after abort');
  assert.ok(requests.filter(r=>r.start>0).every(r=>r.closed&&!r.finished),'one sibling response was left in flight');
});

test('normal HTTP 200 host returns verified full GLB bytes',async t=>{
  const {url}=await serverFor(t,fixture,o=>{o.res.writeHead(200,{'content-length':fixture.length});o.res.end(fixture);});
  expectBytes(await load(url));
});

test('rejects truncated HTTP 200 even when its shorter content-length is internally consistent',async t=>{
  const partial=fixture.subarray(0,fixture.length-4096);
  const {url}=await serverFor(t,partial,o=>{o.res.writeHead(200,{'content-length':partial.length});o.res.end(partial);});
  await assert.rejects(load(url));
});

test('splitting a consistently broken large part uses distinct cache keys; smaller exact ranges reconstruct the asset',async t=>{
  let failed;
  const {url,requests}=await serverFor(t,fixture,o=>{
    const {start,end,range}=o.item;
    if(!range){o.res.writeHead(503);o.res.end();return;}
    if(!failed&&start>0&&end-start+1>=MiB)failed={start,end,url:o.item.url};
    if(failed&&start===failed.start&&end===failed.end){o.cutoff();return;}
    o.ok();
  });
  expectBytes(await load(url));
  assert.ok(failed,'fixture did not exercise a large part');
  const smaller=requests.filter(r=>r.start>=failed.start&&r.end<=failed.end&&r.end-r.start<failed.end-failed.start);
  assert.ok(smaller.length>=2,'no smaller parts requested');
  assert.ok(smaller.every(r=>r.url!==failed.url),'split part reused the failed cached URL');
});

test('a terminal bad range cancels sibling streams instead of draining background traffic',async t=>{
  let hanging;
  const {url}=await serverFor(t,fixture,o=>{
    if(!o.item.range){o.res.writeHead(503);o.res.end();return;}
    if(o.item.start===0){o.ok();return;}
    if(!hanging){
      hanging=o.item;o.head();o.res.write(o.body.subarray(0,32));return;
    }
    o.res.writeHead(403,{'content-length':0});o.res.end();
  });
  const guard=AbortSignal.timeout(17000);
  await assert.rejects(load(url,guard));assert.equal(guard.aborted,false);
  assert.ok(hanging);await sleep(120);
  assert.equal(hanging.closed,true,'failed load left another transfer open');
  assert.equal(hanging.finished,false);
});

test('chunked 200 without content-length still checks the GLB header length',async t=>{
  const incomplete=fixture.subarray(0,91);
  const {url}=await serverFor(t,incomplete,o=>{
    o.res.writeHead(200,{'transfer-encoding':'chunked'});o.res.write(incomplete.subarray(0,13));o.res.end(incomplete.subarray(13));
  });
  await assert.rejects(load(url));
});

for (const behavior of ['ETag changes','range switches to HTTP 200']) test('discards partial old revision and reads a complete replacement when '+behavior,async t=>{
  const next=Buffer.from(fixture);next[99]^=0xe7;next[next.length-333]^=0x66;
  let changed=false,servedWhole=0;
  const {url}=await serverFor(t,fixture,o=>{
    const {start,end,range}=o.item;
    if (!range && behavior === 'range switches to HTTP 200') {
      o.res.writeHead(503); o.res.end(); return;
    }
    if(range&&start===0){o.res.setHeader('etag','"v1"');o.ok();return;}
    if(range&&start>0)changed=true;
    if(range&&behavior==='ETag changes'){
      o.res.setHeader('etag','"v2"');o.head();o.res.end(next.subarray(start,end+1));return;
    }
    o.res.writeHead(200,{etag:'"v2"','content-length':next.length});o.res.end(next);servedWhole++;
  });
  expectBytes(await load(url),next);
  assert.ok(changed&&servedWhole>=1,'did not exercise the live representation transition');
});

test('HTTP 200 HTML error document is never returned as a binary model',async t=>{
  const html=Buffer.from('<!doctype html><html><title>Maintenance</title></html>');
  const {url}=await serverFor(t,html,o=>{o.res.writeHead(200,{'content-type':'text/html','content-length':html.length});o.res.end(html);});
  await assert.rejects(load(url));
});

test('public incident replay: a proxy cutting one interval at 293,625 bytes recovers via 256 KiB subranges',async t=>{
  let interval;const firstCut=293625,subSize=256*1024;const b=geometry(4*MiB+20);
  const {url,requests}=await serverFor(t,b,o=>{
    const {range,start,end}=o.item;
    if(!range){o.res.writeHead(503);o.res.end();return;}
    if(!interval&&start>0&&end-start+1>firstCut)interval={start,end};
    if(interval&&start>=interval.start&&end<=interval.end&&o.body.length>firstCut){
      o.head();o.res.write(o.body.subarray(0,firstCut));const timer=setTimeout(()=>o.res.destroy(),14);o.res.once('close',()=>clearTimeout(timer));return;
    }
    o.ok();
  });
  expectBytes(await load(url),b);assert.ok(interval);
  const all=requests.filter(r=>r.start>=interval.start&&r.end<=interval.end);
  assert.ok(all.some(r=>r.end-r.start+1<=subSize&&r.finished),'never successfully transferred a small range');
  const cutsAtOtherOffsets=all.filter(r=>r.start>interval.start&&r.end-r.start+1>firstCut);
  assert.ok(cutsAtOtherOffsets.length<=2,'after learning a viable range size, the same broken sizes were repeatedly retried at every subsequent offset');
});

for (const fault of ['wrong magic', 'unsupported version']) {
  test('valid HTTP 206 interval carrying a GLB with ' + fault + ' fails before subsequent ranges', async t => {
    const corrupt = Buffer.from(fixture);
    if (fault === 'wrong magic') corrupt.write('HTML');
    else corrupt.writeUInt32LE(1, 4);
    const {url, requests} = await serverFor(t, corrupt, o => o.ok());
    await assert.rejects(load(url), /binary glTF 2.0/);
    assert.ok(requests.every(request => request.range && request.start === 0));
  });
}
