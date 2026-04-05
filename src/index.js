import AdvancedStreaming    from './AdvancedStreaming.vue'
import StreamControlPanel  from './StreamControlPanel.vue'

;(function () {
    window.__EluthPlugins = window.__EluthPlugins || {}
    window.__EluthPlugins['advanced-streaming'] = {
        zones:     ['stream-compositor'],
        component: AdvancedStreaming,

        // Popup components — mounted by PopupShell when URL matches the popup registry.
        // bootstrap() is never called in popup contexts.
        popupComponents: {
            StreamControlPanel,
        },
    }
})()
