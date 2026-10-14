"use strict";

// A valid package that declares no `libreoj` block: the resolver falls back to `main`, which yields a warning.
module.exports.plugin = {
  name: "@fixture/main-only",
  apply() {}
};
