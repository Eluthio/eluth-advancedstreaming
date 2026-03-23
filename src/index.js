import AdvancedStreaming from './AdvancedStreaming.vue'

;(function () {
    window.__EluthPlugins = window.__EluthPlugins || {}
    window.__EluthPlugins['advanced-streaming'] = {
        zones:     ['stream-compositor'],
        component: AdvancedStreaming,
    }
})()
