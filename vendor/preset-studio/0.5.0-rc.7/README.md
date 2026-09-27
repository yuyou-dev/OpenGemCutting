# Crown / pavilion laboratory

Native ESM API 2. mountPresetStudio(element, options) or createPresetStudioSession(options). Source and newDesign are mutually exclusive. Host owns persistence and onResult. Lifecycle: pause, resume, flush, returnResult, dispose. flush preserves unapplied edits; returnResult requires applied groups.

Rebuild: cd source && npm ci && npm run module:build. No development server or adjacent source checkout is required at runtime.
