import assert from 'node:assert/strict';
import {provideCourse,matchingShare} from './share-requests.mjs';
import {mediaRevisionQuery,mediaDownloadUrl} from './lesson-media.mjs';
let count=0;const ok=(v,label)=>{assert.ok(v,label);count++;console.log('PASS '+label);};
const row={id:'lesson',class_id:'class',revision:2,active:true},opts={courseId:'course',classId:'class',revision:2,active:true};
const failed=()=>{throw Object.assign(Error('connection lost'),{code:'NETWORK'});};
let writes=0;const recover=await provideCourse({...opts,api:async(p,body)=>{if(body){writes++;return failed();}return {items:[row]};}});ok(recover.confirmed&&recover.recovered&&writes===1&&recover.lessonId==='lesson','lost publication acknowledgment is reconciled by read without another write');
const uncertain=await provideCourse({...opts,api:failed});ok(uncertain.uncertain&&!uncertain.confirmed,'offline publication remains uncertain');
const stale=await provideCourse({...opts,api:async(p,body)=>body?failed():{items:[{...row,revision:1}]}});ok(!stale.confirmed,'older published revision does not confirm new publication');
const ack=await provideCourse({...opts,api:async(p,body)=>body?{status:'shared',id:'lesson',revision:2}:failed()});ok(ack.confirmed&&ack.acknowledged&&!ack.recovered&&ack.lessonId==='lesson','successful acknowledgment survives failed refresh');
for(const status of [403,409]){let reads=0;await assert.rejects(provideCourse({...opts,api:async(p,body)=>{if(body)throw Object.assign(Error('denied'),{status});reads++;return {items:[row]};}}),e=>e.status===status);ok(reads===0,'known '+status+' is not masked by stale shares');}
const withdrawn=await provideCourse({...opts,active:false,api:async(p,body)=>body?failed():{items:[{...row,active:false}]}});ok(withdrawn.confirmed&&withdrawn.recovered,'lost withdrawal acknowledgment is confirmed read-only');
const invalidTransport=await provideCourse({...opts,api:async(p,body)=>{if(body)throw Object.assign(Error('bad response'),{code:'INVALID_RESPONSE'});return {items:[row]};}});ok(invalidTransport.recovered,'transport format failure reconciles publication result');
const invalid=await provideCourse({...opts,api:async(p,body)=>body?{}:{items:[row]}});ok(invalid.recovered,'malformed acknowledgment requires independent confirmation');
ok(!matchingShare([row],{...opts,classId:'other'}),'another class cannot confirm publication');
ok(mediaRevisionQuery(2)==='?revision=2'&&mediaRevisionQuery(undefined)==='','media version suffix preserves teacher URLs');
for(const value of [0,-1,2.5,'2',2147483648])assert.throws(()=>mediaRevisionQuery(value));ok(true,'invalid media revision cannot enter viewer URLs');
ok(mediaDownloadUrl('/files/a?revision=2')==='/files/a?revision=2&download=1'&&mediaDownloadUrl('/files/a')==='/files/a?download=1','downloads preserve snapshot query and teacher URL');
console.log(JSON.stringify({passed:count}));
