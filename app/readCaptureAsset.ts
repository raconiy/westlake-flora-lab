// Pages serves byte ranges. Fetch independent ranges so a slow connection does
// not hold the whole scene behind one download. Development hosts may return 200.
export async function readCaptureAsset(url: string, signal: AbortSignal, progress: (fraction:number)=>void) {
  const chunk = 2*1024*1024;
  const request = (start: number, end: number) => fetch(url+(url.includes('?')?'&':'?')+'part='+start, {
    headers:{Range:'bytes='+start+'-'+end}, signal
  });
  const first = await request(0,chunk-1);
  async function full(response:Response) {
    if (!response.ok) throw Error('Scene HTTP '+response.status);
    const length=Number(response.headers.get('content-length'));
    if (!response.body || !length) return response.arrayBuffer();
    const parts:Uint8Array<ArrayBuffer>[]=[];let received=0;
    const reader=response.body.getReader();
    for (;;) {
      const {value,done}=await reader.read();
      if(done)break;
      parts.push(new Uint8Array(value));received+=value.length;progress(received/length);
    }
    return new Blob(parts).arrayBuffer();
  }
  if(first.status!==206) return full(first);
  const info=first.headers.get('content-range')?.match(/^bytes 0-(\d+)\/(\d+)$/i);
  if(!info) {await first.body?.cancel(); return full(await fetch(url,{signal}));}
  const size=Number(info[2]),initial=await first.arrayBuffer();
  if(!Number.isSafeInteger(size)||size<initial.byteLength||initial.byteLength!==Number(info[1])+1) throw Error('Incomplete scene header');
  const bytes=new Uint8Array(size);bytes.set(new Uint8Array(initial));
  let received=initial.byteLength,next=received;
  progress(received/size);
  async function readRanges() {
    while(next<size) {
      const offset=next;next+=chunk;
      const end=Math.min(offset+chunk,size)-1;
      let ok=false;
      for(let attempt=0;attempt<2 && !ok;attempt++){
        const r=await request(offset,end);
        if(r.status!==206 || r.headers.get('content-range')?.toLowerCase()!=='bytes '+offset+'-'+end+'/'+size) {
          await r.body?.cancel();continue;
        }
        const part=await r.arrayBuffer();
        if(part.byteLength!==end+1-offset) continue;
        bytes.set(new Uint8Array(part),offset);received+=part.byteLength;ok=true;progress(received/size);
      }
      if(!ok)throw Error('Incomplete scene range '+offset);
    }
  }
  await Promise.all(Array.from({length:Math.min(6,Math.ceil((size-received)/chunk))},readRanges));
  return bytes.buffer;
}
