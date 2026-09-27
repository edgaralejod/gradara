#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Deploy the Gradara AI gateway to Google Cloud Run.
#
# Run from the repository root, signed in with `gcloud auth login`:
#
#   cloud/deploy.sh setup           One time: APIs, database, service account, secrets
#   cloud/deploy.sh secrets         Enter or replace the vendor and Stripe keys
#   cloud/deploy.sh stripe          Create the credit prices and payment webhook in Stripe
#   cloud/deploy.sh deploy          Build this checkout and deploy it
#   cloud/deploy.sh domain          Serve it at PUBLIC_URL (after gcloud domains verify)
#   cloud/deploy.sh status          Show the service URL and health
#
# Non-secret settings come from cloud/deploy.env. Secrets are typed at hidden
# prompts and go straight to Secret Manager; nothing secret is printed or saved
# on this machine.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
source cloud/deploy.env

PROJECT=$GCP_PROJECT
REGION=$GCP_REGION
SERVICE=gradara-gateway
INSTANCE=gradara-db
DATABASE=gradara
DB_USER=gateway
RUNTIME_SA="gradara-gateway@${PROJECT}.iam.gserviceaccount.com"
REPOSITORY="${REGION}-docker.pkg.dev/${PROJECT}/gradara"
GC=(gcloud --project "$PROJECT" --quiet)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
exists() { "$@" >/dev/null 2>&1; }

bind_role() { # member role: retried, because a new service account takes a moment to propagate
  local member=$1 role=$2 attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if "${GC[@]}" projects add-iam-policy-binding "$PROJECT" --member="$member" --role="$role" \
      --condition=None >/dev/null 2>&1; then
      return 0
    fi
    [[ $attempt == 1 ]] && echo "  waiting for the new account to be visible to IAM…"
    sleep 10
  done
  "${GC[@]}" projects add-iam-policy-binding "$PROJECT" --member="$member" --role="$role" --condition=None >/dev/null
}

secret_exists() { exists "${GC[@]}" secrets describe "$1"; }

store_secret() { # name value-on-stdin
  local name=$1
  if ! secret_exists "$name"; then
    "${GC[@]}" secrets create "$name" --replication-policy=automatic >/dev/null
  fi
  "${GC[@]}" secrets versions add "$name" --data-file=- >/dev/null
  echo "  stored $name"
}

verify_key() { # kind value: a free, read-only call to the provider; the key goes to curl on stdin
  local kind=$1 value=$2 url config body
  case $kind in
    anthropic)
      url="https://api.anthropic.com/v1/models?limit=1"
      config=$(printf 'header = "x-api-key: %s"\nheader = "anthropic-version: 2023-06-01"' "$value") ;;
    openai)
      url=https://api.openai.com/v1/models
      config=$(printf 'header = "Authorization: Bearer %s"' "$value") ;;
    stripe)
      url="${STRIPE_API:-https://api.stripe.com}/v1/balance"
      config=$(printf 'user = "%s:"' "$value") ;;
    *) return 0 ;;
  esac
  if body=$(curl -sS --fail-with-body -m 20 "$url" -K - <<<"$config" 2>&1); then
    if [[ $kind == stripe ]]; then
      if [[ $body == *'"livemode": true'* || $body == *'"livemode":true'* ]]; then
        echo "  key works (Stripe live mode: real payments)"
      else
        echo "  key works (Stripe test mode: no real charges)"
      fi
    else
      echo "  key works"
    fi
    return 0
  fi
  # Show the provider's reason without echoing anything that could contain the key.
  echo "  the provider rejected this key: $(printf '%s' "$body" | python3 -c 'import json,sys
t=sys.stdin.read()
try:
    d=json.loads(t[t.index("{"):]); e=d.get("error", d)
    print(e.get("message", "unknown error") if isinstance(e, dict) else e)
except Exception:
    print("no response (check the network)")')"
  return 1
}

prompt_secret() { # name "question" prefixes verifier
  local name=$1 question=$2 prefixes=$3 kind=${4:-} value='' ok
  while true; do
    read -r -s -p "  $question: " value
    echo
    if [[ -z $value ]]; then
      if secret_exists "$name"; then echo "  kept the existing $name"; return; fi
      echo "  a value is required"; continue
    fi
    ok=''
    for prefix in $prefixes; do [[ $value == "$prefix"* ]] && ok=1; done
    if [[ -n $prefixes && -z $ok ]]; then
      echo "  that does not look right (expected it to start with ${prefixes// / or }); try again"; continue
    fi
    if ! verify_key "$kind" "$value"; then
      echo "  not saved; paste the key again (or press Ctrl-C to stop)"; continue
    fi
    printf '%s' "$value" | store_secret "$name"
    value=''
    return
  done
}

