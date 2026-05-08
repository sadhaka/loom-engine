// Loom Engine - client-side plugin SDK entrypoint (Phase 0.19).
//
// Re-exports types + registry + reference implementations under one
// import. Browser bundle re-exports this module via src/index.ts so a
// Founder can author a client-side Loom plugin with a single import:
//
//   import {
//     ClientPluginRegistry,
//     PluginError,
//     type IClientPlugin,
//   } from '@sadhaka/loom-engine';
//
// The TypeScript surface mirrors api/loom_ai_plugin_runtime.py where
// it makes sense for the browser. Names match the Python runtime so
// plugin authors moving between server-side (Python) and client-side
// (TypeScript) plugins do not need to remember two vocabularies.
export { PluginEntropy, PluginError, ALL_SCOPES, DEFAULT_PLUGIN_STORAGE_MAX_BYTES, DEFAULT_PLUGIN_TICK_BUDGET_MS, } from './types.js';
// ----- Registry + reference impls -----
export { ClientPluginRegistry, MapPluginStorage, ConsolePluginLogger, setWithTtl, getWithTtlCheck, } from './client-registry.js';
//# sourceMappingURL=index.js.map