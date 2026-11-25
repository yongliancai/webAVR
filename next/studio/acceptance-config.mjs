// The synthetic acceptance service must never bind to a public interface.
export function acceptanceConfig(env=process.env){
 const raw=env.WEBAVR_ACCEPTANCE_PORT??'3998';
 if(!/^\d+$/.test(raw)||Number(raw)<1024||Number(raw)>65535)throw Error('INVALID_ACCEPTANCE_PORT');
 const port=Number(raw);return {port,host:'127.0.0.1',origin:'http://localhost:'+port};
}
