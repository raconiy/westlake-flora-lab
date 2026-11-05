import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,appendFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {runProcess} from '../codex.mjs';
import {parsePorcelainZ,changedTestsPlan,assertSafeTestPaths} from '../validation-scope.mjs';

async function fixture(t,files={}){
  const root=mkdtempSync(resolve(tmpdir(),'flora-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=async(...args)=>{const r=await runProcess('git',['-C',root,...args],{timeoutMs:10000});assert.equal(r.code,0,r.stderr);return r;};
  const put=(path,text='// fixture\n')=>{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),text);};
  await git('init');put('README.md','fixture\n');for(const [path,text]of Object.entries(files))put(path,text);
  await git('add','.');await git('-c','user.name=Scope fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');
  return{root,git,put,plan:()=>changedTestsPlan(root,{run:runProcess})};
}

test('porcelain -z parser preserves literal paths and consumes rename/copy source records',()=>{
  assert.deepEqual(parsePorcelainZ(' M space and\nline.test.mjs\0R  renamed.test.mjs\0old name.test.mjs\0 C copy.test.mjs\0source.test.mjs\0?? new.test.mjs\0'),[
    {status:' M',path:'space and\nline.test.mjs'},
    {status:'R ',path:'renamed.test.mjs',originalPath:'old name.test.mjs'},
    {status:' C',path:'copy.test.mjs',originalPath:'source.test.mjs'},
    {status:'??',path:'new.test.mjs'},
  ]);
  assert.deepEqual(parsePorcelainZ(''),[]);
  for(const raw of [' M truncated.test.mjs','R  new.test.mjs\0','zz invalid\0',' M \0'])assert.throws(()=>parsePorcelainZ(raw),/Validation/);
});

test('real Git selects staged, unstaged, new and literal filename tests; deletion is explicit',async t=>{
  const f=await fixture(t,{'staged.test.mjs':'// initial\n','unstaged.test.mjs':'// initial\n','gone.test.mjs':'// initial\n','cached-gone.test.mjs':'// initial\n','feature.ts':'// initial\n','feature.test.mjs':'// related\n','test/feature.test.mjs':'// related subdir\n'});
  f.put('staged.test.mjs','// staged\n');await f.git('add','staged.test.mjs');appendFileSync(resolve(f.root,'staged.test.mjs'),'// unstaged too\n');
  f.put('unstaged.test.mjs','// modified\n');f.put('new.test.mjs');f.put('odd space\n$(literal).test.mjs');f.put('added.test.mjs');await f.git('add','added.test.mjs');
  f.put('feature.ts','// modified\n');rmSync(resolve(f.root,'gone.test.mjs'));await f.git('rm','cached-gone.test.mjs');
  const plan=await f.plan();
  assert.deepEqual(plan.selectedTests,['added.test.mjs','feature.test.mjs','new.test.mjs','odd space\n$(literal).test.mjs','staged.test.mjs','test/feature.test.mjs','unstaged.test.mjs']);
  assert.deepEqual(plan.deletedTests,['cached-gone.test.mjs','gone.test.mjs']);
  assert.deepEqual(plan.selectionReasons['feature.test.mjs'],['sibling-of:feature.ts']);
  assert.equal(plan.scope,'changed-tests');assert.equal(plan.fullSuiteValidated,false);assert.equal(plan.releaseApproved,false);
  assert.deepEqual(plan.commands.at(-1),[process.execPath,'--test','--test-concurrency=1','--',...plan.selectedTests.map(p=>`./${p}`)]);
  assert.deepEqual((await f.plan()).selectedTests,plan.selectedTests);
});

test('real Git staged rename selects destination and records missing old test',async t=>{
  const f=await fixture(t,{'old name.test.mjs':'// fixture\n'});
  await f.git('mv','old name.test.mjs','new\nname.test.mjs');
  const plan=await f.plan();assert.deepEqual(plan.selectedTests,['new\nname.test.mjs']);assert.deepEqual(plan.deletedTests,['old name.test.mjs']);
});

test('real Git source rename selects tests for both old and new code names',async t=>{
  const f=await fixture(t,{'old.mjs':'// same source\n','old.test.mjs':'// old related\n','new.test.mjs':'// new related\n'});
  await f.git('mv','old.mjs','new.mjs');const plan=await f.plan();
  assert.deepEqual(plan.changedPaths,['new.mjs','old.mjs']);assert.deepEqual(plan.selectedTests,['new.test.mjs','old.test.mjs']);
});

test('real Git staged deletion followed by untracked recreation never skips the present test',async t=>{
  const f=await fixture(t,{'restored.test.mjs':'// fixture\n'});
  await f.git('rm','restored.test.mjs');f.put('restored.test.mjs','// recreated\n');
  const plan=await f.plan();assert.deepEqual(plan.selectedTests,['restored.test.mjs']);assert.deepEqual(plan.deletedTests,[]);
});

