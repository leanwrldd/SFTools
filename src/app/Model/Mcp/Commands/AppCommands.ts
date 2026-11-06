import {Injectable} from '@angular/core';
import {Router} from '@angular/router';
import {AuthService} from '@src/Model/Auth/AuthService';
import {ConnectivityService} from '@src/Model/Network/ConnectivityService';
import {McpArgs} from '@src/Model/Mcp/McpArgs';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpNavigation} from '@src/Model/Mcp/McpNavigation';
import {McpOperationRegistry} from '@src/Model/Mcp/McpOperationRegistry';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {McpMutationResult} from '@src/Model/Mcp/McpResult';
import {McpRevisionTracker} from '@src/Model/Mcp/McpRevisionTracker';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {VersionManager} from '@src/Model/Data/VersionManager';

const NAVIGATION_TARGETS = ['home', 'planner', 'map', 'settings', 'account', 'mods', 'mod_editor', 'help', 'about', 'create_version'] as const;

/** Null for pages whose address depends on the game version. */
const NAVIGATION_URLS: Record<typeof NAVIGATION_TARGETS[number], string | null> = {
	home: '/',
	planner: null,
	map: null,
	settings: '/settings',
	account: '/account',
	mods: '/mods',
	mod_editor: '/mod-editor',
	help: '/help',
	about: '/about',
	create_version: '/create-version',
};

/** APP-01, APP-02, APP-04, VER-01 and the operations commands: what the app is showing, moving around it, and the state of long-running work. */
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
		private readonly navigation: McpNavigation,
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
				name: 'app.navigate',
				kind: 'mutation',
				summary: 'Go to a page of the app and wait until it is usable. The planner and map also open a game version (versionSlug from versions.list).',
				run: args => this.navigate(args),
			},
			{
				name: 'versions.list',
				kind: 'query',
				summary: 'The game versions available, with the slug app.navigate takes, and which one is open.',
				run: () => {
					const active = this.versions.activeVersion()?.id ?? null;
					return {
						ok: true,
						kind: 'query',
						data: {
							loading: !this.versions.ready(),
							versions: this.versions.versions().map(version => ({
								slug: this.versions.urlSlug(version),
								name: version.name,
								custom: version.custom,
								active: version.id === active,
							})),
						},
					};
				},
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

	private async navigate(args: McpArgs): Promise<McpMutationResult>
	{
		const target = args.oneOf('target', NAVIGATION_TARGETS);
		const expected = NAVIGATION_URLS[target];
		if (target === 'planner' || target === 'map') {
			const planId = target === 'planner' ? args.optionalString('planId') : null;
			await this.navigation.openVersionPage(target, args.optionalString('versionSlug'), planId);
		} else {
			await this.navigation.go(expected!);
		}
		// Guards redirect instead of failing (signed-out users leave /mods), and the client should hear about it.
		const url = this.router.url;
		const redirected = expected !== null && expected !== undefined && !url.startsWith(expected) && (expected !== '/' || url !== '/');
		return {
			ok: true,
			kind: 'mutation',
			changed: [],
			warnings: redirected ? [`The app redirected to ${url} instead of ${expected}. Check app_get_capabilities or sign in.`] : [],
			resultsStale: false,
			needsRecalculation: false,
			revisions: {},
			data: {url, version: this.versions.activeVersion()?.name ?? null, plannerOpen: this.plannerHost.isOpen()},
		};
	}

}
