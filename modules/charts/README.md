# Charts

Route: `/charts` on the organization host (`https://{org}.{ROOT_DOMAIN}/charts`).

Paste a two-column CSV, draw one line chart in the PubCommand brand accent (`#1d4ed8`), add an annotation, download SVG, and create a share link. The token is HMAC-signed and bound to the organization id, so another org cannot open it.

`id`, `slug`, and `planEntitlement` are `charts`. Permissions are `charts.read` and `charts.write`. Seeded roles grant `charts.read`; either permission can use this slice.

## Example CSV

```csv
month,readers
Jan,1200
Feb,1380
Mar,1290
Apr,1510
May,1620
Jun,1580
```

The first row is the header. Column one is the label. Column two is the number.

## TODO

- TODO: live FRED series import is not connected.
- TODO: PNG export.
- TODO: video transcription.