test('real Git no tests, unsupported code coverage and deleted-only tests are reported honestly',async t=>{
  const f=await fixture(t,{'gone.test.mjs':'// fixture\n','orphan.ts':'// fixture\n'});
  f.put('README.md','changed\n');f.put('orphan.ts','// changed\n');rmSync(resolve(f.root,'gone.test.mjs'));
  const plan=await f.plan();assert.equal(plan.noTestsSelected,true);assert.deepEqual(plan.selectedTests,[]);
  assert.deepEqual(plan.deletedTests,['gone.test.mjs']);assert.deepEqual(plan.codeWithoutRelatedTests,['orphan.ts']);
  assert.equal(plan.commands.length,3);assert.ok(plan.commands[0].includes('--noEmit'));
  assert.deepEqual(plan.commands.slice(1).map(c=>c.slice(-2)),[['diff','--check'],['--cached','--check']]);
  assert.ok(plan.coverageLimits.some(v=>v.includes('typecheck')));
});

test('real Git deleted source still selects an existing exact sibling test',async t=>{
  const f=await fixture(t,{'feature.mjs':'// fixture\n','feature.test.mjs':'// fixture\n'});rmSync(resolve(f.root,'feature.mjs'));
  assert.deepEqual((await f.plan()).selectedTests,['feature.test.mjs']);
});

test('real Git selection limit rejects the entire selection instead of truncating',async t=>{
  const f=await fixture(t);for(let i=0;i<25;i++)f.put(`new-${i}.test.mjs`);
  await assert.rejects(f.plan(),/25 selected tests exceed.*24/);
});

test('real Git changed tests with unexpected extensions fail selection explicitly',async t=>{
  const f=await fixture(t);f.put('unsupported.test.js');
  await assert.rejects(f.plan(),/unexpected test extension/);
});

test('real Git test filenames with Node glob syntax fail rather than expand the selected scope',async t=>{
  const f=await fixture(t);f.put('bracket[1].test.mjs');
  await assert.rejects(f.plan(),/Node glob metacharacters rejected/);
  for(const path of ['star*.test.mjs','question?.test.mjs','{a,b}.test.mjs','+(name).test.mjs','@(name).test.mjs','!(name).test.mjs']){
    f.put(path);assert.throws(()=>assertSafeTestPaths(f.root,[path]),/glob metacharacters/);
  }
});

test('real Git symlink tests and code are rejected, including internal links',async t=>{
  const f=await fixture(t,{'target.mjs':'// fixture\n'});
  symlinkSync(resolve(f.root,'target.mjs'),resolve(f.root,'alias.test.mjs'));
  await assert.rejects(f.plan(),/symlink path rejected/);
  rmSync(resolve(f.root,'alias.test.mjs'));symlinkSync(resolve(f.root,'target.mjs'),resolve(f.root,'alias.mjs'));
  await assert.rejects(f.plan(),/symlink path rejected/);
});

test('test path boundary rejects traversal, external/internal symlink ancestors and unexpected extensions',async t=>{
  const f=await fixture(t,{'safe.test.mjs':'// fixture\n','nested/safe.test.mjs':'// fixture\n'});
  const outside=mkdtempSync(resolve(tmpdir(),'flora-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  writeFileSync(resolve(outside,'outside.test.mjs'),'// outside\n');
  symlinkSync(outside,resolve(f.root,'external'));symlinkSync(resolve(f.root,'nested'),resolve(f.root,'internal'));
  for(const path of ['../outside.test.mjs','nested/../../outside.test.mjs','/outside.test.mjs','C:/outside.test.mjs','nested\\safe.test.mjs','nested/./safe.test.mjs','nested//safe.test.mjs','safe.test.js','safe.test.mjs/extra','safe.test.mjs\0','node_modules/x.test.mjs'])assert.throws(()=>assertSafeTestPaths(f.root,[path]),/Validation/);
  for(const path of ['external/outside.test.mjs','internal/safe.test.mjs'])assert.throws(()=>assertSafeTestPaths(f.root,[path]),/symlink/);
  // Genuine Git cannot emit traversal records. Feed one at the parser boundary
  // against a real repository to verify containment independently of Git.
  await assert.rejects(changedTestsPlan(f.root,{run:async()=>({code:0,stdout:'?? ../outside.test.mjs\0',stderr:''})}),/unsafe path/);
  assertSafeTestPaths(f.root,['safe.test.mjs','nested/safe.test.mjs']);
});

test('Git status failures and partial output cannot become an empty passing selection',async t=>{
  const f=await fixture(t);
  for(const failure of [{code:1},{code:0,timedOut:true},{code:0,overflow:true},{code:0,aborted:true}])await assert.rejects(changedTestsPlan(f.root,{run:async()=>({...failure,stdout:'?? partial.test.mjs',stderr:'original status failure'})}),/Git status failed.*original status failure/);
});
