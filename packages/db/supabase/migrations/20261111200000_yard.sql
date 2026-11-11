-- The company yard, where trucks start and end (issue 64). Additive: one nullable column and one with a default.
-- yard: { "address": text, "lat": number, "lon": number }, geocoded by the server when an owner saves it.
-- yard_trip: whether Suggest order starts and ends this route at the yard. On unless the office turns it off.

alter table tenant add column if not exists yard jsonb;
alter table route add column if not exists yard_trip boolean not null default true;

grant update (yard) on tenant to authenticated;
grant update (yard_trip) on route to authenticated;
