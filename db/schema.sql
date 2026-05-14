--
-- PostgreSQL database dump
--

-- Dumped from database version 14.18
-- Dumped by pg_dump version 14.18

-- Started on 2026-05-13 21:38:17 MSK

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 3 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA IF NOT EXISTS public;


ALTER SCHEMA public OWNER TO postgres;

--
-- TOC entry 3671 (class 0 OID 0)
-- Dependencies: 3
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 212 (class 1259 OID 16786)
-- Name: events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.events (
    event_id character varying(50) NOT NULL,
    session_id character varying(50) NOT NULL,
    event_name character varying(50) NOT NULL,
    "timestamp" timestamp without time zone NOT NULL,
    event_data jsonb NOT NULL
);


ALTER TABLE public.events OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16809)
-- Name: experiment_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.experiment_results (
    result_id integer NOT NULL,
    experiment_id integer NOT NULL,
    metric_id integer NOT NULL,
    ab_group character(1) NOT NULL,
    metric_value numeric(10,4) NOT NULL,
    calculated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.experiment_results OWNER TO postgres;

--
-- TOC entry 215 (class 1259 OID 16808)
-- Name: experiment_results_result_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.experiment_results_result_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.experiment_results_result_id_seq OWNER TO postgres;

--
-- TOC entry 3672 (class 0 OID 0)
-- Dependencies: 215
-- Name: experiment_results_result_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.experiment_results_result_id_seq OWNED BY public.experiment_results.result_id;


--
-- TOC entry 210 (class 1259 OID 16749)
-- Name: experiments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.experiments (
    experiment_id integer NOT NULL,
    name character varying(150) NOT NULL,
    hypothesis text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    status character varying(20) DEFAULT 'draft'::character varying,
    variant_a_path text,
    variant_b_path text,
    public_link text,
    project_id bigint,
    CONSTRAINT experiments_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'running'::character varying, 'paused'::character varying, 'completed'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.experiments OWNER TO postgres;

--
-- TOC entry 209 (class 1259 OID 16748)
-- Name: experiments_experiment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.experiments_experiment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.experiments_experiment_id_seq OWNER TO postgres;

--
-- TOC entry 3673 (class 0 OID 0)
-- Dependencies: 209
-- Name: experiments_experiment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.experiments_experiment_id_seq OWNED BY public.experiments.experiment_id;


--
-- TOC entry 214 (class 1259 OID 16800)
-- Name: metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.metrics (
    metric_id integer NOT NULL,
    metric_name character varying(50) NOT NULL,
    unit character varying(20),
    description text
);


ALTER TABLE public.metrics OWNER TO postgres;

--
-- TOC entry 213 (class 1259 OID 16799)
-- Name: metrics_metric_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.metrics_metric_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.metrics_metric_id_seq OWNER TO postgres;

--
-- TOC entry 3674 (class 0 OID 0)
-- Dependencies: 213
-- Name: metrics_metric_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.metrics_metric_id_seq OWNED BY public.metrics.metric_id;


--
-- TOC entry 222 (class 1259 OID 16911)
-- Name: project_members; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.project_members (
    project_id bigint NOT NULL,
    user_id bigint NOT NULL,
    role character varying(20) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_members_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'member'::character varying])::text[])))
);


ALTER TABLE public.project_members OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16893)
-- Name: projects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.projects (
    project_id bigint NOT NULL,
    name character varying(160) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    owner_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.projects OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16892)
-- Name: projects_project_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.projects_project_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.projects_project_id_seq OWNER TO postgres;

--
-- TOC entry 3675 (class 0 OID 0)
-- Dependencies: 220
-- Name: projects_project_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.projects_project_id_seq OWNED BY public.projects.project_id;


