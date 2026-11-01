const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const request=require('supertest');
const jwt=require('jsonwebtoken');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const uid='11111111-1111-4111-8111-111111111111';
const image={data:Buffer.from([255,216,255,0]).toString('base64'),mime:'image/jpeg'};
const json=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

function harness(kind,mode){
 const calls=[];let saved,uploads=0;
 const user={id:uid,tipo:kind==='identity'?'socio':'cliente',nombre:'Prueba',email:'test@example.invalid',estado:'aprobado',email_verificado:true,session_version:0};
 const sandbox={console:{log(){},warn(){},error(){}},Buffer,AbortSignal,setInterval(){},setTimeout,clearTimeout,module:{exports:{}},process:{env:{JWT_SECRET:'test-secret',SUPABASE_URL:'https://test.invalid'},on(){}},
 require(name){if(name==='./instrument')return {};if(name==='@sentry/node')return {setupExpressErrorHandler(){}};if(name==='./emailService')return new Proxy({},{get:()=>async()=>{}});return require(name);},
 mockFetch:async(url,options={})=>{
  const parsed=new URL(url),method=options.method||'GET';calls.push({url,method,body:options.body});
  if(parsed.pathname.includes('/storage/')){
   if(method==='POST'&&++uploads===2&&mode==='upload-timeout')throw Error('upload response lost');
   return json({});
  }
  if(method==='POST'){
   saved=JSON.parse(options.body);
   if(mode==='rejected')return json({code:'P0001',message:'Solicitud rechazada'},400);
   if(mode==='gateway-error')return json({message:'upstream unavailable'},502);
   throw Error('response lost after sending write');
  }
  if(parsed.search.includes('session_version')){
   if(mode==='auth-outage')throw Error('network unavailable');
   if(mode==='auth-bad-json')return {ok:true,status:200,json:async()=>{throw SyntaxError('invalid upstream response');}};
   return json([user]);
  }
  if(parsed.pathname.endsWith('/especialidades'))return json([{nombre:'Fletes'}]);
  if(parsed.search==='?id=eq.'+uid+'&select=*')return json([user]);
  if(mode==='read-outage')throw Error('confirmation unavailable');
  if(mode==='committed')return json([kind==='identity'?saved:{id:uid}]);
  return json([]);
 }};
 vm.runInNewContext(source.replace(/^const fetch = async .*$/m,'const fetch=mockFetch;'),sandbox);
 return {calls,send(){const endpoint=kind==='identity'?'/api/verificaciones-identidad':'/api/usuarios/solicitar-socio';const body=kind==='identity'?{monotributo:image,facturas:[image]}:{dni:'12345678',especialidad:'Fletes',experiencia:'2',dni_foto:image,foto_perfil:image};return request(sandbox.module.exports).post(endpoint).set('Authorization','Bearer '+jwt.sign({...user,sv:0},'test-secret')).send(body);}};
}

for(const kind of ['identity','partner']){
 test(kind+': lost write response preserves committed documents and reports success',async()=>{
  const h=harness(kind,'committed'),res=await h.send();assert.equal(res.status,200);assert.ok(h.calls.every(c=>c.method!=='DELETE'));
 });
 test(kind+': uncertain transaction or unavailable confirmation never deletes documents',async()=>{
  for(const mode of ['pending','read-outage','gateway-error']){const h=harness(kind,mode),res=await h.send();assert.equal(res.status,500);assert.ok(h.calls.every(c=>c.method!=='DELETE'));}
 });
 test(kind+': definitive rejected write cleans only this attempt’s uploads',async()=>{
  const h=harness(kind,'rejected');assert.equal((await h.send()).status,500);
  const removed=h.calls.find(c=>c.method==='DELETE');assert.ok(removed);const files=JSON.parse(removed.body).prefixes;assert.equal(files.length,2);assert.ok(files.every(f=>f.startsWith(uid+'/')));
 });
 test(kind+': interrupted second upload cleans both paths before any database write',async()=>{
  const h=harness(kind,'upload-timeout');assert.equal((await h.send()).status,500);
  assert.ok(!h.calls.some(c=>c.method==='POST'&&c.url.includes('/rest/v1/')));
  const removed=h.calls.find(c=>c.method==='DELETE');assert.equal(JSON.parse(removed.body).prefixes.length,2);
 });
}
test('database transport and malformed responses return 503 without invalidating a session',async()=>{
 for(const mode of ['auth-outage','auth-bad-json']){const h=harness('partner',mode);assert.equal((await h.send()).status,503);assert.equal(h.calls.length,1);}
});
