import { toolRegistry } from './registry.js';
import { echoTool } from './echo.js';
import { timeByRegionTool } from './time.js';

// Register all tools here — one import per tool
toolRegistry.register(echoTool);
toolRegistry.register(timeByRegionTool);

export { toolRegistry };
