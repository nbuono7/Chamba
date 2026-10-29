const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.classList={add:()=>{}};}
 append(...items){this.children.push(...items);} replaceChildren(...items){this.children=[...items];}
 setAttribute(key,value){this[key]=value;} addEventListener(key,callback){this.events[key]=callback;}
 get firstChild(){return this.children[0];}get lastChild(){return this.children.at(-1);}
}
function setup(){
 const list=new Element('div'),selector=new Element('div'),listeners={},calls=[],selections=[];let response;
 const document={hidden:false,createElement:tag=>new Element(tag),getElementById:id=>id==='hub-service-list'?list:id==='hub-service-selector'?selector:null,addEventListener:(name,fn)=>listeners[name]=fn};
 const context={document,window:{},BACKEND_URL:'https://test.invalid',selectedService:'',AbortSignal:{timeout:()=>null},fetch:async()=>{if(response instanceof Error)throw response;return {ok:true,json:async()=>response};},setInterval:()=>{},matchMedia:()=>({matches:true}),irAServicio:s=>calls.push(s),selectService:s=>selections.push(s)};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/hub/hub.js'),'utf8'),context);
 return {list,selector,context,calls,selections,async load(data){response=data;listeners.DOMContentLoaded();await new Promise(setImmediate);},async refresh(data){response=data;listeners.visibilitychange();await new Promise(setImmediate);}};
}
const rows=[{nombre:'Mecánica (auxilio)',activa:false},{nombre:'Fletes',activa:true},{nombre:'Jardinero',activa:true}];
test('only active admin services appear; names sent to existing flow remain exact',async()=>{const h=setup();await h.load(rows);assert.deepEqual(h.list.children.map(x=>x.dataset.service),['Fletes','Jardinero']);assert.deepEqual(h.selector.children.map(x=>x.dataset.service),['Fletes','Jardinero']);h.list.children[0].events.click();h.selector.children[1].events.click();assert.deepEqual(h.calls,['Fletes']);assert.deepEqual(h.selections,['Jardinero']);assert.match(h.list.children[0].children[0].src,/icono-fletes-color.svg$/);});
test('admin disabling a service removes it and clears a previous selection',async()=>{const h=setup();await h.load(rows);h.context.selectedService='Fletes';await h.refresh(rows.map(x=>({...x,activa:false})));assert.equal(h.context.selectedService,'');assert.equal(h.context.window.hubCatalog.size,0);assert.equal(h.list.children[0].className,'catalog-message');});
test('failed catalog request hides stale entries and allows retry',async()=>{const h=setup();await h.load(rows);await h.refresh(new Error('offline'));assert.equal(h.context.window.hubCatalog.size,0);assert.equal(h.list.firstChild.lastChild.className,'catalog-retry');assert.equal(h.selector.children[0].className,'catalog-message');await h.refresh(rows);assert.equal(h.context.window.hubCatalog.size,2);});
test('unrecognized service names are rendered as text with a safe generic asset',async()=>{const h=setup();await h.load([{nombre:'<img src=x onerror=alert(1)>',activa:true}]);assert.equal(h.list.children[0].children[1].children[0].textContent,'<img src=x onerror=alert(1)>');assert.match(h.list.children[0].children[0].src,/reduccion-negro.svg$/);});
