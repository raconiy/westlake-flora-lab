import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privatePromptLedger} from './prompt-ledger.mjs';

test('keeps exact request bytes and distinct records for failed and interrupted attempts of one task', async t => {
  const dir=await mkdtemp(join(tmpdir(),'flora-ledger-'));
  t.after(()=>rm(dir,{force:true,recursive:true}));
  const wire='{"input":"校验\\nA","reasoning":{"effort":"high"}}';
  const task={id:'test',role:'scene',title:'Check the measured edge',priorDeliveries:[{id:'source'}]};
  const archive=privatePromptLedger(dir);
  const writeResult=await archive(task,wire);
  await archive(task,wire);
  const attempt=await writeResult({state:'upstream_http_error',httpStatus:503});
  const paths=await readdir(dir);
  assert.equal(paths.filter(p=>p.endsWith('.request.json')).length,2);
  assert.equal(paths.filter(p=>p.endsWith('.result.json')).length,1);
  const path=join(dir,attempt+'.request.json');
  const saved=JSON.parse(await readFile(path,'utf8'));
  assert.equal(saved.wireBody,wire);
  assert.equal(saved.bodySha256,createHash('sha256').update(wire).digest('hex'));
  assert.deepEqual(saved.parents,['source']);
  assert.equal((await stat(path)).mode & 0o777,0o600);
  assert.equal(JSON.parse(await readFile(join(dir,attempt+'.result.json'),'utf8')).httpStatus,503);
});
