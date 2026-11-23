import { AUDIENCE_LABEL, COMMANDS, WHERE_LABEL, type CommandInfo } from '@skillescrow/shared/src/command-help';

/**
 * The `/bounty` command reference, rendered from the same metadata as the
 * bot's help reply so the two cannot drift apart (#135).
 */
export function CommandReference({ commands = COMMANDS }: { commands?: readonly CommandInfo[] }) {
  return (
    <table className="commands">
      <thead>
        <tr><th scope="col">Command</th><th scope="col">What it does</th><th scope="col">Who and where</th></tr>
      </thead>
      <tbody>
        {commands.map((c) => (
          <tr key={c.kind}>
            <td>
              <code>{c.syntax}</code>
              {c.example !== c.syntax && <span className="muted small"><br />e.g. <code>{c.example}</code></span>}
            </td>
            <td>{c.description}</td>
            <td>{AUDIENCE_LABEL[c.audience]}, on {WHERE_LABEL[c.where]}.</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
