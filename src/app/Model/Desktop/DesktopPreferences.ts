export interface DesktopPreferences
{

	readonly openLinks: boolean;

	readonly checkForUpdates: boolean;

	/** Lets a local MCP adapter (Claude, ChatGPT) drive this app. Off until the user turns it on. */
	readonly mcpBridge: boolean;

	/** Loopback port of the adapter. */
	readonly mcpPort: number;

	/** Shared secret printed by the adapter; the app proves it knows it before any command is accepted. */
	readonly mcpToken: string;

}
