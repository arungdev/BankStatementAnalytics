#!/bin/sh
# Execute inside the disposable app container after the two-user integration fixture.
set -eu
root=http://127.0.0.1:8080
scratch=$(mktemp -d)
trap 'rm -f "$scratch"/*; rmdir "$scratch"' EXIT
for index in 0 1; do
  cookie="$scratch/cookie-$index"
  status=$(curl -sS -o "$scratch/login" -w '%{http_code}' -c "$cookie" -H 'Content-Type: application/json' \
    -d "{\"username\":\"synthetic-financial-$index\",\"password\":\"Synthetic-password-only-42\"}" "$root/api/auth/login")
  test "$status" = 200
  curl -fsS -b "$cookie" "$root/api/accounts" > "$scratch/accounts"
  test "$(grep -o '"id":' "$scratch/accounts" | wc -l)" -eq 1
  grep -q "\"id\":$((index + 1))," "$scratch/accounts"
  status=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" "$root/api/accounts/$((2 - index))/supported-formats")
  test "$status" = 404
  curl -fsS -b "$cookie" -X POST "$root/api/workspace/database-backup" > "$scratch/snapshot-$index"
  test -s "$scratch/snapshot-$index"
  status=$(curl -sS -o "$scratch/restore" -w '%{http_code}' -b "$cookie" \
    -F "file=@$scratch/snapshot-0" "$root/api/workspace/database-backup/restore")
  if test "$index" = 0; then test "$status" = 200; else test "$status" = 400; fi
done
echo 'PASS: Linux container: two synthetic logins, isolated financial APIs, own backup/restore and cross-user restore denial.'
