<template>
    <div class="as-root">

        <!-- Pre-stream setup (not live yet) -->
        <div v-if="!isStreaming" class="as-setup">
            <button v-if="isAdmin" class="as-settings-btn" @click="openSettings" title="Plugin settings">⚙</button>
            <div class="as-setup-inner">
                <div class="as-setup-logo">🎬</div>
                <div class="as-setup-title">Advanced Streaming</div>
                <div class="as-setup-hint">Configure your scenes and sources, then go live.</div>
                <div class="as-setup-scenes">
                    <div class="as-setup-scenes-label">Scenes</div>
                    <SceneManager
                        :scenes="scenes"
                        :active-id="activeSceneId"
                        @switch="switchScene"
                        @add="addScene"
                        @delete="deleteScene"
                        @rename="renameScene"
                    />
                </div>
                <div v-if="activeScene" class="as-setup-layers">
                    <LayerEditor
                        :layers="activeScene.layers"
                        :selected-id="selectedLayerId"
                        @select="selectedLayerId = $event"
                        @toggle-visible="toggleLayerVisible"
                        @set-opacity="setLayerOpacity"
                        @remove-layer="removeLayer"
                        @add-layer="showSourcePicker = true"
                    />
                </div>
                <button
                    class="as-go-live-btn"
                    :disabled="goingLive || !hasLayers"
                    @click="goLive"
                >{{ goingLive ? 'Starting…' : '🔴 Go Live' }}</button>
                <div v-if="streamError" class="as-error">{{ streamError }}</div>
            </div>
        </div>

        <!-- Live compositor -->
        <div v-else class="as-live">
            <!-- Preview canvas -->
            <div class="as-preview-wrap" ref="previewWrap">
                <canvas ref="canvasEl" class="as-canvas" :width="outputWidth" :height="outputHeight" />

                <!-- Drag handles for selected layer -->
                <template v-if="selectedLayerId && activeScene">
                    <div
                        v-for="layer in activeScene.layers.filter(l => l.id === selectedLayerId)"
                        :key="layer.id"
                        class="as-drag-handle"
                        :style="layerHandleStyle(layer)"
                        @mousedown.prevent="startDrag($event, layer, 'move')"
                    >
                        <div
                            class="as-resize-corner as-resize-corner--br"
                            @mousedown.stop.prevent="startDrag($event, layer, 'resize')"
                        />
                    </div>
                </template>

                <!-- LIVE badge -->
                <div class="as-live-badge">● LIVE</div>
                <div class="as-live-duration">{{ streamDuration }}</div>
            </div>

            <!-- Bottom bar -->
            <div class="as-bottom-bar">
                <SceneManager
                    :scenes="scenes"
                    :active-id="activeSceneId"
                    @switch="switchSceneLive"
                    @add="addScene"
                    @delete="deleteScene"
                    @rename="renameScene"
                />

                <div class="as-bottom-controls">
                    <button class="as-add-layer-btn" @click="showSourcePicker = true">＋ Source</button>
                    <button class="as-stop-btn" @click="stopStream">⏹ Stop</button>
                </div>
            </div>

            <!-- Right panel: layer editor -->
            <LayerEditor
                v-if="activeScene"
                :layers="activeScene.layers"
                :selected-id="selectedLayerId"
                @select="selectedLayerId = $event"
                @toggle-visible="toggleLayerVisible"
                @set-opacity="setLayerOpacity"
                @remove-layer="removeLayer"
                @add-layer="showSourcePicker = true"
            />
        </div>

        <!-- Source picker modal -->
        <SourcePicker
            v-if="showSourcePicker"
            :enabled-sources="enabledSources"
            @pick="addLayer"
            @close="showSourcePicker = false"
        />

        <!-- Settings modal -->
        <div v-if="showSettings" class="as-source-overlay" @click.self="showSettings = false">
                <div class="as-source-modal" style="max-width:420px;padding:24px;">
                    <div class="as-source-title">Advanced Streaming — Settings</div>

                    <div class="as-settings-section">
                        <div class="as-settings-label">Available Sources</div>
                        <div class="as-settings-sources">
                            <label v-for="src in allKnownSources" :key="src.key" class="as-settings-source-row">
                                <input type="checkbox"
                                    :checked="settingsForm.enabledSources.includes(src.key)"
                                    @change="toggleEnabledSource(src.key)"
                                />
                                <span>{{ src.icon }} {{ src.label }}</span>
                            </label>
                        </div>
                    </div>

                    <div class="as-settings-section">
                        <div class="as-settings-label">Default Transition</div>
                        <div class="as-settings-row">
                            <select class="as-settings-select" v-model="settingsForm.transitionType">
                                <option value="cut">Cut</option>
                                <option value="fade">Fade</option>
                            </select>
                            <template v-if="settingsForm.transitionType !== 'cut'">
                                <input type="number" class="as-settings-input" v-model.number="settingsForm.transitionDuration" min="100" max="2000" step="100" />
                                <span class="as-settings-unit">ms</span>
                            </template>
                        </div>
                    </div>

                    <div class="as-settings-section">
                        <div class="as-settings-label">Output Resolution</div>
                        <div class="as-settings-row">
                            <select class="as-settings-select" v-model.number="settingsForm.outputWidth" @change="settingsForm.outputHeight = settingsForm.outputWidth === 1920 ? 1080 : settingsForm.outputWidth === 1280 ? 720 : 480">
                                <option :value="854">480p</option>
                                <option :value="1280">720p</option>
                                <option :value="1920">1080p</option>
                            </select>
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;margin-top:16px;">
                        <button class="as-go-live-btn" style="flex:1;margin:0;padding:8px;" :disabled="savingSettings" @click="saveSettings">
                            {{ settingsSaved ? '✓ Saved' : savingSettings ? 'Saving…' : 'Save' }}
                        </button>
                        <button class="as-source-cancel" style="flex:1;" @click="showSettings = false">Cancel</button>
                    </div>
                </div>
            </div>

        <!-- Hidden video elements for each active source -->
        <div style="display:none">
            <video
                v-for="key in activeSourceKeys"
                :key="key"
                :ref="el => registerSourceEl(key, el)"
                autoplay muted playsinline
            />
        </div>

    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Compositor } from './compositor.js'
