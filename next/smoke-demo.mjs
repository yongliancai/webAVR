import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stat,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {TEST_PASSWORD} from './fixtures.mjs';
const port=31987,origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[fileURLToPath(new URL('./demo.mjs',import.meta.url))],{env:{...process.env,WEBAVR_DEMO_PORT:String(port)},stdio:['ignore','pipe','ignore']});
const exited=new Promise(resolve=>child.once('exit',resolve));let timer;
try{
 const ready=await new Promise((resolve,reject)=>{
  let output='';timer=setTimeout(()=>reject(Error('Demo startup timeout')),10000);
  child.stdout.on('data',b=>{
   output+=b;
   if(output.includes('\n')){
    try{resolve(JSON.parse(output.split('\n')[0]));}catch{reject(Error('Invalid startup response'));}
   }
  });
  child.once('error',reject);child.once('exit',()=>reject(Error('Demo exited before ready')));
 });
 clearTimeout(timer);assert.equal(ready.mode,'synthetic-localhost-demo');
 assert.equal((await fetch(origin+'/api/health')).status,200);
 async function post(path,body,headers={}){const r=await fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});assert.equal(r.status,path.endsWith('-request')?202:200);return r;}
 const login=await post('/api/auth/login',{email:'admin@example.invalid',password:TEST_PASSWORD});
 const cookie=login.headers.get('set-cookie');assert(cookie.startsWith('webavr_dev_session='));assert(!cookie.includes('; Secure'));
 const auth=await (await fetch(origin+'/api/auth/session',{headers:{cookie:cookie.split(';')[0],origin}})).json();assert(auth.csrfToken);
 const classes=await (await fetch(origin+'/api/me/classes',{headers:{cookie:cookie.split(';')[0],origin}})).json();assert(Array.isArray(classes.items));
 // No approval or mail is generated here; all data is synthetic and ephemeral.
 const folder=await stat(ready.mailboxDirectory);assert.equal(folder.mode&0o777,0o700);
 await writeFile(new URL('./demo-smoke-results.json',import.meta.url),JSON.stringify({status:'passed',health:true,httpLogin:true,session:true,privateDirectoryMode:'0700',realEmailSent:false,binding:'127.0.0.1',persistentRealDataOpened:false},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'passed',checks:'demo startup, HTTP login, cookie, session, directory permissions, shutdown'}));
}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');await exited;}
