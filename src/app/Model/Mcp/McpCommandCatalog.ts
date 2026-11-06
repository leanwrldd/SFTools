import {Injectable} from '@angular/core';
import {AppCommands} from '@src/Model/Mcp/Commands/AppCommands';
import {PlanCommands} from '@src/Model/Mcp/Commands/PlanCommands';
import {PlannerCommands} from '@src/Model/Mcp/Commands/PlannerCommands';
import {McpCommandBus} from '@src/Model/Mcp/McpCommandBus';

/**
 * Creating a command group registers its commands on the bus. The desktop bridge (step 3) injects this catalog once at startup;
 * nothing instantiates it before then, so the app behaves exactly as before.
 */
@Injectable({providedIn: 'root'})
export class McpCommandCatalog
{

	public constructor(
		public readonly bus: McpCommandBus,
		// Injected for their side effect of registering commands.
		_app: AppCommands,
		_plans: PlanCommands,
		_planner: PlannerCommands,
	)
	{
	}

}
