# GitHub App: setup and operations

The staging app `skillescrow-staging` is registered and verified (authenticates, correct permissions and events, installed on a sandbox repo). To register another one, use these settings.

## Registration (github.com/settings/apps/new)
- **Homepage URL:** the web URL. **Callback URL:** `<API_PUBLIC_URL>/auth/callback` (must equal exactly what the API sends).
- **Webhook:** Active; URL `<public API>/github/webhooks` (locally a smee.io relay: `npx smee-client --url https://smee.io/<id> --target http://localhost:3001/github/webhooks`); a random secret = `GITHUB_WEBHOOK_SECRET`.
- **Repository permissions:** Issues R/W, Pull requests R/W, Contents R, Metadata R. **Organization:** Members R.
- **Events:** Issues, Issue comment, Pull request.
- **Visibility:** make the app **public** ("Any account"). While it is private, GitHub shows a 404 on the sign-in page to every account except the owner, so contributors cannot log in.

## Credentials (apps/api/.env, git-ignored)
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (the PEM, on one line with `\n`, in quotes), `GITHUB_WEBHOOK_SECRET`. All five GitHub values or none: the config refuses a partial set. Also `ADMIN_GITHUB_IDS` (comma-separated numeric ids that get admin rights on login).

## Operating it
- **Missed webhooks** (downtime, install before the API ran): `pnpm --filter @skillescrow/api sync:installations` re-reads installations and repositories from GitHub.
- **What the bot does:** answers `/bounty` (write access required), posts the bounty card once and edits it in place, sets the `bounty: <amount>` label, comments "Paid X to @login" on the PR when a release is indexed, and posts refund reminders 48 h before and when the window opens.
- **Review comments** (needs `ANTHROPIC_API_KEY`): one advisory comment per PR, edited on new pushes after a 5 minute quiet period; `/bounty review` on a PR forces a re-review.
- **Rotating secrets:** generate a new client secret/private key in the app settings, update `.env`, restart API and worker. Changing the webhook secret needs the same value in GitHub and `.env`.
