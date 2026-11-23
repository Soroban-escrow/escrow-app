# Browser end-to-end tests

The suite runs Chromium against the API and web servers with a seeded PostgreSQL database. Signed flows use `fake-wallet.ts`, a deterministic implementation of Freighter's page `postMessage` bridge. It can approve or decline access, return a selected network, sign messages, and return a signed transaction XDR; it never holds a real secret key or contacts Stellar.

To add a scenario, call `installFakeWallet(page, options)` before `page.goto()`, then stub the relevant `/api/...` responses with Playwright routes. Assert on the mutation request body and its `x-csrf-token` header so the test verifies what the page actually sends. Use `mockConfig(page)` when the page displays token metadata or the current fee. No fixed waits are needed; use Playwright's auto-waiting assertions.

Run with `pnpm --filter @skillescrow/e2e e2e`. The configured desktop and 360 px projects both execute the signed-flow scenarios.
