# Webberdoo Agent Intelligence MCP

Connect a local MCP client to Webberdoo's intelligence services over stdio. The MCP software is free to install and run. Requesting a quote is free. Completed intelligence purchases cost the USDC amounts below. Payments are opt-in and use Base Mainnet USDC (`eip155:8453`).

| Service | MCP tool | Inputs | USDC |
|---|---|---|---:|
| Company Verification | `verify_uk_company` | Companies House `companyNumber` | 0.01 |
| Company Due Diligence | `investigate_uk_company` | Companies House `companyNumber` | 0.03 |
| Smart Contract Intelligence | `inspect_smart_contract` | `chainId`, `contractAddress` | 0.03 |
| Token Allowance Intelligence | `check_token_allowance` | `chainId`, `ownerAddress`, `tokenAddress`, `spenderAddress`, optional `includePermit2` | 0.02 |
| Business Insolvency Intelligence | `inspect_uk_business_insolvency` | Companies House `companyNumber` | 0.03 |
| Website Trust & Risk Intelligence | `inspect_website_trust` | Public `domain` | 0.02 |
| DEX Liquidity Intelligence | `wai_dex_liquidity` | `chainId`, `protocol`, `tokenIn`, and a pool address or token pair with protocol-specific inputs | 0.02 |

Companies House numbers can include letters, for example `SC001000`. Smart Contract and Token Allowance use integer chain IDs `8453` (Base) or `84532` (Base Sepolia) and nonzero EVM addresses. DEX analyses target Base (`8453`). Submit either `poolAddress` or `tokenOut` with the selectors required by the protocol. Uniswap v4 uses token-pair mode. The MCP tool schema describes the selectors and optional `tradeSizes`.

