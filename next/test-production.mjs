import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {seed} from './fixtures.mjs';
import {createApp} from './app.mjs';
import {productionConfig,clientAddress} from './production-config.mjs';
const base={environment:'production',origin:'https://webavr.com',database:{database:'webavr_live_production',host:'/private/socket'},port:4500,google:{redirectUri:'https://webavr.com/api/auth/google/callback'},legacyUrl:'https://www.webavr.com/',mail:{mode:'disabled'}};
assert.equal(productionConfig(base).host,'127.0.0.1');
for(const x of [{environment:'trial'},{origin:'http://webavr.com'},{database:{database:'webavr_legacy_trial',host:'/s'}},{database:{database:'webavr_live_production',host:'0.0.0.0'}},{legacyUrl:'https://webavr.com/'},{mail:{mode:'private-test'}},{google:{redirectUri:'http://localhost:4400/api/auth/google/callback'}}])assert.throws(()=>productionConfig({...base,...x}));
assert.equal(clientAddress('127.0.0.1',{'x-real-ip':'198.51.100.7'},true),'198.51.100.7');
assert.equal(clientAddress('198.51.100.8',{'x-real-ip':'198.51.100.7'},true),'198.51.100.8');
assert.equal(clientAddress('127.0.0.1',{'x-real-ip':'198.51.100.7'}),'127.0.0.1');
assert.equal(clientAddress('::1',{'x-real-ip':'198.51.100.7,evil'},true),'::1');
const db=new PGlite();await db.waitReady;
try{
 await seed(db,new URL('./schema/',import.meta.url));
 const app=await createApp(db,{origin:base.origin,secureCookies:true,mailer:async()=>{throw Error('must not send');},webRoot:new URL('./public/',import.meta.url),production:{legacyUrl:base.legacyUrl,emailRecovery:false}});
 assert.equal(app.cookieName,'__Host-webavr_session');
 const opts=(await app.dispatch({path:'/api/auth/options'})).body;assert.equal(opts.emailRecovery,false);assert.equal(opts.legacyUrl,base.legacyUrl);assert.equal(opts.demoAccounts,false);
 assert.equal((await app.dispatch({path:'/api/health'})).body.status,'ok');
 const post=(origin,path,body)=>app.dispatch({method:'POST',path,headers:{origin,'content-type':'application/json'},body});
 assert.equal((await post(base.origin,'/api/auth/password-reset-request',{email:'admin@example.invalid'})).status,503);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM auth_private.tokens')).rows[0].n,0);
 assert.equal((await post('https://www.webavr.com','/api/auth/login',{})).status,403);
 for(const path of ['/test/teacher','/test/student'])assert.notEqual((await app.dispatch({path})).status,200);
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 try{
  const url='http://127.0.0.1:'+app.server.address().port;
  const page=await (await fetch(url)).text();assert(page.includes('https://www.webavr.com/'));assert(!page.includes('此處操作不會切換正式網站'));
  const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{origin:base.origin,'content-type':'application/json'},body:JSON.stringify({email:'admin@example.invalid',password:'Synthetic-long-password-123!'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert(cookie.startsWith('__Host-webavr_session='));assert(cookie.includes('Secure'));assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Strict'));assert(!cookie.includes('Domain='));
 }finally{await new Promise(ok=>app.server.close(ok));}
 console.log('Production configuration, secure cookie, proxy trust, disabled mail, CSRF and test-route isolation checks passed.');
}finally{await db.close();}
