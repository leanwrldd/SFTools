import {Injectable} from '@angular/core';
import {ItemForm} from '@src/Model/API/Schema/Data/Parts/ItemForm';
import {Data} from '@src/Model/Data/Data';
import {Recipe} from '@src/Model/Data/Entities/Recipe';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpPlanReporter} from '@src/Model/Mcp/McpPlanReporter';
import {McpPlanTargets} from '@src/Model/Mcp/McpPlanTargets';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {EnabledRecipesResolver} from '@src/Model/Planner/EnabledRecipesResolver';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanInput} from '@src/Model/Planner/PlanInput';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {ResourcePoolService} from '@src/Model/Planner/Pool/ResourcePoolService';
import {PowerUnit} from '@src/Model/Planner/PowerUnit';
import {ProductionRequest} from '@src/Model/Planner/ProductionRequest';
import {ResourceConversionRecipeResolver} from '@src/Model/Planner/ResourceConversionRecipeResolver';
import {ResourceWeightResolver} from '@src/Model/Planner/ResourceWeightResolver';
import {SettingsGroups} from '@src/Model/Planner/SettingsGroups';
import {SpecialClasses} from '@src/Model/Planner/SpecialClasses';
import {TextMatcher} from '@src/Model/Search/TextMatcher';

type MaximiseCategory = 'items' | 'power' | 'sinkPoints';

const POWER_UNITS: readonly PowerUnit[] = ['MW', 'GW', 'TW'];
const REQUEST_ALIASES: Record<string, string> = {
	power: SpecialClasses.PowerTarget,
	sink_points: SpecialClasses.SinkPointsTarget,
};

/**
 * CAL-01 to CAL-05: read the effective settings, and set production requests, supplied inputs and enabled recipes. Every setter goes
 * through PlanManager exactly as the calculator tabs do, and refuses what the tabs refuse (read-only plans, settings a folder fixes).
 */
@Injectable({providedIn: 'root'})
export class CalculatorCommands
{

	/** Default weight of a fluid or gas input; the Input tab uses the same value. */
	private static readonly FLUID_WEIGHT = 0.01;
	private static readonly RECIPE_LIST_DEFAULT = 50;
	private static readonly RECIPE_LIST_MAX = 200;