cmd_secrets() {
  say "Secrets (typing is hidden; press Enter to keep an existing value)"
  case $LLM_PROVIDER in
    anthropic) prompt_secret llm-api-key "Anthropic API key" "sk-ant-" anthropic ;;
    openai) prompt_secret llm-api-key "OpenAI API key" "sk-" openai ;;
    *) echo "LLM_PROVIDER must be anthropic or openai"; exit 1 ;;
  esac
  prompt_secret stripe-secret-key "Stripe secret key (sk_live_… for real payments, sk_test_… for testing; a restricted rk_ key also works)" "sk_ rk_" stripe
}

stripe_api() { # method path [curl args...]; the key comes from Secret Manager and is never printed
  local method=$1 path=$2 key
  shift 2
  key=$("${GC[@]}" secrets versions access latest --secret stripe-secret-key)
  # The key goes to curl on stdin (-K -), so it never appears in the process list.
  curl -sS --fail-with-body -X "$method" "${STRIPE_API:-https://api.stripe.com}/v1/$path" -K - "$@" \
    <<<"user = \"$key:\""
  key=''
}

json_get() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

set_env_value() { # key value: update cloud/deploy.env in place
  python3 - "$1" "$2" <<'PY'
import re, sys, pathlib
key, value = sys.argv[1], sys.argv[2]
path = pathlib.Path('cloud/deploy.env')
text = path.read_text()
text = re.sub(rf'^{key}=.*$', f'{key}={value}', text, flags=re.M)
path.write_text(text)
PY
}

cmd_stripe() {
  say "Stripe products and prices"
  local mode prices starter pro product
  mode=$(stripe_api GET balance | json_get "'live mode: real payments' if d['livemode'] else 'test mode: no real charges'")
  prices=$(stripe_api GET 'prices?lookup_keys[]=gradara_credits_100&lookup_keys[]=gradara_credits_550&active=true')
  starter=$(printf '%s' "$prices" | json_get "next((p['id'] for p in d['data'] if p['lookup_key']=='gradara_credits_100'), '')")
  pro=$(printf '%s' "$prices" | json_get "next((p['id'] for p in d['data'] if p['lookup_key']=='gradara_credits_550'), '')")
  if [[ -z $starter || -z $pro ]]; then
    product=$(stripe_api POST products -d name="Gradara AI credits" \
      -d description="Prepaid credits for Gradara AI block, model, and export generation" \
      -d statement_descriptor="GRADARA AI" -d "metadata[gradara]=credits" | json_get "d['id']")
    [[ -n $starter ]] || starter=$(stripe_api POST prices -d product="$product" -d currency=usd -d unit_amount=1000 \
      -d lookup_key=gradara_credits_100 -d nickname="100 credits" | json_get "d['id']")
    [[ -n $pro ]] || pro=$(stripe_api POST prices -d product="$product" -d currency=usd -d unit_amount=5000 \
      -d lookup_key=gradara_credits_550 -d nickname="550 credits" | json_get "d['id']")
  fi
  set_env_value STRIPE_PRICE_STARTER "$starter"
  set_env_value STRIPE_PRICE_PRO "$pro"
  echo "  100 credits (USD 10): $starter"
  echo "  550 credits (USD 50): $pro"
  echo "  $mode"

  say "Stripe webhook"
  local url="$PUBLIC_URL/v1/billing/webhook" existing
  existing=$(stripe_api GET 'webhook_endpoints?limit=100' |
    json_get "' '.join(e['id'] for e in d['data'] if e['url']=='$url')")
  for id in $existing; do stripe_api DELETE "webhook_endpoints/$id" >/dev/null; done
  # The signing secret is only returned when the endpoint is created; it goes
  # straight into Secret Manager.
  stripe_api POST webhook_endpoints -d url="$url" \
    -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=checkout.session.async_payment_succeeded" \
    -d description="Gradara AI gateway" | json_get "d['secret']" | tr -d '\n' | store_secret stripe-webhook-secret
  echo "  $url"
}

ensure_log_exclusion() {
  say "Privacy: no platform request logs"
  # Cloud Run's own request logs include client IP and user agent. The gateway
  # writes its own privacy-safe log line, so exclude the platform's.
  local existing
  existing=$("${GC[@]}" logging sinks describe _Default --format='value(exclusions[].name)')
  if [[ $existing != *gradara-gateway-requests* ]]; then
    "${GC[@]}" logging sinks update _Default \
      --add-exclusion="name=gradara-gateway-requests,filter=resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND log_id(\"run.googleapis.com/requests\")" >/dev/null
  fi
  echo "  Cloud Run request logs for $SERVICE are excluded"
}

