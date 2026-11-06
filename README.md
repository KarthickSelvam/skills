# Skills

Reusable agent skills. Each folder contains a `SKILL.md` with frontmatter, plus the scripts, templates and references it uses.

| Skill | What it does |
|---|---|
| [interactive-sequence-explorer](interactive-sequence-explorer/SKILL.md) | Reads a codebase, works out a flow, splits it into sequences and phases, and builds a self-contained animated sequence explorer in HTML. It has Plain and Technical modes, request and response round trips, SQL for each table, failure branches and deep links. [Live example source](interactive-sequence-explorer/examples/loan-funding-review/). |

## Install

Copy, or symlink, a skill folder into your agent's skills directory:

- **GitHub Copilot CLI and app:** `~/.copilot/skills/<skill-name>/`, or `.github/skills/<skill-name>/` inside a repository.
- **Claude Code:** `~/.claude/skills/<skill-name>/`, or `.claude/skills/<skill-name>/` in a repository.

```powershell
git clone https://github.com/KarthickSelvam/skills
New-Item -ItemType SymbolicLink -Path "$HOME\.copilot\skills\interactive-sequence-explorer" -Target "$PWD\skills\interactive-sequence-explorer"
```

The scripts need Node.js 18 or later and no packages.

## License

[MIT](LICENSE)
