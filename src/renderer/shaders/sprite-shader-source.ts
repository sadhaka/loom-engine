// GLSL ES 3.00 shader source for the WebGL2 sprite batcher.
//
// One pair of shaders services every batched draw the WebGL2Device
// performs - sprites, tiles, particles, glyphs - by treating each
// quad as an instance with its own screen-space origin, pixel size,
// atlas UV rect, and RGBA tint. The vertex shader maps a static unit
// quad onto the per-instance origin/size and forwards UV + tint to
// the fragment shader, which samples the bound atlas and multiplies
// by tint.
//
// The host (JS) is responsible for iso projection and camera
// transform, mirroring what Canvas2DDevice does today. Keeping that
// math out of the shader makes the GL path identical-output to the
// Canvas2D path - very useful for parity testing and later perf
// tuning. The trade is per-instance JS work that could in principle
// move to the GPU; we measure that in phase 14.3.

export const SPRITE_VERT_SRC: string = [
  '#version 300 es',
  'precision highp float;',
  '',
  '// Per-vertex unit-quad position. Six vertices forming two',
  '// triangles cover (0,0)-(1,1) in normalized quad space.',
  'layout(location = 0) in vec2 a_quadVertex;',
  '',
  '// Per-instance attributes - vertexAttribDivisor(1).',
  'layout(location = 1) in vec2 a_origin;   // screen-pixel top-left of the quad',
  'layout(location = 2) in vec2 a_size;     // screen-pixel width, height',
  'layout(location = 3) in vec4 a_uvRect;   // u0, v0, u1, v1 within atlas',
  'layout(location = 4) in vec4 a_tint;     // r, g, b, a',
  '',
  'uniform vec2 u_viewport; // viewport in pixels',
  '',
  'out vec2 v_uv;',
  'out vec4 v_tint;',
  '',
  'void main() {',
  '  vec2 screenPx = a_origin + a_quadVertex * a_size;',
  '  // Map screen-pixel to clip-space NDC. Origin is top-left in',
  '  // pixel space; flip Y to match GL clip-space.',
  '  vec2 ndc;',
  '  ndc.x = (screenPx.x / u_viewport.x) * 2.0 - 1.0;',
  '  ndc.y = 1.0 - (screenPx.y / u_viewport.y) * 2.0;',
  '  gl_Position = vec4(ndc, 0.0, 1.0);',
  '',
  '  // UV is linearly interpolated between the rect corners using',
  '  // the unit-quad position as the mix factor.',
  '  v_uv = mix(a_uvRect.xy, a_uvRect.zw, a_quadVertex);',
  '  v_tint = a_tint;',
  '}',
  '',
].join('\n');

export const SPRITE_FRAG_SRC: string = [
  '#version 300 es',
  'precision highp float;',
  '',
  'in vec2 v_uv;',
  'in vec4 v_tint;',
  '',
  'uniform sampler2D u_atlas;',
  '',
  'out vec4 outColor;',
  '',
  'void main() {',
  '  vec4 sampled = texture(u_atlas, v_uv);',
  '  vec4 c = sampled * v_tint;',
  '  if (c.a <= 0.0) discard;',
  '  outColor = c;',
  '}',
  '',
].join('\n');

// Static unit-quad vertex data: two triangles covering 0..1 in xy.
// Vertex order top-left, bottom-left, top-right, top-right, bottom-
// left, bottom-right matches the UV mapping in the vertex shader.
// Six vertices x 2 floats = 12 floats.
export const UNIT_QUAD_VERTICES: Float32Array = new Float32Array([
  0, 0,   // top-left
  0, 1,   // bottom-left
  1, 0,   // top-right
  1, 0,   // top-right
  0, 1,   // bottom-left
  1, 1,   // bottom-right
]);
