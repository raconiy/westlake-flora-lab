const $ = id => document.getElementById(id);
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function download(text, url) {
  const a=node('a',text); a.href=url; a.download='';return a;
}
function detail(title, render) {
  const el=node('details',undefined,'sub');el.append(node('summary',title));
  el.addEventListener('toggle',()=>{if(el.open&&!el.querySelector(':scope > .sub-content')){
    const body=node('div',undefined,'sub-content');render(body);el.append(body);
  }});return el;
}
const num = n => n==null?'未知':new Intl.NumberFormat('zh-CN').format(n);
const clock = (ms, date=false) => ms==null?'待核验':new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',hourCycle:'h23',...(date?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3
}).format(new Date(ms));
const titles={A:'实拍基线与工程函数',B:'候选与跨岗位复核',C:'最终整景独立裁决'};
const roles={structure:'树形分枝与冠层结构',foliage:'叶簇密度与屏幕抗锯齿',turf:'草坪多尺度与风',bark:'树皮与材质照明分离',registration:'场景配准与接地'};
const pretty = value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const pre=value=>node('pre',pretty(value),'raw');
const hex=buffer=>[...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function digest(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
const enc = new TextEncoder();
function renderRequest(body,p) {
  const b=p.requestBody;
  body.append(node('p',b.model+' · reasoning.effort '+b.reasoning.effort+' · stream '+b.stream,'usage'));
  body.append(node('h3','系统指令'),pre(b.instructions));
  for (const message of b.input){
    for(const item of message.content){
      if(item.type==='input_text')body.append(detail('实际输入文字（完整原文）',d=>d.append(pre(item.text))));
      if(item.type==='input_image'){
        const img=node('img',undefined,'preview');img.alt='实际发送给此岗位的影像拼图';img.loading='lazy';img.src=item.image_url;body.append(img);
      }
    }
  }
  body.append(detail('要求的 JSON 输出格式',d=>d.append(pre(b.text.format))),detail('完整请求 JSON（含图片编码）',d=>d.append(pre(b))));
}
function hashes(body,p) {
  const dl=node('dl',undefined,'hash-list');
  for(const [key,value] of [['请求字节 SHA-256',p.bodySha256],['系统指令与输入 SHA-256',p.sourcePromptSha256],[p.responseAvailable?'模型答复 SHA-256':p.partialResponseAvailable?'不完整答复 SHA-256':'无答复空文件 SHA-256',p.outputSha256],['私存 HTTP 回执摘要',p.receiptBodySha256],['网关请求编号',p.requestId],['匹配依据',p.gatewayMatch]]){dl.append(node('dt',key),node('dd',value||'无','hash'));}
  body.append(dl,node('p',p.gatewayStartedAtMs!=null?'时间以已关联的实际网关尝试为准。HTTP 200 不等于完整答复；原始 HTTP 回执私存，公开文件提供实发请求正文与实际答复正文。':'该失败任务使用客户端起止时间；无完整模型答复。批次网关取消记录已保留，无法唯一绑定的逐笔账号和消耗仍为未知。','guide'));
  body.append(pre(p.gatewayAttempts));
}
function renderJob(p,evidence) {
  const actual=p.gatewayAttempts.find(a=>a.status===200)||{startedAtMs:p.gatewayStartedAtMs??p.startedAtMs,endedAtMs:p.gatewayEndedAtMs??p.endedAtMs};
  const box=node('details',undefined,'job');box.id=p.taskId;
  const sm=node('summary');sm.append(node('span','轮次 '+p.stage,'round'),node('span',p.roleLabel+(p.responseAvailable?'':p.partialResponseAvailable?' · 答复不完整':' · 无答复'),'task-title'),node('span',clock(actual.startedAtMs),'time'),node('span',p.credentialId==null?'未唯一绑定':'账号 '+p.credentialId,'identity'));box.append(sm);
  box.addEventListener('toggle',()=>{
    if(!box.open||box.querySelector(':scope > .job-body'))return;
    const body=node('div',undefined,'job-body'),start=clock(actual.startedAtMs,true),end=clock(actual.endedAtMs,true);
    body.append(node('p',p.taskId+' · '+(p.gatewayModel||p.requestBody.model)+' / '+(p.gatewayEffort||p.requestBody.reasoning.effort),'usage'),node('p',p.purpose),node('p',start+' → '+end+'（北京时间） · 输入 '+num(p.inputTokens)+' token · 输出 '+num(p.outputTokens)+' token','usage'));
    if(p.artifact?.decision){
      const labels={accept:'接受',conditional:'有条件接受',reject:'拒绝',insufficient:'证据不足'};
      body.append(node('p','独立裁决 · '+labels[p.artifact.decision],'disposition'));
      body.append(node('p',p.artifact.roleVerdict||p.artifact.diagnosis));
    }
    if(p.parents.length){const line=node('p','前序任务 ');for(const id of p.parents){const a=node('a',id);a.href='#'+id;line.append(a,document.createTextNode(' '));}body.append(line);}
    body.append(node('p',p.disposition,'disposition'));
    if(!p.responseAvailable)body.append(node('p','本次没有完整模型答复。错误或回执状态：'+(p.clientError||p.incompleteReason||p.status)+'。逐笔账号与 token 无法唯一核对时保留未知；不能将本次记作完整成功或将未知消耗记作零。','warning'));
    const e=evidence.taskEvidence?.[p.taskId]||[];
    if(e.length){const list=node('ul',undefined,'evidence');for(const x of e)list.append(node('li',x));body.append(list);}
    body.append(detail('完整提示词、实发图片与模型设置',d=>renderRequest(d,p)));
    body.append(detail('模型实际答复（完整原文）',d=>d.append(pre(p.responseText))));
    body.append(detail('采用与独立复核',d=>{d.append(node('p',p.disposition));if(p.validation.passed===false)d.append(node('p',p.responseAvailable?'存在未通过的用例，见下方数据。':'没有完整可执行产物，未进行模型夹具验收。','warning'));d.append(pre(p.validation));}));
    body.append(detail('回执、时间与哈希',d=>hashes(d,p)));
    const links=node('div',undefined,'links'),result=node('span',undefined,'verify-result'),button=node('button','复核原文哈希');button.type='button';result.setAttribute('role','status');
    const base=encodeURIComponent(p.taskId);
    links.append(download('原始请求 JSON','requests/'+base+'.json'),download('原始模型答复','responses/'+base+'.json'),button,result);
    button.addEventListener('click',async()=>{
      button.disabled=true;result.textContent='正在校验…';try{
        const [wire,reply]=await Promise.all(['requests','responses'].map(async dir=>{const r=await fetch(dir+'/'+base+'.json');if(!r.ok)throw Error('HTTP '+r.status);return r.arrayBuffer();}));
        const [a,b,c]=await Promise.all([digest(wire),digest(reply),digest(enc.encode(JSON.stringify({instructions:p.requestBody.instructions,input:p.requestBody.input})))]);
        if(a!==p.bodySha256||b!==p.outputSha256||c!==p.sourcePromptSha256)throw Error('摘要不一致');
        result.textContent=p.responseAvailable?'三项 SHA-256 一致':p.partialResponseAvailable?'请求 SHA-256 一致；不完整答复已核对':'请求 SHA-256 一致；确认无答复';
      }catch(error){result.textContent='校验失败 · '+error.message;result.classList.add('error');}finally{button.disabled=false;}
    });body.append(links);box.append(body);
  });
  return box;
}
function appendOption(select,value,label){const opt=node('option',label);opt.value=String(value);select.append(opt);}
function fillFollowups(log) {
  const slot=$('post-request-updates');
  const updates=log.postRequestUpdates||[];
  if(!updates.length)return;
  slot.hidden=false;
  slot.append(node('h2','请求完成后的实物复验'));
  for(const patch of updates){
    const box=node('article',undefined,'post-review');
    box.append(node('h3',patch.label),node('p',patch.disposition,'disposition'),node('p',patch.summary));
    for(const line of patch.findings||[])box.append(node('p',line));
    if(patch.image){const picture=node('img',undefined,'preview');picture.src=patch.image;picture.alt=patch.imageAlt||'同机位实物比较与复验依据';picture.loading='lazy';box.append(picture);}
    if(patch.secondaryImage){const picture=node('img',undefined,'preview');picture.src=patch.secondaryImage;picture.alt='实拍、pre-bark、撤回Bark2与Bark3的同机位原生渲染对照';picture.loading='lazy';box.append(picture);}
    box.append(detail('补丁资产和复验依据',body=>body.append(pre(patch))));
    const links=node('div',undefined,'links');
    for(const [key,label] of [['report','下载补丁复验 JSON'],['priorReport','查看撤回前预验'],['materialAudit','查看实际材质检查'],['crossRendererReport','查看跨渲染器比较'],['motionReport','查看关节回归']])if(patch[key])links.append(download(label,patch[key]));
    box.append(links);
    slot.append(box);
  }
}
function fill(log,evidence) {
  fillFollowups(log);
  if(log.failedBatchGatewayEvidence){
    const note=node('aside',undefined,'card');
    note.append(node('h2','失败尝试完整保留'),node('p','首批5个客户端在360秒读取超时，网关记录取消。随后5个恢复请求分别保留新的尝试编号。失败没有完整答复，不计成功；网关取消行中的0 token不能证明没有消耗。','warning'),detail('查看失败批次网关证据',body=>body.append(pre(log.failedBatchGatewayEvidence))));
    $('metrics').after(note);
  }
  const rs=log.records,acc=log.accounts;
  const totals=[['实际发出请求',rs.length],['完整模型回复',rs.filter(r=>r.responseAvailable).length],['参与匿名账号',acc.length],['已报告输出 token',rs.reduce((s,r)=>s+(r.outputTokens||0),0)]];
  for(const [label,value] of totals){const x=node('div',undefined,'metric');x.append(node('strong',num(value)),node('span',label));$('metrics').append(x);}
  $('metrics').after(node('p','成功回复不等于采用。已报告 token 包含不完整回复；5次客户端超时的实际消耗未知。完整输入用量见账号表和逐笔记录。','guide'));
  for(const s of log.stages){
    const el=node('article',undefined,'stage'),row=node('div',undefined,'stage-top');
    row.append(node('strong',s.stage+' · '+(titles[s.stage]||s.stage)),node('span',(s.commonUpstreamOverlapMs/1000).toFixed(3)+' 秒重叠','overlap'));
    el.append(row,node('small','全部客户端尝试 '+clock(s.allAttemptStartedAtMs,true)+' — '+clock(s.allAttemptEndedAtMs,true)),node('small',(s.stage==='A'?'恢复批次网关 ':'本轮网关 ')+clock(s.startedAtMs,true)+' — '+clock(s.endedAtMs,true)+' · '+s.completedReplies+' 完整 / '+s.incompleteReplies+' 不完整 · '+s.requests+' 次实发'));$('stages').append(el);
    appendOption($('stage-filter'),s.stage,s.stage+' · '+(titles[s.stage]||s.stage));
  }
  const t=node('table'),head=node('tr');for(const name of ['账号','逐笔关联','批次取消','已知输入 token','已知输出 token'])head.append(node('th',name));const th=node('thead');th.append(head);t.append(th);
  const tb=node('tbody');for(const a of acc){const row=node('tr');for(const v of ['账号 '+a.credentialId,a.taskIds.length,a.batchOnlyCanceledRequests||0,num(a.inputTokens),num(a.outputTokens)])row.append(node('td',v));tb.append(row);appendOption($('account-filter'),a.credentialId,'账号 '+a.credentialId);}t.append(tb);$('accounts').append(t,node('p','每个账号另有 1 笔首批取消请求，只能绑定到批次，无法唯一对应岗位；其实际 token 消耗未知。','guide'));
  if(rs.some(r=>r.credentialId==null))appendOption($('account-filter'),'unresolved','未唯一绑定');
  for(const role of [...new Set(rs.map(r=>r.role))])appendOption($('role-filter'),role,roles[role]||role);
  const selectors=[$('stage-filter'),$('account-filter'),$('role-filter')];
  function list(){
    const [s,a,k]=selectors.map(x=>x.value),filtered=rs.filter(r=>(!s||r.stage===s)&&(!a||(a==='unresolved'?r.credentialId==null:r.credentialId===Number(a)))&&(!k||k===r.role)).sort((a,b)=>(a.gatewayStartedAtMs??a.startedAtMs)-(b.gatewayStartedAtMs??b.startedAtMs));
    $('rows').replaceChildren(...filtered.map(r=>renderJob(r,evidence)));$('count').textContent=num(filtered.length)+' / '+num(rs.length)+' 笔';
    if(!filtered.length)$('rows').append(node('p','没有符合条件的任务。','empty'));
  }
  for(const s of selectors)s.addEventListener('change',list);
  $('clear').addEventListener('click',()=>{for(const s of selectors)s.value='';list();});
  function openHash(){
    const id=decodeURIComponent(location.hash.slice(1));if(!rs.some(r=>r.taskId===id))return;
    let el=document.getElementById(id);if(!el){for(const s of selectors)s.value='';list();el=document.getElementById(id);}
    el.open=true;el.scrollIntoView({block:'start'});
  }
  $('data').hidden=false;$('loading').hidden=true;list();openHash();window.addEventListener('hashchange',openHash);
}
try {
  const [log,evidence]=await Promise.all(['records.json','evidence.json'].map(async path=>{const res=await fetch(path);if(!res.ok)throw Error('HTTP '+res.status);return res.json();}));fill(log,evidence);
} catch(err) {
  $('loading').textContent='读取记录失败。可使用上方链接直接下载完整记录。';$('loading').classList.add('error');
}
