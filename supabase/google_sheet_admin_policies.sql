-- Google Sheets admin integration needs write access for admin-edited settings.
-- For production, prefer moving these writes behind a Supabase Edge Function with a server-side secret.

drop policy if exists "Sheet admin manage clinic settings" on public.clinic_settings;
create policy "Sheet admin manage clinic settings"
on public.clinic_settings for all
to anon
using (true)
with check (true);

drop policy if exists "Sheet admin manage time blocks" on public.appointment_time_blocks;
create policy "Sheet admin manage time blocks"
on public.appointment_time_blocks for all
to anon
using (true)
with check (true);

drop policy if exists "Sheet admin manage wait rules" on public.wait_time_rules;
create policy "Sheet admin manage wait rules"
on public.wait_time_rules for all
to anon
using (true)
with check (true);
