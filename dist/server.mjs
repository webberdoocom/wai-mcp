#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { makeRunner, toMcpResult } from '../src/runner.mjs';
import { fetchCatalog } from '../src/discovery.mjs';
const runner = makeRunner();
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be an EVM address');
const chainId = z.union([z.number().int().positive(), z.string().min(1).max(32)]);
const company = z.string().regex(/^\d{8}$/, 'Companies House number must be 8 digits');
const serverFactory = () => {
    const server = new McpServer({ name: 'webberdoo-agent-intelligence', version: '0.1.0' });
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
    if (process.env.WAI_DYNAMIC_DISCOVERY !== 'off') {
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
            try {
                const next = await fetchCatalog(runner.config.base);
                for (const [name, old] of installed) {
                    if (!next.has(name) || JSON.stringify(next.get(name)) !== old.signature) {
                        old.handle.remove();
                        installed.delete(name);
                    }
                }
                for (const [name, spec] of next) {
                    if (installed.has(name))
                        continue;
                    const handle = server.registerTool(name, {
                        description: `WAI discovery: ${spec.description} Price: $${(spec.cents / 100).toFixed(2)} USDC. New service payments require explicit local allowlisting.`,
                        inputSchema: schemaFor(spec),
                    }, toMcpResult((args) => runner.runDynamic(spec, args)));
                    installed.set(name, { handle, signature: JSON.stringify(spec) });
                }
                console.error(`WAI discovery: ${installed.size} additional tool(s) available`);
            }
            catch (error) {
                console.error('WAI discovery unavailable; the original four tools remain available.');
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
