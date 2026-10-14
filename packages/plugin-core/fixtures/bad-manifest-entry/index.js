"use strict";

// A valid plugin whose manifest declares a non-string `entry`, which the validator must reject.
module.exports.plugin = { name: "@fixture/bad-manifest-entry", apply() {} };
