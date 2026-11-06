import {Injectable} from '@angular/core';
import {Router} from '@angular/router';
import {AuthService} from '@src/Model/Auth/AuthService';
import {ConnectivityService} from '@src/Model/Network/ConnectivityService';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpOperationRegistry} from '@src/Model/Mcp/McpOperationRegistry';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {VersionManager} from '@src/Model/Data/VersionManager';

/** APP-01 / APP-04 and the operations commands: what the app is showing, what can be done now, and the state of long-running work. */
@Injectable({providedIn: 'root'})
export class AppCommands
{

	public constructor(
		bus: McpCommandBus,
		private readonly router: Router,
		private readonly auth: AuthService,
		private readonly versions: VersionManager,
		private readonly connectivity: ConnectivityService,
		private readonly planManager: PlanManager,
		private readonly plannerHost: McpPlannerHost,
		private readonly revisions: McpRevisionTracker,
		private readonly operations: McpOperationRegistry,
	)
	{
		bus.register(...this.commands(bus));
	}

	private commands(bus: McpCommandBus): McpCommand[]
	{
		return [
			{
				name: 'app.get_context',
				kind: 'query',
				summary: 'Current page, game version, signed-in state, connectivity, active plan/folder and planner state.',
				run: () => {
					const version = this.versions.activeVersion();
					const plan = this.planManager.activePlan();
					const folder = this.planManager.activeFolder();
					return {
						ok: true,
						kind: 'query',
						data: {
							url: this.router.url,
							signedIn: this.auth.isAuthenticated(),
							online: this.connectivity.online(),
							version: version === null ? null : {id: version.id, name: version.name, slug: version.slug, custom: version.custom},
							plannerOpen: this.plannerHost.isOpen(),
							activePlan: plan === null ? null : {
								id: plan.id,
								name: plan.name,
								revision: this.revisions.revisionOf('plan', plan.id),
								readOnly: this.planManager.activePlanReadOnly(),
								shared: this.planManager.activePlanShared(),
								deviceLocal: this.planManager.activePlanLocal(),
								graphDirty: plan.metadata.graphDirty,
								recalculationNeeded: plan.metadata.recalculationNeeded ?? false,
							},
							activeFolder: folder === null ? null : {
								id: folder.id,
								name: folder.name,
								revision: this.revisions.revisionOf('folder', folder.id),
							},
						},
					};
				},
			},
			{
				name: 'app.get_capabilities',
				kind: 'query',
				summary: 'Every command with the reason it cannot run right now (signed out, planner closed, browser only, ...).',
				run: () => ({ok: true, kind: 'query', data: bus.describe()}),
			},
			{
				name: 'operations.get',
				kind: 'query',
				summary: 'State of a long-running operation by id, or all recent operations.',
				run: args => {
					const id = args.optionalString('operationId');
					return {ok: true, kind: 'query', data: id === null ? this.operations.list() : this.operations.get(id)};
				},
			},
			{
				name: 'operations.cancel',
				kind: 'mutation',
				summary: 'Cancel a running operation.',
				run: args => ({
					ok: true,
					kind: 'mutation',
					changed: [],
					warnings: [],
					resultsStale: false,
					needsRecalculation: false,
					revisions: {},
					data: this.operations.cancel(args.string('operationId')),
				}),
			},
		];
	}

}
