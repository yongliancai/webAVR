import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadAIProviders} from './ai-config.mjs';
const dir=await mkdtemp(join(tmpdir(),'wa-ai-config-'));
try{
 assert.equal((await loadAIProviders()).tutorProvider.configured,false);
 assert.equal((await loadAIProviders({enabled:false,keyFile:'/does-not-exist'})).imageProvider.configured,false);
 await assert.rejects(loadAIProviders({enabled:true,keyFile:'relative.env'}),/INVALID_AI_CONFIG/);
 const keyFile=join(dir,'existing.env');await writeFile(keyFile,'OPENAI_API_KEY="synthetic-not-a-real-key"\nOTHER_SECRET=must-not-use\n',{mode:0o600});let request;
 const provider=await loadAIProviders({enabled:true,keyFile},{fetchImpl:async(url,init)=>{request={url,init};return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'checked'}]}]}));}});
 assert.equal(provider.tutorProvider.configured,true);assert.equal(provider.imageProvider.configured,true);
 assert.equal(await provider.tutorProvider.respond({instructions:'rules',input:[],short:true}),'checked');
 assert.equal(request.init.headers.Authorization,'Bearer synthetic-not-a-real-key');assert.equal(JSON.parse(request.init.body).store,false);assert(!request.init.body.includes('OTHER_SECRET'));
 assert(!JSON.stringify(provider).includes('synthetic-not-a-real-key'));
 await assert.rejects(loadAIProviders({enabled:true,keyFile,imageModel:'bad\nmodel'}),/INVALID_AI_MODEL/);
 await chmod(keyFile,0o666);await assert.rejects(loadAIProviders({enabled:true,keyFile}),/INVALID_AI_KEY_SOURCE/);await chmod(keyFile,0o600);
 await symlink(keyFile,join(dir,'link.env'));await assert.rejects(loadAIProviders({enabled:true,keyFile:join(dir,'link.env')}),/INVALID_AI_KEY_SOURCE/);
 await writeFile(keyFile,'OTHER_SECRET=never-use-as-api-key\n');await assert.rejects(loadAIProviders({enabled:true,keyFile}),/AI_KEY_MISSING/);
 console.log('AI config: explicit opt-in, existing credential isolation, no secret serialization and invalid-source checks passed.');
}finally{await rm(dir,{recursive:true,force:true});}
