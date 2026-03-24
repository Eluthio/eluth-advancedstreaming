<template>
    <div class="as-root">

        <!-- Pre-stream: minimal — Configure + Go Live -->
        <div v-if="!isStreaming" class="as-setup">
            <div class="as-setup-inner">
                <div class="as-setup-logo">🎬</div>
                <div class="as-setup-title">Advanced Streaming</div>
                <div class="as-scene-name">{{ activeScene?.name ?? 'No scene configured' }}</div>
                <div class="as-setup-actions">
                    <button class="as-configure-btn" @click="openControlPanel">⚙ Configure Stream</button>
                    <button class="as-go-live-btn" :disabled="goingLive || !hasLayers" @click="goLive">
                        {{ goingLive ? 'Starting…' : '🔴 Go Live' }}
                    </button>
                </div>
                <div v-if="streamError" class="as-error">{{ streamError }}</div>
            </div>
        </div>

        <!-- Live: full-width canvas, minimal controls -->
        <div v-else class="as-live">
            <div class="as-preview-wrap" ref="previewWrap">
                <canvas ref="canvasEl" class="as-canvas" :width="outputWidth" :height="outputHeight" />
                <div class="as-live-badge">● LIVE</div>
                <div class="as-live-duration">{{ streamDuration }}</div>
            </div>
            <div class="as-bottom-bar">
                <span class="as-scene-pill">{{ activeScene?.name }}</span>
                <div class="as-bottom-controls">
                    <button class="as-configure-btn-sm" @click="openControlPanel">⚙ Controls</button>
                    <button class="as-stop-btn" @click="stopStream">⏹ Stop</button>
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { Compositor } from './compositor.js'

const props = defineProps({
    settings:      { type: Object,  default: () => ({}) },
    apiBase:       { type: String,  default: '' },
    authToken:     { type: String,  default: '' },
    channelId:     { type: String,  required: true },
    channel:       { type: Object,  required: true },
    currentMember: { type: Object,  default: null },
    canStream:     { type: Boolean, default: false },
})

const emit = defineEmits(['stream-started', 'stream-stopped'])

// ── Settings (localStorage) ───────────────────────────────────────────────────
const SETTINGS_KEY = 'advanced-streaming-settings'

function loadStoredSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } catch { return {} }
}

const storedSettings = ref(loadStoredSettings())
const enabledSources = computed(() => storedSettings.value.enabledSources ?? ['camera', 'screen'])
const transition     = computed(() => storedSettings.value.transition     ?? { type: 'fade', duration: 400 })
const outputWidth    = computed(() => storedSettings.value.outputWidth    ?? 1280)
const outputHeight   = computed(() => storedSettings.value.outputHeight   ?? 720)

// ── Scene state ───────────────────────────────────────────────────────────────
const scenes         = ref([])
const activeSceneId  = ref(null)
const selectedLayerId = ref(null)

const activeScene = computed(() => scenes.value.find(s => s.id === activeSceneId.value) ?? null)
const hasLayers   = computed(() => (activeScene.value?.layers ?? []).some(l => l.visible))

function newId() { return Math.random().toString(36).slice(2, 10) }

function addScene(name) {
    const scene = { id: newId(), name: name ?? `Scene ${scenes.value.length + 1}`, layers: [] }
    scenes.value.push(scene)
    activeSceneId.value = scene.id
    saveScenes()
    broadcastState()
}

function deleteScene(id) {
    if (scenes.value.length <= 1) return
    scenes.value = scenes.value.filter(s => s.id !== id)
    if (activeSceneId.value === id) activeSceneId.value = scenes.value[0].id
    saveScenes()
    broadcastState()
}

function renameScene({ id, name }) {
    const scene = scenes.value.find(s => s.id === id)
    if (scene) { scene.name = name; saveScenes(); broadcastState() }
}

function switchScene(id) {
    activeSceneId.value = id
    selectedLayerId.value = null
    if (compositor) compositor.setLayers(activeScene.value?.layers ?? [])
    saveScenes()
    broadcastState()
}

function switchSceneLive(id) {
    const incoming = scenes.value.find(s => s.id === id)?.layers ?? []
    activeSceneId.value = id
    selectedLayerId.value = null
    if (compositor) compositor.beginTransition(incoming, transition.value.type, transition.value.duration)
    saveScenes()
    broadcastState()
}

