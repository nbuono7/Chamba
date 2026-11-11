-- All amounts below are integer centavos. Payments and withdrawals remain simulated.
-- Old paid jobs have no trustworthy payment date: no retroactive clocks are invented.
alter table public.usuarios drop constraint usuarios_estado_check;
alter table public.usuarios add constraint usuarios_estado_check check(estado in ('pendiente','aprobado','rechazado','suspendido','baja'));
alter table public.usuarios add column baja_at timestamptz;
create table public.chamba_config(
 id boolean primary key default true check(id), codigo_dias int not null default 7 check(codigo_dias>0),
 retencion_horas int not null default 48 check(retencion_horas>0), retiro_dias int not null default 7 check(retiro_dias>0),
 descargo_horas int not null default 48 check(descargo_horas>0), comision_bps int not null default 1300 check(comision_bps between 0 and 9999),
 minimo_centavos bigint not null default 100000 check(minimo_centavos>=0),
 aviso_socio_dia int not null default 3, aviso_ambos_dia int not null default 5, aviso_final_dia int not null default 6,
 amarillo_dias int not null default 3 check(amarillo_dias>0), rojo_dias int not null default 6,
 frecuentes_cantidad int not null default 3 check(frecuentes_cantidad>0), frecuentes_dias int not null default 30 check(frecuentes_dias>0),
 check(rojo_dias>amarillo_dias),check(aviso_socio_dia>0 and aviso_socio_dia<aviso_ambos_dia and aviso_ambos_dia<aviso_final_dia and aviso_final_dia<codigo_dias)
);
insert into public.chamba_config default values;
create table public.custodias(
 pedido_id uuid primary key references public.pedidos(id), cliente_id uuid not null references public.usuarios(id), socio_id uuid not null references public.usuarios(id),
 total bigint not null check(total>0), comision bigint not null check(comision>=0 and comision<total),
 estado text not null check(estado in ('pendiente_codigo','retenido','en_disputa','disponible','devuelto','repartido')),
 pagado_at timestamptz not null, codigo_hasta timestamptz not null, codigo_at timestamptz, reclamo_hasta timestamptz, liquidado_at timestamptz,
 configuracion jsonb not null, aviso_aceptado_at timestamptz not null, aviso_version text not null default 'custodia-v2'
);
create index custodias_cliente_idx on public.custodias(cliente_id);
create index custodias_socio_idx on public.custodias(socio_id);
create index custodias_vencimientos_idx on public.custodias(estado,codigo_hasta,reclamo_hasta);
create table public.reclamos(
 id uuid primary key default gen_random_uuid(), pedido_id uuid references public.pedidos(id), creado_por uuid not null references public.usuarios(id),
 contra_id uuid not null references public.usuarios(id), tipo text not null check(tipo in ('dinero','conducta')),
 categoria text not null, descripcion text not null check(length(trim(descripcion)) between 1 and 6000),
 estado text not null default 'abierto' check(estado in ('abierto','en_proceso','finalizado')),
 created_at timestamptz not null default clock_timestamp(), tomado_por uuid references public.usuarios(id), tomado_at timestamptz,
 descargo_hasta timestamptz not null, descargo text, descargo_at timestamptz, resolucion text, resuelta_at timestamptz,
 cliente_bruto bigint, socio_bruto bigint, comision_cliente bigint, comision_socio bigint,
 request_id uuid not null, unique(creado_por,request_id), check(creado_por<>contra_id)
);
create unique index reclamo_dinero_unico on public.reclamos(pedido_id) where tipo='dinero';
create index reclamos_creador_idx on public.reclamos(creado_por);
create index reclamos_contra_idx on public.reclamos(contra_id);
create index reclamos_tomado_idx on public.reclamos(tomado_por);
create index reclamos_cola_idx on public.reclamos(estado,created_at);
create table public.reclamo_adjuntos(
 id uuid primary key default gen_random_uuid(), reclamo_id uuid not null references public.reclamos(id), autor_id uuid not null references public.usuarios(id),
 path text not null unique, nombre text not null, mime text not null check(mime in ('image/jpeg','image/png','image/webp')), created_at timestamptz not null default clock_timestamp()
);
create index reclamo_adjuntos_reclamo_idx on public.reclamo_adjuntos(reclamo_id);
create index reclamo_adjuntos_autor_idx on public.reclamo_adjuntos(autor_id);
create table public.libro_contable(
 id uuid primary key default gen_random_uuid(), clave text not null unique, origen text not null, destino text not null,
 centavos bigint not null check(centavos>0), pedido_id uuid references public.pedidos(id), titular_id uuid references public.usuarios(id), actor_id uuid references public.usuarios(id),
 motivo text not null, datos jsonb not null default '{}', created_at timestamptz not null default clock_timestamp(), check(origen<>destino)
);
create index libro_pedido_idx on public.libro_contable(pedido_id,created_at);
create index libro_titular_idx on public.libro_contable(titular_id);
create index libro_actor_idx on public.libro_contable(actor_id);
create index libro_origen_idx on public.libro_contable(origen,created_at);
create index libro_destino_idx on public.libro_contable(destino,created_at);
create table public.saldo_lotes(
 id uuid primary key default gen_random_uuid(), titular_id uuid not null references public.usuarios(id), pedido_id uuid references public.pedidos(id),
 inicial bigint not null check(inicial>0), restante bigint not null check(restante>=0 and restante<=inicial),
 disponible_at timestamptz not null default clock_timestamp(), vence_at timestamptz, no_reclamado_at timestamptz
);
create index saldo_lotes_titular_idx on public.saldo_lotes(titular_id);
create index saldo_lotes_pedido_idx on public.saldo_lotes(pedido_id);
create index saldo_lotes_vence_idx on public.saldo_lotes(vence_at) where restante>0 and no_reclamado_at is null;
create table public.auditoria(
 id uuid primary key default gen_random_uuid(), actor_id uuid references public.usuarios(id), accion text not null,
 pedido_id uuid references public.pedidos(id), reclamo_id uuid references public.reclamos(id), datos jsonb not null default '{}', created_at timestamptz not null default clock_timestamp()
);
create index auditoria_actor_idx on public.auditoria(actor_id);
create index auditoria_pedido_idx on public.auditoria(pedido_id);
create index auditoria_reclamo_idx on public.auditoria(reclamo_id,created_at);
create table public.notificaciones(
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references public.usuarios(id), clave text not null,
 titulo text not null, mensaje text not null, pedido_id uuid references public.pedidos(id), reclamo_id uuid references public.reclamos(id),
 created_at timestamptz not null default clock_timestamp(), leida_at timestamptz, enviado_at timestamptz,
 intentos int not null default 0, proximo_intento timestamptz not null default clock_timestamp(), lease uuid, lease_hasta timestamptz, ultimo_error text,
 unique(usuario_id,clave)
);
create index notificaciones_usuario_idx on public.notificaciones(usuario_id,created_at);
create index notificaciones_pedido_idx on public.notificaciones(pedido_id);
create index notificaciones_reclamo_idx on public.notificaciones(reclamo_id);
create index notificaciones_envio_idx on public.notificaciones(proximo_intento) where enviado_at is null;

