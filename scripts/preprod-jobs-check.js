const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2];
if (!mode) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|temp|tmp)$/i.test(k)));
  let failures=0;
  for (const name of ['late-batch','lease-ownership','upsert-owned','job-health']) {
    const r=spawnSync(process.execPath,[__filename,name],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:15000});
    const ok=r.status===0&&(r.stdout||'').includes('CASE_PASS:');
    console.log(`${ok?'ok':'FAIL'} ${name}: ${(r.stdout||r.stderr||r.error?.message||'no completion').trim().slice(0,1400)}`);
    if(!ok)failures++;
  }
  const mutant=spawnSync(process.execPath,[__filename,'lease-ownership','--mutate-owner'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:15000});
  const caught=mutant.status===1&&(mutant.stdout||'').includes('MUTATION_APPLIED')&&(mutant.stderr||'').includes('stale owner cannot finalize');
  console.log(`${caught?'ok':'FAIL'} counterproof: removing ownership must fail the real finalization assertion`);
  if(!caught)failures++;
  process.exitCode=failures?1:0;
} else {
  if (process.argv.includes('--mutate-owner')) {
    const compile=Module.prototype._compile;
    Module.prototype._compile=function(source,file){
      if(path.resolve(file)===path.join(root,'lib/database.js')) {
        const guard="and ($7::timestamptz is null or (status = 'processing' and locked_at = $7::timestamptz))";
        assert.equal(source.split(guard).length,2,'unique ownership guard');
        source=source.replace(guard,'');console.log('MUTATION_APPLIED');
      }
      return compile.call(this,source,file);
    };
  }
  process.env.DATABASE_URL='postgres://offline.invalid/probe';process.env.DATABASE_SSL='disable';process.env.CRON_SECRET='offline';
  require('node:net').Socket.prototype.connect=function(){throw new Error('NETWORK_FORBIDDEN');};
  for(const name of ['node:http','node:https'])require(name).request=require(name).get=()=>{throw new Error('NETWORK_FORBIDDEN');};
  globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN');};
  const mock=(file,exports)=>{const id=require.resolve(path.join(root,file));require.cache[id]={id,filename:id,loaded:true,exports};};
  const response=()=>({statusCode:200,setHeader(){},end(body){this.body=body?JSON.parse(body):null;}});
  async function run(){
    if(mode==='job-health'){
      const finished=[],audits=[],updates=[];
      const jobs=[{id:1,claimToken:'2026-09-12T00:00:00.000Z',jobType:'dispatch_communications',attempts:4,maxAttempts:5,payload:{reservation:{centerId:'offline'}}}];
      mock('lib/database.js',{getPool:()=>({query:async()=>({rows:[]})}),createWorkerRun:async()=>({id:1}),finishWorkerRun:async(id,p)=>{finished.push(p);return p;},listDueOpsJobs:async()=>jobs.splice(0,1),renewOpsJobLease:async()=>true,updateOpsJobStatus:async(id,p)=>{updates.push(p);return {id,...p};},appendOpsJobStep:async()=>true});
      mock('lib/ops-knowledge.js',{loadOpsKnowledge:()=>({centers:[]}),refreshCenterOverrides:async()=>true});
      mock('lib/catalog-store.js',{refreshCatalog:async()=>true});mock('lib/orchestrator-runner.js',{});mock('lib/marketing-agents.js',{});mock('lib/center-metrics.js',{});
      mock('lib/ops-communications.js',{dispatchDueCommunications:async()=>{throw new Error('OFFLINE_PROVIDER_FAILURE');}});
      mock('lib/audit-log.js',{newRequestId:()=>'offline',writeAuditLog:async x=>audits.push(x)});
      const handler=require('../api/cron');const res=response();
      await handler({method:'GET',url:'/api/cron?action=ops-jobs',headers:{host:'offline.invalid',authorization:'Bearer offline'}},res);
      assert.equal(updates[0].status,'failed');assert.equal(res.statusCode,503);assert.equal(res.body.ok,false);assert.equal(res.body.failed,1);assert.equal(finished[0].status,'failed');assert.equal(audits[0].outcome,'error');
      const control=response();await handler({method:'GET',url:'/api/cron?action=ops-jobs',headers:{host:'offline.invalid',authorization:'Bearer offline'}},control);
      assert.equal(control.statusCode,200);assert.equal(control.body.checked,0);assert.equal(control.body.ok,true);
      return;
    }
    let now=Date.parse('2026-09-12T00:00:00Z');const records=Array.from({length:mode==='lease-ownership'?1:25},(_,i)=>({id:i+1,center_id:'offline-'+(i+1),job_type:'marketing_plan',status:'queued',run_at:new Date(0).toISOString(),locked_at:null,updated_at:null,attempts:0,max_attempts:5,payload:{}}));
    const clones=rows=>({rowCount:rows.length,rows:rows.map(r=>({...r,claim_token:r.locked_at}))});
    async function query(q,p=[]){
      if (q && typeof q === 'object') { p=q.values || [];q=q.text; }
      if (/insert into ops_jobs/.test(q)) {
        const r=records[0];
        if (/where ops_jobs.status <> 'processing'/.test(q) && r.status==='processing') return clones([]);
        r.status='queued';r.locked_at=null;r.payload=JSON.parse(p[8]);return clones([r]);
      }
      if (/select \* from ops_jobs where idempotency_key/.test(q)) return clones([records[0]]);
      if(/with due as/.test(q)){
        const heartbeatAware=/greatest\(\s*(?:job\.)?locked_at\s*,\s*(?:job\.)?updated_at\s*\)/i.test(q);
        const due=records.filter(r=>(r.status==='queued'||(r.status==='processing'&&Math.max(Date.parse(r.locked_at),heartbeatAware?Date.parse(r.updated_at):0)<now-p[1]*60000))&&r.attempts<r.max_attempts).slice(0,p[0]);
        for(const r of due){r.status='processing';r.locked_at=new Date(now).toISOString();r.updated_at=r.locked_at;}
        return clones(due);
      }
      if(/update ops_jobs/.test(q)){
        const r=records.find(x=>x.id===p[0]);if(!r)return clones([]);
        if(/set updated_at = now\(\)/.test(q)){
          if(r.status!=='processing'||r.locked_at!==p[1])return clones([]);
          r.updated_at=new Date(now).toISOString();return clones([r]);
        }
        const token=p[6];
        if(token&&/locked_at\s*=\s*\$7/.test(q)&&(r.status!=='processing'||r.locked_at!==token))return clones([]);
        r.status=p[1];r.attempts+=p[2];r.locked_at=null;r.updated_at=new Date(now).toISOString();return clones([r]);
      }
      assert(/^(BEGIN|COMMIT|ROLLBACK)$/i.test(q));return clones([]);
    }
    class FakePool{on(){}async connect(){return{query,release(){}};}async query(...args){return query(...args);}}
    const pg=require.resolve('pg');require.cache[pg]={id:pg,filename:pg,loaded:true,exports:{Pool:FakePool}};
    const db=require('../lib/database');
    if(mode==='upsert-owned') {
      records[0].status='processing';records[0].locked_at=new Date(now).toISOString();records[0].payload={revision:'original'};
      const same=await db.createOpsJob({centerId:'offline-1',jobType:'marketing_plan',idempotencyKey:'same-job',payload:{revision:'retry'}});
      assert.equal(same.status,'processing','duplicate enqueue cannot take ownership from running job');
      assert.equal(records[0].locked_at,new Date(now).toISOString());assert.equal(records[0].payload.revision,'original');
      return;
    }
    if(mode==='lease-ownership'){
      const [old]=await db.listDueOpsJobs({limit:1});assert(old.claimToken,'exact database claim token returned');
      now+=11*60000;const [fresh]=await db.listDueOpsJobs({limit:1});assert(fresh);assert.notEqual(old.claimToken,fresh.claimToken);
      assert.equal(await db.updateOpsJobStatus(old.id,{status:'done',claimToken:old.claimToken}),null,'stale owner cannot finalize');
      assert.equal(await db.renewOpsJobLease(old.id,old.claimToken),false,'stale owner cannot renew');
      now+=9*60000;assert.equal(await db.renewOpsJobLease(fresh.id,fresh.claimToken),true);
      now+=2*60000;assert.equal((await db.listDueOpsJobs({limit:1})).length,0,'heartbeat protects a live long job');
      records[0].status='cancelled';assert.equal(await db.updateOpsJobStatus(fresh.id,{status:'done',claimToken:fresh.claimToken}),null,'cancelled job cannot become done');
      return;
    }
    const counters={},pending=[];
    mock('lib/ops-communications.js',{});
    mock('lib/marketing-strategist.js',{generateMarketingPlan:async id=>{counters[id]=(counters[id]||0)+1;if(id==='offline-21')await new Promise(r=>pending.push(r));now+=31000;return{plan:{mode:'offline',weeks:[],context:{semainesRejetees:0}},saved:{id:Number(id.split('-')[1])}};}});
    const jobs=require('../lib/ops-jobs');const a=jobs.processDueOpsJobs({limit:25});await new Promise(r=>setImmediate(r));assert.equal(pending.length,1);
    const b=jobs.processDueOpsJobs({limit:25});await new Promise(r=>setImmediate(r));pending.forEach(r=>r());await Promise.all([a,b]);
    assert.equal(Object.keys(counters).length,25);assert(Object.values(counters).every(n=>n===1),'slow batch must execute every job once');
    assert(records.every(r=>r.status==='done'));console.log('25 jobs, 31 seconds virtual each, 2 dispatchers, no duplicate execution');
  }
  run().then(()=>console.log(`CASE_PASS:${mode}`)).catch(e=>{console.error(e.stack);process.exit(1);});
}