// ── Layer management ──────────────────────────────────────────────────────────
function doAddLayer(sourceKey) {
    const scene = activeScene.value
    if (!scene) return
    scene.layers.push({ id: newId(), sourceKey, x: 0, y: 0, w: 1, h: 1, opacity: 1, visible: true })
    ensureSourceActive(sourceKey)
    if (compositor) compositor.setLayers(scene.layers)
    saveScenes()
    broadcastState()
}

function removeLayer(id) {
    const scene = activeScene.value
    if (!scene) return
    scene.layers = scene.layers.filter(l => l.id !== id)
    if (selectedLayerId.value === id) selectedLayerId.value = null
    if (compositor) compositor.setLayers(scene.layers)
    saveScenes()
    broadcastState()
}

function toggleLayerVisible(id) {
    const layer = activeScene.value?.layers.find(l => l.id === id)
    if (layer) {
        layer.visible = !layer.visible
        compositor?.setLayers(activeScene.value.layers)
        saveScenes()
        broadcastState()
    }
}

function setLayerOpacity({ id, opacity }) {
    const layer = activeScene.value?.layers.find(l => l.id === id)
    if (layer) { layer.opacity = opacity; compositor?.setLayers(activeScene.value.layers) }
}

function setLayerTransform({ id, x, y, w, h }) {
    const layer = activeScene.value?.layers.find(l => l.id === id)
    if (!layer) return
    layer.x = x; layer.y = y; layer.w = w; layer.h = h
    compositor?.setLayers(activeScene.value.layers)
    saveScenes()
    broadcastState()
}

// ── Source elements ───────────────────────────────────────────────────────────
const activeSourceKeys = computed(() => {
    const keys = new Set()
    for (const scene of scenes.value) {
        for (const layer of scene.layers) keys.add(layer.sourceKey)
    }
    return [...keys]
})

const sourceStreams = {}

async function ensureSourceActive(key) {
    if (sourceStreams[key]) return
    const src = window.__EluthStreamSources?.[key]
    if (!src) return
    try {
        const stream = await src.getStream()
        if (!stream) return  // source not configured (e.g. Plex with no content selected)
        sourceStreams[key] = stream
        if (isStreaming.value) connectSourceAudio(key, stream)
        nextTick(() => attachStreamToEl(key, stream))
    } catch (e) {
        if (e?.message !== 'cancelled') console.warn('[AdvancedStreaming] Failed to get stream for', key, e)
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

const sourceElMap = {}

function registerSourceEl(key, el) {
    if (!el) { delete sourceElMap[key]; return }
    sourceElMap[key] = el
    if (sourceStreams[key]) attachStreamToEl(key, sourceStreams[key])
}

// ── Audio mixer ───────────────────────────────────────────────────────────────
let audioCtx        = null
let audioDest       = null
let audioLevelTimer = null
const audioGains    = {}  // sourceKey → { gainNode, analyser, source, gain, muted }

const AUDIO_KEY = () => `as_audio_${props.channelId}`

function loadAudioSettings() {
    try {
        const raw = localStorage.getItem(AUDIO_KEY())
        if (!raw) return
        const saved = JSON.parse(raw)
        for (const [key, d] of Object.entries(saved)) {
            audioGains[key] = { gain: d.gain ?? 1, muted: d.muted ?? false }
        }
    } catch { /* ignore */ }
}

function saveAudioSettings() {
    try {
        const out = {}
        for (const [k, d] of Object.entries(audioGains)) out[k] = { gain: d.gain, muted: d.muted }
        localStorage.setItem(AUDIO_KEY(), JSON.stringify(out))
    } catch { /* ignore */ }
}

function initAudioContext() {
    if (audioCtx) return
    audioCtx = new AudioContext()
    audioDest = audioCtx.createMediaStreamDestination()
}

function connectSourceAudio(key, stream) {
    if (!audioCtx || !stream) return
    const tracks = stream.getAudioTracks()
    if (!tracks.length) return
    if (audioGains[key]?.source) return  // already connected

    const saved   = audioGains[key] ?? { gain: 1, muted: false }
    const gainNode = audioCtx.createGain()
    gainNode.gain.value = saved.muted ? 0 : saved.gain

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.75

    // Use only first audio track to avoid channel issues
    const source = audioCtx.createMediaStreamSource(new MediaStream([tracks[0]]))
    source.connect(gainNode)
    gainNode.connect(analyser)
    gainNode.connect(audioDest)

    audioGains[key] = { ...saved, gainNode, analyser, source }
}

function setAudioGain(key, gain) {
    if (!audioGains[key]) audioGains[key] = { gain, muted: false }
    else audioGains[key].gain = gain
    if (audioGains[key].gainNode && !audioGains[key].muted) {
        audioGains[key].gainNode.gain.value = gain
    }
    saveAudioSettings()
    broadcastState()
}

function setAudioMute(key, muted) {
    if (!audioGains[key]) return
    audioGains[key].muted = muted
    if (audioGains[key].gainNode) {
        audioGains[key].gainNode.gain.value = muted ? 0 : audioGains[key].gain
    }
    saveAudioSettings()
    broadcastState()
}

function getAudioLevel(key) {
    const entry = audioGains[key]
    if (!entry?.analyser || entry.muted) return 0
    const data = new Uint8Array(entry.analyser.frequencyBinCount)
    entry.analyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) sum += ((v - 128) / 128) ** 2
    return Math.min(1, Math.sqrt(sum / data.length) * 4)  // scale up for visual clarity
}

function broadcastAudioLevels() {
    if (!bc) return
    const levels = {}
    for (const key of Object.keys(audioGains)) levels[key] = getAudioLevel(key)
    try { bc.postMessage({ type: 'audio-levels', levels }) } catch {}
}

function buildAudioChannels() {
    const out = {}
    for (const [key, d] of Object.entries(audioGains)) {
        out[key] = {
            gain:  d.gain,
            muted: d.muted,
            label: window.__EluthStreamSources?.[key]?.label ?? key,
            icon:  window.__EluthStreamSources?.[key]?.icon  ?? '🎵',
        }
    }
    return out
}

function stopAudio() {
    clearInterval(audioLevelTimer)
    audioLevelTimer = null
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; audioDest = null }
    // Keep gain/mute settings but clear live nodes
    for (const d of Object.values(audioGains)) {
        delete d.gainNode; delete d.analyser; delete d.source
    }
}

