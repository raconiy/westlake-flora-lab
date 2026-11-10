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
const num = n => new Intl.NumberFormat('zh-CN').format(n);
const clock = (ms, date=false) => new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',hourCycle:'h23',...(date?{month:'2-digit',day:'2-digit'}:{}),hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3
}).format(new Date(ms));
const titles={A:'基线诊断与函数实作',B:'候选 B 与交叉核验',C:'成品对照与采用决定'};
const roles={morphology:'草叶形态',illumination:'阴阳照度',density:'草簇密度',contact_motion:'树基与草叶运动',texture_qa:'同机位纹理'};
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
  for(const [key,value] of [['请求字节 SHA-256',p.bodySha256],['系统指令与输入 SHA-256',p.sourcePromptSha256],['模型答复 SHA-256',p.outputSha256],['私存 HTTP 回执摘要',p.receiptBodySha256],['网关请求编号',p.requestId],['匹配依据',p.gatewayMatch]]){dl.append(node('dt',key),node('dd',value||'无','hash'));}
  body.append(dl,node('p','时间以成功上游尝试为准。原始 HTTP 回执私存，公开文件提供实际请求正文与模型答复正文。','guide'));
  body.append(pre(p.gatewayAttempts));
}
function renderJob(p,evidence) {
  const actual=p.gatewayAttempts.find(a=>a.status===200)||{startedAtMs:p.gatewayStartedAtMs,endedAtMs:p.gatewayEndedAtMs};
  const box=node('details',undefined,'job');box.id=p.taskId;
  const sm=node('summary');sm.append(node('span','轮次 '+p.stage,'round'),node('span',p.roleLabel,'task-title'),node('span',clock(actual.startedAtMs),'time'),node('span','账号 '+p.credentialId,'identity'));box.append(sm);
  box.addEventListener('toggle',()=>{
    if(!box.open||box.querySelector(':scope > .job-body'))return;
    const body=node('div',undefined,'job-body'),start=clock(actual.startedAtMs,true),end=clock(actual.endedAtMs,true);
    body.append(node('p',p.taskId+' · '+p.gatewayModel+' / '+p.gatewayEffort,'usage'),node('p',p.purpose),node('p',start+' → '+end+'（北京时间） · 输入 '+num(p.inputTokens)+' token · 输出 '+num(p.outputTokens)+' token','usage'));
    if(p.parents.length){const line=node('p','前序任务 ');for(const id of p.parents){const a=node('a',id);a.href='#'+id;line.append(a,document.createTextNode(' '));}body.append(line);}
    body.append(node('p',p.disposition,'disposition'));
    const e=evidence.taskEvidence?.[p.taskId]||[];
    if(e.length){const list=node('ul',undefined,'evidence');for(const x of e)list.append(node('li',x));body.append(list);}
    body.append(detail('完整提示词、实发图片与模型设置',d=>renderRequest(d,p)));
    body.append(detail('模型实际答复（完整原文）',d=>d.append(pre(p.responseText))));
    body.append(detail('采用与独立复核',d=>{d.append(node('p',p.disposition));if(p.validation.passed===false)d.append(node('p','扩展契约存在未通过的用例，见下方数据。','warning'));d.append(pre(p.validation));}));
    body.append(detail('回执、时间与哈希',d=>hashes(d,p)));
    const links=node('div',undefined,'links'),result=node('span',undefined,'verify-result'),button=node('button','复核原文哈希');button.type='button';result.setAttribute('role','status');
    const base=encodeURIComponent(p.taskId);
    links.append(download('原始请求 JSON','requests/'+base+'.json'),download('原始模型答复','responses/'+base+'.json'),button,result);
    button.addEventListener('click',async()=>{
      button.disabled=true;result.textContent='正在校验…';try{
        const [wire,reply]=await Promise.all(['requests','responses'].map(async dir=>{const r=await fetch(dir+'/'+base+'.json');if(!r.ok)throw Error('HTTP '+r.status);return r.arrayBuffer();}));
        const [a,b,c]=await Promise.all([digest(wire),digest(reply),digest(enc.encode(JSON.stringify({instructions:p.requestBody.instructions,input:p.requestBody.input})))]);
        if(a!==p.bodySha256||b!==p.outputSha256||c!==p.sourcePromptSha256)throw Error('摘要不一致');
        result.textContent='三项 SHA-256 一致';
      }catch(error){result.textContent='校验失败 · '+error.message;result.classList.add('error');}finally{button.disabled=false;}
    });body.append(links);box.append(body);
  });
  return box;
}
function appendOption(select,value,label){const opt=node('option',label);opt.value=String(value);select.append(opt);}
function fill(log,evidence) {
  const rs=log.records,acc=log.accounts;
  const totals=[['已核对的实际请求',rs.filter(r=>r.validation.gatewayVerified).length],['参与账号',acc.length],['输入 token',rs.reduce((s,r)=>s+r.inputTokens,0)],['输出 token',rs.reduce((s,r)=>s+r.outputTokens,0)]];
  for(const [label,value] of totals){const x=node('div',undefined,'metric');x.append(node('strong',num(value)),node('span',label));$('metrics').append(x);}
  for(const s of log.stages){
    const el=node('article',undefined,'stage'),row=node('div',undefined,'stage-top');
    row.append(node('strong',s.stage+' · '+(titles[s.stage]||s.stage)),node('span',(s.commonUpstreamOverlapMs/1000).toFixed(3)+' 秒重叠','overlap'));
    el.append(row,node('small',clock(s.startedAtMs,true)+' — '+clock(s.endedAtMs,true)+' · '+s.verifiedRequests+' 笔'));$('stages').append(el);
    appendOption($('stage-filter'),s.stage,s.stage+' · '+(titles[s.stage]||s.stage));
  }
  const t=node('table'),head=node('tr');for(const name of ['账号','请求','输入 token','输出 token'])head.append(node('th',name));const th=node('thead');th.append(head);t.append(th);
  const tb=node('tbody');for(const a of acc){const row=node('tr');for(const v of ['账号 '+a.credentialId,a.taskIds.length,num(a.inputTokens),num(a.outputTokens)])row.append(node('td',v));tb.append(row);appendOption($('account-filter'),a.credentialId,'账号 '+a.credentialId);}t.append(tb);$('accounts').append(t);
  for(const role of [...new Set(rs.map(r=>r.role))])appendOption($('role-filter'),role,roles[role]||role);
  const selectors=[$('stage-filter'),$('account-filter'),$('role-filter')];
  function list(){
    const [s,a,k]=selectors.map(x=>x.value),filtered=rs.filter(r=>(!s||r.stage===s)&&(!a||r.credentialId===Number(a))&&(!k||k===r.role)).sort((a,b)=>a.gatewayStartedAtMs-b.gatewayStartedAtMs);
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
