/**
 * Which provider settings are present. The Domains page shows exactly what is
 * missing; nothing here is ever sent to the browser except the variable names.
 */

export type EnvRequirement = { name: string; purpose: string; where: string };

export const CLOUDFLARE_ENV: EnvRequirement[] = [
  {
    name: "CLOUDFLARE_API_TOKEN",
    purpose: "Searches, prices and buys domains through Cloudflare Registrar, and creates their DNS records.",
    where:
      "Cloudflare dashboard → My Profile → API Tokens → Create Token (custom) with Account · Registrar · Edit, Zone · Zone · Edit and Zone · DNS · Edit on this account.",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    purpose: "The Cloudflare account that pays for and owns bought domains (billing must be set up there).",
    where: "Cloudflare dashboard → Account home → the ⋯ menu next to the account name → Copy account ID.",
  },
];

export const RAILWAY_ENV: EnvRequirement[] = [
  {
    name: "RAILWAY_API_TOKEN",
    purpose: "Adds and removes custom domains on the pubcommand service and reads their DNS and certificate status.",
    where: "Railway → Account Settings → Tokens → Create a workspace token for the workspace that owns the project.",
  },
  {
    name: "RAILWAY_PROJECT_ID",
    purpose: "The Railway project of the pubcommand service.",
    where: "Set automatically by Railway inside the service. Elsewhere: project → Settings → Project ID.",
  },
  {
    name: "RAILWAY_SERVICE_ID",
    purpose: "The pubcommand web service the domains are attached to.",
    where: "Set automatically by Railway inside the service. Elsewhere: service → Settings → Service ID.",
  },
  {
    name: "RAILWAY_ENVIRONMENT_ID",
    purpose: "The Railway environment (production) the domains belong to.",
    where: "Set automatically by Railway inside the service. Elsewhere: the environment's settings page.",
  },
];

function missing(list: EnvRequirement[], env: NodeJS.ProcessEnv): EnvRequirement[] {
  return list.filter((item) => !env[item.name]?.trim());
}

export function domainsConfig(env: NodeJS.ProcessEnv = process.env) {
  const cloudflareMissing = missing(CLOUDFLARE_ENV, env);
  const railwayMissing = missing(RAILWAY_ENV, env);
  return {
    cloudflare: {
      ready: cloudflareMissing.length === 0,
      missing: cloudflareMissing,
      sandbox: env.CLOUDFLARE_REGISTRAR_SANDBOX === "true",
    },
    railway: { ready: railwayMissing.length === 0, missing: railwayMissing },
  };
}
