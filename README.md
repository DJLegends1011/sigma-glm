# Z.ai / GLM (Standard & Coding Plan) for Project Σ (`glm`)

> **Status:** `v1.0.0-beta` — Beta release for Project Σ frontend & extension testing.

Adds **two native connection kinds** for **Z.ai (Zhipu AI / BigModel)** in Project Σ (`ctx.llm.registerAdapter`):

1. **Z.ai / GLM Coding Plan (`glm-coding`)**
   - Default Base URL: `https://api.z.ai/api/coding/paas/v4` *(or `https://open.bigmodel.cn/api/coding/paas/v4` when Mainland China region is selected)*
   - Built specifically for **GLM Coding Plan** subscriptions (which return error `1113` if used on the standard pay-as-you-go endpoint).
2. **Z.ai / GLM Standard API (`glm`)**
   - Default Base URL: `https://api.z.ai/api/paas/v4` *(or `https://open.bigmodel.cn/api/paas/v4`)*
   - Built for standard pay-as-you-go API keys and general model access.

## Features

- **Dual Connection Kinds**: Add either **Z.ai / GLM Coding Plan** or **Z.ai / GLM Standard API** in **Settings > AI**—no manual endpoint URL typing required.
- **Built-in & Live Model Catalog**: Queries `/models` and enriches models (`glm-5.3`, `glm-5.2`, `glm-5`, `glm-4.7`, `glm-4.6`, `glm-4.6v`, `glm-4.5`, `glm-4.5-air`, `glm-4.5-flash`, `glm-4.5v`, `glm-z1-*`, etc.) with accurate context windows (`200K` / `128K`) and `vision` flags. Also works offline/before entering a key so you can pick a model right away.
- **GLM Thinking Mode (`thinking` & `reasoning_content`)**:
  - Maps Project Σ's **Reasoning effort** (`low`, `medium`, `high`) to Zhipu's `thinking: { type: "enabled" }` (and `reasoning_effort` on `glm-5*` models).
  - Extracts `reasoning_content` in both streaming and non-streaming modes into Project Σ's collapsible **Thinking** fold.
  - Configurable in **Settings > Extensions > Z.ai / GLM** (`Auto`, `Always Enabled`, or `Disabled` for instant replies).
- **Automatic Sampler Clamping**: Clamps `temperature` to `(0, 1.0]` (or sets `do_sample: false` at `0`) and `top_p` to `[0.01, 0.99]` so roleplay presets with `temperature > 1.0` or `top_p = 1.0` never trigger Zhipu `400` validation rejections.
- **Zhipu Error Code Translation**: Translates Zhipu's 4-digit business error codes (`1113` quota/wrong plan endpoint, `1302`/`1303`/`1305` concurrency & rate limits with automatic retry, `1001`–`1004` auth, `1261` context length) into Project Σ's native error taxonomy.

## Installation

### From a `.zip` Archive or Folder
1. In Project Σ, open **Settings > Extensions** and upload `glm.zip` (or copy the `glm` folder into `extensions/installed/glm/`).
2. Restart the Project Σ server so the backend adapters mount, then toggle **Z.ai / GLM (Standard & Coding Plan)** on.

### From Git
1. In **Settings > Extensions**, install from `https://github.com/DJLegends1011/sigma-glm.git`.
2. Restart the Project Σ server and switch **Z.ai / GLM (Standard & Coding Plan)** on.
