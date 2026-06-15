CREATE TYPE public.order_status AS ENUM ('pending', 'shipped');
CREATE DOMAIN public.email_domain AS varchar CHECK (VALUE ~ '@');

CREATE TABLE public.companies (
  id bigint NOT NULL,
  name character varying NOT NULL,
  CONSTRAINT companies_pkey PRIMARY KEY (id),
  CONSTRAINT companies_name_unique UNIQUE (name),
  CONSTRAINT companies_name_check CHECK (length(name) > 0),
  CONSTRAINT companies_name_ex EXCLUDE USING btree (name WITH =)
);

CREATE TABLE public.users (
  id bigint NOT NULL,
  email public.email_domain NOT NULL,
  company_id bigint,
  status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
  published_at timestamp with time zone,
  created_at timestamp without time zone,
  PRIMARY KEY (id),
  UNIQUE (email),
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email) WHERE (email IS NOT NULL);

CREATE TABLE public.apis (id bigint NOT NULL);
CREATE TABLE public.channels (id bigint NOT NULL);
CREATE TABLE public.apis_channels (
  api_id bigint NOT NULL,
  channel_id bigint NOT NULL,
  role character varying
);

ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_api_id_fkey FOREIGN KEY (api_id) REFERENCES public.apis(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.apis_channels
  ADD CONSTRAINT apis_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);

CREATE VIEW public.active_users AS SELECT id, email FROM public.users;
CREATE MATERIALIZED VIEW public.company_counts AS SELECT company_id, count(*) FROM public.users GROUP BY company_id;

ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_unique UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_nickname_check CHECK ((email <> 'O''Reilly'));
ALTER TABLE ONLY public.companies ADD CONSTRAINT companies_slug_ex EXCLUDE USING gist (name WITH =);

CREATE TABLE public.categories (
  id bigint NOT NULL,
  story_id bigint
);
CREATE TABLE public.stories (
  id bigint NOT NULL
);
CREATE TABLE public.people (
  id bigint NOT NULL,
  category_id bigint
);
CREATE TABLE public.boxes (
  id bigint NOT NULL,
  weird timestamp without time zone,
  badtype!!! with time zone
);
