const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const source=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
const client={id:'11111111-1111-4111-8111-111111111111',tipo:'cliente'},partner={id:'22222222-2222-4222-8222-222222222222',tipo:'socio'},stranger={id:'33333333-3333-4333-8333-333333333333',tipo:'cliente'},job='44444444-4444-4444-8444-444444444444';
function harness(responses=[],current){
 const calls=[];let activeUser;
 const sandbox={console,Buffer,AbortSignal,setInterval(){},setTimeout,clearTimeout,module:{exports:{}},process:{env:{JWT_SECRET:'test-secret'},on(){}},
 require(name){if(name==='./instrument')return {};if(name==='@sentry/node')return {setupExpressErrorHandler(){}};if(name==='./emailService')return new Proxy({},{get:()=>async()=>{}});return require(name);},
 mockSb:async(...args)=>{if(args[0].includes('&select=id,tipo,email,nombre,estado,email_verificado,session_version,especialidad'))return current instanceof Error?Promise.reject(current):[current||{...activeUser,estado:'aprobado',email_verificado:true,session_version:0}];calls.push(args);const out=responses.shift();if(out instanceof Error)throw out;return out||[];}};
 const a=source.indexOf('const sb = async'),b=source.indexOf('function signToken',a);
 vm.runInNewContext(source.slice(0,a)+'const sb=mockSb;\n'+source.slice(b),sandbox);
 return {calls,async request(verb,path,user,body){activeUser=user;let r=request(sandbox.module.exports)[verb](path);if(user)r=r.set('Authorization','Bearer '+jwt.sign({mfa:user.tipo==='admin',...user,sv:0},'test-secret'));if(body)r=r.send(body);return r;}};
}
const chat={usuario_id:client.id,profesional_id:partner.id,chat_habilitado:true,revision:2};
test('chat denies anonymous and unrelated users without reading messages',async()=>{
 for(const user of [null,stranger]){const h=harness([[chat]]);const r=await h.request('get','/api/mensajes/'+job,user);assert.equal(r.status,user?403:401);assert.ok(h.calls.every(c=>!c[0].startsWith('mensajes')));}
});
test('both participants can read enabled chat, scoped to its current assignment',async()=>{
 for(const user of [client,partner])for(const enabled of [true,false]){const h=harness([[{...chat,chat_habilitado:enabled}],[{contenido:'hola'}]]);const r=await h.request('get','/api/mensajes/'+job,user);assert.equal(r.status,enabled?200:403);if(enabled){assert.equal(r.body[0].contenido,'hola');assert.match(h.calls[1][0],/revision=eq.2/);}}
});
test('registration rejects privileged roles without database access',async()=>{
 for(const tipo of ['admin','other',undefined]){const h=harness();const r=await h.request('post','/api/usuarios/registro',null,{tipo,nombre:'Test',email:'test@example.invalid'});assert.equal(r.status,400);assert.equal(h.calls.length,0);}
});
test('profile cannot change privileges, balances or password',async()=>{
 for(const field of ['tipo','estado','saldo_disponible','saldo_bloqueado','password_hash','email_verificado']){const h=harness();const r=await h.request('patch','/api/usuarios/'+client.id,client,{[field]:'bad'});assert.equal(r.status,403);assert.equal(h.calls.length,0);}
});
test('profile editing works and omits password hashes',async()=>{
 const h=harness([[client],[{...client,nombre:'Nuevo',password_hash:'secret'}]]);const r=await h.request('patch','/api/usuarios/'+client.id,client,{nombre:'Nuevo',telefono:'123'});assert.equal(r.status,200);assert.equal(r.body[0].nombre,'Nuevo');assert.equal(r.body[0].password_hash,undefined);
});
test('users and license requests are scoped to caller; admins retain access',async()=>{
 for(const path of ['/api/usuarios','/api/solicitudes-matricula'])for(const user of [client,{...stranger,tipo:'admin'}]){const h=harness();const r=await h.request('get',path+'?socio_id='+partner.id,user);assert.equal(r.status,200);assert.equal(h.calls[0][0].includes('eq.'+client.id),user.tipo!=='admin');}
});
test('suspension, changed sessions and changed roles revoke old tokens',async()=>{
 for(const patch of [{estado:'suspendido'},{session_version:1},{tipo:'admin'}]){const h=harness([],{...client,estado:'aprobado',email_verificado:true,session_version:0,...patch});assert.equal((await h.request('get','/api/usuarios',client)).status,401);assert.equal(h.calls.length,0);}
});
test('temporary database failure does not report an expired session',async()=>{
 const h=harness([],Object.assign(Error('offline'),{status:503}));assert.equal((await h.request('get','/api/usuarios',client)).status,503);
});
test('pedido patch cannot assign partner, payment, code or balances',async()=>{
 for(const data of [{profesional_id:partner.id},{estado_pago:'pagado'},{codigo_verificacion:'1234'},{estado:'completado'},{estado:'cancelado',dinero_liberado:true}]){const h=harness();assert.equal((await h.request('patch','/api/pedidos/'+job,client,data)).status,403);assert.equal(h.calls.length,0);}
});
test('pedido creation uses owned location and ignores privileged input',async()=>{
 const loc='55555555-5555-4555-8555-555555555555';const h=harness([[{id:loc}],[{id:loc,direccion:'Dirección',lat:-34,lng:-58}],[]]);
 const r=await h.request('post','/api/pedidos',client,{servicio:'Fletes',ubicacion_id:loc,descripcion:'Mudanza',estado:'completado',profesional_id:partner.id,codigo_verificacion:'1234',dinero_liberado:true});
 assert.equal(r.status,200);const payload=h.calls.find(c=>c[1]==='POST')[2];assert.equal(payload.estado,'nuevo');assert.equal(payload.usuario_id,client.id);for(const k of ['profesional_id','codigo_verificacion','dinero_liberado'])assert.equal(payload[k],undefined);
});
test('malformed IDs and anonymous AI requests are rejected before data access',async()=>{
 const h=harness();assert.equal((await h.request('get','/api/mensajes/not-a-uuid',client)).status,400);assert.equal((await h.request('post','/api/analizar',null,{})).status,401);assert.equal(h.calls.length,0);
});
test('assigned partner never receives completion code',async()=>{
 const h=harness([[{...chat,id:job,estado:'en_proceso',codigo_verificacion:'1234'}],[],[]]);const r=await h.request('get','/api/pedidos',partner);assert.equal(r.status,200);assert.equal(r.body[0].codigo_verificacion,undefined);
});
test('chat pages return the latest 50 messages in chronological order with bounded database reads',async()=>{
 const rows=Array.from({length:51},(_,i)=>({id:`77777777-7777-4777-8777-${String(100-i).padStart(12,'0')}`,created_at:'2026-11-01T12:00:00.123456+00:00',contenido:String(100-i)}));
 const h=harness([[chat],rows]),r=await h.request('get','/api/mensajes/'+job+'?page=true',client);
 assert.equal(r.status,200);assert.equal(r.body.messages.length,50);assert.equal(r.body.messages[0].contenido,'51');assert.equal(r.body.messages.at(-1).contenido,'100');
 assert.ok(r.body.next_before);assert.match(h.calls[1][0],/limit=51/);assert.match(h.calls[1][0],/revision=eq.2/);
 const cursor=JSON.parse(Buffer.from(r.body.next_before,'base64url').toString());assert.equal(cursor.at,rows[0].created_at);assert.equal(cursor.revision,2);
 const next=harness([[chat],[]]);assert.equal((await next.request('get','/api/mensajes/'+job+'?page=true&before='+r.body.next_before,partner)).status,200);
 assert.match(next.calls[1][0],/created_at\.lt\./);assert.match(next.calls[1][0],/id\.lt\./);
});
test('chat rejects malformed cursors and resets cursors from a previous assignment',async()=>{
 for(const cursor of ['invalid',Buffer.from(JSON.stringify({at:'2026-01-01)or(true)',id:job,revision:2})).toString('base64url')]){
  const h=harness([[chat]]);assert.equal((await h.request('get','/api/mensajes/'+job+'?page=true&after='+cursor,client)).status,400);assert.equal(h.calls.length,1);
 }
 const cursor=Buffer.from(JSON.stringify({at:'2026-11-01T12:00:00Z',id:job,revision:1})).toString('base64url'),h=harness([[chat]]);
 const r=await h.request('get','/api/mensajes/'+job+'?page=true&after='+cursor,client);assert.equal(r.status,200);assert.equal(r.body.reset,true);assert.equal(h.calls.length,1);
});

