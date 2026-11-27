import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';import {seed} from './fixtures.mjs';import {createGoogleLogin} from './google-login.mjs';import {createApp} from './app.mjs';
const db=new PGlite();await db.waitReady;let checks=0;const pass=()=>checks++;
try{
 const {ids}=await seed(db,new URL('./schema/',import.meta.url));const origin='http://localhost:4400',config={clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-only',redirectUri:origin+'/api/auth/google/callback'};
 let sent,profile,exchanges=0;const provider={generateAuthUrl:opts=>{sent=opts;return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({...opts,scope:opts.scope.join(' ')});},getToken:async({code,codeVerifier})=>{assert.equal(createHash('sha256').update(codeVerifier).digest('base64url'),sent.code_challenge);exchanges++;return {tokens:{id_token:'synthetic-id-token'}};},verifyIdToken:async({audience})=>{assert.equal(audience,config.clientId);return {getPayload:()=>({...profile,nonce:profile?.nonce??sent.nonce})};}};
 const google=await createGoogleLogin(db,config,{origin,secureCookies:false,clientFactory:()=>provider});
 async function begin(){const r=await google.start(),url=new URL(r.headers.location);return {url:new URL(config.redirectUri+'?'+new URLSearchParams({state:url.searchParams.get('state'),code:'synthetic-code'})),cookie:r.headers['set-cookie'].split(';')[0]};}
 async function run(p){profile=p;const a=await begin();return google.callback(a.url,{cookie:a.cookie});}
 const start=await begin();assert.deepEqual(sent.scope,['openid','email','profile']);assert.equal(sent.code_challenge_method,'S256');assert(!sent.scope.join(' ').includes('gmail'));pass();
 profile={sub:'approved-sub',email:'admin@example.invalid',email_verified:true,name:'Test'};
 let r=await google.callback(start.url,{cookie:'webavr_google_trial='+'x'.repeat(43)});assert(r.headers.location.includes('google_failed'));assert.equal(exchanges,0);pass();
 await db.query("INSERT INTO auth_private.google_bindings VALUES('approved-sub',$1,'synthetic-approved-map',now())",[ids.admin]);
 r=await google.callback(start.url,{cookie:start.cookie});assert.equal(r.body.status,'authenticated');assert(r.sessionRaw);pass();
 assert.equal((await google.callback(start.url,{cookie:start.cookie})).body.status,'google_failed');pass();
 r=await run({sub:'email-lookalike',email:'admin@example.invalid',email_verified:true});assert.equal(r.body.status,'review_required');assert.equal((await db.query("SELECT count(*)::int AS n FROM auth_private.google_bindings WHERE subject='email-lookalike'")).rows[0].n,0);assert(!r.sessionRaw);pass();
 assert.equal((await run({sub:'approved-sub',email:'admin@example.invalid',email_verified:false})).body.status,'google_failed');pass();
 assert.equal((await run({sub:'approved-sub',email:'admin@example.invalid',email_verified:true,nonce:'wrong'})).body.status,'google_failed');pass();
 const expired=await begin();await db.query("UPDATE auth_private.google_states SET expires_at=now()-interval '1 second'");assert.equal((await google.callback(expired.url,{cookie:expired.cookie})).body.status,'google_failed');pass();
 await db.query("INSERT INTO auth_private.google_bindings VALUES('disabled-sub',$1,'synthetic-approved-map',now())",[ids.disabled]);assert.equal((await run({sub:'disabled-sub',email:'disabled@example.invalid',email_verified:true})).body.status,'review_required');pass();
 await db.query("UPDATE webavr.users SET state='active',email_verified_at=now() WHERE id=$1",[ids.unresolved]);
 await db.query("INSERT INTO auth_private.google_bindings VALUES('unresolved-sub',$1,'synthetic-not-enough',now())",[ids.unresolved]);assert.equal((await run({sub:'unresolved-sub',email:'unresolved@example.invalid',email_verified:true})).body.status,'review_required');pass();
 const delivered=[];const app=await createApp(db,{origin,secureCookies:false,mailer:async m=>delivered.push(m),google:config});const options=await app.dispatch({path:'/api/auth/options'});assert.deepEqual(options.body,{google:true,demoAccounts:false});pass();
 const rejected=await app.dispatch({path:'/api/auth/google/callback?state=bad&code=bad',headers:{'sec-fetch-site':'cross-site'}});assert.equal(rejected.status,303);assert(rejected.headers.location.includes('google_failed'));pass();
 assert.equal((await app.dispatch({path:'/api/auth/session',headers:{'sec-fetch-site':'cross-site'}})).status,403);pass();
 const disabled=await createApp(db,{origin,secureCookies:false,mailer:async()=>{}});assert.equal((await disabled.dispatch({path:'/api/auth/options'})).body.google,false);pass();
 await db.query("UPDATE webavr.users SET state='active',email_verified_at=now() WHERE id=$1",[ids.pending]);await db.query("INSERT INTO auth_private.google_bindings VALUES('backup-sub',$1,'synthetic-approved',now())",[ids.pending]);
 const post=(path,body)=>app.dispatch({method:'POST',path,headers:{origin,'content-type':'application/json'},body});
 await post('/api/auth/password-reset-request',{email:'pending@example.invalid'});assert.equal(delivered.length,1);pass();
 const token=new URLSearchParams(new URL(delivered[0].url).hash.slice(1)).get('token');const backup='Only-synthetic-email-backup-123!';assert.equal((await post('/api/auth/password-reset-confirm',{token,password:backup})).status,200);assert.equal((await post('/api/auth/login',{email:'pending@example.invalid',password:backup})).status,200);pass();
 await post('/api/auth/password-reset-request',{email:'unresolved@example.invalid'});assert.equal(delivered.length,1);pass();
 console.log(JSON.stringify({passed:checks,scope:'synthetic OAuth security tests; no live Google login'}));
}finally{await db.close();}
