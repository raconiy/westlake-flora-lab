import {createHash} from 'node:crypto';
import {chmodSync, closeSync, lstatSync, mkdirSync, openSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const retentionMs=24*60*60*1000;
const maxQueuedAndRunning=128;
const maxRecords=2048;
const error=(status,code)=>Object.assign(new Error(code),{status,code});
function canonical(value,depth=0){
 if(depth>32)throw error(400,'payload_too_deep');
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
function publicJob(row){
 if(!row)return null;
 if(row.status==='completed')return {status:row.status,...JSON.parse(row.result)};
 return row.status==='failed'?{status:row.status,error:row.error}:{status:row.status};
}
function privateDatabase(dir,name){
 const file=join(dir,name);
 const fd=openSync(file,'a',0o600);closeSync(fd);chmodSync(file,0o600);
 return new DatabaseSync(file);
}
export function openJobs({dir,hasSlot,run,now=Date.now,maxPending=maxQueuedAndRunning,maxTotal=maxRecords,ttl=retentionMs}){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const stat=lstatSync(dir);
 if(!stat.isDirectory()||(stat.mode&0o077)!==0||stat.uid!==process.getuid())throw Error('Relay state directory must be private and owned by the relay user');
 // Hold a separate SQLite writer lock for the process lifetime. A second
 // daemon must not mark the first daemon's live calls as abandoned.
 const owner=privateDatabase(dir,'owner.sqlite');
 let db;
 try{
  owner.exec('BEGIN EXCLUSIVE');
  db=privateDatabase(dir,'jobs.sqlite');
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA synchronous=FULL;
   PRAGMA wal_autocheckpoint=128;PRAGMA journal_size_limit=2097152;
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,hash TEXT NOT NULL,payload TEXT,
   status TEXT NOT NULL,created INTEGER NOT NULL,finished INTEGER,result TEXT,error TEXT);
   CREATE INDEX IF NOT EXISTS pending ON jobs(status,created);
   CREATE INDEX IF NOT EXISTS expiry ON jobs(finished);`);
  db.prepare("UPDATE jobs SET status='failed',finished=?,error='relay_restarted',payload=NULL WHERE status='running'").run(now());
 }catch(e){db?.close();owner.close();throw e;}
 const lookup=db.prepare('SELECT status,result,error,hash FROM jobs WHERE id=?');
 const clean=db.prepare('DELETE FROM jobs WHERE finished<=?');
 const count=db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status IN ('queued','running')),0) AS pending FROM jobs");
 const put=db.prepare("INSERT INTO jobs(id,hash,payload,status,created) VALUES(?,?,?,'queued',?)");
 const next=db.prepare("SELECT id,payload FROM jobs WHERE status='queued' ORDER BY created,rowid LIMIT 1");
 const claim=db.prepare("UPDATE jobs SET status='running' WHERE id=? AND status='queued'");
 const finish=db.prepare("UPDATE jobs SET status=?,finished=?,payload=NULL,result=?,error=? WHERE id=? AND status='running'");
 let stopped=false,scheduled=false;
 const timer=setInterval(()=>{clean.run(now()-ttl);},Math.min(ttl,60000));timer.unref();
 function wake(){
  if(stopped||scheduled)return;
  scheduled=true;
  setImmediate(()=>{
   scheduled=false;
   if(stopped)return;
   while(hasSlot()){
    const row=next.get();
    if(!row)break;
    claim.run(row.id);
    // run() reserves the shared HTTP/model slot synchronously before yielding.
    void execute(row);
   }
  });
 }
 async function execute(row){
  let status='failed',result=null,failure=null;
  try{result=JSON.stringify(await run(JSON.parse(row.payload)));status='completed';}
  catch(e){failure=/^(gateway_http_\d{3}|gateway_timeout|gateway_unavailable|invalid_upstream_result|empty_model_reply)$/.test(e?.code)?e.code:'relay_error';}
  if(!stopped){finish.run(status,now(),result,failure,row.id);wake();}
 }
 wake();
 return {
  get(id){clean.run(now()-ttl);return publicJob(lookup.get(id));},
  submit(id,job){
   const payload=canonical(job),hash=createHash('sha256').update(payload).digest('hex');
   clean.run(now()-ttl);
   const old=lookup.get(id);
   if(old){if(hash!==old.hash)throw error(409,'job_payload_conflict');return publicJob(old);}
   const n=count.get();
   if(n.pending>=maxPending||n.total>=maxTotal)throw error(503,'job_capacity_exceeded');
   put.run(id,hash,payload,now());wake();return {status:'queued'};
  },
  wake,
  close(){if(stopped)return;stopped=true;clearInterval(timer);db.close();owner.close();}
 };
}
