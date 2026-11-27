import {isIP} from 'node:net';
export function productionConfig(config){
 if(config.environment!=='production')throw Error('PRODUCTION_ENVIRONMENT_REQUIRED');
 const site=new URL(config.origin);
 if(site.origin!==config.origin||site.protocol!=='https:'||site.username||site.password||isIP(site.hostname)||site.hostname==='localhost')throw Error('PRODUCTION_HTTPS_ORIGIN_REQUIRED');
 if(!/^[a-z][a-z0-9_]*_production$/.test(config.database?.database??''))throw Error('PRODUCTION_DATABASE_REQUIRED');
 if(typeof config.database.host!=='string'||!config.database.host.startsWith('/'))throw Error('PRIVATE_DATABASE_SOCKET_REQUIRED');
 if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('INVALID_PORT');
 if(config.google?.redirectUri!==config.origin+'/api/auth/google/callback')throw Error('PRODUCTION_GOOGLE_CALLBACK_REQUIRED');
 const legacy=new URL(config.legacyUrl);
 if(legacy.protocol!=='https:'||legacy.origin===site.origin||legacy.href!==legacy.origin+'/'||legacy.username||legacy.password)throw Error('SEPARATE_LEGACY_ORIGIN_REQUIRED');
 if(!['disabled','smtp'].includes(config.mail?.mode))throw Error('PRODUCTION_MAIL_MODE_REQUIRED');
 return {origin:site.origin,port:config.port,host:'127.0.0.1',legacyUrl:legacy.href};
}
// The reverse proxy must overwrite X-Real-IP with $remote_addr, never append user headers.
export function clientAddress(remote,headers,trustLoopbackProxy=false){
 const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
 if(trustLoopbackProxy&&local){const address=headers['x-real-ip'];if(typeof address==='string'&&isIP(address))return address;}
 return remote;
}
