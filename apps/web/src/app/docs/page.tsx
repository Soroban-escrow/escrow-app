export const metadata = { title: 'How it works · SkillEscrow' };

export default function Docs() {
  return (
    <>
      <p className="eyebrow" style={{ marginTop: '2.5rem' }}>Docs</p>
      <h1>How it works</h1>
      <p className="lede">Three parties, one rule: the pull request a maintainer merges is the one that gets paid.</p>

      <div className="two">
        <section>
          <h2>Maintainers</h2>
          <ol className="flow">
            <li><span><strong>Install the GitHub App</strong>Add it to the repositories you want to fund.</span></li>
            <li><span><strong>Comment <code>/bounty 50 USDC 14d</code></strong>On any open issue. The bot replies with a funding link.</span></li>
            <li><span><strong>Sign once in Freighter</strong>The funds move into the escrow contract, not to us.</span></li>
            <li><span><strong>Merge the PR you like</strong>Its author is paid within seconds. Nothing merged by the deadline? Reclaim it after the grace period.</span></li>
          </ol>
        </section>
        <section>
          <h2>Contributors</h2>
          <ol className="flow">
            <li><span><strong>Link your wallet</strong>Once, on the Account page, by signing a message. We never see your keys.</span></li>
            <li><span><strong>Open a pull request</strong>Say <code>Closes #123</code> so it is linked to the bounty.</span></li>
            <li><span><strong>Get reviewed and merged</strong>An AI review ranks PRs for the maintainer. The merge decides.</span></li>
          </ol>
        </section>
      </div>

      <h2>Fees and trust</h2>
      <div className="two">
        <p>The fee is <strong>3%</strong> of the payout, charged to the maintainer. Refunds are free.</p>
        <p>Funds sit in a Soroban contract on Stellar. A relayer may release a bounty only if its maintainer opted in. The AI review never moves money, and disputes go to a human arbiter.</p>
      </div>
    </>
  );
}
