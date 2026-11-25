import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {hash,verify,Algorithm} from '@node-rs/argon2';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {createGoogleLogin} from './google-login.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const HASH_OPTIONS={algorithm:Algorithm.Argon2id,memoryCost:19456,timeCost:2,parallelism:1,outputLen:32};
const CHAT=new Set(['legacy_message','account_chatLog','modern_message','legacy_siraya_message']);
const LEARNING=new Set(['position_event','account_userPositionLog','legacy_click','account_userClickHotSpot','account_userClickButton','account_mutiAnswerLog','account_exploreLog']);
const error=(status,code)=>Object.assign(new Error(code),{status,code});
const requireThat=(ok,status,code)=>{if(!ok)throw error(status,code);};
const validateId=x=>{requireThat(typeof x==='string'&&uuid.test(x),400,'INVALID_ID');return x;};
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function fields(body,allowed,required=allowed){
 requireThat(body&&typeof body==='object'&&!Array.isArray(body),400,'INVALID_BODY');
 requireThat(Object.keys(body).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(body,k)),400,'INVALID_FIELDS');
 return body;
}
function string(value,min,max){requireThat(typeof value==='string'&&value.trim().length>=min&&value.length<=max,400,'INVALID_TEXT');return value.trim();}
function email(value){const s=string(value,3,254).toLowerCase();requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),400,'INVALID_EMAIL');return s;}
function password(value){requireThat(typeof value==='string'&&[...value].length>=15&&[...value].length<=128&&Buffer.byteLength(value)<=512,400,'INVALID_PASSWORD');return value;}
function isoTime(value){
 requireThat(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&value.slice(0,4)!=='0000',400,'INVALID_TIME');
 const n=Date.parse(value),local=Date.parse(value.slice(0,19)+'Z');
 requireThat(Number.isFinite(n)&&Number.isFinite(local)&&new Date(local).toISOString().slice(0,19)===value.slice(0,19),400,'INVALID_TIME');
 return new Date(n).toISOString();
}
const rows=async(tx,sql,p=[])=> (await tx.query(sql,p)).rows;
const first=async(tx,sql,p=[])=> (await rows(tx,sql,p))[0];

export class RateLimiter{
 constructor({windowMs=900000,maxKeys=10000,clock=Date.now}={}){this.map=new Map();this.windowMs=windowMs;this.maxKeys=maxKeys;this.clock=clock;}
 check(keys,limit){
  const now=this.clock();for(const [k,v] of this.map)if(v.until<=now)this.map.delete(k);
  for(const key of keys){const k=digest(key);let v=this.map.get(k);if(!v){if(this.map.size>=this.maxKeys)throw error(429,'RATE_LIMITED');v={hits:0,until:now+this.windowMs};this.map.set(k,v);}v.hits++;requireThat(v.hits<=limit,429,'RATE_LIMITED');}
 }
}

