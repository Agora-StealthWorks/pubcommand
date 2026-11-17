import { can, type AccessScope, type AccessSubject } from "@pubcommand/core";

export const TESTIMONIALS_MODULE = "testimonials";
export type TestimonialPermission = "testimonials.read" | "testimonials.write" | "testimonials.approve";

export function canTestimonials(subject: AccessSubject, scope: AccessScope, permission: TestimonialPermission): boolean {
  return subject.entitledModuleIds.includes(TESTIMONIALS_MODULE) && can(subject, permission, scope);
}
