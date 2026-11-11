/* Shared notices only: deadlines and money transitions are enforced by PostgreSQL. */
window.Custodia=(()=>{
 const base='https://chamba-backend-vurx.onrender.com',esc=v=>Chamba.escape(v);
 const money=c=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(c)/100);
 const date=v=>v?new Date(v).toLocaleString('es-AR'): '—';
 const labels={pendiente_codigo:'Pendiente de código',retenido:'Retenido',en_disputa:'En disputa',disponible:'Disponible',devuelto:'Saldo a favor del Cliente',repartido:'Repartido'};
 function countdown(v){const ms=new Date(v)-Date.now();if(ms<=0)return 'Plazo cumplido; procesando la actualización';const m=Math.ceil(ms/60000);return `${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h ${m%60}min`;}
 function card(e){const deadline=e.estado==='pendiente_codigo'?e.codigo_hasta:e.estado==='retenido'?e.reclamo_hasta:null;
 return `<strong>${esc(labels[e.estado]||e.estado)}</strong> · Total ${esc(money(e.total))}${deadline?`<p>Hasta ${esc(date(deadline))} · <span data-deadline="${esc(deadline)}">${esc(countdown(deadline))}</span></p>`:''}<p>${esc(e.estado==='pendiente_codigo'?'Pago confirmado. Entregá e ingresá el código al terminar el trabajo. Si vence el plazo sin código, el total vuelve al Cliente sin comisión.':e.estado==='retenido'?'Si hubo algún problema, el Cliente puede reclamar durante estas 48 horas corridas. Sin reclamo, el saldo neto queda disponible para el Socio.':e.estado==='en_disputa'?'El dinero sigue congelado hasta que administración resuelva. La antigüedad del reclamo no lo libera.':'Consultá los movimientos en Saldo.')}</p>`;
 }
 async function confirmPayment(price){const c=await Chamba.api(base,'/api/custodia/config');return new Promise(resolve=>{
 const d=document.createElement('dialog');d.className='custodia-dialog';
 d.innerHTML=Chamba.html(`<h2>Antes de confirmar el pago simulado</h2><p>Total: <strong>${esc(money(price*100))}</strong></p><p>El total queda en custodia. Entregá el código al Socio cuando termine el trabajo. Tiene que ingresarlo dentro de los ${esc(c.codigo_dias)} días corridos desde el pago. Si no lo ingresa a tiempo, el total vuelve a tu saldo sin comisión.</p><p>Al ingresar el código empiezan ${esc(c.retencion_horas)} horas corridas para reclamar. Si reclamás, el dinero queda congelado hasta la resolución administrativa. Si no reclamás, se libera el neto al Socio.</p><p>En una resolución administrativa se cobra una única comisión del ${esc(c.comision_bps/100)}% del total, con mínimo de ${esc(money(c.minimo_centavos))}, distribuida proporcionalmente entre las partes. La resolución cierra el reclamo en la plataforma.</p><label><input type="checkbox" id="aceptar-custodia"> Leí y acepto estas condiciones.</label><div><button type="button" data-cancel>Volver</button> <button type="button" data-accept disabled>Confirmar pago simulado</button></div>`);
 document.body.append(d);const check=d.querySelector('input'),ok=d.querySelector('[data-accept]');check.addEventListener('change',()=>ok.disabled=!check.checked);
 const end=v=>{d.close();d.remove();resolve(v);};ok.addEventListener('click',()=>{if(check.checked)end(true);});d.querySelector('[data-cancel]').addEventListener('click',()=>end(false));d.addEventListener('cancel',e=>{e.preventDefault();end(false);});d.showModal();
 });}
 function tick(){document.querySelectorAll('[data-deadline]').forEach(el=>el.textContent=countdown(el.dataset.deadline));}
 async function notices(){
 if(!localStorage.getItem('chamba_token'))return;
 const user=JSON.parse(localStorage.getItem('chamba_user')||'{}');
 if(['baja','suspendido'].includes(user.estado)&&!location.pathname.startsWith('/reclamos')){location.replace('/reclamos');return;}
 const main=document.querySelector('main,.main');if(!main)return;
 let box=document.getElementById('custodia-resumen');if(!box){box=document.createElement('aside');box.id='custodia-resumen';box.className='custodia-resumen';main.prepend(box);}
 try{
 const [jobs,notes]=await Promise.all([Chamba.api(base,'/api/custodia/trabajos'),Chamba.api(base,'/api/notificaciones')]);
 const active=jobs.filter(j=>j.custodia&&!j.custodia.liquidado_at);
 box.innerHTML=Chamba.html(`<a href="/reclamos">Reclamos y saldo${notes.filter(n=>!n.leida_at).length?' · '+notes.filter(n=>!n.leida_at).length+' avisos':''}</a>${active.slice(0,5).map(j=>`<details ${active.length===1?'open':''}><summary>${esc(j.servicio)} · ${esc(labels[j.custodia.estado])}</summary>${card(j.custodia)}<a href="/reclamos?pedido=${esc(j.id)}">Ver trabajo y reclamos</a></details>`).join('')}`);
 }catch{box.textContent='No pudimos actualizar la custodia. Abrí Reclamos y saldo para volver a intentar.';const a=document.createElement('a');a.href='/reclamos';a.textContent='Abrir';box.append(a);}
 }
 if(/\/panel-(cliente|socio)|\/admin/.test(location.pathname)){document.addEventListener('DOMContentLoaded',notices);setInterval(()=>{if(!document.hidden)notices();},60000);}
 setInterval(tick,30000);return {money,date,card,labels,confirmPayment,tick};
})();
