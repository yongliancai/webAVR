import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';import sharp from 'sharp';
import {seed,TEST_PASSWORD} from './fixtures.mjs';import {createApp} from './app.mjs';import {createStudio} from './studio/backend.mjs';import {inspectCourse} from './public/course-schema.mjs';
const dir=await mkdtemp(join(tmpdir(),'wa-learn-test-')),db=new PGlite();await db.waitReady;const {ids}=await seed(db,new URL('./schema/',import.meta.url)),studio=await createStudio(db,{privateRoot:pathToFileURL(dir+'/')}),origin='http://127.0.0.1:3994',app=await createApp(db,{origin,secureCookies:false,mailer:async()=>{},studio,authLimit:100,writeLimit:1000,webRoot:new URL('./public/',import.meta.url)});
let count=0;function ok(v,name){assert.ok(v,name);count++;console.log('PASS '+name);}
async function login(name){const r=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:name+'@example.invalid',password:TEST_PASSWORD}});assert.equal(r.status,200);const cookie=r.headers['set-cookie'].split(';')[0],s=await app.dispatch({path:'/api/auth/session',headers:{cookie}});return {cookie,origin,'x-csrf-token':s.body.csrfToken,'content-type':'application/json'};}
const call=async(headers,path,body)=>{const r=await app.dispatch({method:body===undefined?'GET':'POST',path,headers,body});if(r.stream){let buffers=[];for await(const b of r.stream())buffers.push(b);r.binary=Buffer.concat(buffers);}return r;};
try{
 const a=await login('teachera'),b=await login('teacherb'),s=await login('students'),t=await login('studentt'),outsider=await login('outsider');
 ok((await call({},'/api/learn/courses')).status===401,'anonymous cannot list lessons');
 ok((await call(s,'/api/learn/courses')).body.items.length===0,'unpublished drafts are not student courses');
 const created=(await call(a,'/api/studio/courses',{title:'測試探索教材'})).body,course=created.document,scene=randomUUID(),hotspot=randomUUID();const image=await sharp({create:{width:1600,height:800,channels:3,background:'#76a893'}}).jpeg().toBuffer(),media=(await call(a,'/api/studio/media',{name:'synthetic.jpg',data:image.toString('base64')})).body;
 course.coverAssetId=media.id;course.source={sourcePath:'/private-source'};course.scenes=[{id:scene,title:'測試場景',assetId:media.id,projection:'equirectangular',hotspots:[{id:hotspot,kind:'info',title:'原知識點',content:'保留內容',pitch:0,yaw:0,source:{sourcePath:'/private-activity'},payload:{privateNote:'never send to students'}}]}];course.maps=[{id:randomUUID(),title:'原地圖',assetId:media.id,markers:[{id:randomUUID(),title:'原標記',x:.5,y:.5,targetSceneId:scene}]}];
 ok((await call(a,'/api/studio/courses/'+created.id,{revision:1,document:course})).status===200,'teacher draft and original media saved');
 ok((await call(a,'/api/learn/courses')).body.items[0].preview,'owner can try student interface privately');
 ok((await call(s,'/api/learn/courses/'+created.id)).status===404,'student cannot read private draft by ID');
 ok((await call(b,'/api/learn/courses/'+created.id)).status===404,'other teacher cannot preview private draft');
 ok((await call(a,'/api/studio/teaching-classes')).body.items.every(c=>c.id===ids.classA),'teacher only chooses currently taught classes');
 const endpoint='/api/studio/courses/'+created.id+'/class-lessons';
 ok((await call(s,endpoint,{classId:ids.classA,revision:2,active:true})).status===403,'student cannot share a teacher draft');
 ok((await call(b,endpoint,{classId:ids.classB,revision:2,active:true})).status===404,'nonowner cannot share draft');
 ok((await call(a,endpoint,{classId:ids.classB,revision:2,active:true})).status===403,'teacher cannot share into another class');
 ok((await call(a,endpoint,{classId:ids.classA,revision:1,active:true})).status===409,'stale share revision rejected');
 ok((await call({...a,'x-csrf-token':''},endpoint,{classId:ids.classA,revision:2,active:true})).status===403,'sharing requires CSRF token');
 const shared=(await call(a,endpoint,{classId:ids.classA,revision:2,active:true})).body,base='/api/learn/courses/'+shared.id;
 ok(!!shared.id,'teacher explicitly shares saved snapshot');
 ok((await call(a,endpoint,{classId:ids.classA,revision:2,active:true})).body.id===shared.id,'share retry does not duplicate course');
 const listed=(await call(s,'/api/learn/courses')).body.items;
 ok(listed.length===1&&!listed[0].preview&&!listed[0].invalid,'student sees one valid class lesson');
 ok((await call(t,base)).status===200,'second member of same class may explore');
 ok((await call(outsider,base)).status===404,'other class cannot read lesson');
 const clean=(await call(s,base)).body.document;
 ok(inspectCourse(clean).valid,'student projection remains a valid teaching document');
 ok(!JSON.stringify(clean).includes('private-activity')&&!JSON.stringify(clean).includes('privateNote'),'private provenance and unknown payload fields are not delivered');
 ok(clean.scenes[0].hotspots[0].content==='保留內容'&&clean.maps[0].markers[0].x===.5,'original activities and map coordinates preserved');
 ok((await call(s,base+'/media-status')).body.items.some(m=>m.id===media.id&&m.state==='ready'),'only lesson-scoped media status returned');
 ok((await call(s,base+'/media/'+media.id+'/thumbnail')).binary.length>0,'student can load authorized thumbnail');
 ok((await call(s,base+'/media/'+media.id+'/panorama-2048')).binary.length>0,'student can load authorized panorama');
 ok((await call(outsider,base+'/media/'+media.id+'/thumbnail')).status===404,'unrelated student cannot retrieve thumbnail');
 ok((await call(s,base+'/media/'+randomUUID()+'/thumbnail')).status===404,'guessed media outside lesson rejected');
 ok((await call(s,'/api/studio/media/'+media.id+'/thumbnail')).status===403,'student does not gain teacher media access');
 course.title='尚未提供的新版';await call(a,'/api/studio/courses/'+created.id,{revision:2,document:course});
 ok((await call(s,base)).body.document.title==='測試探索教材','later private edits do not alter class snapshot');
 ok((await call(a,endpoint,{classId:ids.classA,revision:3,active:true})).body.revision===3&&(await call(s,base)).body.document.title==='尚未提供的新版','explicit update changes class snapshot');
 await db.query('UPDATE webavr.class_memberships SET left_at=now() WHERE class_id=$1 AND user_id=$2',[ids.classA,ids.studentT]);
 ok((await call(t,base)).status===404,'leaving class immediately removes document access');
 ok((await call(t,base+'/media/'+media.id+'/thumbnail')).status===404,'leaving class immediately removes media access');
 await db.query("UPDATE webavr.user_roles SET revoked_at=now() WHERE user_id=$1 AND role='student'",[ids.studentS]);
 ok((await call(s,base)).status===404,'revoked student role no longer opens class lessons');
 await db.query("UPDATE webavr.user_roles SET revoked_at=NULL WHERE user_id=$1 AND role='student'",[ids.studentS]);
 await db.query("UPDATE webavr.classes SET state='archived' WHERE id=$1",[ids.classA]);
 ok((await call(s,base)).status===404,'archived class cannot open lessons');
 await db.query("UPDATE webavr.classes SET state='active' WHERE id=$1",[ids.classA]);
 await call(a,endpoint,{classId:ids.classA,revision:3,active:false});
 ok((await call(s,'/api/learn/courses')).body.items.length===0&&(await call(s,base)).status===404,'withdrawn lesson disappears and cannot reopen');
 ok((await db.query('SELECT count(*)::int AS n FROM studio.revisions WHERE draft_id=$1',[created.id])).rows[0].n===3,'sharing never changes draft history');

 const admin=await login('admin'),audioId=randomUUID(),archiveId=randomUUID();await mkdir(join(dir,'source-media/originals'),{recursive:true});
 for(const [id,kind] of [[audioId,'audio'],[archiveId,'archive']]){await writeFile(join(dir,'source-media/originals',id+'.bin'),Buffer.from('RIFF-test-only-audio'));await db.query('INSERT INTO studio.course_files VALUES($1,$2,$3,$4,$5,$6,$7)',[id,id+'.bin',kind==='audio'?'audio/wav':'application/zip',kind,20,'a'.repeat(64),'synthetic']);}
 const adminCourse=(await call(admin,'/api/studio/courses',{title:'來源影音測試'})).body;adminCourse.document.scenes=[{id:randomUUID(),title:'聲音場景',assetId:null,projection:'unknown',hotspots:[{id:randomUUID(),kind:'audio',title:'原音訊',content:'音訊保留',pitch:0,yaw:0,assetIds:[audioId,archiveId]}]}];const audioSave=await call(admin,'/api/studio/courses/'+adminCourse.id,{revision:1,document:adminCourse.document});assert.equal(audioSave.status,200,JSON.stringify(audioSave.body));const audioLesson=(await call(admin,'/api/studio/courses/'+adminCourse.id+'/class-lessons',{classId:ids.classA,revision:2,active:true})).body,audioBase='/api/learn/courses/'+audioLesson.id;
 const audioResponse=await call(s,audioBase+'/files/'+audioId);assert.equal(audioResponse.status,200,JSON.stringify(audioResponse.body));ok(audioResponse.binary?.length>0,'student can retrieve referenced source audio');
 const range=await call({...s,range:'bytes=0-3'},audioBase+'/files/'+audioId);ok(range.status===206&&range.binary.toString()==='RIFF','student audio supports byte-range streaming');
 ok((await call(outsider,audioBase+'/files/'+audioId)).status===404,'another class cannot download source audio');
 ok((await call(s,audioBase+'/files/'+archiveId)).status===404,'raw source archives are not exposed through student audio endpoint');
 ok((await call(s,base+'/media/'+media.id+'/original')).status===404,'student cannot use an unlisted original-image endpoint');
 console.log(JSON.stringify({passed:count,syntheticOnly:true}));
}finally{await db.close();await rm(dir,{recursive:true,force:true});}