cmd_setup() {
  say "Enabling APIs (first run takes a minute)"
  "${GC[@]}" services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
    artifactregistry.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com \
    iam.googleapis.com >/dev/null

  say "Container repository"
  exists "${GC[@]}" artifacts repositories describe gradara --location "$REGION" ||
    "${GC[@]}" artifacts repositories create gradara --repository-format=docker --location "$REGION" >/dev/null
  echo "  $REPOSITORY"

  say "Build permissions"
  local number
  number=$("${GC[@]}" projects describe "$PROJECT" --format='value(projectNumber)')
  for role in roles/artifactregistry.writer roles/logging.logWriter roles/storage.objectViewer; do
    bind_role "serviceAccount:${number}-compute@developer.gserviceaccount.com" "$role"
  done
  echo "  Cloud Build can push images"

  say "Runtime service account"
  exists "${GC[@]}" iam service-accounts describe "$RUNTIME_SA" ||
    "${GC[@]}" iam service-accounts create gradara-gateway --display-name="Gradara AI gateway" >/dev/null
  for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
    bind_role "serviceAccount:$RUNTIME_SA" "$role"
  done
  echo "  $RUNTIME_SA"

  say "Database (Cloud SQL for PostgreSQL; creating the instance takes about 10 minutes)"
  if ! exists "${GC[@]}" sql instances describe "$INSTANCE"; then
    "${GC[@]}" sql instances create "$INSTANCE" --database-version=POSTGRES_17 --edition=enterprise \
      --tier=db-f1-micro --region="$REGION" --storage-type=SSD --storage-size=10GB \
      --storage-auto-increase --backup-start-time=08:00 --availability-type=zonal
  fi
  exists "${GC[@]}" sql databases describe "$DATABASE" --instance "$INSTANCE" ||
    "${GC[@]}" sql databases create "$DATABASE" --instance "$INSTANCE" >/dev/null
  if ! secret_exists gateway-database-url; then
    local password
    password=$(openssl rand -hex 24)
    if exists "${GC[@]}" sql users describe "$DB_USER" --instance "$INSTANCE"; then
      "${GC[@]}" sql users set-password "$DB_USER" --instance "$INSTANCE" --password="$password" >/dev/null
    else
      "${GC[@]}" sql users create "$DB_USER" --instance "$INSTANCE" --password="$password" >/dev/null
    fi
    printf 'postgresql+psycopg://%s:%s@/%s?host=/cloudsql/%s:%s:%s' \
      "$DB_USER" "$password" "$DATABASE" "$PROJECT" "$REGION" "$INSTANCE" | store_secret gateway-database-url
    password=''
  else
    echo "  database connection secret already exists"
  fi

  ensure_log_exclusion

  secret_exists gateway-admin-token || openssl rand -hex 32 | tr -d '\n' | store_secret gateway-admin-token

  cmd_secrets
  cmd_stripe
  say "Setup finished. Next: cloud/deploy.sh deploy"
}

env_file() { # writes the Cloud Run env-vars YAML to $1; $2 is the deployed revision
  local packs
  [[ -n $STRIPE_PRICE_STARTER && -n $STRIPE_PRICE_PRO ]] || {
    echo "Set STRIPE_PRICE_STARTER and STRIPE_PRICE_PRO in cloud/deploy.env first."; exit 1; }
  [[ -n $FIREBASE_WEB_API_KEY ]] || { echo "Set FIREBASE_WEB_API_KEY in cloud/deploy.env first."; exit 1; }
  packs=$(printf '[{"id":"starter","credits":100,"amount":1000,"currency":"usd","label":"100 credits","priceId":"%s"},{"id":"pro","credits":550,"amount":5000,"currency":"usd","label":"550 credits","priceId":"%s"}]' \
    "$STRIPE_PRICE_STARTER" "$STRIPE_PRICE_PRO")
  cat >"$1" <<EOF
GATEWAY_ENV: production
PUBLIC_URL: "$PUBLIC_URL"
AUTH_MODE: firebase
FIREBASE_PROJECT_ID: "$PROJECT"
FIREBASE_WEB_API_KEY: "$FIREBASE_WEB_API_KEY"
FIREBASE_AUTH_DOMAIN: "$FIREBASE_AUTH_DOMAIN"
LLM_PROVIDER: "$LLM_PROVIDER"
LLM_MODEL: "$LLM_MODEL"
STRIPE_AUTOMATIC_TAX: "$STRIPE_AUTOMATIC_TAX"
FREE_CREDITS: "$FREE_CREDITS"
SUPPORT_EMAIL: "$SUPPORT_EMAIL"
CREDIT_PACKS: '$packs'
GATEWAY_REVISION: "${2:-dev}"
EOF
}

