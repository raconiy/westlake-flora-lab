import fs from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const runtime=resolve(workspace,'work/community-runtime'),key=(await fs.readFile(resolve(runtime,'relay.key'),'utf8')).trim();
const base='https://westlake-flora-lab-yungu.sableborage.chatgpt.site/api/community';
export async function community(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const value=await r.json();if(!r.ok)throw Error('Community API '+r.status);return value;}
const mapPath=resolve(runtime,'task-map.json');
async function readMap(){try{return JSON.parse(await fs.readFile(mapPath,'utf8'));}catch(e){if(e.code==='ENOENT')return{};throw e;}}
async function saveMap(map){const temp=mapPath+'.tmp';await fs.writeFile(temp,JSON.stringify(map,null,2)+'\n',{mode:0o600});await fs.rename(temp,mapPath);}
export async function sync(){
 const map=await readMap(),r=await fetch('http://127.0.0.1:8788/api/tasks',{signal:AbortSignal.timeout(10000)}),data=await r.json();if(!r.ok)throw Error('Coordinator unavailable');let changed=false;
 for(const [suggestionId,item]of Object.entries(map)){
  const task=data.tasks.find(t=>t.id===item.taskId);if(!task)continue;
  const result=task.result||{};let status='queued',summary='主控已审查并分配到执行队列。';
  if(task.status==='leased'){status='running';summary='隔离工作区执行中；尚未完成验证。';}
  if(['failed','validation_failed','cancelled'].includes(task.status)){status='failed';summary='本次执行未通过；保留失败记录，等待主控定位。没有合并或发布。';}
  if(task.status==='completed'){status='review';summary=`${result.model||'模型'} / ${result.reasoningEffort||'未报告推理强度'} 已返回；验证${result.validationStatus==='passed'?'通过':'尚未确认通过'}，等待主控核对修改。`;}
  if((result.merged===true||(task.kind==='research'&&result.reviewStatus==='verified_existing'))&&result.deploymentUrl){status='deployed';summary=item.publicSummary||'主控已审阅并整合；自动测试、构建和部署通过。';}
  const update={status,summary,taskId:task.id,...(status==='deployed'?{deploymentUrl:result.deploymentUrl}:{})};
  const fingerprint=JSON.stringify(update);if(item.lastSynced===fingerprint)continue;
  await community('/moderate/'+suggestionId,update);item.lastSynced=fingerprint;changed=true;
 }
 if(changed)await saveMap(map);
}
const args=process.argv.slice(2);
if(args[0]==='review'){
 const data=await community('/relay/review');console.log(JSON.stringify(data,null,2));
}else if(args[0]==='assign'){
 const [,suggestionId,taskFile]=args;if(!/^[\w-]{20,50}$/.test(suggestionId||'')||!taskFile)throw Error('Usage: community-operator.mjs assign <suggestion-id> <reviewed-task.json>');
 const map=await readMap();if(map[suggestionId])throw Error('Suggestion already has an assigned task; inspect it before reassigning');
 const task=JSON.parse(await fs.readFile(resolve(taskFile),'utf8'));if(!['code','research'].includes(task.kind)||typeof task.prompt!=='string'||typeof task.title!=='string')throw Error('Invalid reviewed task');
 const current=(await community('/suggestions')).suggestions.find(s=>s.id===suggestionId);if(!current)throw Error('Unknown suggestion');
 const response=await fetch('http://127.0.0.1:8788/api/suggestions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...task,requestKey:'community-'+suggestionId,title:('社区建议 · '+task.title).slice(0,200)})});const assigned=await response.json();if(!response.ok)throw Error('Task enqueue failed');
 map[suggestionId]={taskId:assigned.task.id,assignedAt:Date.now(),publicSummary:task.publicSummary||null};await saveMap(map);await sync();console.log(JSON.stringify({suggestionId,taskId:assigned.task.id,status:assigned.task.status}));
}else if(args[0]==='sync')await sync();
else if(args.length)throw Error('Commands: review | assign <id> <reviewed-task.json> | sync');
