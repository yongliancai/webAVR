import pg from 'pg';

// Keep the interface used by PGlite; pin every transaction to one connection.
export async function openPostgres(config){
 const pool=new pg.Pool({...config,max:5,connectionTimeoutMillis:10000,
  statement_timeout:120000,idle_in_transaction_session_timeout:180000,
  types:{getTypeParser(oid,format){
   if([1082,1114,1184].includes(oid))return value=>oid===1082?value:new Date(value).toISOString();
   return pg.types.getTypeParser(oid,format);
  }}});
 pool.on('error',()=>{}); // Requests fail normally; do not log connection credentials.
 const db={query:(sql,values=[])=>pool.query(sql,values),exec:sql=>pool.query(sql),close:()=>pool.end(),
  async transaction(fn){
   const client=await pool.connect();let broken=false;
   try{await client.query('BEGIN');const value=await fn({query:(sql,values=[])=>client.query(sql,values),exec:sql=>client.query(sql)});await client.query('COMMIT');return value;}
   catch(error){try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
   finally{client.release(broken);}
  }};
 try{await db.query('SELECT 1');return db;}catch(e){await db.close();throw e;}
}