// ── Streaming ─────────────────────────────────────────────────────────────────
let compositor    = null
let mediaRecorder = null
let streamSeq     = 0
let streamTimer   = null
let streamStartTs = 0

const canvasEl       = ref(null)
const previewWrap    = ref(null)
const isStreaming    = ref(false)
const goingLive      = ref(false)
const streamError    = ref('')
const streamDuration = ref('0:00')

function updateDuration() {
    const elapsed = Math.floor((Date.now() - streamStartTs) / 1000)
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    streamDuration.value = `${m}:${String(s).padStart(2, '0')}`
    broadcastState()
}

async function goLive() {
    streamError.value = ''
    goingLive.value   = true

    for (const layer of activeScene.value?.layers ?? []) {
        await ensureSourceActive(layer.sourceKey)
    }
    await nextTick()

    try {
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

        streamSeq         = 0
        streamStartTs     = Date.now()
        isStreaming.value = true
        goingLive.value   = false
        emit('stream-started')
        await nextTick()
        broadcastState()

        compositor = new Compositor(canvasEl.value)
        compositor.setLayers(activeScene.value?.layers ?? [])
        for (const [key, stream] of Object.entries(sourceStreams)) {
            attachStreamToEl(key, stream)
        }
        compositor.start()

        // Build audio mix from all active sources
        initAudioContext()
        for (const [key, stream] of Object.entries(sourceStreams)) {
            connectSourceAudio(key, stream)
        }

        const canvasStream = compositor.captureStream(30)
        // Add mixed audio track to the stream
        const audioTrack = audioDest?.stream.getAudioTracks()[0]
        if (audioTrack) canvasStream.addTrack(audioTrack)

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

        mediaRecorder.start(2000)
        streamTimer      = setInterval(updateDuration, 1000)
        audioLevelTimer  = setInterval(broadcastAudioLevels, 80)
        broadcastState()  // push initial audioChannels to popup

    } catch (e) {
        streamError.value = 'Could not start stream: ' + e.message
        goingLive.value   = false
    }
}

