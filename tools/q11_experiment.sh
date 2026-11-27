#!/usr/bin/env sh
# Q11: self-healing and state on the kind cluster. Run from the repo root with the Compose stack up (source of the data)
# and the kind cluster "webgis" running with `kubectl apply -f k8s/` already done.
#   sh tools/q11_experiment.sh | tee docs/evidence/q11_timeline.txt
set -u
K="kubectl --context kind-webgis -n webgis"
set -a; . ./.env; set +a
TABLES="-t public.study_area -t public.services -t public.buildings -t public.hex_r8 -t public.hex_r9"
ts() { date +%H:%M:%S.%3N; }
now() { date +%s.%N; }

rows() {
  out=$($K exec postgis-0 -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "SELECT count(*) FROM services" 2>&1)
  echo "$out" | grep -m1 -E "^[0-9]+$|ERROR" | cut -c1-120
}

uid() { $K get pod postgis-0 -o jsonpath='{.metadata.uid}' 2>/dev/null; }

# one line per poll (time, uid prefix, phase/ready). With an argument: the old pod's uid, which must be GONE/replaced
wait_ready() {
  old="${1:-}"
  while :; do
    u=$(uid)
    st=$($K get pod postgis-0 -o jsonpath='{.status.phase}/{.status.containerStatuses[0].ready}' 2>/dev/null || echo "NotFound")
    [ -z "$u" ] && st="NotFound"
    echo "$(ts)  postgis-0  uid=$(echo "$u" | cut -c1-8)  $st"
    if [ "$st" = "Running/true" ] && [ "$u" != "$old" ]; then break; fi
    sleep 0.5
  done
}

wait_gone() { $K wait --for=delete pod/postgis-0 --timeout=180s >/dev/null 2>&1; }

load_data() {
  $K exec postgis-0 -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges $TABLES \
    | $K exec -i postgis-0 -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q >/dev/null 2>&1
}

delete_and_time() {
  old=$(uid)
  echo "old pod uid: $old"
  echo "$(ts)  \$ kubectl delete pod postgis-0"
  t0=$(now)
  $K delete pod postgis-0 --wait=false >/dev/null
  wait_ready "$old"
  t1=$(now)
  echo "pod recreated and Ready after $(echo "$t1 $t0" | awk '{printf "%.1f", $1-$2}') s"
}

echo "=================== reset to a clean PVC-backed StatefulSet"
$K delete statefulset postgis >/dev/null 2>&1; wait_gone
$K delete pvc data-postgis-0 >/dev/null 2>&1
$K apply -f k8s/02-postgis.yaml >/dev/null
sleep 2
wait_ready >/dev/null

echo "=================== RUN 1: StatefulSet with PersistentVolumeClaim (k8s/02-postgis.yaml)"
$K get pods,pvc
load_data
echo "rows in services BEFORE delete: $(rows)"
$K get pod postgis-0 -o jsonpath='pod uid before: {.metadata.uid}{"\n"}'
delete_and_time
$K get pod postgis-0 -o jsonpath='pod uid after:  {.metadata.uid}{"\n"}'
echo "rows in services AFTER  delete: $(rows)"
$K get pods,pvc

echo
echo "=================== RUN 2: same StatefulSet but the PVC replaced by emptyDir (k8s/experiments/postgis-emptydir.yaml)"
$K delete statefulset postgis >/dev/null; wait_gone
$K apply -f k8s/experiments/postgis-emptydir.yaml >/dev/null
sleep 2
wait_ready >/dev/null
load_data
echo "rows in services BEFORE delete: $(rows)"
delete_and_time
echo "rows in services AFTER  delete: $(rows)"

echo
echo "=================== restore the real manifest (the old PVC still holds the data from RUN 1)"
$K delete statefulset postgis >/dev/null; wait_gone
$K apply -f k8s/02-postgis.yaml >/dev/null
sleep 2
wait_ready >/dev/null
echo "rows in services after restoring the PVC-backed StatefulSet: $(rows)"
$K get pods,pvc
