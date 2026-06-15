CREATE TYPE public.status AS ENUM ('a', 'b');
CREATE DOMAIN public.note_domain AS text CHECK (VALUE <> 'bad');

CREATE TABLE public.categories (id bigint NOT NULL);
CREATE TABLE public.stories (id bigint NOT NULL, category_id bigint);
CREATE TABLE public.boxes (id bigint NOT NULL);
CREATE TABLE public.box_items (id bigint NOT NULL, box_id bigint);
CREATE TABLE public.people (id bigint NOT NULL);
CREATE TABLE public.teams (id bigint NOT NULL);
CREATE TABLE public.team_people (team_id bigint, person_id bigint);

CREATE TABLE public.weird_cols (
  id bigint,
  ,
  oddtype without time zone,
  note text DEFAULT 'it''s fine' CHECK (note <> 'x')
);

CREATE TABLE public.quote_check (
  id bigint,
  CONSTRAINT quote_check_val CHECK (note <> 'O''Reilly')
);

CREATE TABLE public.apis (id bigint NOT NULL);
CREATE TABLE public.channels (id bigint NOT NULL);
CREATE TABLE public.apis_channels (
  api_id bigint NOT NULL,
  channel_id bigint NOT NULL,
  role character varying
);

ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_api_id_fkey FOREIGN KEY (api_id) REFERENCES public.apis(id);
ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);

CREATE TABLE public.pk_alt (id bigint);
ALTER TABLE ONLY public.pk_alt ADD CONSTRAINT pk_alt_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX index_ghost ON public.missing USING btree (id);
ALTER TABLE ONLY public.missing ADD CONSTRAINT missing_unique UNIQUE (id);
ALTER TABLE ONLY public.missing ADD CONSTRAINT missing_check CHECK (id > 0);
ALTER TABLE ONLY public.missing ADD CONSTRAINT missing_ex EXCLUDE USING gist (id WITH =);

CREATE TABLE public.missing (id bigint);
