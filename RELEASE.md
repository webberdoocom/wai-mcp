# Publishing WAI MCP 0.1.0

Run these PowerShell commands from the project root. The confirmed GitHub account is `webberdoocom` and the repository is `https://github.com/webberdoocom/wai-mcp`. The confirmed npm account is `webberdoo` and the package is `@webberdoo/wai-mcp`. The MCP Registry name is `io.github.webberdoocom/wai-mcp`.

## Local checks

Install Git, Node.js with npm, Gitleaks and the official MCP Publisher. The GitHub CLI is needed for the publication steps. Use an empty destination repository or let the command below create it. The first release starts from an empty local Git history.

```powershell
npm ci --ignore-scripts
npm audit --omit=dev
npm run test:release
node test/sdk-runtime.mjs
node test/offline-real-sdk-payment.mjs
node test/mcp-tool-call.mjs
npm run test:tarball
mcp-publisher validate
npm pack --ignore-scripts
tar -tf webberdoo-wai-mcp-0.1.0.tgz
Get-FileHash webberdoo-wai-mcp-0.1.0.tgz
git status --short --untracked-files=all
```

The release contains exactly 15 entries. The two PowerShell launchers and their two Node helpers are intentional. The npm file allowlist excludes local settings, reports and development material. Keep the lockfile in Git. Earlier phase notes remain local. Review every staged path before creating the first commit.

## Publication after explicit approval

Stop on any failed check or unexpected account, path or version. Configure Git's author name and email for the public commit. Authenticate the GitHub CLI as `webberdoocom` with repository creation and release rights. For interactive npm publication, use the verified npm account `webberdoo` with scope write access and two-factor authentication. The Registry uses GitHub device login for the chosen namespace and checks the public npm package's `mcpName`. [npm publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) and [Registry publishing](https://modelcontextprotocol.io/registry/quickstart)

```powershell
git add -- .gitignore LICENSE README.md RELEASE.md RUN-PHASE5.ps1 RUN-PHASE6.ps1 bin dist examples package-lock.json package.json server.json src test
git diff --cached --name-only
git diff --cached --check
git diff --cached | gitleaks stdin --redact --no-banner
```

After reviewing the staged files, publish the source and tag.

```powershell
git commit -m "Release Webberdoo WAI MCP 0.1.0"
gitleaks git --redact --no-banner .
gh auth login
gh api user --jq .login
gh repo create webberdoocom/wai-mcp --public --source=. --remote=origin --push
git tag -a v0.1.0 -m "WAI MCP 0.1.0"
git push origin v0.1.0
```

Publish the inspected archive, check its public metadata and submit the manifest. Complete each login interactively.

```powershell
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish ./webberdoo-wai-mcp-0.1.0.tgz --access public --registry=https://registry.npmjs.org/
npm view @webberdoo/wai-mcp@0.1.0 version mcpName dist.integrity --registry=https://registry.npmjs.org/
mcp-publisher login github
mcp-publisher publish
Invoke-RestMethod 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.webberdoocom%2Fwai-mcp/versions/0.1.0'
gh release create v0.1.0 --verify-tag --repo webberdoocom/wai-mcp --title "Webberdoo WAI MCP 0.1.0" --notes "First public release. Four WAI intelligence tools for local MCP clients, with opt-in Base Mainnet USDC payments and per-process spending limits."
```
