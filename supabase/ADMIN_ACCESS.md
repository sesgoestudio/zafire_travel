# Acceso del administrador ZAFIRE

El panel usa una sola contraseña privada y no requiere crear usuarios en Supabase Auth.

## Activar la contraseña inicial

1. Abre el proyecto Supabase de ZAFIRE.
2. Entra a **SQL Editor**.
3. Sustituye el texto `CAMBIA_ESTA_FRASE_POR_TU_CONTRASENA_PRIVADA` por una contraseña larga y exclusiva (recomendado: 16 caracteres o más).
4. Ejecuta el SQL:

```sql
insert into public.zafire_admin_credentials (id, password_hash)
values (
  true,
  extensions.crypt(
    'CAMBIA_ESTA_FRASE_POR_TU_CONTRASENA_PRIVADA',
    extensions.gen_salt('bf', 12)
  )
)
on conflict (id) do update
set password_hash = excluded.password_hash,
    updated_at = now();
```

No compartas esa contraseña por WhatsApp, correo ni dentro de conversaciones. No se guarda en texto plano: PostgreSQL almacena el hash bcrypt.

## Seguridad

- La contraseña se verifica dentro de una Edge Function.
- Las operaciones administrativas usan la clave de servicio únicamente en el servidor.
- El navegador recibe un token aleatorio de sesión; solo se almacena su hash en la base de datos.
- Las sesiones duran 12 horas y se pueden cerrar desde el panel.
- Se limita la frecuencia de intentos de acceso por origen de red.
- Las tablas privadas de sesiones y credenciales no permiten acceso a `anon` ni `authenticated`.
- El panel no utiliza Supabase Auth, ni pide UUID, correo o cuentas de vendedores.

## Cambiar la contraseña

Vuelve a ejecutar el mismo SQL con una contraseña nueva. Las sesiones abiertas existentes se pueden invalidar eliminando sus registros:

```sql
delete from public.zafire_admin_sessions;
```

## Origen web permitido

La función acepta actualmente el origen `https://sesgoestudio.github.io`, que corresponde a GitHub Pages. Si ZAFIRE se publica después bajo un dominio propio, habrá que añadir ese origen a la lista permitida de la Edge Function.
