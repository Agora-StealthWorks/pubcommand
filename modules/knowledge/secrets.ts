/**
 * Spot text that looks like a credential, so importers can skip the whole note.
 * Reports the kind and line only; never returns the value itself.
 */
export type SecretHit = { kind: string; line: number };

const PATTERNS: readonly { kind: string; regex: RegExp }[] = [
  { kind: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: "OpenAI-style API key", regex: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{24,}/ },
  { kind: "Stripe key", regex: /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { kind: "AWS access key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "GitHub token", regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { kind: "Slack token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "Private key", regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { kind: "JSON web token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: "Bearer token", regex: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
];

const URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@[^\s/]+/gi;

const ASSIGNMENT =
  /\b(api[_ -]?key|apikey|secret[_ -]?key|client[_ -]?secret|access[_ -]?token|auth[_ -]?token|refresh[_ -]?token|private[_ -]?key|token|password|passwd|pwd|secret|pat)\b["'*_]*\s*(?:[:=]|=>|\bis\b)\s*["'`*_]*([^\s"'`,;)*<>]{8,})/gi;

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  if (/^(?:\*+|x+|\.+|•+|-+|_+)$/i.test(v)) return true;
  if (/^[<{[(].*[>}\])]$/.test(v) || v.startsWith("${") || v.startsWith("$")) return true;
  if (/^(?:process\.env|env\.|import\.meta)/i.test(v)) return true;
  if (/^https?:/i.test(v)) return true;
  // ENV_VAR_NAMES and plain words are names, not values.
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return true;
  if (/^[a-z]+(?:[-_ ][a-z]+)*$/.test(v)) return true;
  if (/^(?:password|passw0rd|changeme|example|placeholder|redacted|your[-_a-z]*|none|null|undefined|true|false|required|optional)$/i.test(v)) return true;
  return false;
}

function looksRandom(value: string): boolean {
  const hasDigit = /[0-9]/.test(value);
  const hasLetter = /[A-Za-z]/.test(value);
  const mixedCase = /[A-Z]/.test(value) && /[a-z]/.test(value);
  if (hasDigit && hasLetter) return true;
  return value.length >= 20 && mixedCase && !/\s/.test(value);
}

export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) hits.push({ kind: pattern.kind, line: lineNo });
    }
    for (const match of line.matchAll(URL_WITH_PASSWORD)) {
      const password = match[1] ?? "";
      if (!isPlaceholder(password) && password.length >= 3) hits.push({ kind: "Connection string with a password", line: lineNo });
    }
    for (const match of line.matchAll(ASSIGNMENT)) {
      const value = (match[2] ?? "").replace(/[.:]+$/, "");
      if (value.length >= 8 && !isPlaceholder(value) && looksRandom(value)) {
        hits.push({ kind: `Value for "${(match[1] ?? "").toLowerCase()}"`, line: lineNo });
      }
    }
  });
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.kind}:${hit.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasSecrets(text: string): boolean {
  return findSecrets(text).length > 0;
}

/** "Bearer token (line 4), AWS access key (line 9)". Never includes the value. */
export function describeSecrets(hits: readonly SecretHit[], max = 3): string {
  const parts = hits.slice(0, max).map((hit) => `${hit.kind} (line ${hit.line})`);
  if (hits.length > max) parts.push(`${hits.length - max} more`);
  return parts.join(", ");
}
