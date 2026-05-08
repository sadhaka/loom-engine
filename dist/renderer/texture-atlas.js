// TextureAtlas - GL texture wrapper for the WebGL2 backend.
//
// Wraps a single GL texture plus a frame-rect lookup table. The
// device passes an AtlasDescriptor at registerAtlas time; we upload
// the source image as a texture and pre-compute UV rects per frame
// so drawSprite/drawTile can look up by frame index without a divide
// in the hot path.
//
// Texture coordinates use UNPACK_FLIP_Y_WEBGL=true on upload so frame
// (x, y) - which the AtlasDescriptor specifies in top-left source
// pixel coords - maps directly to UVs of (x/W, y/H, (x+w)/W, (y+h)/H)
// in the GL texture. The shader uses the unit-quad vertex (0..1) as
// the mix factor between (u0, v0) and (u1, v1).
//
// Context-loss handling: the device watches the canvas for
// 'webglcontextlost' and calls handleContextLoss() on every atlas
// to mark them invalid. On 'webglcontextrestored' the device calls
// rehydrate(gl) which re-uploads the cached source image.
export class TextureAtlas {
    // GL texture object. Null while the context is lost or before
    // upload. drawSprite paths must check before binding.
    texture = null;
    // Atlas dimensions in pixels - cached because the descriptor's
    // image may be reclaimed from layout flow but the dims do not
    // change.
    width;
    height;
    // Pre-computed UV rects. Layout: 4 floats per frame
    // [u0, v0, u1, v1]. Indexed by frame number * 4. Storing as a
    // single Float32Array keeps lookup branchless and cache-friendly
    // when the batcher iterates many sprites.
    uvRects;
    // Pre-computed frame sizes in pixels. Layout: 2 floats per frame
    // [w, h]. drawSprite multiplies by camera zoom.
    frameSizes;
    frameCount;
    // Optional debug name for logging.
    name;
    // Source image kept for context-restore rehydrate. AtlasDescriptor
    // owns the image lifetime; we hold a reference but never mutate.
    sourceImage;
    // Marker to skip use-after-release. releaseAtlas sets this; the
    // device's draw paths bail out on released atlases.
    released = false;
    constructor(gl, desc) {
        this.sourceImage = desc.image;
        this.name = desc.name ?? 'unnamed';
        // Image dimensions vary by source type; ImageBitmap, HTMLImage-
        // Element and HTMLCanvasElement all expose width/height the same
        // way.
        this.width = desc.image.width;
        this.height = desc.image.height;
        this.frameCount = desc.frames.length;
        this.uvRects = new Float32Array(this.frameCount * 4);
        this.frameSizes = new Float32Array(this.frameCount * 2);
        var W = this.width || 1;
        var H = this.height || 1;
        for (var i = 0; i < this.frameCount; i++) {
            var f = desc.frames[i];
            if (!f)
                continue;
            var base4 = i * 4;
            var base2 = i * 2;
            this.uvRects[base4 + 0] = f.x / W;
            this.uvRects[base4 + 1] = f.y / H;
            this.uvRects[base4 + 2] = (f.x + f.w) / W;
            this.uvRects[base4 + 3] = (f.y + f.h) / H;
            this.frameSizes[base2 + 0] = f.w;
            this.frameSizes[base2 + 1] = f.h;
        }
        if (gl) {
            this.upload(gl);
        }
    }
    // Upload source image to a GL texture. Used at construction and on
    // context-restore. Idempotent: deletes any prior texture first.
    upload(gl) {
        if (this.released)
            return;
        if (this.texture) {
            gl.deleteTexture(this.texture);
            this.texture = null;
        }
        var tex = gl.createTexture();
        if (!tex) {
            // createTexture returns null only on context-lost; bail and
            // leave this.texture null. The device will retry on restore.
            return;
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        // Pixel-art friendly defaults to match Canvas2DDevice's
        // imageSmoothingEnabled = false. Consumers can override after
        // registerAtlas via the returned handle if they need bilinear.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sourceImage);
        this.texture = tex;
    }
    // Bind for sampling. Caller has the active texture unit set.
    bind(gl) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    // Mark texture invalid - context lost. The GL object is already
    // gone; we just clear the JS reference so subsequent draws skip.
    handleContextLoss() {
        this.texture = null;
    }
    dispose(gl) {
        this.released = true;
        if (gl && this.texture) {
            gl.deleteTexture(this.texture);
        }
        this.texture = null;
    }
    // Look up the UV rect for a frame index. Returns false if the
    // frame is out of range so the caller can skip the draw safely.
    // out is filled with [u0, v0, u1, v1].
    lookupUVRect(frame, out, offset) {
        if (frame < 0 || frame >= this.frameCount)
            return false;
        var base = frame * 4;
        out[offset + 0] = this.uvRects[base + 0] ?? 0;
        out[offset + 1] = this.uvRects[base + 1] ?? 0;
        out[offset + 2] = this.uvRects[base + 2] ?? 0;
        out[offset + 3] = this.uvRects[base + 3] ?? 0;
        return true;
    }
    // Look up the frame width/height in pixels.
    lookupFrameSize(frame, out) {
        if (frame < 0 || frame >= this.frameCount)
            return false;
        var base = frame * 2;
        out.w = this.frameSizes[base + 0] ?? 0;
        out.h = this.frameSizes[base + 1] ?? 0;
        return true;
    }
}
// Build a tiny built-in atlas containing a single soft-disc frame
// for drawParticle. 64 x 64 RGBA, white center fading to transparent
// edge. Returned wrapped in a TextureAtlas with one frame at index 0.
//
// Lazy-built on first drawParticle call. Headless / Node tests pass
// gl=null; the descriptor is still valid and the GL upload happens
// later when (if) the context is provided.
export function makeParticleDiscAtlas(gl) {
    if (typeof document === 'undefined')
        return null;
    var size = 64;
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var ctx = c.getContext('2d');
    if (!ctx)
        return null;
    var center = size / 2;
    var grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();
    return new TextureAtlas(gl, {
        image: c,
        frames: [{ x: 0, y: 0, w: size, h: size }],
        name: 'particle-disc',
    });
}
//# sourceMappingURL=texture-atlas.js.map