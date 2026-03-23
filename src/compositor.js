/**
 * Compositor engine — draws scene layers onto a canvas at 30fps.
 * Each layer references a source key in window.__EluthStreamSources.
 */

export class Compositor {
    constructor(canvas) {
        this.canvas  = canvas
        this.ctx     = canvas.getContext('2d')
        this.layers  = []       // [{ id, sourceKey, x, y, w, h, opacity, visible, el }]
        this.running = false
        this.rafId   = null
        this._transition = null // { fromLayers, toLayers, type, duration, startedAt }

        // Offscreen buffer: we compose here then blit in one drawImage call,
        // so captureStream never snapshots a partially-drawn frame.
        this._off    = document.createElement('canvas')
        this._off.width  = canvas.width
        this._off.height = canvas.height
        this._offctx = this._off.getContext('2d')
    }

    // ── Source elements ──────────────────────────────────────────────────────

    /** Attach a live HTMLVideoElement to a layer by source key */
    attachSource(sourceKey, videoEl) {
        for (const layer of this.layers) {
            if (layer.sourceKey === sourceKey) layer.el = videoEl
        }
    }

    detachSource(sourceKey) {
        for (const layer of this.layers) {
            if (layer.sourceKey === sourceKey) layer.el = null
        }
    }

    // ── Layer management ─────────────────────────────────────────────────────

    setLayers(layers) {
        // Preserve attached elements across layer updates
        const elMap = {}
        for (const l of this.layers) { if (l.el) elMap[l.sourceKey] = l.el }
        this.layers = layers.map(l => ({ ...l, el: elMap[l.sourceKey] ?? null }))
    }

    // ── Draw loop ────────────────────────────────────────────────────────────

    start() {
        if (this.running) return
        this.running = true
        const loop = () => {
            if (!this.running) return
            this._draw()
            this.rafId = requestAnimationFrame(loop)
        }
        this.rafId = requestAnimationFrame(loop)
    }

    stop() {
        this.running = false
        if (this.rafId) cancelAnimationFrame(this.rafId)
        this.rafId = null
    }

    _draw() {
        const { _off: off, _offctx: offctx } = this

        // Compose full frame into offscreen buffer
        offctx.clearRect(0, 0, off.width, off.height)
        offctx.fillStyle = '#000'
        offctx.fillRect(0, 0, off.width, off.height)

        if (this._transition) {
            this._drawTransition(offctx)
        } else {
            this._drawLayers(this.layers, 1, offctx)
        }

        // Blit complete frame onto the captured canvas in one operation.
        // No clearRect here — the GPU compositor thread can sample the canvas
        // between clearRect and drawImage, producing a transparent flash.
        // The offscreen canvas is fully opaque so drawImage overwrites everything.
        this.ctx.drawImage(off, 0, 0)
    }

    _drawLayers(layers, masterOpacity, ctx) {
        const { canvas } = this
        const visible = layers.filter(l => l.visible && l.el)

        for (const layer of visible) {
            const x = layer.x * canvas.width
            const y = layer.y * canvas.height
            const w = layer.w * canvas.width
            const h = layer.h * canvas.height

            ctx.save()
            ctx.globalAlpha = layer.opacity * masterOpacity

            if (layer.el.readyState >= 2) {
                try {
                    ctx.drawImage(layer.el, x, y, w, h)
                    // Cache the frame so a brief stall shows the last good frame
                    // rather than dropping to transparent.
                    if (!layer._frameCache) {
                        layer._frameCache = document.createElement('canvas')
                        layer._frameCacheCtx = layer._frameCache.getContext('2d')
                    }
                    const vw = layer.el.videoWidth  || 640
                    const vh = layer.el.videoHeight || 360
                    if (layer._frameCache.width !== vw || layer._frameCache.height !== vh) {
                        layer._frameCache.width  = vw
                        layer._frameCache.height = vh
                    }
                    layer._frameCacheCtx.drawImage(layer.el, 0, 0, vw, vh)
                } catch { /* frame unavailable */ }
            } else if (layer._frameCache) {
                // Source stalled — draw the last known-good frame
                ctx.drawImage(layer._frameCache, x, y, w, h)
            }

            ctx.restore()
        }
    }

    // ── Transitions ──────────────────────────────────────────────────────────

    /**
     * Begin a transition from current layers to new layers.
     * @param {Array}  newLayers  The incoming layer set
     * @param {string} type       'cut' | 'fade'
     * @param {number} duration   ms (ignored for cut)
     */
    beginTransition(newLayers, type, duration) {
        const elMap = {}
        for (const l of this.layers) { if (l.el) elMap[l.sourceKey] = l.el }

        if (type === 'cut') {
            this.setLayers(newLayers)
            return
        }

        this._transition = {
            type,
            fromLayers: this.layers.slice(),
            toLayers:   newLayers.map(l => ({ ...l, el: elMap[l.sourceKey] ?? null })),
            duration,
            startedAt:  performance.now(),
        }
    }

    _drawTransition(ctx) {
        const t   = this._transition
        const now = performance.now()
        const p   = Math.min(1, (now - t.startedAt) / t.duration)

        if (t.type === 'fade') {
            this._drawLayers(t.fromLayers, 1 - p, ctx)
            this._drawLayers(t.toLayers,   p,     ctx)
        }

        if (p >= 1) {
            this.layers      = t.toLayers
            this._transition = null
        }
    }

    // ── Output stream ────────────────────────────────────────────────────────

    captureStream(fps = 30) {
        return this.canvas.captureStream(fps)
    }
}
