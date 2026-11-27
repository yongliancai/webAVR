// Offline only: stop preview first. Registers scoped recovered media and safe package derivatives.
import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
import sharp from 'sharp';
import {createStudio} from './backend.mjs';
const privateRoot=new URL('../private-studio/',import.meta.url),folder=new URL('source-media/',privateRoot);
const cat=JSON.parse(await readFile(new URL('source-catalog.json',privateRoot)));
const report=JSON.parse(await readFile(new URL('course-assets-results.json',folder)));
const packages=JSON.parse(await readFile(new URL('package-entries.json',folder))).entries;
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const r of packages){if(r.kind!=='image')continue;const bytes=await readFile(new URL('originals/'+r.id+'.bin',folder));if(hash(bytes)!==r.originalSha256)throw Error('PACKAGE_HASH_MISMATCH');const image=await sharp(bytes,{limitInputPixels:150000000}).rotate().flatten({background:'#fff'}).resize({width:8192,height:8192,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer({resolveWithObject:true});const thumb=await sharp(image.data).resize(320,180,{fit:'cover'}).jpeg({quality:75}).toBuffer();await writeFile(new URL('ready/'+r.id+'.jpg',folder),image.data,{mode:0o600});await writeFile(new URL('thumbnails/'+r.id+'.jpg',folder),thumb,{mode:0o600});Object.assign(r,{width:image.info.width,height:image.info.height,derivativeSha256:hash(image.data),thumbnailSha256:hash(thumb),state:'ready'});}
const db=new PGlite(new URL('database/',privateRoot).pathname);await db.waitReady;await createStudio(db,{privateRoot});let images=0,files=0;
try{await db.transaction(async tx=>{
 for(const r of [...report.results,...packages]){
  if(r.state==='unavailable'){await tx.query('INSERT INTO studio.source_media_issues VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET code=excluded.code',[r.id,'access_denied']);continue;}
  if(!r.originalSha256)throw Error('UNCLASSIFIED_MEDIA');const raw=await readFile(new URL('originals/'+r.id+'.bin',folder));if(hash(raw)!==r.originalSha256)throw Error('ORIGINAL_HASH_MISMATCH');await tx.query('DELETE FROM studio.source_media_issues WHERE id=$1',[r.id]);
  if(r.state==='ready'){const bytes=await readFile(new URL('ready/'+r.id+'.jpg',folder));if(hash(bytes)!==r.derivativeSha256)throw Error('IMAGE_HASH_MISMATCH');await tx.query('INSERT INTO studio.source_media VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,width=excluded.width,height=excluded.height,sha256=excluded.sha256,original_sha256=excluded.original_sha256',[r.id,r.id+'.jpg',r.width,r.height,r.derivativeSha256,r.originalSha256]);images++;}
  else{const mime=r.mime==='audio/x-m4a'?'audio/mp4':r.mime==='audio/x-wav'?'audio/wav':r.mime;await tx.query('INSERT INTO studio.course_files VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET mime=excluded.mime,kind=excluded.kind,size_bytes=excluded.size_bytes,sha256=excluded.sha256,label=excluded.label',[r.id,r.id+'.bin',mime,r.kind,raw.length,r.originalSha256,r.label||basename(cat.assets[r.id].object_path)]);files++;}
  if(r.packageId)await tx.query('INSERT INTO studio.package_entries VALUES($1,$2,$3,$4) ON CONFLICT(package_id,asset_id) DO UPDATE SET label=excluded.label,kind=excluded.kind',[r.packageId,r.id,r.label,r.kind]);
 }
 });await writeFile(new URL('package-entries.json',folder),JSON.stringify({entries:packages},null,2),{mode:0o600});console.log(JSON.stringify({images,files,packageEntries:packages.length,unavailable:report.results.filter(x=>x.state==='unavailable').length}));
}finally{await db.close();}
