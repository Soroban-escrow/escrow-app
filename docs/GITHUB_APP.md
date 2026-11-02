# Registering the GitHub App (human step)
Permissions: Issues RW, Pull requests RW, Contents R, Metadata R, Members R.
Events: installation, installation_repositories, issue_comment, issues, pull_request.
Webhook URL: `https://<api-domain>/github/webhooks` with a secret (`GITHUB_WEBHOOK_SECRET`). For local work use a smee.io relay.
User authorization callback: `<API_PUBLIC_URL>/auth/callback`.
Then set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_CLIENT_ID/SECRET in `.env` (never commit).
