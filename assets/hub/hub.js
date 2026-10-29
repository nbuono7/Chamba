/* The admin catalog is the single source of available trades. */
(() => {
  const assets = '/assets/brand/';
  const details = {
    plomeria:['plomeria','Agua, cañerías e instalaciones.'],
    electricidad:['electricidad','Luces, tableros y conexiones.'],
    gas:['gas','Instalaciones y artefactos.'],
    cerrajeria:['cerrajeria','Puertas, llaves y cerraduras.'],
    fletes:['fletes','Mudanzas y traslados.'],
    limpieza:['limpieza','Un espacio para empezar de nuevo.'],
    pintura:['pintura','Paredes, techos y nuevos colores.'],
    albanileria:['albanileria','Arreglos y reformas.'],
    jardinero:['jardineria','Verde, poda y mantenimiento.'],
    jardineria:['jardineria','Verde, poda y mantenimiento.']
  };
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let signature = null, loading = false;
  window.hubCatalog = new Set();
  function node(tag, cls, text) { const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e; }
  function icon(file) { const img=node('img');img.src=assets+(file?'icono-'+file+'-color.svg':'reduccion-negro.svg');img.alt='';img.width=335;img.height=295;return img; }
  function render(rows) {
    const active=rows.filter(r=>r.activa === true && typeof r.nombre==='string');
    const next=JSON.stringify(active.map(r=>r.nombre));
    window.hubCatalog=new Set(active.map(r=>r.nombre));
    if(typeof selectedService!=='undefined' && selectedService && !window.hubCatalog.has(selectedService)) selectedService='';
    if(next===signature)return;
    signature=next;
    const list=document.getElementById('hub-service-list'), selector=document.getElementById('hub-service-selector');
    list.replaceChildren();if(selector)selector.replaceChildren();
    if(!active.length)list.append(node('p','catalog-message','No hay oficios disponibles por el momento. Volvé a consultar más tarde.'));
    active.forEach(r=>{
      const [file,description]=details[normalize(r.nombre)] || [null,'Consultá por este servicio.'];
      const label=normalize(r.nombre)==='jardinero'?'Jardinería':r.nombre;
      const button=node('button','service-entry');button.type='button';button.dataset.service=r.nombre;
      button.append(icon(file));const text=node('span');text.append(node('span','service-name',label),node('span','service-description',description));button.append(text,node('span','service-arrow','↗'));button.lastChild.setAttribute('aria-hidden','true');
      button.addEventListener('click',()=>irAServicio(r.nombre));list.append(button);
      if(selector){const mini=node('button','service-mini-btn');mini.type='button';mini.dataset.service=r.nombre;mini.append(icon(file),node('span','s-name',label));mini.addEventListener('click',()=>selectService(r.nombre,mini));if(typeof selectedService!=='undefined' && selectedService===r.nombre)mini.classList.add('selected');selector.append(mini);}
    });
    if(selector && !active.length)selector.append(node('p','catalog-message','No hay oficios disponibles.'));
  }
  async function refresh() {
    if(loading || document.hidden)return;loading=true;
    const list=document.getElementById('hub-service-list');
    try {
      const response=await fetch(BACKEND_URL+'/api/especialidades',{cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('catalog');const data=await response.json();
      if(!Array.isArray(data))throw Error('catalog');render(data);
    } catch(e) {
      // Do not keep stale services visible after a failed refresh.
      signature=null;window.hubCatalog=new Set();
      if(typeof selectedService!=='undefined')selectedService='';
      list.replaceChildren(node('p','catalog-message','No pudimos consultar los oficios disponibles.'));
      const retry=node('button','catalog-retry','Volver a intentar');retry.type='button';retry.addEventListener('click',refresh);list.firstChild.append(retry);
      const selector=document.getElementById('hub-service-selector');if(selector)selector.replaceChildren(node('p','catalog-message','Volvé a consultar el directorio para elegir un oficio.'));
    } finally {list.setAttribute('aria-busy','false');loading=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    refresh();setInterval(refresh,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    if('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion:reduce)').matches){const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('reveal');observer.unobserve(entry.target);}});},{threshold:.08});document.querySelectorAll('.section-heading,.process-list li,.hub-guidance>div,.hub-partner').forEach(e=>observer.observe(e));}
  });
})();