import SceneManager from './components/SceneManager.vue'
import LayerEditor from './components/LayerEditor.vue'
import SourcePicker from './components/SourcePicker.vue'

const props = defineProps({
    settings:      { type: Object,  default: () => ({}) },
    apiBase:       { type: String,  default: '' },
    authToken:     { type: String,  default: '' },
    channelId:     { type: String,  required: true },
    channel:       { type: Object,  required: true },
    currentMember: { type: Object,  default: null },
    canStream:     { type: Boolean, default: false },
})

// ── Settings ────────────────────────────────────────────────────────────────
const enabledSources = computed(() => props.settings.enabledSources ?? ['camera', 'screen'])
const transition     = computed(() => props.settings.transition ?? { type: 'fade', duration: 400 })
const outputWidth    = computed(() => props.settings.outputWidth  ?? 1280)
const outputHeight   = computed(() => props.settings.outputHeight ?? 720)

// ── Scene state ──────────────────────────────────────────────────────────────
const scenes        = ref([])
const activeSceneId = ref(null)
const selectedLayerId = ref(null)

const activeScene = computed(() => scenes.value.find(s => s.id === activeSceneId.value) ?? null)
const hasLayers   = computed(() => (activeScene.value?.layers ?? []).some(l => l.visible))

function newId() { return Math.random().toString(36).slice(2, 10) }

function addScene() {
    const scene = { id: newId(), name: `Scene ${scenes.value.length + 1}`, layers: [] }
    scenes.value.push(scene)
    activeSceneId.value = scene.id
    saveScenes()
}

