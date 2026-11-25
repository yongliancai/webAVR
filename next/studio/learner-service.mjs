import {createTutorService} from './tutor-service.mjs';
import {createLearningService} from './learning-service.mjs';
import {randomUUID} from 'node:crypto';
import {assertCourse,courseId,courseSummary} from '../public/course-schema.mjs';
const reject=(code='NOT_FOUND',status=404)=>{throw Object.assign(Error(code),{code,status});};
const need=(ok,code='NOT_FOUND',status=404)=>{if(!ok)reject(code,status);};
// Published snapshots remain separate from mutable teacher drafts.
export async function createLearnerService(db,serveStudio,{tutorProvider}={}){
 await db.exec(`CREATE TABLE IF NOT EXISTS studio.class_lessons(
 id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES studio.drafts(id),
 class_id uuid NOT NULL REFERENCES webavr.classes(id),owner_id uuid NOT NULL REFERENCES webavr.users(id),
 revision int NOT NULL,document jsonb NOT NULL,active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(draft_id,class_id));`);
 const learning=await createLearningService(db);
 const teacher=u=>u.roles.some(r=>['teacher','admin'].includes(r));
 async function classes(u){need(teacher(u),'FORBIDDEN',403);return (await db.query(`SELECT c.id,c.name FROM webavr.classes c WHERE c.state='active' AND ($2::boolean OR EXISTS(SELECT 1 FROM webavr.class_memberships m WHERE m.class_id=c.id AND m.user_id=$1 AND m.member_role='teacher' AND m.left_at IS NULL AND m.joined_at<=now())) ORDER BY c.name,c.id`,[u.id,u.roles.includes('admin')])).rows;}
 async function available(u,id=null){return (await db.query(`SELECT l.*,c.name AS class_name FROM studio.class_lessons l JOIN webavr.classes c ON c.id=l.class_id WHERE l.active AND c.state='active' AND ($4::uuid IS NULL OR l.id=$4) AND EXISTS(SELECT 1 FROM webavr.class_memberships m WHERE m.class_id=l.class_id AND m.user_id=$1 AND m.left_at IS NULL AND m.joined_at<=now() AND ((m.member_role='student' AND $2::boolean) OR (m.member_role='teacher' AND $3::boolean))) ORDER BY l.updated_at DESC,l.id`,[u.id,u.roles.includes('student'),u.roles.includes('teacher'),id])).rows;}
 async function lesson(u,id){need(courseId(id));const r=(await available(u,id)).find(x=>x.id===id);if(r)return {...r,preview:false};if(teacher(u)){const d=(await db.query('SELECT * FROM studio.drafts WHERE id=$1 AND owner_id=$2',[id,u.id])).rows[0];if(d)return {...d,preview:true};}reject();}
 const tutor=await createTutorService(db,{resolveLesson:lesson,provider:tutorProvider});
 const summary=d=>{const {sourceId,...view}=courseSummary(d);return view;};
 const refs=d=>new Set([d.coverAssetId,...d.maps.map(m=>m.assetId),...d.scenes.flatMap(s=>[s.assetId,...s.hotspots.flatMap(h=>h.assetIds??[])])].filter(courseId));
 const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,structuredClone(o[k])]));
 function clean(d){return {assistant:{enabled:!!d.assistant?.enabled,name:d.assistant?.name||'課程小助教',answerStyle:d.assistant?.answerStyle||'guide'},...pick(d,['id','title','description','category','grade','goals','coverAssetId','state','tours']),maps:d.maps.map(m=>({...pick(m,['id','title','assetId']),markers:m.markers.map(h=>pick(h,['id','title','x','y','targetSceneId']))})),scenes:d.scenes.map(s=>({...pick(s,['id','title','assetId','projection','pitch','yaw','tourId']),hotspots:s.hotspots.map(h=>({...pick(h,['id','kind','title','content','pitch','yaw','enabled','targetSceneId','assetIds']),payload:pick(h.payload,['options','cardName','hotspotToExplore']),legacy:pick(h.legacy,['locationName','externalVideo'])}))}))};}
 async function asOwner(row,path,args){const roles=(await db.query('SELECT role FROM webavr.user_roles WHERE user_id=$1 AND revoked_at IS NULL',[row.owner_id])).rows.map(x=>x.role);return serveStudio({...args,pathname:path,user:{id:row.owner_id,roles}});}
 async function status(row,args){const ids=[...refs(row.document)],items=[];for(let i=0;i<ids.length;i+=1000)items.push(...(await asOwner(row,'/api/studio/media-status',{...args,method:'POST',body:{ids:ids.slice(i,i+1000)}})).items);return items;}
 return async args=>{const {pathname,method,user,body}=args;
  if(pathname==='/api/studio/tutor-status'&&method==='GET'){need(teacher(user),'FORBIDDEN',403);return {configured:tutor.configured};}
  if(/^\/api\/learn\/courses\/[a-f0-9-]+\/assistant(?:\/transcribe)?$/i.test(pathname))return tutor.handle(args);
  if(pathname==='/api/studio/teaching-classes'&&method==='GET')return {items:await classes(user)};
  const overview=pathname.match(/^\/api\/studio\/class-learning\/([a-f0-9-]+)$/i);
  if(overview&&method==='GET'){need(courseId(overview[1]));return learning.report(user,overview[1],args.url,await classes(user));}
  const share=pathname.match(/^\/api\/studio\/courses\/([a-f0-9-]+)\/class-lessons$/i);
  if(share){need(teacher(user),'FORBIDDEN',403);need(courseId(share[1]));const row=(await db.query('SELECT * FROM studio.drafts WHERE id=$1 AND owner_id=$2',[share[1],user.id])).rows[0];need(row);
   if(method==='GET')return {items:(await db.query('SELECT id,class_id,revision,active FROM studio.class_lessons WHERE draft_id=$1 AND owner_id=$2',[share[1],user.id])).rows};
   need(method==='POST'&&Object.keys(body).every(k=>['classId','revision','active'].includes(k))&&courseId(body.classId)&&Number.isInteger(body.revision)&&typeof body.active==='boolean','INVALID_FIELDS',400);
   need((await classes(user)).some(c=>c.id===body.classId),'FORBIDDEN',403);need(row.revision===body.revision,'REVISION_CONFLICT',409);
   if(!body.active){await db.query('UPDATE studio.class_lessons SET active=false,updated_at=now() WHERE draft_id=$1 AND class_id=$2',[row.id,body.classId]);return {status:'withdrawn'};}
   assertCourse(row.document);need(row.document.scenes.length>0,'NO_SCENES',400);
   const result=await db.transaction(async tx=>{const result=await tx.query(`INSERT INTO studio.class_lessons(id,draft_id,class_id,owner_id,revision,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(draft_id,class_id) DO UPDATE SET revision=excluded.revision,document=excluded.document,active=true,updated_at=now() RETURNING id`,[randomUUID(),row.id,body.classId,user.id,row.revision,row.document]);await tx.query('INSERT INTO studio.lesson_versions(lesson_id,revision,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[result.rows[0].id,row.revision,row.document]);return result;});return {id:result.rows[0].id,status:'shared',revision:row.revision};
  }
  if(!pathname.startsWith('/api/learn/'))return null;
  const event=pathname.match(/^\/api\/learn\/courses\/([a-f0-9-]+)\/events$/i);if(event&&method==='POST'){const row=await lesson(user,event[1]);return learning.recordEvent(user,row,body);}
  need(method==='GET','FORBIDDEN',403);
  const answerHistory=pathname.match(/^\/api\/learn\/courses\/([a-f0-9-]+)\/answers$/i);if(answerHistory)return learning.ownHistory(user,await lesson(user,answerHistory[1]),args.url);
  if(pathname==='/api/learn/courses'){const rows=await learning.listProgress(user,await available(user)),previews=teacher(user)?(await db.query('SELECT * FROM studio.drafts WHERE owner_id=$1 ORDER BY updated_at DESC',[user.id])).rows:[];return {items:[...rows.map(r=>({...summary(r.document),id:r.id,invalid:courseSummary(r.document).invalid||!r.document?.scenes?.length,revision:r.revision,className:r.class_name,preview:false,progress:r.learningProgress})),...previews.map(r=>({...summary(r.document),id:r.id,invalid:courseSummary(r.document).invalid||!r.document?.scenes?.length,revision:r.revision,className:'老師預覽 · 尚未提供給班級',preview:true}))]};}
  const match=pathname.match(/^\/api\/learn\/courses\/([a-f0-9-]+)(?:\/(media-status|media\/([a-f0-9-]+)\/(thumbnail|preview|panorama-1024|panorama-2048|panorama-4096)|files\/([a-f0-9-]+)|activities\/([a-f0-9-]+)\/media-link))?$/i);need(match);let row=await lesson(user,match[1]);assertCourse(row.document);
  if(!match[2])return {document:clean(row.document),revision:row.revision,preview:row.preview,className:row.class_name??'老師預覽',tracking:await learning.eligible(user,row),progress:await learning.progress(user,row)};
  if(args.url?.searchParams.has('revision')){const revision=Number(args.url.searchParams.get('revision'));need(Number.isSafeInteger(revision)&&revision>0&&revision<=2147483647,'INVALID_FIELDS',400);if(row.preview)need(revision===row.revision,'VERSION_NOT_AVAILABLE',409);else{const snapshot=(await db.query('SELECT document FROM studio.lesson_versions WHERE lesson_id=$1 AND revision=$2',[row.id,revision])).rows[0];need(snapshot,'VERSION_NOT_AVAILABLE',409);row={...row,revision,document:snapshot.document};assertCourse(row.document);}}
  if(match[2]==='media-status')return {items:await status(row,args)};
  if(match[3]){need(refs(row.document).has(match[3]));return asOwner(row,'/api/studio/media/'+match[3]+'/'+match[4],args);}
  if(match[5]){need(refs(row.document).has(match[5]));need((await db.query("SELECT 1 FROM studio.course_files WHERE id=$1 AND kind IN ('audio','video')",[match[5]])).rows.length);return asOwner(row,'/api/studio/files/'+match[5],args);}
  const h=row.document.scenes.flatMap(s=>s.hotspots).find(h=>h.id===match[6]&&h.kind==='video');need(h);return {url:h.legacy?.externalVideo??null};
 };
}