test('limited sessions can consult their wallet but cannot operate normal marketplace routes',async()=>{
 const current={...client,estado:'baja',email_verificado:true,session_version:0};
 let h=harness([[current]],current);let r=await h.request('get','/api/custodia/me',{...client,scope:'limited'});assert.equal(r.status,200);
 for(const [verb,path] of [['get','/api/usuarios'],['post','/api/pedidos'],['get','/api/mensajes/'+job]]){h=harness([],current);r=await h.request(verb,path,{...client,scope:'limited'},{});assert.equal(r.status,403);assert.equal(h.calls.length,0);}
});
test('claim detail denies strangers before reading private attachments or identity',async()=>{
 const h=harness([[{id:job,creado_por:client.id,contra_id:partner.id,pedido_id:job}]]);const r=await h.request('get','/api/reclamos/'+job,stranger);assert.equal(r.status,404);assert.equal(h.calls.length,1);
});
test('inactive administrators cannot use limited sessions to read all claims or platform balances',async()=>{
 for(const estado of ['suspendido','baja'])for(const path of ['/api/reclamos','/api/reclamos/'+job,'/api/saldo','/api/custodia/trabajos']){
  const admin={...stranger,tipo:'admin',scope:'limited'};
  const h=harness([],{...admin,estado,email_verificado:true,session_version:0});
  const r=await h.request('get',path,admin);
  assert.equal(r.status,403);assert.equal(h.calls.length,0);
 }
});
test('claim upload rejects PDFs and invalid MIME before storage or writes',async()=>{
 const h=harness();const r=await h.request('post','/api/reclamos',client,{pedido_id:job,tipo:'dinero',descripcion:'Prueba',request_id:job,adjuntos:[{mime:'application/pdf',data:'JVBERi0='}]});assert.equal(r.status,400);assert.equal(h.calls.length,0);
});
test('new claim takes actor from live session and only whitelists business fields',async()=>{
 const h=harness([[],{id:job}]);const r=await h.request('post','/api/reclamos',client,{pedido_id:job,tipo:'dinero',descripcion:'Prueba',request_id:job,p_actor:partner.id,estado:'finalizado',comision:0});assert.equal(r.status,200);const call=h.calls.find(c=>c[0]==='rpc/chamba_claim');assert.equal(call[2].p_actor,client.id);assert.equal(call[2].p_data.estado,undefined);assert.equal(call[2].p_data.comision,undefined);
});
test('withdrawal requires password reauthentication and no financial RPC is called on failure',async()=>{
 const h=harness([[{password_hash:require('bcryptjs').hashSync('correct-password',4)}]]);const r=await h.request('post','/api/saldo/retirar',client,{password:'wrong',request_id:job,centavos:100,destino:'Test',motivo:'Test'});assert.equal(r.status,403);assert.ok(h.calls.every(c=>!c[0].startsWith('rpc/')));
});
test('deleting an account now calls logical deactivation and requires a reason',async()=>{
 const admin={...stranger,tipo:'admin'};let h=harness();let r=await h.request('delete','/api/usuarios/'+client.id,admin,{});assert.equal(r.status,400);assert.equal(h.calls.length,0);
 h=harness([{ok:true}]);r=await h.request('delete','/api/usuarios/'+client.id,admin,{motivo:'Conducta comprobada'});assert.equal(r.status,200);assert.equal(h.calls[0][0],'rpc/chamba_account');assert.equal(h.calls[0][2].p_state,'baja');
});
test('notification worker is inaccessible without its server secret',async()=>{const h=harness();const r=await h.request('post','/api/internal/notificaciones',client,{});assert.equal(r.status,401);assert.equal(h.calls.length,0);});

