create or replace function public.debug_auth_context()
returns json
language sql
stable
as $$
    select json_build_object(
        'uid', auth.uid(),
        'role', auth.role(),
        'current_user', current_user,
        'session_user', session_user
    );
$$;

grant execute on function public.debug_auth_context() to authenticated;
