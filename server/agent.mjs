import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createPiModelRuntime } from './model-runtime.mjs';

const parameters = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: {} });

export function smallslopTools({ page, server }) {
  return [
    {
      name: 'smallslop_state', label: 'Read the page',
      description: 'Read the page state: panes, their contents, processes, and available commands.',
      parameters: parameters({}),
      execute: async (_id, _args, signal) => text(await page({ op: 'state' }, signal)),
    },
    {
      name: 'smallslop_command', label: 'Control the page',
      description: 'Execute a JSON command through the same Smallslop objects and debugger used by the page controls. Read smallslop_state for commands. Debugger requests use {op:"debug",request:{...}}.',
      parameters: parameters({ command: { type: 'string', description: 'A JSON object containing the command.' } }),
      execute: async (_id, { command }, signal) => text(await page(JSON.parse(command), signal)),
    },
    {
      name: 'smallslop_server', label: 'Use server objects',
      description: 'Send a JSON command to this page\'s server Smallslop runtime. Operations: state, schema, execute (sql, parameters), next/page (id, count, offset), close (id), completion (processId), send (target, selector, encoded args), inspector (action, value), debug (request). SQL results stay on the server. Close results when finished.',
      parameters: parameters({ command: { type: 'string', description: 'A JSON server command.' } }),
      execute: async (_id, { command }, signal) => text(await server(JSON.parse(command), signal)),
    },
  ];
}

export async function createPiAgent({ cwd, instructions, tools, onEvent }) {
  const { model, modelRuntime } = await createPiModelRuntime();
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd, agentDir: getAgentDir(), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => instructions,
  });
  await loader.reload();
  const { session, extensionsResult } = await createAgentSession({
    cwd, model, modelRuntime, settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd), thinkingLevel: 'low',
    customTools: tools, tools: tools.map(tool => tool.name),
  });
  if (extensionsResult.errors.length) {
    session.dispose();
    throw new Error(extensionsResult.errors.map(error => error.error).join('\n'));
  }
  let interrupted = false;
  const unsubscribe = session.subscribe(event => {
    if (interrupted && event.type === 'agent_start') session.agent.abort();
    if (interrupted) return;
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end') {
      onEvent({ role: 'assistant', text: event.assistantMessageEvent.content });
    }
    if (event.type === 'tool_execution_start') onEvent({ role: 'tool', text: `${event.toolName} ${JSON.stringify(event.args)}` });
    if (event.type === 'tool_execution_end') {
      const result = event.result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
      onEvent({ role: event.isError ? 'error' : 'result', text: `${event.toolName}: ${result || 'Image received.'}` });
    }
  });
  return {
    model: `${model.provider}/${model.id}`,
    async prompt(message, context) {
      interrupted = false;
      await session.prompt(`Captured request context: ${JSON.stringify(context)}\n\n${message}`);
      const last = session.messages.findLast(message => message.role === 'assistant');
      if (!interrupted && last?.stopReason === 'error') throw new Error(last.errorMessage || 'The model request failed.');
    },
    async interrupt() { interrupted = true; session.abortCompaction(); await session.abort(); },
    dispose() { unsubscribe(); session.dispose(); },
  };
}
