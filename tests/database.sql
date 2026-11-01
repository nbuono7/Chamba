-- Execute after the migration within BEGIN/ROLLBACK. No external services or emails.
do $$
declare cli uuid:=gen_random_uuid();soc uuid:=gen_random_uuid();stranger uuid:=gen_random_uuid();job uuid:=gen_random_uuid();offer uuid;result jsonb;v numeric;
begin
 insert into public.usuarios(id,nombre,email,nombre_usuario,tipo,estado,email_verificado) values
 (cli,'Prueba cliente',cli||'@example.invalid',left(cli::text,20),'cliente','aprobado',true),
 (soc,'Prueba socio',soc||'@example.invalid',left(soc::text,20),'socio','aprobado',true),
 (stranger,'Prueba tercero',stranger||'@example.invalid',left(stranger::text,20),'cliente','aprobado',true);
 update public.usuarios set especialidad='Fletes, Limpieza' where id=soc;
 insert into public.ubicaciones(usuario_id,etiqueta,direccion,lat,lng,predeterminada) values(soc,'Prueba','Prueba',-34.6,-58.4,true);
 insert into public.pedidos(id,usuario_id,servicio,descripcion,estado,lat,lng) values(job,cli,'Fletes','Prueba transaccional','nuevo',-34.6,-58.4);
 result:=public.chamba_job_action(soc,'offer',job,'{"precio":10000}');offer:=(result->>'id')::uuid;
 assert (result->>'precio_neto')::numeric=8700;
 perform public.chamba_job_action(cli,'counter',offer,'{"precio":9000}');
 perform public.chamba_job_action(soc,'partner_agree',offer);
 begin perform public.chamba_job_action(stranger,'accept',offer,'{"codigo":"1234"}');raise exception 'Unauthorized acceptance permitted';exception when raise_exception then if sqlerrm='Unauthorized acceptance permitted' then raise;end if;end;
 perform public.chamba_job_action(cli,'accept',offer,'{"codigo":"1234"}');
 perform public.chamba_job_action(cli,'accept',offer,'{"codigo":"9999"}');
 select saldo_bloqueado into v from public.usuarios where id=soc;assert v=7830;
 result:=public.chamba_job_action(soc,'finish',job,'{"codigo":"0000"}');assert result ? 'error';
 select intentos_codigo into v from public.pedidos where id=job;assert v=1;
 perform public.chamba_job_action(soc,'finish',job,'{"codigo":"1234"}');
 perform public.chamba_job_action(soc,'finish',job,'{"codigo":"1234"}');
 select saldo_disponible into v from public.usuarios where id=soc;assert v=7830;
 perform public.chamba_job_action(cli,'rate',job,'{"estrellas":5,"comentario":"Prueba"}');
 perform public.chamba_job_action(cli,'rate',job,'{"estrellas":1}');
 select count(*) into v from public.calificaciones where pedido_id=job;assert v=1;
 assert not has_function_privilege('anon','public.chamba_job_action(uuid,text,uuid,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.chamba_consume_code(text,text,text)','EXECUTE');
 update public.usuarios set estado='suspendido' where id=soc;
 select session_version into v from public.usuarios where id=soc;assert v=1;
end $$;

do $$
declare cli uuid:=gen_random_uuid();soc uuid:=gen_random_uuid();new_soc uuid:=gen_random_uuid();job uuid:=gen_random_uuid();oid uuid;retry uuid:=gen_random_uuid();r jsonb;v numeric;
begin
 insert into public.usuarios(id,nombre,email,tipo,estado,email_verificado,especialidad) values
 (cli,'Cliente prueba',cli||'@example.invalid','cliente','aprobado',true,null),
 (soc,'Socio prueba',soc||'@example.invalid','socio','aprobado',true,'Fletes'),
 (new_soc,'Otro socio',new_soc||'@example.invalid','socio','aprobado',true,'Fletes');
 insert into public.ubicaciones(usuario_id,etiqueta,direccion,lat,lng,predeterminada)values(soc,'Casa','Prueba',-34.6,-58.4,true),(new_soc,'Casa','Prueba',-34.6,-58.4,true);
 insert into public.pedidos(id,usuario_id,servicio,descripcion,lat,lng)values(job,cli,'Fletes','Prueba',-34.6,-58.4);
 begin perform public.chamba_job_action(cli,'offer',job,'{"precio":10000}');raise exception 'Client offered';exception when raise_exception then if sqlerrm='Client offered' then raise;end if;end;
 begin perform public.chamba_job_action(soc,'offer',job,'{"precio":500}');raise exception 'Negative net accepted';exception when raise_exception then if sqlerrm='Negative net accepted' then raise;end if;end;
 r:=public.chamba_job_action(soc,'offer',job,'{"precio":10000}');oid:=(r->>'id')::uuid;
 perform public.chamba_job_action(cli,'accept',oid,'{"codigo":"1111"}');
 r:=public.chamba_send_message(cli,job,retry,'Hola');assert not (r->>'duplicate')::boolean;
 r:=public.chamba_send_message(cli,job,retry,'Hola');assert (r->>'duplicate')::boolean;
 select count(*) into v from public.mensajes where pedido_id=job;assert v=1;
 perform public.chamba_job_action(cli,'restart',job);
 select saldo_bloqueado into v from public.usuarios where id=soc;assert v=0;
 r:=public.chamba_job_action(new_soc,'offer',job,'{"precio":10000}');oid:=(r->>'id')::uuid;
 perform public.chamba_job_action(cli,'accept',oid,'{"codigo":"2222"}');
 select count(*) into v from public.mensajes m join public.pedidos p on p.id=m.pedido_id and p.revision=m.revision where p.id=job;assert v=0;
 begin perform public.chamba_send_message(soc,job,retry,'No autorizado');raise exception 'Old partner sent message';exception when raise_exception then if sqlerrm='Old partner sent message' then raise;end if;end;
 assert not has_function_privilege('anon','public.chamba_send_message(uuid,uuid,uuid,text)','EXECUTE');
 insert into public.codigos_login(email,codigo,tipo,expira_at)values(cli||'@example.invalid','hash-de-prueba','login',now()+interval '10 minutes');
 for i in 1..5 loop r:=public.chamba_consume_code(cli||'@example.invalid','login','incorrecto');assert not (r->>'ok')::boolean;end loop;
 r:=public.chamba_consume_code(cli||'@example.invalid','login','hash-de-prueba');assert not (r->>'ok')::boolean;
 insert into public.password_reset_tokens(email,token,expira_at)values(cli||'@example.invalid','hash-reset',now()+interval '1 hour');
 perform public.chamba_reset_password('hash-reset','new-password-hash');
 select session_version into v from public.usuarios where id=cli;assert v=1;
 begin perform public.chamba_reset_password('hash-reset','again');raise exception 'Reset reused';exception when raise_exception then if sqlerrm='Reset reused' then raise;end if;end;
end $$;
