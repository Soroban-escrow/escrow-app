import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_DB } from '../playwright.config.js';
import { FAKE_ADDRESS, installFakeWallet, mockConfig, TEST_PASSPHRASE } from '../fake-wallet.js';

const sessions = () => JSON.parse(readFileSync(new URL('../.sessions.json', import.meta.url), 'utf8')) as { user: string; admin: string };
const signIn = (page: Page, who: 'user' | 'admin') =>
  page.context().addCookies([{ name: 'se_session', value: sessions()[who], url: 'http://localhost:3100' }]);
const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

test.describe('public pages', () => {
  test('home lists open bounties, newest first, with amounts and PR counts', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Open bounties' })).toBeVisible();
    const cards = page.locator('a.card');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Fix flaky CI');
    await expect(page.getByText('50.00 USDC')).toBeVisible();
    await expect(page.getByText('2 PRs')).toBeVisible();
    await noSideScroll(page);
  });

  test('search, min amount, sort and reset', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Search').fill('dark');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toHaveCount(1);
    await expect(page.locator('a.card')).toContainText('Add dark mode');
    await page.getByRole('link', { name: 'Reset' }).click();
    await expect(page.locator('a.card')).toHaveCount(3);
    await page.getByLabel('Token').selectOption('CUSDCE2E');
    await page.getByLabel('Minimum amount').fill('30');
    await page.getByLabel('Sort').selectOption('highest');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toHaveCount(2);
    await expect(page.locator('a.card').first()).toContainText('Add dark mode');
    await page.getByLabel('Search').fill('zzzz-nothing');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('No open bounties match')).toBeVisible();
  });

  test('bounty detail shows criteria and ranks PRs by the advisory AI verdict', async ({ page }) => {
    await page.goto('/b/1');
    await expect(page.getByRole('heading', { name: 'Retry failed HTTP requests' })).toBeVisible();
    await expect(page.getByText('Retries 3 times')).toBeVisible();
    const prs = page.locator('.card');
    await expect(prs.first()).toContainText('#3 by contrib');
    await expect(prs.first()).toContainText('Rank 1 of 2');
    await expect(prs.first()).toContainText('Likely meets (88)');
    await expect(prs.nth(1)).toContainText('Partially meets');
    await expect(page.getByText('advisory only').first()).toBeVisible();
    await noSideScroll(page);
  });

  test('a PR that closes two bounties shows on both', async ({ page }) => {
    await page.goto('/b/2');
    await expect(page.locator('.card').first()).toContainText('#3 by contrib');
    await expect(page.locator('.card').first()).toContainText('Rank 1 of 1');
  });

  test('unknown bounty and unknown profile are 404s', async ({ page }) => {
    expect((await page.goto('/b/999'))?.status()).toBe(404);
    expect((await page.goto('/u/nobody'))?.status()).toBe(404);
  });

  test('docs and install pages render', async ({ page }) => {
    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByText('3%')).toBeVisible();
    await page.goto('/install');
    await expect(page.getByRole('heading', { name: 'Install the GitHub App' })).toBeVisible();
  });

  test('filters by token, status, repository, and combinations', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Token').selectOption('CUSDCE2E');
    await page.getByLabel('Repository').selectOption('acme/widgets');
    await page.getByLabel('Status').selectOption('open');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toHaveCount(2);
    await expect(page.locator('a.card').first()).toContainText('Add dark mode');
    await page.getByLabel('Status').selectOption('paid'); await page.getByLabel('Repository').selectOption('');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toHaveCount(1); await expect(page.locator('a.card')).toContainText('Paid bounty');
    await page.getByLabel('Status').selectOption('refunded'); await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toContainText('Refunded bounty');
    await page.getByLabel('Status').selectOption('disputed'); await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toContainText('Disputed bounty');
  });

  test('round-trips filters through the URL and browser back button', async ({ page }) => {
    await page.goto('/'); await page.getByLabel('Token').selectOption('CUSDCE2E'); await page.getByLabel('Repository').selectOption('acme/widgets');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/token=CUSDCE2E/); await expect(page).toHaveURL(/repo=acme%2Fwidgets/);
    await page.reload(); await expect(page.getByLabel('Token')).toHaveValue('CUSDCE2E'); await expect(page.getByLabel('Repository')).toHaveValue('acme/widgets');
    await page.getByLabel('Search').fill('dark'); await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.locator('a.card')).toHaveCount(1); await page.goBack();
    await expect(page.getByLabel('Search')).toHaveValue(''); await expect(page.locator('a.card')).toHaveCount(2);
  });

  test('shows inline validation for unsupported minimum-amount syntax', async ({ page }) => {
    await page.goto('/'); await page.getByLabel('Token').selectOption('CUSDCE2E'); await page.getByLabel('Minimum amount').fill('1e3');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid minimum amount');
  });

  test('navigates forward and back through cursor pages while preserving filters', async ({ page }) => {
    const db = new pg.Client({ connectionString: E2E_DB }); await db.connect();
    try {
      await db.query(`DELETE FROM "Bounty" WHERE id BETWEEN 1000 AND 1020`);
      for (let id = 1000; id <= 1020; id++) await db.query(`INSERT INTO "Bounty"(id,"repoId","issueNumber","issueTitle","issueUrl",criteria,maintainer,token,amount,"feeBps",deadline,"relayerAllowed",status,"fundTx","createdAt","updatedAt") VALUES ($1,100,$2,$3,'https://github.com/acme/widgets/issues/1','{}','GMAINT','CUSDCE2E','500000000',300,now()+interval '5 days',true,'OPEN','tx',now(),now())`, [id, id, `Pagination item ${id}`]);
      await page.goto('/?token=CUSDCE2E');
      await expect(page.locator('a.card')).toHaveCount(20); await page.getByRole('link', { name: 'Next page' }).click();
      await expect(page.locator('a.card')).toHaveCount(4); await expect(page).toHaveURL(/token=CUSDCE2E/);
      await page.getByRole('link', { name: 'Previous page' }).click(); await expect(page.locator('a.card')).toHaveCount(20);
    } finally { await db.query(`DELETE FROM "Bounty" WHERE id BETWEEN 1000 AND 1020`); await db.end(); }
  });
});

