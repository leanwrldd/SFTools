import {randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const CONFIG_DIR = join(homedir(), '.sftools-mcp');

/**
 * Secrets live in a per-user folder, not in client configs. The bridge token is pasted once into the app settings; the HTTP token is
 * what a remote client (ChatGPT through a tunnel) sends as a bearer token. An environment variable overrides the file.
 */
export function loadSecret(name: 'bridge-token' | 'http-token', envName: string): {value: string; path: string | null} {
	const fromEnv = process.env[envName];
	if (fromEnv !== undefined && fromEnv !== '') {
		return {value: fromEnv, path: null};
	}
	const path = join(CONFIG_DIR, name);
	if (existsSync(path)) {
		const stored = readFileSync(path, 'utf8').trim();
		if (stored !== '') {
			return {value: stored, path};
		}
	}
	mkdirSync(CONFIG_DIR, {recursive: true});
	const value = randomBytes(32).toString('hex');
	writeFileSync(path, value + '\n', {mode: 0o600});
	try {
		chmodSync(path, 0o600);
	} catch {
		// Windows does not map POSIX modes; the user profile folder is already private.
	}
	return {value, path};
}
