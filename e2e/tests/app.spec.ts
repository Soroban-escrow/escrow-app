import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_DB } from '../playwright.config.js';

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
  await db.query(`INSERT INTO "Dispute"(id,"bountyId","openedByGithubId",reason,evidence,status,"createdAt","updatedAt") VALUES ('disputeaaaaaaaaaa1',3,55,'Merged PR was not paid','{}','requested',now()-interval '40 hours',now())`);
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
