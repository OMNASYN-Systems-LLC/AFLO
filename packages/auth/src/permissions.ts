/**
 * The explicit permission vocabulary (founder directive PHASE 4).
 *
 * Protected operations check a PERMISSION, never a role name directly — a role
 * maps to a set of permissions (see policies.ts), so the boundary can be tuned
 * without rewriting call sites. Permissions are `resource.action` strings.
 */

export const PERMISSIONS = [
  // Leads / CRM intake
  "lead.read",
  "lead.create",
  "lead.update",
  "lead.convert",
  // Clients
  "client.read",
  "client.update",
  "client.assign",
  // Intake / onboarding
  "intake.read",
  "intake.review",
  "intake.approve",
  // Roadmaps
  "roadmap.create",
  "roadmap.review",
  "roadmap.approve",
  "roadmap.publish",
  // Tasks / monthly actions
  "task.assign",
  "task.verify",
  // Documents
  "document.request",
  "document.read",
  "document.review",
  "document.download",
  // Appointments
  "appointment.manage",
  "appointment.book",
  // Secure messaging
  "message.send",
  "message.read",
  "message.assign",
  "message.close",
  // Quarterly reports
  "report.generate",
  "report.review",
  "report.publish",
  // Billing
  "billing.read",
  "billing.manage",
  // Organization administration
  "organization.manage_members",
  "organization.manage_settings",
  // Audit
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
