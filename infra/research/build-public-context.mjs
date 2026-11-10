// Build the deployment input from a clean, reviewed Git checkout. This utility
// is not imported by the inference helper or the workers.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const requested=process.argv[3]||'HEAD';
if(requested!=='HEAD'&&!/^[a-f0-9]{40}$/.test(requested))throw Error('Supply a full public commit SHA');
const revision=git('rev-parse',requested+'^{commit}').trim();
const provenance='https://github.com/raconiy/westlake-flora-lab/blob/'+revision+'/';
const published=path=>({source:provenance+path,text:git('show',revision+':'+path)});
const speciesFile='public/references/species-evidence.json';
const evidence=JSON.parse(published(speciesFile).text);
const species={source:provenance+speciesFile,scope:evidence.scope,physicalModel:evidence.physicalModel,species:evidence.species};
const campus=published('app/CampusScene.tsx');
const manual=published('public/five-role-agent-swarm.md');
const consumer={source:provenance+'infra/remote/community-consumer.mjs',note:'Sites community queue receives the server heartbeats, polls /relay/claim, requires a fenced completion. The public release distinguishes a Site chat reply from a reviewed code merge.'};
const contexts={botany:species,physics:{speciesEvidence:species,placementSource:campus},scene:{campus,scope:species.scope},infra:{publicManual:manual,consumer},qa:{speciesEvidence:species,campus,consumer}};
if(!process.argv[2])throw Error('Supply a deployment output file');
await writeFile(process.argv[2],JSON.stringify(contexts,null,1)+'\n',{mode:0o644,flag:'wx'});
