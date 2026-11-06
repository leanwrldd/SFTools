import {McpErrorCode} from '@src/Model/Mcp/McpError';

export interface McpEntityRef
{

	readonly kind: 'plan' | 'folder' | 'node' | 'edge';
	readonly id: string;
	readonly change: 'created' | 'updated' | 'deleted' | 'unchanged';

}

/** What every mutating command returns, so the client always learns what changed and what is now stale. */
export interface McpMutationResult
{

	readonly ok: true;
	readonly kind: 'mutation';
	/** Stable references of everything the command created, changed or removed. */
	readonly changed: McpEntityRef[];
	readonly warnings: string[];
	/** Calculated results no longer match the settings or graph. */
	readonly resultsStale: boolean;
	/** The settings changed since the last calculation; calculator.calculate would refresh the graph. */
	readonly needsRecalculation: boolean;
	/** Revision tokens (McpRevisionTracker) of the affected entities after the change, keyed "plan:<id>" / "folder:<id>", to pass as expectedRevision. */
	readonly revisions: Record<string, string>;
	readonly data?: unknown;

}

export interface McpQueryResult
{

	readonly ok: true;
	readonly kind: 'query';
	readonly data: unknown;

}

export interface McpFailure
{

	readonly ok: false;
	readonly error: {
		readonly code: McpErrorCode;
		readonly message: string;
		readonly recovery: string | null;
		readonly details: Record<string, unknown> | null;
	};

}

export type McpResponse = McpMutationResult | McpQueryResult | McpFailure;