function deleteScene(id) {
    if (scenes.value.length <= 1) return
    scenes.value = scenes.value.filter(s => s.id !== id)
    if (activeSceneId.value === id) activeSceneId.value = scenes.value[0].id
    saveScenes()
}

function renameScene({ id, name }) {
    const scene = scenes.value.find(s => s.id === id)
    if (scene) { scene.name = name; saveScenes() }
}

function switchScene(id) {
    activeSceneId.value = id
    selectedLayerId.value = null
    if (compositor) compositor.setLayers(activeScene.value?.layers ?? [])
    saveScenes()
}

function switchSceneLive(id) {
    const incoming = scenes.value.find(s => s.id === id)?.layers ?? []
    activeSceneId.value = id
    selectedLayerId.value = null
    if (compositor) compositor.beginTransition(incoming, transition.value.type, transition.value.duration)
    saveScenes()
}

// ── Layer management ─────────────────────────────────────────────────────────
function addLayer(sourceKey) {
    showSourcePicker.value = false
    const scene = activeScene.value
    if (!scene) return
    scene.layers.push({
        id:        newId(),
        sourceKey,
        x: 0, y: 0, w: 1, h: 1,
        opacity:   1,
        visible:   true,
    })
    ensureSourceActive(sourceKey)
    if (compositor) compositor.setLayers(scene.layers)
    saveScenes()
}

function removeLayer(id) {
    const scene = activeScene.value
    if (!scene) return
    scene.layers = scene.layers.filter(l => l.id !== id)
    if (selectedLayerId.value === id) selectedLayerId.value = null
    if (compositor) compositor.setLayers(scene.layers)
    saveScenes()
}

function toggleLayerVisible(id) {
    const layer = activeScene.value?.layers.find(l => l.id === id)
    if (layer) { layer.visible = !layer.visible; compositor?.setLayers(activeScene.value.layers); saveScenes() }
}

function setLayerOpacity({ id, opacity }) {
    const layer = activeScene.value?.layers.find(l => l.id === id)
    if (layer) { layer.opacity = opacity; compositor?.setLayers(activeScene.value.layers) }
}

// ── Source elements ──────────────────────────────────────────────────────────
const activeSourceKeys = computed(() => {
    const keys = new Set()
    for (const scene of scenes.value) {
        for (const layer of scene.layers) keys.add(layer.sourceKey)
    }
    return [...keys]
})

const sourceStreams = {}   // key → MediaStream

async function ensureSourceActive(key) {
    if (sourceStreams[key]) return
    const src = window.__EluthStreamSources?.[key]
    if (!src) return
    try {
        const stream = await src.getStream()
        sourceStreams[key] = stream
        // Attach to hidden video element once it's in the DOM
        nextTick(() => attachStreamToEl(key, stream))
    } catch (e) {
        console.warn('[AdvancedStreaming] Failed to get stream for', key, e)
    }
}

function attachStreamToEl(key, stream) {
    const el = sourceElMap[key]
    if (el) {
        el.srcObject = stream
        el.play().catch(() => {})
        compositor?.attachSource(key, el)
    }
}

const sourceElMap = {}   // key → video element

function registerSourceEl(key, el) {
    if (!el) { delete sourceElMap[key]; return }
    sourceElMap[key] = el
    if (sourceStreams[key]) attachStreamToEl(key, sourceStreams[key])
}

// ── Streaming ────────────────────────────────────────────────────────────────
let compositor    = null
let mediaRecorder = null
let streamSeq     = 0
let streamTimer   = null
let streamStartTs = 0

const canvasEl         = ref(null)
const previewWrap      = ref(null)
const isStreaming      = ref(false)
const goingLive        = ref(false)
const streamError      = ref('')
const streamDuration   = ref('0:00')
const showSourcePicker = ref(false)
const showSettings     = ref(false)

const isAdmin = computed(() => props.currentMember?.can?.('manage_server') ?? false)

