"use strict";

// Deliberately broken: a usable definition shape (name + apply) but malformed metadata in every declared field.
module.exports.plugin = {
  name: "@fixture/bad-inject",
  inject: { required: "greeting" },
  provide: "not-an-array",
  config: { defaults: "nope", parse: "nope" },
  apply() {}
};
