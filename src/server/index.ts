// Loom Engine - server-side entry point.
//
// NOT imported by the browser bundle. The default browser export
// (`@sadhaka/loom-engine`) deliberately excludes everything in this
// module so LLM-backed plugins, server-side storage adapters, and
// other Node-only code never ship to the client.
//
// Consumers wire LLM-backed plugins by implementing IAIPlugin and
// registering with AIPluginRegistry. A typical server bootstrap:
//
//   import {
//     AIPluginRegistry,
//     MapPluginStorage,
//     ConsolePluginLogger,
//   } from '@sadhaka/loom-engine/server';
//
//   const registry = new AIPluginRegistry();
//   const storage = new MapPluginStorage();
//   registry.register(new MyAnthropicPlugin({...}));
//   // per-tick / per-event:
//   const ctx = buildPluginContext({ pluginName: 'my-plugin', storage });
//   const emitted = await registry.dispatchTick(ctx);
//   // emitted.characterEvents -> v1 stream
//   // emitted.zoneEvents      -> v2 zone log + presence fanout
//
// This entry corresponds to the "./server" exports field added in
// package.json (LOOM-DIRECTOR-PROTOCOL-V2 §5.5).

// ----- AI Plugin SPI -----
export type {
  IAIPlugin,
  EmittedEvents,
  PluginContext,
  PeerInfo,
  PlayerAction,
  CharacterState,
  PluginStorage,
  PluginLogger,
  ZoneEvent,
} from '../director/ai/plugin.js';

// ----- Registry -----
export {
  AIPluginRegistry,
  AIPluginDuplicateError,
} from '../director/ai/ai-plugin-registry.js';

// ----- Reference impls -----
export {
  MapPluginStorage,
  ConsolePluginLogger,
  buildPluginContext,
} from '../director/ai/plugin-context.js';
export type { BuildPluginContextOptions } from '../director/ai/plugin-context.js';

export {
  MockAIPlugin,
} from '../director/ai/mock-ai-plugin.js';
export type {
  MockAIPluginOptions,
  MockAIPluginScriptEntry,
} from '../director/ai/mock-ai-plugin.js';
