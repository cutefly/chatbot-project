import { toolRegistry } from './registry.js';
import { echoTool } from './echo.js';
import { loadToolDefs } from './loader.js';

toolRegistry.register(echoTool);
loadToolDefs(toolRegistry);

export { toolRegistry };
