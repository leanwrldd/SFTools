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
			planId,
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
			planId,
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
			planId,
			expectedRevision,
			action: z.enum(['enable', 'disable', 'set_only', 'reset_to_defaults']),
			recipes: z.array(z.string().min(1)).optional().describe('Recipe classNames from calculator_list_recipes.'),
			scope: z.enum(['alternate', 'standard', 'conversion']).optional(),
		},
	},
	{
		name: 'calculator_list_options', command: 'calculator.list_options', title: 'List calculator options', readOnly: true,
		description: 'What a calculator tab offers, its current state, and the classNames its setter takes: machines, power (generators, fuels, geysers, augmenters), resources, byproducts or sink.',
		shape: {
			planId: planIdOptional,
			section: z.enum(['machines', 'power', 'resources', 'byproducts', 'sink']),
			query: z.string().optional().describe('Part of a name.'),
			limit: z.number().int().min(1).max(300).optional(),
		},
	},
	{
		name: 'calculator_set_resources', command: 'calculator.set_resources', title: 'Set raw resources', readOnly: false,
		description: 'Change raw resources; anything left out stays as it is. Per resource: enabled, limit (per minute; null is unlimited), weight (only in manual weight mode). Refused for limits when a map area sets them. Refused when the plan folder fixes resources.',
		shape: {
			planId,
			expectedRevision,
			resources: z.array(z.object({
				item: z.string().min(1).describe('Resource className from calculator_list_options.'),
				enabled: z.boolean().optional(),
				limit: z.number().min(0).nullable().optional(),
				weight: z.number().min(0).optional(),
			})).optional(),
			allEnabled: z.boolean().optional().describe('Enable or disable every resource.'),
			useMapLimits: z.boolean().optional().describe('Set every limit to the whole map\'s total. Water becomes unlimited.'),
			weightMode: z.enum(['map', 'limits', 'equal', 'manual']).optional().describe('Manual starts from the weights currently in force.'),
		},
	},
	{
		name: 'calculator_set_machines', command: 'calculator.set_machines', title: 'Set production machines', readOnly: false,
		description: 'Enable or disable production machines, by className or all of them. Refused when the plan folder fixes machines.',
		shape: {
			planId,
			expectedRevision,
			action: z.enum(['enable', 'disable']),
			machines: z.array(z.string().min(1)).optional().describe('Machine classNames from calculator_list_options.'),
			all: z.boolean().optional(),
		},
	},
	{
		name: 'calculator_set_byproducts', command: 'calculator.set_byproducts', title: 'Set allowed byproducts', readOnly: false,
		description: 'Allow or disallow items as byproducts, by className or all of them. Refused when the plan folder fixes byproducts.',
		shape: {
			planId,
			expectedRevision,
			action: z.enum(['allow', 'disallow']),
			items: z.array(z.string().min(1)).optional().describe('Item classNames from calculator_list_options.'),
			all: z.boolean().optional(),
		},
	},
	{
		name: 'calculator_set_sink', command: 'calculator.set_sink', title: 'Set sinkable items', readOnly: false,
		description: 'Allow or disallow items to go into the AWESOME Sink, by className or all of them. Maximising sink points needs at least one allowed item. Refused when the plan folder fixes the sink.',
		shape: {
			planId,
			expectedRevision,
			action: z.enum(['allow', 'disallow']),
			items: z.array(z.string().min(1)).optional().describe('Item classNames from calculator_list_options.'),
			all: z.boolean().optional(),
		},
	},
	{
		name: 'calculator_set_power', command: 'calculator.set_power', title: 'Set power options', readOnly: false,
		description: 'Change power options; anything left out stays as it is. A power target or producePowerForFactory needs at least one enabled fuel or geothermal generator. Geyser counts over what is free are lowered and reported. Refused when the plan folder fixes power.',
		shape: {
			planId,
			expectedRevision,
			fuels: z.array(z.object({
				generator: z.string().min(1).describe('Generator className from calculator_list_options.'),
				action: z.enum(['enable', 'disable']),
				items: z.array(z.string().min(1)).optional().describe('Fuel classNames of that generator.'),
				all: z.boolean().optional().describe('Every fuel of that generator.'),
			})).optional(),
			producePowerForFactory: z.boolean().optional().describe('Also generate the power the factory itself uses.'),
			excessPowerPercent: z.number().min(0).max(50).optional().describe('Spare power on top of what the factory uses, in percent (0 to 50, as the Power tab allows).'),
			geysers: z.object({
				impure: z.number().int().min(0).optional(),
				normal: z.number().int().min(0).optional(),
				pure: z.number().int().min(0).optional(),
			}).optional().describe('Geothermal generators per geyser purity.'),
			geyserAction: z.enum(['use_all', 'clear']).optional().describe('Use every free geyser, or none. Not together with geysers.'),
			augmenters: z.object({
				count: z.number().int().min(0).optional(),
				boosted: z.number().int().min(0).optional(),
			}).optional().describe('Alien power augmenters, and how many are boosted with Alien Power Matrix. They use the Somersloop budget.'),
		},
	},
	{
		name: 'calculator_set_clock_speeds', command: 'calculator.set_clock_speeds', title: 'Set clock speeds', readOnly: false,
		description: 'Set the default clock speed and overrides per recipe, machine or generator, in percent from 1 to 250. Listed overrides are added or changed, others stay; clockSpeed null removes one. Refused when the plan folder fixes overclocking.',
		shape: {
			planId,
			expectedRevision,
			defaultClockSpeed: z.number().min(1).max(250).optional(),
			recipes: z.array(z.object({recipe: z.string().min(1), clockSpeed: z.number().min(1).max(250).nullable()})).optional(),
			machines: z.array(z.object({machine: z.string().min(1), clockSpeed: z.number().min(1).max(250).nullable()})).optional(),
			generators: z.array(z.object({generator: z.string().min(1), clockSpeed: z.number().min(1).max(250).nullable()})).optional(),
		},
	},
	{
		name: 'calculator_set_sloops', command: 'calculator.set_sloops', title: 'Set Somersloop budget', readOnly: false,
		description: 'Set the Somersloop budget and how hard the solver looks for the best way to spend it (high can take a long time). Refused when the plan folder fixes Somersloops.',
		shape: {
			planId,
			expectedRevision,
			maxSloops: z.number().int().min(0).optional(),
			accuracy: z.enum(['low', 'medium', 'high']).optional(),
		},
	},
	{
		name: 'calculator_set_optimization', command: 'calculator.set_optimization', title: 'Set optimization goals', readOnly: false,
		description: 'Choose what the solver minimises and how much each counts; anything left out stays as it is. machineWeights entries are added or changed, weight null removes one. Refused when the plan folder fixes optimisation.',
		shape: {
			planId,
			expectedRevision,
			rawResources: z.boolean().optional(),
			inputs: z.boolean().optional(),
			power: z.boolean().optional(),
			machines: z.boolean().optional(),
			powerWeight: z.number().min(0).optional(),
			machinesWeight: z.number().min(0).optional(),
			machineCounting: z.enum(['fractional', 'whole']).optional().describe('whole rounds every machine up, which can make large plans slow to solve.'),
			machineWeights: z.array(z.object({machine: z.string().min(1), weight: z.number().min(0).nullable()})).optional(),
		},
	},
	{
		name: 'calculator_set_mode', command: 'calculator.set_mode', title: 'Set calculation mode', readOnly: false,
		description: 'Set how the plan calculates: automatic, manual-fresh (Calculate replaces the graph), manual-upgrade (merges into it) or manual-append (adds beside it). Changing the mode does not recalculate.',
		shape: {
			planId,
			expectedRevision,
			mode: z.enum(['automatic', 'manual-fresh', 'manual-upgrade', 'manual-append']),
		},
	},
	{
		name: 'calculator_reset', command: 'calculator.reset', title: 'Reset calculator settings', readOnly: false, destructive: true,
		description: 'Set all settings of a plan back to the defaults, including the calculation mode. Requests and inputs stay. Settings its folder fixes stay as the folder has them.',
		shape: {planId, expectedRevision, confirm},
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
		shape: {planId: planId.describe('Plan the call expects to be open; refused if another plan is showing.')},
		timeoutMs: 11 * 60 * 1000,
	},
	{
		name: 'graph_delete_nodes', command: 'graph.delete_nodes', title: 'Delete graph nodes', readOnly: false, destructive: true,
		description: 'Delete nodes from the graph of the plan open in the planner. Reports whether the graph actually changed.',
		shape: {planId: planId.describe('Plan the call expects to be open; refused if another plan is showing.'), nodeIds: z.array(z.string().min(1)).min(1), confirm},
	},
];
