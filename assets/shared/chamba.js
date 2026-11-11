/* Shared UI safety, transport and interaction helpers. No account data is sent to third parties. */
'use strict';
window.Chamba=(()=>{
 const callbacks=new Map(),messages=new Map();let serial=0,prunePending=false;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const html=value=>DOMPurify.sanitize(String(value??''),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','iframe','object','embed','svg','math'],FORBID_ATTR:['srcdoc'],ALLOW_DATA_ATTR:true});
 function notice(message){let el=document.getElementById('chamba-notice');if(!el){el=document.createElement('div');el.id='chamba-notice';el.setAttribute('role','alert');document.body.append(el);}el.textContent=message||'No se pudo completar. Intentá nuevamente.';el.hidden=false;clearTimeout(el.timer);el.timer=setTimeout(()=>el.hidden=true,9000);}
 async function run(fn,element,event){try{await fn.call(element,event);}catch(e){notice(e.message);}}
 function bind(type,fn){const id=String(++serial);callbacks.set(id,{type,fn});if(!prunePending){prunePending=true;queueMicrotask(()=>{prunePending=false;const live=new Set([...document.querySelectorAll('[data-chamba-click],[data-chamba-input],[data-chamba-keydown],[data-chamba-change],[data-chamba-mouseover],[data-chamba-mouseout]')].flatMap(el=>[...el.attributes].filter(a=>a.name.startsWith('data-chamba-')).map(a=>a.value)));for(const key of callbacks.keys())if(!live.has(key))callbacks.delete(key);});}return `data-chamba-${type}="${id}"`;}
 for(const type of ['click','input','keydown','change','mouseover','mouseout'])document.addEventListener(type,event=>{
  const el=event.target.closest?.(`[data-chamba-${type}]`);if(!el)return;const cb=callbacks.get(el.getAttribute(`data-chamba-${type}`));if(cb?.type===type){if(el.tagName==='A' && el.getAttribute('href')==='#')event.preventDefault();run(cb.fn,el,event);}
 });
 let config={comision_pct:13,piso_comision:1000,precio_minimo:1001};
 function quote(price){price=Math.round(Number(price)||0);const comision=Math.max(Math.round(price*config.comision_pct)/100,config.piso_comision);return {comision,neto:Math.max(0,price-comision)};}
 async function response(url,options={}){
  const r=await fetch(url,{...options,signal:options.signal||AbortSignal.timeout(85000)});
  if(!r.ok){let data;try{data=await r.json();}catch{}throw Error(data?.error||'No se pudo completar la operación. Intentá nuevamente.');}
  return r;
 }
 const inflight=new Map();
 async function api(base,path,method='GET',body=null){
  const key=base+' '+method+' '+path+(body?JSON.stringify(body):'');if(inflight.has(key))return inflight.get(key);
  const request=(async()=>{const token=localStorage.getItem('chamba_token');let error;
   for(let attempt=0;attempt<(method==='GET'?2:1);attempt++){
    try{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(85000)});
     let data;try{data=await response.json();}catch{throw Error('El servidor está iniciando o no respondió. Intentá nuevamente.');}
     if(response.status===401){localStorage.removeItem('chamba_user');localStorage.removeItem('chamba_token');location.href='/login';throw Error('Iniciá sesión nuevamente.');}
     if(!response.ok||data?.error)throw Object.assign(Error(data.error||'No se pudo completar la operación.'),{http:true});return data;
    }catch(e){error=e;if(e.http||method!=='GET')break;}
   }throw error;
  })();inflight.set(key,request);try{return await request;}finally{inflight.delete(key);}
 }
 async function photoStore(mode,value){
  if(!window.indexedDB)return [];
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('chamba-request-draft',1);request.onupgradeneeded=()=>request.result.createObjectStore('photos');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode==='get'?'readonly':'readwrite'),store=tx.objectStore('photos');const owner=JSON.parse(localStorage.getItem('chamba_user')||'null')?.id;const request=mode==='get'?store.get('current'):mode==='clear'?store.delete('current'):store.put({at:Date.now(),owner,photos:value},'current');let result=[];request.onsuccess=()=>{const saved=request.result;if(mode==='get'&&saved?.owner===owner&&Date.now()-saved.at<86400000)result=saved.photos;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 }
 async function saveDraftPhotos(photos){try{await photoStore('put',photos);}catch{notice('El navegador no pudo conservar las fotos. El texto de tu consulta sigue disponible.');}}
 async function draftPhotos(){try{return await photoStore('get');}catch{return [];}}
 function clearDraft(){sessionStorage.removeItem('chamba_request_draft');photoStore('clear').catch(()=>{});}
 async function showDraftPhotos(input){
  const photos=await draftPhotos();document.getElementById('draft-photos')?.remove();if(!photos.length)return;
  const box=document.createElement('div');box.id='draft-photos';box.className='draft-photos';const label=document.createElement('p');label.textContent='Fotos de tu consulta a la IA';box.append(label);
  for(const [i,url]of photos.entries()){if(!/^data:image\/(jpeg|png|webp);base64,/.test(url))continue;const img=document.createElement('img');img.src=url;img.alt='Foto de la consulta '+(i+1);box.append(img);}input.after(box);
 }
 function messageId(job,text){const previous=messages.get(job);if(previous?.text===text)return previous.id;const item={text,id:crypto.randomUUID()};messages.set(job,item);return item.id;}
 const chats=new Map();
 async function chat(job,request,user,legacyRole,older=false){
  const key=user.id+':'+job;
  let state=chats.get(key);
  if(!state){state={items:[],latest:null,before:null,revision:null,follow:true,top:0};chats.set(key,state);}
  function render(prepend=false){
   const box=document.getElementById('chat-'+job);if(!box)return;
   const same=state.element===box,oldHeight=same?box.scrollHeight:0,oldTop=same?box.scrollTop:state.top;
   const signature=JSON.stringify([state.before,state.items]);
   if(same&&signature===state.signature)return;
   const nodes=[];
   if(state.before){const button=document.createElement('button');button.type='button';button.className='chat-older';button.textContent='Ver mensajes anteriores';button.addEventListener('click',async()=>{button.disabled=true;try{await chat(job,request,user,legacyRole,true);}catch(e){notice(e.message);}finally{button.disabled=false;}});nodes.push(button);}
   for(const m of state.items){const el=document.createElement('div');el.className='chat-msg '+((m.autor_id?m.autor_id===user.id:m.rol===legacyRole)?'yo':'otro');const author=document.createElement('div');author.className='chat-msg-meta';author.textContent=m.autor;el.append(author,document.createTextNode(m.contenido));nodes.push(el);}
   if(!state.items.length){const empty=document.createElement('div');empty.className='chat-empty';empty.textContent='Chat habilitado — coordiná con la otra persona';nodes.push(empty);}
   box.replaceChildren(...nodes);
   box.scrollTop=prepend?oldTop+box.scrollHeight-oldHeight:state.follow?box.scrollHeight:oldTop;
   if(!same)box.addEventListener('scroll',()=>{state.top=box.scrollTop;state.follow=box.scrollHeight-box.scrollTop-box.clientHeight<60;},{passive:true});
   state.element=box;state.signature=signature;state.top=box.scrollTop;
  }
  render();
  if(state.loading)return state.loading;
  if(older&&!state.before)return;
  state.loading=(async()=>{
   let cursor=older?state.before:state.latest;
   let result=await request('/api/mensajes/'+job+'?page=true'+(cursor?'&'+(older?'before':'after')+'='+encodeURIComponent(cursor):''));
   if(result.reset){state.items=[];state.latest=null;state.before=null;state.follow=true;state.top=0;cursor=null;older=false;result=await request('/api/mensajes/'+job+'?page=true');}
   // Accept the old array contract during a coordinated API/frontend deployment.
   if(Array.isArray(result)){state.items=result;state.before=null;state.latest=null;}
   else{
    if(state.revision!==null&&state.revision!==result.revision)state.items=[];
    state.revision=result.revision;
    const combined=older?[...result.messages,...state.items]:[...state.items,...result.messages];
    state.items=[...new Map(combined.map(m=>[m.id,m])).values()];
    if(older||!cursor||result.reset)state.before=result.next_before;
    if(!older&&result.latest)state.latest=result.latest;
   }
   render(older);
  })();
  try{await state.loading;}finally{state.loading=null;}
 }
 function labelFields(){
  document.querySelectorAll('label:not([for])').forEach((label,i)=>{let input=label.nextElementSibling;if(!input?.matches('input,select,textarea'))input=label.parentElement?.querySelector('input,select,textarea');if(input){if(!input.id)input.id='label-field-'+i;label.htmlFor=input.id;}});
 }
 function initialize(){
  labelFields();
  document.querySelectorAll('[onclick], [oninput], [onchange], [onkeydown]').forEach(el=>console.error('Inline event remaining:',el.tagName));
  document.querySelectorAll('#tipo-cliente,#tipo-socio').forEach(el=>{el.setAttribute('role','button');el.tabIndex=0;});
  const token=localStorage.getItem('chamba_token');if(token)api('https://chamba-backend-vurx.onrender.com','/api/config').then(c=>config=c).catch(()=>{});
 }
 let openedModal=null,returnFocus=null;
 function refreshAccessibility(){
  labelFields();
  document.querySelectorAll('[data-chamba-click],[data-event-0],.ub-sugerencia-item').forEach(el=>{
   if(!['DIV','SPAN'].includes(el.tagName)||el.classList.contains('modal-overlay'))return;
   if(!el.hasAttribute('role'))el.setAttribute('role','button');
   if(!el.hasAttribute('tabindex'))el.tabIndex=0;
  });
  document.querySelectorAll('.chat-input').forEach(el=>{if(!el.hasAttribute('aria-label'))el.setAttribute('aria-label','Mensaje para la otra persona');});
  document.querySelectorAll('button').forEach(el=>{const name=el.textContent.trim();const labels={'✏️':'Editar','🗑️':'Eliminar','×':'Cerrar','✕':'Cerrar','✖':'Cerrar'};if(labels[name]&&!el.hasAttribute('aria-label'))el.setAttribute('aria-label',labels[name]);});
  const modal=document.querySelector('.modal-overlay.open');
  if(modal!==openedModal){
   if(modal){returnFocus=document.activeElement;openedModal=modal;modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');const title=modal.querySelector('[id$="title"],h2,h3');if(title){if(!title.id)title.id='dialog-heading';modal.setAttribute('aria-labelledby',title.id);}const target=modal.querySelector('button,input,textarea,a');target?.focus();}
   else{openedModal=null;returnFocus?.focus();returnFocus=null;}
  }
 }
 document.addEventListener('DOMContentLoaded',()=>{initialize();refreshAccessibility();new MutationObserver(refreshAccessibility).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});});
 document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('[role="button"]:not(button):not(a)')){e.preventDefault();e.target.click();}});

 window.addEventListener('unhandledrejection',e=>{notice(e.reason?.message);e.preventDefault();});
 document.addEventListener('click',e=>{const a=e.target.closest('[data-panel-link]');if(a){try{if(JSON.parse(localStorage.getItem('chamba_user')).tipo==='socio')a.href='/panel-socio';}catch{}}});
 // Keep keyboard focus and in-progress chat text through periodic redraws.
 let focusState=null;
 document.addEventListener('focusin',e=>{if(e.target.matches('input,textarea'))focusState={id:e.target.id};else focusState=null;});
 document.addEventListener('input',e=>{if(focusState?.id===e.target.id)Object.assign(focusState,{value:e.target.value,start:e.target.selectionStart,end:e.target.selectionEnd});});
 new MutationObserver(()=>{if(focusState?.id && document.activeElement===document.body){const input=document.getElementById(focusState.id);if(input){if(focusState.value!==undefined)input.value=focusState.value;input.focus({preventScroll:true});try{input.setSelectionRange(focusState.start,focusState.end);}catch{}}}}).observe(document.documentElement,{childList:true,subtree:true});
 document.addEventListener('keydown',e=>{
  const modal=document.querySelector('.modal-overlay.open');if(!modal)return;
  if(e.key==='Escape'){modal.classList.remove('open');return;}
  if(e.key==='Tab'){const focusable=[...modal.querySelectorAll('button,a,input,textarea,select,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 });
 return {escape,html,bind,run,notice,api,quote,response,saveDraftPhotos,draftPhotos,showDraftPhotos,clearDraft,chat,services:value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean),messageId,messageDone:job=>messages.delete(job)};
})();
