import {courseId,record} from '../public/course-schema.mjs';
// Read grants each request so revocation takes effect without restarting the server.
export async function sourceAccess(db,source,user){
 const admin=user.roles.includes('admin');
 const grants=admin?[]:(await db.query('SELECT course_id FROM studio.source_grants WHERE user_id=$1 AND revoked_at IS NULL',[user.id])).rows;
 const ids=new Set(grants.map(g=>g.course_id));
 const courses=source.courses.filter(c=>record(c)&&courseId(c.id)&&(admin||ids.has(c.id)));
 const assets=new Set(),activities=new Set();
 for(const c of courses){
  for(const id of [c.coverAssetId,c.coverPackageAssetId])if(courseId(id))assets.add(id);
  for(const m of Array.isArray(c.maps)?c.maps:[])for(const id of [m?.assetId,m?.packageAssetId])if(courseId(id))assets.add(id);
  for(const s of Array.isArray(c.scenes)?c.scenes:[]){
   for(const id of [s?.assetId,s?.packageAssetId])if(courseId(id))assets.add(id);
   for(const h of Array.isArray(s?.hotspots)?s.hotspots:[]){
    if(courseId(h?.id))activities.add(h.id);
    for(const id of Array.isArray(h?.assetIds)?h.assetIds:[])if(courseId(id))assets.add(id);
   }
  }
 }
 // A package grant only covers the registered children of a referenced package.
 if(assets.size)for(const row of (await db.query('SELECT asset_id FROM studio.package_entries WHERE package_id=ANY($1::uuid[])',[[...assets]])).rows)assets.add(row.asset_id);
 return {admin,courses,assets,activities,canRead:admin||courses.length>0,hasCourse:id=>admin||courses.some(c=>c.id===id),hasAsset:id=>admin||assets.has(id)};
}
