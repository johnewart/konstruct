/**
 * Example Konstruct plugin. Add to config: plugins.enabled: ['example']
 * Registers one tool: example_echo(message) -> returns the message.
 */
function register(api) {
  const { registerTool, addToolDefinitions, pluginConfig } = api;

  addToolDefinitions([
    {
      type: 'function',
      function: {
        name: 'example_echo',
        description: 'Echo back a message (example plugin tool).',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to echo back' },
          },
          required: ['message'],
        },
      },
    },
  ]);

  registerTool('example_echo', (args) => {
    const message = typeof args.message === 'string' ? args.message : String(args.message ?? '');
    return { result: `Echo: ${message}` };
  });
}

module.exports = { register };
