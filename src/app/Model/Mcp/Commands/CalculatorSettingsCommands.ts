import {Injectable} from '@angular/core';
import {Data} from '@src/Model/Data/Data';
import {GeyserCaps} from '@src/Model/Game/GeyserCaps';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpPlanReporter} from '@src/Model/Mcp/McpPlanReporter';
import {McpPlanTargets} from '@src/Model/Mcp/McpPlanTargets';
import {McpMutationResult} from '@src/Model/Mcp/McpResult';
import {CalculationMode} from '@src/Model/Planner/CalculationMode';
import {ExtraPowerResolver} from '@src/Model/Planner/ExtraPowerResolver';
import {Formulas} from '@src/Model/Planner/Formulas';
import {GeothermalGenerators} from '@src/Model/Planner/GeothermalGenerators';
import {MachineWeight} from '@src/Model/Planner/MachineWeight';
import {OptimisationDefaults} from '@src/Model/Planner/OptimisationDefaults';
import {OptimisationSettings} from '@src/Model/Planner/OptimisationSettings';
import {Plan} from '@src/Model/Planner/Plan';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {PlanSettings} from '@src/Model/Planner/PlanSettings';
import {ResourcePoolService} from '@src/Model/Planner/Pool/ResourcePoolService';
import {ResourceWeightMode} from '@src/Model/Planner/ResourceWeightMode';
import {ResourceWeightResolver} from '@src/Model/Planner/ResourceWeightResolver';
import {SloopAccuracy} from '@src/Model/Planner/SloopAccuracy';
import {SloopBudgetService} from '@src/Model/Planner/SloopBudgetService';
import {SpecialClasses} from '@src/Model/Planner/SpecialClasses';
import {TextMatcher} from '@src/Model/Search/TextMatcher';

const OPTION_SECTIONS = ['machines', 'power', 'resources', 'byproducts', 'sink'] as const;
const WEIGHT_MODES: readonly ResourceWeightMode[] = ['map', 'limits', 'equal', 'manual'];
const CALCULATION_MODES: readonly CalculationMode[] = ['automatic', 'manual-fresh', 'manual-upgrade', 'manual-append'];
const SLOOP_ACCURACIES: readonly SloopAccuracy[] = ['low', 'medium', 'high'];
const GEYSER_PURITIES: readonly (keyof GeothermalGenerators)[] = ['impure', 'normal', 'pure'];

/**
 * CAL-04, CAL-06 to CAL-14: the remaining calculator tabs. Each change is a patch: what a call leaves out stays as it is, and values are
 * stored the way the tabs store them (defaults omitted), so plans made here and by hand stay identical. Where a tab quietly corrects a
 * value (geysers over the map's count), the correction is applied too and reported as a warning; values no tab could produce are refused.
 */
@Injectable({providedIn: 'root'})
export class CalculatorSettingsCommands
{

	private static readonly LIST_DEFAULT = 100;
	private static readonly LIST_MAX = 300;