	public constructor(
		bus: McpCommandBus,
		private readonly targets: McpPlanTargets,
		private readonly reporter: McpPlanReporter,
		private readonly planManager: PlanManager,
		private readonly revisions: McpRevisionTracker,
		private readonly recipeResolver: EnabledRecipesResolver,
		private readonly conversions: ResourceConversionRecipeResolver,
		private readonly pool: ResourcePoolService,
		private readonly weights: ResourceWeightResolver,
		private readonly matcher: TextMatcher,
	)
	{
		bus.register(...this.commands().map(command => ({...command, gates: ['plans_loaded' as const]})));
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'calculator.get_settings',
				kind: 'query',
				summary: 'The plan settings in force, requests, inputs, and which settings groups its folder fixes.',
				run: args => {
					const plan = this.targets.plan(args);
					const data = this.targets.data();
					const fixedFolder = this.planManager.fixedFolderOf(plan);
					return {
						ok: true,
						kind: 'query',
						data: {
							planId: plan.id,
							revision: this.revisions.revisionOf('plan', plan.id),
							readOnly: this.planManager.isReadOnlyPlan(plan.id),
							calculationMode: plan.settings.calculationMode ?? 'automatic',
							requests: plan.requests,
							inputs: plan.inputs,
							fixedByFolder: fixedFolder === null ? null : {
								folderId: fixedFolder.id,
								folderName: fixedFolder.name,
								groups: fixedFolder.fixedGroups.map(group => ({group, label: SettingsGroups.labelOf(group)})),
								resourcePool: this.planManager.poolFolderOf(plan) !== null,
							},
							recipes: this.recipeSummary(plan, data),
							settings: plan.settings,
						},
					};
				},
			},
			{
				name: 'calculator.list_recipes',
				kind: 'query',
				summary: 'Find recipes by name or product with their enabled state, to pick classNames for calculator_set_recipes.',
				run: args => {
					const plan = this.targets.plan(args);
					const data = this.targets.data();
					return {ok: true, kind: 'query', data: {planId: plan.id, ...this.listRecipes(plan, data, args)}};
				},
			},
			{
				name: 'calculator.set_targets',
				kind: 'mutation',
				summary: 'Replace the production requests of a plan (what to produce, at what rate or maximised).',
				run: args => {
					const plan = this.targets.editable(args);
					const data = this.targets.data();
					const requests = this.parseRequests(args, data);
					this.planManager.setRequests(plan.id, requests);
					return this.reporter.settingsChanged(plan.id, {requests}, plan);
				},
			},
			{
				name: 'calculator.set_inputs',
				kind: 'mutation',
				summary: 'Replace the supplied inputs of a plan (items you already have, with amount and weight).',
				run: args => {
					const plan = this.targets.editable(args);
					const data = this.targets.data();
					const inputs = this.parseInputs(args, plan, data);
					this.planManager.setInputs(plan.id, inputs);
					return this.reporter.settingsChanged(plan.id, {inputs}, plan);
				},
			},
			{
				name: 'calculator.set_recipes',
				kind: 'mutation',
				summary: 'Enable or disable recipes by className or scope, replace the enabled set, or return to the default selection.',
				run: args => {
					const plan = this.targets.editableSettings(args, 'recipes');
					const data = this.targets.data();
					const action = args.oneOf('action', ['enable', 'disable', 'set_only', 'reset_to_defaults'] as const);
					if (action === 'reset_to_defaults') {
						const {enabledRecipes: _unused, ...rest} = plan.settings;
						this.planManager.setSettings(plan.id, rest);
						return this.reporter.settingsChanged(plan.id, {recipes: this.recipeSummary(this.reload(plan.id), data)}, plan);
					}
					const selected = this.selectRecipes(args, data);
					const enabled = action === 'set_only' ? new Set<string>() : this.recipeResolver.resolve(plan.settings, data);
					selected.forEach(className => action === 'disable' ? enabled.delete(className) : enabled.add(className));
					this.planManager.setSettings(plan.id, {...plan.settings, enabledRecipes: [...enabled].sort()});
					return this.reporter.settingsChanged(plan.id, {recipes: this.recipeSummary(this.reload(plan.id), data)}, plan);
				},
			},
		];
	}

	private reload(planId: string): Plan
	{
		const plan = this.planManager.findPlan(planId);
		if (plan === null) {
			throw new McpError('failed', 'The plan disappeared while it was being changed.');
		}
		return plan;
	}

	private parseRequests(args: McpArgs, data: Data): ProductionRequest[]
	{
		const automatable = new Set(data.getAutomatableItems().map(item => item.className));
		const seen = new Set<string>();
		const requests = args.objectList('requests').map((entry, index): ProductionRequest => {
			const raw = entry.string('item');
			const itemClassName = REQUEST_ALIASES[raw] ?? raw;
			const isSpecial = itemClassName === SpecialClasses.PowerTarget || itemClassName === SpecialClasses.SinkPointsTarget;
			if (!isSpecial && !automatable.has(itemClassName)) {
				throw new McpError('invalid_arguments', `requests[${index}].item "${raw}" is not an item that can be produced.`, 'data.search_items');
			}
			if (seen.has(itemClassName)) {
				throw new McpError('invalid_arguments', `requests[${index}].item "${raw}" appears twice.`);
			}
			seen.add(itemClassName);

			const mode = entry.optionalString('mode') ?? 'rate';
			if (mode !== 'rate' && mode !== 'maximise') {
				throw new McpError('invalid_arguments', `requests[${index}].mode must be "rate" or "maximise".`);
			}
			const rate = entry.optionalNumber('ratePerMinute');
			if (rate !== null && rate < 0) {
				throw new McpError('invalid_arguments', `requests[${index}].ratePerMinute must not be negative.`);
			}
			if (mode === 'rate' && rate === null) {
				throw new McpError('invalid_arguments', `requests[${index}].ratePerMinute is required unless mode is "maximise".`);
			}

			const unit = entry.optionalString('powerUnit');
			if (unit !== null && (!POWER_UNITS.includes(unit as PowerUnit) || itemClassName !== SpecialClasses.PowerTarget)) {
				throw new McpError('invalid_arguments', `requests[${index}].powerUnit is MW, GW or TW and only applies to the power target.`);
			}

			// Defaults are omitted, as the Production tab does, so saved plans stay identical to ones made by hand.
			const request: ProductionRequest = {itemClassName, ratePerMinute: rate ?? 0};
			if (mode === 'maximise') {
				request.mode = 'maximise';
			}
			if (unit !== null && unit !== 'MW') {
				request.powerUnit = unit as PowerUnit;
			}
			return request;
		});

		const categories = new Set(requests.filter(request => request.mode === 'maximise').map(request => this.categoryOf(request.itemClassName)));
		if (categories.size > 1) {
			throw new McpError(
				'invalid_arguments',
				'Only one kind of target can be maximised at a time (items, power or sink points).',
			);
		}
		return requests;
	}

	private categoryOf(itemClassName: string): MaximiseCategory
	{
		if (itemClassName === SpecialClasses.PowerTarget) {
			return 'power';
		}
		return itemClassName === SpecialClasses.SinkPointsTarget ? 'sinkPoints' : 'items';
	}

	private parseInputs(args: McpArgs, plan: Plan, data: Data): PlanInput[]
	{
		const seen = new Set<string>();
		return args.objectList('inputs').map((entry, index): PlanInput => {
			const itemClassName = entry.string('item');
			if (data.searchItemByClassName(itemClassName) === undefined) {
				throw new McpError('invalid_arguments', `inputs[${index}].item "${itemClassName}" is not an item of this game version.`, 'data.search_items');
			}
			if (seen.has(itemClassName)) {
				throw new McpError('invalid_arguments', `inputs[${index}].item "${itemClassName}" appears twice.`);
			}
			seen.add(itemClassName);
			const amount = entry.optionalNumber('amount');
			if (amount === null || amount < 0) {
				throw new McpError('invalid_arguments', `inputs[${index}].amount must be a number of at least 0.`);
			}
			const weight = entry.optionalNumber('weight');
			if (weight !== null && weight < 0) {
				throw new McpError('invalid_arguments', `inputs[${index}].weight must not be negative.`);
			}
			return {itemClassName, amount, weight: weight ?? this.defaultWeight(plan, data, itemClassName)};
		});
	}

	/** Same rule as the Input tab: resource weight halved, else a flat fluid weight, else sink points per 1000. */
	private defaultWeight(plan: Plan, data: Data, itemClassName: string): number
	{
		const item = data.searchItemByClassName(itemClassName);
		if (item === undefined) {
			return 1;
		}
		const resourceWeight = this.weights.resolve(plan.settings, this.pool.effectiveLimits(plan), data)[itemClassName];
		if (resourceWeight !== undefined) {
			return this.weights.round(resourceWeight / 2);
		}
		if (item.form !== ItemForm.Solid) {
			return CalculatorCommands.FLUID_WEIGHT;
		}
		return item.sinkPoints > 0 ? this.weights.round(item.sinkPoints / 1000) : 1;
	}

	private selectRecipes(args: McpArgs, data: Data): Set<string>
	{
		const known = new Map<string, Recipe>();
		data.getRecipesForMachines().forEach(recipe => known.set(recipe.className, recipe));
		this.conversions.resolve(data).forEach(recipe => known.set(recipe.className, recipe));

		const selected = new Set<string>();
		for (const className of args.optionalStringList('recipes')) {
			if (!known.has(className)) {
				throw new McpError('invalid_arguments', `"${className}" is not a recipe of this game version.`, 'calculator.list_recipes');
			}
			selected.add(className);
		}
		const scope = args.optionalString('scope');
		if (scope !== null) {
			if (scope !== 'alternate' && scope !== 'standard' && scope !== 'conversion') {
				throw new McpError('invalid_arguments', '"scope" must be alternate, standard or conversion.');
			}
			const conversionNames = new Set(this.conversions.resolve(data).map(recipe => recipe.className));
			for (const recipe of known.values()) {
				// Conversion recipes are their own scope: most are not flagged alternate, so "standard" would turn them on too.
				const isConversion = conversionNames.has(recipe.className);
				const matches = scope === 'conversion'
					? isConversion
					: !isConversion && (scope === 'alternate') === recipe.alternate;
				if (matches) {
					selected.add(recipe.className);
				}
			}
		}
		if (selected.size === 0) {
			throw new McpError('invalid_arguments', 'Give "recipes" and/or "scope" to say which recipes to change.');
		}
		return selected;
	}

	private recipeSummary(plan: Plan, data: Data): Record<string, unknown>
	{
		const enabled = this.recipeResolver.resolve(plan.settings, data);
		const all = data.getRecipesForMachines();
		return {
			selection: plan.settings.enabledRecipes === undefined ? 'default' : 'custom',
			enabled: all.filter(recipe => enabled.has(recipe.className)).length,
			total: all.length,
		};
	}

	private listRecipes(plan: Plan, data: Data, args: McpArgs): Record<string, unknown>
	{
		const enabled = this.recipeResolver.resolve(plan.settings, data);
		const query = args.optionalString('query') ?? '';
		const state = args.optionalString('state') ?? 'any';
		if (state !== 'any' && state !== 'enabled' && state !== 'disabled') {
			throw new McpError('invalid_arguments', '"state" must be any, enabled or disabled.');
		}
		const scope = args.optionalString('scope') ?? 'all';
		if (scope !== 'all' && scope !== 'alternate' && scope !== 'standard') {
			throw new McpError('invalid_arguments', '"scope" must be all, alternate or standard.');
		}
		const limit = Math.max(1, Math.min(args.optionalNumber('limit') ?? CalculatorCommands.RECIPE_LIST_DEFAULT, CalculatorCommands.RECIPE_LIST_MAX));

		let recipes = data.getRecipesForMachines()
			.filter(recipe => scope === 'all' || (scope === 'alternate') === recipe.alternate)
			.filter(recipe => state === 'any' || (state === 'enabled') === enabled.has(recipe.className));
		if (this.matcher.normalize(query) !== '') {
			recipes = this.matcher.rankBy(recipes, recipe => {
				const byName = this.matcher.score(query, recipe.name.replace(/^Alternate: /, ''));
				if (byName !== null) {
					return byName;
				}
				const byProduct = recipe.products
					.map(product => this.matcher.score(query, product.item.name))
					.filter((score): score is number => score !== null);
				return byProduct.length > 0 ? Math.max(...byProduct) - TextMatcher.SCORE_NAME_EXACT : null;
			});
		}

		return {
			total: recipes.length,
			shown: Math.min(limit, recipes.length),
			recipes: recipes.slice(0, limit).map(recipe => ({
				className: recipe.className,
				name: recipe.name,
				alternate: recipe.alternate,
				enabled: enabled.has(recipe.className),
				disabledByMachine: this.recipeResolver.isDisabledByMachine(recipe, plan.settings),
				machines: recipe.producedIn.filter(building => building !== undefined).map(building => building.name),
				ingredients: recipe.ingredients.map(entry => ({className: entry.item.className, name: entry.item.name, amount: entry.amount})),
				products: recipe.products.map(entry => ({className: entry.item.className, name: entry.item.name, amount: entry.amount})),
				seconds: recipe.time,
			})),
		};
	}

}
