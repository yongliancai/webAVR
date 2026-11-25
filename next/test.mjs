import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApp,RateLimiter} from './app.mjs';
import {seed,TEST_PASSWORD} from './fixtures.mjs';

const db=new PGlite();const report={scope:'Local synthetic accounts only; PGlite single connection; no real emails or production server',checks:[]};
let which='setup';const check=async(name,fn)=>{which=name;await fn();report.checks.push({name,passed:true});console.log(JSON.stringify({check:name,passed:true}));};
let server;
try{
 const {ids}=await seed(db,new URL('./schema/',import.meta.url));
 const outbox=[];const origin='https://webavr.example';const app=await createApp(db,{origin,mailer:async m=>outbox.push(m),authLimit:1000,requestLimit:1000,writeLimit:1000});
 const send=(method,path,body={},client=null,extra={})=>app.dispatch({method,path,body,headers:{origin,'content-type':'application/json',...(client?{cookie:client.cookie,'x-csrf-token':client.csrf}:{}),...extra}});
 const query=(s,p=[])=>db.query(s,p);const scalar=async(s,p=[])=>Number(Object.values((await query(s,p)).rows[0])[0]);
 const clients={};
 async function login(name,pass=TEST_PASSWORD){
  const r=await send('POST','/api/auth/login',{email:name.toLowerCase()+'@example.invalid',password:pass});assert.equal(r.status,200);
  const cookie=r.headers['set-cookie'].split(';')[0];const s=await send('GET','/api/auth/session',{},null,{cookie});assert.equal(s.status,200);
  return {cookie,csrf:s.body.csrfToken};
 }
 for(const name of ['admin','teacherA','teacherB','formerTeacher','studentS','studentT','outsider'])clients[name]=await login(name);
 const admin=clients.admin,S=clients.studentS,A=clients.teacherA,B=clients.teacherB;
 const tokenFor=address=>new URLSearchParams(new URL(outbox.findLast(x=>x.to===address).url).hash.slice(1)).get('token');
 function review(name,scope='private',suffix='A',decision='verified'){
  return {subjectUserId:ids.studentS,scope,courseId:scope==='learning'?ids['course'+suffix]:null,classId:scope==='learning'?ids['class'+suffix]:null,
   occurredAt:scope==='learning'?'2025-01-15T00:00:00Z':null,decision,reason:'Synthetic evidence verified',requestId:randomUUID()};
 }
 await check('Unauthenticated history denied',async()=>assert.equal((await send('GET','/api/me/history')).status,401));
 await check('HTTP-only Secure host cookie and no session token in body',async()=>{
  const r=await send('POST','/api/auth/login',{email:'students@example.invalid',password:TEST_PASSWORD});
  assert.equal(r.status,200);for(const x of ['__Host-webavr_session=','HttpOnly','Secure','SameSite=Strict','Path=/'])assert(r.headers['set-cookie'].includes(x));
  assert.deepEqual(r.body,{status:'authenticated'});assert.equal(r.headers['cache-control'],'no-store');
 });
 await check('Unknown and wrong credentials use identical response',async()=>{
  const a=await send('POST','/api/auth/login',{email:'missing@example.invalid',password:'bad'});const b=await send('POST','/api/auth/login',{email:'students@example.invalid',password:'bad'});
  assert.equal(a.status,401);assert.equal(b.status,401);assert.equal(a.body.error.code,b.body.error.code);
 });
 await check('Pending, disabled and needs-review accounts cannot login',async()=>{
  for(const email of ['pending','disabled','review'])assert.equal((await send('POST','/api/auth/login',{email:email+'@example.invalid',password:TEST_PASSWORD})).status,401);
 });
 await check('Cross origin and missing origin mutations denied',async()=>{
  assert.equal((await send('POST','/api/classes',{name:'No'},A,{origin:'https://other.invalid'})).status,403);
  assert.equal((await app.dispatch({method:'POST',path:'/api/auth/login',headers:{'content-type':'application/json'},body:{email:'students@example.invalid',password:TEST_PASSWORD}})).status,403);
 });
 await check('CSRF missing or malformed denied without internal errors',async()=>{
  for(const csrf of ['', 'x', '你'.repeat(64)])assert.equal((await send('POST','/api/classes',{name:'No'},A,{'x-csrf-token':csrf})).status,403);
 });
 await check('Role or owner mass assignment rejected',async()=>{
  assert.equal((await send('POST','/api/classes',{name:'No',role:'admin',ownerId:ids.admin},S)).status,400);
  assert.equal((await send('POST','/api/classes',{name:'No'},S)).status,403);
  assert.equal((await send('POST','/api/auth/login',{email:'students@example.invalid',password:TEST_PASSWORD,userId:ids.admin})).status,400);
 });
 await check('Student sees both classes and only own learning history',async()=>{
  const c=await send('GET','/api/me/classes',{},S);assert.equal(c.body.items.length,2);
  const h=await send('GET','/api/me/history',{},S);assert.equal(h.body.items.length,2);assert(h.body.items.every(x=>x.learnerId===ids.studentS));
 });
 await check('Teacher A reads only historically enrolled A learners',async()=>{
  const r=await send('GET',`/api/classes/${ids.classA}/history`,{},A);assert.equal(r.status,200);assert.equal(r.body.items.length,2);
  assert(r.body.items.every(x=>x.classId===ids.classA&&x.learnerId!==ids.outsider));
 });
 await check('Teacher B and former teacher cannot read A class',async()=>{
  for(const client of [B,clients.formerTeacher,clients.outsider])assert.equal((await send('GET',`/api/classes/${ids.classA}/history`,{},client)).status,403);
 });
 await check('Current teacher cannot use caller-supplied class or user overrides',async()=>{
  assert.equal((await send('GET',`/api/classes/${ids.classA}/history?classId=${ids.classB}`,{},A)).status,400);
  assert.equal((await send('GET',`/api/me/history?userId=${ids.studentT}`,{},S)).status,400);
 });
 await check('Historical enrollment retained after student leaves',async()=>{
  await query('UPDATE webavr.class_memberships SET left_at=now() WHERE id=$1',[ids.memberstudentTA]);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/history`,{},A)).body.items.length,2);
 });
 await check('Revoked teacher role takes effect on existing session',async()=>{
  await query("UPDATE webavr.user_roles SET revoked_at=now() WHERE user_id=$1 AND role='teacher'",[ids.teacherA]);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/history`,{},A)).status,403);
  await query("UPDATE webavr.user_roles SET revoked_at=NULL WHERE user_id=$1 AND role='teacher'",[ids.teacherA]);
 });
 await check('Disabled account immediately loses existing session access',async()=>{
  await query("UPDATE webavr.users SET state='disabled' WHERE id=$1",[ids.outsider]);assert.equal((await send('GET','/api/auth/session',{},clients.outsider)).status,401);
  await query("UPDATE webavr.users SET state='active' WHERE id=$1",[ids.outsider]);
 });
 await check('Class or course relation ended before event prevents teacher read',async()=>{
  await query("UPDATE webavr.course_classes SET unlinked_at='2024-01-01Z' WHERE id=$1",[ids.ccA]);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/history`,{},A)).body.items.length,0);
  await query('UPDATE webavr.course_classes SET unlinked_at=NULL WHERE id=$1',[ids.ccA]);
 });
 await check('Private conversation denied to teacher and other learner',async()=>{
  for(const c of [A,B,clients.studentT])assert.equal((await send('GET',`/api/conversations/${ids.private}/messages`,{},c)).status,404);
  assert.equal((await send('GET',`/api/conversations/${ids.private}/messages`,{},S)).body.items.length,1);
 });
 await check('Course-support conversation uses its stored class context',async()=>{
  assert.equal((await send('GET',`/api/conversations/${ids.supportA}/messages`,{},A)).status,200);
  assert.equal((await send('GET',`/api/conversations/${ids.supportA}/messages`,{},B)).status,404);
  assert.equal((await send('GET',`/api/conversations/${ids.supportB}/messages`,{},A)).status,404);
  for(const date of ['2024-01-01T00:00:00Z','2027-01-01T00:00:00Z'])await query("INSERT INTO webavr.messages(id,conversation_id,role,content,request_id,created_at) VALUES($1,$2,'assistant','Synthetic ordered message',$3,$4)",[randomUUID(),ids.supportA,randomUUID(),date]);
  const first=await send('GET',`/api/conversations/${ids.supportA}/messages?limit=1`,{},A);assert.equal(new Date(first.body.items[0].created_at).getUTCFullYear(),2024);
  const next=await send('GET',`/api/conversations/${ids.supportA}/messages?limit=1&after=${first.body.nextCursor}`,{},A);assert.notEqual(next.body.items[0].id,first.body.items[0].id);
  assert.equal((await send('GET',`/api/conversations/${ids.supportA}/messages?after=${ids.messageprivate}`,{},A)).status,400);
 });
 await check('Unresolved archives hidden despite provisional subject ID',async()=>{
  assert.equal((await send('GET','/api/me/archives',{},S)).body.items.length,0);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/archives`,{},A)).body.items.length,0);
 });
 await check('Admin archive reads require reason and produce audit',async()=>{
  assert.equal((await send('GET','/api/admin/archives',{},admin)).status,400);
  assert.equal((await send('GET','/api/admin/archives',{},A,{'x-audit-reason':'Synthetic read'})).status,403);
  const n=await scalar("SELECT count(*) FROM auth_private.audit_events WHERE action='archive.read'");
  const r=await send('GET','/api/admin/archives',{},admin,{'x-audit-reason':'Synthetic read'});assert.equal(r.status,200);assert.equal(r.body.items.length,6);
  assert.equal(await scalar("SELECT count(*) FROM auth_private.audit_events WHERE action='archive.read'"),n+1);
 });
 await check('Only admin can approve archive attribution',async()=>assert.equal((await send('POST',`/api/admin/archives/${ids.oldPrivate}/reviews`,review('oldPrivate'),A)).status,403));
 const privateReview=review('oldPrivate');
 await check('Verified private history visible only to its owner',async()=>{
  assert.equal((await send('POST',`/api/admin/archives/${ids.oldPrivate}/reviews`,privateReview,admin)).status,200);
  assert.equal((await send('GET','/api/me/archives',{},S)).body.items.length,1);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/archives`,{},A)).body.items.length,0);
  assert.equal((await send('GET','/api/me/archives',{},clients.studentT)).body.items.length,0);
 });
 await check('Old private chats cannot be relabeled as class learning',async()=>assert.equal((await send('POST',`/api/admin/archives/${ids.oldPrivate}/reviews`,review('oldPrivate','learning'),admin)).status,409));
 await check('Question-definition archives cannot be delegated to student API',async()=>assert.equal((await send('POST',`/api/admin/archives/${ids.oldQuestion}/reviews`,review('oldQuestion'),admin)).status,409));
 const eventReview=review('oldA','learning');
 await check('Verified class archive remains isolated from other class teacher',async()=>{
  assert.equal((await send('POST',`/api/admin/archives/${ids.oldA}/reviews`,eventReview,admin)).status,200);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/archives`,{},A)).body.items.length,1);
  assert.equal((await send('GET',`/api/classes/${ids.classB}/archives`,{},B)).body.items.length,0);
 });
 await check('Reviews require timezone and historically valid class context',async()=>{
  const r=review('oldB','learning');r.occurredAt='2025-01-15 08:00:00';assert.equal((await send('POST',`/api/admin/archives/${ids.oldB}/reviews`,r,admin)).status,400);
  r.occurredAt='2025-02-30T00:00:00Z';assert.equal((await send('POST',`/api/admin/archives/${ids.oldB}/reviews`,r,admin)).status,400);
  r.occurredAt='2010-01-01T00:00:00Z';assert.equal((await send('POST',`/api/admin/archives/${ids.oldB}/reviews`,r,admin)).status,409);
 });
 await check('Review request ID is idempotent and rejects changed payload',async()=>{
  const n=await scalar('SELECT count(*) FROM migration_private.archive_reviews');assert.equal((await send('POST',`/api/admin/archives/${ids.oldA}/reviews`,eventReview,admin)).status,200);
  assert.equal(await scalar('SELECT count(*) FROM migration_private.archive_reviews'),n);
  assert.equal((await send('POST',`/api/admin/archives/${ids.oldA}/reviews`,{...eventReview,reason:'Changed synthetic reason'},admin)).status,409);
 });
 await check('Latest withheld review removes access without rewriting history',async()=>{
  const r=review('oldA','learning','A','withheld');assert.equal((await send('POST',`/api/admin/archives/${ids.oldA}/reviews`,r,admin)).status,200);
  assert.equal((await send('GET',`/api/classes/${ids.classA}/archives`,{},A)).body.items.length,0);
  assert.equal(await scalar('SELECT count(*) FROM migration_private.archive_reviews WHERE archive_id=$1',[ids.oldA]),2);
 });
 await check('Identity confidence withdrawal hides previously approved personal archives',async()=>{
  const id=randomUUID();await query("INSERT INTO migration_private.identity_map(id,source_record_id,legacy_subject,user_id,confidence) VALUES($1,$2,'synthetic-withdrawal',$3,'unresolved')",[id,ids.sourceoldUnknown,ids.studentS]);
  assert.equal((await send('GET','/api/me/archives',{},S)).body.items.length,0);
  await query("UPDATE migration_private.identity_map SET confidence='verified' WHERE id=$1",[id]);
  assert.equal((await send('GET','/api/me/archives',{},S)).body.items.length,1);
  await query('DELETE FROM migration_private.identity_map WHERE id=$1',[id]);
 });
 await check('Archive review and approval evidence cannot be rewritten',async()=>{
  let code;try{await query('UPDATE migration_private.archive_reviews SET reason=reason WHERE archive_id=$1',[ids.oldPrivate]);}catch(e){code=e.code;}
  assert.equal(code,'23514');
 });
 await check('Deduplicated archive sources not repeated in personal list',async()=>{
  assert.equal((await send('POST',`/api/admin/archives/${ids.oldDuplicate}/reviews`,review('oldDuplicate','learning'),admin)).status,200);
  const r=await send('GET','/api/me/archives',{},S);assert(!r.body.items.some(x=>x.id===ids.oldDuplicate));
 });
 await check('Pagination limits and malformed cursor rejected',async()=>{
  for(const tail of ['?limit=101','?limit=0','?after=bad','?limit=1&limit=2'])assert.equal((await send('GET','/api/me/history'+tail,{},S)).status,400);
  const r=await send('GET','/api/me/history?limit=1',{},S);assert.equal(r.body.items.length,1);assert(r.body.nextCursor);
  const next=await send('GET','/api/me/history?limit=1&after='+r.body.nextCursor,{},S);assert.equal(next.body.items.length,1);assert.notEqual(next.body.items[0].id,r.body.items[0].id);
 });
 await check('Teacher cannot grant teacher membership or enter another class',async()=>{
  assert.equal((await send('POST',`/api/classes/${ids.classA}/members`,{userId:ids.teacherB,role:'teacher'},A)).status,403);
  assert.equal((await send('POST',`/api/classes/${ids.classB}/members`,{userId:ids.studentT,role:'student'},A)).status,403);
 });
 await check('Concurrent membership creation cannot duplicate open relationship',async()=>{
  const r=await Promise.all([1,2].map(()=>send('POST',`/api/classes/${ids.classA}/members`,{userId:ids.outsider,role:'student'},A)));
  assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(await scalar("SELECT count(*) FROM webavr.class_memberships WHERE class_id=$1 AND user_id=$2 AND left_at IS NULL",[ids.classA,ids.outsider]),1);
 });
 await check('Activation responses do not disclose account existence or approval',async()=>{
  const n=outbox.length;const x=await send('POST','/api/auth/activation-request',{email:'pending@example.invalid'});const y=await send('POST','/api/auth/activation-request',{email:'absent@example.invalid'});
  assert.equal(x.status,202);assert.equal(y.status,202);assert.deepEqual(x.body,y.body);assert.equal(outbox.length,n);
 });
 await check('Unresolved migrated identity cannot be approved or mailed',async()=>{
  assert.equal((await send('POST','/api/admin/activation-approvals',{userId:ids.unresolved,evidenceRef:'Synthetic evidence',reason:'Synthetic identity review'},admin)).status,409);
  const n=outbox.length;await send('POST','/api/auth/activation-request',{email:'unresolved@example.invalid'});assert.equal(outbox.length,n);
 });
 await check('Non-admin cannot approve activation',async()=>assert.equal((await send('POST','/api/admin/activation-approvals',{userId:ids.pending,evidenceRef:'Synthetic',reason:'Synthetic'},A)).status,403));
 await check('Admin-approved pending account receives only a private mail-sink token',async()=>{
  assert.equal((await send('POST','/api/admin/activation-approvals',{userId:ids.pending,evidenceRef:'Synthetic fixture identity',reason:'Synthetic approved account'},admin)).status,200);
  const r=await send('POST','/api/auth/activation-request',{email:'pending@example.invalid'});assert.equal(r.status,202);assert.deepEqual(r.body,{status:'accepted'});
  const raw=tokenFor('pending@example.invalid');const row=(await query("SELECT token_hash FROM auth_private.tokens WHERE user_id=$1 AND revoked_at IS NULL",[ids.pending])).rows[0];
  assert.notEqual(row.token_hash,raw);assert.equal(row.token_hash,createHash('sha256').update(raw).digest('hex'));
  assert(outbox.at(-1).url.startsWith(origin+'/activate#token='));
 });
 await check('Purpose mismatch and invalid token cannot activate account',async()=>{
  assert.equal((await send('POST','/api/auth/password-reset-confirm',{token:tokenFor('pending@example.invalid'),password:TEST_PASSWORD})).status,400);
  assert.equal((await send('POST','/api/auth/activation-confirm',{token:'x'.repeat(43),password:TEST_PASSWORD})).status,400);
 });
 await check('Weak password rejected without consuming activation token',async()=>{
  assert.equal((await send('POST','/api/auth/activation-confirm',{token:tokenFor('pending@example.invalid'),password:'short'})).status,400);
  assert.equal((await send('POST','/api/auth/activation-confirm',{token:tokenFor('pending@example.invalid'),password:'a'.repeat(14)})).status,400);
  assert.equal(await scalar('SELECT count(*) FROM auth_private.tokens WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[ids.pending]),1);
 });
 await check('Parallel reuse of activation token succeeds exactly once',async()=>{
  const token=tokenFor('pending@example.invalid');const r=await Promise.all([1,2].map(()=>send('POST','/api/auth/activation-confirm',{token,password:TEST_PASSWORD})));
  assert.deepEqual(r.map(x=>x.status).sort(),[200,400]);
  const u=(await query('SELECT state,email_verified_at FROM webavr.users WHERE id=$1',[ids.pending])).rows[0];assert.equal(u.state,'active');assert(u.email_verified_at);
  const h=(await query('SELECT password_hash FROM auth_private.credentials WHERE user_id=$1',[ids.pending])).rows[0].password_hash;
  assert.match(h,/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);assert(!h.includes(TEST_PASSWORD));
 });
 await check('Activation does not auto-login and token cannot be reused',async()=>{
  assert.equal((await send('POST','/api/auth/activation-confirm',{token:tokenFor('pending@example.invalid'),password:TEST_PASSWORD})).status,400);
  clients.pending=await login('pending');assert(clients.pending.cookie);
 });
 await check('Expired or revoked reset tokens rejected',async()=>{
  await send('POST','/api/auth/password-reset-request',{email:'students@example.invalid'});const expired=tokenFor('students@example.invalid');
  await query("UPDATE auth_private.tokens SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 minute' WHERE user_id=$1 AND revoked_at IS NULL",[ids.studentS]);
  assert.equal((await send('POST','/api/auth/password-reset-confirm',{token:expired,password:TEST_PASSWORD})).status,400);
  await send('POST','/api/auth/password-reset-request',{email:'students@example.invalid'});const old=tokenFor('students@example.invalid');await send('POST','/api/auth/password-reset-request',{email:'students@example.invalid'});
  assert.equal((await send('POST','/api/auth/password-reset-confirm',{token:old,password:TEST_PASSWORD})).status,400);
 });
 await check('Password reset revokes old sessions and accepts only new password',async()=>{
  const changed='Changed-synthetic-password-456!';const raw=tokenFor('students@example.invalid');
  assert.equal((await send('POST','/api/auth/password-reset-confirm',{token:raw,password:changed})).status,200);
  assert.equal((await send('GET','/api/auth/session',{},S)).status,401);
  assert.equal((await send('POST','/api/auth/login',{email:'students@example.invalid',password:TEST_PASSWORD})).status,401);
  clients.studentS=await login('studentS',changed);
 });
 await check('Expired sessions and logout are immediately invalid',async()=>{
  const c=await login('studentT');await query("UPDATE auth_private.sessions SET created_at=now()-interval '10 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1 AND revoked_at IS NULL",[ids.studentT]);
  assert.equal((await send('GET','/api/auth/session',{},c)).status,401);
  const p=clients.pending;const r=await send('POST','/api/auth/logout',{},p);assert.equal(r.status,200);assert(r.headers['set-cookie'].includes('Max-Age=0'));assert.equal((await send('GET','/api/auth/session',{},p)).status,401);
 });
 await check('Uniform mail failure response revokes the issued token',async()=>{
  const fail=await createApp(db,{origin,mailer:async()=>{throw Error('synthetic mail failure');}});
  const r=await fail.dispatch({method:'POST',path:'/api/auth/password-reset-request',headers:{origin,'content-type':'application/json'},body:{email:'teacherb@example.invalid'}});assert.equal(r.status,202);
  assert.equal(await scalar('SELECT count(*) FROM auth_private.tokens WHERE user_id=$1 AND revoked_at IS NULL',[ids.teacherB]),0);
 });
 await check('Request rate limiter applies to existing and nonexistent emails',async()=>{
  const limited=await createApp(db,{origin,mailer:async()=>{},requestLimit:2});
  const statuses=[];for(const email of ['pending@example.invalid','missing@example.invalid','absent@example.invalid'])statuses.push((await limited.dispatch({method:'POST',path:'/api/auth/activation-request',headers:{origin,'content-type':'application/json'},body:{email}})).status);
  assert.deepEqual(statuses,[202,202,429]);
 });
 await check('Limiter expires windows and bounds retained keys',async()=>{
  let now=0;const l=new RateLimiter({windowMs:10,maxKeys:1,clock:()=>now});l.check(['a'],1);assert.throws(()=>l.check(['a'],1));assert.throws(()=>l.check(['b'],1));now=11;l.check(['b'],1);assert.equal(l.map.size,1);
 });
 await check('Password hashing work is bounded under concurrent invalid requests',async()=>{
  const r=await Promise.all([1,2,3].map(()=>send('POST','/api/auth/activation-confirm',{token:'x'.repeat(43),password:TEST_PASSWORD})));
  assert.deepEqual(r.map(x=>x.status).sort(),[400,400,429]);
 });
 await check('Actual HTTP rejects invalid JSON, wrong content type, and oversize body',async()=>{
  server=app.server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base='http://127.0.0.1:'+server.address().port;
  const invalid=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{'});assert.equal(invalid.status,400);
  const wrong=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'text/plain'},body:'{}'});assert.equal(wrong.status,415);
  const big=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({x:'a'.repeat(17000)})});assert.equal(big.status,413);
  const good=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'admin@example.invalid',password:TEST_PASSWORD})});assert.equal(good.status,200);assert(good.headers.get('set-cookie').includes('HttpOnly'));
  const cookie=good.headers.get('set-cookie').split(';')[0];const session=await fetch(base+'/api/auth/session',{headers:{cookie,origin}});assert.equal(session.status,200);const auth=await session.json();
  const csrfDenied=await fetch(base+'/api/classes',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({name:'Synthetic HTTP class'})});assert.equal(csrfDenied.status,403);
  const created=await fetch(base+'/api/classes',{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':auth.csrfToken},body:JSON.stringify({name:'Synthetic HTTP class'})});assert.equal(created.status,201);
  await new Promise(resolve=>server.close(resolve));server=null;
 });
 await check('Denied requests are audited and generic errors omit internals',async()=>{
  assert(await scalar("SELECT count(*) FROM auth_private.audit_events WHERE outcome='denied'")>0);
  const r=await send('GET','/api/me/history?after=bad',{},clients.studentS);assert.equal(r.status,400);
  assert.deepEqual(Object.keys(r.body.error).sort(),['code','message','requestId']);for(const value of ['SELECT','password_hash','/Users/','token_hash'])assert(!JSON.stringify(r.body).includes(value));
 });
 report.status='passed';report.passed=report.checks.length;report.engine=(await query('SELECT version() AS v')).rows[0].v;
 report.limitations=['Synthetic accounts only','Single PGlite connection serializes DB transactions; native PostgreSQL multi-connection races not tested','Mail adapter is an in-memory sink; no SMTP or real emails','No production network, frontend or real imported account activation'];
}catch(e){report.status='failed';report.failed_check=which;report.error_code=e.code??e.name;console.error(JSON.stringify({failed:which,code:e.code??e.name,locations:e.stack?.split('\n').slice(1,3).map(x=>x.trim())}));process.exitCode=1;}
finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();await writeFile(new URL('./test-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});}
