// Graphics device abstraction for the Loom Engine.
//
// All higher-level systems talk to IGraphicsDevice, never to the
// concrete backend. This is the Babylon.js ThinEngine split: lean
// GPU core (the device) + higher-level scene logic (everything
// else). See PRIOR-ART.md for the citation.
//
// Two backends ship over time:
//   Canvas2DDevice  - v1 primary, Phase 1
//   WebGL2Device    - Phase 2 if profiling demands
export {};
//# sourceMappingURL=graphics-device.js.map