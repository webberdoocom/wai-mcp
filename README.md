# Webberdoo Agent Intelligence MCP

Webberdoo Agent Intelligence (WAI) gives your AI client seven tools for checking UK companies, public websites and blockchain activity. The tools return structured reports with findings and source evidence. MCP stands for Model Context Protocol. Install `@webberdoo/wai-mcp` so your AI client can start the local adapter and send tool requests to WAI over stdio.

**Installation and quotes are free. Payments are OFF by default.** Start by connecting your client, listing the tools and requesting a quote. A completed report purchase costs the USDC amount listed below.

[WAI website](https://wai.webberdoo.com) · [npm package](https://www.npmjs.com/package/@webberdoo/wai-mcp) · [GitHub repository](https://github.com/webberdoocom/wai-mcp) · MCP Registry name `io.github.webberdoocom/wai-mcp`

## 1. Install the package

Install [Node.js](https://nodejs.org/en/download) **20.10 or later** with npm. In PowerShell on Windows or a terminal on macOS or Linux, open the folder where you want to keep the installation and run these commands.

```sh
node --version
npm --version
npm install --prefix ./wai-client @webberdoo/wai-mcp@0.2.2
node -p "require('node:path').resolve('wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs').split(require('node:path').sep).join('/')"
```

Keep the absolute path printed by the last command. The installation is in `wai-client` under the folder you chose.

## 2. Connect your MCP client

Follow the setup for the client you use, then continue to step 3.

### Codex CLI

If needed, [install Codex CLI](https://developers.openai.com/codex/cli) first. Use the same terminal and folder as in step 1. After adding the server, start a fresh Codex session.

**Windows PowerShell**

```powershell
$waiEntry = node -p "require('node:path').resolve('wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs')"
codex mcp add wai-mcp --env WAI_PAYMENT_MODE=off -- node "$waiEntry"
codex mcp list
codex
```

**macOS or Linux**

```sh
wai_entry=$(node -p "require('node:path').resolve('wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs')")
codex mcp add wai-mcp --env WAI_PAYMENT_MODE=off -- node "$wai_entry"
codex mcp list
codex
```

`codex mcp list` confirms that the server is configured. In the interactive session, run `/mcp` to check the connection, then use the discovery prompt in step 3 to verify the tools. If you already have a `wai-mcp` entry, check its launcher with `codex mcp get wai-mcp` and update `command` and `args` in its existing `[mcp_servers.wai-mcp]` block in `~/.codex/config.toml` to use `node` and the v0.2.2 entry path. On Windows, `~` is your user profile. [Codex MCP setup](https://developers.openai.com/codex/mcp) · [Codex slash commands](https://developers.openai.com/codex/cli/slash-commands)

### Claude Desktop

1. In Claude Desktop, open **Settings → Developer → Edit Config**. Use the `claude_desktop_config.json` file the app opens. Its usual location is `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `~/.config/Claude/claude_desktop_config.json` on Linux.
2. Add the `wai-mcp` entry from the JSON below. Replace the example argument with the absolute path printed in step 1. On Windows, the printed forward-slash path works in JSON. On macOS and Linux, use the full path beginning with `/`. If your file already has a `mcpServers` object, add the entry to that object.
3. Save, fully quit Claude Desktop and reopen it. Open **Connectors → Manage connectors** and check that `wai-mcp` is connected, then run the discovery prompt in the next section. [Claude Desktop local MCP setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

```json
{
  "mcpServers": {
    "wai-mcp": {
      "command": "node",
      "args": ["C:/path/to/wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs"],
      "env": {
        "WAI_PAYMENT_MODE": "off"
      }
    }
  }
}
```

### Cursor

1. Open `~/.cursor/mcp.json` for all projects or `.cursor/mcp.json` in the project for a project-specific connection. Create the file if needed.
2. Add the JSON entry shown for Claude Desktop, with your absolute installed entry path. In the `wai-mcp` entry, add `"type": "stdio",` on a new line before `"command"`.
3. Save the configuration, then check that `wai-mcp` is enabled in Cursor's MCP settings. In Agent, use the discovery prompt below. [Cursor MCP configuration](https://cursor.com/docs/mcp)

For another MCP client with local **stdio** support, set its server name to `wai-mcp`, its command to `node`, its single argument to the absolute `bin/wai-mcp.mjs` path, and its environment to `WAI_PAYMENT_MODE=off`.

## 3. Discover and verify all seven tools

Copy this prompt into your connected client.

> Use the connected wai-mcp MCP server, not web search, to list all seven available intelligence tools. Explain what each tool does, its price in USDC, and its required input parameters. Use only the MCP tool definitions. Do not purchase reports or execute paid tools.

Compare the result with the table below. In v0.2.2, all seven appear in the first tool list by default. If the agent cannot read tool definitions directly, use the client's tool inventory. A valid live catalogue is required when calling DEX, even when the tool is already visible.

## 4. Choose a service

Use these prompts as starting points. Replace any bracketed address with the actual `0x` address you want to check. With payments off, calling a tool gives you a free quote.

| Service | MCP tool | Price (USDC) | Required inputs | Example customer request |
|---|---|---:|---|---|
| Company Verification | `verify_uk_company` | 0.01 | `companyNumber` | Use WAI Company Verification to check the Companies House registration for company 00000006. |
| Company Due Diligence | `investigate_uk_company` | 0.03 | `companyNumber` | Use WAI Company Due Diligence to review the profile, officers, significant control and filings for company 00000006. |
| Business Insolvency Intelligence | `inspect_uk_business_insolvency` | 0.03 | `companyNumber` | Use WAI to check whether Companies House records insolvency cases for company 00000006. |
| Website Trust & Risk Intelligence | `inspect_website_trust` | 0.02 | `domain` | Use WAI Website Trust to check the DNS, TLS and HTTPS security headers for iana.org. |
| Smart Contract Intelligence | `inspect_smart_contract` | 0.03 | `chainId`, `contractAddress` | Use WAI Smart Contract Intelligence to inspect contract [CONTRACT_ADDRESS] on Base, chain ID 8453. |
| Token Allowance Intelligence | `check_token_allowance` | 0.02 | `chainId`, `ownerAddress`, `tokenAddress`, `spenderAddress` | Use WAI to check how much [SPENDER_ADDRESS] can spend of [TOKEN_ADDRESS] belonging to [OWNER_ADDRESS] on Base, including Permit2. |
| DEX Liquidity Intelligence | `wai_dex_liquidity` | 0.02 | `chainId`, `protocol`, `tokenIn` and either `poolAddress` or `tokenOut` plus the protocol's pair selectors | Use WAI DEX Liquidity to estimate swap depth on Base Uniswap v3 from [TOKEN_IN_ADDRESS] to [TOKEN_OUT_ADDRESS] at fee tier 500 for trade sizes of 1 and 10 input tokens. |

- **Company tools:** Supply the Companies House number as text, preserving leading zeros. Lettered numbers such as `SC001000` are supported.
- **Website:** Supply a public hostname such as `iana.org`, without a scheme, port or path.
- **Contract and allowance:** Use integer `chainId` `8453` for Base or `84532` for Base Sepolia, with nonzero EVM addresses. For allowance, `includePermit2` is an optional boolean. The requested chain is the report target. WAI payment always uses Base Mainnet.
- **DEX:** Use integer `chainId: 8453`. In pool mode, give `poolAddress` with `tokenIn` and omit `tokenOut` and pair selectors. In token-pair mode, give `tokenOut` and the selectors below. Optional `tradeSizes` takes one to five distinct positive decimal strings in input-token units, for example `["1", "10"]`. If omitted, the documented defaults are `["0.01", "1", "100"]`. Protocol availability depends on the live WAI service.

| DEX `protocol` | Required token-pair selectors besides `tokenOut` |
|---|---|
| `uniswap-v2`, `sushiswap-v2` | None |
| `uniswap-v3`, `pancakeswap-v3`, `sushiswap-v3` | `fee` (integer) |
| `uniswap-v4` | `fee` and `tickSpacing` (integers). Use token-pair mode. |
| `aerodrome-classic` | `stable` (boolean) |
| `aerodrome-slipstream` | `tickSpacing` (integer) |

WAI's findings are evidence for decision-making. Website Trust covers observable configuration, Smart Contract Intelligence covers available on-chain evidence, and Insolvency covers available official records.

## 5. Try a free Company Verification quote

Keep `WAI_PAYMENT_MODE=off` and paste this into your client.

> Use wai-mcp to call verify_uk_company with companyNumber "00000006". Show me the quote only.

If your client asks for tool permission, approve the quote call. The adapter makes an unsigned request and translates WAI's HTTP 402 challenge into a tool result like this.

```json
{
  "status": "payment_required",
  "service": "verify_uk_company",
  "network": "eip155:8453",
  "priceUSDC": 0.01
}
```

The response may include a note explaining how to opt in. You have a price and network quote at this point. A wallet is only needed to purchase a report.

## 6. Enable paid reports when you are ready

1. Create a dedicated EVM buyer wallet and fund it with a small amount of **USDC on Base Mainnet** (`eip155:8453`).
2. Use your client's secure secret injection, if available, to supply `WAI_EVM_PRIVATE_KEY` to the local MCP process. It expects a `0x`-prefixed 32-byte EVM key. Keep the key out of chat, shell history, shared settings and source control. If you cannot inject it securely, keep payments off.
3. Set your spending limits. Optionally set `WAI_EXPECTED_PAY_TO` to an independently verified WAI receiving address. To approve DEX purchases, include `dex-liquidity` in the comma-separated `WAI_DYNAMIC_PAID_ALLOWLIST`. That allowlist entry is a service ID. DEX quotes work without it.
4. Set `WAI_PAYMENT_MODE=on` in the MCP process's environment and restart the server through your client. **With payments on, a tool call can spend real USDC without a separate WAI confirmation.** Set the mode back to `off` and restart to return to quotes only.

| MCP server environment setting | Default | Effect |
|---|---|---|
| `WAI_MAX_PER_CALL_USDC` | `0.03` | Maximum charge for one call |
| `WAI_MAX_SESSION_USDC` | `0.10` | Total cap for one running MCP process. It must cover the per-call limit. Restarting resets the budget. |
| `WAI_NETWORK` | `eip155:8453` | Payment network. The client accepts Base Mainnet only. |

In Codex CLI, settings such as payment mode and spending limits belong in the existing `[mcp_servers.wai-mcp.env]` table in `~/.codex/config.toml`. If a secret manager supplies `WAI_EVM_PRIVATE_KEY` to the process launching Codex, include its variable name in `env_vars = ["WAI_EVM_PRIVATE_KEY"]` under `[mcp_servers.wai-mcp]`, before the `.env` table. Add it to the list if `env_vars` already exists. For the JSON-based clients above, put non-secret settings such as payment mode in the server's `env` object. [Codex environment forwarding](https://developers.openai.com/codex/mcp)

For a session capped at one 0.01 USDC verification, set both spending limits to `0.01`. Concurrent calls share the same reservation budget.

In x402, WAI first returns a quote. The adapter checks the amount against the service's price ceiling and your limits, verifies Base Mainnet USDC and checks the recipient if pinned. If payment is enabled and the terms still match on recheck, the adapter signs a payment authorization locally and sends one signed request. WAI handles settlement and report delivery. The adapter requires a successful settlement receipt and a complete report before returning a successful purchase.

| Result | What it means |
|---|---|
| `payment_required` | A free quote is available. This response has no report. Check payment mode and the DEX allowlist if you intended to buy. |
| `ok` with `settlementStatus: confirmed` | Settlement is confirmed and the report is in `response`. The result includes a transaction hash. |
| `payment_failed` | WAI reported an explicit settlement failure. |
| `payment_uncertain` | Settlement is pending or could not be confirmed. Check the wallet or purchase records before placing another order. |
| `report_failed` | WAI did not deliver a complete report. A charge may already have settled. Use the request, report or transaction reference when present to check the original purchase. |

The adapter keeps its spending reservation after an uncertain or failed attempt and sends no automatic payment retry.

## 7. Find your report

- **In your client:** The MCP result includes the report in `response`. When WAI provides a signed download link, look for `response.download.url` and its `expiresAt`. Use the link while it is valid to retrieve the existing report without another purchase. Look in your browser’s Downloads history for a file you downloaded manually. Treat the link and report as private.
- **On disk:** Saving is on by default for successfully delivered paid reports. Open the absolute path in `localFile`. The default folder is `reports/` under the MCP process's working directory, which can differ from your chat workspace or installation folder. The adapter creates it on the first successful save.
- **Choose a private folder:** Set `WAI_REPORT_DIR` in the MCP server's environment to an absolute path, for example `C:/Users/your-name/WAIReports` on Windows, `/Users/your-name/WAIReports` on macOS or `/home/your-name/WAIReports` on Linux. Set `WAI_SAVE_REPORTS=false` to disable local saving, even with a custom folder. Add these settings to the same Codex `.env` table or JSON `env` object used for payment mode, then restart the MCP server.

Files are named `wai-<service-id>-<report-id>.json`. Existing files stay intact. Local copies omit signed download links and payment credentials. Keep reports in a folder with private OS permissions, outside shared or synced directories. If writing fails, `localFileError` explains the local problem and the agent still receives the report.

## Troubleshooting

| Symptom | What to check |
|---|---|
| MCP fails to connect or reports `ENOENT` | Check that your JSON is valid, that the installed `bin/wai-mcp.mjs` path exists and that your client can find Node. Run `where.exe node` on Windows or `command -v node` on macOS/Linux. Use the full executable path as the command if needed. Restart the client and check its MCP logs. |
| Six tools appear or DEX is missing | Verify that the client is starting v0.2.2. For a prefix install, run `npm ls --prefix ./wai-client @webberdoo/wai-mcp --depth=0`. Check that `WAI_DYNAMIC_DISCOVERY` is unset or enabled. Setting it to `off` exposes the six original tools. Check any tool filters in the client and start a fresh session after changing the configuration. |
| npm or npx cannot resolve the package, or an older copy starts | Check the exact package and version with `npm view @webberdoo/wai-mcp@0.2.2 version`. Run `npm cache verify` if npm reports cache trouble. Rerun the pinned install in step 1 and point your client at the installed absolute entry path to bypass an npx launcher. If npm returns `E404`, check the package spelling and registry before retrying. |
| DEX is listed but returns a catalogue availability error | The tool is visible at startup. Calls depend on a compatible live WAI catalogue, fetched at startup and refreshed every five minutes. Check whether the MCP process can reach `wai.webberdoo.com` over HTTPS and review its logs. A failed catalogue check stops the DEX call before a payment attempt. |
| The tool returns `payment_required` | With payments off, this is the expected free quote. For an intended purchase, check whether the MCP process was restarted with `WAI_PAYMENT_MODE=on` and whether `dex-liquidity` is allowlisted for DEX. |
| Paid mode fails to start or the quote is refused | Check secure wallet injection, Base Mainnet USDC funding, the spending limits and the independently verified recipient if you pinned one. |
| A paid call times out or a report file is missing | Check the settlement and request or transaction references before placing another order. If the client delivered the report, check `localFile`, `localFileError`, `WAI_SAVE_REPORTS`, the configured path or process working directory, and OS permissions. |

## FAQ

**Do I need to know WAI REST endpoints?**

No. Give your MCP client the service name or MCP tool name and your inputs. For example, `verify_uk_company` is an MCP tool name. The adapter handles the underlying WAI REST request to `/api/v1/intelligence/company-verification`.

**Will my AI automatically use WAI for general questions?**

Tool selection depends on the AI client, its settings and the tools available in that session. Ask for the connected `wai-mcp` server and the specific service when you want WAI to handle a request. Check that the client shows a WAI tool call if you expect a WAI quote or report.

**Does listing tools cost anything?**

Tool discovery reads descriptions and schemas. A quote is also free with payments off. A successful purchase delivers the paid intelligence report.

## Development

For a source checkout, run `npm ci` and use the absolute path to its `bin/wai-mcp.mjs` as the client argument. Run `npm run test:release` for unit, stdio and package checks and `npm run test:tarball` for an isolated npm install. See the [MIT licence](LICENSE).
