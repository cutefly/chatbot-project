import { toolRegistry } from './registry.js';
import { echoTool } from './echo.js';

// Register all tools here — one import per tool
toolRegistry.register(echoTool);

export { toolRegistry };
