// Z.ai / GLM client half: region, thinking mode, and sampler clamping controls in Settings > Extensions.

export default {
    init(ctx) {
        ctx.ui.addSettingsSection((el) => {
            const draw = () => {
                const region = String(ctx.settings.get('region') || 'global');
                const thinkingMode = String(ctx.settings.get('thinkingMode') || 'auto');
                const clampSamplers = ctx.settings.get('clampSamplers') !== false;

                el.innerHTML = `
                    <div class="settings-row">
                        <label for="glm-region">Default API region</label>
                        <select id="glm-region" class="glass-input" data-glm-set="region">
                            <option value="global"${region !== 'cn' ? ' selected' : ''}>Global — api.z.ai (International)</option>
                            <option value="cn"${region === 'cn' ? ' selected' : ''}>Mainland China — open.bigmodel.cn</option>
                        </select>
                        <span class="settings-hint">Used when a connection leaves the default Base URL unchanged. Coding Plan uses <code>/api/coding/paas/v4</code>; Standard API uses <code>/api/paas/v4</code>.</span>
                    </div>
                    <div class="settings-row">
                        <label for="glm-thinking">Thinking mode (GLM-4.5 / 4.6 / 4.7 / 5)</label>
                        <select id="glm-thinking" class="glass-input" data-glm-set="thinkingMode">
                            <option value="auto"${thinkingMode === 'auto' ? ' selected' : ''}>Auto (follow connection Reasoning effort)</option>
                            <option value="enabled"${thinkingMode === 'enabled' ? ' selected' : ''}>Always Enabled (thinking: { type: "enabled" })</option>
                            <option value="disabled"${thinkingMode === 'disabled' ? ' selected' : ''}>Disabled unless Reasoning effort is set (instant replies)</option>
                        </select>
                        <span class="settings-hint">Controls Zhipu's <code>thinking</code> parameter; thoughts stream into Project Σ's Thinking fold via <code>reasoning_content</code>.</span>
                    </div>
                    <div class="settings-row">
                        <label><input type="checkbox" class="cl-switch-input" data-glm-bool="clampSamplers"${clampSamplers ? ' checked' : ''}><span class="cl-switch" aria-hidden="true"></span> Clamp temperature (0–1) and top_p (0.01–0.99) to Zhipu API limits</label>
                        <span class="settings-hint">Prevents HTTP 400 parameter errors when using roleplay presets with temperature &gt; 1.0 or top_p = 1.0.</span>
                    </div>`;

                for (const input of el.querySelectorAll('[data-glm-set]')) {
                    input.addEventListener('change', () => {
                        ctx.settings.set(input.dataset.glmSet, input.value.trim());
                    });
                }
                for (const input of el.querySelectorAll('[data-glm-bool]')) {
                    input.addEventListener('change', () => {
                        ctx.settings.set(input.dataset.glmBool, !!input.checked);
                    });
                }
            };
            draw();
        });
    },
};