create function public.chamba_inmutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'El historial es inmutable. Registrá un movimiento de ajuste.'; end $$;
create trigger libro_inmutable before update or delete or truncate on public.libro_contable for each statement execute function public.chamba_inmutable();
create trigger auditoria_inmutable before update or delete or truncate on public.auditoria for each statement execute function public.chamba_inmutable();

-- One consistent transaction lock precedes job, claim and wallet locks. Low-volume MVP:
-- serializing money transitions makes cross-account splits/withdrawals/deactivation race safe.
create function public.chamba_fin_lock() returns void language sql security invoker set search_path='' as $$select pg_catalog.pg_advisory_xact_lock(7248831901);$$;
create function public.chamba_notify(p_users uuid[],p_key text,p_title text,p_message text,p_job uuid default null,p_claim uuid default null) returns void
language sql security invoker set search_path='' as $$
 insert into public.notificaciones(usuario_id,clave,titulo,mensaje,pedido_id,reclamo_id)
 select distinct x,p_key,p_title,p_message,p_job,p_claim from unnest(p_users) x where x is not null on conflict(usuario_id,clave) do nothing;
$$;
create function public.chamba_admins() returns uuid[] language sql stable security invoker set search_path='' as $$select array_agg(id) from public.usuarios where tipo='admin' and estado='aprobado';$$;
create function public.chamba_post(p_key text,p_from text,p_to text,p_amount bigint,p_job uuid,p_owner uuid,p_actor uuid,p_reason text,p_data jsonb default '{}') returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_amount>0 then insert into public.libro_contable(clave,origen,destino,centavos,pedido_id,titular_id,actor_id,motivo,datos) values(p_key,p_from,p_to,p_amount,p_job,p_owner,p_actor,p_reason,p_data);end if;
end $$;
create function public.chamba_credit(p_user uuid,p_amount bigint,p_job uuid) returns void language plpgsql security invoker set search_path='' as $$
declare u public.usuarios; d int;
begin
 if p_amount<=0 then return;end if;
 select * into u from public.usuarios where id=p_user for update;
 select retiro_dias into d from public.chamba_config;
 insert into public.saldo_lotes(titular_id,pedido_id,inicial,restante,vence_at)
 values(p_user,p_job,p_amount,p_amount,case when u.estado='baja' then clock_timestamp()+make_interval(days=>d) end);
 update public.usuarios set saldo_disponible=coalesce(saldo_disponible,0)+p_amount/100.0 where id=p_user;
