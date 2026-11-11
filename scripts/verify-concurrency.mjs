// Isolated synthetic cluster. Install embedded-postgres@18.6.0-beta.19 in a
// temporary directory and set CHAMBA_PG_TOOLS to that directory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(process.env.CHAMBA_PG_TOOLS,'node_modules/embedded-postgres/dist/index.js')));
const work=await fs.mkdtemp('/tmp/chamba-concurrency-');
const config={databaseDir:path.join(work,'db'),user:'postgres',password:randomUUID(),port:55439,persistent:true,postgresFlags:['-h','127.0.0.1','-c','unix_socket_directories='],onLog(message){if(process.env.CHAMBA_PG_DEBUG)console.error(message);},onError:console.error};
let pg=new EmbeddedPostgres(config),clients=[];
const connect=async()=>{const c=pg.getPgClient();await c.connect();clients.push(c);return c;};
const closeClients=async()=>{await Promise.all(clients.map(c=>c.end()));clients=[];};
const call=(c,name,args)=>c.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);
const fingerprint=async c=>{
 const tables=(await c.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
 const out={};for(const {tablename:t} of tables)out[t]=(await c.query(`select md5(coalesce(string_agg(row::text, '' order by row::text),'')) digest,count(*)::int count from (select to_jsonb(t) row from public."${t}" t) s`)).rows[0];return out;
};
try{
 await pg.initialise();await pg.start();const c=await connect();
 await c.query(await fs.readFile(path.join(root,'tests/schema.sql'),'utf8'));
 await c.query(await fs.readFile(path.join(root,'tests/constraints.sql'),'utf8'));
 await c.query('create extension unaccent');
 for(const f of (await fs.readdir(path.join(root,'supabase/migrations'))).sort())await c.query(await fs.readFile(path.join(root,'supabase/migrations',f),'utf8'));
 await c.query("insert into especialidades(nombre,activa) values('Fletes',true)");
 const cli=randomUUID(),soc=randomUUID(),job=randomUUID();
 for(const [id,tipo] of [[cli,'cliente'],[soc,'socio']])await c.query("insert into usuarios(id,nombre,email,tipo,estado,email_verificado,especialidad) values($1,'Synthetic',$2,$3,'aprobado',true,'Fletes')",[id,id+'@example.invalid',tipo]);
 await c.query("insert into ubicaciones(usuario_id,etiqueta,direccion,lat,lng,predeterminada) values($1,'Casa','Synthetic',-34.6,-58.4,true)",[soc]);
 await c.query("insert into pedidos(id,usuario_id,servicio,descripcion,estado,lat,lng) values($1,$2,'Fletes','Synthetic','nuevo',-34.6,-58.4)",[job,cli]);
 const offer=(await call(c,'chamba_job_action',[soc,'offer',job,{precio:10000}])).rows[0].result.id;
 const peers=await Promise.all(Array.from({length:8},connect));
 await Promise.all(peers.map(p=>call(p,'chamba_job_action',[cli,'accept',offer,{codigo:'1234',acepto_aviso:true,aviso_version:'custodia-v2'}])));
 assert.equal((await c.query('select count(*)::int n from custodias where pedido_id=$1',[job])).rows[0].n,1);
 await Promise.all(peers.map(p=>call(p,'chamba_job_action',[soc,'finish',job,{codigo:'1234'}])));
 await c.query("update custodias set reclamo_hasta=clock_timestamp()-interval '1 second' where pedido_id=$1",[job]);
 await Promise.all(peers.map(p=>call(p,'chamba_tick',[])));
 assert.equal(Number((await c.query('select saldo_disponible from usuarios where id=$1',[soc])).rows[0].saldo_disponible),8700);
 assert.equal((await c.query("select count(*)::int n from libro_contable where pedido_id=$1 and destino='comisiones'",[job])).rows[0].n,1);
 const withdrawals=await Promise.allSettled(peers.map(p=>call(p,'chamba_withdraw',[soc,{request_id:randomUUID(),centavos:870000,destino:'Synthetic',motivo:'Concurrency test'}])));
 assert.equal(withdrawals.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(Number((await c.query('select saldo_disponible from usuarios where id=$1',[soc])).rows[0].saldo_disponible),0);
 const email=cli+'@example.invalid',hash='a'.repeat(64);
 await call(c,'chamba_issue_code',[email,'login',hash]);
 const codes=await Promise.all(peers.map(p=>call(p,'chamba_consume_code',[email,'login',hash])));
 assert.equal(codes.filter(r=>r.rows[0].result.ok).length,1);
 const before=await fingerprint(c);
 await closeClients();await pg.stop();
 await fs.cp(config.databaseDir,path.join(work,'restored'),{recursive:true});
 pg=new EmbeddedPostgres({...config,databaseDir:path.join(work,'restored')});await pg.start();
 assert.deepEqual(await fingerprint(await connect()),before);
 console.log(JSON.stringify({postgres:'18.6 (isolated; production is 17)',connections:8,checks:['accept once','finish once','settle once','withdraw without overdraft','OTP consumed once','stopped-cluster backup restored with identical public row counts and digests'],productionBackupVerified:false}));
}catch(error){console.error(error);process.exitCode=1;}finally{await closeClients();await pg.stop().catch(()=>{});await fs.rm(work,{recursive:true,force:true});}
