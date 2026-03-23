<template>
    <div class="as-layer-editor">
        <div class="as-layer-header">
            <span class="as-layer-title">Layers</span>
            <button class="as-layer-add-btn" @click="$emit('add-layer')" title="Add source">＋ Add Source</button>
        </div>

        <div class="as-layer-list">
            <div
                v-for="layer in [...layers].reverse()"
                :key="layer.id"
                class="as-layer-row"
                :class="{ selected: layer.id === selectedId, hidden: !layer.visible }"
                @click="$emit('select', layer.id)"
            >
                <button
                    class="as-layer-vis"
                    :title="layer.visible ? 'Hide' : 'Show'"
                    @click.stop="$emit('toggle-visible', layer.id)"
                >{{ layer.visible ? '👁' : '🚫' }}</button>

                <div class="as-layer-source">
                    <span class="as-layer-source-icon">{{ sourceIcon(layer.sourceKey) }}</span>
                    <span class="as-layer-source-name">{{ sourceName(layer.sourceKey) }}</span>
                </div>

                <div class="as-layer-opacity-wrap" @click.stop>
                    <input
                        type="range"
                        min="0" max="1" step="0.01"
                        :value="layer.opacity"
                        class="as-layer-opacity"
                        title="Opacity"
                        @input="$emit('set-opacity', { id: layer.id, opacity: +$event.target.value })"
                    />
                </div>

                <button
                    class="as-layer-remove"
                    title="Remove layer"
                    @click.stop="$emit('remove-layer', layer.id)"
                >✕</button>
            </div>

            <div v-if="!layers.length" class="as-layer-empty">No layers. Add a source above.</div>
        </div>
    </div>
</template>

<script setup>
const props = defineProps({
    layers:     { type: Array,  required: true },
    selectedId: { type: String, default: null },
})

defineEmits(['select', 'toggle-visible', 'set-opacity', 'remove-layer', 'add-layer'])

function sourceInfo(key) {
    return window.__EluthStreamSources?.[key] ?? null
}
function sourceIcon(key)  { return sourceInfo(key)?.icon  ?? '📹' }
function sourceName(key)  { return sourceInfo(key)?.label ?? key }
</script>

<style scoped>
.as-layer-editor {
    display: flex;
    flex-direction: column;
    background: rgba(0,0,0,0.35);
    border-left: 1px solid rgba(255,255,255,0.08);
    width: 220px;
    flex-shrink: 0;
}
.as-layer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
.as-layer-title {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.as-layer-add-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
}
.as-layer-add-btn:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
.as-layer-list { flex: 1; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.as-layer-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
}
.as-layer-row:hover { background: rgba(255,255,255,0.08); }
.as-layer-row.selected { border-color: var(--accent, #5865f2); background: rgba(88,101,242,0.1); }
.as-layer-row.hidden { opacity: 0.45; }
.as-layer-vis { background: none; border: none; cursor: pointer; font-size: 13px; padding: 0; flex-shrink: 0; }
.as-layer-source { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
.as-layer-source-icon { font-size: 13px; flex-shrink: 0; }
.as-layer-source-name { font-size: 12px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.as-layer-opacity-wrap { width: 50px; flex-shrink: 0; }
.as-layer-opacity { width: 100%; accent-color: var(--accent, #5865f2); }
.as-layer-remove { background: none; border: none; color: #475569; cursor: pointer; font-size: 11px; padding: 0; flex-shrink: 0; transition: color 0.15s; }
.as-layer-remove:hover { color: #ef4444; }
.as-layer-empty { font-size: 12px; color: #475569; text-align: center; padding: 16px 8px; }
</style>
