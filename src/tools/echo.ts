import type { Tool } from './types.js';

export const echoTool: Tool = {
  name: 'echo',
  description: 'Echoes back the input message. Used for development and testing.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to echo back',
      },
    },
    required: ['message'],
  },
  async execute(args) {
    const { message } = args as { message: string };
    return { echoed: message };
  },
};
