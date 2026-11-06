import {z} from 'zod';
import type {ZodRawShape} from 'zod';

export interface ToolDefinition
{

	/** MCP tool name (letters, digits, underscore: accepted by every client). */
	readonly name: string;
	/** Command name inside the app (src/app/Model/Mcp). */
	readonly command: string;
	readonly title: string;
	readonly description: string;
	readonly shape: ZodRawShape;
	readonly readOnly: boolean;
	readonly destructive?: boolean;
	readonly timeoutMs?: number;

}

const planId = z.string().min(1).describe('Plan id from plans_list.');
const folderId = z.string().min(1).describe('Folder id from plans_list.');
const expectedRevision = z.string().optional().describe(
	'Revision token from plans_list / plans_get. If the plan or folder was edited since, the change is refused with stale_target.',
);
const confirm = z.boolean().describe('Must be true: this action cannot be undone from here.');

/** The contract between AI clients and the app. Each entry maps one tool to one app command; the app validates again. */
export const TOOLS: readonly ToolDefinition[] = [
	{
		name: 'app_get_context', command: 'app.get_context', title: 'Get app context', readOnly: true,
		description: 'Current page, game version, sign-in and connectivity state, whether the planner is open, and the active plan/folder with revision tokens.',
		shape: {},
	},
	{
		name: 'app_get_capabilities', command: 'app.get_capabilities', title: 'Get capabilities', readOnly: true,
		description: 'Every app command with the reason it cannot run right now (signed out, planner not open, browser only).',
		shape: {},
	},
	{
		name: 'operations_get', command: 'operations.get', title: 'Get operation state', readOnly: true,
		description: 'State of a long-running operation by id, or the recent operations when no id is given.',
		shape: {operationId: z.string().optional()},
	},
	{
		name: 'operations_cancel', command: 'operations.cancel', title: 'Cancel operation', readOnly: false,
		description: 'Cancel a running operation, for example a calculation.',
		shape: {operationId: z.string().min(1)},
	},
	{
		name: 'plans_list', command: 'plans.list', title: 'List plans and folders', readOnly: true,
		description: 'All plans and folders with hierarchy, storage (own, device, shared), read-only flag and revision tokens.',
		shape: {},
	},
	{
		name: 'plans_get', command: 'plans.get', title: 'Get plan', readOnly: true,
		description: 'One plan with its production requests, inputs and calculation state.',
		shape: {planId},
	},
	{
		name: 'plans_open', command: 'plans.open', title: 'Open plan', readOnly: false,
		description: 'Make a plan the active plan. Shared and read-only plans open read-only.',
		shape: {planId},
	},
	{
		name: 'plans_create', command: 'plans.create', title: 'Create plan', readOnly: false,
		description: 'Create a plan, optionally inside a folder. Leave the name empty to let the app name it after its first product.',
		shape: {name: z.string().optional(), folderId: z.string().optional()},
	},
	{
		name: 'plans_rename', command: 'plans.rename', title: 'Rename plan', readOnly: false,
		description: 'Rename one of your own plans.',
		shape: {planId, name: z.string().min(1), expectedRevision},
	},
	{
		name: 'plans_clone', command: 'plans.clone', title: 'Clone plan', readOnly: false,
		description: 'Clone a plan under a new name.',
		shape: {planId, name: z.string().min(1)},
	},
	{
		name: 'plans_delete', command: 'plans.delete', title: 'Delete plan', readOnly: false, destructive: true,
		description: 'Delete one of your own plans together with its subplans.',
		shape: {planId, confirm, expectedRevision},
	},
	{
		name: 'folders_create', command: 'folders.create', title: 'Create folder', readOnly: false,
		description: 'Create a folder, optionally inside another folder.',
		shape: {name: z.string().min(1), parentId: z.string().optional()},
	},
	{
		name: 'folders_rename', command: 'folders.rename', title: 'Rename folder', readOnly: false,
		description: 'Rename a folder.',
		shape: {folderId, name: z.string().min(1), expectedRevision},
	},
	{
		name: 'folders_delete', command: 'folders.delete', title: 'Delete folder', readOnly: false, destructive: true,
		description: 'Delete a folder with everything in it.',
		shape: {folderId, confirm, expectedRevision},
	},
	{
		name: 'calculator_calculate', command: 'calculator.calculate', title: 'Calculate plan', readOnly: false,
		description: 'Run the solver on the plan open in the planner and wait for the outcome (optimal, no solution, settings problem, error). Requires the planner page to be open.',
		shape: {planId: z.string().optional().describe('Plan the call expects to be open; refused if another plan is showing.')},
		timeoutMs: 11 * 60 * 1000,
	},
	{
		name: 'graph_delete_nodes', command: 'graph.delete_nodes', title: 'Delete graph nodes', readOnly: false, destructive: true,
		description: 'Delete nodes from the graph of the plan open in the planner. Reports whether the graph actually changed.',
		shape: {planId: z.string().optional(), nodeIds: z.array(z.string().min(1)).min(1), confirm},
	},
];
