<template>
    <div class="as-scene-manager">
        <div class="as-scene-list">
            <button
                v-for="scene in scenes"
                :key="scene.id"
                class="as-scene-btn"
                :class="{ active: scene.id === activeId }"
                @click="$emit('switch', scene.id)"
                @dblclick="startRename(scene)"
            >
                <span v-if="renamingId !== scene.id">{{ scene.name }}</span>
                <input
                    v-else
                    class="as-scene-rename"
                    v-model="renameValue"
                    @blur="commitRename(scene)"
                    @keydown.enter="commitRename(scene)"
                    @keydown.escape="renamingId = null"
                    @click.stop
                    ref="renameInput"
                />
            </button>
            <button class="as-scene-add" @click="$emit('add')" title="New scene">＋</button>
        </div>
        <button
            v-if="scenes.length > 1"
            class="as-scene-delete"
            @click="$emit('delete', activeId)"
            title="Delete scene"
        >🗑</button>
    </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'

const props = defineProps({
    scenes:   { type: Array,  required: true },
    activeId: { type: String, required: true },
})

const emit = defineEmits(['switch', 'add', 'delete', 'rename'])

const renamingId  = ref(null)
const renameValue = ref('')
const renameInput = ref(null)

function startRename(scene) {
    renamingId.value  = scene.id
    renameValue.value = scene.name
    nextTick(() => renameInput.value?.[0]?.focus())
}

function commitRename(scene) {
    const name = renameValue.value.trim()
    if (name && name !== scene.name) emit('rename', { id: scene.id, name })
    renamingId.value = null
}
</script>

<style scoped>
.as-scene-manager {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(0,0,0,0.4);
    border-top: 1px solid rgba(255,255,255,0.08);
}
.as-scene-list {
    display: flex;
    gap: 4px;
    flex: 1;
    flex-wrap: wrap;
}
.as-scene-btn {
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8;
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    min-width: 60px;
    text-align: center;
}
.as-scene-btn:hover { background: rgba(255,255,255,0.12); color: #e2e8f0; }
.as-scene-btn.active { background: var(--accent, #5865f2); border-color: var(--accent, #5865f2); color: #fff; }
.as-scene-add {
    background: rgba(255,255,255,0.05);
    border: 1px dashed rgba(255,255,255,0.15);
    color: #64748b;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.15s;
}
.as-scene-add:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.3); }
.as-scene-rename {
    background: transparent;
    border: none;
    outline: none;
    color: #fff;
    font-size: 12px;
    width: 80px;
}
.as-scene-delete {
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 4px;
    transition: color 0.15s;
}
.as-scene-delete:hover { color: #ef4444; }
</style>
