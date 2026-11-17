/** Waitlist email validation. (Phone numbers and SMS consent moved to modules/miniblog/sms.ts.) */
export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(value);
}
