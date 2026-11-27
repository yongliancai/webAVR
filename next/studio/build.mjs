import {build} from 'esbuild';
await build({entryPoints:[new URL('./main.jsx',import.meta.url).pathname],outfile:new URL('../public/studio.js',import.meta.url).pathname,bundle:true,minify:true,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',target:['es2022'],legalComments:'eof'});

await build({entryPoints:[new URL('./learner-main.jsx',import.meta.url).pathname],outfile:new URL('../public/learn.js',import.meta.url).pathname,bundle:true,minify:true,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',target:['es2022'],legalComments:'eof'});

await build({entryPoints:[new URL('./class-learning-main.jsx',import.meta.url).pathname],outfile:new URL('../public/class-learning.js',import.meta.url).pathname,bundle:true,minify:true,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',target:['es2022'],legalComments:'eof'});
