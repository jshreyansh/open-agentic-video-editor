// Import all handler modules to trigger their registerTool() calls.
// This file must be imported once before the agent loop runs.
import './handlers/query-handlers'
import './handlers/clip-handlers'
import './handlers/media-handlers'
import './handlers/effects-handlers'
import './handlers/track-handlers'
import './handlers/caption-handlers'
import { registerTool } from './tool-registry'

// ask_user is a control flow tool — the loop intercepts it before calling the handler
registerTool({
  name: 'ask_user',
  description:
    'Ask the user a clarifying question when you genuinely need their input to proceed. Do NOT use this when you can answer via get_timeline_state or find_items. Provide options when there are a small number of clear choices.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of choices for the user to pick from',
      },
    },
    required: ['question'],
  },
  uiDescription: (args) => `Asking: "${String(args['question']).slice(0, 60)}"`,
  handler: async () => ({ ok: true, summary: 'Clarification requested' }),
})
