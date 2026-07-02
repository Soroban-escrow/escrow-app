export default function Docs() {
  return (
    <>
      <h1>How it works</h1>
      <h2>Maintainers</h2>
      <ol><li>Install the app, then comment <code>/bounty 50 USDC 14d</code> on an issue.</li><li>Open the funding link and sign with Freighter.</li><li>Merge the PR you like. The author is paid in seconds.</li><li>If nothing is merged, you can refund after the deadline plus a grace period.</li></ol>
      <h2>Contributors</h2>
      <ol><li>Link your wallet once on the Account page.</li><li>Open a PR with <code>Closes #123</code>.</li></ol>
      <h2>Fees and trust</h2>
      <p>The fee is 3% of the payout, charged to the maintainer. A relayer can release only bounties whose maintainer opted in; otherwise the maintainer signs the release. The AI review is advisory and never moves money. Disputes go to a human arbiter.</p>
    </>
  );
}
