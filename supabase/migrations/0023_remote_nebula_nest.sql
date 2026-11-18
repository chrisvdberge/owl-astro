-- Nebula Nest (Wimmera, Victoria) joins the tracked observatories: the worker (app/worker/remote.js) reads its public
-- CloudWatcher feed (weather.nebulanest.online). No roof status is published, so nights are summarised by the cloud
-- sensor only, like Sierra Remote.
insert into public.remote_observatories values
  ('nebula-nest', 'Nebula Nest', 'Australia/Melbourne', -36.30, 142.05)
on conflict (slug) do nothing;
