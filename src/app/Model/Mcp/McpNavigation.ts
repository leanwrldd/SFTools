import {Injectable, NgZone} from '@angular/core';
import {Router} from '@angular/router';
import {VersionManager} from '@src/Model/Data/VersionManager';
import {Version} from '@src/Model/API/Schema/Version';
import {McpError} from '@src/Model/Mcp/McpError';
import {McpPlannerHost} from '@src/Model/Mcp/McpPlannerHost';
import {PlanManager} from '@src/Model/Planner/PlanManager';
import {PlannerLocationService} from '@src/Model/Planner/PlannerLocationService';

/** Moves the app the way its links do and reports only when the page is usable, so the next command does not hit a half-loaded version. */
@Injectable({providedIn: 'root'})
export class McpNavigation
{

	private static readonly LOAD_TIMEOUT_MS = 30000;
	private static readonly POLL_MS = 50;

	public constructor(
		private readonly router: Router,
		private readonly zone: NgZone,
		private readonly versions: VersionManager,
		private readonly planManager: PlanManager,
		private readonly host: McpPlannerHost,
		private readonly plannerLocation: PlannerLocationService,
	)
	{
	}

	public async go(url: string): Promise<void>
	{
		await this.zone.run(() => this.router.navigateByUrl(url));
	}

	/** Opens a page that belongs to a game version: the named one, else the one in use, the last planner's, or the default. */
	public async openVersionPage(page: 'planner' | 'map', versionSlug: string | null, planId: string | null = null): Promise<void>
	{
		await this.waitFor(() => this.versions.ready(), 'the list of game versions');
		const slug = this.versions.urlSlug(this.resolveVersion(versionSlug));
		await this.go(planId === null ? `/${slug}/${page}` : `/${slug}/${page}/${planId}`);
		await this.waitFor(
			() => this.versions.activeVersionData() !== null && this.planManager.loadedForActiveVersion() && (page !== 'planner' || this.host.isOpen()),
			'the game version',
		);
		if (planId !== null) {
			if (this.planManager.findPlan(planId) === null) {
				throw new McpError('not_found', `No plan with id ${planId} in this game version.`, 'plans.list');
			}
			await this.waitFor(() => this.planManager.activePlanId() === planId, 'the plan');
		}
	}

	private resolveVersion(versionSlug: string | null): Version
	{
		if (versionSlug !== null) {
			const named = this.versions.findByUrlSlug(versionSlug);
			if (named === null) {
				throw new McpError('not_found', `No game version "${versionSlug}".`, 'versions.list');
			}
			return named;
		}
		const remembered = this.plannerLocation.location()?.versionSlug ?? null;
		const version = this.versions.activeVersion()
			?? (remembered === null ? null : this.versions.findByUrlSlug(remembered))
			?? this.versions.defaultPublicVersion(false);
		if (version === null) {
			throw new McpError('not_available', 'No game versions are available. The app may be offline with nothing downloaded.', 'versions.list');
		}
		return version;
	}

	private async waitFor(ready: () => boolean, what: string): Promise<void>
	{
		const deadline = Date.now() + McpNavigation.LOAD_TIMEOUT_MS;
		while (!ready()) {
			if (Date.now() > deadline) {
				throw new McpError('timeout', `Timed out waiting for ${what} to load.`, 'app.get_context');
			}
			await new Promise<void>(resolve => setTimeout(resolve, McpNavigation.POLL_MS));
		}
	}

}
