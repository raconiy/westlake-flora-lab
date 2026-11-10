import {createCoordinator} from '../local/coordinator.mjs';

const app=createCoordinator({host:'127.0.0.1',allowedOrigins:[],root:'/opt/westlake-swarm/research',dbPath:'/var/lib/westlake-research-coordinator/sessions.sqlite',
  modelBackend:'research-only',runCodex:async()=>{throw Error('Shell and chat execution are disabled on the research coordinator');}});
app.server.listen(8788,'127.0.0.1',()=>console.log('Authenticated research coordinator listening on loopback'));
