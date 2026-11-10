import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createRelay} from './remote-reply.mjs';

async function serve(t,fetchImpl,options={}){
 const server=createRelay({token:'fixture-d1',gatewayToken:'fixture-gateway',readAdminKey:async()=>'fixture-status',fetchImpl,...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});
 const base='http://127.0.0.1:'+server.address().port;
 return {health:()=>fetch(base+'/health'),call:(body,token='fixture-d1')=>fetch(base+'/complete',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})};
}
const response=text=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]});
test('health uses live gateway readiness, redacts identity data and does not fabricate worker telemetry',async t=>{
 let available=true;
 const relay=await serve(t,async(url,req)=>{
  assert.equal(url.pathname,'/api/groups/1/credentials');assert.equal(req.headers.authorization,'Bearer fixture-status');
  return Response.json({code:0,data:{items:[{credential_id:1,email:'private@example.com',effective_status:available?'available':'cooldown'},{credential_id:2,effective_status:'cooldown'}]}});
 });
 const first=await (await relay.health()).json();assert.equal(first.availableAccounts,1);assert.equal(first.capacitySource,'gpt-load-management');assert.equal(first.workers,undefined);assert.ok(!JSON.stringify(first).includes('@'));
 available=false;assert.equal((await (await relay.health()).json()).availableAccounts,0);
});
test('unreadable gateway status reports unavailable capacity',async t=>{
 const relay=await serve(t,async()=>new Response(null,{status:403}));
 const r=await relay.health();assert.equal(r.status,503);assert.equal((await r.json()).availableAccounts,null);
});
test('chat including old clients sends compact instructions; suggestion produces validated handoff',async t=>{
 let calls=0;
 const relay=await serve(t,async(url,req)=>{
  assert.equal(url.pathname,'/v1/responses');assert.equal(req.headers.authorization,'Bearer fixture-gateway');
  const prompt=JSON.parse(req.body);assert.equal(prompt.reasoning.effort,'high');assert.equal(prompt.model,'gpt-6.1-sol');
  if(calls++===0){assert.equal(prompt.text,undefined);assert.equal(JSON.parse(prompt.input).user,'树叶何时变黄？');return response('秋季叶绿素逐渐分解。');}
  assert.equal(prompt.text.format.type,'json_schema');
  return response(JSON.stringify({reply:'我已整理成一条可复查的建议。',suggestions:[{kind:'code',title:'银杏叶序',prompt:'检查银杏近主轴叶片挂载并验证连接。'}]}));
 });
 const chat=await relay.call({input:'树叶何时变黄？'});assert.deepEqual(await chat.json(),{reply:'秋季叶绿素逐渐分解。',suggestions:[]});
 const suggestions=await relay.call({kind:'triage',input:'修复银杏叶片穿干。'});assert.equal(suggestions.status,200);assert.equal((await suggestions.json()).suggestions[0].title,'银杏叶序');
});
test('rejects unauthorized, invalid kind, empty model output and malformed suggestions distinctly',async t=>{
 let answerCount=0;
 const relay=await serve(t,async()=>answerCount++===0?response(''):response('{"reply":"收到","suggestions":[]}'));
 const auth=await relay.call({input:'测试'},'wrong');assert.equal(auth.status,401);assert.equal(answerCount,0);
 const kind=await relay.call({input:'测试',kind:'arbitrary'});assert.equal(kind.status,400);assert.equal(answerCount,0);
 const empty=await relay.call({input:'测试'});assert.equal(empty.status,502);assert.equal((await empty.json()).error,'empty_model_reply');
 const malformed=await relay.call({input:'测试',kind:'suggestion'});assert.equal(malformed.status,502);assert.equal((await malformed.json()).error,'invalid_upstream_result');
});
test('times out one upstream call and releases its slot',async t=>{
 let calls=0;
 const relay=await serve(t,async(_,req)=>{
  if(calls++>0)return response('已恢复。');
  return new Promise((_,reject)=>req.signal.addEventListener('abort',()=>reject(req.signal.reason),{once:true}));
 },{timeout:15});
 const timed=await relay.call({input:'查看叶序'});assert.equal(timed.status,504);assert.equal((await timed.json()).error,'gateway_timeout');
 assert.equal((await relay.call({input:'再次查看'})).status,200);assert.equal(calls,2);
});
