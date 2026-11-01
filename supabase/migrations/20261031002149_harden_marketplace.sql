-- Additive migration. Existing orders, conversations and simulated balances are retained.
alter table public.usuarios drop constraint usuarios_estado_check;
alter table public.usuarios add constraint usuarios_estado_check check (estado in ('pendiente','aprobado','rechazado','suspendido'));
alter table public.usuarios add column session_version integer not null default 0;
alter table public.usuarios add column penalizacion_reputacion numeric not null default 0;
alter table public.pedidos add column revision integer not null default 0;
alter table public.pedidos add column oculto_cliente boolean not null default false;
alter table public.mensajes add column client_message_id uuid;
alter table public.mensajes add column revision integer not null default 0;
alter table public.mensajes add column autor_id uuid references public.usuarios(id);
create index mensajes_autor_idx on public.mensajes(autor_id);
create unique index mensajes_retry_unique on public.mensajes(pedido_id,revision,autor_id,client_message_id);
create unique index calificaciones_un_trabajo on public.calificaciones(pedido_id);
create unique index ofertas_un_socio on public.ofertas(pedido_id,socio_id);
create unique index ubicaciones_una_predeterminada on public.ubicaciones(usuario_id) where predeterminada;
create index pedidos_estado_fecha on public.pedidos(estado,created_at desc);
create index mensajes_pedido_fecha on public.mensajes(pedido_id,created_at);
create index codigos_email_tipo_fecha on public.codigos_login(email,tipo,created_at desc);
create index reset_email on public.password_reset_tokens(email);
-- Cover foreign keys with no index beginning with their columns.
do $$ declare r record; begin
 for r in select c.conrelid::regclass as tbl,a.attname from pg_constraint c
 join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.contype='f' and c.connamespace='public'::regnamespace and cardinality(c.conkey)=1
 and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1])
 loop execute format('create index if not exists %I on %s (%I)',replace(r.tbl::text,'public.','')||'_'||r.attname||'_idx',r.tbl,r.attname); end loop;
end $$;
create table public.movimientos_simulados(
 id uuid primary key default gen_random_uuid(), pedido_id uuid not null references public.pedidos(id),
 socio_id uuid not null references public.usuarios(id), revision integer not null, tipo text not null,
 monto numeric not null, created_at timestamptz not null default now(), unique(pedido_id,revision,tipo)
);
alter table public.movimientos_simulados enable row level security;
revoke all on public.movimientos_simulados from anon,authenticated;
grant all on public.movimientos_simulados to service_role;
create index movimientos_socio_idx on public.movimientos_simulados(socio_id);

create function public.chamba_revoke_sessions() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.password_hash is distinct from old.password_hash or new.estado is distinct from old.estado or new.tipo is distinct from old.tipo then
 new.session_version := old.session_version+1;
 end if; return new;
end $$;
create trigger revoke_changed_session before update on public.usuarios for each row execute function public.chamba_revoke_sessions();
revoke all on function public.chamba_revoke_sessions() from public,anon,authenticated;

