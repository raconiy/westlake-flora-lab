import {lstatSync,realpathSync} from 'node:fs';
import {extname,posix,resolve} from 'node:path';

const MAX_TESTS=24;
const CODE_EXTENSIONS=new Set(['.mjs','.cjs','.js','.jsx','.ts','.tsx']);
const DATA_ARCHIVE_EXTENSIONS=new Set(['.txt','.md','.json','.log','.patch']);

// Porcelain v1 -z has literal paths (including spaces/newlines). Rename/copy
// records put the destination first, then a separate NUL-terminated source.
export function parsePorcelainZ(output){
  if(typeof output!=='string'||(output&&!output.endsWith('\0')))throw new Error('Validation: truncated Git status');
  const fields=output.split('\0');fields.pop();const entries=[];
  for(let i=0;i<fields.length;i++){
    const field=fields[i],status=field.slice(0,2);
    if(field[2]!==' '||field.length<4||!(/^[ MADRCUT?!]{2}$/.test(status))||status==='  ')throw new Error('Validation: malformed Git status');
    const entry={status,path:field.slice(3)};
    if(/[RC]/.test(status)){
      if(!fields[++i])throw new Error('Validation: missing Git rename source');
      entry.originalPath=fields[i];
    }
    entries.push(entry);
  }
  return entries;
}

function checkRelativePath(path){
  // Backslashes/drive prefixes are rejected even on Unix, so selection has the
  // same containment rules on every host. Spaces and newlines remain literal.
  if(typeof path!=='string'||!path||path.includes('\0')||path.includes('\\')||/^[A-Za-z]:/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'||p==='node_modules'))throw new Error(`Validation: unsafe path ${JSON.stringify(path)}`);
}

function inspectPath(root,path){
  checkRelativePath(path);
  let current=root,stat;
  const parts=path.split('/');
  for(let i=0;i<parts.length;i++){
    current=resolve(current,parts[i]);
    try{stat=lstatSync(current);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(stat.isSymbolicLink())throw new Error(`Validation: symlink path rejected ${JSON.stringify(path)}`);
    if(i<parts.length-1&&!stat.isDirectory())throw new Error(`Validation: non-directory ancestor ${JSON.stringify(path)}`);
  }
  return stat;
}

export function assertSafeTestPaths(worktree,paths){
  const root=realpathSync(worktree);
  for(const path of paths){
    checkRelativePath(path);
    if(!path.endsWith('.test.mjs'))throw new Error(`Validation: unexpected test extension ${JSON.stringify(path)}`);
    // Node's test CLI expands globs even when shell:false and even if the
    // literal file exists. Reject patterns rather than execute unselected files.
    if(/[*?\[\]{}]|[+@!]\(/.test(path))throw new Error(`Validation: Node glob metacharacters rejected ${JSON.stringify(path)}`);
    if(!inspectPath(root,path)?.isFile())throw new Error(`Validation: test is not a regular file ${JSON.stringify(path)}`);
  }
}

export async function changedTestsPlan(worktree,{run,signal,timeoutMs=10000}={}){
  const root=realpathSync(worktree);
  const status=await run('git',['-C',root,'-c','core.fsmonitor=false','status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=none'],{timeoutMs,signal,maxBytes:500000});
  if(status.code!==0||status.timedOut||status.aborted||status.overflow)throw new Error(`Validation: Git status failed${status.timedOut?' (timed out)':''}${status.aborted?' (aborted)':''}: ${status.stderr||''}`);
  const entries=parsePorcelainZ(status.stdout),selected=new Map(),deletedTests=new Set(),codeWithoutRelatedTests=[];
  // Sorting uses code-unit order, independent of the machine's locale.
  const renamedSources=entries.filter(e=>e.status.includes('R')).map(e=>e.originalPath);
  const changedPaths=[...new Set([...entries.map(e=>e.path),...renamedSources])].sort();
  const deletedPaths=new Set([...entries.filter(e=>e.status.includes('D')).map(e=>e.path),...renamedSources]);
  for(const entry of entries){
    inspectPath(root,entry.path);
    if(entry.originalPath)inspectPath(root,entry.originalPath);
    if(entry.originalPath?.endsWith('.test.mjs')&&!inspectPath(root,entry.originalPath))deletedTests.add(entry.originalPath);
  }
  const add=(path,reason)=>{const reasons=selected.get(path)||new Set();reasons.add(reason);selected.set(path,reasons);};
  for(const path of changedPaths){
    const stat=inspectPath(root,path);
    if(path.endsWith('.test.mjs')){
      if(stat?.isFile())add(path,'changed-test');
      else if(!stat&&deletedPaths.has(path))deletedTests.add(path);
      else throw new Error(`Validation: changed test is not a regular file ${JSON.stringify(path)}`);
    }else if(/\.test\./.test(posix.basename(path))&&!DATA_ARCHIVE_EXTENSIONS.has(extname(path))){
      throw new Error(`Validation: unexpected test extension ${JSON.stringify(path)}`);
    }else if(CODE_EXTENSIONS.has(extname(path))){
      const stem=posix.basename(path,extname(path)),dir=posix.dirname(path);
      const candidates=[posix.join(dir,`${stem}.test.mjs`),posix.join(dir,'test',`${stem}.test.mjs`)];
      let found=false;
      for(const candidate of candidates){
        const test=inspectPath(root,candidate);
        if(test){
          if(!test.isFile())throw new Error(`Validation: related test is not a regular file ${JSON.stringify(candidate)}`);
          add(candidate,`sibling-of:${path}`);found=true;
        }
      }
      if(!found)codeWithoutRelatedTests.push(path);
    }
  }
  const selectedTests=[...selected.keys()].sort();
  // Never silently truncate a large selection: that could hide a failing test.
  if(selectedTests.length>MAX_TESTS)throw new Error(`Validation: ${selectedTests.length} selected tests exceed changed-tests bound ${MAX_TESTS}; use lead full validation`);
  assertSafeTestPaths(root,selectedTests);
  const commands=[
    [process.execPath,'node_modules/typescript/bin/tsc','--noEmit'],
    ['git','-C',root,'diff','--check'],
    ['git','-C',root,'diff','--cached','--check'],
    ...(selectedTests.length?[[process.execPath,'--test','--test-concurrency=1','--',...selectedTests.map(p=>`./${p}`)]]:[]),
  ];
  return{scope:'changed-tests',commands,changedPaths,selectedTests,deletedTests:[...deletedTests].sort(),
    selectionReasons:Object.fromEntries(selectedTests.map(p=>[p,[...selected.get(p)].sort()])),codeWithoutRelatedTests,
    noTestsSelected:selectedTests.length===0,maxTests:MAX_TESTS,
    selectionPolicy:'All changed/new .test.mjs files plus exact-stem siblings in the same directory or its test/ directory; never truncate.',
    coverageLimits:['Git working/index status only; committed changes and ignored untracked files are outside this scope.','Only .test.mjs is executable; unsupported test extensions and test paths with Node glob metacharacters are rejected. Final .txt/.md/.json/.log/.patch suffixes are non-executable evidence archives.','No import graph or broader regression inference; deleted tests are recorded, not executed.','No selected tests means typecheck and staged/unstaged diff checks only.','Worker readiness only; lead must run complete merged validation and CI before merge/publication.'],
    fullSuiteValidated:false,releaseApproved:false};
}
