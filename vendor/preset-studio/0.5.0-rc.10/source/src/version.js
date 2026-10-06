import metadata from "../package.json" with { type: "json" };

// One release identifier for all visible application headers.
export const APP_VERSION = metadata.version;
