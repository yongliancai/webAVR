import {readFile,stat,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {openPostgres} from './database.mjs';
import {createApp} from './app.mjs';
import {createStudio} from './studio/backend.mjs';
import {loadAIProviders} from './ai-config.mjs';
import {createMailDelivery} from './mail-delivery.mjs';

const configPath=process.env.WEBAVR_POSTGRES_CONFIG;
if(!configPath)throw Error('POSTGRES_CONFIG_REQUIRED');
const info=await stat(configPath);if(info.mode&0o077)throw Error('CONFIG_MUST_BE_PRIVATE');
const config=JSON.parse(await readFile(configPath,'utf8'));
// This entry remains a separate acceptance service. No demo seeding or login shortcuts.
if(!/^[a-z][a-z0-9_]*_trial$/.test(config.database?.database??''))throw Error('TRIAL_DATABASE_REQUIRED');
const port=config.port??4400;if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_PORT');
const privateRoot=pathToFileURL(resolve(config.privateRoot)+'/');await mkdir(privateRoot,{recursive:true,mode:0o700});
const db=await openPostgres(config.database);
const ready=(await db.query("SELECT 1 FROM webavr.schema_versions WHERE version='v1.2-local-auth-api'")).rows.length;
if(!ready)throw Error('SCHEMA_INITIALIZATION_REQUIRED');
const delivery=await createMailDelivery(db,config.mail);
const studio=await createStudio(db,{privateRoot,sourceFile:config.sourceFile?pathToFileURL(resolve(config.sourceFile)):null,...await loadAIProviders(config.ai)});
const origin='http://localhost:'+port;
const app=await createApp(db,{origin,secureCookies:false,mailer:delivery.enqueue,studio,google:config.google??null,webRoot:new URL('./public/',import.meta.url)});
await new Promise((ok,no)=>{app.server.once('error',no);app.server.listen(port,'127.0.0.1',ok);});
const timer=setInterval(()=>delivery.tick().catch(()=>{}),2000);timer.unref();
console.log(JSON.stringify({url:origin,engine:'native-postgresql',testLoginShortcuts:false,mailMode:config.mail.mode,productionCutover:false}));
const close=()=>{clearInterval(timer);app.server.close(async()=>{delivery.close();await db.close();process.exit(0);});};process.once('SIGINT',close);process.once('SIGTERM',close);
