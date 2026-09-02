import cron from "node-cron";

/**
 * A cron expression from the environment, or a deliberate "off".
 *
 * Some of these jobs mail the whole company. Turning one off has to be a plain,
 * obvious thing somebody can do at two in the morning without editing code —
 * and it has to be distinguishable from a typo, because a mistyped expression
 * that silently disables a job is how a digest stops arriving for a month
 * before anyone notices.
 *
 * So "off" is a word, and anything else that will not parse is an error the
 * logs complain about.
 */
export function cronSetting(name: string, expr: string): string | null {
  const v = (expr ?? "").trim();
  if (!v || ["off", "none", "disabled", "false"].includes(v.toLowerCase())) {
    console.log(`⏸️  ${name} is off — that job will not run.`);
    return null;
  }
  if (!cron.validate(v)) {
    console.error(`❌ invalid ${name} "${v}" — that job will not run. Use a cron expression, or "off".`);
    return null;
  }
  return v;
}
