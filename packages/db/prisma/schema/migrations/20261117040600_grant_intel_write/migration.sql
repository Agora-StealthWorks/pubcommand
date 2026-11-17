-- Intel gained an intel.write permission. Give it to existing owner/admin roles
-- that can already read Intel, so current workspaces keep full access.
INSERT INTO "role_permissions" ("id", "organization_id", "role_id", "permission", "effect")
SELECT gen_random_uuid(), rp."organization_id", rp."role_id", 'intel.write', 'ALLOW'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
WHERE rp."permission" = 'intel.read' AND rp."effect" = 'ALLOW' AND r."slug" IN ('owner', 'admin')
ON CONFLICT ("role_id", "permission") DO NOTHING;
