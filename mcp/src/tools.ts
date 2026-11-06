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
const planIdOptional = z.string().min(1).optional().describe('Plan id from plans_list. Defaults to the plan open in the app.');
const folderId =z.string().min(1).describe('Folder id from plans_list.');
const expectedRevision = z.string().optional().describe(
	'Revision token from plans_list / plans_get or the last change. If the plan or folder was edited since, the change is refused with stale_target. Calculating does not change it.',
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
		name: 'app_navigate', command: 'app.navigate', title: 'Go to a page', readOnly: false,
		description: 'Go to a page of the app and wait until it is usable. Plans and game data belong to a game version, so use target "planner" first when no version is open. Planner and map take an optional versionSlug from versions_list; without one the app reuses the open or last used version.',
		shape: {
			target: z.enum(['home', 'planner', 'map', 'settings', 'account', 'mods', 'mod_editor', 'help', 'about', 'create_version']),
			versionSlug: z.string().min(1).optional().describe('Game version to open (planner and map only).'),
			planId: z.string().min(1).optional().describe('Plan to show (planner only).'),
		},
		timeoutMs: 60 * 1000,
	},
	{
		name: 'versions_list', command: 'versions.list', title: 'List game versions', readOnly: true,
		description: 'The game versions available, with the slug app_navigate takes, and which one is open.',
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
		description: 'Make a plan the active plan and show it in the planner, opening the planner if needed. Shared and read-only plans open read-only.',
		shape: {planId},
		timeoutMs: 60 * 1000,
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
		description: 'Clone a plan under exactly the given name.',
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
		name: 'data_search_items', command: 'data.search_items', title: 'Search items', readOnly: true,
		description: 'Find items by name in the active game version and get the classNames that requests and inputs need. Also lists the special power and sink-points targets.',
		shape: {
			query: z.string().describe('Part of an item name, for example "iron plate". Empty returns the first items.'),
			producibleOnly: z.boolean().optional().describe('Only items a factory can make (what the Production tab offers).'),
			limit: z.number().int().min(1).max(100).optional(),
		},
	},
	{
		name: 'calculator_get_settings', command: 'calculator.get_settings', title: 'Get calculator settings', readOnly: true,
		description: 'Settings in force for a plan: requests, inputs, calculation mode, full settings, recipe selection summary, and which settings groups its folder fixes. Defaults to the open plan.',
		shape: {planId: planIdOptional},
	},
	{
		name: 'calculator_list_recipes', command: 'calculator.list_recipes', title: 'List recipes', readOnly: true,
		description: 'Find recipes by name or product with enabled state, machines, ingredients and products. Use the classNames with calculator_set_recipes.',
		shape: {
			planId: planIdOptional,
			query: z.string().optional(),
			scope: z.enum(['all', 'alternate', 'standard']).optional(),
			state: z.enum(['any', 'enabled', 'disabled']).optional(),
			limit: z.number().int().min(1).max(200).optional(),
		},
	},
	{
		name: 'calculator_set_targets', command: 'calculator.set_targets', title: 'Set production requests', readOnly: false,
		description: 'Replace the production requests of a plan. Each request is an item className (or "power" / "sink_points") with ratePerMinute, or mode "maximise". Power rates are megawatts. Only one kind of target can be maximised. Settings are not recalculated here; read the result for what happens next.',
		shape: {
			planId: planIdOptional,
			expectedRevision,
			requests: z.array(z.object({
				item: z.string().min(1).describe('Item className from data_search_items, or "power" / "sink_points".'),
				ratePerMinute: z.number().min(0).optional().describe('Items per minute (megawatts for power). Required unless mode is maximise.'),
				mode: z.enum(['rate', 'maximise']).optional(),
				powerUnit: z.enum(['MW', 'GW', 'TW']).optional().describe('Display unit for the power target only; ratePerMinute stays in MW.'),
			})),
		},
	},
	{
		name: 'calculator_set_inputs', command: 'calculator.set_inputs', title: 'Set supplied inputs', readOnly: false,
		description: 'Replace the inputs of a plan: items you already supply, with amount per minute and an optional weight (defaults match the Input tab).',
		shape: {
			planId: planIdOptional,
			expectedRevision,
			inputs: z.array(z.object({
				item: z.string().min(1),
				amount: z.number().min(0),
				weight: z.number().min(0).optional(),
			})),
		},
	},
	{
		name: 'calculator_set_recipes', command: 'calculator.set_recipes', title: 'Set enabled recipes', readOnly: false,
		description: 'Enable or disable recipes by className and/or scope (alternate, standard, conversion), replace the enabled set with set_only, or reset_to_defaults. Refused when the plan folder fixes the recipe settings.',
		shape: {
			planId: planIdOptional,
			expectedRevision,
			action: z.enum(['enable', 'disable', 'set_only', 'reset_to_defaults']),
			recipes: z.array(z.string().min(1)).optional().describe('Recipe classNames from calculator_list_recipes.'),
			scope: z.enum(['alternate', 'standard', 'conversion']).optional(),
		},
	},
	{
		name: 'results_get_summary', command: 'results.get_summary', title: 'Get result summary', readOnly: true,
		description: 'Totals of the last successful calculation (products, resources used, power, machines, build cost). Check resultsStale: when true the numbers no longer match the plan, and staleReason and lastCalculationError say why.',
		shape: {planId: planIdOptional},
	},
	{
		name: 'results_get_breakdown', command: 'results.get_breakdown', title: 'Get result breakdown', readOnly: true,
		description: 'Detailed rows of one result section of the last successful calculation: items (sources and targets), power, build_cost, resources, production or recipes. Check resultsStale as for results_get_summary.',
		shape: {planId: planIdOptional, section: z.enum(['items', 'power', 'build_cost', 'resources', 'production', 'recipes'])},
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
