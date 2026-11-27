import {readFile,writeFile,stat} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {openPostgres} from '../database.mjs';
import {importPrepared} from './import-prepared.mjs';
const {values:a}=parseArgs({options:Object.fromEntries(['config','prepared','report'].map(k=>[k,{type:'string'}]))});
for(const k of ['config','prepared','report'])assert(a[k],'MISSING_'+k);
assert.equal((await stat(a.config)).mode&0o077,0,'PRIVATE_CONFIG_REQUIRED');
const config=JSON.parse(await readFile(a.config,'utf8'));assert(/^[a-z][a-z0-9_]*_trial$/.test(config.database),'TRIAL_ONLY');
let db;
try{
 db=await openPostgres(config);
 if(!(await db.query("SELECT 1 FROM pg_namespace WHERE nspname='webavr'")).rows.length)
  for(const name of ['webavr-schema-v1.sql','webavr-schema-v1.1-trial-adjustments.sql','webavr-schema-v1.2-api.sql'])await db.exec(await readFile(new URL('../schema/'+name,import.meta.url),'utf8'));
 const existing=Number((await db.query('SELECT count(*) AS n FROM migration_private.runs')).rows[0].n);
 let rolledBack=null;
 if(!existing){try{await importPrepared(db,a.prepared,{probeFailure:true});throw Error('PROBE_DID_NOT_FAIL');}catch(e){assert.equal(e.code,'ROLLBACK_PROBE');}
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM webavr.users')).rows[0].n),0);assert.equal(Number((await db.query('SELECT count(*) AS n FROM migration_private.runs')).rows[0].n),0);rolledBack=true;}
 const imported=await importPrepared(db,a.prepared),repeat=await importPrepared(db,a.prepared);assert(repeat.skipped);
 const counts={};for(const table of ['auth_private.credentials','auth_private.sessions','webavr.user_roles','webavr.class_memberships'])counts[table]=Number((await db.query('SELECT count(*) AS n FROM '+table)).rows[0].n);
 assert(Object.values(counts).every(n=>n===0),'UNEXPECTED_ACCESS_GRANTED');
 const result={engine:(await db.query('SELECT version() AS version')).rows[0].version,rollbackProbe:rolledBack,imported,repeatSkipped:repeat.skipped,identityAndPermissionsCounts:counts,productionCutover:false};
 await writeFile(a.report,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({passed:true,reportWritten:true}));
}catch(e){console.error(JSON.stringify({passed:false,code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'IMPORT_VALIDATION_FAILED',reason:e.message?.match(/^[A-Z][A-Z_]+(?=\n|$)/)?.[0]??'VALIDATION_FAILED'}));process.exitCode=1;}
finally{await db?.close();}
