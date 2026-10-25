#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" == 0 ]] || { echo 'Run upgrade preparation with sudo.' >&2; exit 2; }
source "$(dirname "${BASH_SOURCE[0]}")/project-config.sh"
mode="${1:-}"
if [[ "$mode" == recipients ]]; then
    [[ ! -L secrets && ! -L backup-recipient.pending.pub ]] || exit 2
    install -d -m 0700 secrets
    recipient_file="${BACKUP_RECIPIENTS_FILE:-secrets/backup-recipients.txt}"
    [[ ! -L "$recipient_file" ]] || exit 2
    [[ -s backup-recipient.pending.pub ]] || { echo 'The Windows backup public key was not uploaded.' >&2; exit 2; }
    recipient="$(tr -d '\r\n' < backup-recipient.pending.pub)"
    [[ "$recipient" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || { echo 'Invalid backup public key.' >&2; exit 2; }
    touch "$recipient_file"
    if ! grep -Fxq -- "$recipient" "$recipient_file"; then printf '\n%s\n' "$recipient" >> "$recipient_file"; fi
    chmod 600 "$recipient_file"
    rm -- backup-recipient.pending.pub
    echo 'Encrypted backups configured with the off-server recovery public key.'
    exit 0
fi
[[ "$mode" == database && -n "${DB_SERVICE:-}" && -n "${DB_OPERATOR_USER:-}" ]] || { echo 'Unsupported upgrade preparation mode.' >&2; exit 2; }
snapshot="${2:-}"
[[ -f "$snapshot/COMPLETE" && -s "$snapshot/snapshot.tar.age" ]] || { echo 'A completed encrypted pre-upgrade backup is required before role migration.' >&2; exit 2; }
[[ ! -L secrets/db_operator_password.txt ]] || exit 2
flags_query="SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication)::text FROM pg_roles WHERE rolname='$DB_USER'"
flags="$(docker compose exec -T "$DB_SERVICE" psql -X -U "$DB_USER" -d "$DB_NAME" -Atc "$flags_query")"
[[ "$flags" == true || "$flags" == false ]] || { echo 'Cannot inspect application database privileges.' >&2; exit 2; }
exists="$(docker compose exec -T "$DB_SERVICE" psql -X -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT count(*) FROM pg_roles WHERE rolname='$DB_OPERATOR_USER'")"
if [[ "$exists" == 1 && ! -s secrets/db_operator_password.txt ]]; then
    echo 'An operator role already exists but its secret is missing. Refusing to reset an existing account.' >&2; exit 2
fi
if [[ ! -s secrets/db_operator_password.txt ]]; then
    (umask 077; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > secrets/db_operator_password.txt)
fi
chmod 444 secrets/db_operator_password.txt
operator_password="$(tr -d '\r\n' < secrets/db_operator_password.txt)"
[[ -n "$operator_password" ]] || exit 2
trap 'unset operator_password' EXIT
if [[ "$exists" == 0 ]]; then
    [[ "$flags" == true ]] || { echo 'The application role cannot create a missing operator. An administrator must prepare it.' >&2; exit 2; }
    # Generated passwords are hex. Never interpolate arbitrary strings into SQL.
    [[ "$operator_password" =~ ^[a-f0-9]{64}$ ]] || { echo 'Cannot provision a new operator with an unexpected secret format.' >&2; exit 2; }
    printf 'CREATE ROLE "%s" LOGIN SUPERUSER PASSWORD '\''%s'\'';\n' "$DB_OPERATOR_USER" "$operator_password" |
        docker compose exec -T -e 'PGOPTIONS=-c log_statement=none -c log_min_error_statement=panic' "$DB_SERVICE" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
fi
operator_query() {
    printf '%s\n' "$operator_password" | docker compose exec -T "$DB_SERVICE" sh -c '
        IFS= read -r PGPASSWORD
        export PGPASSWORD
        exec psql -X -h "$4" -v ON_ERROR_STOP=1 -U "$1" -d "$2" -Atc "$3"
    ' sh "$DB_OPERATOR_USER" "$DB_NAME" "$1" "$DB_SERVICE"
}
[[ "$(operator_query "SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user")" == true ]] || { echo 'Operator login or permissions were not verified. Application permissions are unchanged.' >&2; exit 2; }
[[ "$(operator_query "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()")" == "$DB_USER" ]] || {
    echo 'Database ownership differs from the supported upgrade layout. No privileges were removed.' >&2; exit 2;
}
if [[ "$flags" == true ]]; then
    role_oid="$(operator_query "SELECT oid FROM pg_roles WHERE rolname='$DB_USER'")"
    if [[ "$role_oid" == 10 ]]; then
        [[ "$(operator_query "SELECT count(*) FROM pg_database WHERE datdba=10 AND datname NOT IN ('$DB_NAME','postgres','template0','template1')")" == 0 ]] || {
            echo 'The bootstrap account owns other application databases. Manual migration is required.' >&2; exit 2;
        }
        [[ "$(operator_query "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proowner=10 AND n.nspname='public'")" == 0 ]] || {
            echo 'Custom public functions need a manual ownership review.' >&2; exit 2;
        }
        # PostgreSQL's bootstrap role cannot lose SUPERUSER. Retain its OID as a
        # non-login owner of cluster defaults, and replace only the app login.
        legacy_role=bsa_bootstrap_owner
        [[ "$(operator_query "SELECT count(*) FROM pg_roles WHERE rolname='$legacy_role'")" == 0 ]] || {
            echo 'The reserved bootstrap-owner role already exists. Manual inspection is required.' >&2; exit 2;
        }
        [[ -s secrets/db_password.txt && ! -L secrets/db_password.txt ]] || { echo 'Existing application password file is required.' >&2; exit 2; }
        password_base64="$(tr -d '\r\n' < secrets/db_password.txt | base64 | tr -d '\r\n')"
        operator_script() {
            {
                printf '%s\n' "$operator_password"
                cat
            } | docker compose exec -T "$DB_SERVICE" sh -c '
                IFS= read -r PGPASSWORD
                export PGPASSWORD
                export PGOPTIONS="-c log_statement=none -c log_min_error_statement=panic"
                exec psql -X -h "$3" -v ON_ERROR_STOP=1 -U "$1" -d "$2"
            ' sh "$DB_OPERATOR_USER" "$DB_NAME" "$DB_SERVICE"
        }
        docker compose stop "$APP_SERVICE"
        if operator_script <<SQL
BEGIN;
ALTER ROLE "$DB_USER" RENAME TO "$legacy_role";
ALTER ROLE "$legacy_role" NOLOGIN PASSWORD NULL;
DO \$migration\$ BEGIN
    EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', '$DB_USER', convert_from(decode('$password_base64','base64'),'UTF8'));
END \$migration\$;
ALTER DATABASE "$DB_NAME" OWNER TO "$DB_USER";
ALTER SCHEMA public OWNER TO "$DB_USER";
SELECT format('ALTER TABLE %I.%I OWNER TO %I', n.nspname,c.relname,'$DB_USER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname='$legacy_role') AND n.nspname='public' AND c.relkind IN ('r','p') \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', n.nspname,c.relname,'$DB_USER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname='$legacy_role') AND n.nspname='public' AND c.relkind='S' \gexec
SELECT format('ALTER VIEW %I.%I OWNER TO %I', n.nspname,c.relname,'$DB_USER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname='$legacy_role') AND n.nspname='public' AND c.relkind='v' \gexec
SELECT format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', n.nspname,c.relname,'$DB_USER') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relowner=(SELECT oid FROM pg_roles WHERE rolname='$legacy_role') AND n.nspname='public' AND c.relkind='m' \gexec
REVOKE ALL ON DATABASE "$DB_NAME" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$DB_NAME" TO "$DB_USER";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
COMMIT;
SQL
        then
            unset password_base64
            docker compose start "$APP_SERVICE"
        else
            unset password_base64
            docker compose start "$APP_SERVICE"
            echo 'Bootstrap migration failed and its database transaction was rolled back. Application restart was attempted.' >&2; exit 2
        fi
    else
        operator_query "ALTER ROLE \"$DB_USER\" NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
    fi
fi
[[ "$(operator_query "$flags_query")" == false ]] || { echo 'Application privilege verification failed.' >&2; exit 2; }
echo 'Database upgrade ready: operator login verified; application role has no cluster-admin privileges.'
