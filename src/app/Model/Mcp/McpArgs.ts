import {McpError} from '@src/Model/Mcp/McpError';

/** Small argument reader: commands validate their input explicitly instead of trusting the client JSON. */
export class McpArgs
{

	private readonly record: Record<string, unknown>;

	public constructor(raw: unknown)
	{
		if (raw === undefined || raw === null) {
			this.record = {};
		} else if (typeof raw === 'object' && !Array.isArray(raw)) {
			this.record = raw as Record<string, unknown>;
		} else {
			throw new McpError('invalid_arguments', 'Arguments must be an object.');
		}
	}

	/** Whether the client sent this key; null counts, because it can mean "remove". */
	public has(key: string): boolean
	{
		return this.record[key] !== undefined;
	}

	public object(key: string): McpArgs
	{
		const value = this.record[key];
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new McpError('invalid_arguments', `"${key}" must be an object.`);
		}
		return new McpArgs(value);
	}

	public string(key: string): string
	{
		const value = this.record[key];
		if (typeof value !== 'string' || value === '') {
			throw new McpError('invalid_arguments', `"${key}" must be a non-empty string.`);
		}
		return value;
	}

	/** A display name: trimmed, and refused when nothing is left. */
	public name(key: string): string
	{
		const value = this.string(key).trim();
		if (value === '') {
			throw new McpError('invalid_arguments', `"${key}" must not be blank.`);
		}
		return value;
	}

	public optionalString(key: string): string | null
	{
		const value = this.record[key];
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== 'string') {
			throw new McpError('invalid_arguments', `"${key}" must be a string.`);
		}
		return value;
	}

	/** A string that may be empty (for example a plan name that falls back to automatic naming). */
	public text(key: string): string
	{
		const value = this.record[key];
		if (typeof value !== 'string') {
			throw new McpError('invalid_arguments', `"${key}" must be a string.`);
		}
		return value;
	}

	/** A non-empty array of non-empty strings. */
	public stringList(key: string): string[]
	{
		const value = this.record[key];
		if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || item === '')) {
			throw new McpError('invalid_arguments', `"${key}" must be a non-empty array of strings.`);
		}
		return value as string[];
	}

	/** An array of objects, each read through its own McpArgs. Absent means empty when `optional`, otherwise an error. */
	public objectList(key: string, optional = false): McpArgs[]
	{
		const value = this.record[key];
		if (value === undefined || value === null) {
			if (optional) {
				return [];
			}
			throw new McpError('invalid_arguments', `"${key}" must be an array.`);
		}
		if (!Array.isArray(value)) {
			throw new McpError('invalid_arguments', `"${key}" must be an array.`);
		}
		return value.map((entry, index) => {
			if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
				throw new McpError('invalid_arguments', `"${key}[${index}]" must be an object.`);
			}
			return new McpArgs(entry);
		});
	}

	/** Like stringList, but the array may be absent or empty. */
	public optionalStringList(key: string): string[]
	{
		const value = this.record[key];
		if (value === undefined || value === null) {
			return [];
		}
		if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item === '')) {
			throw new McpError('invalid_arguments', `"${key}" must be an array of strings.`);
		}
		return value as string[];
	}

	public optionalNumber(key: string): number | null
	{
		const value = this.record[key];
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new McpError('invalid_arguments', `"${key}" must be a finite number.`);
		}
		return value;
	}

	public boolean(key: string, fallback = false): boolean
	{
		const value = this.record[key];
		if (value === undefined || value === null) {
			return fallback;
		}
		if (typeof value !== 'boolean') {
			throw new McpError('invalid_arguments', `"${key}" must be true or false.`);
		}
		return value;
	}

	public oneOf<T extends string>(key: string, allowed: readonly T[]): T
	{
		const value = this.record[key];
		if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
			throw new McpError('invalid_arguments', `"${key}" must be one of: ${allowed.join(', ')}.`);
		}
		return value as T;
	}

	/** Deletes and overwrites require the client to say so explicitly. */
	public requireConfirm(what: string): void
	{
		if (this.record['confirm'] !== true) {
			throw new McpError('confirmation_required', `${what} needs "confirm": true.`, null, {what});
		}
	}

}