async function stopStream() {
    mediaRecorder?.stop()
    clearInterval(streamTimer)
    stopAudio()
    compositor?.stop()
    compositor = null
    isStreaming.value = false
    emit('stream-stopped')
    broadcastState()

    await fetch(`${props.apiBase}/streams/${props.channelId}/stop`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${props.authToken}` },
    }).catch(() => {})
}

// ── Popup control panel ───────────────────────────────────────────────────────
let bc          = null
let popupWindow = null

function openControlPanel() {
    if (popupWindow && !popupWindow.closed) {
        popupWindow.focus()
        broadcastState()
        return
    }
    const url = `${window.location.origin}/?popup=stream-control&channel=${props.channelId}`
    popupWindow = window.open(url, `stream-control-${props.channelId}`, 'width=980,height=640,resizable=yes')
    // Push state once popup has had time to mount and set up its BroadcastChannel
    setTimeout(() => broadcastState(), 800)
    setTimeout(() => broadcastState(), 2000)
}

const BUILTIN_SOURCES = ['camera', 'screen']

function buildSourceRegistry() {
    const reg = {}
    for (const [k, v] of Object.entries(window.__EluthStreamSources ?? {})) {
        // Built-in sources respect enabledSources setting.
        // Plugin sources (plex, etc.) are always included automatically.
        const isBuiltin = BUILTIN_SOURCES.includes(k)
        if (!isBuiltin || enabledSources.value.includes(k) || k.startsWith('camera_')) {
            reg[k] = { label: v.label, icon: v.icon }
        }
    }
    return reg
}

function broadcastState() {
    if (!bc) return
    try {
        bc.postMessage({
            type:           'state',
            scenes:         JSON.parse(JSON.stringify(scenes.value)),
            activeSceneId:  activeSceneId.value,
            isStreaming:    isStreaming.value,
            streamDuration: streamDuration.value,
            sourceRegistry: buildSourceRegistry(),
            settings: {
                transition:   JSON.parse(JSON.stringify(transition.value)),
                outputWidth:  outputWidth.value,
                outputHeight: outputHeight.value,
            },
            pluginStates: {
                plex: window.__EluthStreamSources?.['plex']?.getState?.() ?? null,
            },
            audioChannels: buildAudioChannels(),
        })
    } catch (e) {
        console.error('[AdvancedStreaming] broadcastState failed:', e)
    }
}

// Lightweight broadcast for frequent Plex state changes (timeupdate etc.)
function broadcastPlexState() {
    if (!bc) return
    const state = window.__EluthStreamSources?.['plex']?.getState?.()
    if (!state) return
    try { bc.postMessage({ type: 'plex-state', plex: state }) } catch {}
}

function onBcMessage(e) {
    const msg = e.data
    if (!msg?.type) return

    switch (msg.type) {
        case 'request-state':
            broadcastState()
            break

        case 'switch-scene':
            if (isStreaming.value) switchSceneLive(msg.id)
            else switchScene(msg.id)
            break

        case 'add-scene':
            addScene()
            break

        case 'delete-scene':
            deleteScene(msg.id)
            break

        case 'rename-scene':
            renameScene({ id: msg.id, name: msg.name })
            break

        case 'add-layer': {
            let key = msg.sourceKey
            if (key === 'camera' && msg.deviceId) {
                const dk = `camera_${msg.deviceId.slice(0, 12)}`
                if (!window.__EluthStreamSources[dk]) {
                    window.__EluthStreamSources[dk] = {
                        label: msg.deviceLabel ?? 'Camera',
                        icon: '📷',
                        getStream: () => navigator.mediaDevices.getUserMedia({
                            video: { deviceId: { exact: msg.deviceId } },
                            audio: true,
                        }),
                    }
                }
                key = dk
            }
            doAddLayer(key)
            break
        }

        case 'remove-layer':
            removeLayer(msg.id)
            break

        case 'toggle-visible':
            toggleLayerVisible(msg.id)
            break

        case 'set-opacity':
            setLayerOpacity({ id: msg.id, opacity: msg.opacity })
            break

        case 'set-transform':
            setLayerTransform({ id: msg.id, x: msg.x, y: msg.y, w: msg.w, h: msg.h })
            break

        case 'stop-stream':
            stopStream()
            break

        case 'plex-play': {
            const src = window.__EluthStreamSources?.['plex']
            if (!src) break
            // handleMessage returns the startPlayback promise — await it then attach
            ;(async () => {
                const stream = await src.handleMessage?.(msg)
                if (!stream) return
                sourceStreams['plex'] = stream
                if (isStreaming.value) connectSourceAudio('plex', stream)
                nextTick(() => attachStreamToEl('plex', stream))
            })()
            break
        }
        case 'plex-pause':
        case 'plex-resume':
        case 'plex-seek':
        case 'plex-stop':
            window.__EluthStreamSources?.['plex']?.handleMessage?.(msg)
            break

        case 'set-audio-gain':
            setAudioGain(msg.sourceKey, msg.gain)
            break

        case 'set-audio-mute':
            setAudioMute(msg.sourceKey, msg.muted)
            break

        case 'update-settings': {
            const s = storedSettings.value
            const ns = {
                ...s,
                enabledSources: s.enabledSources,
                transition:  msg.settings.transition  ?? s.transition,
                outputWidth:  msg.settings.outputWidth  ?? s.outputWidth,
                outputHeight: msg.settings.outputHeight ?? s.outputHeight,
            }
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(ns))
            storedSettings.value = ns
            broadcastState()
            break
        }
    }
}

// ── Persistence ───────────────────────────────────────────────────────────────
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
            scenes.value        = data.scenes ?? []
            activeSceneId.value = data.activeSceneId ?? scenes.value[0]?.id ?? null
            return
        }
    } catch { /* ignore */ }
    addScene()
}

// ── Built-in sources ──────────────────────────────────────────────────────────
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

// ── beforeunload ──────────────────────────────────────────────────────────────
function beaconStop() {
    if (!isStreaming.value) return
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${props.apiBase}/streams/${props.channelId}/stop`, false)
    xhr.setRequestHeader('Authorization', `Bearer ${props.authToken}`)
    try { xhr.send() } catch { /* page unloading */ }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
    registerBuiltinSources()
    loadScenes()
    loadAudioSettings()
    bc = new BroadcastChannel(`eluth-stream-${props.channelId}`)
    bc.addEventListener('message', onBcMessage)
    window.addEventListener('beforeunload', beaconStop)
    // Wire up Plex state changes → lightweight broadcast to popup
    window.__EluthStreamSources?.['plex']?.setStateCallback?.(broadcastPlexState)
})