test('admin sessions without second factor and challenge tokens cannot access APIs',async()=>{
 for(const user of [{...stranger,tipo:'admin',mfa:false},{...stranger,tipo:'admin',scope:'admin_challenge'}]){
  const h=harness();const r=await h.request('get','/api/usuarios',user);assert.equal(r.status,401);assert.equal(h.calls.length,0);
 }
});
test('admin passwordless code issuance and verification cannot bypass second factor',async()=>{
 const admin={...stranger,tipo:'admin',email:'admin@example.invalid',estado:'aprobado',email_verificado:true};
 let h=harness([[admin]]);let r=await h.request('post','/api/enviar-codigo',null,{identificador:admin.email,tipo:'login'});assert.equal(r.status,403);assert.equal(h.calls.length,1);
 for(const challenge of [undefined,'forged',jwt.sign({id:admin.id,email:admin.email,sv:0,scope:'full'},'test-secret')]){
  h=harness([[admin]]);r=await h.request('post','/api/verificar-codigo',null,{email:admin.email,codigo:'123456',tipo:'login',challenge});assert.equal(r.status,401);assert.equal(h.calls.length,1);
 }
});
test('admin password and challenge-bound email code produce a short-lived verified session',async()=>{
 const admin={...stranger,tipo:'admin',email:'admin@example.invalid',estado:'aprobado',email_verificado:true,password_hash:await require('bcryptjs').hash('Example123!',4)};
 const h=harness([[admin],{ok:true}]);const r=await h.request('post','/api/usuarios/login',null,{identificador:admin.email,password:'Example123!'});
 assert.equal(r.status,200);assert.equal(r.body.requires_mfa,true);assert.equal(r.body.token,undefined);assert.equal(r.body.usuario,undefined);
 const challenge=jwt.verify(r.body.challenge,'test-secret');assert.equal(challenge.scope,'admin_challenge');assert.equal(challenge.exp-challenge.iat,600);
 const v=harness([[admin],{ok:true}]);const result=await v.request('post','/api/verificar-codigo',null,{email:admin.email,codigo:'123456',tipo:'login',challenge:r.body.challenge});
 assert.equal(result.status,200);const session=jwt.verify(result.body.token,'test-secret');assert.equal(session.mfa,true);assert.equal(session.exp-session.iat,3600);assert.equal(result.body.usuario.password_hash,undefined);
 assert.equal(v.calls[1][2].p_hash,require('node:crypto').createHash('sha256').update(challenge.nonce+':123456').digest('hex'));
});
