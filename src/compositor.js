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
        const { canvas, ctx, _off: off, _offctx: offctx } = this

        // Compose into offscreen buffer
        offctx.clearRect(0, 0, off.width, off.height)
        offctx.fillStyle = '#000'
        offctx.fillRect(0, 0, off.width, off.height)

        if (this._transition) {
            this._drawTransition(offctx)
        } else {
            this._drawLayers(this.layers, 1, offctx)
        }

        // Single atomic blit to the captured canvas — captureStream sees
        // either the previous complete frame or this new one, never a partial.
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(off, 0, 0)
    }

    _drawLayers(layers, masterOpacity, ctx) {
        const { canvas } = this
        const visible = layers.filter(l => l.visible && l.el)

        for (const layer of visible) {
            // Skip if the video element hasn't decoded a frame yet — avoids
            // brief black flashes when a source stalls or restarts.
            if (layer.el.readyState < 2) continue

            const x = layer.x * canvas.width
            const y = layer.y * canvas.height
            const w = layer.w * canvas.width
            const h = layer.h * canvas.height

            ctx.save()
            ctx.globalAlpha = layer.opacity * masterOpacity
            try {
                ctx.drawImage(layer.el, x, y, w, h)
            } catch { /* source frame unavailable */ }
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
