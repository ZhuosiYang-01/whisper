-- Run once after deploying the Edge Function and storing project_url and cron_secret in Vault.
-- select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
-- select vault.create_secret('YOUR_RANDOM_CRON_SECRET', 'cron_secret');

select cron.schedule(
  'deliver-due-notes',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/deliver-notes',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
    body := '{}'::jsonb
  );
  $$
);
