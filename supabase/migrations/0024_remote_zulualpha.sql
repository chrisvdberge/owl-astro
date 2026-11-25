-- ZuluAlpha (Sutherland, South Africa) joins the tracked observatories: the worker (app/worker/remote.js) reads the
-- CloudWatcher feed behind its public status page. Nights are summarised by the cloud sensor, like Nebula Nest.
insert into public.remote_observatories values
  ('zulualpha', 'ZuluAlpha', 'Africa/Johannesburg', -32.3558, 20.6465)
on conflict (slug) do nothing;