// Local copy of settings for the modal
const settingsForm = ref({
    enabledSources:     [],
    transitionType:     'fade',
    transitionDuration: 400,
    outputWidth:        1280,
    outputHeight:       720,
})
const savingSettings = ref(false)
const settingsSaved  = ref(false)

function openSettings() {
    // Refresh source list at open time so late-loading plugins (e.g. Plex) are included
    allKnownSources.value = Object.entries(window.__EluthStreamSources ?? {}).map(([key, src]) => ({ key, ...src }))
    settingsForm.value = {
        enabledSources:     [...(props.settings.enabledSources ?? ['camera', 'screen'])],
        transitionType:     props.settings.transition?.type     ?? 'fade',
        transitionDuration: props.settings.transition?.duration ?? 400,
        outputWidth:        props.settings.outputWidth  ?? 1280,
        outputHeight:       props.settings.outputHeight ?? 720,
    }
    showSettings.value = true
}

async function saveSettings() {
    savingSettings.value = true
    try {
        await fetch(`${props.apiBase}/admin/plugins/advanced-streaming/settings`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${props.authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabledSources:     settingsForm.value.enabledSources,
                transition:         { type: settingsForm.value.transitionType, duration: settingsForm.value.transitionDuration },
                outputWidth:        settingsForm.value.outputWidth,
                outputHeight:       settingsForm.value.outputHeight,
            }),
        })
        settingsSaved.value = true
        setTimeout(() => { settingsSaved.value = false; showSettings.value = false }, 1200)
    } finally {
        savingSettings.value = false
    }
}

function toggleEnabledSource(key) {
    const idx = settingsForm.value.enabledSources.indexOf(key)
    if (idx === -1) settingsForm.value.enabledSources.push(key)
    else settingsForm.value.enabledSources.splice(idx, 1)
}

const allKnownSources = ref([])

function updateDuration() {
    const elapsed = Math.floor((Date.now() - streamStartTs) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    streamDuration.value = `${m}:${String(s).padStart(2,'0')}`
}

async function goLive() {
    streamError.value = ''
    goingLive.value   = true

    // Ensure all sources for the active scene are loaded
    for (const layer of activeScene.value?.layers ?? []) {
        await ensureSourceActive(layer.sourceKey)
    }

    await nextTick()

    try {
        // Notify server
        const res = await fetch(`${props.apiBase}/streams/${props.channelId}/start`, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${props.authToken}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ mime_type: 'video/webm;codecs=vp8,opus' }),
        })
        if (!res.ok) {
            const err = await res.json()
            streamError.value = err.message ?? 'Failed to start stream.'
            goingLive.value = false
            return
        }

        // Show live view first so canvas mounts, then create compositor
        streamSeq         = 0
        streamStartTs     = Date.now()
        isStreaming.value = true
        goingLive.value   = false
        await nextTick()

        // Start compositor
        compositor = new Compositor(canvasEl.value)
        compositor.setLayers(activeScene.value?.layers ?? [])
        // Re-attach known streams
        for (const [key, stream] of Object.entries(sourceStreams)) {
            attachStreamToEl(key, stream)
        }
        compositor.start()

        // Capture canvas stream → MediaRecorder
        const canvasStream = compositor.captureStream(30)
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus'
            : 'video/webm'
        mediaRecorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 2_500_000 })

        mediaRecorder.ondataavailable = async (e) => {
            if (!e.data?.size) return
            const form = new FormData()
            form.append('seq',   streamSeq)
            form.append('chunk', new Blob([e.data], { type: mimeType }), 'chunk.webm')
            streamSeq++
            fetch(`${props.apiBase}/streams/${props.channelId}/chunk`, {
                method:  'POST',
                headers: { 'Authorization': `Bearer ${props.authToken}` },
                body:    form,
            }).catch(() => {})
        }

        mediaRecorder.start(2000)   // 2s chunks
        streamTimer = setInterval(updateDuration, 1000)

    } catch (e) {
        streamError.value = 'Could not start stream: ' + e.message
        goingLive.value   = false
    }
}