Source repository: [webberdoocom/wai-mcp](https://github.com/webberdoocom/wai-mcp). npm package: `@webberdoo/wai-mcp`, under npm user `webberdoo`. MCP Registry name: `io.github.webberdoocom/wai-mcp`.

## Getting Started in 5 Minutes

### 1. Install from npm

Install Node.js 20.10 or later with npm. Open a terminal in the folder where you want to keep the installation. Once the package is published, run:

```sh
node --version
npm --version
npm install --prefix ./wai-client @webberdoo/wai-mcp@0.2.0
node -p "require('node:path').resolve('wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs').split(require('node:path').sep).join('/')"
```

Copy the absolute path printed by the last command. Use it in your client configuration below. If you're working from a source checkout, run `npm ci` in the checkout and use the absolute path to its `bin/wai-mcp.mjs` instead.

### 2. Connect your MCP client

**Claude Desktop on Windows, macOS or Linux**. In the desktop app, open **Settings → Developer → Edit Config**. This opens or creates `claude_desktop_config.json`. Use the file opened by the app. These are the usual locations. [Claude Desktop setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

| Platform | Configuration file |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Use this JSON for a new configuration. If you already have a configuration, add the `wai` entry inside your existing `mcpServers` object. Replace the example argument with the absolute path you copied. Use forward slashes on Windows, or escape backslashes as `\\` in JSON. On macOS or Linux, use the full path beginning with `/`.

```json
{
  "mcpServers": {
    "wai": {
      "command": "node",
      "args": ["C:/path/to/wai-client/node_modules/@webberdoo/wai-mcp/bin/wai-mcp.mjs"],
      "env": { "WAI_PAYMENT_MODE": "off", "WAI_SAVE_REPORTS": "true" }
    }
  }
}
```

Save the file, fully quit Claude Desktop and reopen it. Open **Connectors → Manage connectors**, then select `wai` to view its tools.

**Cursor**. Use the same JSON in `~/.cursor/mcp.json` for all projects or `.cursor/mcp.json` for one project. In the `wai` entry, add `"type": "stdio",` immediately before the `"command"` line. Save, then find and enable `wai` in Cursor's MCP settings. [Cursor MCP configuration](https://cursor.com/docs/mcp)

**Other compatible clients**. Add a local server with the **stdio** transport. Set the executable to `node`, pass the full path to `bin/wai-mcp.mjs` as the only argument, and set `WAI_PAYMENT_MODE` to `off` in the server's environment. The client starts the local process and lists its tools.

### 3. Discover the tools and request a free quote

Open your client's tools list for `wai`. Six tools are available at startup. `wai_dex_liquidity` appears after the first successful catalogue fetch. The table above shows each tool's inputs and price.

For your first call, ask your client to run `verify_uk_company` with `{"companyNumber":"00000006"}` and show the quote. Approve the tool call if your client prompts you. With payments off, the adapter makes an unsigned request to WAI. WAI responds with HTTP 402 (Payment Required), and the client receives a JSON tool result with `status: payment_required`, `network: eip155:8453` and `priceUSDC: 0.01`. No wallet is needed to receive that quote. [WAI service](https://wai.webberdoo.com)

## Payments and reports (optional)

1. Create a dedicated EVM buyer wallet and fund it with a small amount of USDC on Base Mainnet (`eip155:8453`).
2. Use your client's secure secret injection, if available, to give the local WAI process `WAI_EVM_PRIVATE_KEY`. It expects a `0x`-prefixed, 32-byte EVM private key. **Never share or commit your private key.** Keep it out of chat, shell history and shared client settings. If your client cannot inject it securely, keep payments off.
3. Set your spending limits and optionally pin the recipient with `WAI_EXPECTED_PAY_TO` using an independently verified WAI receiving address. When ready to authorize purchases, change `WAI_PAYMENT_MODE` from `off` to `on` and restart the server through your client. **With payments on, a tool call can spend real USDC without another prompt from WAI MCP.** Set the mode to `off` and restart to return to quotes only.

`WAI_MAX_PER_CALL_USDC` defaults to `0.03`. `WAI_MAX_SESSION_USDC` defaults to `0.10` and must cover the per-call limit. The adapter checks the service price ceiling, network, token and spending limits before signing. Concurrent calls share a reservation budget within one server process. Restarting the MCP process resets its budget. For a session capped at one 0.01 USDC verification, set both variables to `0.01` in the server's environment. A successful paid result includes `settlementStatus: confirmed` and a transaction hash. An explicit rejection returns `payment_failed`. Pending or unconfirmed settlement returns `payment_uncertain`. A failed or incomplete report after a charge returns `report_failed` and includes the backend request or report ID when available. The adapter keeps the spending reservation and sends no automatic payment retry. Use the available reference to check your wallet or purchase records before placing another order.

The adapter refreshes the WAI service catalogue every five minutes. Set `WAI_DYNAMIC_DISCOVERY=off` to expose only the six built-in tools. Add `dex-liquidity` to the comma-separated `WAI_DYNAMIC_PAID_ALLOWLIST` to enable paid DEX calls. Without that entry, the DEX tool can still return quotes.

The client automatically saves each successfully delivered paid report to `reports/` under the **MCP process's working directory**. When you run `npm start` from a checkout, the folder is `reports/` in that checkout. With a desktop or npm-launched host, it is the directory that host starts the MCP process in. The client creates the folder on the first successful save.

Set `WAI_REPORT_DIR` in the MCP server's environment to an absolute path to choose a private directory. Set `WAI_SAVE_REPORTS` to `false` to disable saving, including when a custom directory is configured. The `true` setting in the example is optional. Restart the MCP process after changing these settings.

Files use `wai-<service-id>-<report-id>.json`, and existing files are left intact. The result includes `localFile` after a save or `localFileError` when writing fails. The agent still receives the report if writing fails. Local copies omit signed download links and payment credentials. Restrict access to the folder with your OS permissions and keep it outside shared or synced directories.

## Troubleshooting

| Symptom | What to check |
|---|---|
| npm reports `E404` | Check the scope and package spelling. The npm command works once version `0.2.0` is public. Before publication, use the source checkout instructions. |
| The client cannot find Node (`ENOENT`) | Find Node with `where.exe node` on Windows or `command -v node` on macOS or Linux. Use the full executable path in `command`. |
| The server fails to start or the tools are missing | Confirm the JSON is valid, the entry path exists, and it points to the installed `bin/wai-mcp.mjs`. Fully restart the client and check its MCP logs. |
| You receive a `payment_required` result | This is the expected quote with payments off. Review the price and network before choosing whether to enable purchases. |
| Paid mode fails to start or the quote is refused | Check that the server received the dedicated buyer key securely, the network is Base Mainnet, the wallet has Base Mainnet USDC, and the quote fits both limits. If you pinned the receiver, verify the address independently. |
| A paid call times out or a report file is missing | Check the tool result and settlement before retrying. If the purchase succeeded, check `localFile` or `localFileError` in the result, the process working directory, any `WAI_REPORT_DIR` override, and directory permissions. |

## Development

Run `npm run test:release` for the unit, stdio and package checks and `npm run test:tarball` for an isolated npm install. The MIT licence is in LICENSE.
