# Forms

Route: `/forms`. One org-scoped form per organization.

Permissions: `forms.read`, `forms.write`, `forms.export`. Plan entitlement: `forms`.

This slice has a field library (text, email, select), drag-reorder, a live preview, save, and a responses list with a count. The form and responses are example data held in memory for the organization.

`apps/web/src/app/sites/org/[slug]/forms/page.tsx` renders the slice for `/forms`.

TODO: Branching logic is not in this slice.
TODO: SMS and TLetter landing pages are not connected to forms yet.