-- Called only by the authenticated application server, never by browser roles.
create function public.chamba_job_action(p_actor uuid,p_action text,p_id uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u public.usuarios; p public.pedidos; o public.ofertas; v numeric; c numeric; n numeric; pid uuid; code text; rating public.calificaciones;
begin
 select * into u from public.usuarios where id=p_actor;
 if u.id is null or u.estado is distinct from 'aprobado' or u.email_verificado is distinct from true then raise exception 'Cuenta no habilitada.'; end if;
 if p_action in ('counter','partner_agree','accept','reject') then
 select pedido_id into pid from public.ofertas where id=p_id;
 else pid:=p_id; end if;
 select * into p from public.pedidos where id=pid for update;
 if p.id is null then raise exception 'Pedido no encontrado.'; end if;
 if p_action in ('counter','partner_agree','accept','reject') then
 select * into o from public.ofertas where id=p_id for update;
 if o.id is null then raise exception 'Oferta no encontrada.'; end if;
 end if;

 if p_action='offer' then
 if u.tipo<>'socio' or p.usuario_id=p_actor or p.estado is distinct from 'nuevo' then raise exception 'No podés ofertar en este trabajo.'; end if;
 if not exists(select 1 from public.especialidades where nombre=p.servicio and activa) then raise exception 'Servicio no disponible.'; end if;
 if not p.servicio=any(regexp_split_to_array(coalesce(u.especialidad,''),'\s*,\s*')) then raise exception 'Este trabajo no corresponde a tus especialidades.'; end if;
 if exists(select 1 from public.relaciones_socio where cliente_id=p.usuario_id and socio_id=p_actor and tipo='bloqueado') then raise exception 'Trabajo no disponible.'; end if;
 if p.socio_preferido_id is not null and p.socio_preferido_id<>p_actor then raise exception 'Trabajo no disponible.'; end if;
 if p.socio_preferido_id is null and not exists(
 select 1 from public.ubicaciones x where x.usuario_id=p_actor and x.predeterminada and x.lat is not null and p.lat is not null
 and 6371*2*asin(sqrt(least(1,power(sin(radians((p.lat-x.lat)::double precision)/2),2)+cos(radians(x.lat::double precision))*cos(radians(p.lat::double precision))*power(sin(radians((p.lng-x.lng)::double precision)/2),2))))<=15
 ) then raise exception 'Trabajo fuera de tu zona.'; end if;
 v:=(p_data->>'precio')::numeric;
 if v is null or v<=1000 or v<>trunc(v) or v>100000000 or v::text in ('NaN','Infinity','-Infinity') then raise exception 'El precio debe superar $1.000 y ser válido.'; end if;
 if exists(select 1 from public.ofertas where pedido_id=p.id and socio_id=u.id and estado='pendiente' and precio_ofertado=v and ultima_oferta_de='socio') then
 select * into o from public.ofertas where pedido_id=p.id and socio_id=u.id;return to_jsonb(o)||jsonb_build_object('duplicate',true);end if;
 v:=round(v); c:=greatest(round(v*0.13),1000); n:=v-c;
 insert into public.ofertas(pedido_id,socio_id,socio_nombre,especialidad,precio_ofertado,precio_neto,comision,estado,ultima_oferta_de)
 values(p.id,u.id,u.nombre,p.servicio,v,n,c,'pendiente','socio') on conflict(pedido_id,socio_id)
 do update set precio_ofertado=v,precio_neto=n,comision=c,estado='pendiente',ultima_oferta_de='socio' returning * into o;
 return to_jsonb(o);
 end if;

 if p_action='counter' then
 if p.estado is distinct from 'nuevo' or coalesce(o.estado,'') not in ('pendiente','negociando') or (p_actor is distinct from p.usuario_id and p_actor is distinct from o.socio_id) then raise exception 'No podés negociar esta oferta.'; end if;
 v:=(p_data->>'precio')::numeric;
 if v is null or v<=1000 or v<>trunc(v) or v>100000000 or v::text in ('NaN','Infinity','-Infinity') then raise exception 'El precio debe superar $1.000 y ser válido.'; end if;
 if o.precio_ofertado=v and o.ultima_oferta_de=(case when p_actor=o.socio_id then 'socio' else 'cliente' end) then return to_jsonb(o)||jsonb_build_object('duplicate',true);end if;
 v:=round(v);c:=greatest(round(v*0.13),1000);
 update public.ofertas set precio_ofertado=v,precio_neto=v-c,comision=c,estado='negociando',ultima_oferta_de=case when p_actor=o.socio_id then 'socio' else 'cliente' end where id=o.id returning * into o;
 return to_jsonb(o);
 end if;

 if p_action='partner_agree' then
 if p_actor is distinct from o.socio_id or p.estado is distinct from 'nuevo' or coalesce(o.estado,'') not in ('negociando','pendiente') then raise exception 'No podés aceptar esta propuesta.'; end if;
 if o.estado='pendiente' and o.ultima_oferta_de='socio' then return jsonb_build_object('ok',true,'duplicate',true);end if;
 update public.ofertas set estado='pendiente',ultima_oferta_de='socio' where id=o.id;
 return jsonb_build_object('ok',true,'mensaje','Precio aceptado. El cliente debe confirmar el trabajo.');
 end if;

 if p_action='accept' then
 if p_actor is distinct from p.usuario_id then raise exception 'Solo el cliente puede confirmar el trabajo.'; end if;
 if o.estado='aceptada' and p.profesional_id=o.socio_id and p.estado='en_proceso' then return jsonb_build_object('ok',true,'codigo',p.codigo_verificacion); end if;
 if p.estado is distinct from 'nuevo' or coalesce(o.estado,'') not in ('pendiente','negociando') or o.ultima_oferta_de is distinct from 'socio' then raise exception 'El socio debe aceptar primero la última propuesta.'; end if;
 if not exists(select 1 from public.usuarios where id=o.socio_id and tipo='socio' and estado='aprobado') then raise exception 'Socio no habilitado.'; end if;
 if o.precio_neto<=0 then raise exception 'Pedile al socio una oferta con un importe válido.'; end if;
 code:=p_data->>'codigo'; if code !~ '^[0-9]{4}$' or code is null then raise exception 'Código inválido.'; end if;
 update public.pedidos set profesional_id=o.socio_id,estado='en_proceso',estado_pago='pagado',precio_cliente=o.precio_ofertado,precio_socio=o.precio_neto,comision=o.comision,
 codigo_verificacion=code,intentos_codigo=0,codigo_usado=false,dinero_liberado=false,chat_habilitado=true,mensaje_email_enviado=false,revision=revision+1 where id=p.id returning * into p;
 update public.usuarios set saldo_bloqueado=coalesce(saldo_bloqueado,0)+o.precio_neto where id=o.socio_id;
 insert into public.movimientos_simulados(pedido_id,socio_id,revision,tipo,monto) values(p.id,o.socio_id,p.revision,'bloqueo',o.precio_neto);
 update public.ofertas set estado=case when id=o.id then 'aceptada' else 'rechazada' end where pedido_id=p.id;
 return jsonb_build_object('ok',true,'codigo',code);
 end if;

 if p_action='finish' then
 if p_actor is distinct from p.profesional_id then raise exception 'Solo el socio asignado puede ingresar el código.'; end if;
 if p.codigo_usado and p.estado='completado' then return jsonb_build_object('ok',true,'mensaje','El trabajo ya estaba finalizado.'); end if;
 if p.estado is distinct from 'en_proceso' or p.estado_pago is distinct from 'pagado' then raise exception 'El trabajo no está habilitado para finalizar.'; end if;
 if p.intentos_codigo>=4 then raise exception 'Límite de intentos alcanzado. Contactá a ChamBA.'; end if;
 if p.codigo_verificacion is null or p.codigo_verificacion is distinct from p_data->>'codigo' then
 update public.pedidos set intentos_codigo=coalesce(intentos_codigo,0)+1 where id=p.id;
 return jsonb_build_object('error','Código incorrecto. Revisalo con el cliente.');
 end if;
 update public.pedidos set codigo_usado=true,estado='completado',dinero_liberado=true,estado_pago='liberado',mensaje_email_enviado=false where id=p.id;
 update public.usuarios set saldo_disponible=coalesce(saldo_disponible,0)+p.precio_socio,saldo_bloqueado=greatest(0,coalesce(saldo_bloqueado,0)-p.precio_socio),trabajos_completados=coalesce(trabajos_completados,0)+1 where id=p_actor;
 insert into public.movimientos_simulados(pedido_id,socio_id,revision,tipo,monto) values(p.id,p_actor,p.revision,'liberacion',p.precio_socio);
 return jsonb_build_object('ok',true,'mensaje','¡Trabajo confirmado! Se actualizó tu saldo simulado.');
 end if;

 if p_action='reject' then
 if p_actor is distinct from o.socio_id then raise exception 'No podés rechazar esta oferta.'; end if;
 if o.estado='rechazada' then return jsonb_build_object('ok',true); end if;
 if p.estado is distinct from 'nuevo' then raise exception 'Reportá un problema para cancelar un trabajo ya confirmado.'; end if;
 update public.ofertas set estado='rechazada' where id=o.id;
 update public.usuarios set penalizacion_reputacion=penalizacion_reputacion+0.2,promedio_estrellas=greatest(1,coalesce(nullif(promedio_estrellas,0),5)-0.2) where id=p_actor;
 return jsonb_build_object('ok',true);
 end if;

 if p_action in ('restart','cancel','archive','admin_cancel') then
 if p_action='admin_cancel' then if u.tipo<>'admin' then raise exception 'No autorizado.'; end if;
 elsif p_actor is distinct from p.usuario_id then raise exception 'Solo el cliente puede modificar su solicitud.'; end if;
 if p_action='archive' then
 if p.estado is distinct from 'cancelado' then raise exception 'Solo podés ocultar solicitudes canceladas.'; end if;
 update public.pedidos set oculto_cliente=true where id=p.id; return jsonb_build_object('ok',true);
 end if;
 if p.estado='completado' then raise exception 'Un trabajo terminado se gestiona mediante un reporte.'; end if;
 if p_action='cancel' and p.estado is distinct from 'nuevo' then raise exception 'Reportá un problema para cancelar un trabajo confirmado.'; end if;
 if p.estado_pago='pagado' and p.profesional_id is not null then
 update public.usuarios set saldo_bloqueado=greatest(0,coalesce(saldo_bloqueado,0)-p.precio_socio) where id=p.profesional_id;
 insert into public.movimientos_simulados(pedido_id,socio_id,revision,tipo,monto) values(p.id,p.profesional_id,p.revision,'anulacion',p.precio_socio) on conflict do nothing;
 end if;
 update public.pedidos set estado=case when p_action='restart' then 'nuevo' else 'cancelado' end,estado_pago='sin_pagar',profesional_id=null,
 precio_cliente=0,precio_socio=0,comision=0,codigo_verificacion=null,intentos_codigo=0,codigo_usado=false,dinero_liberado=false,chat_habilitado=false,mensaje_email_enviado=false,socio_preferido_id=null where id=p.id;
 update public.ofertas set estado='rechazada' where pedido_id=p.id;
 return jsonb_build_object('ok',true);
 end if;

 if p_action='rate' then
 if p_actor is distinct from p.usuario_id or p.estado is distinct from 'completado' or p.profesional_id is null then raise exception 'Solo podés calificar tu trabajo terminado.'; end if;
 v:=(p_data->>'estrellas')::numeric; if v is null or v<1 or v>5 or v<>trunc(v) or v::text in ('NaN','Infinity','-Infinity') then raise exception 'Elegí de 1 a 5 estrellas.'; end if;
 perform 1 from public.usuarios where id=p.profesional_id for update;
 insert into public.calificaciones(pedido_id,socio_id,cliente_id,estrellas,comentario) values(p.id,p.profesional_id,p_actor,v,left(p_data->>'comentario',2000)) on conflict(pedido_id) do nothing returning * into rating;
 update public.pedidos set calificado=true where id=p.id;
 update public.usuarios set promedio_estrellas=greatest(1,round((select avg(estrellas) from public.calificaciones where socio_id=p.profesional_id)-penalizacion_reputacion,1)),total_calificaciones=(select count(*) from public.calificaciones where socio_id=p.profesional_id),trabajos_completados=(select count(*) from public.pedidos where profesional_id=p.profesional_id and estado='completado') where id=p.profesional_id;
 return jsonb_build_object('ok',true);
 end if;
 raise exception 'Acción desconocida.';
end $$;
revoke all on function public.chamba_job_action(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chamba_job_action(uuid,text,uuid,jsonb) to service_role;

create function public.chamba_default_location(p_actor uuid,p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.usuarios where id=p_actor for update;
 if not exists(select 1 from public.ubicaciones where id=p_id and usuario_id=p_actor) then raise exception 'Ubicación no disponible.'; end if;
 update public.ubicaciones set predeterminada=false where usuario_id=p_actor;
 update public.ubicaciones set predeterminada=true where id=p_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_default_location(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chamba_default_location(uuid,uuid) to service_role;

-- OTP hashes are consumed under a row lock; failed attempts persist.
create function public.chamba_consume_code(p_email text,p_tipo text,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.codigos_login;
begin
 select * into c from public.codigos_login where email=p_email and tipo=p_tipo and not usado order by created_at desc limit 1 for update;
 if c.id is null or c.expira_at<now() or c.intentos>=5 then return jsonb_build_object('ok',false); end if;
 if c.codigo is distinct from p_hash then update public.codigos_login set intentos=intentos+1 where id=c.id;return jsonb_build_object('ok',false);end if;
 update public.codigos_login set usado=true where id=c.id;
 if p_tipo='registro' then update public.usuarios set email_verificado=true where email=p_email;end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_consume_code(text,text,text) from public,anon,authenticated;
grant execute on function public.chamba_consume_code(text,text,text) to service_role;

create function public.chamba_reset_password(p_token text,p_password_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.password_reset_tokens;
begin
 select * into t from public.password_reset_tokens where token=p_token and not usado for update;
 if t.id is null or t.expira_at<now() then raise exception 'Link inválido o vencido. Pedí uno nuevo.';end if;
 update public.usuarios set password_hash=p_password_hash where email=t.email;
 update public.password_reset_tokens set usado=true where email=t.email;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_reset_password(text,text) from public,anon,authenticated;
grant execute on function public.chamba_reset_password(text,text) to service_role;

update storage.buckets set file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'] where id='identificaciones';
alter extension unaccent set schema extensions;

create function public.chamba_register(p_user jsonb,p_locations jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid; x jsonb;
begin
 uid:=(p_user->>'id')::uuid;
 insert into public.usuarios(id,nombre,email,telefono,tipo,especialidad,dni,experiencia,matricula,matricula_organismo,mensaje_solicitud,password_hash,estado,email_verificado,nombre_usuario,nombre_usuario_actualizado_at,dni_foto_path,foto_perfil_path)
 values(uid,p_user->>'nombre',p_user->>'email',p_user->>'telefono',p_user->>'tipo',p_user->>'especialidad',p_user->>'dni',p_user->>'experiencia',p_user->>'matricula',p_user->>'matricula_organismo',p_user->>'mensaje_solicitud',p_user->>'password_hash',p_user->>'estado',false,p_user->>'nombre_usuario',now(),p_user->>'dni_foto_path',p_user->>'foto_perfil_path');
 for x in select value from jsonb_array_elements(p_locations) loop
 insert into public.ubicaciones(usuario_id,etiqueta,direccion,lat,lng,zona,tipo,predeterminada) values(uid,x->>'etiqueta',x->>'direccion',(x->>'lat')::numeric,(x->>'lng')::numeric,x->>'zona',x->>'tipo',(x->>'predeterminada')::boolean);
 end loop;
 return jsonb_build_object('id',uid);
end $$;
revoke all on function public.chamba_register(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.chamba_register(jsonb,jsonb) to service_role;

-- A message is checked and inserted under the same job lock used for reassignment.
create function public.chamba_send_message(p_actor uuid,p_job uuid,p_retry uuid,p_content text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.pedidos;u public.usuarios;m public.mensajes;r text;
begin
 select * into p from public.pedidos where id=p_job for update;
 select * into u from public.usuarios where id=p_actor;
 if p.id is null or u.estado is distinct from 'aprobado' or u.email_verificado is distinct from true
 or p.chat_habilitado is distinct from true or (p_actor is distinct from p.usuario_id and p_actor is distinct from p.profesional_id) then raise exception 'No sos parte de una conversación habilitada.';end if;
 if p_retry is null or length(trim(coalesce(p_content,''))) not between 1 and 4000 then raise exception 'Mensaje inválido.';end if;
 select * into m from public.mensajes where pedido_id=p.id and revision=p.revision and autor_id=p_actor and client_message_id=p_retry;
 if m.id is not null then return jsonb_build_object('message',to_jsonb(m),'job',to_jsonb(p)-'codigo_verificacion','duplicate',true);end if;
 r:=case when p_actor=p.profesional_id then 'socio' else 'cliente' end;
 insert into public.mensajes(pedido_id,autor,autor_id,rol,contenido,revision,client_message_id)
 values(p.id,u.nombre,p_actor,r,trim(p_content),p.revision,p_retry) returning * into m;
 return jsonb_build_object('message',to_jsonb(m),'job',to_jsonb(p)-'codigo_verificacion','duplicate',false);
end $$;
revoke all on function public.chamba_send_message(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.chamba_send_message(uuid,uuid,uuid,text) to service_role;

create function public.chamba_issue_code(p_email text,p_tipo text,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.usuarios where email=p_email for update;
 if not found or p_tipo not in ('registro','login') or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Datos inválidos.';end if;
 if exists(select 1 from public.codigos_login where email=p_email and tipo=p_tipo and created_at>now()-interval '60 seconds') then raise exception 'Esperá un minuto antes de pedir otro código.';end if;
 update public.codigos_login set usado=true where email=p_email and tipo=p_tipo and not usado;
 insert into public.codigos_login(email,codigo,tipo,expira_at,usado)values(p_email,p_hash,p_tipo,now()+interval '10 minutes',false);
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_issue_code(text,text,text) from public,anon,authenticated;
grant execute on function public.chamba_issue_code(text,text,text) to service_role;

create function public.chamba_license_decision(p_actor uuid,p_id uuid,p_estado text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.solicitudes_matricula;u public.usuarios;
begin
 if not exists(select 1 from public.usuarios where id=p_actor and tipo='admin' and estado='aprobado') or p_estado not in ('aprobada','rechazada') then raise exception 'Acción no permitida.';end if;
 select * into s from public.solicitudes_matricula where id=p_id for update;
 if s.id is null then raise exception 'Solicitud no encontrada.';end if;
 if s.estado=p_estado then return jsonb_build_object('ok',true);end if;
 if s.estado<>'pendiente' then raise exception 'Esta solicitud ya fue resuelta.';end if;
 if p_estado='aprobada' then
 select * into u from public.usuarios where id=s.socio_id for update;
 if u.tipo<>'socio' then raise exception 'La cuenta ya no es de Socio.';end if;
 update public.usuarios set
 matricula=concat_ws(', ',nullif(matricula,''),s.matricula_nueva),
 matricula_organismo=concat_ws(', ',nullif(matricula_organismo,''),nullif(s.matricula_organismo,'')),
 especialidad=case when s.especialidad=any(regexp_split_to_array(coalesce(especialidad,''),'\s*,\s*')) then especialidad else concat_ws(', ',nullif(especialidad,''),s.especialidad) end
 where id=s.socio_id;
 end if;
 update public.solicitudes_matricula set estado=p_estado,visto=false where id=p_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_license_decision(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.chamba_license_decision(uuid,uuid,text) to service_role;

create function public.chamba_submit_partner(p_actor uuid,p_data jsonb,p_location jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.usuarios where id=p_actor and tipo='cliente' and estado='aprobado' for update;
 if not found then raise exception 'Esta solicitud requiere una cuenta de Cliente activa.';end if;
 update public.usuarios set tipo='socio',estado='pendiente',dni=p_data->>'dni',especialidad=p_data->>'especialidad',experiencia=p_data->>'experiencia',
 matricula=p_data->>'matricula',matricula_organismo=p_data->>'matricula_organismo',dni_foto_path=p_data->>'dni_foto_path',foto_perfil_path=p_data->>'foto_perfil_path',conversion_desde_cliente=true where id=p_actor;
 if p_location is not null then
 insert into public.ubicaciones(usuario_id,etiqueta,direccion,lat,lng,zona,tipo,predeterminada) values(p_actor,'Zona de trabajo',p_location->>'direccion',(p_location->>'lat')::numeric,(p_location->>'lng')::numeric,p_location->>'zona','trabajo',false);
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_submit_partner(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.chamba_submit_partner(uuid,jsonb,jsonb) to service_role;

create function public.chamba_remove_location(p_actor uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare was_default boolean; next_id uuid;
begin
 perform 1 from public.usuarios where id=p_actor for update;
 select predeterminada into was_default from public.ubicaciones where id=p_id and usuario_id=p_actor for update;
 if not found then raise exception 'Ubicación no disponible.';end if;
 delete from public.ubicaciones where id=p_id;
 if was_default then
 select id into next_id from public.ubicaciones where usuario_id=p_actor order by created_at,id limit 1;
 if next_id is not null then update public.ubicaciones set predeterminada=true where id=next_id;end if;
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.chamba_remove_location(uuid,uuid) from public,anon,authenticated;
grant execute on function public.chamba_remove_location(uuid,uuid) to service_role;
