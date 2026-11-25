// Correct primary-entity provenance after excluding composite relation anchors.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const root=new URL('../private-studio/',import.meta.url);const db=new PGlite(new URL('database/',root).pathname);await db.waitReady;
const source=JSON.parse(await readFile(new URL('source-catalog.json',root),'utf8'));
let count=0;
for(const r of (await db.query('SELECT id,revision,document FROM studio.drafts')).rows){const d=r.document,c=source.courses.find(x=>x.id===d.sourceId);if(!c)continue;const before=JSON.stringify(d);d.source=c.source;const entities=[...c.maps,...c.scenes,...c.scenes.flatMap(s=>s.hotspots),...source.unlinked.maps,...source.unlinked.tours.flatMap(t=>t.scenes),...source.unlinked.tours.flatMap(t=>t.scenes.flatMap(s=>s.hotspots))];const index=new Map(entities.map(x=>[x.id,x]));for(const x of [...d.maps,...d.scenes,...d.scenes.flatMap(s=>s.hotspots)]){if(index.has(x.id))x.source=index.get(x.id).source;}if(before===JSON.stringify(d))continue;await db.transaction(async tx=>{await tx.query('UPDATE studio.drafts SET document=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3',[d,r.id,r.revision]);await tx.query('INSERT INTO studio.revisions(draft_id,revision,document) VALUES($1,$2,$3)',[r.id,r.revision+1,d]);});count++;}
console.log(JSON.stringify({correctedLocalDraftProvenance:count}));await db.close();