cmd_deploy() {
  local version image envs key_var
  version=$(git rev-parse --short HEAD)
  [[ -z $(git status --porcelain -- cloud server/llm) ]] || version="${version}-dirty"
  image="${REPOSITORY}/gateway:${version}"
  envs=$(mktemp)
  trap 'rm -f "$envs"' RETURN
  env_file "$envs" "$version"
  key_var=$([[ $LLM_PROVIDER == openai ]] && echo OPENAI_API_KEY || echo ANTHROPIC_API_KEY)

  say "Building $image"
  "${GC[@]}" builds submit --config cloud/cloudbuild.yaml --ignore-file cloud/.gcloudignore \
    --substitutions "_IMAGE=$image" .

  ensure_log_exclusion
  say "Deploying $SERVICE"
  "${GC[@]}" run deploy "$SERVICE" --image "$image" --region "$REGION" \
    --service-account "$RUNTIME_SA" --allow-unauthenticated \
    --timeout 600 --concurrency 20 --min-instances 0 --max-instances 3 --memory 512Mi --cpu 1 \
    --add-cloudsql-instances "${PROJECT}:${REGION}:${INSTANCE}" \
    --env-vars-file "$envs" \
    --set-secrets "${key_var}=llm-api-key:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,ADMIN_TOKEN=gateway-admin-token:latest,DATABASE_URL=gateway-database-url:latest"

  local url
  url=$("${GC[@]}" run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
  say "Daily retention backstop"
  local token
  token=$("${GC[@]}" secrets versions access latest --secret gateway-admin-token)
  if exists "${GC[@]}" scheduler jobs describe gradara-purge --location "$REGION"; then
    "${GC[@]}" scheduler jobs update http gradara-purge --location "$REGION" --schedule "17 3 * * *" \
      --uri "$url/internal/purge" --http-method POST --update-headers "Authorization=Bearer $token" >/dev/null
  else
    "${GC[@]}" scheduler jobs create http gradara-purge --location "$REGION" --schedule "17 3 * * *" \
      --uri "$url/internal/purge" --http-method POST --headers "Authorization=Bearer $token" >/dev/null
  fi
  token=''
  cmd_status
}

cmd_domain() {
  local host=${PUBLIC_URL#https://} root
  root=${host#*.}
  say "Custom domain $host"
  if ! exists "${GC[@]}" beta run domain-mappings describe --domain "$host" --region "$REGION"; then
    if ! "${GC[@]}" beta run domain-mappings create --service "$SERVICE" --domain "$host" --region "$REGION"; then
      echo
      echo "  Google needs proof that you own $root first. Run:"
      echo "    gcloud domains verify $root"
      echo "  It opens Search Console; add the TXT record it shows at your DNS provider, click Verify,"
      echo "  then run: cloud/deploy.sh domain"
      exit 1
    fi
  fi
  echo "  Add this DNS record at your DNS provider (certificate issuance follows, up to an hour):"
  "${GC[@]}" beta run domain-mappings describe --domain "$host" --region "$REGION" \
    --format='table(status.resourceRecords[].type,status.resourceRecords[].name,status.resourceRecords[].rrdata)'
}

cmd_status() {
  local url
  url=$("${GC[@]}" run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
  say "Service: $url"
  local health revision
  health=$(curl -fsS "$url/health") && echo "$health"
  revision=$(sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' <<<"$health")
  revision=${revision%-dirty}
  if [[ -z $revision || $revision == dev ]]; then
    echo "  The deployed gateway does not report its revision; run: cloud/deploy.sh deploy"
  elif ! git cat-file -e "$revision^{commit}" 2>/dev/null; then
    echo "  Deployed revision $revision is not in this checkout (git fetch, then check again)."
  elif ! git diff --quiet "$revision" HEAD -- cloud/gateway cloud/Dockerfile server/llm; then
    echo "  The gateway code changed since the deployed revision $revision; run: cloud/deploy.sh deploy"
  else
    echo "  Deployed revision $revision matches this checkout's gateway code"
  fi
  curl -fsS "$url/v1/pricing" && echo
  if curl -fsS -m 10 "$PUBLIC_URL/health" >/dev/null 2>&1; then
    echo "  $PUBLIC_URL is live"
  else
    echo "  $PUBLIC_URL is not answering yet (domain mapping or certificate pending)"
  fi
}

case ${1:-} in
  setup) cmd_setup ;;
  secrets) cmd_secrets; cmd_stripe ;;
  stripe) cmd_stripe ;;
  deploy) cmd_deploy ;;
  domain) cmd_domain ;;
  status) cmd_status ;;
  *) sed -n '3,17p' "$0"; exit 1 ;;
esac
