#!/usr/bin/env bash
# ProofBill — Week 0: validate PayPal Invoicing v2 end-to-end in sandbox.
# Usage: cp .env.example .env  # fill PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYER_EMAIL
#        chmod +x week0-paypal-check.sh && ./week0-paypal-check.sh
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
: "${PAYPAL_CLIENT_ID:?set in .env}" "${PAYPAL_CLIENT_SECRET:?set in .env}" "${PAYER_EMAIL:?sandbox PERSONAL account email}"
command -v jq >/dev/null || { echo "Install jq first"; exit 1; }

BASE="https://api-m.sandbox.paypal.com"
OUT=/tmp/pp_body
ok(){   printf '\033[32m✔ %s\033[0m\n' "$1"; }
warn(){ printf '\033[33m⚠ %s\033[0m\n' "$1"; }
die(){  printf '\033[31m✘ %s\033[0m\n' "$1"; cat "$OUT" 2>/dev/null; echo; exit 1; }
api(){ local m=$1 p=$2; shift 2
  curl -s -o "$OUT" -w '%{http_code}' -X "$m" "$BASE$p" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

echo "── 1. OAuth token"
TOKEN=$(curl -s -u "$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET" -d grant_type=client_credentials \
  "$BASE/v1/oauth2/token" | jq -r '.access_token // empty')
[ -n "$TOKEN" ] && ok "token" || die "token — check client id/secret and that the app is a SANDBOX app"

echo "── 2. Create draft invoice (partial payments on, Net-15)"
INV_NO="PB-W0-$(date +%Y%m%d%H%M%S)"
REQ_ID="pb-w0-$(date +%s)"
INVOICE=$(jq -n --arg no "$INV_NO" --arg payer "$PAYER_EMAIL" '{
  detail: { invoice_number: $no, currency_code: "USD",
            note: "Milestone 1 — Authentication module. Evidence: PR #12, PR #15.",
            payment_term: { term_type: "NET_15" } },
  primary_recipients: [ { billing_info: { email_address: $payer } } ],
  items: [ { name: "Milestone 1: Authentication module",
             description: "Login, signup, password reset. Evidence: PR #12, PR #15",
             quantity: "1", unit_of_measure: "AMOUNT",
             unit_amount: { currency_code: "USD", value: "400.00" } } ],
  configuration: { allow_tip: false,
                   partial_payment: { allow_partial_payment: true,
                                      minimum_amount_due: { currency_code: "USD", value: "100.00" } } }
}')
CODE=$(api POST /v2/invoicing/invoices -H "Prefer: return=representation" -H "PayPal-Request-Id: $REQ_ID" -d "$INVOICE")
[[ $CODE == 200 || $CODE == 201 ]] || die "create invoice (HTTP $CODE)"
ID=$(jq -r .id "$OUT"); ok "draft $ID ($INV_NO)"

echo "── 3. Idempotent replay (same PayPal-Request-Id)"
CODE=$(api POST /v2/invoicing/invoices -H "Prefer: return=representation" -H "PayPal-Request-Id: $REQ_ID" -d "$INVOICE")
ID2=$(jq -r '.id // empty' "$OUT")
if [ "$ID2" = "$ID" ]; then ok "replay returned same invoice"
else warn "replay → HTTP $CODE $(jq -c '.details // .name // empty' "$OUT") — rely on unique invoice_number + DB lock"; fi

echo "── 4. Negative test (PayPal-Mock-Response: DUPLICATE_INVOICE_ID)"
CODE=$(api POST /v2/invoicing/invoices -H 'PayPal-Mock-Response: {"mock_application_codes":"DUPLICATE_INVOICE_ID"}' -d "$INVOICE")
[ "$CODE" = 422 ] && ok "mock error returned 422 $(jq -r '.details[0].issue // empty' "$OUT")" \
                  || warn "expected 422, got $CODE — check Negative Testing toggle on the sandbox account"

echo "── 5. Send invoice"
CODE=$(api POST "/v2/invoicing/invoices/$ID/send" -d '{"send_to_invoicer": true}')
[[ $CODE == 200 || $CODE == 202 ]] || die "send (HTTP $CODE)"
LINK=$(jq -r '.href // (.links[]? | select(.rel=="payer-view") | .href) // empty' "$OUT")
if [ -z "$LINK" ]; then api GET "/v2/invoicing/invoices/$ID" >/dev/null
  LINK=$(jq -r '.detail.metadata.recipient_view_url // empty' "$OUT"); fi
ok "sent"; echo "   Payer link: ${LINK:-<not returned — open invoice in sandbox business dashboard>}"

echo "── 6. PARTIAL payment (manual)"
echo "   Open the link in a PRIVATE window, log in as $PAYER_EMAIL, pay \$150 (partial)."
read -rp "   Press Enter after paying… "
api GET "/v2/invoicing/invoices/$ID" >/dev/null
echo "   status=$(jq -r .status "$OUT") paid=$(jq -r '.payments.paid_amount.value // 0' "$OUT") due=$(jq -r '.due_amount.value // "?"' "$OUT")"
[ "$(jq -r .status "$OUT")" = PARTIALLY_PAID ] && ok "partial payment" || warn "expected PARTIALLY_PAID"

echo "── 7. Remind"
CODE=$(api POST "/v2/invoicing/invoices/$ID/remind" \
  -d '{"subject":"Reminder: Milestone 1 balance","note":"Hi — the remaining balance for Milestone 1 is due. Evidence links are on the invoice.","send_to_invoicer":false}')
[[ $CODE == 200 || $CODE == 204 ]] && ok "reminder sent" || warn "remind HTTP $CODE $(cat "$OUT")"

echo "── 8. Pay the balance (manual)"
read -rp "   Pay the remaining balance with the same link, then press Enter… "
api GET "/v2/invoicing/invoices/$ID" >/dev/null
[ "$(jq -r .status "$OUT")" = PAID ] && ok "PAID" || warn "status=$(jq -r .status "$OUT")"

echo
echo "Now check: Dashboard → Apps & Credentials → your app → Webhooks → events for $ID"
echo "Expect INVOICING.INVOICE.UPDATED (partial) and INVOICING.INVOICE.PAID."
