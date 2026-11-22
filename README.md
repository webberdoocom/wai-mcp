# Webberdoo Agent Intelligence MCP

Connect a local MCP client to Webberdoo's intelligence services over stdio. The MCP software is free to install and run. Requesting a quote is free. Completed intelligence purchases cost the USDC amounts below. Payments are opt-in and use Base Mainnet USDC (`eip155:8453`).

| Service | MCP tool | Inputs | USDC |
|---|---|---|---:|
| Company Verification | `verify_uk_company` | Eight-digit `companyNumber` | 0.01 |
| Company Due Diligence | `investigate_uk_company` | Eight-digit `companyNumber` | 0.03 |
| Smart Contract Intelligence | `inspect_smart_contract` | `chainId`, `contractAddress` | 0.03 |
| Token Allowance Intelligence | `check_token_allowance` | `chainId`, `ownerAddress`, `tokenAddress`, `spenderAddress`, optional `includePermit2` | 0.02 |

Source repository: [webberdoocom/wai-mcp](https://github.com/webberdoocom/wai-mcp). npm package: `@webberdoo/wai-mcp`, under npm user `webberdoo`. MCP Registry name: `io.github.webberdoocom/wai-mcp`.

## Getting Started in 5 Minutes

### 1. Install from npm

Install Node.js 20.10 or later with npm. Open a terminal in the folder where you want to keep the installation. Once the package is published, run:

```sh
node --version
npm --version
npm install --prefix ./wai-client @webberdoo/wai-mcp@0.1.0
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
      "env": { "WAI_PAYMENT_MODE": "off" }
    }
  }
}
```

Save the file, fully quit Claude Desktop and reopen it. Open **Connectors → Manage connectors**, then select `wai` to view its tools.

**Cursor**. Use the same JSON in `~/.cursor/mcp.json` for all projects or `.cursor/mcp.json` for one project. In the `wai` entry, add `"type": "stdio",` immediately before the `"command"` line. Save, then find and enable `wai` in Cursor's MCP settings. [Cursor MCP configuration](https://cursor.com/docs/mcp)

**Other compatible clients**. Add a local server with the **stdio** transport. Set the executable to `node`, pass the full path to `bin/wai-mcp.mjs` as the only argument, and set `WAI_PAYMENT_MODE` to `off` in the server's environment. The client starts the local process and lists its tools.

### 3. Discover the tools and request a free quote

Open your client's tools list for `wai`. Look for `verify_uk_company`, `investigate_uk_company`, `inspect_smart_contract` and `check_token_allowance`. The table above shows their inputs and prices.

For your first call, ask your client to run `verify_uk_company` with `{"companyNumber":"00000006"}` and show the quote. Approve the tool call if your client prompts you. With payments off, the adapter makes an unsigned request to WAI. WAI responds with HTTP 402 (Payment Required), and the client receives a JSON tool result with `status: payment_required`, `network: eip155:8453` and `priceUSDC: 0.01`. No wallet is needed to receive that quote. [WAI service](https://wai.webberdoo.com)

## Payments and reports (optional)

1. Create a dedicated EVM buyer wallet and fund it with a small amount of USDC on Base Mainnet (`eip155:8453`).
2. Use your client's secure secret injection, if available, to give the local WAI process `WAI_EVM_PRIVATE_KEY`. It expects a `0x`-prefixed, 32-byte EVM private key. **Never share or commit your private key.** Keep it out of chat, shell history and shared client settings. If your client cannot inject it securely, keep payments off.
3. Set your spending limits and optionally pin the recipient with `WAI_EXPECTED_PAY_TO` using an independently verified WAI receiving address. When ready to authorize purchases, change `WAI_PAYMENT_MODE` from `off` to `on` and restart the server through your client. **With payments on, a tool call can spend real USDC without another prompt from WAI MCP.** Set the mode to `off` and restart to return to quotes only.

`WAI_MAX_PER_CALL_USDC` defaults to `0.03`. `WAI_MAX_SESSION_USDC` defaults to `0.10` and must cover the per-call limit. The adapter checks the service price ceiling, network, token and spending limits before signing. Concurrent calls share a reservation budget within one server process. Restarting the MCP process resets its budget. For a session capped at one 0.01 USDC verification, set both variables to `0.01` in the server's environment. Check settlement before retrying an uncertain purchase.

The adapter refreshes the WAI service catalogue every five minutes. Set `WAI_DYNAMIC_DISCOVERY=off` to expose only the four built-in tools. Additional services need explicit IDs in the comma-separated `WAI_DYNAMIC_PAID_ALLOWLIST` before they can spend.

Set `WAI_REPORT_DIR` to an absolute path to a private local directory to save successful purchases as JSON. Use a folder outside source checkouts and shared or synced folders. Restrict access with your operating system’s folder permissions. Local saving is off when this setting is unset. The saved file omits download credentials. Treat report data and signed links returned to your client as private.

On Windows, `RUN-PHASE5.ps1` authorizes one Company Verification purchase. `RUN-PHASE6.ps1 -Service <tool-name>` handles one of the other three tools. Both prompt for confirmation, the verified recipient and a hidden buyer key, and cap spending at the selected price. Installation and release checks do not require either launcher.

## Troubleshooting

| Symptom | What to check |
|---|---|
| npm reports `E404` | Check the scope and package spelling. The npm command works once version `0.1.0` is public. Before publication, use the source checkout instructions. |
| The client cannot find Node (`ENOENT`) | Find Node with `where.exe node` on Windows or `command -v node` on macOS or Linux. Use the full executable path in `command`. |
| The server fails to start or the tools are missing | Confirm the JSON is valid, the entry path exists, and it points to the installed `bin/wai-mcp.mjs`. Fully restart the client and check its MCP logs. |
| You receive a `payment_required` result | This is the expected quote with payments off. Review the price and network before choosing whether to enable purchases. |
| Paid mode fails to start or the quote is refused | Check that the server received the dedicated buyer key securely, the network is Base Mainnet, the wallet has Base Mainnet USDC, and the quote fits both limits. If you pinned the receiver, verify the address independently. |
| A paid call times out or a report file is missing | Check the tool result and settlement before retrying. If the purchase succeeded, check `WAI_REPORT_DIR`, its permissions and any `localFileError` in the result. |

## Development

Run `npm run test:release` for the unit, stdio and package checks and `npm run test:tarball` for an isolated npm install. The MIT licence is in LICENSE.
