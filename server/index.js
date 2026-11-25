// Z.ai / Zhipu GLM, the server half: registers two connection kinds:
//   1. "glm-coding" -> Z.ai / GLM Coding Plan (https://api.z.ai/api/coding/paas/v4)
//   2. "glm"        -> Z.ai / GLM Standard API (https://api.z.ai/api/paas/v4)

const ENDPOINTS = {
    global: {
        standard: 'https://api.z.ai/api/paas/v4',
        coding: 'https://api.z.ai/api/coding/paas/v4',
    },
    cn: {
        standard: 'https://open.bigmodel.cn/api/paas/v4',
        coding: 'https://open.bigmodel.cn/api/coding/paas/v4',
    },
};

// Known GLM model metadata (context window & vision support) used to enrich /models responses
// and as a fallback catalog when /models is queried without a key or on a restricted route.
const KNOWN_MODELS = [
    { id: 'glm-5.3', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-5.2', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-5', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-5-turbo', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-4.7', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-4.6', contextLength: 200000, vision: false, coding: true },
    { id: 'glm-4.6v', contextLength: 128000, vision: true, coding: true },
    { id: 'glm-4.5', contextLength: 128000, vision: false, coding: true },
    { id: 'glm-4.5-air', contextLength: 128000, vision: false, coding: true },
    { id: 'glm-4.5-airx', contextLength: 128000, vision: false, coding: false },
    { id: 'glm-4.5-flash', contextLength: 128000, vision: false, coding: true },
    { id: 'glm-4.5v', contextLength: 64000, vision: true, coding: true },
    { id: 'glm-4-plus', contextLength: 128000, vision: false, coding: false },
    { id: 'glm-4-air-250414', contextLength: 128000, vision: false, coding: false },
    { id: 'glm-4-flash-250414', contextLength: 128000, vision: false, coding: false },
    { id: 'glm-4v-plus-0111', contextLength: 16000, vision: true, coding: false },
    { id: 'glm-4v-flash', contextLength: 16000, vision: true, coding: false },
    { id: 'glm-z1-air', contextLength: 128000, vision: false, coding: false },
    { id: 'glm-z1-airx', contextLength: 32000, vision: false, coding: false },
    { id: 'glm-z1-flash', contextLength: 128000, vision: false, coding: false },
];

const KNOWN_BY_ID = new Map(KNOWN_MODELS.map(m => [m.id, m]));

const AUTH_CODES = new Set(['1000', '1001', '1002', '1003', '1004']);
const QUOTA_CODES = new Set(['1110', '1111', '1112', '1113', '1120']);
const RATE_LIMIT_CODES = new Set(['1302', '1303', '1305']);
const CONTEXT_CODES = new Set(['1261']);

function inferModelMeta(id) {
    const known = KNOWN_BY_ID.get(id);
    if (known) return { contextLength: known.contextLength, vision: known.vision };
    const lower = String(id || '').toLowerCase();
    const isVision = /\bglm-[0-9.]+v\b|vision|vl\b/.test(lower);
    const is200k = /^glm-(?:4\.[6-9]|5)/.test(lower);
    return {
        contextLength: is200k ? 200000 : 128000,
        ...(isVision ? { vision: true } : {}),
    };
}

export function register(router, ctx) {
    const { LlmError, classifyUpstream, boundedErrorText, networkError, readJsonBody, parseSse, translateParams } = ctx.llm.kit;

    const dbByProfile = new Map();
    let lastDb = null;

    ctx.hooks.add('llm.request', (req, facts) => {
        if (facts?.db) {
            lastDb = facts.db;
            if (facts.profileId) dbByProfile.set(facts.profileId, facts.db);
        }
        return req;
    });

    function accountSettings(profile) {
        const db = (profile?.id && dbByProfile.get(profile.id)) || lastDb;
        if (!db) return { region: 'global', thinkingMode: 'auto', clampSamplers: true };
        try {
            return {
                region: ctx.setting(db, 'region') === 'cn' ? 'cn' : 'global',
                thinkingMode: String(ctx.setting(db, 'thinkingMode') || 'auto'),
                clampSamplers: ctx.setting(db, 'clampSamplers') !== false,
            };
        } catch {
            return { region: 'global', thinkingMode: 'auto', clampSamplers: true };
        }
    }

    const PARAMS = {
        temperature: 'temperature',
        topP: 'top_p',
        maxTokens: 'max_tokens',
        stop: 'stop',
        seed: 'seed',
        json: (on, body) => { if (on) body.response_format = { type: 'json_object' }; },
        reasoning: (r, body) => {
            if (r?.effort === 'none') {
                body.thinking = { type: 'disabled' };
                return;
            }
            body.thinking = { type: 'enabled' };
            // GLM-5.x reads reasoning_effort and names none to max itself (tried live on glm-5 to 5.4, 2026-11-25), so the word goes as picked
            if (r?.effort && /^glm-5/i.test(String(body.model || ''))) {
                body.reasoning_effort = r.effort;
            }
        },
    };

    function baseOf(profile, isCoding) {
        const raw = String(profile.base_url || '').trim().replace(/\/+$/, '');
        const { region } = accountSettings(profile);
        const table = ENDPOINTS[region] || ENDPOINTS.global;
        const defaultUrl = isCoding ? table.coding : table.standard;
        // If the profile left the default global URL unchanged and the user switched region to CN, honor CN
        if (!raw || (region === 'cn' && raw === (isCoding ? ENDPOINTS.global.coding : ENDPOINTS.global.standard))) {
            return defaultUrl;
        }
        return raw;
    }

    const headers = (profile) => ({
        'Content-Type': 'application/json',
        ...(profile.api_key ? { Authorization: `Bearer ${profile.api_key}` } : {}),
    });

    function wireMessage({ images, ...m }) {
        if (!images?.length) return m;
        const text = typeof m.content === 'string'
            ? (m.content ? [{ type: 'text', text: m.content }] : [])
            : (Array.isArray(m.content) ? m.content : []);
        return {
            ...m,
            content: [
                ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } })),
                ...text,
            ],
        };
    }

    function buildBody(profile, req, stream) {
        const model = req.model || profile.model || 'glm-4.7';
        const body = {
            model,
            messages: req.messages.map(wireMessage),
            stream,
        };
        translateParams(req.params || {}, PARAMS, body, { debug: req.debug });

        const { thinkingMode, clampSamplers } = accountSettings(profile);
        if (thinkingMode === 'enabled' && !body.thinking) {
            body.thinking = { type: 'enabled' };
        } else if (thinkingMode === 'disabled' && !req.params?.reasoning) {
            body.thinking = { type: 'disabled' };
        }

        // Zhipu's PAAS v4 rejects temperature <= 0 or > 1 (unless do_sample is false) and top_p <= 0 or >= 1
        if (clampSamplers) {
            if (typeof body.temperature === 'number') {
                if (body.temperature <= 0) {
                    body.do_sample = false;
                    delete body.temperature;
                } else if (body.temperature > 1) {
                    body.temperature = 1.0;
                }
            }
            if (typeof body.top_p === 'number') {
                body.top_p = Math.min(0.99, Math.max(0.01, body.top_p));
            }
        }
        return body;
    }

    function contentOf(choice) {
        let content = choice?.message?.content;
        if (Array.isArray(content)) content = content.filter(b => b?.type === 'text').map(b => b.text).join('');
        if (typeof content !== 'string') content = choice?.text ?? '';
        return content;
    }

    function reasoningOf(holder) {
        if (!holder) return '';
        const direct = holder.reasoning_content ?? holder.reasoning;
        return typeof direct === 'string' && direct ? direct : '';
    }

    function glmError(data, fallbackStatus, isCoding) {
        const err = data?.error;
        const code = String(err?.code ?? '');
        let msg = typeof err === 'string' ? err : (err?.message || `GLM error ${code || fallbackStatus}`);
        if (code && !msg.includes(code)) msg = `[GLM ${code}] ${msg}`;

        if (QUOTA_CODES.has(code)) {
            if (code === '1113' && !isCoding) {
                msg += ' (Tip: If using a GLM Coding Plan key, switch the connection Kind to "Z.ai / GLM Coding Plan".)';
            }
            return new LlmError('quota', msg.slice(0, 500), { status: fallbackStatus || 429, retryable: false });
        }
        if (RATE_LIMIT_CODES.has(code)) {
            return new LlmError('rate_limit', msg.slice(0, 500), { status: fallbackStatus || 429, retryable: true });
        }
        if (AUTH_CODES.has(code)) {
            return new LlmError('auth', msg.slice(0, 500), { status: fallbackStatus || 401, retryable: false });
        }
        if (CONTEXT_CODES.has(code)) {
            return new LlmError('context', msg.slice(0, 500), { status: fallbackStatus || 400, retryable: false });
        }
        return classifyUpstream({ status: fallbackStatus || 502 }, JSON.stringify({ error: { message: msg } }));
    }

    async function request(profile, isCoding, path, init, signal) {
        let resp;
        try {
            resp = await fetch(`${baseOf(profile, isCoding)}${path}`, { ...init, signal });
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            throw networkError(err);
        }
        if (!resp.ok) {
            const text = await boundedErrorText(resp);
            try {
                const parsed = JSON.parse(text);
                if (parsed?.error) throw glmError(parsed, resp.status, isCoding);
            } catch (e) {
                if (e instanceof LlmError) throw e;
            }
            throw classifyUpstream(resp, text);
        }
        return resp;
    }

    function makeAdapter({ kind, displayName, defaultBaseUrl, isCoding }) {
        return {
            kind,
            displayName,
            defaultBaseUrl,
            requiresBaseUrl: false,
            capabilities: { streaming: true, json: true, reasoning: true, vision: true },
            paramTable: PARAMS,

            async chat(profile, req, signal) {
                const resp = await request(profile, isCoding, '/chat/completions', {
                    method: 'POST', headers: headers(profile), body: JSON.stringify(buildBody(profile, req, false)),
                }, signal);
                const data = await readJsonBody(resp, signal);
                if (data?.error) throw glmError(data, resp.status, isCoding);
                const choice = data?.choices?.[0];
                if (!choice) throw new LlmError('upstream', 'unrecognized response shape');
                const content = contentOf(choice);
                if (typeof content !== 'string') throw new LlmError('upstream', 'unrecognized response shape');
                const reasoning = reasoningOf(choice.message);
                return {
                    content,
                    ...(reasoning ? { reasoning } : {}),
                    finishReason: choice.finish_reason ?? null,
                    ...(data.usage ? { usage: data.usage } : {}),
                };
            },

            async *chatStream(profile, req, signal) {
                const resp = await request(profile, isCoding, '/chat/completions', {
                    method: 'POST', headers: headers(profile), body: JSON.stringify(buildBody(profile, req, true)),
                }, signal);
                let finishReason = null;
                let usage;
                let ended = false;
                let read = false;
                for await (const frame of parseSse(resp.body, signal)) {
                    if (frame.data === '[DONE]') { ended = true; break; }
                    let data;
                    try { data = JSON.parse(frame.data); } catch { continue; }
                    read = true;
                    if (data?.error) throw glmError(data, 502, isCoding);
                    const choice = data?.choices?.[0];
                    const delta = choice?.delta;
                    if (typeof delta?.content === 'string' && delta.content) yield { text: delta.content };
                    const reasoning = reasoningOf(delta);
                    if (reasoning) yield { reasoning };
                    if (choice?.finish_reason) finishReason = choice.finish_reason;
                    if (data?.usage) usage = data.usage;
                }
                if (!ended && !finishReason && !read) throw new LlmError('upstream', 'unrecognized response shape');
                if (!ended && !finishReason) throw new LlmError('network', 'the reply stream ended before the endpoint finished the reply', { retryable: true });
                yield { done: { finishReason, ...(usage ? { usage } : {}) } };
            },

            async listModels(profile, signal) {
                const fallback = KNOWN_MODELS
                    .filter(m => !isCoding || m.coding)
                    .map(({ id, contextLength, vision }) => ({ id, contextLength, vision }));

                if (!profile.api_key) {
                    return fallback.sort((a, b) => a.id.localeCompare(b.id));
                }

                let rows = null;
                try {
                    const resp = await request(profile, isCoding, '/models', { method: 'GET', headers: headers(profile) }, signal);
                    const data = await readJsonBody(resp, signal);
                    rows = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : null);
                } catch (err) {
                    // Auth errors should surface; if /models is unsupported (404) on a coding route, return fallback catalog
                    if (err instanceof LlmError && err.kind === 'auth') throw err;
                    return fallback.sort((a, b) => a.id.localeCompare(b.id));
                }

                if (!rows || !rows.length) return fallback.sort((a, b) => a.id.localeCompare(b.id));

                const byId = new Map();
                for (const m of fallback) byId.set(m.id, m);
                for (const m of rows) {
                    const id = String(m?.id ?? m?.name ?? '').trim();
                    if (!id) continue;
                    const meta = inferModelMeta(id);
                    const ctxLen = Number.isFinite(m?.context_length) && m.context_length > 0 ? m.context_length : meta.contextLength;
                    const vision = typeof m?.capabilities?.vision === 'boolean' ? m.capabilities.vision : meta.vision;
                    byId.set(id, {
                        id,
                        ...(ctxLen ? { contextLength: ctxLen } : {}),
                        ...(typeof vision === 'boolean' ? { vision } : {}),
                    });
                }
                return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
            },
        };
    }

    ctx.llm.registerAdapter(makeAdapter({
        kind: 'glm-coding',
        displayName: 'Z.ai / GLM Coding Plan',
        defaultBaseUrl: ENDPOINTS.global.coding,
        isCoding: true,
    }));

    ctx.llm.registerAdapter(makeAdapter({
        kind: 'glm',
        displayName: 'Z.ai / GLM Standard API',
        defaultBaseUrl: ENDPOINTS.global.standard,
        isCoding: false,
    }));
}
