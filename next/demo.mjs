// Synthetic localhost demo only. No real migrated DB or SMTP configuration.
import {PGlite} from '@electric-sql/pglite';
import {mkdir,appendFile,chmod,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createApp} from './app.mjs';
import {seed} from './fixtures.mjs';
import {createStudio} from './studio/backend.mjs';
const port=Number(process.env.WEBAVR_DEMO_PORT??'3000');
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid demo port');
const privateRoot=new URL('./private-studio/',import.meta.url);await mkdir(privateRoot,{recursive:true,mode:0o700});await chmod(privateRoot,0o700);
const db=new PGlite(new URL('database/',privateRoot).pathname);await db.waitReady;
if(!(await db.query("SELECT 1 FROM pg_namespace WHERE nspname='webavr'")).rows.length)await seed(db,new URL('./schema/',import.meta.url));
let sourceFile=new URL('source-catalog.json',privateRoot);try{await access(sourceFile);}catch(e){if(e.code==='ENOENT')sourceFile=null;else throw e;}
const studio=await createStudio(db,{privateRoot,sourceFile});
const folder=new URL('./private-demo/'+randomUUID()+'/',import.meta.url);
await mkdir(folder,{recursive:true,mode:0o700});await chmod(folder,0o700);
const mailer=async mail=>{
 if(!mail.to.endsWith('@example.invalid'))throw Error('Demo recipient restriction');
 const file=new URL('mailbox.jsonl',folder);await appendFile(file,JSON.stringify(mail)+'\n',{mode:0o600});
};
const origin='http://127.0.0.1:'+port;
const {server}=await createApp(db,{origin,secureCookies:false,mailer,studio,webRoot:new URL('./public/',import.meta.url)});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
console.log(JSON.stringify({mode:'local-authoring-with-private-source-catalog',url:origin+'/',mailboxDirectory:folder.pathname,notice:'Synthetic login accounts; real legacy teaching catalog is admin-only. Drafts persist locally. No SMTP or production changes.'}));
const close=()=>server.close(async()=>{await db.close();process.exit(0);});
process.once('SIGINT',close);process.once('SIGTERM',close);
