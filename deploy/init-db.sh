#!/usr/bin/env bash
set -euo pipefail
# Public application role owns only its database/schema, not the database cluster.
# psql reads the password file itself; the password never appears in argv.
PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic' psql --username "$POSTGRES_USER" --dbname postgres -v ON_ERROR_STOP=1 <<'SQL'
\set application_password `tr -d '\r\n' < /run/secrets/db_password`
CREATE ROLE bankstatements LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'application_password';
ALTER DATABASE bankstatements OWNER TO bankstatements;
REVOKE ALL ON DATABASE bankstatements FROM PUBLIC;
GRANT CONNECT ON DATABASE bankstatements TO bankstatements;
\connect bankstatements
ALTER SCHEMA public OWNER TO bankstatements;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO bankstatements;
SQL
