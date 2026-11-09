const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {unaccent}=require('@electric-sql/pglite/contrib/unaccent');
test('Postgres migration and marketplace lifecycle with synthetic users',async()=>{
 const db=new PGlite({extensions:{unaccent}});
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'constraints.sql'),'utf8'));
  await db.exec('create extension unaccent;');
  const folder=path.join(__dirname,'../supabase/migrations');
  for(const f of fs.readdirSync(folder).filter(f=>f.includes('harden_marketplace')).sort())await db.exec(fs.readFileSync(path.join(folder,f),'utf8'));
  await db.exec("insert into especialidades(nombre,activa) values('Fletes',true),('Limpieza',true);");
  await db.exec('begin;'+fs.readFileSync(path.join(__dirname,'database.sql'),'utf8')+'rollback;');
 }finally{await db.close();}
});
