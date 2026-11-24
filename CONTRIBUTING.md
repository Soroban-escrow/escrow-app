# Contributing Guide

Thank you for contributing to the escrow app.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

3. Configure your `.env` file with the required values.

4. Run database migrations:
   ```bash
   cd apps/api
   pnpm prisma migrate dev
   ```

## Development

Start the development servers:

```bash
pnpm dev
```

## Testing

Run the test suite:

```bash
pnpm test
```

Run type checking:

```bash
pnpm typecheck
```

Run linting:

```bash
pnpm lint
```

Check formatting:

```bash
pnpm format-check
```

## Architecture Principles

### Chain is Truth, AI is Advisory

This application integrates blockchain state and AI-based review. Follow these rules strictly:

- **Chain is the source of truth**: All payout decisions, fund movements, and state transitions must be anchored in on-chain data.
- **AI is advisory only**: AI reviews and recommendations inform decisions but never directly trigger payouts or modify blockchain state.
- **Verification required**: AI outputs must be validated against chain state before any financial action.

Any changes to `payouts/`, `chain/`, or `auth/` directories require careful review due to their critical role in financial operations.

## Pull Requests

- Write clear commit messages describing what changed and why.
- Reference related issues using `#issue-number`.
- Ensure all tests pass before submitting.
- Keep PRs focused on a single concern when possible.

## Code Review

Changes to sensitive paths require approval from code owners:

- `apps/api/src/payouts/` - Payout processing logic
- `apps/api/src/chain/` - Blockchain integration
- `apps/api/src/auth/` - Authentication and authorization

See `.github/CODEOWNERS` for details.