test.describe('account', () => {
  test('signed out shows a sign-in notice', async ({ page }) => {
    await page.goto('/me');
    await expect(page.getByText('You are not signed in')).toBeVisible();
  });
  test('signed in shows the profile and wallet controls', async ({ page }) => {
    await signIn(page, 'user');
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'maint' })).toBeVisible();
    await expect(page.getByText('No wallet linked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link wallet' })).toBeVisible();
    await expect(page.getByText('We never ask for your secret key')).toBeVisible();
  });
  test('without Freighter, linking explains what to do instead of failing silently', async ({ page }) => {
    await signIn(page, 'user');
    await page.goto('/me');
    await page.getByRole('button', { name: 'Link wallet' }).click();
    await expect(page.getByRole('status')).toContainText(/Freighter/i, { timeout: 20_000 });
  });
});

test.describe('funding page', () => {
  test('open, expired and used links', async ({ page }) => {
    await signIn(page, 'user');
    await page.goto('/fund/intent-open-0000001');
    await expect(page.getByRole('heading', { name: 'Fund bounty' })).toBeVisible();
    await expect(page.getByText('50.00')).toBeVisible();
    await expect(page.getByLabel(/Pay automatically/)).toBeChecked();
    await expect(page.getByRole('button', { name: 'Connect wallet and fund' })).toBeEnabled();
    await page.getByLabel(/Pay automatically/).uncheck();
    await expect(page.getByText('You will sign the release yourself')).toBeVisible();
    await page.goto('/fund/intent-expired-00001');
    await expect(page.locator('p[role="alert"]')).toContainText('expired');
    await page.goto('/fund/intent-used-0000001');
    await expect(page.getByText('already funded')).toBeVisible();
    await page.goto('/fund/does-not-exist-zzz');
    await expect(page.getByRole('heading', { name: 'Funding link not found' })).toBeVisible();
  });
  test('signed-out visitors are told to sign in', async ({ page }) => {
    await page.goto('/fund/intent-open-0000001');
    await expect(page.getByText('Sign in with GitHub')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect wallet and fund' })).toBeDisabled();
  });
});

/** Each run gets its own pending dispute, so the stateful reject test is order independent. */
async function freshDispute() {
  const db = new pg.Client({ connectionString: E2E_DB });
  await db.connect();
  await db.query(`DELETE FROM "Dispute"`);
  await db.query(`INSERT INTO "Dispute"(id,"bountyId","openedByGithubId",reason,evidence,status,"createdAt","updatedAt") VALUES ('disputeaaaaaaaaaa1',3,55,'Merged PR was not paid','{}','REQUESTED',now()-interval '40 hours',now())`);
  await db.end();
}

test.describe('admin', () => {
  test('non-admins are turned away', async ({ page }) => {
    await signIn(page, 'user');
    await page.goto('/admin');
    await expect(page.locator('p[role="alert"]')).toContainText('Admins only');
  });
  test('admin sees the overdue dispute queue and can reject with a note (CSRF end to end)', async ({ page }) => {
    await freshDispute();
    await signIn(page, 'admin');
    await page.goto('/admin');
    await expect(page.getByText('over 36 h')).toBeVisible();
    await expect(page.getByText('Merged PR was not paid')).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('status')).toContainText('Add a note');
    await page.getByLabel('Note').fill('No merit; the PR was never merged');
    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('status')).toContainText('Dispute rejected');
    await expect(page.getByText('No open disputes')).toBeVisible();
  });
});

