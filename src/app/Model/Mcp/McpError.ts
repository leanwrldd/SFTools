/** Stable machine-readable failure reasons; the AI client can branch on these and follow `recovery`. */
export type McpErrorCode =
	| 'unknown_command'
	| 'invalid_arguments'
	| 'not_available'
	| 'read_only'
	| 'stale_target'
	| 'not_found'
	| 'planner_not_open'
	| 'confirmation_required'
	| 'conflict'
	| 'timeout'
	| 'cancelled'
	| 'failed';

export class McpError extends Error
{

	public constructor(
		public readonly code: McpErrorCode,
		message: string,
		/** Name of a command (or short instruction) that can resolve the failure. */
		public readonly recovery: string | null = null,
		public readonly details: Record<string, unknown> | null = null,
	)
	{
		super(message);
		this.name = 'McpError';
	}

	public static from(error: unknown): McpError
	{
		if (error instanceof McpError) {
			return error;
		}
		return new McpError('failed', error instanceof Error ? error.message : String(error));
	}

}
