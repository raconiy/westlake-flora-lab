import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeCaptureBatch,readQuotaSnapshot,summarizePostrender} from '../public/capture17/account-usage.mjs';

const json=JSON.parse(readFileSync(new URL('../public/capture17/account-receipts.json',import.meta.url),'utf8'));

test('the five R3 upstream attempts reproduce the published independent comparison',()=>{
  const s=summarizeCaptureBatch(json);
  assert.equal(s.wall,118966);assert.equal(s.common,91653);assert.equal(s.sum,534859);
  assert.deepEqual(s.rows.map(r=>r.upstreamAttemptEndMs-r.upstreamAttemptStartMs),[102889,118935,105940,113895,93200]);
  assert.deepEqual(s.tokens,{input:34588,output:15804,reasoning:7638});
  assert.equal(new Date(s.start).toISOString(),'2026-11-10T11:22:03.848Z');
  assert.equal(new Date(s.end).toISOString(),'2026-11-10T11:24:02.814Z');
  assert.equal(new Set(s.rows.map(r=>r.credentialId)).size,5);
});

test('duplicate identities, duplicated requests, incomplete data, wrong summaries and other batches fail closed',()=>{
  for(const edit of [
    d=>d.requests[1].credentialId=d.requests[0].credentialId,
    d=>d.requests[1].requestId=d.requests[0].requestId,
    d=>delete d.requests[2].upstreamAttemptEndMs,
    d=>d.requests[1].code=429,
    d=>d.requests[3].reasoningTokens=d.requests[3].outputTokens+1,
    d=>d.scene='old-acceptance', d=>d.commonUpstreamOverlapMs++,
  ]){
    const d=structuredClone(json);edit(d);assert.throws(()=>summarizeCaptureBatch(d));
  }
});

test('20:45 account window snapshots keep their own observation timestamps and no account secrets',()=>{
  const quota=JSON.parse(readFileSync(new URL('../public/capture17/quota-20261110-2045.json',import.meta.url),'utf8'));
  const s=summarizeCaptureBatch(json), rows=readQuotaSnapshot(quota);
  assert.deepEqual(rows.map(r=>r.remainingPercent),[100,100,27,97,97]);
  assert.deepEqual(rows.map(r=>r.credentialId),s.rows.map(r=>r.credentialId));
  for(const r of rows){
    assert.deepEqual(Object.keys(r).sort(),['credentialId','observedAt','remainingPercent','windowSeconds']);
    assert.equal(r.windowSeconds,7*24*60*60);assert.ok(Date.parse(r.observedAt)>s.end);
  }
  assert.throws(()=>readQuotaSnapshot([rows[0],...rows.slice(0,4)]));
  assert.throws(()=>readQuotaSnapshot(rows.map(r=>({...r,windowSeconds:3600}))));
});

function laterFixture(){
  const start=summarizeCaptureBatch(json).end+60000, request=(seq,credentialId,stage)=>{
    return {credentialId,role:'qa',stage,requestId:'fixture-r'+seq,statusCode:200,outputTokens:10*seq,
      taskId:'fixture-t'+seq,parents:seq===3?['fixture-t1','fixture-t2']:[],startMs:start+1000*seq,endMs:start+1000*seq+500};
  };
  return {asOfUtc:new Date(start+5000).toISOString(),acceptedArtifacts:3,
    requests:[request(1,1,'检查'),request(2,2,'检查'),request(3,1,'修订')]};
}

test('later work counts only verified per-credential requests and preserves stage handoffs',()=>{
  const d=laterFixture(), result=summarizePostrender(d,json);
  assert.deepEqual(result.accounts.map(a=>[a.credentialId,a.count,a.outputTokens,...a.stages]),[[1,2,40,'检查','修订'],[2,1,20,'检查']]);
  assert.equal(result.output,60);assert.equal(result.repeated,1);assert.equal(result.accepted,3);
  assert.deepEqual(result.rows[2].parents,['fixture-t1','fixture-t2']);
  d.requests.pop();d.acceptedArtifacts=2;
  const firstRound=summarizePostrender(d,json);assert.equal(firstRound.repeated,0);assert.equal(firstRound.accounts.length,2);
});

test('an empty or mixed ledger cannot create zeroes, re-count R3, or turn a failed request into success',()=>{
  for(const edit of [
    d=>d.requests=[],d=>d.requests.push(d.requests[1]),
    d=>d.requests[0].requestId=json.requests[0].requestId,
    d=>d.requests[1].taskId=json.requests[1].task,
    d=>d.requests[1].statusCode=429,
    d=>d.requests[2].parents.push(d.requests[2].taskId),
    d=>d.acceptedArtifacts=4,
    d=>d.asOfUtc=new Date(d.requests[0].startMs).toISOString()
  ]){const d=laterFixture();edit(d);assert.throws(()=>summarizePostrender(d,json));}
  assert.throws(()=>summarizePostrender(null,json));
});

test('the published sixteen postrender receipts conserve tokens and follow completed task handoffs',()=>{
  const ledger=JSON.parse(readFileSync(new URL('../public/capture17/postrender-work.json',import.meta.url),'utf8'));
  const batch=summarizePostrender(ledger,json);
  assert.deepEqual(batch.accounts.map(a=>[a.credentialId,a.count,a.outputTokens]),[
    [1,3,5472],[2,3,3960],[3,3,3836],[4,3,5575],[5,4,9520]
  ]);
  assert.equal(batch.output,28363);
  assert.equal(batch.repeated,5);
  assert.equal(batch.accepted,16);
  assert.equal(new Set(batch.rows.map(r=>r.taskId)).size,16);
  const stages=new Map();
  const parents=new Map(json.requests.map(r=>[r.task,r.upstreamAttemptEndMs]));
  for(const row of batch.rows){
    assert.deepEqual(Object.keys(row).sort(),['credentialId','endMs','outputTokens','parents','requestId','role','stage','startMs','statusCode','taskId']);
    assert.ok(row.parents.length>0);
    for(const id of row.parents) assert.ok(parents.has(id)&&parents.get(id)<=row.startMs,'unresolved prior delivery '+id);
    parents.set(row.taskId,row.endMs);
    const stage=stages.get(row.stage)??{requests:0,tokens:0};
    stage.requests++;
    stage.tokens+=row.outputTokens;
    stages.set(row.stage,stage);
  }
  assert.deepEqual(Object.fromEntries(stages),{
    '成品分析':{requests:5,tokens:20174},'交叉审查':{requests:1,tokens:5663},
    '编写首批规则':{requests:5,tokens:1151},'实拍误差工具':{requests:5,tokens:1375}
  });
});

test('the workflow wall clock includes inactivity and merges simultaneous calls on one credential',()=>{
  const fixture=laterFixture();
  const [x,y,z]=fixture.requests; x.startMs=y.startMs=z.startMs-2000;
  x.endMs=y.endMs=x.startMs+1100;
  // Same credential overlaps during the middle section.
  z.startMs=x.startMs+500;z.endMs=x.endMs+1000;
  const t=summarizePostrender(fixture,json).timing;
  assert.deepEqual(t,{elapsedMs:2100,accountMs:3200,quietMs:0,allFiveMs:0});
});
