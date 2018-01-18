--
-- PostgreSQL database dump
--

-- Dumped from database version 10.1
-- Dumped by pg_dump version 10.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: plpgsql; Type: EXTENSION; Schema: -;
--

CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION plpgsql; Type: COMMENT; Schema: -;
--

COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';


SET search_path = public, pg_catalog;

SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: boards; Type: TABLE; Schema: public;
--

CREATE TABLE boards (
    id text NOT NULL,
    name text,
    emoji text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

--
-- Name: diffs; Type: TABLE; Schema: public;
--

CREATE TABLE diffs (
    id integer NOT NULL,
    cards character varying(255),
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public;
--

CREATE TABLE users (
    name text NOT NULL,
    trello text,
    slack text,
    phab text,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

--
-- Name: boards boards_pkey; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);


--
-- Name: diffs diffs_pkey; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY diffs
    ADD CONSTRAINT diffs_pkey PRIMARY KEY (id);


--
-- Name: users users_phab_key; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_phab_key UNIQUE (phab);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (name);


--
-- Name: users users_slack_key; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_slack_key UNIQUE (slack);


--
-- Name: users users_trello_key; Type: CONSTRAINT; Schema: public;
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_trello_key UNIQUE (trello);


--
-- PostgreSQL database dump complete
--

