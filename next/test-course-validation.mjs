import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {inspectCourse,assertCourse,courseSummary} from './public/course-schema.mjs';
import {createDraftRecovery} from './public/draft-recovery.mjs';
import {createApp} from './app.mjs';
import {createStudio} from './studio/backend.mjs';
import {seed,TEST_PASSWORD} from './fixtures.mjs';
let checks=0;const ok=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS '+label);};
const uid=()=>crypto.randomUUID();
const doc={id:uid(),title:'格式驗證教材',description:'原內容保留',maps:[{id:uid(),title:'地圖',assetId:null,markers:[]}],scenes:[{id:uid(),title:'場景',assetId:null,projection:'equirectangular',hotspots:[{id:uid(),kind:'choice',title:'題目',content:'原題目',pitch:null,yaw:null,payload:{options:{A:'第一個選項'},unknownLegacy:{keep:true}}}]}],tours:[],customMetadata:{retained:['a','b']}};
ok(inspectCourse(doc).valid,'valid draft and unpositioned activity accepted');
const original=JSON.stringify(doc);assertCourse(doc);ok(JSON.stringify(doc)===original,'validation never mutates or strips original fields');
const invalidCases=[
 ['tour object',d=>d.tours={}],['tour null',d=>d.tours=null],['tour element null',d=>d.tours=[null]],
 ['asset list string',d=>d.scenes[0].hotspots[0].assetIds='bad'],['asset list object',d=>d.scenes[0].hotspots[0].assetIds={}],['asset identity',d=>d.scenes[0].hotspots[0].assetIds=['bad']],
 ['null scene',d=>d.scenes=[null]],['scene list object',d=>d.scenes={}],['map list null',d=>d.maps=null],['map element null',d=>d.maps=[null]],['marker list string',d=>d.maps[0].markers='bad'],
 ['hotspot list object',d=>d.scenes[0].hotspots={}],['null hotspot',d=>d.scenes[0].hotspots=[null]],['title object',d=>d.title={}],['title empty',d=>d.title=''],['category array',d=>d.category=[]],
 ['invalid course id',d=>d.id='invalid'],['missing course id',d=>delete d.id],['duplicate ids',d=>d.maps[0].id=d.scenes[0].id],['unknown projection',d=>d.scenes[0].projection='bad'],
 ['coordinate string',d=>d.scenes[0].hotspots[0].pitch='0'],['coordinate outside range',d=>d.scenes[0].hotspots[0].yaw=181],['not finite',d=>d.scenes[0].pitch=Infinity],
 ['payload string',d=>d.scenes[0].hotspots[0].payload='bad'],['choice options array',d=>d.scenes[0].hotspots[0].payload.options=[]],['choice option object',d=>d.scenes[0].hotspots[0].payload.options.A={}],
 ['explore title object',d=>d.scenes[0].hotspots[0].payload.cardName={}],['legacy object type',d=>d.scenes[0].hotspots[0].legacy=[]],['legacy location object',d=>d.scenes[0].hotspots[0].legacy={locationName:{}}],
 ['unsafe external link',d=>d.scenes[0].hotspots[0].legacy={externalVideo:'javascript:alert(1)'}],['source path object',d=>d.source={sourcePath:{}}],['enabled string',d=>d.scenes[0].hotspots[0].enabled='true'],
 ['missing enabled transfer target',d=>Object.assign(d.scenes[0].hotspots[0],{kind:'link',enabled:true,targetSceneId:uid()})],['missing map target',d=>d.maps[0].markers=[{id:uid(),title:'標記',x:0,y:0,targetSceneId:uid()}]],
 ['unknown tour reference',d=>d.scenes[0].tourId=uid()],['invalid cover identity',d=>d.coverAssetId={}],['unsafe object field',d=>d.customMetadata=JSON.parse('{"__proto__":{"x":true}}')]
];
for(const [label,mutate] of invalidCases){const value=structuredClone(doc);mutate(value);const result=inspectCourse(value);ok(!result.valid&&result.issues.length>0,'rejects '+label);}
const empty=structuredClone(doc);empty.title='';ok(inspectCourse(empty,{editing:true}).valid&&!inspectCourse(empty).valid,'in-progress empty title is recoverable but cannot be saved');
const incomplete=structuredClone(doc);Object.assign(incomplete.scenes[0].hotspots[0],{kind:'link',enabled:true,targetSceneId:null});ok(inspectCourse(incomplete,{editing:true}).valid&&!inspectCourse(incomplete).valid,'in-progress target selection is recoverable but blocked at save');
const cyclic=structuredClone(doc);cyclic.extra=cyclic;ok(!inspectCourse(cyclic).valid,'cyclic non-JSON input is rejected without throwing');
let deep={};for(let i=0;i<35;i++)deep={nested:deep};ok(!inspectCourse({...doc,extra:deep}).valid,'excessively nested content rejected');
ok(inspectCourse({...doc,extra:'x'.repeat(1500001)}).tooLarge,'document byte limit is preserved');
for(const value of [null,7,'bad',[],{title:{}}])ok(!inspectCourse(value).valid&&typeof courseSummary(value,uid()).title==='string','invalid root is safely summarized');
let legacyCourses=0;
try{const catalog=JSON.parse(await readFile(new URL('./private-studio/source-catalog.json',import.meta.url),'utf8')),catalogBefore=JSON.stringify(catalog);
ok(catalog.courses.length===73&&catalog.courses.every(d=>inspectCourse(d).valid),'all 73 original course documents remain accepted');
ok(JSON.stringify(catalog)===catalogBefore,'source catalog remains byte-equivalent after inspection');legacyCourses=catalog.courses.length;
}catch(e){if(e.code!=='ENOENT')throw e;console.log('SKIP private legacy catalog checks: original teaching data is deliberately excluded from public source');}
const memory=new Map(),storage={get length(){return memory.size},key:i=>[...memory.keys()][i],getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const recovery=createDraftRecovery({getStorage:()=>storage,tabId:'test'}),broken=structuredClone(doc);broken.scenes[0].hotspots[0].assetIds='bad';recovery.put('teacher',broken,2);const retained=recovery.find('teacher',doc.id)[0];ok(!retained.validation.valid&&retained.document.scenes[0].hotspots[0].assetIds==='bad','malformed recovery is retained for download and flagged instead of silently erased');
const db=new PGlite(),folder=await mkdtemp(join(tmpdir(),'webavr-validation-'));let app;
try{
 await db.waitReady;await seed(db,new URL('./schema/',import.meta.url));const studio=await createStudio(db,{privateRoot:pathToFileURL(folder+'/')});app=await createApp(db,{origin:'http://127.0.0.1:3995',secureCookies:false,mailer:async()=>{},studio,authLimit:100,writeLimit:1000});
 const origin='http://127.0.0.1:3995';const login=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:'teachera@example.invalid',password:TEST_PASSWORD}});const cookie=login.headers['set-cookie'].split(';')[0],session=await app.dispatch({path:'/api/auth/session',headers:{cookie}});const userId=session.body.user.id,headers={cookie,origin,'x-csrf-token':session.body.csrfToken,'content-type':'application/json'};
 const call=(path,body)=>app.dispatch({method:body===undefined?'GET':'POST',path,headers,body});
 const created=await call('/api/studio/courses',{title:'合法教材'}),id=created.body.id,good={...structuredClone(doc),id};const saved=await call('/api/studio/courses/'+id,{revision:1,document:good});ok(saved.status===200&&saved.body.revision===2,'valid full document still saves through the real API');
 for(const [label,mutate] of invalidCases){const value=structuredClone(good);mutate(value);const response=await call('/api/studio/courses/'+id,{revision:2,document:value});ok(response.status===400&&response.body.error.code==='INVALID_STUDIO_DATA'&&Array.isArray(response.body.error.fields),'API rejects '+label+' with field guidance');}
 const revisions=await db.query('SELECT count(*)::int AS n FROM studio.revisions WHERE draft_id=$1',[id]);ok(revisions.rows[0].n===2&&(await call('/api/studio/courses/'+id)).body.document.title===good.title,'all failed validations leave saved document and revision history unchanged');
 const malformedId=uid(),bad={...structuredClone(good),id:malformedId,scenes:null};await db.query('INSERT INTO studio.drafts(id,owner_id,document) VALUES($1,$2,$3)',[malformedId,userId,bad]);
 const listed=await call('/api/studio/courses');ok(listed.status===200&&listed.body.items.some(x=>x.id===id&&!x.invalid)&&listed.body.items.some(x=>x.id===malformedId&&x.invalid),'one damaged course does not break the course list or other courses');
 const raw=await call('/api/studio/courses/'+malformedId);ok(raw.status===200&&!raw.body.validation.valid&&raw.body.document.scenes===null,'damaged stored document is returned intact with a validation report for private backup');
 const rejected=await call('/api/studio/courses/'+malformedId,{revision:1,document:{...good,id:malformedId}});ok(rejected.status===409&&rejected.body.error.code==='COURSE_REPAIR_REQUIRED','a damaged stored document cannot be silently overwritten');
 ok((await call('/api/studio/courses/'+malformedId)).body.document.scenes===null,'read and rejected save never rewrite damaged original');
 const nullId=uid();await db.query('INSERT INTO studio.drafts(id,owner_id,document) VALUES($1,$2,$3::jsonb)',[nullId,userId,'null']);ok((await call('/api/studio/courses')).status===200&&!(await call('/api/studio/courses/'+nullId)).body.validation.valid,'null stored document is isolated without an API crash');
 ok((await call('/api/studio/courses',[])).status===400,'nonobject write bodies are rejected before processing');
 const wrong={...good,id:uid()};ok((await call('/api/studio/courses/'+id,{revision:2,document:wrong})).status===400,'course identity cannot differ from the requested course');
 console.log(JSON.stringify({passed:checks,invalidCases:invalidCases.length,legacyCourses,syntheticDatabaseOnly:true}));
}finally{if(app)await new Promise(resolve=>app.server.close(resolve));await db.close();await rm(folder,{recursive:true,force:true});}
