-- Editors can publish on Websites and Mini-Blog; everyone with ChartBuilder can use it.
-- Additive: only inserts grants, never removes one.
--
-- 1. websites.publish no longer covers site settings, homepage, menus, new sites or API
--    keys: those moved to websites.settings. Every role that could publish keeps them.
INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
SELECT gen_random_uuid(), rp.organization_id, rp.role_id, 'websites.settings', 'ALLOW'
FROM role_permissions rp
WHERE rp.permission = 'websites.publish' AND rp.effect = 'ALLOW'
ON CONFLICT (role_id, permission) DO NOTHING;

-- 2. miniblog.publish no longer covers taking a Mini-Blog live, deleting it or exporting
--    SMS opt-ins: those moved to miniblog.manage. Every role that could publish keeps them.
INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
SELECT gen_random_uuid(), rp.organization_id, rp.role_id, 'miniblog.manage', 'ALLOW'
FROM role_permissions rp
WHERE rp.permission = 'miniblog.publish' AND rp.effect = 'ALLOW'
ON CONFLICT (role_id, permission) DO NOTHING;

-- 3. Built-in User and Editor roles: ChartBuilder for everyone.
INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
SELECT gen_random_uuid(), r.organization_id, r.id, 'charts.read', 'ALLOW'
FROM roles r
WHERE r.is_system AND r.slug IN ('user', 'editor')
ON CONFLICT (role_id, permission) DO NOTHING;

-- 4. Built-in Editor role: publish website posts and pages, write and publish Mini-Blog posts.
INSERT INTO role_permissions (id, organization_id, role_id, permission, effect)
SELECT gen_random_uuid(), r.organization_id, r.id, p, 'ALLOW'
FROM roles r, unnest(ARRAY['websites.publish', 'miniblog.write', 'miniblog.publish']) AS p
WHERE r.is_system AND r.slug = 'editor'
ON CONFLICT (role_id, permission) DO NOTHING;
