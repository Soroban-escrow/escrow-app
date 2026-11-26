import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AUDIENCE_LABEL, COMMANDS, WHERE_LABEL } from '@skillescrow/shared/src/command-help';
import { CommandReference } from './CommandReference';
import { COPY_STATUS, CopyButton, copyText } from './CopyButton';
import { shouldRemindToLinkWallet, WalletReminder, WalletReminderView } from './WalletReminder';

describe('CommandReference (#135)', () => {
  it('renders every command from the shared metadata', () => {
    const html = renderToStaticMarkup(<CommandReference />);
    for (const c of COMMANDS) {
      expect(html).toContain(c.syntax.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      expect(html).toContain(c.description);
      expect(html).toContain(AUDIENCE_LABEL[c.audience]);
      expect(html).toContain(WHERE_LABEL[c.where]);
    }
    expect(html).toContain('/bounty review');
    expect(html.match(/<tr>/g)).toHaveLength(COMMANDS.length + 1);
  });
});

describe('copyText (#137)', () => {
  it('uses the Clipboard API when it works, without selecting anything', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const selectAll = vi.fn();
    expect(await copyText('GABC', { clipboard: { writeText }, selectAll })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('GABC');
    expect(selectAll).not.toHaveBeenCalled();
  });

  it('falls back to select-all and the legacy copy command without a Clipboard API', async () => {
    const order: string[] = [];
    const result = await copyText('GABC', {
      selectAll: () => order.push('select'),
      execCopy: () => (order.push('exec'), true),
    });
    expect(result).toBe('copied');
    // The value must be selected before the legacy copy runs on the selection.
    expect(order).toEqual(['select', 'exec']);
  });

  it('falls back when the Clipboard API rejects (no permission)', async () => {
    const selectAll = vi.fn();
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    expect(await copyText('GABC', { clipboard: { writeText }, selectAll, execCopy: () => true })).toBe('copied');
    expect(selectAll).toHaveBeenCalledOnce();
  });

  it('leaves the value selected for Ctrl/⌘+C when nothing can copy', async () => {
    const selectAll = vi.fn();
    expect(await copyText('GABC', { selectAll })).toBe('manual');
    expect(await copyText('GABC', { selectAll, execCopy: () => false })).toBe('manual');
    expect(await copyText('GABC', { selectAll, execCopy: () => { throw new Error('unsupported'); } })).toBe('manual');
    expect(selectAll).toHaveBeenCalledTimes(3);
    expect(COPY_STATUS.manual).toMatch(/Ctrl\+C/);
    expect(COPY_STATUS.copied).toBe('Copied');
  });
});

describe('CopyButton (#137)', () => {
  const html = renderToStaticMarkup(<CopyButton value="GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTU" label="wallet address" />);

  it('is a real button with an accessible name for what it copies', () => {
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Copy wallet address"[^>]*>Copy<\/button>/);
  });

  it('announces the result in a polite live region', () => {
    expect(html).toMatch(/<span role="status" aria-live="polite"[^>]*><\/span>/);
  });

  it('keeps the full value in a hidden, read-only field for the select-all fallback', () => {
    expect(html).toContain('value="GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTU"');
    expect(html).toMatch(/<input[^>]*class="copy-field mono visually-hidden"[^>]*readOnly=""/);
    expect(html).toMatch(/<input[^>]*tabindex="-1"[^>]*aria-hidden="true"/i);
  });
});

describe('wallet-linking reminder (#136)', () => {
  const authors = ['alice', 'Bob'];

  it('reminds only a signed-in linked-PR author without a wallet', () => {
    expect(shouldRemindToLinkWallet({ login: 'alice', wallet: null }, authors)).toBe(true);
    expect(shouldRemindToLinkWallet({ login: 'bob', wallet: null }, authors)).toBe(true); // logins are case-insensitive
    expect(shouldRemindToLinkWallet({ login: 'alice', wallet: 'GABC' }, authors)).toBe(false);
    expect(shouldRemindToLinkWallet({ login: 'carol', wallet: null }, authors)).toBe(false);
    expect(shouldRemindToLinkWallet(null, authors)).toBe(false);
    expect(shouldRemindToLinkWallet(undefined, authors)).toBe(false);
    expect(shouldRemindToLinkWallet({ login: 'alice', wallet: null }, [])).toBe(false);
  });

  it('shows a call to link a wallet on the Account page', () => {
    const html = renderToStaticMarkup(<WalletReminderView viewer={{ login: 'alice', wallet: null }} prAuthors={authors} />);
    expect(html).toContain('<a href="/me">link one on your Account page</a>');
  });

  it('otherwise renders nothing at all', () => {
    expect(renderToStaticMarkup(<WalletReminderView viewer={{ login: 'alice', wallet: 'GABC' }} prAuthors={authors} />)).toBe('');
    expect(renderToStaticMarkup(<WalletReminderView viewer={null} prAuthors={authors} />)).toBe('');
    // Server-rendered before the viewer is known: nothing, so signed-out visitors never see it.
    expect(renderToStaticMarkup(<WalletReminder prAuthors={authors} />)).toBe('');
  });
});
