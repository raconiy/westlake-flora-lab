import {createHash,randomUUID} from 'node:crypto';
import {constants,closeSync,fchmodSync,fstatSync,fsyncSync,linkSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const owned=stat=>!process.getuid||stat.uid===process.getuid();
const assertPrivatePath=path=>{
  if(path.split(sep).some(part=>part==='public'||part==='dist'))fail('FULL_OUTPUT_UNSAFE_DIRECTORY','Full output cannot be stored under public or dist');
};

// Controller-owned persistence, after the model returns. Never grant the agent
// extra sandbox access. A complete private temporary file is linked atomically
// into its deterministic name; link cannot replace any existing task artifact.
export function retainFullOutput(taskId,text,{root,stateDir,resultDir}={}){
  const receipt={retained:false};
  let temporary=null,fd=null;
  try{
    if(typeof taskId!=='string'||!taskId.length)fail('FULL_OUTPUT_INVALID_TASK_ID','Task ID must be a nonempty string');
    if(Buffer.from(taskId,'utf8').toString('utf8')!==taskId)fail('FULL_OUTPUT_INVALID_TASK_ID','Task ID must be valid Unicode');
    if(typeof text!=='string')fail('FULL_OUTPUT_INVALID_TEXT','Model output must be a string');
    const bytes=Buffer.from(text,'utf8');
    if(bytes.toString('utf8')!==text)fail('FULL_OUTPUT_INVALID_TEXT','Model output cannot be preserved exactly as UTF-8');
    Object.assign(receipt,{sha256:createHash('sha256').update(bytes).digest('hex'),utf8Bytes:bytes.length,charCount:text.length,charCountUnit:'UTF-16 code units',encoding:'utf8'});
    let directory=resolve(resultDir||resolve(stateDir||resolve(root,'.runtime'),'task-results'));
    assertPrivatePath(directory);
    const basename=`task-${createHash('sha256').update(taskId,'utf8').digest('hex')}.txt`;
    receipt.path=resolve(directory,basename);
    mkdirSync(directory,{recursive:true,mode:0o700});
    const directoryStat=lstatSync(directory);
    if(!directoryStat.isDirectory()||!owned(directoryStat)||(directoryStat.mode&0o777)!==0o700)fail('FULL_OUTPUT_UNSAFE_DIRECTORY','Full output directory must be owned, nonsymlink, and mode 0700');
    directory=realpathSync(directory);assertPrivatePath(directory);
    receipt.path=resolve(directory,basename);
    temporary=resolve(directory,`.${basename}.${randomUUID()}.tmp`);
    fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    fchmodSync(fd,0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=null;
    let reused=false;
    try{linkSync(temporary,receipt.path);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      fd=openSync(receipt.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      const stat=fstatSync(fd);
      if(!stat.isFile()||!owned(stat)||(stat.mode&0o777)!==0o600)fail('FULL_OUTPUT_UNSAFE_FILE','Existing full output must be an owned regular file with mode 0600');
      if(!readFileSync(fd).equals(bytes))fail('FULL_OUTPUT_CONFLICT','Task already has different full output; original artifact preserved');
      closeSync(fd);fd=null;reused=true;
    }
    unlinkSync(temporary);temporary=null;
    fd=openSync(directory,constants.O_RDONLY);fsyncSync(fd);closeSync(fd);fd=null;
    return{...receipt,retained:true,reused};
  }catch(error){return{...receipt,errorCode:error.code||'FULL_OUTPUT_IO_ERROR',error:error.message};}
  finally{
    if(fd!==null)try{closeSync(fd);}catch{}
    if(temporary!==null)try{unlinkSync(temporary);}catch{}
  }
}
