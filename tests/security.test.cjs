const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');

function harness(responses = []) {
  const routes = {}, calls = [];
  const app = { use() {}, listen() {} };
  for (const verb of ['get','post','patch','delete']) app[verb] = (path, ...handlers) => { routes[verb + path] = handlers; };
  const express = Object.assign(() => app, { json: () => () => {} });
  const sandbox = { console, Buffer, setInterval() {}, setTimeout() {}, process: { env: { JWT_SECRET: 'test' }, on() {} },
    require(name) {
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'dotenv') return { config() {} };
      if (name === 'jsonwebtoken') return { verify(token) { if (token === 'invalid') throw Error(); return JSON.parse(token); } };
      if (name === '@sentry/node') return { setupExpressErrorHandler() {} };
      return {};
    },
    mockSb: async (...args) => { calls.push(args); return responses.shift() || []; }
  };
  const start = source.indexOf('const sb = async');
  const end = source.indexOf('// Convierte una dirección', start);
  vm.runInNewContext(source.slice(0,start) + 'const sb = mockSb;\n' + source.slice(end), sandbox);
  return { calls, async request(verb, path, user, extra = {}) {
    const req = { headers: user ? { authorization: 'Bearer ' + JSON.stringify(user) } : {}, params: {}, query: {}, body: {}, ...extra };
    const res = { code: 200, status(c) { this.code = c; return this; }, json(data) { this.data = data; return this; } };
    const handlers = routes[verb + path];
    async function run(i) { if (handlers[i]) { let next; await handlers[i](req,res,() => { next = run(i+1); }); if(next) await next; } }
    await run(0); return res;
  } };
}
const client = { id: 'client', tipo: 'cliente' }, partner = { id: 'partner', tipo: 'socio' };
test('chat denies anonymous and unrelated users without reading messages', async () => {
  for (const user of [null, { id: 'stranger' }]) {
    const h = harness([[{ usuario_id:'client', profesional_id:'partner', chat_habilitado:true }]]);
    const r = await h.request('get','/api/mensajes/:pedido_id',user,{ params:{pedido_id:'job'} });
    assert.equal(r.code,user ? 403 : 401);
    assert.ok(h.calls.every(c => !c[0].startsWith('mensajes')));
  }
});
test('both participants can read enabled chat; locked chat remains inaccessible', async () => {
  for (const user of [client,partner]) for (const enabled of [true,false]) {
    const h = harness([[{usuario_id:'client',profesional_id:'partner',chat_habilitado:enabled}], [{contenido:'hola'}]]);
    const r = await h.request('get','/api/mensajes/:pedido_id',user,{params:{pedido_id:'job'}});
    assert.equal(r.code,enabled ? 200 : 403);
    if(enabled) assert.equal(r.data[0].contenido,'hola');
  }
});
test('registration rejects privileged roles before database access', async () => {
  for(const tipo of ['admin','other',undefined]) {
    const h=harness(); const r=await h.request('post','/api/usuarios/registro',null,{body:{tipo}});
    assert.equal(r.code,400); assert.equal(h.calls.length,0);
  }
});
test('profile cannot change privileges, balances or passwords', async () => {
  for(const field of ['tipo','estado','saldo_disponible','saldo_bloqueado','password_hash','email_verificado']) {
    const h=harness(); const r=await h.request('patch','/api/usuarios/:id',client,{params:{id:'client'},body:{[field]:'bad'}});
    assert.equal(r.code,403); assert.equal(h.calls.length,0);
  }
});
test('profile editing still works and omits password hashes', async () => {
  const h=harness([[{id:'client'}],[{id:'client',nombre:'Nuevo',password_hash:'secret'}]]);
  const r=await h.request('patch','/api/usuarios/:id',client,{params:{id:'client'},body:{nombre:'Nuevo',telefono:'123'}});
  assert.equal(r.code,200); assert.equal(r.data[0].nombre,'Nuevo'); assert.equal(r.data[0].password_hash,undefined);
});
test('users and license requests are scoped to caller; admin retains list access', async () => {
  for(const path of ['/api/usuarios','/api/solicitudes-matricula']) for(const user of [client,{id:'admin',tipo:'admin'}]) {
    const h=harness(); const r=await h.request('get',path,user,{query:{socio_id:'someone-else'}});
    assert.equal(r.code,200);
    assert.equal(h.calls[0][0].includes('eq.client'),user.tipo!=='admin');
  }
});
