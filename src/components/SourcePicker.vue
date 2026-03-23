<template>
    <Teleport to="body">
        <div class="as-source-overlay" @click.self="$emit('close')">
            <div class="as-source-modal">
                <div class="as-source-title">Add Source</div>
                <div class="as-source-grid">
                    <button
                        v-for="(src, key) in availableSources"
                        :key="key"
                        class="as-source-opt"
                        @click="$emit('pick', key)"
                    >
                        <span class="as-source-icon">{{ src.icon }}</span>
                        <span class="as-source-label">{{ src.label }}</span>
                    </button>
                    <div v-if="!Object.keys(availableSources).length" class="as-source-empty">
                        No sources available. Enable sources in plugin settings.
                    </div>
                </div>
                <button class="as-source-cancel" @click="$emit('close')">Cancel</button>
            </div>
        </div>
    </Teleport>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
    enabledSources: { type: Array, default: () => [] },
})

defineEmits(['pick', 'close'])

const availableSources = computed(() => {
    const all = window.__EluthStreamSources ?? {}
    const result = {}
    for (const key of props.enabledSources) {
        if (all[key]) result[key] = all[key]
    }
    return result
})
</script>

<style scoped>
.as-source-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
}
.as-source-modal {
    background: #1e2130;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 480px;
}
.as-source-title {
    font-size: 16px; font-weight: 700; color: #e2e8f0; margin-bottom: 16px;
}
.as-source-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
}
.as-source-opt {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 16px 8px;
    cursor: pointer;
    transition: all 0.15s;
    color: #cbd5e1;
}
.as-source-opt:hover { background: rgba(255,255,255,0.1); border-color: var(--accent, #5865f2); color: #fff; }
.as-source-icon { font-size: 24px; }
.as-source-label { font-size: 12px; font-weight: 600; text-align: center; }
.as-source-empty { font-size: 13px; color: #475569; grid-column: 1/-1; text-align: center; padding: 16px; }
.as-source-cancel {
    width: 100%; padding: 8px; background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
    color: #64748b; cursor: pointer; font-size: 13px; transition: all 0.15s;
}
.as-source-cancel:hover { color: #e2e8f0; }
</style>
