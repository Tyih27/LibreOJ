"use strict";

// Deliberately broken: the `libreoj` manifest is a string, not an object, so the manifest is malformed.
module.exports.plugin = { name: "@fixture/bad-manifest", apply() {} };
