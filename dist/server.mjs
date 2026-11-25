#!/usr/bin/env node
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { makeRunner, toMcpResult } from '../src/runner.mjs';
import { VERSION } from '../src/core.mjs';
import { DEX_INPUT_SCHEMA, DEX_PRICE_CENTS, DEX_TOOL_NAME, fetchCatalog } from '../src/discovery.mjs';
const runner = makeRunner();
const address = z.string().regex(/^0x(?!0{40}$)[a-fA-F0-9]{40}$/, 'Must be a nonzero EVM address');
const chainId = z.literal([8453, 84532]);
const company = z.string().regex(/^(?:[0-9]{8}|[A-Za-z]{2}[0-9]{6}|[A-Za-z]{2}[0-9]{5}[A-Za-z])$/, 'Invalid Companies House number');
const serverFactory = () => {
    const server = new McpServer({ name: 'webberdoo-agent-intelligence', version: VERSION });
    server.registerTool('verify_uk_company', {
        description: 'Paid WAI UK company verification ($0.01 USDC); checks company registration evidence. Caller-controlled payments only.',
        inputSchema: z.object({ companyNumber: company }),
    }, toMcpResult(({ companyNumber }) => runner.run('verify_uk_company', { companyNumber })));
    server.registerTool('investigate_uk_company', {
        description: 'Paid WAI UK company due diligence ($0.03 USDC); structured evidence, not a guarantee of creditworthiness.',
        inputSchema: z.object({ companyNumber: company }),
    }, toMcpResult(({ companyNumber }) => runner.run('investigate_uk_company', { companyNumber })));
    server.registerTool('inspect_smart_contract', {
        description: 'Paid WAI smart contract intelligence ($0.03 USDC); evidence-backed observations, not a security audit.',
        inputSchema: z.object({ chainId, contractAddress: address }),
    }, toMcpResult(({ chainId, contractAddress }) => runner.run('inspect_smart_contract', { chainId, contractAddress })));
    server.registerTool('check_token_allowance', {
        description: 'Paid WAI token allowance intelligence ($0.02 USDC); inspect ERC-20 allowances, optionally Permit2.',
        inputSchema: z.object({ chainId, ownerAddress: address, tokenAddress: address, spenderAddress: address, includePermit2: z.boolean().optional() }),
    }, toMcpResult(({ chainId, ownerAddress, tokenAddress, spenderAddress, includePermit2 }) => runner.run('check_token_allowance', { chainId, ownerAddress, tokenAddress, spenderAddress, ...(includePermit2 === undefined ? {} : { includePermit2 }) })));
    server.registerTool('inspect_uk_business_insolvency', {
        description: 'Paid WAI UK business insolvency intelligence ($0.03 USDC); official Companies House record observations, not a solvency prediction.',
        inputSchema: z.object({ companyNumber: company }),
    }, toMcpResult(({ companyNumber }) => runner.run('inspect_uk_business_insolvency', { companyNumber })));
    server.registerTool('inspect_website_trust', {
        description: 'Paid WAI website configuration intelligence ($0.02 USDC); DNS, TLS and HTTPS headers, not a malware or legitimacy verdict.',
        inputSchema: z.object({ domain: z.string().min(4).max(253).regex(/^(?=.{4,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/, 'Public DNS hostname required') }),
    }, toMcpResult(({ domain }) => runner.run('inspect_website_trust', { domain })));
    if (process.env.WAI_DYNAMIC_DISCOVERY !== 'off') {
        let catalogue;
        server.registerTool(DEX_TOOL_NAME, {
            description: `WAI discovery: Base Mainnet pool identity, on-chain liquidity, available LP evidence and single-pool swap depth estimates. Price: $${(DEX_PRICE_CENTS / 100).toFixed(2)} USDC. New service payments require explicit local allowlisting.`,
            inputSchema: fromJsonSchema(DEX_INPUT_SCHEMA),
        }, toMcpResult(async (args) => {
            // The tool is always listed when discovery is enabled. Execution uses the
            // current fetch, including a failed refresh, before making any WAI POST.
            const spec = await catalogue.then(services => services.get(DEX_TOOL_NAME), () => undefined);
            if (!spec)
                throw new Error('DEX Liquidity Intelligence is unavailable because the live WAI catalogue could not be validated. No payment was attempted.');
            return runner.runDynamic(spec, args);
        }));
        const installed = new Map();
        const schemaFor = (spec) => {
            const shape = {};
            for (const [field, rule] of Object.entries(spec.fields)) {
                let value;
                if (rule.type === 'string')
                    value = z.string().max(512);
                else if (rule.type === 'boolean')
                    value = z.boolean();
                else if (rule.type === 'integer')
                    value = z.number().int().refine(Number.isSafeInteger);
                else
                    value = z.number().finite();
                if (rule.enum)
                    value = value.refine((v) => rule.enum.includes(v));
                if (rule.pattern)
                    value = value.refine((v) => new RegExp(rule.pattern).test(v));
                shape[field] = spec.required.includes(field) ? value : value.optional();
            }
            return z.object(shape).strict();
        };
        const refresh = async () => {
            catalogue = fetchCatalog(runner.config.base);
            try {
                const next = await catalogue;
                for (const [name, old] of installed) {
                    if (!next.has(name) || JSON.stringify(next.get(name)) !== old.signature) {
                        old.handle.remove();
                        installed.delete(name);
                    }
                }
                for (const [name, spec] of next) {
                    if (name === DEX_TOOL_NAME || installed.has(name))
                        continue;
                    const handle = server.registerTool(name, {
                        description: `WAI discovery: ${spec.description} Price: $${(spec.cents / 100).toFixed(2)} USDC. New service payments require explicit local allowlisting.`,
                        inputSchema: schemaFor(spec),
                    }, toMcpResult((args) => runner.runDynamic(spec, args)));
                    installed.set(name, { handle, signature: JSON.stringify(spec) });
                }
                const dexStatus = next.has(DEX_TOOL_NAME) ? 'DEX catalogue validated' : 'DEX catalogue unavailable or incompatible';
                console.error(`WAI discovery: ${dexStatus}; ${installed.size} other tool(s) available`);
            }
            catch {
                console.error('WAI discovery unavailable; DEX requires a valid catalogue to run. The six original tools remain available.');
            }
        };
        void refresh();
        const timer = setInterval(() => { void refresh(); }, 5 * 60 * 1000);
        timer.unref();
    }
    return server;
};
void serveStdio(serverFactory);
console.error(`WAI MCP local stdio adapter ready (payment mode: ${runner.config.mode}; network: ${runner.config.network})`);
