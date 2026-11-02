export default function Install() {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
  return (
    <>
      <h1>Install the GitHub App</h1>
      <p>SkillEscrow lets maintainers lock USDC on an issue. Merging a PR that closes the issue pays its author automatically.</p>
      <h2>Permissions it asks for</h2>
      <ul><li>Issues: read and write (post the bounty card)</li><li>Pull requests: read and write (track PRs, post reviews)</li><li>Contents and metadata: read</li></ul>
      {slug ? <p><a href={`https://github.com/apps/${slug}/installations/new`}>Install on GitHub</a></p> : <p className="muted">The app is not registered for this environment yet.</p>}
    </>
  );
}
