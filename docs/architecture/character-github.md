# Character GitHub connection

A character's creations belong on an explicit creation shelf. GitHub supplies repository storage and commit receipts; it does not make a pinned link proof that a character created its contents.

The host-side `CharacterGitHub` adapter is actor-scoped by world, owning Elsewhere account and character ID. It can inspect configured repositories, read bounded text files, and write one file on a configured non-default branch. The current CLI admits only Hubert; the adapter contract is reusable by future admitted characters. No GitHub account, App, installation or repository has been provisioned by this code.

## Owner setup

1. Create a GitHub App in the account or organization that will own the character repositories. Configure **Contents: read and write** and the required metadata read permission. Leave webhooks inactive unless another implemented consumer needs them. The current adapter does not request Actions, Workflows, administration or access to other accounts.
2. Install the App on **selected dedicated repositories**. Create an initial commit/default branch, then a separate working branch such as `hubert/work`. The adapter refuses to write to the repository's current default branch. A branch must already exist; setup does not create it.
3. Download the App's RSA private key into private operator storage, outside source control. Use a file owned by the runtime operator with mode `600`, with private parent directories. Never paste its contents into chat, source, `VITE_*`, a command argument or a public build. Hosted environments must provide this file through their private secret storage.
4. Supply the metadata below through your private shell/environment or secret manager. These identifiers and paths are host configuration, never model inputs. `HUBERT_OWNER_USER_ID` must be the actual Elsewhere owner account ID.

```dotenv
HUBERT_OWNER_USER_ID=your-elsewhere-owner-id
GITHUB_APP_ID=123456
GITHUB_INSTALLATION_ID=12345678
GITHUB_APP_PRIVATE_KEY_PATH=/absolute/private/path/character-app.pem
GITHUB_CHARACTER_REPOSITORIES=[{"id":123456789,"fullName":"owner/hubert-projects","branch":"hubert/work"}]
```

```sh
pnpm github:setup stage   # local validation only; refuses an existing record
pnpm github:setup status  # staged metadata, not a network check
pnpm github:setup check   # real read-only API check; no file changes
```

Use `pnpm github:setup stage --replace` only when deliberately replacing the saved binding. Staging writes `.data/credentials/hubert/github.json` (private `700` directories, `600` file); it stores metadata and the private-key path, not a copy of the key. Symlinked/shared storage and key files are refused. The script reads the current process environment; it does not automatically load `.env` files. Do not put the multiline private key in environment variables.

The check creates a short-lived installation access token restricted to **one exact repository ID and read permissions per request**, and verifies returned repository IDs/names against the saved binding. API requests use GitHub's fixed HTTPS API, refuse redirects, enforce timeouts and response bounds, and never log tokens or provider response bodies. File writes request Contents write for the exact repository, specify the configured branch, accept an expected file SHA for updates, and return the commit SHA/URL as their receipt. Workflow configuration, secret-like files and path traversal are rejected. There are no automatic write retries; the caller must reconcile an uncertain network outcome before proposing another write.

## Runtime boundary

The adapter is callable by trusted host code only. It does **not** grant arbitrary shell execution, create a coding worker, call the GitHub Actions API, merge to the default branch, deploy software, or register itself as an autonomous planner tool. Existing repository workflows can still run in response to a commit; configure those workflows and their budgets separately before granting autonomous writes. A future connector broker must authenticate the owner/character, reserve a durable request, check the exact granted capability/repository/branch, and apply the configured approval mode before invoking `writeFile`. A successful write receipt can then register a creation; pinning it remains a separate explicit character action. The connected GitHub plugin used by an operator session is separate from Hubert's deployed runtime connection.

Do not report GitHub as connected in the UI merely because a binding file exists. Only a successful probe establishes that the current credentials and selected repository grants work; later failures must be shown to the character owner.

## References

Verified against official GitHub documentation on November 9, 2026:

- [Generate an App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app): RS256, clock-skew allowance and bounded expiry.
- [Generate an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): explicitly restrict repository IDs and permissions instead of inheriting all installation access.
- [Repository contents API](https://docs.github.com/en/rest/repos/contents): read permission for file access and Contents write permission for file commits; updates require the existing file SHA.
