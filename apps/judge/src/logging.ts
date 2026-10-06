/**
 * Side-effect-only module that installs the process-wide winston console transport. It is imported first by the judge
 * entry point, before anything that logs (including the root-privilege check), so early messages are not dropped.
 */

import winston from "winston";

winston.add(
  new winston.transports.Console({
    level: process.env.LIBREOJ_JUDGE_LOG_LEVEL || "info",
    format: winston.format.combine(winston.format.cli())
  })
);
