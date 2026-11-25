// Offline registration only: shut down the preview before opening its database.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createStudio} from './backend.mjs';
const privateRoot=new URL('../private-studio/',import.meta.url),folder=new URL('source-media/',privateRoot);
const catalog=JSON.parse(await readFile(new URL('source-catalog.json',privateRoot),'utf8'));
const inventory=JSON.parse(await readFile(new URL('inventory.json',folder),'utf8'));
const approved=new Set(inventory.assets.map(a=>a.id));
const report=JSON.parse(await readFile(new URL('retrieval-results.json',folder),'utf8'));
const db=new PGlite(new URL('database/',privateRoot).pathname);await db.waitReady;await createStudio(db,{privateRoot});let registered=0;
try{await db.transaction(async tx=>{for(const r of report.results){if(r.state!=='ready'){if(approved.has(r.id))await tx.query('INSERT INTO studio.source_media_issues(id,code) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET code=excluded.code',[r.id,r.reviewReason==='SOURCE_REFERENCE_IS_NOT_AN_IMAGE'?'not_image':r.httpStatus===403?'access_denied':'missing']);continue;}await tx.query('DELETE FROM studio.source_media_issues WHERE id=$1',[r.id]);if(!approved.has(r.id)||!catalog.assets[r.id])throw Error('UNAPPROVED_IMAGE');const bytes=await readFile(new URL('ready/'+r.id+'.jpg',folder));if(createHash('sha256').update(bytes).digest('hex')!==r.derivativeSha256)throw Error('DERIVATIVE_HASH_MISMATCH');const original=await readFile(new URL('originals/'+r.id+'.bin',folder));if(createHash('sha256').update(original).digest('hex')!==r.originalSha256)throw Error('ORIGINAL_HASH_MISMATCH');await tx.query(`INSERT INTO studio.source_media(id,filename,width,height,sha256,original_sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,width=excluded.width,height=excluded.height,sha256=excluded.sha256,original_sha256=excluded.original_sha256`,[r.id,r.id+'.jpg',r.width,r.height,r.derivativeSha256,r.originalSha256]);registered++;}});console.log(JSON.stringify({registered,access:'local operator only; does not grant ownership or public access'}));}finally{await db.close();}
