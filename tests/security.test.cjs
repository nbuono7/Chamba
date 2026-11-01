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
 return {calls,async request(verb,path,user,body){activeUser=user;let r=request(sandbox.module.exports)[verb](path);if(user)r=r.set('Authorization','Bearer '+jwt.sign({...user,sv:0},'test-secret'));if(body)r=r.send(body);return r;}};
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