--
-- TOC entry 211 (class 1259 OID 16767)
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    session_id character varying(50) NOT NULL,
    experiment_id integer NOT NULL,
    user_id character varying(50) NOT NULL,
    ab_group character(1) NOT NULL,
    start_time timestamp without time zone NOT NULL,
    end_time timestamp without time zone,
    duration_ms integer,
    max_scroll_depth integer,
    device_category character varying(10),
    CONSTRAINT sessions_ab_group_check CHECK ((ab_group = ANY (ARRAY['A'::bpchar, 'B'::bpchar]))),
    CONSTRAINT sessions_device_category_check CHECK (((device_category)::text = ANY ((ARRAY['desktop'::character varying, 'mobile'::character varying, 'tablet'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT sessions_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT sessions_max_scroll_depth_check CHECK (((max_scroll_depth >= 0) AND (max_scroll_depth <= 100)))
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- TOC entry 217 (class 1259 OID 16824)
-- Name: statistical_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.statistical_results (
    experiment_id integer NOT NULL,
    metric_id integer NOT NULL,
    p_value double precision NOT NULL,
    calculated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ci_lower double precision,
    ci_upper double precision,
    ci_level double precision DEFAULT 0.95,
    power double precision,
    required_n integer
);


ALTER TABLE public.statistical_results OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16879)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username character varying(50) NOT NULL,
    first_name character varying(80) NOT NULL,
    last_name character varying(80) NOT NULL,
    email character varying(255),
    password_hash text NOT NULL,
    recovery_code_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_username_len CHECK ((char_length((username)::text) >= 3))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16878)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO postgres;

--
-- TOC entry 3676 (class 0 OID 0)
-- Dependencies: 218
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- TOC entry 3475 (class 2604 OID 16812)
-- Name: experiment_results result_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiment_results ALTER COLUMN result_id SET DEFAULT nextval('public.experiment_results_result_id_seq'::regclass);


--
-- TOC entry 3466 (class 2604 OID 16752)
-- Name: experiments experiment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiments ALTER COLUMN experiment_id SET DEFAULT nextval('public.experiments_experiment_id_seq'::regclass);


--
-- TOC entry 3474 (class 2604 OID 16803)
-- Name: metrics metric_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics ALTER COLUMN metric_id SET DEFAULT nextval('public.metrics_metric_id_seq'::regclass);


--
-- TOC entry 3483 (class 2604 OID 16896)
-- Name: projects project_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects ALTER COLUMN project_id SET DEFAULT nextval('public.projects_project_id_seq'::regclass);


--
-- TOC entry 3479 (class 2604 OID 16882)
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- TOC entry 3498 (class 2606 OID 16792)
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (event_id);


--
-- TOC entry 3504 (class 2606 OID 16815)
-- Name: experiment_results experiment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiment_results
    ADD CONSTRAINT experiment_results_pkey PRIMARY KEY (result_id);


--
-- TOC entry 3492 (class 2606 OID 16759)
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (experiment_id);


--
-- TOC entry 3500 (class 2606 OID 16807)
-- Name: metrics metrics_metric_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_metric_name_key UNIQUE (metric_name);


--
-- TOC entry 3502 (class 2606 OID 16805)
-- Name: metrics metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics
    ADD CONSTRAINT metrics_pkey PRIMARY KEY (metric_id);


--
-- TOC entry 3515 (class 2606 OID 16918)
-- Name: project_members project_members_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pk PRIMARY KEY (project_id, user_id);


--
-- TOC entry 3513 (class 2606 OID 16904)
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (project_id);


--
-- TOC entry 3496 (class 2606 OID 16775)
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (session_id);


--
-- TOC entry 3506 (class 2606 OID 16829)
-- Name: statistical_results statistical_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.statistical_results
    ADD CONSTRAINT statistical_results_pkey PRIMARY KEY (experiment_id, metric_id);


--
-- TOC entry 3509 (class 2606 OID 16889)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3493 (class 1259 OID 16935)
-- Name: experiments_project_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX experiments_project_id_idx ON public.experiments USING btree (project_id);


--
-- TOC entry 3494 (class 1259 OID 16936)
-- Name: experiments_project_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX experiments_project_status_idx ON public.experiments USING btree (project_id, status);


--
-- TOC entry 3516 (class 1259 OID 16929)
-- Name: project_members_user_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX project_members_user_id_idx ON public.project_members USING btree (user_id);


--
-- TOC entry 3511 (class 1259 OID 16910)
-- Name: projects_owner_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX projects_owner_id_idx ON public.projects USING btree (owner_id);


--
-- TOC entry 3507 (class 1259 OID 16891)
-- Name: users_email_unique_ci; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_email_unique_ci ON public.users USING btree (lower((email)::text)) WHERE (email IS NOT NULL);


--
-- TOC entry 3510 (class 1259 OID 16890)
-- Name: users_username_unique_ci; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_username_unique_ci ON public.users USING btree (lower((username)::text));


--
-- TOC entry 3519 (class 2606 OID 16793)
-- Name: events events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(session_id) ON DELETE CASCADE;


--
-- TOC entry 3517 (class 2606 OID 16930)
-- Name: experiments experiments_project_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_project_fk FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON DELETE RESTRICT;


--
-- TOC entry 3520 (class 2606 OID 16843)
-- Name: experiment_results fk_expr_experiment; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiment_results
    ADD CONSTRAINT fk_expr_experiment FOREIGN KEY (experiment_id) REFERENCES public.experiments(experiment_id) ON DELETE CASCADE;


--
-- TOC entry 3521 (class 2606 OID 16848)
-- Name: experiment_results fk_expr_metric; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.experiment_results
    ADD CONSTRAINT fk_expr_metric FOREIGN KEY (metric_id) REFERENCES public.metrics(metric_id) ON DELETE RESTRICT;


--
-- TOC entry 3525 (class 2606 OID 16919)
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(project_id) ON DELETE CASCADE;


--
-- TOC entry 3526 (class 2606 OID 16924)
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 3524 (class 2606 OID 16905)
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- TOC entry 3518 (class 2606 OID 16776)
-- Name: sessions sessions_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(experiment_id) ON DELETE CASCADE;


--
-- TOC entry 3522 (class 2606 OID 16830)
-- Name: statistical_results statistical_results_experiment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.statistical_results
    ADD CONSTRAINT statistical_results_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(experiment_id);


--
-- TOC entry 3523 (class 2606 OID 16835)
-- Name: statistical_results statistical_results_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.statistical_results
    ADD CONSTRAINT statistical_results_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.metrics(metric_id);


-- Completed on 2026-05-13 21:38:18 MSK

--
-- PostgreSQL database dump complete
--

