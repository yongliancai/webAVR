import {createImageGeneration} from './image-generation.mjs';
import {createLearnerService} from './learner-service.mjs';
import {readFile,writeFile,mkdir,rename,unlink,open} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {createMediaService,fileResponse} from './media-service.mjs';
import {assertCourse,inspectCourse,courseSummary,record,courseId} from '../public/course-schema.mjs';
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const check=(ok,status=400,code='INVALID_STUDIO_DATA')=>{if(!ok)fail(status,code);};
const idOK=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const txt=(v,n=300)=>typeof v==='string'&&v.length<=n;
const uuid=()=>randomUUID();
const parse=x=>{if(typeof x!=='string')return x;try{return JSON.parse(x);}catch{return x;}};
export async function createStudio(db,{privateRoot,sourceFile=null,tutorProvider,imageProvider}={}){
 await mkdir(privateRoot,{recursive:true,mode:0o700});const mediaRoot=new URL('media/',privateRoot);await mkdir(mediaRoot,{recursive:true,mode:0o700});
 await db.exec(`CREATE SCHEMA IF NOT EXISTS studio;
 CREATE TABLE IF NOT EXISTS studio.drafts(id uuid PRIMARY KEY, owner_id uuid NOT NULL, revision int NOT NULL DEFAULT 1, document jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS studio.revisions(draft_id uuid NOT NULL,revision int NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(draft_id,revision));
 CREATE TABLE IF NOT EXISTS studio.media(id uuid PRIMARY KEY,owner_id uuid NOT NULL,filename text NOT NULL,width int NOT NULL,height int NOT NULL,sha256 text NOT NULL,original_name text NOT NULL);
 CREATE TABLE IF NOT EXISTS studio.source_media(id uuid PRIMARY KEY,filename text NOT NULL,width int NOT NULL,height int NOT NULL,sha256 text NOT NULL,original_sha256 text NOT NULL);
 CREATE TABLE IF NOT EXISTS studio.course_files(id uuid PRIMARY KEY,filename text NOT NULL,mime text NOT NULL,kind text NOT NULL,size_bytes bigint NOT NULL,sha256 text NOT NULL,label text NOT NULL);
 CREATE TABLE IF NOT EXISTS studio.package_entries(package_id uuid NOT NULL,asset_id uuid NOT NULL,label text NOT NULL,kind text NOT NULL,PRIMARY KEY(package_id,asset_id));
 CREATE TABLE IF NOT EXISTS studio.source_media_issues(id uuid PRIMARY KEY,code text NOT NULL);
 CREATE TABLE IF NOT EXISTS studio.source_catalog(id int PRIMARY KEY CHECK(id=1),document jsonb NOT NULL);`);
 const mediaService=await createMediaService(db,privateRoot);
 let source={courses:[],unlinked:{maps:[],tours:[]},assets:{},counts:{}};
 if(sourceFile){source=JSON.parse(await readFile(sourceFile,'utf8'));await db.query(`INSERT INTO studio.source_catalog VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET document=excluded.document WHERE studio.source_catalog.document->>'version' IS DISTINCT FROM excluded.document->>'version'`,[source]);}
 const stored=await db.query('SELECT document FROM studio.source_catalog WHERE id=1');if(stored.rows.length)source=parse(stored.rows[0].document);
 // Read-only safe catalog envelope; original JSON remains in its file/table.
 const rawSource=source;source={...(record(rawSource)?rawSource:{}),courses:Array.isArray(rawSource?.courses)?rawSource.courses:[],unlinked:{maps:Array.isArray(rawSource?.unlinked?.maps)?rawSource.unlinked.maps:[],tours:Array.isArray(rawSource?.unlinked?.tours)?rawSource.unlinked.tours:[]},assets:record(rawSource?.assets)?rawSource.assets:{},counts:record(rawSource?.counts)?rawSource.counts:{}};
 function teacher(user){check(user.roles.some(r=>['admin','teacher'].includes(r)),403,'FORBIDDEN');}
 function admin(user){check(user.roles.includes('admin'),403,'FORBIDDEN');}
 async function draft(user,id){check(idOK(id));const r=(await db.query('SELECT * FROM studio.drafts WHERE id=$1 AND owner_id=$2',[id,user.id])).rows[0];check(r,404,'NOT_FOUND');return {...r,document:parse(r.document)};}
 const summary=courseSummary;
 const validate=assertCourse;
 async function persist(user,id,revision,d){
  validate(d);check(d.id===id);const old=await draft(user,id);check(inspectCourse(old.document).valid,409,'COURSE_REPAIR_REQUIRED');
  // An open editor may still hold the pre-upgrade revision. Merge only the
  // exact, additive projection upgrade; regular concurrent edits still conflict.
  if(revision!==old.revision&&old.revision===revision+1){
   const base=(await db.query('SELECT document FROM studio.revisions WHERE draft_id=$1 AND revision=$2',[id,revision])).rows[0]?.document;
   if(base){const expected=structuredClone(parse(base));const enabled=new Set();for(const s of expected.scenes){if(s.projection==='unknown'||!s.projection){s.projection='equirectangular';enabled.add(s.id);}}
    if(enabled.size&&JSON.stringify(expected)===JSON.stringify(old.document)){for(const s of d.scenes)if(enabled.has(s.id)&&(s.projection==='unknown'||!s.projection))s.projection='equirectangular';revision=old.revision;}
   }
  }
  // Provenance is server-controlled, never changed by a browser form.
  d.sourceId=old.document.sourceId??null;d.source=(source.courses.find(x=>x?.id===d.sourceId)?.source)??old.document.source??null;d.sourceOwnerId=old.document.sourceOwnerId??null;d.id=id;
  const mediaIds=new Set([d.coverAssetId,...d.maps.map(m=>m.assetId),...d.scenes.map(s=>s.assetId)].filter(Boolean));
  for(const aid of mediaIds)check(source.assets[aid]||(user.roles.includes('admin')&&!!(await db.query('SELECT 1 FROM studio.source_media WHERE id=$1',[aid])).rows.length)||!!(await db.query('SELECT 1 FROM studio.media WHERE id=$1 AND owner_id=$2',[aid,user.id])).rows.length,403,'MEDIA_FORBIDDEN');
  return db.transaction(async tx=>{const q=await tx.query('UPDATE studio.drafts SET document=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND owner_id=$3 AND revision=$4 RETURNING revision,updated_at',[d,id,user.id,revision]);check(q.rows.length,409,'REVISION_CONFLICT');await tx.query('INSERT INTO studio.revisions(draft_id,revision,document) VALUES($1,$2,$3)',[id,q.rows[0].revision,d]);return {id,document:d,...q.rows[0]};});
 }
 async function newDraft(user,d){const id=uuid();d.id=id;validate(d);await db.transaction(async tx=>{await tx.query('INSERT INTO studio.drafts(id,owner_id,document) VALUES($1,$2,$3)',[id,user.id,d]);await tx.query('INSERT INTO studio.revisions(draft_id,revision,document) VALUES($1,1,$2)',[id,d]);});return {id,revision:1,document:d};}
 function cloneSource(c){const d=structuredClone(c);d.sourceId=c.id;d.sourceOwnerId=c.sourceOwnerId;d.state='draft';return d;}
 async function handle({user,method,pathname,body,url,headers={},uploadStream,signal}){
  if(pathname==='/api/studio/tutor-status'||pathname.startsWith('/api/studio/class-learning/')||pathname.startsWith('/api/learn/')||pathname==='/api/studio/teaching-classes'||/\/class-lessons$/.test(pathname))return learnerHandle({user,method,pathname,body,url,headers,uploadStream,signal});
  if(!pathname.startsWith('/api/studio/'))return null;teacher(user);if(method==='POST')check(record(body));
  if(/^\/api\/studio\/courses\/[a-f0-9-]+\/image-generations(?:\/|$)/i.test(pathname))return imageGeneration.handle({user,method,pathname,body});
  if(pathname==='/api/studio/courses'&&method==='GET'){const q=await db.query('SELECT id,document,revision,updated_at FROM studio.drafts WHERE owner_id=$1 ORDER BY updated_at DESC',[user.id]);const readyIds=new Set((await db.query('SELECT id FROM studio.media WHERE owner_id=$1',[user.id])).rows.map(r=>r.id));if(user.roles.includes('admin'))for(const r of (await db.query('SELECT id FROM studio.source_media')).rows)readyIds.add(r.id);return {items:q.rows.map(r=>({...summary(parse(r.document),r.id),coverReady:readyIds.has(parse(r.document)?.coverAssetId),revision:r.revision,updatedAt:r.updated_at})),canReadSources:user.roles.includes('admin')};}
  if(pathname==='/api/studio/courses'&&method==='POST'){check(Object.keys(body).every(k=>['title','description','category','grade','goals'].includes(k)));return newDraft(user,{title:body.title,description:body.description??'',category:body.category??'其他',grade:body.grade??'',goals:body.goals??'',coverAssetId:null,maps:[],scenes:[],tours:[],sourceId:null,state:'draft'});}
  if(pathname==='/api/studio/sources'&&method==='GET'){admin(user);const restoredIds=new Set((await db.query('SELECT id FROM studio.source_media')).rows.map(x=>x.id));return {items:source.courses.filter(c=>record(c)&&courseId(c.id)).map(c=>{const view=summary(c);const ids=[...new Set([c.coverAssetId,...(Array.isArray(c.maps)?c.maps:[]).filter(record).map(m=>m.assetId),...(Array.isArray(c.scenes)?c.scenes:[]).filter(record).map(s=>s.assetId)].filter(v=>courseId(v)))];return {...view,ownerVerified:false,coverReady:restoredIds.has(c.coverAssetId),expectedImages:ids.length,readyImages:ids.filter(id=>restoredIds.has(id)).length};}),unlinked:{maps:source.unlinked.maps.filter(m=>record(m)&&courseId(m.id)).map(m=>({id:m.id,title:typeof m.title==='string'?m.title:'待檢查地圖',markers:Array.isArray(m.markers)?m.markers.length:0})),tours:source.unlinked.tours.filter(t=>record(t)&&courseId(t.id)).map(t=>({id:t.id,title:typeof t.title==='string'?t.title:'待檢查導覽',scenes:Array.isArray(t.scenes)?t.scenes.length:0}))},counts:source.counts,snapshotSha256:source.snapshotSha256};}
  let m=pathname.match(/^\/api\/studio\/sources\/([a-f0-9-]+)$/i);
  if(m&&method==='GET'){admin(user);const c=source.courses.find(x=>x?.id===m[1]);check(c,404,'NOT_FOUND');return {document:c,validation:inspectCourse(c)};}
  if(m&&method==='POST'){admin(user);const c=source.courses.find(x=>x?.id===m[1]);check(c,404,'NOT_FOUND');check(body.action==='copy');return newDraft(user,cloneSource(c));}
  m=pathname.match(/^\/api\/studio\/courses\/([a-f0-9-]+)$/i);
  if(m&&method==='GET'){const r=await draft(user,m[1]);return {id:r.id,revision:r.revision,document:r.document,updatedAt:r.updated_at,validation:inspectCourse(r.document)};}
  if(m&&method==='POST'){check(Number.isInteger(body.revision)&&body.revision>0&&body.document);return persist(user,m[1],body.revision,body.document);}
  m=pathname.match(/^\/api\/studio\/courses\/([a-f0-9-]+)\/attach$/i);
  if(m&&method==='POST'){admin(user);const r=await draft(user,m[1]);check(body.revision===r.revision,409,'REVISION_CONFLICT');const d=r.document;validate(d);d.tours??=[];check(['map','tour'].includes(body.kind));
   if(body.kind==='map'){const a=source.unlinked.maps.find(x=>x?.id===body.sourceId);check(a,404,'NOT_FOUND');check(!d.maps.some(x=>x.id===a.id),409,'ALREADY_ATTACHED');d.maps.push(structuredClone(a));}
   else{const t=source.unlinked.tours.find(x=>x?.id===body.sourceId);check(t,404,'NOT_FOUND');check(!d.scenes.some(s=>s.tourId===t.id),409,'ALREADY_ATTACHED');d.tours.push({id:t.id,title:t.title});d.scenes.push(...structuredClone(t.scenes));}
   return persist(user,m[1],body.revision,d);
  }
  if(pathname==='/api/studio/uploads'&&method==='POST')return mediaService.prepare(user,body);
  m=pathname.match(/^\/api\/studio\/uploads\/([a-f0-9-]+)\/content$/i);
  if(m&&method==='POST'){check(courseId(m[1])&&uploadStream,400,'INVALID_UPLOAD');return mediaService.receive(user,m[1],uploadStream,headers,signal);}
  if(pathname==='/api/studio/media'&&method==='POST'){
   check(txt(body.name,200)&&typeof body.data==='string'&&body.data.length<=24000000,413,'IMAGE_TOO_LARGE');check(/^[A-Za-z0-9+/]*={0,2}$/.test(body.data));const b=Buffer.from(body.data,'base64');check(b.length>0&&b.length<=16000000,413,'IMAGE_TOO_LARGE');
   return mediaService.legacy(user,body.name,b,signal);
  }
  m=pathname.match(/^\/api\/studio\/media\/([a-f0-9-]+)(?:\/(thumbnail|preview|panorama-1024|panorama-2048|panorama-4096|original))?$/i);
  if(m&&method==='GET'){
   check(idOK(m[1]));const row=(await db.query('SELECT * FROM studio.media WHERE id=$1 AND owner_id=$2',[m[1],user.id])).rows[0];
   const restored=!row&&user.roles.includes('admin')?(await db.query('SELECT * FROM studio.source_media WHERE id=$1',[m[1]])).rows[0]:null;check(row||restored,404,'MEDIA_MISSING');
   if(m[2]==='original'){check(row,404,'MEDIA_MISSING');const original=(await db.query('SELECT * FROM studio.media_originals WHERE media_id=$1',[m[1]])).rows[0];check(original,404,'MEDIA_MISSING');return fileResponse(new URL('media-originals/'+original.filename,privateRoot),original.mime,{range:headers.range,downloadName:row.original_name});}
   let path=row?new URL(row.filename,mediaRoot):new URL('source-media/ready/'+restored.filename,privateRoot);
   if(m[2])path=await mediaService.variant(m[1],path,m[2]);
   return fileResponse(path,'image/jpeg',{range:headers.range});
  }
  m=pathname.match(/^\/api\/studio\/activities\/([a-f0-9-]+)\/media-link$/i);
  if(m&&method==='GET'){admin(user);check(idOK(m[1]));const h=[...source.courses,...source.unlinked.tours].filter(record).flatMap(c=>Array.isArray(c.scenes)?c.scenes:[]).filter(record).flatMap(s=>Array.isArray(s.hotspots)?s.hotspots:[]).filter(record).find(h=>h.id===m[1]&&h.kind==='video');return {url:h?.legacy?.externalVideo??null};}
  m=pathname.match(/^\/api\/studio\/packages\/([a-f0-9-]+)$/i);
  if(m&&method==='GET'){admin(user);check(idOK(m[1]));const rows=(await db.query('SELECT asset_id AS id,label,kind FROM studio.package_entries WHERE package_id=$1 ORDER BY label,asset_id',[m[1]])).rows;check(rows.length,404,'NOT_FOUND');return {items:rows};}
  m=pathname.match(/^\/api\/studio\/files\/([a-f0-9-]+)$/i);
  if(m&&method==='GET'){
   admin(user);check(idOK(m[1]));const file=(await db.query('SELECT * FROM studio.course_files WHERE id=$1',[m[1]])).rows[0];check(file,404,'MEDIA_MISSING');   return fileResponse(new URL('source-media/originals/'+file.filename,privateRoot),file.mime,{range:headers.range,downloadName:url.searchParams.has('download')||!['audio','video'].includes(file.kind)?file.label:undefined});
  }
  if(pathname==='/api/studio/media-status'&&method==='POST'){
   check(Array.isArray(body.ids)&&body.ids.length<=1000&&body.ids.every(idOK));const rows=(await db.query('SELECT id,width,height FROM studio.media WHERE owner_id=$1 AND id=ANY($2::uuid[])',[user.id,body.ids])).rows;
   const restored=user.roles.includes('admin')?(await db.query('SELECT id,width,height FROM studio.source_media WHERE id=ANY($1::uuid[])',[body.ids])).rows:[];
   const files=user.roles.includes('admin')?(await db.query('SELECT id,mime,kind,label FROM studio.course_files WHERE id=ANY($1::uuid[])',[body.ids])).rows:[];
   const issues=user.roles.includes('admin')?(await db.query('SELECT id,code FROM studio.source_media_issues WHERE id=ANY($1::uuid[])',[body.ids])).rows:[];const issueMap=new Map(issues.map(x=>[x.id,x.code]));const indexed=new Map([...restored,...rows].map(x=>[x.id,x]));const fileMap=new Map(files.map(x=>[x.id,x]));
   return {items:body.ids.map(id=>{const f=fileMap.get(id);return {id,...f,state:indexed.has(id)?'ready':f?f.kind==='archive'?'package_ready':['audio','video'].includes(f.kind)?'media_ready':'attachment_ready':issueMap.get(id)??'missing',...indexed.get(id)};})};
  }
  fail(404,'NOT_FOUND');
 }
 const imageGeneration=await createImageGeneration(db,{privateRoot,draft,mediaService,provider:imageProvider});
 const learnerHandle=await createLearnerService(db,handle,{tutorProvider});
 return {handle};
}
