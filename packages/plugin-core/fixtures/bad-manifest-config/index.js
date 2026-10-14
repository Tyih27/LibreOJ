"use strict";

// A valid plugin whose manifest declares a non-object `config`, which the validator must reject.
module.exports.plugin = { name: "@fixture/bad-manifest-config", apply() {} };
