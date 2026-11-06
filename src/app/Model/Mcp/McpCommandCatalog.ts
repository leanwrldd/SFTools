import {Injectable} from '@angular/core';
import {AppCommands} from '@src/Model/Mcp/Commands/AppCommands';
import {CalculatorCommands} from '@src/Model/Mcp/Commands/CalculatorCommands';
import {CalculatorSettingsCommands} from '@src/Model/Mcp/Commands/CalculatorSettingsCommands';
import {DataCommands} from '@src/Model/Mcp/Commands/DataCommands';
import {ResultCommands} from '@src/Model/Mcp/Commands/ResultCommands';
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
		_calculator: CalculatorCommands,
		_calculatorSettings: CalculatorSettingsCommands,
		_results: ResultCommands,
		_data: DataCommands,
	)
	{
	}

}
