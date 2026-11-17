-- Mini-Blog becomes its own app (formerly "text-letter sites" inside Funnels).
-- Additive only: the text_sites, text_posts, text_optins and text_views tables
-- (created in 20261117040800_funnels_launch_and_text_sites) are NOT touched.
-- Their Prisma models moved from funnels.prisma to miniblog.prisma unchanged.

-- Add the module to the default plans that already carry Funnels.
INSERT INTO "plan_modules" ("plan_id", "module_id")
SELECT p."id", 'miniblog' FROM "plans" p WHERE p."key" IN ('internal', 'enterprise', 'pro')
ON CONFLICT DO NOTHING;

-- Give the three Mini-Blog permissions to the existing owner and admin roles.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), r."organization_id", r."id", perm.permission, 'ALLOW'
FROM "roles" r
CROSS JOIN (VALUES ('miniblog.read'), ('miniblog.write'), ('miniblog.publish')) AS perm(permission)
WHERE r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
