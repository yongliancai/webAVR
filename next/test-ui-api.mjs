import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from './app.mjs';
import {seed,TEST_PASSWORD} from './fixtures.mjs';
const db=new PGlite();const report={scope:'UI supporting API and static HTTP boundaries; synthetic data only',checks:[]};let server,which='setup';
const check=async(name,fn)=>{which=name;await fn();report.checks.push({name,passed:true});};
try{
 const {ids}=await seed(db,new URL('./schema/',import.meta.url));const origin='https://webavr.example';const app=await createApp(db,{origin,mailer:async()=>{},webRoot:new URL('./public/',import.meta.url),authLimit:1000,writeLimit:1000});
 const call=(method,path,body={},user=null,extra={})=>app.dispatch({method,path,body,headers:{origin,'content-type':'application/json',...(user?{cookie:user.cookie,'x-csrf-token':user.csrf}:{}),...extra}});
 const clients={};for(const name of ['admin','teacherA','teacherB','studentS']){
  const login=await call('POST','/api/auth/login',{email:name.toLowerCase()+'@example.invalid',password:TEST_PASSWORD});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0];const session=await call('GET','/api/auth/session',{},null,{cookie});clients[name]={cookie,csrf:session.body.csrfToken};
 }
 const admin=clients.admin,A=clients.teacherA,B=clients.teacherB,S=clients.studentS;const reason={'x-audit-reason':'Synthetic interface verification'};
 await check('Admin directory requires role and explicit audit reason',async()=>{
  assert.equal((await call('GET','/api/admin/users',{},A,reason)).status,403);assert.equal((await call('GET','/api/admin/users',{},admin)).status,400);
  const r=await call('GET','/api/admin/users?limit=100',{},admin,reason);assert.equal(r.status,200);assert.equal(r.body.items.length,11);
  for(const u of r.body.items){assert(!Object.hasOwn(u,'password_hash'));assert(!Object.hasOwn(u,'source_path'));assert(Array.isArray(u.roles));}
 });
 await check('Directory substring search treats percent as literal and paginates',async()=>{
  const one=await call('GET','/api/admin/users?q=students%40example.invalid',{},admin,reason);assert.equal(one.body.items.length,1);assert.equal(one.body.items[0].id,ids.studentS);
  const empty=await call('GET','/api/admin/users?q=%25',{},admin,reason);assert.equal(empty.body.items.length,0);
  const first=await call('GET','/api/admin/users?limit=1',{},admin,reason);const second=await call('GET','/api/admin/users?limit=1&after='+first.body.nextCursor,{},admin,reason);assert.notEqual(first.body.items[0].id,second.body.items[0].id);
 });
 await check('Unicode audit reasons use ASCII transport and persist decoded text',async()=>{
  const reason='核對本機帳號與歷史資料';const r=await call('GET','/api/admin/users?limit=1',{},admin,{'x-audit-reason':'utf8:'+encodeURIComponent(reason)});assert.equal(r.status,200);
  const saved=await db.query("SELECT 1 FROM auth_private.audit_events WHERE action='user.directory' AND reason=$1",[reason]);assert.equal(saved.rows.length,1);
  assert.equal((await call('GET','/api/admin/users',{},admin,{'x-audit-reason':'utf8:%E0%A4%A'})).status,400);
 });
 await check('Directory exposes pending conflict status without granting activation',async()=>{
  const r=await call('GET','/api/admin/users?q=unresolved%40example.invalid',{},admin,reason);assert.equal(r.body.items[0].needs_identity_review,true);assert.equal(r.body.items[0].activation_approved,false);
 });
 await check('Admin class directory is restricted and retains historical course references',async()=>{
  assert.equal((await call('GET','/api/admin/classes',{},A,reason)).status,403);
  await db.query("UPDATE webavr.course_classes SET unlinked_at='2024-01-01Z' WHERE id=$1",[ids.ccA]);
  const r=await call('GET','/api/admin/classes',{},admin,reason);assert.equal(r.status,200);assert.equal(r.body.items.find(x=>x.id===ids.classA).courses.length,1);
  await db.query('UPDATE webavr.course_classes SET unlinked_at=NULL WHERE id=$1',[ids.ccA]);
 });
 await check('Roster limited to current teacher or audited admin, no student emails returned',async()=>{
  const r=await call('GET',`/api/classes/${ids.classA}/members`,{},A);assert.equal(r.status,200);assert.equal(r.body.items.length,3);
  assert(r.body.items.every(x=>!Object.hasOwn(x,'email')));assert.equal((await call('GET',`/api/classes/${ids.classA}/members`,{},B)).status,403);
  assert.equal((await call('GET',`/api/classes/${ids.classA}/members`,{},S)).status,403);
  assert.equal((await call('GET',`/api/classes/${ids.classA}/members`,{},admin)).status,400);
 });
 await check('Email enrollment accepts only active student in authorized class',async()=>{
  const path=`/api/classes/${ids.classA}/members`;const body={studentEmail:'outsider@example.invalid',role:'student'};
  assert.equal((await call('POST',path,body,A)).status,201);assert.equal((await call('POST',path,body,A)).status,409);
  assert.equal((await call('POST',`/api/classes/${ids.classB}/members`,{studentEmail:'studentt@example.invalid',role:'student'},A)).status,403);
  for(const address of ['absent@example.invalid','pending@example.invalid','teachera@example.invalid'])assert.equal((await call('POST',path,{studentEmail:address,role:'student'},A)).status,404);
 });
 await check('Email enrollment rejects role elevation and ambiguous target fields',async()=>{
  const path=`/api/classes/${ids.classA}/members`;
  assert.equal((await call('POST',path,{studentEmail:'teacherb@example.invalid',role:'teacher'},admin)).status,400);
  assert.equal((await call('POST',path,{studentEmail:'students@example.invalid',userId:ids.admin,role:'student'},A)).status,400);
 });
 await check('New membership does not expose historical event before enrollment',async()=>{
  const r=await call('GET',`/api/classes/${ids.classA}/history`,{},A);assert.equal(r.body.items.length,2);assert(!r.body.items.some(x=>x.learnerId===ids.outsider));
 });
 await check('History labels come from authorized server records',async()=>{
  const r=await call('GET','/api/me/history',{},S);assert.equal(r.body.items.length,2);assert(r.body.items.every(x=>x.learnerName==='同學 S'&&x.className&&x.courseTitle));
 });
 await check('Conversation directory hides private and cross-class threads',async()=>{
  const a=await call('GET','/api/conversations',{},A);assert.deepEqual(a.body.items.map(x=>x.id),[ids.supportA]);
  const b=await call('GET','/api/conversations',{},B);assert.deepEqual(b.body.items.map(x=>x.id),[ids.supportB]);
  assert.equal((await call('GET','/api/conversations',{},S)).body.items.length,3);assert.equal((await call('GET','/api/conversations',{},admin)).status,400);
  assert.equal((await call('GET','/api/conversations',{},admin,reason)).body.items.length,3);
 });
 await check('Directory and roster reads leave audit records',async()=>{
  const r=await db.query("SELECT DISTINCT action FROM auth_private.audit_events WHERE outcome='allowed'");const actions=r.rows.map(x=>x.action);
  for(const action of ['class.roster','class.directory','user.directory','conversation.list'])assert(actions.includes(action));
 });
 await check('Frontend uses text DOM and does not persist authentication in web storage',async()=>{
  const js=await readFile(new URL('./public/app.js',import.meta.url),'utf8'),recovery=await readFile(new URL('./public/session-recovery.mjs',import.meta.url),'utf8');assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage/.test(js+recovery));
  assert(js.includes('history.replaceState(null,\'\',location.pathname)'));assert(recovery.includes("credentials:'same-origin'"));
 });
 server=app.server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
 await check('Frontend static routes are served with CSP and no-store',async()=>{
  for(const path of ['/','/activate','/reset','/app.js','/app.css','/session-recovery.mjs']){const r=await fetch(base+path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert(r.headers.get('content-security-policy').includes("script-src 'self'"));assert(!r.headers.get('content-security-policy').includes('unsafe-inline'));}
 });
 await check('Main interface loads the session recovery module',async()=>{const r=await fetch(base+'/');const html=await r.text();assert(html.includes('type="module" src="/app.js"'));const helper=await fetch(base+'/session-recovery.mjs');assert(helper.headers.get('content-type').includes('javascript'));assert((await helper.text()).includes('createSessionTransport'));});
 await check('Static handler cannot serve server sources, schemas, mailbox or parent files',async()=>{
  for(const path of ['/app.mjs','/package.json','/schema/webavr-schema-v1.sql','/private-demo/mailbox.jsonl','/%2e%2e/package.json','/..%2Fapp.mjs']){
   const r=await fetch(base+path);assert.notEqual(r.status,200);assert(!(await r.text()).includes('CREATE TABLE'));
  }
 });
 await check('HEAD requests omit page body and public health does not list users',async()=>{
  const r=await fetch(base+'/',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');
  const h=await fetch(base+'/api/health');assert.deepEqual(await h.json(),{status:'local-prototype'});
 });
 report.status='passed';report.passed=report.checks.length;
}catch(e){report.status='failed';report.failed_check=which;report.error_code=e.code??e.name;console.error(JSON.stringify({failed:which,code:e.code??e.name}));process.exitCode=1;}
finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();await writeFile(new URL('./ui-api-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
