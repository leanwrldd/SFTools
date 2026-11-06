import {Injectable, Injector, Signal, computed, signal} from '@angular/core';
import {toObservable} from '@angular/core/rxjs-interop';
import {filter, firstValueFrom, timeout} from 'rxjs';
import {PlannerActionsService} from '@src/Components/Planner/PlannerActionsService';
import {McpError} from '@src/Model/Mcp/McpError';
import {PlanManager} from '@src/Model/Planner/PlanManager';

export interface McpDispatchOutcome
{

	/** The active plan graph object was replaced, so the request had an effect. */
	readonly graphChanged: boolean;
	readonly planId: string;

}

export interface McpCalculationOutcome
{

	readonly planId: string;
	/** False when the planner refused to start (read-only plan, nothing requested, ...): no calculation ran. */
	readonly started: boolean;
	readonly status: 'optimal' | 'no_solution' | 'settings_problem' | 'error' | 'cancelled' | 'not_started';
	readonly message: string | null;

}

/**
 * Bridge to the open planner page. PlannerActionsService is scoped to PlannerComponent and only emits requests; the component applies
 * them synchronously (or via a promise it keeps to itself). This host is the root-level handle the command layer uses: it exists only
 * while a planner page is open, and it reports whether a request actually changed the plan instead of assuming it did.
 */
@Injectable({providedIn: 'root'})
export class McpPlannerHost
{

	/** How long a calculation may run before the command reports a timeout (the calculation itself keeps running). */
	public static readonly CALCULATION_TIMEOUT_MS = 10 * 60 * 1000;

	private readonly actionsSignal = signal<PlannerActionsService | null>(null);
	public readonly isOpen: Signal<boolean> = computed(() => this.actionsSignal() !== null);

	public constructor(
		private readonly planManager: PlanManager,
		private readonly injector: Injector,
	)
	{
	}

	public attach(actions: PlannerActionsService): void
	{
		this.actionsSignal.set(actions);
	}

	public detach(actions: PlannerActionsService): void
	{
		if (this.actionsSignal() === actions) {
			this.actionsSignal.set(null);
		}
	}

	public requireActions(): PlannerActionsService
	{
		const actions = this.actionsSignal();
		if (actions === null) {
			throw new McpError('planner_not_open', 'The planner page is not open.', 'app.navigate {target: "planner"}');
		}
		return actions;
	}

	public requireEditablePlan(planId: string | null): string
	{
		const plan = this.planManager.activePlan();
		if (plan === null) {
			throw new McpError('not_found', 'No plan is open in the planner.', 'plans.open');
		}
		if (planId !== null && planId !== plan.id) {
			throw new McpError(
				'stale_target',
				`The planner shows another plan than the one this command targets (open: ${plan.id}, target: ${planId}).`,
				'plans.open',
				{openPlanId: plan.id},
			);
		}
		if (this.planManager.activePlanReadOnly()) {
			throw new McpError('read_only', 'This plan is shared or read-only.', 'plans.import_copy');
		}
		return plan.id;
	}

	/**
	 * Runs a request against the open planner and reports whether the graph changed. Requests are applied synchronously by the
	 * component; the extra macrotask lets handlers that continue in a promise (relayout, convert to subplan) settle before the check.
	 */
	public async dispatch(planId: string | null, emit: (actions: PlannerActionsService) => void): Promise<McpDispatchOutcome>
	{
		const actions = this.requireActions();
		const id = this.requireEditablePlan(planId);
		const before = this.planManager.findPlan(id)?.graph ?? null;
		emit(actions);
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		await this.waitWhileCalculating(actions);
		const after = this.planManager.findPlan(id)?.graph ?? null;
		return {graphChanged: before !== after, planId: id};
	}

	/** Starts a calculation and waits for its terminal state. */
	public async calculate(planId: string | null): Promise<McpCalculationOutcome>
	{
		const actions = this.requireActions();
		const id = this.requireEditablePlan(planId);
		const before = this.planManager.findPlan(id)?.graph ?? null;
		const wasCalculating = actions.isCalculating();
		actions.requestCalculate();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		if (!actions.isCalculating() && !wasCalculating) {
			// Either it finished within the tick, or the planner refused to start.
			return this.outcome(actions, id, before, true);
		}
		await this.waitWhileCalculating(actions);
		return this.outcome(actions, id, before, true);
	}

	public cancelCalculation(): void
	{
		this.requireActions().requestCancel();
	}

	private outcome(actions: PlannerActionsService, planId: string, graphBefore: unknown, mayHaveStarted: boolean): McpCalculationOutcome
	{
		const error = actions.solveError();
		if (error === PlannerActionsService.SETTINGS_PROBLEM) {
			return {planId, started: true, status: 'settings_problem', message: actions.solveErrorDetail()};
		}
		if (error === 'no solution') {
			return {planId, started: true, status: 'no_solution', message: actions.solveErrorDetail()};
		}
		if (error !== null) {
			return {planId, started: true, status: 'error', message: actions.solveErrorDetail() ?? error};
		}
		const graphAfter = this.planManager.findPlan(planId)?.graph ?? null;
		if (mayHaveStarted && graphAfter !== graphBefore) {
			return {planId, started: true, status: 'optimal', message: null};
		}
		return {planId, started: false, status: 'not_started', message: 'The planner did not start a calculation (nothing is requested or locked).'};
	}

	private async waitWhileCalculating(actions: PlannerActionsService): Promise<void>
	{
		if (!actions.isCalculating()) {
			return;
		}
		try {
			await firstValueFrom(
				toObservable(actions.isCalculating, {injector: this.injector}).pipe(
					filter(calculating => !calculating),
					timeout(McpPlannerHost.CALCULATION_TIMEOUT_MS),
				),
			);
		} catch {
			throw new McpError('timeout', 'The calculation is still running.', 'operations.get');
		}
		// The graph is written in a promise after the solver finishes.
		await new Promise<void>(resolve => setTimeout(resolve, 0));
	}

}