const tutorAudioPath=path=>/^\/api\/learn\/courses\/[a-f0-9-]+\/assistant\/transcribe$/i.test(path);
const binaryPath=path=>/^\/api\/studio\/uploads\/[a-f0-9-]+\/content$/i.test(path)||tutorAudioPath(path);
export async function createApp(db,{origin='https://webavr.example',secureCookies=true,mailer,authLimit=10,requestLimit=5,writeLimit=120,limiter=new RateLimiter(),diagnostics=()=>{},webRoot=null,studio=null,google=null,demoAccounts=false}={}){
 const site=new URL(origin);
 requireThat(site.origin===origin&&!site.username&&!site.password,500,'INVALID_ORIGIN_CONFIG');
 requireThat(secureCookies?site.protocol==='https:':site.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(site.hostname),500,'INVALID_COOKIE_CONFIG');
 requireThat(typeof mailer==='function',500,'MAILER_REQUIRED');
 const googleLogin=await createGoogleLogin(db,google,{origin,secureCookies});
 const cookieName=secureCookies?'__Host-webavr_session':'webavr_dev_session';
 const webFiles=new Map();
 if(webRoot){
  for(const [route,file,mime] of [['/','index.html','text/html'],['/activate','index.html','text/html'],['/reset','index.html','text/html'],['/app.js','app.js','text/javascript'],['/session-recovery.mjs','session-recovery.mjs','text/javascript'],['/draft-recovery.mjs','draft-recovery.mjs','text/javascript'],['/course-schema.mjs','course-schema.mjs','text/javascript'],['/app.css','app.css','text/css'],['/class-learning','class-learning.html','text/html'],['/class-learning.js','class-learning.js','text/javascript'],['/class-learning.css','class-learning.css','text/css'],['/learn','learn.html','text/html'],['/learn.js','learn.js','text/javascript'],['/learn.css','learn.css','text/css'],['/tutor.css','tutor.css','text/css'],['/studio','studio.html','text/html'],['/studio.js','studio.js','text/javascript'],['/studio.css','studio.css','text/css'],['/pannellum.js','pannellum.js','text/javascript'],['/pannellum.css','pannellum.css','text/css'],...['question.png','explore.png','landmark.png','sound.png','video.png'].map(name=>['/icons/'+name,'icons/'+name,'image/png'])])
   webFiles.set(route,{bytes:await readFile(new URL(file,webRoot)),mime});
 }
 const dummy=await hash(random(),HASH_OPTIONS);let activeHashJobs=0;
 const withHash=async fn=>{requireThat(activeHashJobs<2,429,'BUSY');activeHashJobs++;try{return await fn();}finally{activeHashJobs--;}};
 const cookie=(value,maxAge=28800)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies?'; Secure':''}`;
 async function audit(tx,actor,action,outcome,reason,requestId,targetKind='api',targetId=null){
  await tx.query(`INSERT INTO auth_private.audit_events(id,actor_id,action,target_kind,target_id,outcome,reason,request_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[randomUUID(),actor,action,targetKind,targetId,outcome,reason,requestId]);
 }
 async function identityReady(tx,userId){
  return !(await first(tx,`SELECT 1 FROM migration_private.identity_map WHERE user_id=$1 AND confidence<>'verified' LIMIT 1`,[userId]));
 }
 async function activationReady(tx,user){
  return user?.state==='pending_activation'&&user.email&&await identityReady(tx,user.id)&&!!(await first(tx,'SELECT 1 FROM auth_private.activation_approvals WHERE user_id=$1 LIMIT 1',[user.id]));
 }
 async function authenticate(headers){
  const pairs=(headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));
  requireThat(pairs.length<=1,401,'UNAUTHENTICATED');
  const raw=pairs[0]?.slice(cookieName.length+1);requireThat(raw&&tokenPattern.test(raw),401,'UNAUTHENTICATED');
  const user=await first(db,`SELECT u.id,u.display_name,u.state,s.id AS session_id FROM auth_private.sessions s JOIN webavr.users u ON u.id=s.user_id
   WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.state='active'`,[digest(raw)]);
  requireThat(user,401,'UNAUTHENTICATED');
  user.roles=(await rows(db,'SELECT role FROM webavr.user_roles WHERE user_id=$1 AND revoked_at IS NULL',[user.id])).map(r=>r.role);
  return {...user,raw,csrf:digest('csrf\0'+raw)};
 }
 const isAdmin=u=>u.roles.includes('admin');
 function adminReason(ctx){
  requireThat(isAdmin(ctx.user),403,'FORBIDDEN');let reason=ctx.headers['x-audit-reason'];
  if(typeof reason==='string'&&reason.startsWith('utf8:')){requireThat(reason.length<=5005,400,'INVALID_AUDIT_REASON');try{reason=decodeURIComponent(reason.slice(5));}catch{throw error(400,'INVALID_AUDIT_REASON');}}
  return string(reason,3,500);
 }
 async function teaching(tx,user,classId){
  return user.roles.includes('teacher')&&!!(await first(tx,`SELECT 1 FROM webavr.class_memberships m JOIN webavr.classes c ON c.id=m.class_id
   WHERE m.class_id=$1 AND m.user_id=$2 AND m.member_role='teacher' AND m.joined_at<=now()
    AND (m.left_at IS NULL OR m.left_at>now()) AND c.state='active'`,[classId,user.id]));
 }
 function page(url,allowed=[]){
  requireThat([...url.searchParams.keys()].every(k=>['limit','after',...allowed].includes(k)),400,'INVALID_QUERY');
  requireThat([...new Set(url.searchParams.keys())].every(k=>url.searchParams.getAll(k).length===1),400,'INVALID_QUERY');
  const limit=url.searchParams.get('limit')??'50';requireThat(/^[1-9]\d?$|^100$/.test(limit),400,'INVALID_LIMIT');
  const after=url.searchParams.get('after');if(after)validateId(after);
  return {limit:Number(limit),after};
 }
 const historyPayload=r=>({id:r.id,type:r.event_type,occurredAt:r.occurred_at,courseId:r.course_id,classId:r.class_id,learnerId:r.user_id,learnerName:r.learner_name,courseTitle:r.course_title,className:r.class_name,payload:r.payload});
 const archivePayload=r=>({id:r.id,category:r.category,legacyTimeText:r.legacy_time_text,timeQuality:r.time_quality,
  verifiedOccurredAt:r.review_occurred_at,scope:r.review_scope,payload:r.redacted_payload});
 const latestReview=`LEFT JOIN LATERAL (SELECT * FROM migration_private.archive_reviews WHERE archive_id=a.id ORDER BY revision DESC LIMIT 1) v ON true`;
 async function dispatch({method='GET',path='/',headers={},body={},ip='127.0.0.1',uploadStream,signal}){
  headers=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
  const requestId=randomUUID();const responseHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','x-request-id':requestId};
  const ctx={headers,user:null};
  try{
   requireThat(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//')&&path.length<=2048,400,'INVALID_PATH');
   const url=new URL(path,origin);requireThat(url.origin===origin,400,'INVALID_PATH');
   requireThat(headers.origin===undefined||headers.origin===origin,403,'ORIGIN_DENIED');
   const googleCallback=googleLogin&&method==='GET'&&url.pathname==='/api/auth/google/callback';
   requireThat(headers['sec-fetch-site']!=='cross-site'||googleCallback,403,'ORIGIN_DENIED');
   requireThat(['GET','POST'].includes(method),405,'METHOD_NOT_ALLOWED');
   if(method==='POST'){
    requireThat(headers.origin===origin,403,'ORIGIN_DENIED');
    const binaryUpload=binaryPath(url.pathname);
    if(binaryUpload){requireThat(uploadStream&&/^application\/octet-stream(?:\s*;.*)?$/i.test(headers['content-type']??''),415,'BINARY_REQUIRED');requireThat(headers['content-length']===undefined||Number(headers['content-length'])<=(tutorAudioPath(url.pathname)?8000000:16000000),413,'BODY_TOO_LARGE');}
    else requireThat(/^application\/json(?:\s*;.*)?$/i.test(headers['content-type']??''),415,'JSON_REQUIRED');
    requireThat(Buffer.byteLength(JSON.stringify(body))<=(url.pathname==='/api/studio/media'?24002000:url.pathname.startsWith('/api/studio/')?1600000:16384),413,'BODY_TOO_LARGE');
    limiter.check(['write:'+ip],writeLimit);
   }
   const pathname=url.pathname;
   if(method==='GET'&&pathname==='/api/auth/options')return {status:200,headers:responseHeaders,body:{google:!!googleLogin,demoAccounts:demoAccounts===true}};
   if(method==='GET'&&googleLogin&&pathname==='/api/auth/google/start'){
    limiter.check(['google-start:'+ip],authLimit);const r=await googleLogin.start();return {...r,headers:{...responseHeaders,...r.headers}};
   }
   if(googleCallback){
    const r=await googleLogin.callback(url,headers);if(r.sessionRaw)r.headers['set-cookie']=[r.headers['set-cookie'],cookie(r.sessionRaw)];delete r.sessionRaw;return {...r,headers:{...responseHeaders,...r.headers}};
   }
   if(method==='GET'&&pathname==='/api/health')return {status:200,headers:responseHeaders,body:{status:'local-prototype'}};
   if(method==='POST'&&['/api/auth/activation-request','/api/auth/password-reset-request'].includes(pathname)){
    const started=performance.now();
    fields(body,['email']);const address=email(body.email);const activate=pathname.includes('activation');const purpose=activate?'activate':'reset_password';
    limiter.check(['request-ip:'+ip,'request-email:'+address],requestLimit);
    const raw=random();let mail;
    await db.transaction(async tx=>{
     const u=await first(tx,'SELECT * FROM webavr.users WHERE lower(email)=$1 FOR UPDATE',[address]);
     const localCredential=u?.state==='active'&&!!(await first(tx,'SELECT 1 FROM auth_private.credentials WHERE user_id=$1',[u.id]));
     const approvedGoogle=u?.state==='active'&&googleLogin&&await identityReady(tx,u.id)&&!!(await first(tx,'SELECT 1 FROM auth_private.google_bindings WHERE user_id=$1',[u.id]));
     const eligible=activate?await activationReady(tx,u):u?.state==='active'&&(localCredential||approvedGoogle);
     if(eligible){
      await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND revoked_at IS NULL',[u.id,purpose]);
      const id=randomUUID();await tx.query(`INSERT INTO auth_private.tokens(id,user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')`,[id,u.id,purpose,digest(raw)]);
      const link=new URL(activate?'/activate':'/reset',origin);link.hash=new URLSearchParams({token:raw}).toString();
      mail={to:address,url:link.href,purpose,tokenId:id};
     }
    });
    if(mail){
     try{await mailer({to:mail.to,url:mail.url,purpose});}
     catch{await db.transaction(async tx=>{await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE id=$1',[mail.tokenId]);await audit(tx,null,'auth.mail','failed','Delivery adapter failed; token revoked.',requestId);});}
    }
    // Prototype floor only. A durable async mail queue is still required before SMTP deployment.
    await delay(Math.max(0,120-(performance.now()-started)));
    return {status:202,headers:responseHeaders,body:{status:'accepted'}};
   }
   if(method==='POST'&&['/api/auth/activation-confirm','/api/auth/password-reset-confirm'].includes(pathname)){
    fields(body,['token','password']);requireThat(typeof body.token==='string'&&tokenPattern.test(body.token),400,'INVALID_TOKEN');password(body.password);
    limiter.check(['confirm-ip:'+ip],authLimit);const activate=pathname.includes('activation');const purpose=activate?'activate':'reset_password';
    const passwordHash=await withHash(()=>hash(body.password,HASH_OPTIONS));
    await db.transaction(async tx=>{
     const t=await first(tx,`SELECT * FROM auth_private.tokens WHERE token_hash=$1 AND purpose=$2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,[digest(body.token),purpose]);
     requireThat(t,400,'INVALID_TOKEN');const u=await first(tx,'SELECT * FROM webavr.users WHERE id=$1 FOR UPDATE',[t.user_id]);
     requireThat(activate?await activationReady(tx,u):u?.state==='active',400,'INVALID_TOKEN');
     await tx.query(`INSERT INTO auth_private.credentials(user_id,password_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,changed_at=now(),must_reset=false`,[u.id,passwordHash]);
     if(activate)await tx.query("UPDATE webavr.users SET state='active',email_verified_at=now() WHERE id=$1",[u.id]);
     await tx.query(`INSERT INTO auth_private.identities(id,user_id,provider,subject) VALUES($1,$2,'local',$3) ON CONFLICT(provider,subject) DO NOTHING`,[randomUUID(),u.id,u.id]);
     await tx.query('UPDATE auth_private.tokens SET consumed_at=now() WHERE id=$1',[t.id]);
     await tx.query('UPDATE auth_private.tokens SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',[u.id,t.id]);
     await tx.query('UPDATE auth_private.sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[u.id]);
     await audit(tx,u.id,activate?'auth.activate':'auth.reset','allowed','One-use email token consumed; existing sessions revoked.',requestId,'user',u.id);
    });
    return {status:200,headers:responseHeaders,body:{status:'password_set'}};
   }
   if(method==='POST'&&pathname==='/api/auth/login'){
    fields(body,['email','password']);const address=email(body.email);requireThat(typeof body.password==='string'&&Buffer.byteLength(body.password)<=512,400,'INVALID_PASSWORD');
    limiter.check(['login-ip:'+ip,'login-email:'+address],authLimit);
    const u=await first(db,`SELECT u.*,c.password_hash,c.must_reset FROM webavr.users u LEFT JOIN auth_private.credentials c ON c.user_id=u.id WHERE lower(u.email)=$1`,[address]);
    const valid=await withHash(()=>verify(u?.password_hash??dummy,body.password));
    requireThat(valid&&u?.state==='active'&&u.password_hash&&!u.must_reset,401,'INVALID_LOGIN');
    const raw=random();await db.transaction(async tx=>{
     const fresh=await first(tx,`SELECT u.state,c.password_hash,c.must_reset FROM webavr.users u JOIN auth_private.credentials c ON c.user_id=u.id WHERE u.id=$1 FOR UPDATE`,[u.id]);
     requireThat(fresh?.state==='active'&&fresh.password_hash===u.password_hash&&!fresh.must_reset,401,'INVALID_LOGIN');
     await tx.query(`INSERT INTO auth_private.sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')`,[randomUUID(),u.id,digest(raw)]);
     await audit(tx,u.id,'auth.login','allowed','Password verified.',requestId,'user',u.id);
    });
    responseHeaders['set-cookie']=cookie(raw);return {status:200,headers:responseHeaders,body:{status:'authenticated'}};
   }
   ctx.user=await authenticate(headers);const user=ctx.user;
   if(method==='POST')requireThat(equal(headers['x-csrf-token'],user.csrf),403,'CSRF_DENIED');
   if(studio&&(pathname.startsWith('/api/studio/')||pathname.startsWith('/api/learn/'))){const reportReason=pathname.startsWith('/api/studio/class-learning/')&&isAdmin(user)?adminReason(ctx):'Authorized teaching workspace or own learning activity.';const result=await studio.handle({user,method,pathname,body,url,headers,uploadStream,signal});if(!pathname.startsWith('/api/studio/media'))await audit(db,user.id,'studio.'+(method==='POST'?'write':'read'),'allowed',reportReason,requestId,'studio');if(result?.stream){return {status:result.status??200,headers:{...responseHeaders,...result.headers,'content-type':result.mime},stream:result.stream};}if(result?.binary){return {status:result.status??200,headers:{...responseHeaders,...result.headers,'content-type':result.mime},binary:result.binary};}return {status:200,headers:responseHeaders,body:result};}
   if(method==='GET'&&pathname==='/api/auth/session')return {status:200,headers:responseHeaders,body:{user:{id:user.id,name:user.display_name,roles:user.roles},csrfToken:user.csrf}};
   if(method==='POST'&&pathname==='/api/auth/logout'){
    fields(body,[]);await db.transaction(async tx=>{await tx.query('UPDATE auth_private.sessions SET revoked_at=now() WHERE id=$1',[user.session_id]);await audit(tx,user.id,'auth.logout','allowed','Session revoked.',requestId);});
    responseHeaders['set-cookie']=cookie('',0);return {status:200,headers:responseHeaders,body:{status:'logged_out'}};
   }
   if(method==='POST'&&pathname==='/api/admin/activation-approvals'){
    requireThat(isAdmin(user),403,'FORBIDDEN');fields(body,['userId','reason','evidenceRef']);const userId=validateId(body.userId);const reason=string(body.reason,3,500);const evidence=string(body.evidenceRef,3,300);
    const result=await db.transaction(async tx=>{
     const target=await first(tx,'SELECT * FROM webavr.users WHERE id=$1 FOR UPDATE',[userId]);
     requireThat(target?.state==='pending_activation'&&target.email&&await identityReady(tx,userId),409,'IDENTITY_REVIEW_REQUIRED');
     const existing=await first(tx,'SELECT id FROM auth_private.activation_approvals WHERE user_id=$1 LIMIT 1',[userId]);if(existing)return existing;
     const id=randomUUID();await tx.query('INSERT INTO auth_private.activation_approvals(id,user_id,approved_by,evidence_ref,reason) VALUES($1,$2,$3,$4,$5)',[id,userId,user.id,evidence,reason]);
     await audit(tx,user.id,'auth.approve_activation','allowed',reason,requestId,'user',userId);return {id};
    });return {status:200,headers:responseHeaders,body:result};
   }
   if(method==='GET'&&pathname==='/api/me/classes'){
    const data=await rows(db,`SELECT c.id,c.name,m.member_role FROM webavr.class_memberships m JOIN webavr.classes c ON c.id=m.class_id
     WHERE m.user_id=$1 AND m.joined_at<=now() AND (m.left_at IS NULL OR m.left_at>now()) AND c.state='active'
      AND (m.member_role='student' OR $2::boolean) ORDER BY c.id LIMIT 100`,[user.id,user.roles.includes('teacher')||isAdmin(user)]);
    return {status:200,headers:responseHeaders,body:{items:data}};
   }
   if(method==='GET'&&pathname==='/api/admin/users'){
    const reason=adminReason(ctx);const {limit,after}=page(url,['q']);const search=string(url.searchParams.get('q')??'',0,100);
    const data=await db.transaction(async tx=>{
     const list=await rows(tx,`SELECT u.id,u.display_name AS name,u.email,u.state,
      ARRAY(SELECT role FROM webavr.user_roles WHERE user_id=u.id AND revoked_at IS NULL ORDER BY role) AS roles,
      EXISTS(SELECT 1 FROM migration_private.identity_map WHERE user_id=u.id AND confidence<>'verified') AS needs_identity_review,
      EXISTS(SELECT 1 FROM auth_private.activation_approvals WHERE user_id=u.id) AS activation_approved
      FROM webavr.users u WHERE ($1::uuid IS NULL OR u.id>$1) AND strpos(lower(u.display_name||' '||coalesce(u.email,'')),lower($2))>0 ORDER BY u.id LIMIT $3`,[after,search,limit]);
     await audit(tx,user.id,'user.directory','allowed',reason,requestId);return list;
    });return {status:200,headers:responseHeaders,body:{items:data,nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   if(method==='GET'&&pathname==='/api/admin/classes'){
    const reason=adminReason(ctx);const {limit,after}=page(url);
    const data=await db.transaction(async tx=>{
     const list=await rows(tx,`SELECT c.id,c.name,c.state,coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('id',co.id,'title',co.title))
      FROM webavr.course_classes cc JOIN webavr.courses co ON co.id=cc.course_id
      WHERE cc.class_id=c.id),'[]') AS courses
      FROM webavr.classes c WHERE ($1::uuid IS NULL OR c.id>$1) ORDER BY c.id LIMIT $2`,[after,limit]);
     await audit(tx,user.id,'class.directory','allowed',reason,requestId);return list;
    });return {status:200,headers:responseHeaders,body:{items:data,nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   if(method==='POST'&&pathname==='/api/classes'){
    fields(body,['name']);const name=string(body.name,1,200);requireThat(user.roles.includes('teacher')||isAdmin(user),403,'FORBIDDEN');
    const id=randomUUID();await db.transaction(async tx=>{await tx.query('INSERT INTO webavr.classes(id,name,created_by) VALUES($1,$2,$3)',[id,name,user.id]);
     await tx.query("INSERT INTO webavr.class_memberships(id,class_id,user_id,member_role) VALUES($1,$2,$3,'teacher')",[randomUUID(),id,user.id]);
     await audit(tx,user.id,'class.create','allowed','Class created.',requestId,'class',id);});
    return {status:201,headers:responseHeaders,body:{id}};
   }
   let match=pathname.match(/^\/api\/classes\/([0-9a-f-]+)\/members$/i);
   if(method==='GET'&&match){
    const classId=validateId(match[1]);const {limit,after}=page(url);const reason=isAdmin(user)?adminReason(ctx):'class-roster';
    const data=await db.transaction(async tx=>{
     requireThat(isAdmin(user)||await teaching(tx,user,classId),403,'FORBIDDEN');
     const list=await rows(tx,`SELECT m.id,u.id AS user_id,u.display_name AS name,m.member_role,u.state FROM webavr.class_memberships m JOIN webavr.users u ON u.id=m.user_id
      WHERE m.class_id=$1 AND m.joined_at<=now() AND (m.left_at IS NULL OR m.left_at>now()) AND ($2::uuid IS NULL OR m.id>$2) ORDER BY m.id LIMIT $3`,[classId,after,limit]);
     await audit(tx,user.id,'class.roster','allowed',reason,requestId,'class',classId);return list;
    });return {status:200,headers:responseHeaders,body:{items:data,nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   if(method==='POST'&&match){
    const classId=validateId(match[1]);fields(body,['userId','studentEmail','role'],['role']);requireThat(Object.hasOwn(body,'userId')!==Object.hasOwn(body,'studentEmail'),400,'INVALID_FIELDS');
    let learnerId=Object.hasOwn(body,'userId')?validateId(body.userId):null;const address=learnerId?null:email(body.studentEmail);requireThat(['student','teacher'].includes(body.role)&&(!address||body.role==='student'),400,'INVALID_ROLE');
    await db.transaction(async tx=>{
     requireThat(isAdmin(user)||await teaching(tx,user,classId),403,'FORBIDDEN');requireThat(body.role==='student'||isAdmin(user),403,'FORBIDDEN');
     if(address)learnerId=(await first(tx,"SELECT id FROM webavr.users WHERE lower(email)=$1 AND state='active'",[address]))?.id;
     requireThat(learnerId,404,'NOT_FOUND');
     const active=await first(tx,`SELECT 1 FROM webavr.users u JOIN webavr.user_roles r ON r.user_id=u.id WHERE u.id=$1 AND u.state='active' AND r.role=$2 AND r.revoked_at IS NULL`,[learnerId,body.role]);requireThat(active,404,'NOT_FOUND');
     const c=await first(tx,"SELECT id FROM webavr.classes WHERE id=$1 AND state='active' FOR UPDATE",[classId]);requireThat(c,404,'NOT_FOUND');
     const open=await first(tx,'SELECT 1 FROM webavr.class_memberships WHERE class_id=$1 AND user_id=$2 AND member_role=$3 AND (left_at IS NULL OR left_at>now())',[classId,learnerId,body.role]);requireThat(!open,409,'MEMBERSHIP_EXISTS');
     await tx.query('INSERT INTO webavr.class_memberships(id,class_id,user_id,member_role) VALUES($1,$2,$3,$4)',[randomUUID(),classId,learnerId,body.role]);
     await audit(tx,user.id,'class.add_member','allowed','Explicit class membership.',requestId,'class',classId);
    });return {status:201,headers:responseHeaders,body:{status:'joined'}};
   }
   match=pathname.match(/^\/api\/classes\/([0-9a-f-]+)\/history$/i);
   if(method==='GET'&&(pathname==='/api/me/history'||match)){
    const {limit,after}=page(url);const classId=match?validateId(match[1]):null;const reason=isAdmin(user)?adminReason(ctx):classId?'class-history':'self-history';
    const data=await db.transaction(async tx=>{
     if(classId)requireThat(isAdmin(user)||await teaching(tx,user,classId),403,'FORBIDDEN');
     const items=await rows(tx,`SELECT e.id,e.event_type,e.occurred_at,e.user_id,e.payload,s.course_id,s.class_id,u.display_name AS learner_name,c.title AS course_title,cl.name AS class_name
      FROM webavr.learning_events e JOIN webavr.learning_sessions s ON s.id=e.session_id JOIN webavr.users u ON u.id=e.user_id JOIN webavr.courses c ON c.id=s.course_id LEFT JOIN webavr.classes cl ON cl.id=s.class_id
      WHERE ($2::uuid IS NULL OR e.id>$2) AND ($3::uuid IS NULL AND e.user_id=$1 OR $3::uuid IS NOT NULL AND s.class_id=$3)
       AND webavr.can_read_session_record($1,e.user_id,e.session_id,e.occurred_at) ORDER BY e.id LIMIT $4`,[user.id,after,classId,limit]);
     await audit(tx,user.id,'history.read','allowed',reason,requestId);return items;
    });return {status:200,headers:responseHeaders,body:{items:data.map(historyPayload),nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   match=pathname.match(/^\/api\/classes\/([0-9a-f-]+)\/archives$/i);
   if(method==='GET'&&(pathname==='/api/me/archives'||match||pathname==='/api/admin/archives')){
    const {limit,after}=page(url);const classId=match?validateId(match[1]):null;const admin=pathname==='/api/admin/archives';
    const reason=admin||isAdmin(user)?adminReason(ctx):classId?'class-archive':'self-archive';
    const data=await db.transaction(async tx=>{
     if(classId)requireThat(isAdmin(user)||await teaching(tx,user,classId),403,'FORBIDDEN');
     const items=await rows(tx,`SELECT a.id,a.category,a.legacy_time_text,a.time_quality,a.redacted_payload,v.occurred_at AS review_occurred_at,v.scope AS review_scope,v.decision AS review_decision,v.subject_user_id AS review_subject,v.course_id AS review_course,v.class_id AS review_class
      FROM migration_private.archives a JOIN migration_private.source_records s ON s.id=a.source_record_id ${latestReview}
      WHERE ($2::uuid IS NULL OR a.id>$2) AND ($4::boolean OR
       (v.decision='verified' AND s.disposition<>'deduplicated' AND a.category=ANY($5::text[])
        AND NOT EXISTS(SELECT 1 FROM migration_private.identity_map im WHERE im.user_id=v.subject_user_id AND im.confidence<>'verified') AND
        ($3::uuid IS NULL AND v.subject_user_id=$1 OR $3::uuid IS NOT NULL AND v.class_id=$3 AND v.scope='learning'
          AND webavr.can_read_learning_record($1,v.subject_user_id,v.course_id,v.class_id,v.occurred_at))))
      ORDER BY a.id LIMIT $6`,[user.id,after,classId,admin,[...CHAT,...LEARNING],limit]);
     await audit(tx,user.id,'archive.read','allowed',reason,requestId);return items;
    });return {status:200,headers:responseHeaders,body:{items:data.map(r=>({...archivePayload(r),...(admin?{review:r.review_decision?{decision:r.review_decision,subjectUserId:r.review_subject,courseId:r.review_course,classId:r.review_class,occurredAt:r.review_occurred_at}:null}:{})})),nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   match=pathname.match(/^\/api\/admin\/archives\/([0-9a-f-]+)\/reviews$/i);
   if(method==='POST'&&match){
    requireThat(isAdmin(user),403,'FORBIDDEN');const archiveId=validateId(match[1]);
    fields(body,['subjectUserId','scope','courseId','classId','occurredAt','decision','reason','requestId']);
    const subject=validateId(body.subjectUserId);const reason=string(body.reason,3,500);const rid=validateId(body.requestId);
    requireThat(['private','learning'].includes(body.scope)&&['verified','withheld'].includes(body.decision),400,'INVALID_REVIEW');
    let occurredAt=null;
    if(body.scope==='private')requireThat(body.courseId===null&&body.classId===null&&body.occurredAt===null,400,'INVALID_CONTEXT');
    else{validateId(body.courseId);validateId(body.classId);occurredAt=isoTime(body.occurredAt);}
    const data=await db.transaction(async tx=>{
     const a=await first(tx,'SELECT * FROM migration_private.archives WHERE id=$1 FOR UPDATE',[archiveId]);requireThat(a,404,'NOT_FOUND');
     requireThat(CHAT.has(a.category)||LEARNING.has(a.category),409,'ARCHIVE_TYPE_REQUIRES_SPECIAL_REVIEW');
     requireThat(!CHAT.has(a.category)||body.scope==='private',409,'CHAT_SCOPE_LOCKED');
     requireThat(CHAT.has(a.category)||body.scope==='learning'||body.decision==='withheld',400,'INVALID_CONTEXT');
     requireThat(await identityReady(tx,subject)&&!!(await first(tx,"SELECT 1 FROM webavr.users WHERE id=$1 AND state='active'",[subject])),409,'IDENTITY_REVIEW_REQUIRED');
     if(body.scope==='learning')requireThat(await first(tx,`SELECT 1 FROM webavr.class_memberships m JOIN webavr.course_classes c ON c.class_id=m.class_id
      WHERE m.user_id=$1 AND m.member_role='student' AND m.class_id=$2 AND c.course_id=$3 AND m.joined_at<=$4::timestamptz AND (m.left_at IS NULL OR m.left_at>$4::timestamptz)
       AND c.linked_at<=$4::timestamptz AND (c.unlinked_at IS NULL OR c.unlinked_at>$4::timestamptz)`,[subject,body.classId,body.courseId,occurredAt]),409,'UNVERIFIED_CLASS_CONTEXT');
     const same=await first(tx,'SELECT * FROM migration_private.archive_reviews WHERE reviewed_by=$1 AND request_id=$2',[user.id,rid]);
     if(same){requireThat(same.archive_id===archiveId&&same.subject_user_id===subject&&same.scope===body.scope&&same.decision===body.decision&&same.course_id===body.courseId&&same.class_id===body.classId&&same.reason===reason&&((same.occurred_at===null&&occurredAt===null)||Date.parse(same.occurred_at)===Date.parse(occurredAt)),409,'REQUEST_ID_CONFLICT');return {id:same.id};}
     const id=randomUUID();await tx.query(`INSERT INTO migration_private.archive_reviews(id,archive_id,subject_user_id,course_id,class_id,occurred_at,scope,decision,reviewed_by,reason,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,archiveId,subject,body.courseId,body.classId,occurredAt,body.scope,body.decision,user.id,reason,rid]);
     await audit(tx,user.id,'archive.review','allowed',reason,requestId,'archive',archiveId);return {id};
    });return {status:200,headers:responseHeaders,body:data};
   }
   if(method==='GET'&&pathname==='/api/conversations'){
    const {limit,after}=page(url);const reason=isAdmin(user)?adminReason(ctx):'conversation-list';
    const data=await db.transaction(async tx=>{
     const list=await rows(tx,`SELECT c.id,c.scope,c.created_at,u.display_name AS owner_name,co.title AS course_title,cl.name AS class_name
      FROM webavr.conversations c JOIN webavr.users u ON u.id=c.owner_id LEFT JOIN webavr.courses co ON co.id=c.course_id LEFT JOIN webavr.classes cl ON cl.id=c.class_id
      WHERE ($2::uuid IS NULL OR c.id>$2) AND ($3::boolean OR c.owner_id=$1
       OR EXISTS(SELECT 1 FROM webavr.conversation_members m WHERE m.conversation_id=c.id AND m.user_id=$1 AND m.revoked_at IS NULL)
       OR c.scope='course_support' AND webavr.can_read_learning_record($1,c.owner_id,c.course_id,c.class_id,c.created_at)) ORDER BY c.id LIMIT $4`,[user.id,after,isAdmin(user),limit]);
     await audit(tx,user.id,'conversation.list','allowed',reason,requestId);return list;
    });return {status:200,headers:responseHeaders,body:{items:data,nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   match=pathname.match(/^\/api\/conversations\/([0-9a-f-]+)\/messages$/i);
   if(method==='GET'&&match){
    const id=validateId(match[1]);const {limit,after}=page(url);const reason=isAdmin(user)?adminReason(ctx):'conversation-read';
    const data=await db.transaction(async tx=>{
     const c=await first(tx,'SELECT * FROM webavr.conversations WHERE id=$1',[id]);requireThat(c,404,'NOT_FOUND');
     const member=await first(tx,'SELECT 1 FROM webavr.conversation_members WHERE conversation_id=$1 AND user_id=$2 AND revoked_at IS NULL',[id,user.id]);
     const teacher=c.scope==='course_support'&&(await first(tx,'SELECT webavr.can_read_learning_record($1,$2,$3,$4,$5) AS allowed',[user.id,c.owner_id,c.course_id,c.class_id,c.created_at]))?.allowed;
     requireThat(isAdmin(user)||c.owner_id===user.id||member||teacher,404,'NOT_FOUND');
     if(after)requireThat(await first(tx,'SELECT 1 FROM webavr.messages WHERE conversation_id=$1 AND id=$2',[id,after]),400,'INVALID_CURSOR');
     const items=await rows(tx,`SELECT id,role,content,state,created_at FROM webavr.messages WHERE conversation_id=$1
      AND ($2::uuid IS NULL OR (created_at,id)>(SELECT created_at,id FROM webavr.messages WHERE id=$2 AND conversation_id=$1)) ORDER BY created_at,id LIMIT $3`,[id,after,limit]);
     await audit(tx,user.id,'conversation.read','allowed',reason,requestId,'conversation',id);return items;
    });return {status:200,headers:responseHeaders,body:{items:data,nextCursor:data.length===limit?data.at(-1).id:null}};
   }
   throw error(404,'NOT_FOUND');
  }catch(e){
   const status=e.status??(e.code==='23505'?409:500);const code=e.status?e.code:status===409?'CONFLICT':'INTERNAL_ERROR';
   if(status>=500)try{diagnostics({requestId,code:e.code??e.name});}catch{}
   try{await audit(db,ctx.user?.id??null,'api.denied',status<500?'denied':'failed',code,requestId);}catch{}
   return {status,headers:responseHeaders,body:{error:{code,message:status>=500?'Service unavailable':'Request rejected',requestId,...(status<500&&Array.isArray(e.issues)?{fields:e.issues.slice(0,30)}:{})}}};
  }
 }
 let incomingMedia=0;
 const server=createServer({maxHeaderSize:8192},async(req,res)=>{
  let mediaSlot=false;
  const controller=new AbortController();req.on('error',()=>{controller.abort();if(!res.writableEnded)res.destroy();});req.once('aborted',()=>controller.abort());res.once('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   const pathname=new URL(req.url,origin).pathname,file=webFiles.get(pathname);
   if(req.method==='POST'&&(pathname==='/api/studio/media'||binaryPath(pathname))){if(incomingMedia>=3)throw error(429,'MEDIA_BUSY');incomingMedia++;mediaSlot=true;}
   if(file&&['GET','HEAD'].includes(req.method)){
    res.writeHead(200,{'content-type':file.mime+(file.mime.startsWith('text/')?'; charset=utf-8':''),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
     'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(req.method==='HEAD'?undefined:file.bytes);
   }
   req.setTimeout(req.method==='POST'?30000:120000,()=>{controller.abort();req.destroy();});req.once('end',()=>req.setTimeout(180000));const binary=req.method==='POST'&&binaryPath(pathname);let body={};
   if(!binary){let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>(pathname==='/api/studio/media'?24002000:pathname.startsWith('/api/studio/')?1600000:16384))throw error(413,'BODY_TOO_LARGE');chunks.push(chunk);}if(length)try{body=JSON.parse(Buffer.concat(chunks));}catch{throw error(400,'INVALID_JSON');}}
   const output=await dispatch({method:req.method,path:req.url,headers:req.headers,body,ip:req.socket.remoteAddress,uploadStream:binary?req:undefined,signal:controller.signal});
   if(res.destroyed)return;res.writeHead(output.status,{...output.headers,...(binary&&output.status>=400?{connection:'close'}:{})});
   if(output.stream)await pipeline(output.stream(),res);else res.end(output.binary??JSON.stringify(output.body));
  }catch(e){if(res.destroyed)return;if(res.headersSent){res.destroy();return;}const requestId=randomUUID();res.writeHead(e.status??400,{'content-type':'application/json','cache-control':'no-store',connection:'close'});res.end(JSON.stringify({error:{code:e.code??'INVALID_REQUEST',message:'Request rejected',requestId}}));}finally{if(mediaSlot)incomingMedia--;}
 });
 server.requestTimeout=180000;server.headersTimeout=10000;
 return {dispatch,server,cookieName};
}
