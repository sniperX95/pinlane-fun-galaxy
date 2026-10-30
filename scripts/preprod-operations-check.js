// Isolated regression probes: real pg.Pool and handlers; no external I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const mode = process.argv[2];
if (!mode) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(path|systemroot|windir|comspec|temp|tmp)$/i.test(k)));
  let failures = 0;
  for (const name of ['idle', 'health-queue', 'health-query', 'health-ok', 'retention']) {
    const r = spawnSync(process.execPath, [__filename, name], {cwd:root,env,encoding:'utf8',windowsHide:true,timeout:12000});
    const passed = r.status === 0 && (r.stdout || '').includes(`CASE_PASS:${name}`);
    console.log(`${passed ? 'ok' : 'FAIL'} ${name}: ${(r.stdout || r.stderr || r.error?.message || 'no completion marker').trim().slice(0,900)}`);
    if (!passed) failures++;
  }
  process.exitCode = failures ? 1 : 0;
} else {
  process.env.DATABASE_URL = 'postgres://offline.invalid/probe';
  process.env.DATABASE_SSL = 'disable';
  require('node:net').Socket.prototype.connect = function () { throw new Error('NETWORK_FORBIDDEN'); };
  for (const name of ['node:http','node:https']) require(name).request = require(name).get = () => { throw new Error('NETWORK_FORBIDDEN'); };
  globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
  class OfflineClient extends EventEmitter {
    constructor() { super(); this._queryable = true; this._ending = false; }
    connect(cb) { process.nextTick(() => cb(null)); }
    query(text, args, cb) {
      if (typeof args === 'function') cb = args;
      if (mode === 'health-query') return;
      if (cb) process.nextTick(() => cb(null, { rows:[{value:1}], rowCount:1 }));
      else return Promise.resolve({rows:[{value:1}],rowCount:1});
    }
    end(cb) { this._ending = true; this.emit('end'); if (cb) process.nextTick(cb); }
  }
  const response = () => ({ statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;},end(body){this.body=body?JSON.parse(body):null;} });
  async function run() {
    if (mode === 'retention') {
      const file = path.join(root,'workers/ops-worker.js');
      const source = fs.readFileSync(file,'utf8');
      const queries=[];
      const localRequire = createRequire(file);
      const context={require:(id)=>id==='../lib/database'?{getPool:()=>({query:async(q)=>{queries.push(q);return {rowCount:1};}})}:id==='../lib/cron-tasks'?{setAuditRuntime(){}}:localRequire(id),process:{argv:[],env:{},on(){},exit(){}},console,setTimeout,clearTimeout,setInterval,clearInterval,module:{exports:{}}};
      vm.runInNewContext(source.replace(/main\(\)\.catch\([\s\S]*$/, '')+'\nmodule.exports = { pruneOpsLogs };', context, {filename:file});
      const result=await context.module.exports.pruneOpsLogs();
      assert(!queries.some(q=>/ops_agent_suggestions|audit_log|reservations|ops_jobs/.test(q)), 'business decisions must not be deleted as logs');
      assert(queries.some(q=>/ops_worker_runs/.test(q)), 'log retention still runs');
      assert.equal(result.deleted, queries.length);
      console.log('active and rejected suggestions preserved; operational logs still pruned');
      return;
    }
    const db = require('../lib/database');
    const pool=db.getPool();
    pool.Client=OfflineClient;
    if (mode === 'idle') {
      assert(pool.listenerCount('error')>0, 'application must handle idle errors');
      const lines=[]; const old=console.error; console.error=(...args)=>lines.push(args.join(' '));
      try {
        const c=await pool.connect();c.release();
        const e=new Error('SYNTHETIC_PRIVATE_CONNECTION_DATA');e.code='ECONNRESET';c.emit('error',e);
        assert.equal(pool.totalCount,0);
        assert.equal(lines.length,1,'one observable error');
        assert(!lines.join(' ').includes('SYNTHETIC_PRIVATE_CONNECTION_DATA'),'no raw connection message');
        const control=await pool.connect();control.release();assert.equal(pool.totalCount,1,'subsequent work recovers');
      } finally { console.error=old;await pool.end(); }
      console.log('idle disconnect observed once, sanitized, connection removed and next request succeeds');
      return;
    }
    const handler=require('../api/public-booking-meta');
    const held=[];
    if (mode === 'health-queue') for(let i=0;i<pool.options.max;i++) held.push(await pool.connect());
    const started=Date.now();
    try {
      const responses=await Promise.all(Array.from({length:mode==='health-queue'?6:1},async()=>{
        const res=response();await handler({method:'GET',url:'/api/healthz',headers:{host:'offline.invalid','x-forwarded-for':'192.0.2.5'}},res);return res;
      }));
      const expected=mode==='health-ok'?200:503;
      assert(responses.every(r=>r.statusCode===expected));
      assert.equal(pool.waitingCount,0,'no acquisitions abandoned after HTTP response');
      if (mode==='health-query') assert.equal(pool.totalCount,0,'timed-out connection destroyed, not returned busy');
      assert(Date.now()-started<4500,'health response remains bounded');
      console.log(JSON.stringify({http:expected,waiting:pool.waitingCount,elapsedMs:Date.now()-started,connections:pool.totalCount}));
    } finally {held.forEach(c=>c.release());await pool.end();}
  }
  run().then(()=>console.log(`CASE_PASS:${mode}`)).catch(e=>{console.error(e.stack);process.exit(1);});
}
