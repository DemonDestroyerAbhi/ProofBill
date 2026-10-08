# PayPal Server SDK Context Plugin (APIMatic) — TypeScript skills

Vendored from [paypaldev/server-sdk-context-plugin-preview](https://github.com/paypaldev/server-sdk-context-plugin-preview)
at `6aa057126f0d4709a42e15002aab832a94935d92` (MIT, © PayPal Server SDKs). Only the TypeScript skill set is kept; the files are unmodified.

Checked in so every Claude Code session on this repo — including cloud sessions — has the plugin's
skills without an install step. Locally you can install the full plugin instead:

```bash
npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview
```

Covers the APIMatic-generated `@paypal/paypal-server-sdk`: Orders, Payments, Vault, Subscriptions,
Transaction Search. It does **not** cover Invoicing v2 (ProofBill's invoicing stays on `packages/paypal` REST).
