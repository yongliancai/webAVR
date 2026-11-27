import assert from 'node:assert/strict';
import {acceptanceConfig} from './acceptance-config.mjs';
assert.deepEqual(acceptanceConfig({}),{port:3998,host:'127.0.0.1',origin:'http://localhost:3998'});
assert.deepEqual(acceptanceConfig({WEBAVR_ACCEPTANCE_PORT:'4398'}),{port:4398,host:'127.0.0.1',origin:'http://localhost:4398'});
for(const port of ['0','80','65536','4398x','4398;echo','-4398','1e4',''])assert.throws(()=>acceptanceConfig({WEBAVR_ACCEPTANCE_PORT:port}));
assert.equal(acceptanceConfig({HOST:'0.0.0.0',WEBAVR_ACCEPTANCE_ORIGIN:'https://public.example'}).host,'127.0.0.1');
console.log('11 acceptance configuration checks passed');
