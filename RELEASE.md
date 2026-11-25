# Publishing WAI MCP 0.2.0

The release serves seven intelligence tools over MCP stdio. Six are built in, and DEX Liquidity Intelligence is discovered from the WAI service catalogue. The [README](README.md) lists all seven tools, their prices and the Node.js 20.10+ installation steps. After npm publication, install with `npm install --prefix ./wai-client @webberdoo/wai-mcp@0.2.0` and use the installed `bin/wai-mcp.mjs` entry point.

## Verify the candidate

Run these commands in PowerShell from the project root.

```powershell
npm ci --ignore-scripts
npm audit --omit=dev
npm run test:release
npm run test:tarball
mcp-publisher validate
npm pack --ignore-scripts
tar -tf webberdoo-wai-mcp-0.2.0.tgz
Get-FileHash webberdoo-wai-mcp-0.2.0.tgz
git status --short --untracked-files=all
git diff --cached --check
```

The npm archive has 11 entries. Review the tarball and the intended staged files for credentials and local data. Keep the lockfile in Git and keep live-payment utilities local. The release checks use offline payment mocks and never send a paid request.

## Publish the verified release

Publish the inspected archive to npm as `@webberdoo/wai-mcp@0.2.0`. Check the public version, integrity and `mcpName` before submitting `server.json` to the Official MCP Registry as `io.github.webberdoocom/wai-mcp`. Authenticate the Registry publisher as `webberdoocom`. Publish the reviewed source and tag `v0.2.0` from `webberdoocom/wai-mcp`. [npm publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) · [MCP Registry publishing](https://modelcontextprotocol.io/registry/quickstart)

```powershell
npm publish ./webberdoo-wai-mcp-0.2.0.tgz --access public --registry=https://registry.npmjs.org/
npm view @webberdoo/wai-mcp@0.2.0 version mcpName dist.integrity --registry=https://registry.npmjs.org/
mcp-publisher login github
mcp-publisher publish
```
