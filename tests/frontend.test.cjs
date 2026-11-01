const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.join(__dirname,'..');
const uuid='11111111-1111-4111-8111-111111111111';
async function page(name,options={}){
 const errors=[],calls=[];const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e.message);});
 const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://chamba-vert.vercel.app/'+name,runScripts:'dangerously',virtualConsole,beforeParse(w){
  w.alert=()=>{};w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:true});w.setInterval=()=>0;
  w.fetch=async(url,opts)=>{calls.push({url,opts});let data=[];
   if(url.includes('/api/usuarios'))data=[{id:uuid,nombre:'Persona de prueba',tipo:name==='admin'?'admin':name.includes('socio')?'socio':'cliente',email:'test@example.invalid',especialidad:'Fletes, Limpieza',nombre_usuario:'persona',estado:'aprobado'}];
   if(url.includes('/api/especialidades'))data=[{nombre:'Fletes',activa:true},{nombre:'Limpieza',activa:true}];
   if(url.includes('/api/config'))data={comision_pct:13,piso_comision:1000,precio_minimo:1001};
   if(options.respond)data=options.respond(url,opts,data);
   return {ok:true,status:200,json:async()=>data};
  };
  w.localStorage.setItem('chamba_token','test');w.localStorage.setItem('chamba_user',JSON.stringify({id:uuid,nombre:'Persona de prueba',email:'test@example.invalid',tipo:name==='admin'?'admin':name.includes('socio')?'socio':'cliente',especialidad:'Fletes'}));
  if(options.draft)w.sessionStorage.setItem('chamba_request_draft',JSON.stringify(options.draft));
 }});
 const w=dom.window;
 // External assets are evaluated locally, without fetching analytics or any service.
 for(const script of [...w.document.querySelectorAll('script[src]')]){
  const src=script.getAttribute('src');if(/^https?:/.test(src))continue;
  const el=w.document.createElement('script');el.textContent=fs.readFileSync(path.join(root,src.replace(/^\//,'')),'utf8');w.document.head.append(el);
 }
 await new Promise(r=>setTimeout(r,80));
 return {dom,w,errors,calls,close:()=>w.close()};
}
for(const name of ['index','login','registro','restablecer-password','solicitar-socio','solicitar-matricula','panel-cliente','panel-socio','admin'])test(name+' boots with external scripts and no inline handlers',async()=>{
 const h=await page(name);try{
  assert.deepEqual(h.errors,[]);assert.equal(h.w.document.querySelectorAll('[onclick],[oninput],[onchange],[onkeydown]').length,0);
  const ids=[...h.w.document.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length,'duplicate element IDs');
 }finally{h.close();}
});
for(const name of ['panel-cliente','panel-socio'])test(name+' restores Hub service and description',async()=>{
 const h=await page(name,{draft:{servicio:'Fletes',descripcion:'Mudanza de prueba'}});try{const prefix=name==='panel-socio'?'cli-':'';assert.equal(h.w.document.getElementById(prefix+'p-servicio').value,'Fletes');assert.equal(h.w.document.getElementById(prefix+'p-desc').value,'Mudanza de prueba');assert.deepEqual(h.errors,[]);}finally{h.close();}
});
test('user text cannot become executable HTML; generated buttons still work',async()=>{
 const h=await page('panel-cliente');try{
  const {w}=h;const payload=`<img src=x onerror="window.hacked=1"><a href="javascript:alert(1)">test</a>`;
  const box=w.document.createElement('div');w.document.body.append(box);box.innerHTML=w.Chamba.html(`<div>${w.Chamba.escape(payload)}</div>`);
  assert.equal(box.textContent,payload);assert.equal(box.querySelector('img'),null);
  box.innerHTML=w.Chamba.html(payload);assert.equal(box.querySelector('[onerror],[href^="javascript:"]'),null);
  let clicks=0;box.innerHTML=w.Chamba.html(`<button ${w.Chamba.bind('click',()=>clicks++)}>OK</button>`);await Promise.resolve();box.firstChild.click();assert.equal(clicks,1);
 }finally{h.close();}
});
test('chat draft remains after network failure and clears only after confirmation',async()=>{
 const h=await page('panel-cliente');try{
  const {w}=h;const job='22222222-2222-4222-8222-222222222222';const input=w.document.createElement('input');input.id='chat-in-'+job;input.value='Mensaje sin enviar';w.document.body.append(input);
  w.fetch=async()=>{throw Error('offline');};await assert.rejects(w.enviarMsg(job));assert.equal(input.value,'Mensaje sin enviar');
  let retry;w.fetch=async(url,opts)=>{retry=opts?.body?JSON.parse(opts.body).client_message_id:retry;return {ok:true,status:200,json:async()=>[]};};await w.enviarMsg(job);assert.equal(input.value,'');assert.match(retry,/^[a-f0-9-]{36}$/);
 }finally{h.close();}
});
module.exports={page};

for(const name of ['panel-cliente','panel-socio','admin'])test(name+' renders populated jobs, forum and hostile text safely',async()=>{
 const hostile=`<img src=x onerror="window.hacked=1">O'Connor`;
 const socio='22222222-2222-4222-8222-222222222222';
 const jobs=['nuevo','en_proceso','completado','cancelado'].map((estado,i)=>({id:`44444444-4444-4444-8444-44444444444${i}`,usuario_id:name==='panel-socio'?socio:uuid,profesional_id:name==='panel-socio'?uuid:socio,servicio:'Fletes',descripcion:hostile,estado,created_at:new Date().toISOString(),chat_habilitado:true,estado_pago:estado==='completado'?'liberado':'pagado',precio_cliente:10000,precio_socio:8700,comision:1300,codigo_verificacion:'1234',calificado:false}));
 const offers=jobs.map((p,i)=>({id:`66666666-6666-4666-8666-66666666666${i}`,pedido_id:p.id,socio_id:socio,socio_nombre:hostile,estado:'pendiente',ultima_oferta_de:'socio',precio_ofertado:10000,precio_neto:8700,especialidad:'Fletes'}));
 const h=await page(name,{respond(url,opts,fallback){if(url.includes('/api/pedidos'))return jobs;if(url.includes('/api/ofertas'))return offers;if(url.includes('/api/mensajes'))return [{autor:hostile,autor_id:socio,rol:'socio',contenido:hostile}];if(url.includes('/api/foro'))return [{id:socio,autor_nombre:hostile,autor_tipo:'socio',titulo:hostile,contenido:hostile,created_at:new Date().toISOString()}];return fallback;}});
 try{
  await h.w.cargarTodo();if(h.w.cargarForo)await h.w.cargarForo();await new Promise(r=>setTimeout(r,30));
  assert.deepEqual(h.errors,[]);assert.equal(h.w.hacked,undefined);assert.equal(h.w.document.querySelector('img[src="x"],[onerror]'),null);
  assert.ok(h.w.document.body.textContent.includes("O'Connor"));
  if(name==='panel-cliente'){
   assert.ok(h.w.document.getElementById('lista-negociacion').textContent.includes('Aceptar'));
   const toggle=[...h.w.document.querySelectorAll('#lista-negociacion button')].find(x=>x.textContent.includes('Contraofer'));
   toggle.click();await Promise.resolve();assert.equal(h.w.document.getElementById('neg-'+offers[0].id).style.display,'block');
  }
 }finally{h.close();}
});
