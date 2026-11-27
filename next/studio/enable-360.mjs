import {PGlite} from '@electric-sql/pglite';
import {pathToFileURL} from 'node:url';
// User confirmed legacy scene images are panoramas. Preserve views, IDs and maps.
export async function enable360Scenes(db){
 let drafts=0,scenes=0;
 await db.transaction(async tx=>{
  const rows=(await tx.query('SELECT id,revision,document FROM studio.drafts FOR UPDATE')).rows;
  for(const r of rows){const d=r.document;let n=0;for(const s of d.scenes){if(s.projection==='unknown'||!s.projection){s.projection='equirectangular';n++;}}if(!n)continue;
   const saved=await tx.query('UPDATE studio.drafts SET document=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING revision',[d,r.id,r.revision]);
   if(saved.rows.length!==1)throw Error('REVISION_CONFLICT');
   await tx.query('INSERT INTO studio.revisions(draft_id,revision,document) VALUES($1,$2,$3)',[r.id,saved.rows[0].revision,d]);drafts++;scenes+=n;
  }
 });return {draftsUpdated:drafts,scenesEnabled:scenes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const db=new PGlite(new URL('../private-studio/database/',import.meta.url).pathname);await db.waitReady;try{console.log(JSON.stringify(await enable360Scenes(db)));}finally{await db.close();}}
