// Isolated localhost UI verification, with synthetic accounts and no legacy data.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../app.mjs';
import {seed} from '../fixtures.mjs';
import {createStudio} from './backend.mjs';
const folder=await mkdtemp(join(tmpdir(),'webavr-session-browser-')),db=new PGlite();await db.waitReady;await seed(db,new URL('../schema/',import.meta.url));const studio=await createStudio(db,{privateRoot:pathToFileURL(folder+'/')});const {server}=await createApp(db,{origin:'http://localhost:3997',secureCookies:false,mailer:async()=>{},studio,webRoot:new URL('../public/',import.meta.url),authLimit:100,writeLimit:1000});await new Promise(resolve=>server.listen(3997,'127.0.0.1',resolve));console.log(JSON.stringify({url:'http://localhost:3997',synthetic:true,privateLegacyData:false}));
process.once('SIGINT',()=>server.close(async()=>{await db.close();await rm(folder,{recursive:true,force:true});process.exit(0);}));