const fakeMe = (over: object = {}) => ({ id: 'u55', login: 'maint', wallet: null, isAdmin: false, csrfToken: 'csrf-scripted', ...over });
const fakeDispute = (status: 'REQUESTED' | 'OPENED_ONCHAIN') => ({ id: 'disputeaaaaaaaaaa1', status, reason: 'Merged PR was not paid', createdAt: new Date().toISOString(), overdue: true, resolutionNote: null, bounty: { id: '3', issueTitle: 'Fix flaky CI', amount: '250000000', token: 'CUSDCE2E', maintainer: FAKE_ADDRESS, repo: { fullName: 'acme/gadgets' }, prs: [] } });
const fakeStatus = { indexerLedger: 1, failedPayouts: 0, waitingPayouts: 0, openDisputes: 1 };

test.describe('scripted Freighter signed flows', () => {
  test('links a wallet and sends the signed challenge with CSRF protection', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() }));
    await page.route('**/api/me/funded', (r) => r.fulfill({ json: [] }));
    let challengeHeaders: Record<string, string> | undefined, verifyBody: Record<string, string> | undefined;
    await page.route('**/api/wallet/challenge', (r) => { challengeHeaders = r.request().headers(); return r.fulfill({ json: { challengeId: 'challenge-123', message: 'Link this wallet' } }); });
    await page.route('**/api/wallet/verify', async (r) => { verifyBody = r.request().postDataJSON(); return r.fulfill({ json: { address: FAKE_ADDRESS } }); });
    await page.goto('/me'); await page.getByRole('button', { name: 'Link wallet' }).click();
    await expect(page.getByRole('status')).toContainText('Wallet linked.');
    expect(challengeHeaders?.['x-csrf-token']).toBe('csrf-scripted');
    expect(verifyBody).toMatchObject({ challengeId: 'challenge-123', signature: 'ZmFrZS1zaWduYXR1cmU=' });
  });

  test('shows a clear message when wallet access is declined', async ({ page }) => {
    await installFakeWallet(page, { decline: 'REQUEST_ACCESS' });
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() })); await page.route('**/api/me/funded', (r) => r.fulfill({ json: [] }));
    let requested = false; await page.route('**/api/wallet/challenge', (r) => { requested = true; return r.fulfill({ json: {} }); });
    await page.goto('/me'); await page.getByRole('button', { name: 'Link wallet' }).click();
    await expect(page.getByRole('status')).toContainText('Freighter access was declined.'); expect(requested).toBe(false);
  });

  test('refuses wallet access on the wrong network', async ({ page }) => {
    await installFakeWallet(page, { passphrase: 'Public Global Stellar Network ; September 2015' });
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() })); await page.route('**/api/me/funded', (r) => r.fulfill({ json: [] }));
    await page.goto('/me'); await page.getByRole('button', { name: 'Link wallet' }).click();
    await expect(page.getByRole('status')).toContainText('Switch Freighter to the network');
  });

  test('does not verify a wallet when the challenge signature is declined', async ({ page }) => {
    await installFakeWallet(page, { decline: 'SUBMIT_BLOB' });
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() })); await page.route('**/api/me/funded', (r) => r.fulfill({ json: [] }));
    await page.route('**/api/wallet/challenge', (r) => r.fulfill({ json: { challengeId: 'challenge-123', message: 'Link this wallet' } }));
    let verified = false; await page.route('**/api/wallet/verify', (r) => { verified = true; return r.fulfill({ json: {} }); });
    await page.goto('/me'); await page.getByRole('button', { name: 'Link wallet' }).click();
    await expect(page.getByRole('status')).toContainText('Signing was declined.'); expect(verified).toBe(false);
  });

  test('funds an intent with the exact signed XDR and CSRF header', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() }));
    await page.route('**/api/intents/intent-open-0000001', (r) => r.fulfill({ json: { state: 'open', repo: 'acme/widgets', issueNumber: 7, token: 'CUSDCE2E', amount: '500000000', durationDays: 14, bountyId: null } }));
    await page.route('**/api/intents/intent-open-0000001/build', (r) => r.fulfill({ json: { xdr: 'unsigned-fund-xdr' } }));
    let submitted: Record<string, unknown> | undefined, headers: Record<string, string> | undefined;
    await page.route('**/api/tx/submit', (r) => { submitted = r.request().postDataJSON(); headers = r.request().headers(); return r.fulfill({ json: { hash: 'tx-hash' } }); });
    await page.goto('/fund/intent-open-0000001'); await page.getByRole('button', { name: 'Connect wallet and fund' }).click();
    await expect(page.getByRole('button', { name: 'Waiting for confirmation…' })).toBeVisible();
    expect(submitted).toMatchObject({ xdr: 'signed:unsigned-fund-xdr', address: FAKE_ADDRESS }); expect(headers?.['x-csrf-token']).toBe('csrf-scripted');
  });

  test('does not build a funding transaction on a wrong network', async ({ page }) => {
    await installFakeWallet(page, { passphrase: 'wrong network' }); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() }));
    await page.route('**/api/intents/intent-open-0000001', (r) => r.fulfill({ json: { state: 'open', repo: 'acme/widgets', issueNumber: 7, token: 'CUSDCE2E', amount: '500000000', durationDays: 14, bountyId: null } }));
    let built = false; await page.route('**/api/intents/intent-open-0000001/build', (r) => { built = true; return r.fulfill({ json: { xdr: 'xdr' } }); });
    await page.goto('/fund/intent-open-0000001'); await page.getByRole('button', { name: 'Connect wallet and fund' }).click();
    await expect(page.getByRole('alert')).toContainText('Switch Freighter to the network'); expect(built).toBe(false);
  });

  test('reports a declined funding signature without submitting it', async ({ page }) => {
    await installFakeWallet(page, { decline: 'SUBMIT_TRANSACTION' }); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() }));
    await page.route('**/api/intents/intent-open-0000001', (r) => r.fulfill({ json: { state: 'open', repo: 'acme/widgets', issueNumber: 7, token: 'CUSDCE2E', amount: '500000000', durationDays: 14, bountyId: null } }));
    await page.route('**/api/intents/intent-open-0000001/build', (r) => r.fulfill({ json: { xdr: 'unsigned-fund-xdr' } }));
    let submitted = false; await page.route('**/api/tx/submit', (r) => { submitted = true; return r.fulfill({ json: { hash: 'tx' } }); });
    await page.goto('/fund/intent-open-0000001'); await page.getByRole('button', { name: 'Connect wallet and fund' }).click();
    await expect(page.getByRole('alert')).toContainText('Signing was declined.'); expect(submitted).toBe(false);
  });

  test('uses contract error text when funding build is rejected', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe() }));
    await page.route('**/api/intents/intent-open-0000001', (r) => r.fulfill({ json: { state: 'open', repo: 'acme/widgets', issueNumber: 7, token: 'CUSDCE2E', amount: '500000000', durationDays: 14, bountyId: null } }));
    await page.route('**/api/intents/intent-open-0000001/build', (r) => r.fulfill({ status: 422, json: { error: { code: 'contract_InvalidStatus', message: 'rejected' } } }));
    await page.goto('/fund/intent-open-0000001'); await page.getByRole('button', { name: 'Connect wallet and fund' }).click();
    await expect(page.getByRole('alert')).toContainText('This bounty is no longer in a state that allows this action.');
  });

  for (const action of ['release', 'refund'] as const) {
    test(`signs and submits a maintainer ${action} with CSRF protection`, async ({ page }) => {
      await installFakeWallet(page); await mockConfig(page);
      await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ wallet: FAKE_ADDRESS }) }));
      await page.route('**/api/me/funded', (r) => r.fulfill({ json: [{ id: '1', issueTitle: 'Bounty one', amount: '500000000', token: 'CUSDCE2E', status: 'OPEN', deadline: new Date().toISOString() }] }));
      let signedXdr: unknown, csrfHeader: string | undefined;
      await page.route(`**/api/bounties/1/${action}/build`, (r) => r.fulfill({ json: { xdr: `unsigned-${action}-xdr` } }));
      await page.route('**/api/tx/submit', (r) => { signedXdr = r.request().postDataJSON().xdr; csrfHeader = r.request().headers()['x-csrf-token']; return r.fulfill({ json: { hash: 'tx' } }); });
      await page.goto('/me'); await page.getByRole('button', { name: action === 'release' ? 'Release' : 'Refund' }).click();
      await expect(page.getByRole('status')).toContainText(action === 'release' ? 'Release submitted.' : 'Refund submitted.');
      expect(signedXdr).toBe(`signed:unsigned-${action}-xdr`); expect(csrfHeader).toBe('csrf-scripted');
    });
  }

  test('opens a dispute on chain using the scripted arbiter wallet', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ isAdmin: true }) }));
    await page.route('**/api/admin/disputes', (r) => r.fulfill({ json: [fakeDispute('requested')] }));
    await page.route('**/api/admin/payouts?status=FAILED', (r) => r.fulfill({ json: [] })); await page.route('**/api/admin/status', (r) => r.fulfill({ json: fakeStatus }));
    let submitted: unknown, csrfHeader: string | undefined;
    await page.route('**/api/admin/disputes/disputeaaaaaaaaaa1/open-onchain', (r) => r.fulfill({ json: { xdr: 'unsigned-open-xdr' } }));
    await page.route('**/api/tx/submit', (r) => { submitted = r.request().postDataJSON().xdr; csrfHeader = r.request().headers()['x-csrf-token']; return r.fulfill({ json: { hash: 'tx' } }); });
    await page.goto('/admin'); await page.getByRole('button', { name: 'Open on chain' }).click();
    await expect(page.getByRole('status')).toContainText('Dispute opened on chain.'); expect(submitted).toBe('signed:unsigned-open-xdr'); expect(csrfHeader).toBe('csrf-scripted');
  });

  test('resolves an opened dispute after signing the prepared XDR', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ isAdmin: true }) }));
    await page.route('**/api/admin/disputes', (r) => r.fulfill({ json: [fakeDispute('opened_onchain')] }));
    await page.route('**/api/admin/payouts?status=FAILED', (r) => r.fulfill({ json: [] })); await page.route('**/api/admin/status', (r) => r.fulfill({ json: fakeStatus }));
    let body: Record<string, unknown> | undefined, submitted: unknown;
    await page.route('**/api/admin/disputes/disputeaaaaaaaaaa1/resolve/build', (r) => { body = r.request().postDataJSON(); return r.fulfill({ json: { xdr: 'unsigned-resolve-xdr' } }); });
    await page.route('**/api/tx/submit', (r) => { submitted = r.request().postDataJSON().xdr; return r.fulfill({ json: { hash: 'tx' } }); });
    await page.goto('/admin'); await page.getByLabel('Winner address').fill(FAKE_ADDRESS); await page.getByLabel('Winner basis points').fill('7500'); await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByRole('status')).toContainText('Resolution submitted.'); expect(body).toMatchObject({ winner: FAKE_ADDRESS, winnerBps: 7500 }); expect(submitted).toBe('signed:unsigned-resolve-xdr');
  });

  test('rejects an out-of-range winner share before wallet signing', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ isAdmin: true }) }));
    await page.route('**/api/admin/disputes', (r) => r.fulfill({ json: [fakeDispute('opened_onchain')] }));
    await page.route('**/api/admin/payouts?status=FAILED', (r) => r.fulfill({ json: [] })); await page.route('**/api/admin/status', (r) => r.fulfill({ json: fakeStatus }));
    let built = false; await page.route('**/api/admin/disputes/disputeaaaaaaaaaa1/resolve/build', (r) => { built = true; return r.fulfill({ json: { xdr: 'xdr' } }); });
    await page.goto('/admin'); await page.getByLabel('Winner basis points').fill('10001'); await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByRole('status')).toContainText('Winner share must be 0 to 10000 basis points.'); expect(built).toBe(false);
  });

  test('requires a winner for a positive split before requesting a transaction', async ({ page }) => {
    await installFakeWallet(page); await mockConfig(page);
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ isAdmin: true }) }));
    await page.route('**/api/admin/disputes', (r) => r.fulfill({ json: [fakeDispute('opened_onchain')] }));
    await page.route('**/api/admin/payouts?status=FAILED', (r) => r.fulfill({ json: [] })); await page.route('**/api/admin/status', (r) => r.fulfill({ json: fakeStatus }));
    let built = false; await page.route('**/api/admin/disputes/disputeaaaaaaaaaa1/resolve/build', (r) => { built = true; return r.fulfill({ json: { xdr: 'xdr' } }); });
    await page.goto('/admin'); await page.getByLabel('Winner basis points').fill('5000'); await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByRole('status')).toContainText('a winner address is required when winnerBps > 0'); expect(built).toBe(false);
  });
});

