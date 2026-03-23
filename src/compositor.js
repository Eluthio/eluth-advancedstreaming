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
        const { canvas, ctx } = this
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        if (this._transition) {
            this._drawTransition()
        } else {
            this._drawLayers(this.layers, 1)
        }
    }

    _drawLayers(layers, masterOpacity) {
        const { canvas, ctx } = this
        const visible = layers.filter(l => l.visible && l.el)

        for (const layer of visible) {
            const x = layer.x * canvas.width
            const y = layer.y * canvas.height
            const w = layer.w * canvas.width
            const h = layer.h * canvas.height

            ctx.save()
            ctx.globalAlpha = layer.opacity * masterOpacity
            try {
                ctx.drawImage(layer.el, x, y, w, h)
            } catch { /* source not ready */ }
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

    _drawTransition() {
        const t   = this._transition
        const now = performance.now()
        const p   = Math.min(1, (now - t.startedAt) / t.duration)

        if (t.type === 'fade') {
            this._drawLayers(t.fromLayers, 1 - p)
            this._drawLayers(t.toLayers,   p)
        }

        if (p >= 1) {
            this.layers     = t.toLayers
            this._transition = null
        }
    }

    // ── Output stream ────────────────────────────────────────────────────────

    captureStream(fps = 30) {
        return this.canvas.captureStream(fps)
    }
}
