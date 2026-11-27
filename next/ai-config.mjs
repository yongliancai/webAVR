import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {createTutorProvider} from './studio/tutor-provider.mjs';
import {createImageProvider} from './studio/image-provider.mjs';

// Read only the existing server credential. Never copy it into service JSON, logs or browser data.
export async function loadAIProviders(config,{fetchImpl=fetch}={}){
 if(!config||config.enabled===false)return {tutorProvider:{configured:false},imageProvider:{configured:false,model:'disabled'}};
 if(config.enabled!==true||!isAbsolute(config.keyFile??''))throw Error('INVALID_AI_CONFIG');
 const info=await lstat(config.keyFile);
 if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o022)||info.size>65536)throw Error('INVALID_AI_KEY_SOURCE');
 let key;
 try{key=parseEnv(await readFile(config.keyFile,'utf8')).OPENAI_API_KEY?.trim();}catch{throw Error('INVALID_AI_KEY_SOURCE');}
 if(!key||key.length>1024||/[\r\n]/.test(key))throw Error('AI_KEY_MISSING');
 const tutorModel=config.tutorModel??'gpt-4.1-mini',imageModel=config.imageModel??'gpt-image-2.5-flare';
 if(![tutorModel,imageModel].every(x=>typeof x==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(x)))throw Error('INVALID_AI_MODEL');
 return {tutorProvider:createTutorProvider({key,model:tutorModel,fetchImpl}),imageProvider:createImageProvider({key,model:imageModel,fetchImpl})};
}