test.describe('public profile page', () => {
  test('shows paid bounties with tokens and explorer links', async ({ page }) => {
    await page.goto('/u/paiduser');
    await expect(page.getByRole('heading', { name: 'paiduser' })).toBeVisible();
    await expect(page.getByText('Paid bounty')).toBeVisible();
    await expect(page.getByText('10.00 COTHER')).toBeVisible();
    await expect(page.getByRole('link', { name: 'tx' })).toBeVisible();
    await noSideScroll(page);
  });

  test('shows user with payouts in two different tokens', async ({ page }) => {
    await page.goto('/u/multitoken');
    await expect(page.getByRole('heading', { name: 'multitoken' })).toBeVisible();
    await expect(page.getByText('Refunded bounty')).toBeVisible();
    await expect(page.getByText('Disputed bounty')).toBeVisible();
    await expect(page.getByText('12.00 USDC')).toBeVisible();
    await expect(page.getByText('3.00 USDC')).toBeVisible();
  });

  test('shows empty state for user with no payments', async ({ page }) => {
    await page.goto('/u/nopayments');
    await expect(page.getByRole('heading', { name: 'nopayments' })).toBeVisible();
    await expect(page.getByText('None yet.')).toBeVisible();
  });

  test('returns 404 for missing login', async ({ page }) => {
    expect((await page.goto('/u/doesnotexist999'))?.status()).toBe(404);
  });

  test('mixed-case login normalizes to lowercase', async ({ page }) => {
    await page.goto('/u/PaIdUsEr');
    await expect(page.getByRole('heading', { name: 'paiduser' })).toBeVisible();
    await expect(page.getByText('Paid bounty')).toBeVisible();
  });
});

