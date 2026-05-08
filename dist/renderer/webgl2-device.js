// WebGL2 backend for the Loom Engine.
//
// Phase 14.1 - lifts the Canvas2D ~2k sprite ceiling to 50k+ via
// instanced batching. Architecture:
//
//   drawSprite/drawTile/drawParticle/drawText
//     -> compute screen-space origin + size in JS (parity with
//        Canvas2DDevice math)
//     -> push instance into SpriteBatcher
//        -> on atlas/blend-mode change: flush
//          -> upload instance buffer (gl.bufferSubData)
//          -> drawArraysInstanced(TRIANGLES, 0, 6, instanceCount)
//     -> endFrame drains the last batch
//
// The Canvas2DDevice path is unchanged; this device implements the
// same IGraphicsDevice contract so consumers swap backends without
// touching call sites. Engine.create({ backend: 'webgl2' }) is the
// supported entry. EngineOptions.device lets advanced consumers
// inject a pre-built device for tree-shaking or shared-context
// scenarios.
//
// Context-loss handling: WebGL2 contexts can be lost when the GPU
// driver crashes, the tab is backgrounded for a long time, or a
// Chrome extension hijacks the context. We register webglcontext-
// lost / webglcontextrestored listeners and:
//   lost     -> preventDefault to opt into restore, mark all atlases
//               + GL objects invalid, stop drawing.
//   restored -> recompile shaders, recreate VAO + buffers, re-upload
//               every TextureAtlas from its cached source image.
// Frames during the lost interval no-op cleanly.
import { worldToScreen, } from './camera.js';
import { ISO_HALF_W, ISO_HALF_H, ISO_Z_SCALE, } from './iso-projection.js';
import { TextureAtlas, makeParticleDiscAtlas } from './texture-atlas.js';
import { SpriteBatcher, FLOATS_PER_INSTANCE, } from './sprite-batcher.js';
import { SPRITE_VERT_SRC, SPRITE_FRAG_SRC, UNIT_QUAD_VERTICES, } from './shaders/sprite-shader-source.js';
import { registerBackend } from '../engine.js';
const SCRATCH_VEC2 = { x: 0, y: 0 };
const SCRATCH_FRAME_SIZE = { w: 0, h: 0 };
const SCRATCH_UV = new Float32Array(4);
const SCRATCH_STATS = { flushCount: 0, instanceTotal: 0, capacity: 0 };
// Vertex attribute indices. Must agree with the layout(location=) in
// sprite-shader-source.ts.
const ATTRIB_QUAD_VERTEX = 0;
const ATTRIB_ORIGIN = 1;
const ATTRIB_SIZE = 2;
const ATTRIB_UV_RECT = 3;
const ATTRIB_TINT = 4;
// Bytes per instance. 12 floats * 4 bytes.
const INSTANCE_STRIDE_BYTES = FLOATS_PER_INSTANCE * 4;
// Initial dynamic-buffer capacity in instances. Grows by doubling
// whenever the batcher's CPU buffer outgrows it.
const INITIAL_INSTANCE_CAPACITY = 1024;
// Cache cap for drawText baked textures. Beyond this, we evict the
// oldest insertion to bound memory. 256 unique strings is generous
// for a typical scene.
const TEXT_CACHE_LIMIT = 256;
export class WebGL2Device {
    canvas;
    viewportWidth;
    viewportHeight;
    gl;
    program = null;
    vao = null;
    quadVBO = null;
    instanceVBO = null;
    // Bytes currently allocated for the instance VBO. Grows as the
    // batcher reports a larger CPU buffer.
    instanceVBOBytes = 0;
    atlases = [];
    nextAtlasHandle = 0;
    camera = null;
    drawCallCount = 0;
    batcher;
    // Lazy: only built on first drawParticle call. Tests bypass.
    particleAtlas = null;
    // drawText cache. Keyed by `${font}|${fillCss}|${align}|${baseline}|${text}`.
    // Insertion-order Map gives us LRU-by-recency for free since Map
    // iteration starts from oldest entry.
    textCache = new Map();
    // Context-loss state. While true, every draw is a no-op until we
    // recover. Listeners track the live state.
    contextLost = false;
    boundOnLost = null;
    boundOnRestored = null;
    // Test/diagnostic hooks.
    lastUpload = { count: 0, floats: 0 };
    constructor(canvas, gl) {
        this.canvas = canvas;
        this.viewportWidth = canvas.width;
        this.viewportHeight = canvas.height;
        var ctx = gl ?? canvas.getContext('webgl2');
        if (!ctx) {
            throw new Error('WebGL2Device: failed to acquire webgl2 context. ' +
                'Browsers without WebGL2 (Safari < 15, etc.) should fall back to Canvas2DDevice.');
        }
        this.gl = ctx;
        // Wire context-loss listeners early so partial setup failures
        // still get cleaned up. canvas may be a stub in tests; guard the
        // call to keep the path universal.
        if (typeof canvas.addEventListener === 'function') {
            this.boundOnLost = (e) => {
                e.preventDefault();
                this.handleContextLoss();
            };
            this.boundOnRestored = () => {
                this.handleContextRestored();
            };
            canvas.addEventListener('webglcontextlost', this.boundOnLost, false);
            canvas.addEventListener('webglcontextrestored', this.boundOnRestored, false);
        }
        // Pixel-art friendly defaults. Match Canvas2DDevice's
        // imageSmoothingEnabled = false. Per-atlas overrides happen in
        // texture-atlas.ts.
        this.gl.disable(this.gl.DEPTH_TEST);
        this.gl.disable(this.gl.CULL_FACE);
        this.gl.enable(this.gl.BLEND);
        this.initGLResources();
        // Batcher with a flush handler that does the actual GL upload +
        // draw. Bound here so we can reach this.gl + this.program.
        this.batcher = new SpriteBatcher((atlas, blend, data, count) => this.executeFlush(atlas, blend, data, count), INITIAL_INSTANCE_CAPACITY);
    }
    // Compile + link program, build VAO + buffers. Idempotent: called
    // from constructor and again on context-restore.
    initGLResources() {
        var gl = this.gl;
        this.program = this.compileProgram();
        if (!this.program)
            return;
        var vao = gl.createVertexArray();
        if (!vao)
            return;
        gl.bindVertexArray(vao);
        this.vao = vao;
        // Static unit-quad. 6 vertices x 2 floats = 12 floats. Bound to
        // attrib 0 with divisor 0.
        var quad = gl.createBuffer();
        if (!quad)
            return;
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, UNIT_QUAD_VERTICES, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(ATTRIB_QUAD_VERTEX);
        gl.vertexAttribPointer(ATTRIB_QUAD_VERTEX, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(ATTRIB_QUAD_VERTEX, 0);
        this.quadVBO = quad;
        // Dynamic instance VBO. Bound to attribs 1..4 with divisor 1.
        var inst = gl.createBuffer();
        if (!inst)
            return;
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        var initBytes = INITIAL_INSTANCE_CAPACITY * INSTANCE_STRIDE_BYTES;
        gl.bufferData(gl.ARRAY_BUFFER, initBytes, gl.DYNAMIC_DRAW);
        this.instanceVBO = inst;
        this.instanceVBOBytes = initBytes;
        // origin: 2 floats at offset 0
        gl.enableVertexAttribArray(ATTRIB_ORIGIN);
        gl.vertexAttribPointer(ATTRIB_ORIGIN, 2, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 0);
        gl.vertexAttribDivisor(ATTRIB_ORIGIN, 1);
        // size: 2 floats at offset 8
        gl.enableVertexAttribArray(ATTRIB_SIZE);
        gl.vertexAttribPointer(ATTRIB_SIZE, 2, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 8);
        gl.vertexAttribDivisor(ATTRIB_SIZE, 1);
        // uvRect: 4 floats at offset 16
        gl.enableVertexAttribArray(ATTRIB_UV_RECT);
        gl.vertexAttribPointer(ATTRIB_UV_RECT, 4, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 16);
        gl.vertexAttribDivisor(ATTRIB_UV_RECT, 1);
        // tint: 4 floats at offset 32
        gl.enableVertexAttribArray(ATTRIB_TINT);
        gl.vertexAttribPointer(ATTRIB_TINT, 4, gl.FLOAT, false, INSTANCE_STRIDE_BYTES, 32);
        gl.vertexAttribDivisor(ATTRIB_TINT, 1);
        gl.bindVertexArray(null);
    }
    compileProgram() {
        var gl = this.gl;
        var vert = gl.createShader(gl.VERTEX_SHADER);
        var frag = gl.createShader(gl.FRAGMENT_SHADER);
        if (!vert || !frag)
            return null;
        gl.shaderSource(vert, SPRITE_VERT_SRC);
        gl.compileShader(vert);
        if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
            var vlog = gl.getShaderInfoLog(vert) ?? '';
            gl.deleteShader(vert);
            gl.deleteShader(frag);
            throw new Error('WebGL2Device: vertex shader compile failed: ' + vlog);
        }
        gl.shaderSource(frag, SPRITE_FRAG_SRC);
        gl.compileShader(frag);
        if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
            var flog = gl.getShaderInfoLog(frag) ?? '';
            gl.deleteShader(vert);
            gl.deleteShader(frag);
            throw new Error('WebGL2Device: fragment shader compile failed: ' + flog);
        }
        var program = gl.createProgram();
        if (!program) {
            gl.deleteShader(vert);
            gl.deleteShader(frag);
            return null;
        }
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            var plog = gl.getProgramInfoLog(program) ?? '';
            gl.deleteProgram(program);
            gl.deleteShader(vert);
            gl.deleteShader(frag);
            throw new Error('WebGL2Device: program link failed: ' + plog);
        }
        // Shaders are owned by the program after attach + link.
        gl.deleteShader(vert);
        gl.deleteShader(frag);
        var uViewport = gl.getUniformLocation(program, 'u_viewport');
        var uAtlas = gl.getUniformLocation(program, 'u_atlas');
        return { program: program, uViewport: uViewport, uAtlas: uAtlas };
    }
    handleContextLoss() {
        this.contextLost = true;
        // Mark all atlases invalid. Their GL textures are gone.
        for (var i = 0; i < this.atlases.length; i++) {
            var a = this.atlases[i];
            if (a)
                a.handleContextLoss();
        }
        this.textCache.forEach((t) => t.handleContextLoss());
        if (this.particleAtlas)
            this.particleAtlas.handleContextLoss();
        // GL objects are invalid; drop refs so re-init works clean.
        this.program = null;
        this.vao = null;
        this.quadVBO = null;
        this.instanceVBO = null;
        this.instanceVBOBytes = 0;
    }
    handleContextRestored() {
        this.contextLost = false;
        this.initGLResources();
        var gl = this.gl;
        // Re-upload every live atlas from its cached source image.
        for (var i = 0; i < this.atlases.length; i++) {
            var a = this.atlases[i];
            if (a && !a.released)
                a.upload(gl);
        }
        this.textCache.forEach((t) => t.upload(gl));
        if (this.particleAtlas)
            this.particleAtlas.upload(gl);
    }
    beginFrame() {
        this.drawCallCount = 0;
        this.batcher.beginFrame();
        if (this.contextLost)
            return;
        var gl = this.gl;
        gl.viewport(0, 0, this.viewportWidth, this.viewportHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (this.program && this.vao) {
            gl.useProgram(this.program.program);
            gl.bindVertexArray(this.vao);
            // Viewport uniform changes only with viewport size, which is
            // currently fixed at construction. Set every frame anyway -
            // negligible cost and keeps the path simple if dynamic resize
            // is added later.
            if (this.program.uViewport) {
                gl.uniform2f(this.program.uViewport, this.viewportWidth, this.viewportHeight);
            }
            if (this.program.uAtlas) {
                gl.uniform1i(this.program.uAtlas, 0);
            }
            gl.activeTexture(gl.TEXTURE0);
        }
    }
    endFrame() {
        this.batcher.endFrame();
        if (this.contextLost)
            return;
        var gl = this.gl;
        gl.bindVertexArray(null);
    }
    setCamera(cam) {
        this.camera = cam;
    }
    registerAtlas(desc) {
        var handle = this.nextAtlasHandle++;
        var atlas = new TextureAtlas(this.contextLost ? null : this.gl, desc);
        this.atlases[handle] = atlas;
        return handle;
    }
    releaseAtlas(handle) {
        var a = this.atlases[handle];
        if (!a)
            return;
        a.dispose(this.contextLost ? null : this.gl);
        this.atlases[handle] = null;
    }
    drawSprite(worldX, worldY, worldZ, atlas, frame, tint) {
        if (this.contextLost)
            return;
        var a = this.atlases[atlas];
        if (!a || a.released)
            return;
        var cam = this.camera;
        if (!cam)
            return;
        if (!a.lookupFrameSize(frame, SCRATCH_FRAME_SIZE))
            return;
        if (!a.lookupUVRect(frame, SCRATCH_UV, 0))
            return;
        // Iso project: world (x, y, z) -> iso (sx, sy).
        var isoX = (worldX - worldY) * ISO_HALF_W;
        var isoY = (worldX + worldY) * ISO_HALF_H - worldZ * ISO_Z_SCALE;
        worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
        var dw = SCRATCH_FRAME_SIZE.w * cam.zoom;
        var dh = SCRATCH_FRAME_SIZE.h * cam.zoom;
        var dx = SCRATCH_VEC2.x - dw / 2;
        var dy = SCRATCH_VEC2.y - dh;
        var tr = 1, tg = 1, tb = 1, ta = 1;
        if (tint) {
            tr = tint.r;
            tg = tint.g;
            tb = tint.b;
            ta = tint.a;
        }
        this.batcher.submit(a, 'alpha', dx, dy, dw, dh, SCRATCH_UV[0] ?? 0, SCRATCH_UV[1] ?? 0, SCRATCH_UV[2] ?? 1, SCRATCH_UV[3] ?? 1, tr, tg, tb, ta);
        this.drawCallCount++;
    }
    drawTile(tileX, tileY, atlas, frame) {
        if (this.contextLost)
            return;
        var a = this.atlases[atlas];
        if (!a || a.released)
            return;
        var cam = this.camera;
        if (!cam)
            return;
        if (!a.lookupFrameSize(frame, SCRATCH_FRAME_SIZE))
            return;
        if (!a.lookupUVRect(frame, SCRATCH_UV, 0))
            return;
        // Tile -> iso (no Z; ground plane).
        var isoX = (tileX - tileY) * ISO_HALF_W;
        var isoY = (tileX + tileY) * ISO_HALF_H;
        worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
        var dw = SCRATCH_FRAME_SIZE.w * cam.zoom;
        var dh = SCRATCH_FRAME_SIZE.h * cam.zoom;
        // Tile anchor: top of diamond aligned to iso point, drawn
        // centered horizontally. Matches Canvas2DDevice.drawTile.
        var dx = SCRATCH_VEC2.x - dw / 2;
        var dy = SCRATCH_VEC2.y - dh / 2;
        this.batcher.submit(a, 'alpha', dx, dy, dw, dh, SCRATCH_UV[0] ?? 0, SCRATCH_UV[1] ?? 0, SCRATCH_UV[2] ?? 1, SCRATCH_UV[3] ?? 1, 1, 1, 1, 1);
        this.drawCallCount++;
    }
    drawText(worldX, worldY, text, style) {
        if (this.contextLost)
            return;
        var cam = this.camera;
        if (!cam)
            return;
        if (text.length === 0)
            return;
        var atlas = this.getOrBakeText(text, style);
        if (!atlas)
            return;
        // Text overlay uses screen-space directly - no iso projection,
        // matching Canvas2DDevice behavior so labels stay axis-aligned.
        worldToScreen(cam, worldX, worldY, SCRATCH_VEC2);
        var sx = SCRATCH_VEC2.x;
        var sy = SCRATCH_VEC2.y;
        if (!atlas.lookupFrameSize(0, SCRATCH_FRAME_SIZE))
            return;
        var dw = SCRATCH_FRAME_SIZE.w;
        var dh = SCRATCH_FRAME_SIZE.h;
        // Align is encoded into the baked frame directly (the fillText
        // call honors textAlign / textBaseline before bake), so the quad
        // anchor is just the screen position.
        var dx = sx;
        var dy = sy - dh; // baseline offset baked in; align top of quad
        if (style.align === 'center') {
            dx -= dw / 2;
        }
        else if (style.align === 'right') {
            dx -= dw;
        }
        if (style.baseline === 'top') {
            dy = sy;
        }
        else if (style.baseline === 'middle') {
            dy = sy - dh / 2;
        }
        this.batcher.submit(atlas, 'alpha', dx, dy, dw, dh, 0, 0, 1, 1, style.fill.r, style.fill.g, style.fill.b, style.fill.a);
        this.drawCallCount++;
    }
    drawParticle(worldX, worldY, worldZ, size, color, additive) {
        if (this.contextLost)
            return;
        var cam = this.camera;
        if (!cam)
            return;
        if (size <= 0 || color.a <= 0)
            return;
        if (!this.particleAtlas) {
            this.particleAtlas = makeParticleDiscAtlas(this.gl);
        }
        var atlas = this.particleAtlas;
        if (!atlas || atlas.released)
            return;
        var isoX = (worldX - worldY) * ISO_HALF_W;
        var isoY = (worldX + worldY) * ISO_HALF_H - worldZ * ISO_Z_SCALE;
        worldToScreen(cam, isoX, isoY, SCRATCH_VEC2);
        var sx = SCRATCH_VEC2.x;
        var sy = SCRATCH_VEC2.y;
        var r = (size / 2) * cam.zoom;
        var dx = sx - r;
        var dy = sy - r;
        var dw = r * 2;
        var dh = r * 2;
        var blend = additive ? 'add' : 'alpha';
        this.batcher.submit(atlas, blend, dx, dy, dw, dh, 0, 0, 1, 1, color.r, color.g, color.b, color.a);
        this.drawCallCount++;
    }
    getDrawCallCount() {
        return this.drawCallCount;
    }
    // Tear down GL objects and detach context-loss listeners. Idempo-
    // tent: safe to call from engine.dispose paths that may also be
    // hit on hot-reload during dev.
    dispose() {
        var gl = this.gl;
        if (this.boundOnLost && typeof this.canvas.removeEventListener === 'function') {
            this.canvas.removeEventListener('webglcontextlost', this.boundOnLost, false);
        }
        if (this.boundOnRestored && typeof this.canvas.removeEventListener === 'function') {
            this.canvas.removeEventListener('webglcontextrestored', this.boundOnRestored, false);
        }
        this.boundOnLost = null;
        this.boundOnRestored = null;
        if (!this.contextLost) {
            for (var i = 0; i < this.atlases.length; i++) {
                var a = this.atlases[i];
                if (a)
                    a.dispose(gl);
            }
            this.atlases = [];
            this.textCache.forEach((t) => t.dispose(gl));
            this.textCache.clear();
            if (this.particleAtlas) {
                this.particleAtlas.dispose(gl);
                this.particleAtlas = null;
            }
            if (this.quadVBO)
                gl.deleteBuffer(this.quadVBO);
            if (this.instanceVBO)
                gl.deleteBuffer(this.instanceVBO);
            if (this.vao)
                gl.deleteVertexArray(this.vao);
            if (this.program)
                gl.deleteProgram(this.program.program);
        }
        this.quadVBO = null;
        this.instanceVBO = null;
        this.vao = null;
        this.program = null;
    }
    // Diagnostic accessor for tests + perf benches.
    getBatcherStats() {
        this.batcher.getStats(SCRATCH_STATS);
        return {
            flushCount: SCRATCH_STATS.flushCount,
            instanceTotal: SCRATCH_STATS.instanceTotal,
            capacity: SCRATCH_STATS.capacity,
        };
    }
    // Diagnostic accessor for tests: last upload size + count seen by
    // the flush handler.
    _peekLastUpload() {
        return { count: this.lastUpload.count, floats: this.lastUpload.floats };
    }
    // The actual GL flush. Bound as a closure into SpriteBatcher at
    // construction. Not part of the public API.
    executeFlush(atlas, blend, data, count) {
        if (this.contextLost)
            return;
        var gl = this.gl;
        var program = this.program;
        if (!program || !this.vao || !this.instanceVBO)
            return;
        if (!atlas.texture)
            return; // atlas never uploaded (e.g. context-lost mid-frame)
        // Atlas binding. Fragment shader samples u_atlas at unit 0.
        gl.activeTexture(gl.TEXTURE0);
        atlas.bind(gl);
        // Blend mode mapping. Pre-multiplied alpha is left for a future
        // pass; v1 uses straight alpha (matches Canvas2DDevice's default
        // composite with PNG sources). 'add' is additive blend.
        if (blend === 'add') {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        }
        else {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        // Upload instance data. Grow the VBO if the CPU buffer outgrew
        // it. We upload a sub-range matching count, not the full buffer
        // - smaller PCIe transfers when the batch is small.
        var bytesNeeded = count * INSTANCE_STRIDE_BYTES;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
        if (bytesNeeded > this.instanceVBOBytes) {
            // Grow to the next power of two of the CPU buffer size.
            var newBytes = this.instanceVBOBytes;
            while (newBytes < bytesNeeded)
                newBytes *= 2;
            gl.bufferData(gl.ARRAY_BUFFER, newBytes, gl.DYNAMIC_DRAW);
            this.instanceVBOBytes = newBytes;
        }
        // Upload only the live prefix.
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * FLOATS_PER_INSTANCE));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        this.lastUpload.count = count;
        this.lastUpload.floats = count * FLOATS_PER_INSTANCE;
    }
    // Bake one (text, style) into a TextureAtlas with a single frame
    // covering the whole canvas. Cached so repeated draws of the same
    // string reuse the texture.
    getOrBakeText(text, style) {
        var fillKey = style.fill.r.toFixed(3) + ',' + style.fill.g.toFixed(3) + ',' +
            style.fill.b.toFixed(3) + ',' + style.fill.a.toFixed(3);
        var key = style.font + '|' + fillKey + '|' +
            (style.align ?? 'left') + '|' + (style.baseline ?? 'alphabetic') + '|' +
            text;
        var hit = this.textCache.get(key);
        if (hit && !hit.released && hit.texture)
            return hit;
        if (typeof document === 'undefined')
            return null;
        // Measure the text using a temporary canvas. measureText returns
        // width; for height we use a conservative em-based estimate from
        // the font string. For pixel-art fonts a tight measurement isn't
        // critical because the texture is power-of-2 padded anyway.
        var probe = document.createElement('canvas');
        probe.width = 16;
        probe.height = 16;
        var probeCtx = probe.getContext('2d');
        if (!probeCtx)
            return null;
        probeCtx.font = style.font;
        var metrics = probeCtx.measureText(text);
        var asc = metrics.actualBoundingBoxAscent ?? 12;
        var desc = metrics.actualBoundingBoxDescent ?? 4;
        var w = Math.max(1, Math.ceil(metrics.width));
        var h = Math.max(1, Math.ceil(asc + desc));
        // Pad by 2px each side so antialiasing edges aren't clamped.
        var padW = w + 4;
        var padH = h + 4;
        var c = document.createElement('canvas');
        c.width = padW;
        c.height = padH;
        var ctx = c.getContext('2d');
        if (!ctx)
            return null;
        ctx.font = style.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        // Bake white text - the tint comes from the per-instance attrib
        // multiplied in the fragment shader. This means one cache entry
        // per (text, font, align, baseline) covers all colors. The fill
        // key is still part of the cache key so future tinting variants
        // (e.g. drop shadow fold-in) compose correctly without aliasing.
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, 2, 2 + asc);
        var atlas = new TextureAtlas(this.gl, {
            image: c,
            frames: [{ x: 0, y: 0, w: padW, h: padH }],
            name: 'text:' + key,
        });
        // Bound cache. Evict oldest if past limit. Map iteration order
        // gives oldest-first so .keys().next() suffices.
        if (this.textCache.size >= TEXT_CACHE_LIMIT) {
            var firstKey = this.textCache.keys().next().value;
            if (firstKey !== undefined) {
                var oldest = this.textCache.get(firstKey);
                if (oldest)
                    oldest.dispose(this.gl);
                this.textCache.delete(firstKey);
            }
        }
        this.textCache.set(key, atlas);
        return atlas;
    }
}
// Self-register the WebGL2 backend so consumers can write
// Engine.create({ backend: 'webgl2' }) once they import this module.
// Marked /*#__PURE__*/ so a bundler can eliminate the registration
// when WebGL2Device itself is unused, completing the tree-shake
// story for Canvas2D-only consumers.
/*#__PURE__*/ registerBackend('webgl2', (canvas) => new WebGL2Device(canvas));
//# sourceMappingURL=webgl2-device.js.map