end $$;
-- Private helper; callers hold the lock and enforce authorization/deadlines.
create function public.chamba_settle(p_job uuid,p_client bigint,p_reason text,p_actor uuid default null,p_claim uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.custodias; fee bigint; fc bigint; fs bigint; partner bigint; data jsonb;
begin
 perform public.chamba_fin_lock(); select * into e from public.custodias where pedido_id=p_job for update;
 if e.pedido_id is null then raise exception 'Trabajo anterior: requiere revisión manual de sus movimientos.';end if;
 if e.liquidado_at is not null then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if p_client is null or p_client<0 or p_client>e.total then raise exception 'El reparto debe coincidir con el total.';end if;
 fee:=case when p_reason='sin_codigo' then 0 else e.comision end;
 fc:=round(fee::numeric*p_client/e.total);fs:=fee-fc;partner:=e.total-p_client;
 data:=jsonb_build_object('total',e.total,'cliente_bruto',p_client,'socio_bruto',partner,'comision_cliente',fc,'comision_socio',fs,'estado_anterior',e.estado,'estado_nuevo',case when p_client=e.total then 'devuelto' when p_client=0 then 'disponible' else 'repartido' end,'reclamo_id',p_claim);
 perform public.chamba_post(p_job||':cliente','custodia:'||p_job,'disponible:'||e.cliente_id,p_client-fc,p_job,e.cliente_id,p_actor,p_reason,data);
 perform public.chamba_post(p_job||':socio','custodia:'||p_job,'disponible:'||e.socio_id,partner-fs,p_job,e.socio_id,p_actor,p_reason,data);
 perform public.chamba_post(p_job||':comision','custodia:'||p_job,'comisiones',fee,p_job,null,p_actor,p_reason,data);
 perform public.chamba_credit(e.cliente_id,p_client-fc,p_job);perform public.chamba_credit(e.socio_id,partner-fs,p_job);
 update public.usuarios set saldo_bloqueado=greatest(0,coalesce(saldo_bloqueado,0)-(e.total-e.comision)/100.0) where id=e.socio_id;
 update public.custodias set estado=data->>'estado_nuevo',liquidado_at=clock_timestamp() where pedido_id=p_job;
 update public.pedidos set dinero_liberado=true,estado_pago='liberado',estado=case when p_reason='sin_codigo' then 'cancelado' else estado end where id=p_job;
 insert into public.auditoria(actor_id,accion,pedido_id,reclamo_id,datos) values(p_actor,p_reason,p_job,p_claim,data);
 perform public.chamba_notify(array[e.cliente_id,e.socio_id],p_job||':liquidado','Saldo actualizado',case when p_reason='sin_codigo' then 'Pasaron los 7 días sin código. El total se devolvió al saldo simulado del Cliente, sin comisión.' else 'Se resolvió la custodia. Consultá el detalle del reparto y la comisión en Reclamos y saldo.' end,p_job,p_claim);
 return data||jsonb_build_object('ok',true);
end $$;

alter function public.chamba_job_action(uuid,text,uuid,jsonb) rename to chamba_job_action_legacy;
create function public.chamba_job_action(p_actor uuid,p_action text,p_id uuid,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.pedidos; e public.custodias; cfg public.chamba_config; result jsonb; pid uuid; t timestamptz; fee bigint; total bigint;
begin
 perform public.chamba_fin_lock();t:=clock_timestamp();
 if not exists(select 1 from public.usuarios where id=p_actor and estado='aprobado' and email_verificado) then raise exception 'Cuenta no habilitada.';end if;
 if p_action in ('accept','counter','partner_agree','reject') then select pedido_id into pid from public.ofertas where id=p_id;else pid:=p_id;end if;
 select * into p from public.pedidos where id=pid for update;
 select * into e from public.custodias where pedido_id=pid for update;
 select * into cfg from public.chamba_config;
 if p_action='accept' then
 if e.pedido_id is not null then
 if p.usuario_id is distinct from p_actor or not exists(select 1 from public.ofertas where id=p_id and estado='aceptada' and socio_id=e.socio_id) then raise exception 'No podés confirmar esta oferta.';end if;
 return jsonb_build_object('ok',true,'duplicate',true,'codigo',p.codigo_verificacion);end if;
 if p_data->>'aviso_version' is distinct from 'custodia-v2' or p_data->'acepto_aviso' is distinct from 'true'::jsonb then raise exception 'Leé y aceptá las condiciones del código y la custodia antes de confirmar.';end if;
 result:=public.chamba_job_action_legacy(p_actor,p_action,p_id,p_data);
 select * into p from public.pedidos where id=pid;
 total:=round(p.precio_cliente*100);fee:=greatest(round(total::numeric*cfg.comision_bps/10000),cfg.minimo_centavos);
 if fee>=total then raise exception 'El importe debe superar la comisión mínima.';end if;
 update public.usuarios set saldo_bloqueado=saldo_bloqueado-p.precio_socio+(total-fee)/100.0 where id=p.profesional_id;
 update public.pedidos set comision=fee/100.0,precio_socio=(total-fee)/100.0 where id=pid;
 insert into public.custodias(pedido_id,cliente_id,socio_id,total,comision,estado,pagado_at,codigo_hasta,configuracion,aviso_aceptado_at)
 values(pid,p.usuario_id,p.profesional_id,total,fee,'pendiente_codigo',t,t+make_interval(days=>cfg.codigo_dias),to_jsonb(cfg),t);
 perform public.chamba_post(pid||':pago','externo_simulado','custodia:'||pid,total,pid,p.usuario_id,p_actor,'pago',jsonb_build_object('estado_nuevo','pendiente_codigo','aviso_version','custodia-v2'));
 perform public.chamba_notify(array[p.usuario_id,p.profesional_id],pid||':pago','Pago simulado confirmado','El total está en custodia. Ingresá el código al terminar el trabajo, antes de '||(t+make_interval(days=>cfg.codigo_dias))||'. Sin código, se devuelve íntegro al Cliente.',pid);
 return result;
 elsif p_action='finish' and e.pedido_id is not null then
 if p_actor is distinct from e.socio_id then raise exception 'Solo el socio asignado puede ingresar el código.';end if;
 if e.codigo_at is not null then return jsonb_build_object('ok',true,'duplicate',true,'mensaje','El código ya fue registrado. Consultá el estado de la custodia.');end if;
 if e.estado<>'pendiente_codigo' or t>=e.codigo_hasta then raise exception 'El plazo del código terminó. Corresponde devolver el total al Cliente.';end if;
 if coalesce(p.intentos_codigo,0)>=4 then raise exception 'Límite de intentos alcanzado. Contactá a ChamBA.';end if;
 if p.codigo_verificacion is distinct from p_data->>'codigo' then update public.pedidos set intentos_codigo=coalesce(intentos_codigo,0)+1 where id=pid;return jsonb_build_object('error','Código incorrecto. Revisalo con el cliente.');end if;
 update public.custodias set estado='retenido',codigo_at=t,reclamo_hasta=t+make_interval(hours=>(e.configuracion->>'retencion_horas')::int) where pedido_id=pid;
 update public.pedidos set codigo_usado=true,estado='completado' where id=pid;
 update public.usuarios set trabajos_completados=coalesce(trabajos_completados,0)+1 where id=p_actor;
 insert into public.auditoria(actor_id,accion,pedido_id,datos) values(p_actor,'codigo_confirmado',pid,jsonb_build_object('estado_anterior','pendiente_codigo','estado_nuevo','retenido'));
 perform public.chamba_notify(array[e.cliente_id,e.socio_id],pid||':codigo','Trabajo confirmado','El dinero queda retenido durante '||(e.configuracion->>'retencion_horas')||' horas corridas. El Cliente puede reclamar dentro de ese plazo; sin reclamo, el saldo se libera al Socio.',pid);
 return jsonb_build_object('ok',true,'mensaje','Código confirmado. El saldo queda retenido durante 48 horas corridas.');
 elsif p_action in ('restart','admin_cancel','cancel') and e.pedido_id is not null then
 raise exception 'Este trabajo tiene historial de custodia. Gestioná el dinero desde su legajo; no se puede reiniciar ni borrar.';
 end if;
 result:=public.chamba_job_action_legacy(p_actor,p_action,p_id,p_data);
 if p_action in ('offer','counter') then
 total:=round((result->>'precio_ofertado')::numeric*100);fee:=greatest(round(total::numeric*cfg.comision_bps/10000),cfg.minimo_centavos);
 if fee>=total then raise exception 'El importe debe superar la comisión mínima.';end if;
 update public.ofertas set comision=fee/100.0,precio_neto=(total-fee)/100.0 where id=(result->>'id')::uuid;
 result:=result||jsonb_build_object('comision',fee/100.0,'precio_neto',(total-fee)/100.0);
 elsif p_action='finish' and e.pedido_id is null and not coalesce(p.codigo_usado,false) and not (result ? 'error') then
 -- Grandfathered jobs retain the old completion flow. Register today's release, not a fictional historical payment date.
 perform public.chamba_post(p.id||':legacy_neto','apertura_historica','disponible:'||p.profesional_id,round(p.precio_socio*100)::bigint,p.id,p.profesional_id,p_actor,'liberacion_anterior');
 perform public.chamba_post(p.id||':legacy_comision','apertura_historica','comisiones',round(p.comision*100)::bigint,p.id,null,p_actor,'comision_anterior');
 insert into public.saldo_lotes(titular_id,pedido_id,inicial,restante) values(p.profesional_id,p.id,round(p.precio_socio*100),round(p.precio_socio*100));
 end if;
 return result;
end $$;

create function public.chamba_claim(p_actor uuid,p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.usuarios;r public.reclamos;e public.custodias;p public.pedidos;cfg public.chamba_config;t timestamptz;other uuid;rid uuid;typ text;v bigint;result jsonb;x jsonb;
begin
 perform public.chamba_fin_lock();t:=clock_timestamp();select * into cfg from public.chamba_config;
 select * into u from public.usuarios where id=p_actor;
 if u.id is null or not u.email_verificado or u.estado not in ('aprobado','baja','suspendido') then raise exception 'Cuenta no habilitada.';end if;
 if p_action='create' then
 select * into r from public.reclamos where creado_por=p_actor and request_id=(p_data->>'request_id')::uuid;
 if r.id is not null then return to_jsonb(r);end if;
 typ:=p_data->>'tipo';
 select * into p from public.pedidos where id=(p_data->>'pedido_id')::uuid for update;
 if p.id is null or (p_actor is distinct from p.usuario_id and p_actor is distinct from p.profesional_id) then raise exception 'Elegí un trabajo en el que participaste.';end if;
 other:=case when p_actor=p.usuario_id then p.profesional_id else p.usuario_id end;
 if other is null then raise exception 'El trabajo todavía no tiene otra parte asignada.';end if;
 select * into e from public.custodias where pedido_id=p.id for update;
 if typ='dinero' then
 if p_actor is distinct from p.usuario_id or e.estado is distinct from 'retenido' or t>=e.reclamo_hasta then raise exception 'Solo el Cliente puede reclamar dinero durante las 48 horas posteriores al código.';end if;
 if exists(select 1 from public.reclamos where pedido_id=p.id and tipo='dinero') then raise exception 'Este trabajo ya tiene un reclamo de dinero.';end if;
 elsif typ='conducta' then
 if p_data->>'categoria' not in ('amenazas','acoso','fraude','incumplimiento','otro') then raise exception 'Elegí una categoría de conducta.';end if;
 else raise exception 'Tipo de reclamo inválido.';end if;
 insert into public.reclamos(pedido_id,creado_por,contra_id,tipo,categoria,descripcion,descargo_hasta,request_id)
 values(p.id,p_actor,other,typ,coalesce(p_data->>'categoria','trabajo'),p_data->>'descripcion',t+make_interval(hours=>cfg.descargo_horas),(p_data->>'request_id')::uuid) returning * into r;
 if typ='dinero' then update public.custodias set estado='en_disputa' where pedido_id=p.id;end if;
 perform public.chamba_notify(array[p_actor,other]||public.chamba_admins(),r.id||':creado','Nuevo reclamo','Se abrió un reclamo. La otra parte puede presentar su descargo hasta '||r.descargo_hasta||'. Los reclamos de dinero quedan congelados hasta una resolución administrativa.',p.id,r.id);
 if (select count(*) from public.reclamos where creado_por=p_actor and created_at>=t-make_interval(days=>cfg.frecuentes_dias))>=cfg.frecuentes_cantidad then
 perform public.chamba_notify(public.chamba_admins(),r.id||':frecuente','Reclamos frecuentes','Esta cuenta alcanzó el umbral configurado. Revisá el historial; no se aplica ninguna sanción automática.',p.id,r.id);end if;
 else
 select pedido_id into rid from public.reclamos where id=p_id;
 perform 1 from public.pedidos where id=rid for update;
 select * into r from public.reclamos where id=p_id for update;
 if r.id is null then raise exception 'Reclamo no encontrado.';end if;
 if p_action='respond' then
 if p_actor is distinct from r.contra_id then raise exception 'Solo la otra parte puede presentar este descargo.';end if;
 if r.descargo_at is not null then return to_jsonb(r);end if;
 if r.estado='finalizado' or t>=r.descargo_hasta then raise exception 'El plazo del descargo terminó. Contactá a administración.';end if;
 if length(trim(coalesce(p_data->>'descripcion',''))) not between 1 and 6000 then raise exception 'Escribí tu descargo.';end if;
 update public.reclamos set descargo=p_data->>'descripcion',descargo_at=t where id=p_id returning * into r;
 perform public.chamba_notify(array[r.creado_por]||public.chamba_admins(),r.id||':descargo','Descargo recibido','Se agregó el descargo al legajo del reclamo.',r.pedido_id,r.id);
 else
 if u.tipo<>'admin' or u.estado<>'aprobado' then raise exception 'Solo administración puede gestionar el reclamo.';end if;
 if r.estado='finalizado' then return to_jsonb(r);end if;
 if p_action='take' then
 if r.estado='en_proceso' then return to_jsonb(r);end if;
 update public.reclamos set estado='en_proceso',tomado_por=p_actor,tomado_at=t where id=p_id returning * into r;
 perform public.chamba_notify(array[r.creado_por,r.contra_id],r.id||':tomado','Reclamo en proceso','Administración está revisando el legajo.',r.pedido_id,r.id);
 elsif p_action='resolve' then
 if length(trim(coalesce(p_data->>'motivo',''))) not between 1 and 6000 then raise exception 'Explicá el motivo de la resolución.';end if;
 if r.tipo='dinero' then
 select * into e from public.custodias where pedido_id=r.pedido_id for update;
 if e.estado is distinct from 'en_disputa' then raise exception 'La custodia no está en disputa.';end if;
 if (p_data->>'cliente_centavos') !~ '^[0-9]+$' then raise exception 'Indicá el importe bruto del Cliente en centavos enteros.';end if;
 v:=(p_data->>'cliente_centavos')::bigint;
 result:=public.chamba_settle(r.pedido_id,v,'resolucion_admin',p_actor,r.id);
 update public.reclamos set cliente_bruto=v,socio_bruto=e.total-v,comision_cliente=(result->>'comision_cliente')::bigint,comision_socio=(result->>'comision_socio')::bigint where id=r.id;
 end if;
 update public.reclamos set estado='finalizado',resolucion=p_data->>'motivo',resuelta_at=t where id=r.id returning * into r;
 perform public.chamba_notify(array[r.creado_por,r.contra_id],r.id||':resuelto','Reclamo finalizado','La resolución administrativa está disponible en tu legajo.',r.pedido_id,r.id);
 elsif p_action='extend' then
 if (p_data->>'horas') !~ '^[0-9]+$' or (p_data->>'horas')::int not between 1 and 720 or length(trim(coalesce(p_data->>'motivo','')))=0 then raise exception 'Indicá horas (1 a 720) y motivo.';end if;
 update public.reclamos set descargo_hasta=t+make_interval(hours=>(p_data->>'horas')::int) where id=r.id returning * into r;
 perform public.chamba_notify(array[r.contra_id],r.id||':prorroga:'||t,'Plazo de descargo ampliado','Podés presentar tu descargo hasta '||r.descargo_hasta||'.',r.pedido_id,r.id);
 else raise exception 'Acción desconocida.';end if;
 end if;
 end if;
 if p_action in ('create','respond') then
 if jsonb_typeof(coalesce(p_data->'adjuntos','[]'))<>'array' or jsonb_array_length(coalesce(p_data->'adjuntos','[]'))>5 then raise exception 'Máximo 5 adjuntos.';end if;
 for x in select value from jsonb_array_elements(coalesce(p_data->'adjuntos','[]')) loop
 if left(x->>'path',length('reclamos/'||p_actor||'/')) is distinct from 'reclamos/'||p_actor||'/' then raise exception 'Adjunto inválido.';end if;
 insert into public.reclamo_adjuntos(reclamo_id,autor_id,path,nombre,mime) values(r.id,p_actor,x->>'path',left(x->>'nombre',200),x->>'mime');
 end loop;
 end if;
 insert into public.auditoria(actor_id,accion,pedido_id,reclamo_id,datos) values(p_actor,'reclamo_'||p_action,r.pedido_id,r.id,jsonb_build_object('estado',r.estado,'motivo',p_data->>'motivo'));
 return to_jsonb(r);
end $$;

create function public.chamba_expire_lots(p_user uuid default null) returns int language plpgsql security invoker set search_path='' as $$
declare l public.saldo_lotes;n int:=0;
begin
 perform public.chamba_fin_lock();
 for l in select * from public.saldo_lotes where restante>0 and no_reclamado_at is null and vence_at<=clock_timestamp() and (p_user is null or titular_id=p_user) order by vence_at,id for update loop
 perform public.chamba_post(l.id||':no_reclamado','disponible:'||l.titular_id,'no_reclamado:'||l.titular_id,l.restante,l.pedido_id,l.titular_id,null,'saldo_no_reclamado',jsonb_build_object('disponible_at',l.disponible_at,'vence_at',l.vence_at,'lote_id',l.id));
 update public.saldo_lotes set no_reclamado_at=clock_timestamp() where id=l.id;
 update public.usuarios set saldo_disponible=greatest(0,coalesce(saldo_disponible,0)-l.restante/100.0) where id=l.titular_id;
 perform public.chamba_notify(array[l.titular_id],l.id||':vencido','Plazo de retiro vencido','El saldo pasó a Saldos no reclamados. Conserva tu titularidad y su historial; contactá a administración para gestionarlo.',l.pedido_id);n:=n+1;
 end loop;return n;
end $$;
create function public.chamba_account(p_actor uuid,p_user uuid,p_state text,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.usuarios;cfg public.chamba_config;t timestamptz;
begin
 perform public.chamba_fin_lock();t:=clock_timestamp();
 if not exists(select 1 from public.usuarios where id=p_actor and tipo='admin' and estado='aprobado' and email_verificado) then raise exception 'No autorizado.';end if;
 if p_actor=p_user then raise exception 'No podés sancionar tu propia cuenta.';end if;
 if p_state not in ('baja','suspendido','aprobado') or length(trim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Indicá un estado válido y el motivo.';end if;
 select * into u from public.usuarios where id=p_user for update;select * into cfg from public.chamba_config;
 if u.id is null or u.tipo='admin' then raise exception 'Cuenta no disponible para esta acción.';end if;
 if u.estado=p_state then return jsonb_build_object('ok',true,'duplicate',true);end if;
 perform public.chamba_expire_lots(p_user);
 update public.usuarios set estado=p_state,baja_at=case when p_state='baja' then t else null end where id=p_user;
 if p_state='baja' then
 update public.saldo_lotes set vence_at=t+make_interval(days=>cfg.retiro_dias) where titular_id=p_user and restante>0 and no_reclamado_at is null;
 update public.pedidos set estado='cancelado' where usuario_id=p_user and estado='nuevo' and coalesce(estado_pago,'sin_pagar')='sin_pagar';
 update public.ofertas set estado='rechazada' where socio_id=p_user and estado in ('pendiente','negociando');
 elsif p_state='aprobado' then update public.saldo_lotes set vence_at=null where titular_id=p_user and no_reclamado_at is null;
 end if;
 insert into public.auditoria(actor_id,accion,datos) values(p_actor,'cuenta_'||p_state,jsonb_build_object('usuario_id',p_user,'anterior',u.estado,'nuevo',p_state,'motivo',p_reason));
 perform public.chamba_notify(array[p_user],p_user||':estado:'||t,'Estado de cuenta actualizado','Estado: '||p_state||'. Motivo: '||p_reason||'. Podés acceder a Reclamos y saldo. Si la cuenta fue dada de baja, cada saldo disponible tiene 7 días para retirarse.');
 if p_state in ('baja','suspendido') and exists(select 1 from public.custodias where (cliente_id=p_user or socio_id=p_user) and liquidado_at is null) then
 perform public.chamba_notify(public.chamba_admins(),p_user||':pendientes:'||t,'Cuenta con trabajos pendientes','Revisá los trabajos de la cuenta sancionada. La sanción no mueve dinero: siguen los plazos de custodia y los reclamos financieros continúan congelados.');end if;
 return jsonb_build_object('ok',true);
end $$;
create function public.chamba_withdraw(p_actor uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.usuarios;l public.saldo_lotes;amount bigint;available bigint;remaining bigint;part bigint;k text;account text;reason text;dest text;
begin
 perform public.chamba_fin_lock();select * into u from public.usuarios where id=p_actor for update;
 if u.id is null or not u.email_verificado or u.estado not in ('aprobado','suspendido','baja') then raise exception 'No autorizado.';end if;
 k:='retiro:'||p_actor||':'||(p_data->>'request_id')::uuid;
 if exists(select 1 from public.libro_contable where clave=k) then return jsonb_build_object('ok',true,'duplicate',true);end if;
 if p_data->>'centavos' !~ '^[0-9]+$' then raise exception 'Importe inválido.';end if;
 amount:=(p_data->>'centavos')::bigint;reason:=trim(p_data->>'motivo');dest:=trim(p_data->>'destino');
 if amount is null or amount<=0 or length(coalesce(reason,'')) not between 1 and 2000 or length(coalesce(dest,'')) not between 1 and 300 then raise exception 'Completá importe, destino y motivo.';end if;
 if u.tipo='admin' and u.estado='aprobado' then
 account:='comisiones';select coalesce(sum(case when destino=account then centavos else -centavos end),0) into available from public.libro_contable where origen=account or destino=account;
 else
 perform public.chamba_expire_lots(p_actor);account:='disponible:'||p_actor;
 select coalesce(sum(restante),0) into available from public.saldo_lotes where titular_id=p_actor and no_reclamado_at is null;
 end if;
 if amount>available then raise exception 'Saldo disponible insuficiente.';end if;
 if account<>'comisiones' then
 remaining:=amount;
 for l in select * from public.saldo_lotes where titular_id=p_actor and restante>0 and no_reclamado_at is null order by vence_at nulls last,disponible_at,id for update loop
 part:=least(remaining,l.restante);update public.saldo_lotes set restante=restante-part where id=l.id;remaining:=remaining-part;exit when remaining=0;
 end loop;
 update public.usuarios set saldo_disponible=greatest(0,coalesce(saldo_disponible,0)-amount/100.0) where id=p_actor;
 end if;
 perform public.chamba_post(k,account,'retirado_simulado',amount,null,p_actor,p_actor,'retiro_simulado',jsonb_build_object('destino',dest,'motivo',reason));
 insert into public.auditoria(actor_id,accion,datos) values(p_actor,'retiro_simulado',jsonb_build_object('centavos',amount,'cuenta',account,'destino',dest,'motivo',reason,'request_id',p_data->>'request_id'));
 perform public.chamba_notify(array[p_actor],k,'Retiro simulado registrado','El retiro quedó registrado. No se envió dinero real.');
 return jsonb_build_object('ok',true,'simulado',true);
end $$;
-- Corrections refund an existing commission to a named participant. No arbitrary minting.
create function public.chamba_adjust(p_actor uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.custodias;v bigint;already bigint;balance bigint;owner uuid;k text;
begin
 perform public.chamba_fin_lock();
 if not exists(select 1 from public.usuarios where id=p_actor and tipo='admin' and estado='aprobado' and email_verificado) then raise exception 'No autorizado.';end if;
 k:='ajuste:'||(p_data->>'request_id')::uuid;
 if exists(select 1 from public.libro_contable where clave=k) then return jsonb_build_object('ok',true,'duplicate',true);end if;
 select * into e from public.custodias where pedido_id=(p_data->>'pedido_id')::uuid for update;
 owner:=(p_data->>'titular_id')::uuid;v:=(p_data->>'centavos')::bigint;
 if e.liquidado_at is null or owner not in (e.cliente_id,e.socio_id) or owner is null or v is null or v<=0 or length(trim(coalesce(p_data->>'motivo','')))=0 then raise exception 'Ajuste inválido.';end if;
 select coalesce(sum(case when destino='comisiones' then centavos else -centavos end),0) into already from public.libro_contable where pedido_id=e.pedido_id and (destino='comisiones' or origen='comisiones');
 select coalesce(sum(case when destino='comisiones' then centavos else -centavos end),0) into balance from public.libro_contable where destino='comisiones' or origen='comisiones';
 if v>already or v>balance then raise exception 'El ajuste supera la comisión del trabajo o el saldo disponible.';end if;
 perform public.chamba_post(k,'comisiones','disponible:'||owner,v,e.pedido_id,owner,p_actor,'ajuste_comision',jsonb_build_object('motivo',p_data->>'motivo'));
 perform public.chamba_credit(owner,v,e.pedido_id);
 insert into public.auditoria(actor_id,accion,pedido_id,datos) values(p_actor,'ajuste_comision',e.pedido_id,p_data-'password');
 perform public.chamba_notify(array[owner],k,'Ajuste de comisión','Se acreditó un ajuste a tu saldo simulado.',e.pedido_id);
 return jsonb_build_object('ok',true);
end $$;

create function public.chamba_tick() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.custodias;r public.reclamos;cfg public.chamba_config;t timestamptz;d int;recipients uuid[];counted int:=0;
begin
 perform public.chamba_fin_lock();t:=clock_timestamp();select * into cfg from public.chamba_config;
 for e in select * from public.custodias where estado in ('pendiente_codigo','retenido') order by pagado_at for update loop
 if e.estado='pendiente_codigo' and t>=e.codigo_hasta then perform public.chamba_settle(e.pedido_id,e.total,'sin_codigo');counted:=counted+1;
 elsif e.estado='retenido' and t>=e.reclamo_hasta then perform public.chamba_settle(e.pedido_id,0,'sin_reclamo');counted:=counted+1;
 elsif e.estado='pendiente_codigo' then
 foreach d in array array[(e.configuracion->>'aviso_socio_dia')::int,(e.configuracion->>'aviso_ambos_dia')::int,(e.configuracion->>'aviso_final_dia')::int] loop
 if t>=e.pagado_at+make_interval(days=>d) then
 recipients:=case when d=(e.configuracion->>'aviso_socio_dia')::int then array[e.socio_id] else array[e.cliente_id,e.socio_id] end;
 perform public.chamba_notify(recipients,e.pedido_id||':recordatorio:'||d,'Recordatorio del código','El código vence el '||e.codigo_hasta||'. Si no se registra, el total vuelve al Cliente. Entregá e ingresá el código al terminar el trabajo.',e.pedido_id);end if;
 end loop;
 end if;
 end loop;
 -- Aging never changes a claim's financial state.
 for r in select * from public.reclamos where estado<>'finalizado' loop
 foreach d in array array[cfg.amarillo_dias,cfg.rojo_dias] loop
 if t>=r.created_at+make_interval(days=>d) then perform public.chamba_notify(public.chamba_admins(),r.id||':antiguedad:'||d,'Reclamo pendiente de atención','El reclamo alcanzó '||d||' días. Revisá su legajo; el dinero continúa congelado si hay una disputa financiera.',r.pedido_id,r.id);end if;
 end loop;end loop;
 return jsonb_build_object('liquidaciones',counted,'lotes_vencidos',public.chamba_expire_lots());
end $$;
create function public.chamba_outbox_claim() returns setof public.notificaciones language plpgsql security invoker set search_path='' as $$
begin
 return query update public.notificaciones n set lease=gen_random_uuid(),lease_hasta=clock_timestamp()+interval '5 minutes',intentos=intentos+1
 where n.id in (select id from public.notificaciones where enviado_at is null and proximo_intento<=clock_timestamp() and (lease_hasta is null or lease_hasta<clock_timestamp()) order by created_at limit 5 for update skip locked) returning n.*;
end $$;
create function public.chamba_outbox_ack(p_id uuid,p_lease uuid,p_error text default null) returns void language sql security invoker set search_path='' as $$
 update public.notificaciones set enviado_at=case when p_error is null then clock_timestamp() end,ultimo_error=left(p_error,300),lease=null,lease_hasta=null,
 proximo_intento=clock_timestamp()+make_interval(secs=>least(21600,60*power(2,least(intentos,8)))::int)
 where id=p_id and lease=p_lease;
$$;

-- Preserve pre-migration available balances as explicit opening entries, not income.
insert into public.saldo_lotes(titular_id,inicial,restante)
 select id,round(saldo_disponible*100),round(saldo_disponible*100) from public.usuarios where saldo_disponible>0;
insert into public.libro_contable(clave,origen,destino,centavos,titular_id,motivo)
 select 'apertura:'||id,'apertura_historica','disponible:'||id,round(saldo_disponible*100),id,'saldo_preexistente' from public.usuarios where saldo_disponible>0;
-- Existing reports keep their original classification and never move money implicitly.
create function public.chamba_legacy_report(p_actor uuid,p_id uuid,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform public.chamba_fin_lock();
 if not exists(select 1 from public.usuarios where id=p_actor and tipo='admin' and estado='aprobado' and email_verificado) then raise exception 'No autorizado.';end if;
 if length(trim(coalesce(p_reason,''))) not between 1 and 6000 then raise exception 'Escribí la resolución.';end if;
 update public.disputas set estado='resuelta',resolucion=p_reason,resuelta_at=clock_timestamp() where id=p_id;
 if not found then raise exception 'Reporte no encontrado.';end if;
 insert into public.auditoria(actor_id,accion,datos) values(p_actor,'reporte_anterior_cerrado',jsonb_build_object('disputa_id',p_id,'motivo',p_reason));
 return jsonb_build_object('ok',true);
end $$;
-- Deny browser roles and restrict immutable tables even for the server role.
do $$ declare t text;f record;begin
 foreach t in array array['chamba_config','custodias','reclamos','reclamo_adjuntos','libro_contable','saldo_lotes','auditoria','notificaciones'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 revoke update,delete,truncate on public.libro_contable,public.auditoria from service_role;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'chamba_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