test.describe('bounty page status variations', () => {
  test('OPEN status shows badge and stepper', async ({ page }) => {
    await page.goto('/b/1');
    await expect(page.locator('.status.open')).toBeVisible();
    await expect(page.locator('.steps li.now')).toHaveText('In review');
  });

  test('RELEASED status shows paid badge and completed stepper', async ({ page }) => {
    await page.goto('/b/4');
    await expect(page.locator('.status.released')).toContainText('Paid');
    await expect(page.locator('.steps li.done').last()).toHaveText('Paid');
    await expect(page.getByText('PR #3: Paid')).toBeVisible();
  });

  test('REFUNDED status shows notice and badge', async ({ page }) => {
    await page.goto('/b/5');
    await expect(page.locator('.status.refunded')).toBeVisible();
    await expect(page.getByText('Nothing was merged in time')).toBeVisible();
  });

  test('DISPUTED status shows notice and badge', async ({ page }) => {
    await page.goto('/b/6');
    await expect(page.locator('.status.disputed')).toBeVisible();
    await expect(page.getByText('This bounty is under dispute')).toBeVisible();
  });

  test('RESOLVED status shows notice and badge', async ({ page }) => {
    await page.goto('/b/7');
    await expect(page.locator('.status.resolved')).toBeVisible();
    await expect(page.getByText('An arbiter resolved a dispute')).toBeVisible();
  });
});

test.describe('admin access control', () => {
  test('non-admin sees refusal on admin page', async ({ page }) => {
    await signIn(page, 'user');
    await page.goto('/admin');
    await expect(page.locator('p[role="alert"]')).toContainText('Admins only');
  });

  test('non-admin gets 403 from admin API endpoints', async ({ page }) => {
    await signIn(page, 'user');
    const response = await page.request.get('http://localhost:3100/api/admin/status');
    expect(response.status()).toBe(403);
  });

  test('anonymous visitor redirected to sign in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('p[role="alert"]')).toContainText('Admins only');
  });
});

test.describe('address truncation on small screens', () => {
  test('long addresses do not cause horizontal scroll at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await signIn(page, 'user');
    await page.goto('/me');
    await page.route('**/api/auth/me', (r) => r.fulfill({ json: fakeMe({ wallet: 'GVERYLONGADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }) }));
    await page.route('**/api/me/funded', (r) => r.fulfill({ json: [] }));
    await page.reload();
    await expect(page.locator('code[data-address]')).toBeVisible();
    await noSideScroll(page);
  });
});