async function stopStream() {
    mediaRecorder?.stop()
    clearInterval(streamTimer)
    compositor?.stop()
    compositor = null
    isStreaming.value = false

    await fetch(`${props.apiBase}/streams/${props.channelId}/stop`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${props.authToken}` },
    }).catch(() => {})
}

// ── Drag-to-move / resize ────────────────────────────────────────────────────
let dragState = null

function layerHandleStyle(layer) {
    const wrap = previewWrap.value
    if (!wrap) return {}
    const { offsetWidth: W, offsetHeight: H } = wrap
    return {
        left:   layer.x * W + 'px',
        top:    layer.y * H + 'px',
        width:  layer.w * W + 'px',
        height: layer.h * H + 'px',
    }
}

function startDrag(e, layer, mode) {
    selectedLayerId.value = layer.id
    dragState = {
        mode,
        layer,
        startX: e.clientX, startY: e.clientY,
        origX: layer.x, origY: layer.y,
        origW: layer.w, origH: layer.h,
    }
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup',   onDragEnd)
}

function onDragMove(e) {
    if (!dragState || !previewWrap.value) return
    const { offsetWidth: W, offsetHeight: H } = previewWrap.value
    const dx = (e.clientX - dragState.startX) / W
    const dy = (e.clientY - dragState.startY) / H
    const layer = dragState.layer

    if (dragState.mode === 'move') {
        layer.x = Math.max(0, Math.min(1 - layer.w, dragState.origX + dx))
        layer.y = Math.max(0, Math.min(1 - layer.h, dragState.origY + dy))
    } else {
        layer.w = Math.max(0.05, Math.min(1 - layer.x, dragState.origW + dx))
        layer.h = Math.max(0.05, Math.min(1 - layer.y, dragState.origH + dy))
    }
    compositor?.setLayers(activeScene.value?.layers ?? [])
}

function onDragEnd() {
    if (dragState) saveScenes()
    dragState = null
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup',   onDragEnd)
}

// ── Persistence ──────────────────────────────────────────────────────────────
function saveScenes() {
    try {
        localStorage.setItem(
            `as_scenes_${props.channelId}`,
            JSON.stringify({ scenes: scenes.value, activeSceneId: activeSceneId.value })
        )
    } catch { /* storage unavailable */ }
}

function loadScenes() {
    try {
        const raw = localStorage.getItem(`as_scenes_${props.channelId}`)
        if (raw) {
            const data = JSON.parse(raw)
            scenes.value       = data.scenes ?? []
            activeSceneId.value = data.activeSceneId ?? scenes.value[0]?.id ?? null
            return
        }
    } catch { /* ignore */ }
    addScene()
}

// ── Register built-in sources ────────────────────────────────────────────────
function registerBuiltinSources() {
    window.__EluthStreamSources = window.__EluthStreamSources ?? {}

    if (!window.__EluthStreamSources['camera']) {
        window.__EluthStreamSources['camera'] = {
            label: 'Camera',
            icon:  '📷',
            getStream: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
        }
    }
    if (!window.__EluthStreamSources['screen']) {
        window.__EluthStreamSources['screen'] = {
            label: 'Screen / Window',
            icon:  '🖥️',
            getStream: () => navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 } },
                audio: true,
            }),
        }
    }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
function beaconStop() {
    if (!isStreaming.value) return
    // sendBeacon works during page unload; fetch does not
    navigator.sendBeacon(
        `${props.apiBase}/streams/${props.channelId}/stop`,
        new Blob([JSON.stringify({})], { type: 'application/json' })
    )
    // Add auth header via a FormData trick isn't possible with sendBeacon,
    // so we fall back to a synchronous XMLHttpRequest
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${props.apiBase}/streams/${props.channelId}/stop`, false) // sync
    xhr.setRequestHeader('Authorization', `Bearer ${props.authToken}`)
    try { xhr.send() } catch { /* page unloading */ }
}

