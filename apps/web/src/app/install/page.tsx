export const metadata = { title: 'Install · SkillEscrow' };

const PERMISSIONS: [string, string][] = [
  ['Issues: post and update the bounty card', 'read & write'],
  ['Pull requests: track PRs, post advisory reviews', 'read & write'],
  ['Contents: read diffs for the review', 'read'],
  ['Metadata', 'read'],
];

export default function Install() {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  return (
    <>
      <p className="eyebrow" style={{ marginTop: '2.5rem' }}>For maintainers</p>
      <h1>Install the GitHub App</h1>
      <p className="lede">Put money on an issue in one comment. Merging a PR that closes it pays the author automatically.</p>
      <h2>What it can access</h2>
      <div style={{ borderTop: '1px solid var(--line-strong)' }}>
        {PERMISSIONS.map(([what, level]) => <div key={what} className="perm"><span>{what}</span><span>{level}</span></div>)}
      </div>
      {slug
        ? <a className="cta" href={`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`}>Install on GitHub →</a>
        : <p className="notice">The GitHub App is not registered for this environment yet.</p>}
    </>
  );
}