onUnmounted(() => {
    bc?.close()
    window.removeEventListener('beforeunload', beaconStop)
    if (isStreaming.value) stopStream()
    for (const stream of Object.values(sourceStreams)) {
        stream.getTracks().forEach(t => t.stop())
    }
})
</script>

<style scoped>
.as-root { display: flex; flex-direction: column; flex: 1; min-height: 0; background: #0f1117; color: #e2e8f0; position: relative; }

/* ── Pre-live setup ── */
.as-setup { display: flex; align-items: center; justify-content: center; flex: 1; padding: 24px; }
.as-setup-inner { display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 360px; width: 100%; }
.as-setup-logo { font-size: 40px; }
.as-setup-title { font-size: 18px; font-weight: 700; color: #e2e8f0; }
.as-scene-name { font-size: 13px; color: #64748b; text-align: center; }
.as-setup-actions { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.as-configure-btn {
    width: 100%; padding: 10px 20px; border-radius: 8px; cursor: pointer;
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
    color: #e2e8f0; font-size: 14px; font-weight: 600; transition: all 0.15s;
}
.as-configure-btn:hover { background: rgba(255,255,255,0.12); }
.as-go-live-btn {
    width: 100%; background: #ef4444; color: #fff; border: none; border-radius: 8px;
    padding: 10px 20px; font-size: 15px; font-weight: 700; cursor: pointer;
    transition: background 0.15s;
}
.as-go-live-btn:hover { background: #dc2626; }
.as-go-live-btn:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }
.as-error { font-size: 12px; color: #f87171; text-align: center; }

/* ── Live view ── */
.as-live { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.as-preview-wrap {
    flex: 1; min-height: 0; position: relative; background: #000;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.as-canvas { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
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
.as-bottom-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; background: rgba(0,0,0,0.5);
    border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;
}
.as-scene-pill { font-size: 12px; color: #94a3b8; font-weight: 500; }
.as-bottom-controls { display: flex; gap: 8px; }
.as-configure-btn-sm {
    background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8; border-radius: 6px; padding: 5px 12px;
    font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.as-configure-btn-sm:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
.as-stop-btn {
    background: #7f1d1d; border: 1px solid #991b1b; color: #fca5a5;
    border-radius: 6px; padding: 5px 14px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
}
.as-stop-btn:hover { background: #991b1b; color: #fff; }
</style>