	public constructor(
		bus: McpCommandBus,
		private readonly targets: McpPlanTargets,
		private readonly reporter: McpPlanReporter,
		private readonly planManager: PlanManager,
		private readonly weights: ResourceWeightResolver,
		private readonly pool: ResourcePoolService,
		private readonly extraPower: ExtraPowerResolver,
		private readonly geyserCaps: GeyserCaps,
		private readonly sloopBudget: SloopBudgetService,
		private readonly matcher: TextMatcher,
	)
	{
		bus.register(...this.commands().map(command => ({...command, gates: ['plans_loaded' as const]})));
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'calculator.list_options',
				kind: 'query',
				summary: 'What a calculator tab offers with its current state and the classNames its setter takes: machines, power, resources, byproducts or sink.',
				run: args => {
					const plan = this.targets.plan(args);
					return {ok: true, kind: 'query', data: {planId: plan.id, ...this.options(plan, this.targets.data(), args)}};
				},
			},
			{
				name: 'calculator.set_resources',
				kind: 'mutation',
				summary: 'Change raw resources: enabled state, limits (null is unlimited), weights, the weighting mode, or the limits of the whole map.',
				run: args => this.setResources(args),
			},
			{
				name: 'calculator.set_machines',
				kind: 'mutation',
				summary: 'Enable or disable production machines, by className or all of them.',
				run: args => {
					const plan = this.targets.editableSettings(args, 'machines');
					const data = this.targets.data();
					const known = data.getProductionMachines().map(machine => machine.className);
					const disabled = new Set(plan.settings.disabledMachines ?? []);
					const action = args.oneOf('action', ['enable', 'disable'] as const);
					this.selection(args, 'machines', known, 'production machine').forEach(name => action === 'enable' ? disabled.delete(name) : disabled.add(name));
					return this.commit(plan, {disabledMachines: this.sorted(disabled)}, {disabledMachines: [...disabled].sort()});
				},
			},
			{
				name: 'calculator.set_byproducts',
				kind: 'mutation',
				summary: 'Allow or disallow items as byproducts, by className or all of them.',
				run: args => {
					const plan = this.targets.editableSettings(args, 'byproducts');
					const data = this.targets.data();
					const known = data.getAutomatableItems().map(item => item.className);
					const disabled = new Set(plan.settings.disabledByproducts ?? []);
					const action = args.oneOf('action', ['allow', 'disallow'] as const);
					this.selection(args, 'items', known, 'byproduct').forEach(name => action === 'allow' ? disabled.delete(name) : disabled.add(name));
					return this.commit(plan, {disabledByproducts: this.sorted(disabled)}, {disallowedByproducts: [...disabled].sort()});
				},
			},
			{
				name: 'calculator.set_sink',
				kind: 'mutation',
				summary: 'Allow or disallow items to go into the AWESOME Sink, by className or all of them. Maximising sink points needs at least one.',
				run: args => {
					const plan = this.targets.editableSettings(args, 'sink');
					const data = this.targets.data();
					const known = data.items.filter(item => item.isSinkable()).map(item => item.className);
					const allowed = new Set(plan.settings.sinkableItems ?? []);
					const action = args.oneOf('action', ['allow', 'disallow'] as const);
					this.selection(args, 'items', known, 'sinkable item').forEach(name => action === 'allow' ? allowed.add(name) : allowed.delete(name));
					return this.commit(plan, {sinkableItems: this.sorted(allowed)}, {sinkableItems: allowed.size});
				},
			},
			{
				name: 'calculator.set_power',
				kind: 'mutation',
				summary: 'Change generator fuels, whether the plan powers its own factory, the excess power percentage, geothermal generators and alien power augmenters.',
				run: args => this.setPower(args),
			},
			{
				name: 'calculator.set_clock_speeds',
				kind: 'mutation',
				summary: 'Set the default clock speed and overrides per recipe, machine or generator (1 to 250 percent; null removes an override).',
				run: args => this.setClockSpeeds(args),
			},
			{
				name: 'calculator.set_sloops',
				kind: 'mutation',
				summary: 'Set the Somersloop budget and how hard the solver looks for the best way to spend it.',
				run: args => {
					const plan = this.targets.editableSettings(args, 'sloops');
					this.requireSome(args, ['maxSloops', 'accuracy']);
					const patch: {-readonly [K in keyof PlanSettings]?: PlanSettings[K]} = {};
					if (args.has('maxSloops')) {
						const sloops = this.count(args, 'maxSloops');
						patch.maxSloops = sloops > 0 ? sloops : undefined;
					}
					if (args.has('accuracy')) {
						patch.sloopAccuracy = args.oneOf('accuracy', SLOOP_ACCURACIES);
					}
					const budget = args.has('maxSloops') ? patch.maxSloops ?? 0 : plan.settings.maxSloops ?? 0;
					const warnings: string[] = [];
					const augmenterCost = this.extraPower.resolve(plan.settings).sloopCost;
					if (augmenterCost > budget) {
						warnings.push(`The plan's alien power augmenters need ${augmenterCost} Somersloops, more than this budget of ${budget}.`);
					}
					return this.commit(plan, patch, {
						maxSloops: budget,
						accuracy: patch.sloopAccuracy ?? plan.settings.sloopAccuracy ?? 'low',
						remaining: this.sloopBudget.remaining(budget, plan.graph),
					}, warnings);
				},
			},
			{
				name: 'calculator.set_optimization',
				kind: 'mutation',
				summary: 'Choose what the solver minimises (raw resources, inputs, power, machines), the power and machine weights, and how machines are counted.',
				run: args => this.setOptimization(args),
			},
			{
				name: 'calculator.set_mode',
				kind: 'mutation',
				summary: 'Set the calculation mode: automatic, manual-fresh (replace the graph), manual-upgrade (merge into it) or manual-append (add beside it).',
				run: args => {
					const plan = this.targets.editable(args);
					const mode = args.oneOf('mode', CALCULATION_MODES);
					return this.commit(plan, {calculationMode: mode}, {});
				},
			},
			{
				name: 'calculator.reset',
				kind: 'mutation',
				summary: 'Set all settings of a plan back to the defaults. Requires confirm: true. Settings its folder fixes stay as the folder has them.',
				run: args => {
					const plan = this.targets.editable(args);
					args.requireConfirm('Resetting all settings');
					this.targets.data();
					const fixed = this.planManager.fixedGroupsOf(plan);
					const defaults = this.planManager.defaultSettings();
					this.planManager.setSettings(plan.id, defaults);
					const result = this.reporter.settingsChanged(plan.id, {}, plan);
					return fixed.length === 0 ? result : {
						...result,
						warnings: [`The folder fixes ${fixed.join(', ')}, so those settings were not reset.`, ...result.warnings],
					};
				},
			},
		];
	}

	private setResources(args: McpArgs): McpMutationResult
	{
		const plan = this.targets.editableSettings(args, 'resources');
		const data = this.targets.data();
		const settings = plan.settings;
		this.requireSome(args, ['resources', 'allEnabled', 'useMapLimits', 'weightMode']);
		const entries = args.objectList('resources', true);
		const useMapLimits = args.boolean('useMapLimits');
		const known = new Set(data.resources);

		const changesLimits = useMapLimits || args.has('allEnabled') || entries.some(entry => entry.has('enabled') || entry.has('limit'));
		if (changesLimits && settings.resourceArea !== undefined) {
			throw new McpError(
				'conflict',
				'A map area sets the limits of this plan. Remove the area on the Resources tab in the app first. Weights can still be changed.',
			);
		}

		const limits: Record<string, number> = {...settings.resourceLimits};
		const disabled = new Set(settings.disabledResources ?? []);
		if (useMapLimits) {
			const worldLimits = data.worldLimits;
			if (worldLimits === null) {
				throw new McpError('not_available', 'This game version has no map limits.');
			}
			for (const className of data.resources) {
				const limit = className === SpecialClasses.WaterItem ? undefined : worldLimits[className];
				if (limit === undefined) {
					delete limits[className];
				} else {
					limits[className] = limit;
				}
			}
		}
		if (args.has('allEnabled')) {
			disabled.clear();
			if (!args.boolean('allEnabled')) {
				data.resources.forEach(className => disabled.add(className));
			}
		}

		const currentMode = this.weights.modeOf(settings);
		const mode = args.has('weightMode') ? args.oneOf('weightMode', WEIGHT_MODES) : currentMode;
		const inForce = this.weights.resolve(settings, this.pool.effectiveLimits(plan), data);
		const manualWeights: Record<string, number> = {};
		data.resources.forEach(className => manualWeights[className] = this.weights.round(inForce[className] ?? 1));

		entries.forEach((entry, index) => {
			const className = entry.string('item');
			if (!known.has(className)) {
				throw new McpError('invalid_arguments', `resources[${index}].item "${className}" is not a raw resource of this game version.`, 'calculator.list_options');
			}
			if (entry.has('enabled')) {
				if (entry.boolean('enabled')) {
					disabled.delete(className);
				} else {
					disabled.add(className);
				}
			}
			if (entry.has('limit')) {
				const limit = entry.optionalNumber('limit');
				if (limit === null) {
					delete limits[className];
				} else if (limit < 0) {
					throw new McpError('invalid_arguments', `resources[${index}].limit must not be negative.`);
				} else {
					limits[className] = limit;
				}
			}
			if (entry.has('weight')) {
				const weight = entry.optionalNumber('weight');
				if (mode !== 'manual') {
					throw new McpError('invalid_arguments', `Weights can only be set in manual mode, and this plan uses "${mode}". Pass weightMode: "manual".`);
				}
				if (weight === null || weight < 0) {
					throw new McpError('invalid_arguments', `resources[${index}].weight must be a number of at least 0.`);
				}
				manualWeights[className] = this.weights.round(weight);
			}
		});

		const warnings: string[] = [];
		if (mode === 'manual' && settings.optimisation?.rawResources === false) {
			warnings.push('Raw resources are not being minimised, so these weights have no effect. Turn them on with calculator_set_optimization.');
		}
		return this.commit(plan, {
			resourceLimits: Object.keys(limits).length > 0 ? limits : undefined,
			disabledResources: this.sorted(disabled),
			...(args.has('weightMode') ? {resourceWeightMode: mode} : {}),
			// Only manual mode stores weights; the other modes derive them.
			resourceWeights: mode === 'manual' ? manualWeights : undefined,
		}, {weightMode: mode, disabledResources: [...disabled].sort(), limits}, warnings);
	}

	private setPower(args: McpArgs): McpMutationResult
	{
		const plan = this.targets.editableSettings(args, 'power');
		const data = this.targets.data();
		const settings = plan.settings;
		this.requireSome(args, ['fuels', 'producePowerForFactory', 'excessPowerPercent', 'geysers', 'geyserAction', 'augmenters']);
		if (args.has('geysers') && args.has('geyserAction')) {
			throw new McpError('invalid_arguments', 'Give "geysers" or "geyserAction", not both.');
		}
		const patch: {-readonly [K in keyof PlanSettings]?: PlanSettings[K]} = {};
		const warnings: string[] = [];

		if (args.has('fuels')) {
			const generators = new Map(data.getPowerGenerators().map(generator => [generator.className, generator]));
			const fuels: Record<string, string[]> = {...settings.enabledFuels};
			args.objectList('fuels').forEach((entry, index) => {
				const className = entry.string('generator');
				const generator = generators.get(className);
				if (generator === undefined) {
					throw new McpError('invalid_arguments', `fuels[${index}].generator "${className}" is not a power generator of this game version.`, 'calculator.list_options');
				}
				const valid = generator.fuel.map(fuel => fuel.item.className);
				const enabled = new Set(fuels[className] ?? []);
				const action = entry.oneOf('action', ['enable', 'disable'] as const);
				this.selection(entry, 'items', valid, `fuel of ${generator.name}`).forEach(fuel => action === 'enable' ? enabled.add(fuel) : enabled.delete(fuel));
				if (enabled.size > 0) {
					fuels[className] = [...enabled].sort();
				} else {
					delete fuels[className];
				}
			});
			patch.enabledFuels = Object.keys(fuels).length > 0 ? fuels : undefined;
		}

		if (args.has('producePowerForFactory')) {
			patch.producePowerForFactory = args.boolean('producePowerForFactory') ? true : undefined;
		}
		if (args.has('excessPowerPercent')) {
			const percent = args.optionalNumber('excessPowerPercent');
			if (percent === null || percent < 0 || percent > 50) {
				throw new McpError('invalid_arguments', '"excessPowerPercent" must be between 0 and 50, as on the Power tab.');
			}
			patch.excessPowerPercent = percent;
			const producing = args.has('producePowerForFactory') ? args.boolean('producePowerForFactory') : settings.producePowerForFactory ?? false;
			if (!producing) {
				warnings.push('Excess power only applies while the plan powers its own factory. Turn on producePowerForFactory for it to count.');
			}
		}

		const available = this.geyserCaps.cap(settings)?.counts ?? null;
		if (args.has('geyserAction')) {
			const action = args.oneOf('geyserAction', ['use_all', 'clear'] as const);
			if (action === 'use_all' && available === null) {
				throw new McpError('not_available', 'This game version does not say how many geysers its map has. Give the counts in "geysers".');
			}
			patch.geothermalGenerators = this.storedGeysers(action === 'use_all' ? available! : {impure: 0, normal: 0, pure: 0});
		} else if (args.has('geysers')) {
			const given = args.object('geysers');
			const geysers: Record<keyof GeothermalGenerators, number> = {...this.extraPower.geysers(settings)};
			for (const purity of GEYSER_PURITIES) {
				if (!given.has(purity)) {
					continue;
				}
				const count = this.count(given, purity);
				const cap = available === null ? count : available[purity];
				if (count > cap) {
					warnings.push(`Only ${cap} ${purity} geysers are free, so that is what was set instead of ${count}.`);
				}
				geysers[purity] = Math.min(count, cap);
			}
			patch.geothermalGenerators = this.storedGeysers(geysers);
		}

		if (args.has('augmenters')) {
			const given = args.object('augmenters');
			const current = this.extraPower.augmenters(settings);
			const count = given.has('count') ? this.count(given, 'count') : current.count;
			const wanted = given.has('boosted') ? this.count(given, 'boosted') : current.boosted;
			if (wanted > count) {
				if (given.has('boosted')) {
					warnings.push(`Only ${count} augmenters exist to boost, so that is what was set instead of ${wanted}.`);
				}
			}
			patch.alienPowerAugmenters = count > 0 ? {count, boosted: Math.min(count, wanted)} : undefined;
		}

		const next = {...settings, ...patch};
		const sloopCost = this.extraPower.resolve(next).sloopCost;
		if (sloopCost > (next.maxSloops ?? 0)) {
			warnings.push(`These augmenters need ${sloopCost} Somersloops, but the budget is ${next.maxSloops ?? 0}. Raise it with calculator_set_sloops.`);
		}
		return this.commit(plan, patch, {
			enabledFuels: next.enabledFuels ?? {},
			producePowerForFactory: next.producePowerForFactory ?? false,
			excessPowerPercent: next.excessPowerPercent ?? 10,
			geysers: this.extraPower.geysers(next),
			augmenters: this.extraPower.augmenters(next),
		}, warnings);
	}

	private setClockSpeeds(args: McpArgs): McpMutationResult
	{
		const plan = this.targets.editableSettings(args, 'overclocking');
		const data = this.targets.data();
		const settings = plan.settings;
		this.requireSome(args, ['defaultClockSpeed', 'recipes', 'machines', 'generators']);
		const patch: {-readonly [K in keyof PlanSettings]?: PlanSettings[K]} = {};

		if (args.has('defaultClockSpeed')) {
			const clock = this.clock(args.optionalNumber('defaultClockSpeed'), 'defaultClockSpeed');
			patch.defaultClockSpeed = clock === 100 ? undefined : clock;
		}
		if (args.has('recipes')) {
			const known = data.getRecipesForMachines().map(recipe => recipe.className);
			const rows = this.clockOverrides(args, 'recipes', 'recipe', known, (settings.recipeClockSpeeds ?? []).map(row => [row.recipeClassName, row.clockSpeed]));
			patch.recipeClockSpeeds = rows.length > 0 ? rows.map(([recipeClassName, clockSpeed]) => ({recipeClassName, clockSpeed})) : undefined;
		}
		if (args.has('machines')) {
			const known = data.getProductionMachines().filter(machine => machine.canOverclock).map(machine => machine.className);
			const rows = this.clockOverrides(args, 'machines', 'machine', known, (settings.machineClockSpeeds ?? []).map(row => [row.machineClassName, row.clockSpeed]));
			patch.machineClockSpeeds = rows.length > 0 ? rows.map(([machineClassName, clockSpeed]) => ({machineClassName, clockSpeed})) : undefined;
		}
		if (args.has('generators')) {
			const known = data.getPowerGenerators().filter(generator => generator.canOverclock).map(generator => generator.className);
			const rows = this.clockOverrides(args, 'generators', 'generator', known, (settings.generatorClockSpeeds ?? []).map(row => [row.generatorClassName, row.clockSpeed]));
			patch.generatorClockSpeeds = rows.length > 0 ? rows.map(([generatorClassName, clockSpeed]) => ({generatorClassName, clockSpeed})) : undefined;
		}

		const next = {...settings, ...patch};
		return this.commit(plan, patch, {
			defaultClockSpeed: next.defaultClockSpeed ?? 100,
			recipeClockSpeeds: next.recipeClockSpeeds ?? [],
			machineClockSpeeds: next.machineClockSpeeds ?? [],
			generatorClockSpeeds: next.generatorClockSpeeds ?? [],
		});
	}

	private clockOverrides(args: McpArgs, key: string, field: string, known: readonly string[], current: [string, number][]): [string, number][]
	{
		const rows = new Map<string, number>(current);
		args.objectList(key).forEach((entry, index) => {
			const className = entry.string(field);
			if (!known.includes(className)) {
				throw new McpError('invalid_arguments', `${key}[${index}].${field} "${className}" cannot be overclocked or is not in this game version.`, 'calculator.list_options');
			}
			if (!entry.has('clockSpeed')) {
				throw new McpError('invalid_arguments', `${key}[${index}].clockSpeed is required (null removes the override).`);
			}
			const clock = entry.optionalNumber('clockSpeed');
			if (clock === null) {
				rows.delete(className);
			} else {
				rows.set(className, this.clock(clock, `${key}[${index}].clockSpeed`));
			}
		});
		return [...rows.entries()];
	}

	private clock(value: number | null, label: string): number
	{
		if (value === null || value < 1 || value > 250) {
			throw new McpError('invalid_arguments', `${label} must be between 1 and 250 percent.`);
		}
		return Formulas.clampClock(value);
	}

	private setOptimization(args: McpArgs): McpMutationResult
	{
		const plan = this.targets.editableSettings(args, 'optimisation');
		const data = this.targets.data();
		this.requireSome(args, ['rawResources', 'inputs', 'power', 'machines', 'powerWeight', 'machinesWeight', 'machineCounting', 'machineWeights']);
		const current = plan.settings.optimisation;
		const partial: {-readonly [K in keyof OptimisationSettings]?: OptimisationSettings[K]} = {};
		for (const flag of ['rawResources', 'inputs', 'power', 'machines'] as const) {
			if (args.has(flag)) {
				partial[flag] = args.boolean(flag);
			}
		}
		for (const weight of ['powerWeight', 'machinesWeight'] as const) {
			if (args.has(weight)) {
				const value = args.optionalNumber(weight);
				if (value === null || value < 0) {
					throw new McpError('invalid_arguments', `"${weight}" must be a number of at least 0.`);
				}
				partial[weight] = value;
			}
		}
		if (args.has('machineCounting')) {
			const counting = args.oneOf('machineCounting', ['fractional', 'whole'] as const);
			partial.machineCounting = counting === 'fractional' ? undefined : counting;
		}
		if (args.has('machineWeights')) {
			const known = new Set([...data.getProductionMachines(), ...data.getPowerGenerators()].map(machine => machine.className));
			const rows = new Map((current?.machineWeights ?? []).map((row): [string, number] => [row.machineClassName, row.weight]));
			args.objectList('machineWeights').forEach((entry, index) => {
				const className = entry.string('machine');
				if (!known.has(className)) {
					throw new McpError('invalid_arguments', `machineWeights[${index}].machine "${className}" is not a machine or generator of this game version.`, 'calculator.list_options');
				}
				if (!entry.has('weight')) {
					throw new McpError('invalid_arguments', `machineWeights[${index}].weight is required (null removes it).`);
				}
				const weight = entry.optionalNumber('weight');
				if (weight === null) {
					rows.delete(className);
				} else if (weight < 0) {
					throw new McpError('invalid_arguments', `machineWeights[${index}].weight must not be negative.`);
				} else {
					rows.set(className, weight);
				}
			});
			const overrides: MachineWeight[] = [...rows.entries()].map(([machineClassName, weight]) => ({machineClassName, weight}));
			partial.machineWeights = overrides.length > 0 ? overrides : undefined;
		}

		// Persist the effective flags explicitly, as the tab does, so a partial edit never flips an absent-means-default field.
		const optimisation: OptimisationSettings = {
			rawResources: current?.rawResources ?? true,
			power: current?.power ?? true,
			machines: current?.machines ?? false,
			inputs: current?.inputs ?? true,
			...current,
			...partial,
		};
		const warnings: string[] = [];
		const hasInputs = plan.inputs.some(input => input.itemClassName !== '' && input.amount > 0);
		if (!optimisation.rawResources && !optimisation.power && !optimisation.machines && !(optimisation.inputs && hasInputs)) {
			warnings.push('Nothing is being minimised now, so the solver may pick a wasteful result.');
		}
		if (optimisation.machineCounting === 'whole') {
			warnings.push('Counting whole machines makes the problem much harder, so large plans can take a long time to solve.');
		}
		return this.commit(plan, {optimisation}, {
			rawResources: optimisation.rawResources,
			inputs: optimisation.inputs,
			power: optimisation.power,
			machines: optimisation.machines,
			powerWeight: optimisation.powerWeight ?? OptimisationDefaults.powerWeight,
			machinesWeight: optimisation.machinesWeight ?? OptimisationDefaults.machinesWeight,
			machineCounting: optimisation.machineCounting ?? 'fractional',
			machineWeights: optimisation.machineWeights ?? [],
		}, warnings);
	}

	private options(plan: Plan, data: Data, args: McpArgs): Record<string, unknown>
	{
		const section = args.oneOf('section', OPTION_SECTIONS);
		const settings = plan.settings;
		switch (section) {
			case 'machines': {
				const disabled = new Set(settings.disabledMachines ?? []);
				return this.page(section, args, data.getProductionMachines(), machine => machine.name, machine => ({
					className: machine.className,
					name: machine.name,
					enabled: !disabled.has(machine.className),
					canOverclock: machine.canOverclock,
					recipes: data.getRecipesForBuilding(machine.className).length,
				}));
			}
			case 'byproducts': {
				const disabled = new Set(settings.disabledByproducts ?? []);
				return this.page(section, args, data.getAutomatableItems().slice().sort((a, b) => a.name.localeCompare(b.name)), item => item.name, item => ({
					className: item.className,
					name: item.name,
					allowed: !disabled.has(item.className),
				}));
			}
			case 'sink': {
				const allowed = new Set(settings.sinkableItems ?? []);
				const items = data.items.filter(item => item.isSinkable()).sort((a, b) => b.sinkPoints - a.sinkPoints || a.name.localeCompare(b.name));
				return this.page(section, args, items, item => item.name, item => ({
					className: item.className,
					name: item.name,
					sinkPoints: item.sinkPoints,
					allowed: allowed.has(item.className),
				}));
			}
			case 'resources': {
				const limits = settings.resourceLimits ?? {};
				const disabled = new Set(settings.disabledResources ?? []);
				const weights = this.weights.resolve(settings, this.pool.effectiveLimits(plan), data);
				const names = data.resources.map(className => ({className, name: data.searchItemByClassName(className)?.name ?? className}))
					.sort((a, b) => a.name.localeCompare(b.name));
				return {
					weightMode: this.weights.modeOf(settings),
					limitsFromMapArea: settings.resourceArea !== undefined,
					mapLimitsAvailable: data.worldLimits !== null,
					...this.page(section, args, names, row => row.name, row => ({
						...row,
						enabled: !disabled.has(row.className),
						limit: limits[row.className] ?? null,
						weight: this.weights.round(weights[row.className] ?? 1),
					})),
				};
			}
			case 'power': {
				const fuels = settings.enabledFuels ?? {};
				const extra = this.extraPower.resolve(settings);
				const generators = data.getPowerGenerators().slice().sort((a, b) => a.name.localeCompare(b.name));
				return {
					producePowerForFactory: settings.producePowerForFactory ?? false,
					excessPowerPercent: settings.excessPowerPercent ?? 10,
					geysers: this.extraPower.geysers(settings),
					geysersAvailable: this.geyserCaps.cap(settings)?.counts ?? null,
					augmenters: this.extraPower.augmenters(settings),
					augmenterSloopCost: extra.sloopCost,
					maxSloops: settings.maxSloops ?? 0,
					...this.page(section, args, generators, generator => generator.name, generator => ({
						className: generator.className,
						name: generator.name,
						canOverclock: generator.canOverclock,
						fuels: generator.fuel.map(fuel => ({
							className: fuel.item.className,
							name: fuel.item.name,
							enabled: (fuels[generator.className] ?? []).includes(fuel.item.className),
						})),
					})),
				};
			}
		}
	}

	private page<T>(section: string, args: McpArgs, rows: readonly T[], nameOf: (row: T) => string, describe: (row: T) => Record<string, unknown>): Record<string, unknown>
	{
		const query = args.optionalString('query') ?? '';
		const matching = query === '' ? [...rows] : this.matcher.filter([...rows], query, nameOf);
		const limit = Math.max(1, Math.min(args.optionalNumber('limit') ?? CalculatorSettingsCommands.LIST_DEFAULT, CalculatorSettingsCommands.LIST_MAX));
		return {section, total: matching.length, shown: Math.min(limit, matching.length), rows: matching.slice(0, limit).map(describe)};
	}

	/** The named classNames, or every known one with all: true. */
	private selection(args: McpArgs, key: string, known: readonly string[], what: string): string[]
	{
		const all = args.boolean('all');
		const named = args.optionalStringList(key);
		if (all && named.length > 0) {
			throw new McpError('invalid_arguments', `Give "${key}" or "all", not both.`);
		}
		if (all) {
			return [...known];
		}
		if (named.length === 0) {
			throw new McpError('invalid_arguments', `Give "${key}" or "all": true to say what to change.`);
		}
		for (const className of named) {
			if (!known.includes(className)) {
				throw new McpError('invalid_arguments', `"${className}" is not a ${what}.`, 'calculator.list_options');
			}
		}
		return named;
	}

	private requireSome(args: McpArgs, keys: readonly string[]): void
	{
		if (!keys.some(key => args.has(key))) {
			throw new McpError('invalid_arguments', `Nothing to change: give at least one of ${keys.join(', ')}.`);
		}
	}

	private count(args: McpArgs, key: string): number
	{
		const value = args.optionalNumber(key);
		if (value === null || value < 0 || !Number.isInteger(value)) {
			throw new McpError('invalid_arguments', `"${key}" must be a whole number of at least 0.`);
		}
		return value;
	}

	private storedGeysers(geysers: GeothermalGenerators): GeothermalGenerators | undefined
	{
		return geysers.impure + geysers.normal + geysers.pure > 0 ? geysers : undefined;
	}

	private sorted(values: Set<string>): string[] | undefined
	{
		return values.size > 0 ? [...values].sort() : undefined;
	}

	private commit(plan: Plan, patch: Partial<PlanSettings>, data: Record<string, unknown>, warnings: string[] = []): McpMutationResult
	{
		this.planManager.setSettings(plan.id, {...plan.settings, ...patch});
		const result = this.reporter.settingsChanged(plan.id, data, plan);
		return warnings.length === 0 ? result : {...result, warnings: [...warnings, ...result.warnings]};
	}

}
