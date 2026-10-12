#!/usr/bin/env bash
# LEONX OS — Veritabanı testleri (yerel PostgreSQL)
#
# Geçici bir PostgreSQL kümesi başlatır, Supabase taklit iskeletini ve
# tüm migration'ları İKİ KEZ uygular (tekrar çalıştırılabilirlik testi),
# ardından RLS ve bütünlük testlerini çalıştırır. Gerçek Supabase
# projesine bağlanmaz.
#
# Gereksinim: PostgreSQL 15+ sunucu araçları (initdb, pg_ctl, psql).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "${PG_BIN}" || ! -x "${PG_BIN}/initdb" ]]; then
  if command -v initdb >/dev/null; then PG_BIN="$(dirname "$(command -v initdb)")"; else
    echo "PostgreSQL sunucu araçları bulunamadı (initdb). PG_BIN ile yol belirtin." >&2; exit 2
  fi
fi

PORT="${PGTEST_PORT:-54329}"
WORK="$(mktemp -d)"
RUN=()
if [[ "$(id -u)" == "0" ]]; then
  # PostgreSQL root olarak çalışmaz; varsa postgres kullanıcısıyla çalıştır
  chown postgres "${WORK}"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "${PG_BIN}/pg_ctl" -D "${WORK}/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

"${RUN[@]}" "${PG_BIN}/initdb" -D "${WORK}/data" -U postgres -A trust --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "${PG_BIN}/pg_ctl" -D "${WORK}/data" -o "-p ${PORT} -k ${WORK} -c listen_addresses=''" -l "${WORK}/pg.log" -w start >/dev/null

PSQL=("${RUN[@]}" env PGOPTIONS="-c client_min_messages=warning" "${PG_BIN}/psql" -h "${WORK}" -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)

echo "▸ Supabase taklit iskeleti"
"${PSQL[@]}" -f "${ROOT}/supabase/tests/local/supabase_stub.sql" 2>&1 | grep -v -e "wal_level" -e "Set wal_level" || true

for pass in 1 2; do
  echo "▸ Migration'lar (geçiş ${pass}/2)"
  for f in "${ROOT}"/supabase/migrations/*.sql; do
    echo "   - $(basename "$f")"
    "${PSQL[@]}" -f "$f"
  done
done

echo "▸ Örnek sahip hesabı (yalnızca yerel test)"
"${PSQL[@]}" -c "insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'sahip@yerel.test') on conflict do nothing;
insert into public.app_owner (singleton, user_id) values (true, '11111111-1111-4111-8111-111111111111') on conflict (singleton) do nothing;
insert into public.companies (name) values ('Mevcut veri — silinmemeli');"

TEST_PSQL=("${RUN[@]}" "${PG_BIN}/psql" -h "${WORK}" -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
ALL_OUT=""
for t in "${ROOT}"/supabase/tests/*.test.sql; do
  echo "▸ $(basename "$t")"
  set +e
  OUT="$("${TEST_PSQL[@]}" -f "$t" 2>&1)"
  STATUS=$?
  set -e
  echo "${OUT}" | sed -n -e 's/^.*NOTICE:  /   /p' -e 's/^.*ERROR:  /   ✗ /p'
  if [[ ${STATUS} -ne 0 ]] || ! grep -q "TESTLER[İI]* BAŞARILI" <<<"${OUT}"; then
    echo "✗ Veritabanı testleri BAŞARISIZ ($(basename "$t"))" >&2
    exit 1
  fi
  ALL_OUT+="${OUT}"$'\n'
done
OUT="${ALL_OUT}"
REMAINING="$("${PSQL[@]}" -tA -c "select count(*) from public.companies where name = 'Mevcut veri — silinmemeli'")"
OWNER_KEPT="$("${PSQL[@]}" -tA -c "select count(*) from public.app_owner where user_id = '11111111-1111-4111-8111-111111111111'")"
if [[ "${REMAINING}" != "1" || "${OWNER_KEPT}" != "1" ]]; then
  echo "✗ Test sonrası mevcut veri veya sahip kaydı değişti" >&2
  exit 1
fi
echo "   ✓ mevcut veri ve sahip kaydı testten sonra aynen duruyor"
PASSES="$(grep -c "PASS" <<<"${OUT}")"
echo "✓ Veritabanı testleri başarılı (${PASSES} kontrol)"
