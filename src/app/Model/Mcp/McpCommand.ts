import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpMutationResult, McpQueryResult} from '@src/Model/Mcp/McpResult';

/** Availability requirement checked before a command runs; the failure names the reason so the client can recover. */
export type McpGate = 'auth' | 'planner_open' | 'desktop' | 'plans_loaded';

export interface McpCommand
{

	/** family.action, for example "plans.rename". */
	readonly name: string;
	readonly kind: 'query' | 'mutation';
	readonly summary: string;
	readonly gates?: readonly McpGate[];
	run(args: McpArgs): Promise<McpQueryResult | McpMutationResult> | McpQueryResult | McpMutationResult;

}
