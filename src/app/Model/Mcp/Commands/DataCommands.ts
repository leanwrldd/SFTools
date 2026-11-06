import {Injectable} from '@angular/core';
import {McpCommand} from '@src/Model/Mcp/McpCommand';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';
import {McpPlanTargets} from '@src/Model/Mcp/McpPlanTargets';
import {SpecialClasses} from '@src/Model/Planner/SpecialClasses';
import {TextMatcher} from '@src/Model/Search/TextMatcher';

/** REF-01 (items only for now): lets a client turn a name into the className the calculator commands expect. */
@Injectable({providedIn: 'root'})
export class DataCommands
{

	private static readonly DEFAULT_LIMIT = 25;
	private static readonly MAX_LIMIT = 100;

	public constructor(
		bus: McpCommandBus,
		private readonly targets: McpPlanTargets,
		private readonly matcher: TextMatcher,
	)
	{
		bus.register(...this.commands());
	}

	private commands(): McpCommand[]
	{
		return [
			{
				name: 'data.search_items',
				kind: 'query',
				summary: 'Find items by name in the active game version. Returns classNames to use in requests and inputs.',
				run: args => {
					const data = this.targets.data();
					const query = args.text('query');
					const limit = Math.min(args.optionalNumber('limit') ?? DataCommands.DEFAULT_LIMIT, DataCommands.MAX_LIMIT);
					const producibleOnly = args.boolean('producibleOnly');
					const pool = producibleOnly ? data.getAutomatableItems() : data.items;
					const found = this.matcher.rank(pool, query, item => item.name).slice(0, Math.max(1, limit));
					return {
						ok: true,
						kind: 'query',
						data: {
							items: found.map(item => ({className: item.className, name: item.name, form: item.form, sinkPoints: item.sinkPoints})),
							specialTargets: [
								{className: SpecialClasses.PowerTarget, name: 'Power (generators)', note: 'request ratePerMinute is megawatts'},
								{className: SpecialClasses.SinkPointsTarget, name: 'Sink points (AWESOME Sink)'},
							],
						},
					};
				},
			},
		];
	}

}