onMounted(() => {
    registerBuiltinSources()
    loadScenes()
    window.addEventListener('beforeunload', beaconStop)
})

onUnmounted(() => {
    window.removeEventListener('beforeunload', beaconStop)
    if (isStreaming.value) stopStream()
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup',   onDragEnd)
    for (const stream of Object.values(sourceStreams)) {
        stream.getTracks().forEach(t => t.stop())
    }
})
</script>

<style scoped>
.as-root { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #0f1117; color: #e2e8f0; position: relative; }

.as-settings-btn {
    position: absolute; top: 12px; right: 12px; z-index: 10;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #64748b; border-radius: 6px; padding: 6px 10px; font-size: 15px;
    cursor: pointer; transition: all 0.15s;
}
.as-settings-btn:hover { color: #e2e8f0; background: rgba(255,255,255,0.12); }

.as-settings-section { margin-bottom: 16px; }
.as-settings-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.as-settings-sources { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.as-settings-source-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cbd5e1; cursor: pointer; }
.as-settings-source-row input { accent-color: var(--accent, #5865f2); }
.as-settings-row { display: flex; align-items: center; gap: 8px; }
.as-settings-select {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer;
}
.as-settings-input {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 13px; width: 80px;
}
.as-settings-unit { font-size: 12px; color: #64748b; }

/* ── Setup screen ── */
.as-setup { display: flex; align-items: center; justify-content: center; flex: 1; padding: 24px; }
.as-setup-inner { display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 520px; width: 100%; }
.as-setup-logo { font-size: 48px; }
.as-setup-title { font-size: 20px; font-weight: 700; color: #e2e8f0; }
.as-setup-hint { font-size: 13px; color: #64748b; text-align: center; }
.as-setup-scenes, .as-setup-layers { width: 100%; }
.as-setup-scenes-label { font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.as-go-live-btn {
    background: #ef4444; color: #fff; border: none; border-radius: 8px;
    padding: 10px 32px; font-size: 15px; font-weight: 700; cursor: pointer;
    transition: background 0.15s; margin-top: 8px;
}
.as-go-live-btn:hover { background: #dc2626; }
.as-go-live-btn:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }
.as-error { font-size: 12px; color: #f87171; text-align: center; }

/* ── Live compositor ── */
.as-live { display: flex; flex: 1; min-height: 0; position: relative; flex-direction: column; }
.as-preview-wrap {
    flex: 1; min-height: 0; position: relative; background: #000;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.as-canvas { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

/* Drag handle */
.as-drag-handle {
    position: absolute;
    border: 2px solid var(--accent, #5865f2);
    cursor: move;
    box-sizing: border-box;
}
.as-resize-corner {
    position: absolute;
    width: 10px; height: 10px;
    background: var(--accent, #5865f2);
    border-radius: 2px;
    cursor: se-resize;
}
.as-resize-corner--br { bottom: -5px; right: -5px; }

/* LIVE badge */
.as-live-badge {
    position: absolute; top: 10px; left: 10px;
    background: #ef4444; color: #fff; font-size: 11px; font-weight: 700;
    padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em;
}
.as-live-duration {
    position: absolute; top: 10px; right: 10px;
    color: rgba(255,255,255,0.7); font-size: 12px;
    background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 4px;
}

/* Bottom bar */
.as-bottom-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; background: rgba(0,0,0,0.5);
    border-top: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
}
.as-bottom-controls { display: flex; gap: 8px; }
.as-add-layer-btn {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8; border-radius: 6px; padding: 5px 12px;
    font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.as-add-layer-btn:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
.as-stop-btn {
    background: #7f1d1d; border: 1px solid #991b1b; color: #fca5a5;
    border-radius: 6px; padding: 5px 14px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
}
.as-stop-btn:hover { background: #991b1b; color: #fff; }
</style>
