import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.mjs';
import {seed,TEST_PASSWORD} from './fixtures.mjs';
import {createStudio} from './studio/backend.mjs';
import {createSessionTransport} from './public/session-recovery.mjs';
const db=new PGlite(),dir=await mkdtemp(join(tmpdir(),'webavr-session-test-')),origin='http://127.0.0.1:3998';await db.waitReady;await seed(db,new URL('./schema/',import.meta.url));const studio=await createStudio(db,{privateRoot:pathToFileURL(dir+'/')});const app=await createApp(db,{origin,secureCookies:false,mailer:async()=>{},studio,authLimit:1000,writeLimit:1000});let count=0;
function ok(value,label){assert.ok(value,label);console.log('PASS '+label);count++;}
async function login(name){const response=await app.dispatch({method:'POST',path:'/api/auth/login',headers:{origin,'content-type':'application/json'},body:{email:name+'@example.invalid',password:TEST_PASSWORD}});assert.equal(response.status,200);const cookie=response.headers['set-cookie'].split(';')[0];const session=await app.dispatch({path:'/api/auth/session',headers:{cookie}});return {cookie,...session.body};}
function client(session){
 const state={cookie:session.cookie,user:session.user,csrf:session.csrfToken,epoch:0,posts:0,refreshes:0,afterResponse:null};
 const transport=createSessionTransport({getUserId:()=>state.user?.id,getToken:()=>state.csrf,setToken:token=>{state.csrf=token;},getContextVersion:()=>state.epoch,fetchImpl:async(path,init)=>{
  const method=init.method??'GET';if(method==='POST')state.posts++;else if(path==='/api/auth/session')state.refreshes++;
  const response=await app.dispatch({method,path,headers:{...Object.fromEntries(new Headers(init.headers)),cookie:state.cookie,...(method==='POST'?{origin}:{})},body:init.body?JSON.parse(init.body):{}});
  if(state.afterResponse)await state.afterResponse({path,method,response});
  return new Response(JSON.stringify(response.body),{status:response.status,headers:response.headers});
 }});return {state,request:transport.request};
}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
try{
 const original=await login('teachera'),A=client(original);let result=await A.request('/api/studio/courses',post({title:'保留未儲存編輯'}));assert.equal(result.response.status,200);const course=result.data;
 ok(A.state.posts===1&&A.state.refreshes===0,'valid requests are sent once without refreshing');
 const rotated=await login('teachera');assert.notEqual(rotated.csrfToken,original.csrfToken);A.state.cookie=rotated.cookie;A.state.posts=0;
 result=await A.request('/api/studio/media-status',post({ids:[]}));ok(result.response.status===200&&A.state.refreshes===1&&A.state.posts===2,'opening course media recovers after another tab logs into the same account');
 A.state.cookie=(await login('teachera')).cookie;A.state.posts=0;A.state.refreshes=0;const draft=structuredClone(course.document);draft.title='尚未儲存的中文課程名稱';draft.description='保留輸入、地圖及活動';const encoded=JSON.stringify({revision:1,document:draft});
 result=await A.request('/api/studio/courses/'+course.id,{...post({}),body:encoded});ok(result.response.status===200&&result.data.revision===2&&result.data.document.title===draft.title&&A.state.posts===2&&A.state.refreshes===1,'draft saves once at the next revision after same-account recovery');
 ok(encoded===JSON.stringify({revision:1,document:draft}),'recovery preserves the submitted draft without mutating it');
 const revisions=await db.query('SELECT count(*)::int AS n FROM studio.revisions WHERE draft_id=$1',[course.id]);ok(revisions.rows[0].n===2,'rejected request and recovery do not create duplicate revisions');
 const createOld=client(await login('teachera'));createOld.state.cookie=(await login('teachera')).cookie;result=await createOld.request('/api/studio/courses',post({title:'只建立一份教材'}));const duplicates=await db.query("SELECT count(*)::int AS n FROM studio.drafts WHERE document->>'title'='只建立一份教材'");ok(result.response.status===200&&duplicates.rows[0].n===1,'new course creation is not duplicated during recovery');
 const wrong=client(await login('teachera')),oldToken=wrong.state.csrf;wrong.state.cookie=(await login('teacherb')).cookie;
 await assert.rejects(wrong.request('/api/studio/courses',post({title:'不能送到新帳號'})),e=>e.code==='SESSION_CHANGED');ok(wrong.state.posts===1&&wrong.state.csrf===oldToken,'another account is detected before replay or token replacement');
 const blocked=await db.query("SELECT count(*)::int AS n FROM studio.drafts WHERE document->>'title'='不能送到新帳號'");ok(blocked.rows[0].n===0,'stale form never creates data under the other account');
 const changed=client(await login('teachera'));changed.state.cookie=(await login('teachera')).cookie;changed.state.afterResponse=({path})=>{if(path==='/api/auth/session')changed.state.epoch++;};await assert.rejects(changed.request('/api/studio/media-status',post({ids:[]})),e=>e.code==='SESSION_CHANGED');ok(changed.state.posts===1,'local logout or identity-context changes cancel recovery');
 const expired=client(await login('teachera'));expired.state.cookie=(await login('teachera')).cookie;expired.state.afterResponse=({method,response})=>{if(method==='POST'&&response.status===403)expired.state.cookie='';};await assert.rejects(expired.request('/api/studio/media-status',post({ids:[]})),e=>e.code==='UNAUTHENTICATED');ok(expired.state.posts===1,'expired session during recovery is not replayed');
 const twice=client(await login('teachera'));twice.state.cookie=(await login('teachera')).cookie;const rotateAgain=await login('teachera');twice.state.afterResponse=({path})=>{if(path==='/api/auth/session')twice.state.cookie=rotateAgain.cookie;};result=await twice.request('/api/studio/media-status',post({ids:[]}));ok(result.response.status===403&&result.data.error.code==='CSRF_DENIED'&&twice.state.posts===2&&twice.state.refreshes===1,'a second CSRF rejection ends recovery without looping');
 const forbidden=client(await login('teachera'));result=await forbidden.request('/api/studio/sources/00000000-0000-0000-0000-000000000000',post({action:'copy'}));ok(result.response.status===403&&result.data.error.code==='FORBIDDEN'&&forbidden.state.posts===1&&forbidden.state.refreshes===0,'permission denials do not trigger recovery or extra submissions');
 const parallel=client(await login('teachera'));parallel.state.cookie=(await login('teachera')).cookie;let denied=0,release;const gate=new Promise(resolve=>{release=resolve;});parallel.state.afterResponse=async({path,method,response})=>{if(method==='POST'&&response.status===403){denied++;if(denied===2)release();}if(path==='/api/auth/session')await gate;};const results=await Promise.all([parallel.request('/api/studio/media-status',post({ids:[]})),parallel.request('/api/studio/media-status',post({ids:[]}))]);ok(results.every(x=>x.response.status===200)&&parallel.state.refreshes===1,'concurrent rejected requests share one session refresh');
 console.log(JSON.stringify({passed:count,scope:'Real isolated auth and studio API; synthetic accounts only'}));
}finally{await db.close();await rm(dir,{recursive:true,force:true});}
