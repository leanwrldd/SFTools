/** Messages on the loopback WebSocket between this adapter (server) and the open Satisfactory Tools app (client). */

export type AppToAdapter =
	| {type: 'hello'; token: string; app: string; version: string}
	| {type: 'response'; id: string; response: unknown}
	| {type: 'catalog'; commands: unknown[]};

export type AdapterToApp =
	| {type: 'ready'}
	| {type: 'rejected'; reason: string}
	| {type: 'request'; id: string; name: string; args: unknown};

export const DEFAULT_BRIDGE_PORT = 47813;
export const DEFAULT_HTTP_PORT = 47814;
