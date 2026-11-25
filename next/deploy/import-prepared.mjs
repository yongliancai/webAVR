import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const ORDER=['webavr.users','webavr.assets','webavr.courses','webavr.maps','webavr.tours','webavr.scenes','webavr.map_markers','webavr.course_maps','webavr.marker_tours','webavr.hotspots','webavr.scene_links','webavr.activities','webavr.activity_versions','auth_private.question_keys','webavr.activity_assets','migration_private.source_records','migration_private.identity_map','migration_private.archives','migration_private.issues'];
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
export async function importPrepared(db,directory,{probeFailure=false}={}){
 const root=resolve(directory);assert(!(await stat(join(root,'INCOMPLETE')).catch(e=>{if(e.code==='ENOENT')return null;throw e;})),'INCOMPLETE');
 const bytes=await readFile(join(root,'manifest.json')),manifest=JSON.parse(bytes);
 assert(/^[a-f0-9-]{36}$/i.test(manifest.run_id)&&/^[a-f0-9]{64}$/i.test(manifest.source_sha256),'INVALID_MANIFEST');
 assert(Array.isArray(manifest.tables));const entries=new Map();
 for(const t of manifest.tables){
  assert(ORDER.includes(t.table)&&!entries.has(t.table),'UNKNOWN_OR_DUPLICATE_TABLE');
  assert(t.file===t.table.replace('.','__')+'.jsonl'&&Array.isArray(t.columns)&&t.columns.length>0&&new Set(t.columns).size===t.columns.length&&t.columns.every(c=>/^[a-z_][a-z_0-9]*$/.test(c)),'INVALID_COLUMNS_OR_PATH');
  assert(Number.isSafeInteger(t.rows)&&t.rows>=0,'INVALID_COUNT');
  const h=createHash('sha256');for await(const b of createReadStream(join(root,t.file)))h.update(b);
  assert.equal(h.digest('hex'),t.sha256,'INPUT_HASH_MISMATCH');entries.set(t.table,t);
 }
 return db.transaction(async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(71590025)");
  await tx.query('CREATE TABLE IF NOT EXISTS migration_private.import_manifests(run_id uuid PRIMARY KEY REFERENCES migration_private.runs(id) DEFERRABLE INITIALLY DEFERRED,sha256 text NOT NULL)');
  const manifestHash=createHash('sha256').update(bytes).digest('hex');
  const old=(await tx.query('SELECT * FROM migration_private.runs WHERE id=$1',[manifest.run_id])).rows[0];
  if(old){assert(old.state==='validated'&&old.source_sha256===manifest.source_sha256&&old.transformer_version===manifest.transformer_version,'RUN_CONFLICT');
   assert.equal((await tx.query('SELECT sha256 FROM migration_private.import_manifests WHERE run_id=$1',[manifest.run_id])).rows[0]?.sha256,manifestHash,'MANIFEST_CONFLICT');
   for(const table of ORDER)assert.equal(Number((await tx.query('SELECT count(*) AS n FROM '+table)).rows[0].n),entries.get(table)?.rows??0,'REPEAT_COUNT_MISMATCH');
   return {skipped:true,sourceHash:manifest.source_sha256};}
  for(const table of ORDER)assert.equal(Number((await tx.query('SELECT count(*) AS n FROM '+table)).rows[0].n),0,'TARGET_NOT_EMPTY');
  await tx.query("INSERT INTO migration_private.runs(id,source_sha256,transformer_version,state) VALUES($1,$2,$3,'running')",[manifest.run_id,manifest.source_sha256,manifest.transformer_version]);
  await tx.query('INSERT INTO migration_private.import_manifests VALUES($1,$2)',[manifest.run_id,manifestHash]);
  const counts={};
  for(const table of ORDER){const t=entries.get(table);if(!t)continue;const cols=t.columns.map(c=>'"'+c+'"').join(',');let batch=[],n=0;
   async function flush(){if(!batch.length)return;
    const payload=JSON.stringify(batch),wanted=(await tx.query(`SELECT ${cols} FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`,[payload])).rows;
    const actual=(await tx.query(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::${table},$1::jsonb) RETURNING ${cols}`,[payload])).rows;
    assert.deepEqual(actual.map(stable).sort(),wanted.map(stable).sort(),'ROUNDTRIP_MISMATCH');n+=batch.length;batch=[];}
   for await(const line of createInterface({input:createReadStream(join(root,t.file)),crlfDelay:Infinity})){if(!line)continue;batch.push(JSON.parse(line));if(batch.length===400)await flush();}await flush();assert.equal(n,t.rows,'ROW_COUNT_MISMATCH');counts[table]=n;
   if(probeFailure&&table==='webavr.users')throw Object.assign(Error('ROLLBACK_PROBE'),{code:'ROLLBACK_PROBE'});
  }
  await tx.query('SET CONSTRAINTS ALL IMMEDIATE');
  for(const table of ORDER)assert.equal(Number((await tx.query('SELECT count(*) AS n FROM '+table)).rows[0].n),entries.get(table)?.rows??0,'FINAL_COUNT_MISMATCH');
  assert.equal(Number((await tx.query('SELECT count(*) AS n FROM migration_private.source_records s WHERE NOT EXISTS(SELECT 1 FROM migration_private.archives a WHERE a.source_record_id=s.id)')).rows[0].n),0,'MISSING_ARCHIVE');
  await tx.query("UPDATE migration_private.runs SET state='validated',finished_at=now() WHERE id=$1",[manifest.run_id]);
  return {skipped:false,counts,sourceHash:manifest.source_sha256,manifestHash};
 });
}
