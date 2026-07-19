import { notFound } from "next/navigation";
import { EmptyState, ProgressBar, SectionCard } from "@/components/ui";
import { demoNow, getClientSession, portalRepository } from "@/lib/data";
import { ACTION_STATUS_LABELS, fmtDate, fmtDateTime, fmtMonth } from "@/lib/format";
import { markClientThreadReadAction, sendClientMessageAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The client's own view. Rendered exclusively from the PortalView
 * projection, which is published-only by construction — internal reason
 * codes, review flags, drafts, and staff notes are not representable here.
 * Identity comes from the server-side session, never the browser.
 */
export default async function PortalPage() {
  const session = await getClientSession();
  const view = await portalRepository.getPortalView(session.organizationId, session.clientId, demoNow);
  if (!view) notFound();

  const openActions = view.monthlyActions.filter((a) => a.status !== "done");
  const doneActions = view.monthlyActions.length - openActions.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Welcome back, {view.clientFirstName}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Here is where your plan stands and what comes next.
        </p>
      </div>

      <SectionCard title="Where you are">
        {view.stage ? (
          <div>
            <p className="font-display text-2xl text-emerald-deep">{view.stage.label}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Current focus:</span> {view.stage.focus}
            </p>
            <p className="mt-2 text-[11px] text-ink-faint">
              Assessed {fmtDate(view.stage.assessedAt)} by your advisory team
            </p>
          </div>
        ) : (
          <EmptyState message="Your stage will appear here once your advisor completes your first assessment." />
        )}
      </SectionCard>

      <SectionCard title="Your goal">
        {view.primaryGoal ? (
          <div>
            <p className="text-sm font-medium text-ink">{view.primaryGoal.title}</p>
            <p className="mt-1 text-xs text-ink-faint">
              Target {fmtDate(view.primaryGoal.targetDate)}
            </p>
            <div className="mt-3">
              <ProgressBar pct={view.primaryGoal.progressPct} />
            </div>
          </div>
        ) : (
          <EmptyState message="Your advisor will set a goal with you." />
        )}
      </SectionCard>

      <SectionCard
        title="Your roadmap"
        subtitle={view.roadmap ? view.roadmap.title : undefined}
      >
        {view.roadmap ? (
          <ol className="space-y-3">
            {view.roadmap.milestones.map((ms) => (
              <li key={ms.title} className="flex gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    ms.status === "completed"
                      ? "bg-status-good text-ivory-ink"
                      : ms.status === "in_progress"
                        ? "border-2 border-gold"
                        : "border-2 border-line"
                  }`}
                >
                  {ms.status === "completed" ? "✓" : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p
                      className={`text-sm font-medium ${
                        ms.status === "completed" ? "text-ink-faint line-through" : "text-ink"
                      }`}
                    >
                      {ms.title}
                    </p>
                    <p className="text-xs text-ink-faint">{fmtMonth(ms.targetMonth)}</p>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{ms.description}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState message="Your roadmap is being prepared with your advisor." />
        )}
      </SectionCard>

      <SectionCard
        title="This month's actions"
        subtitle={`${doneActions} of ${view.monthlyActions.length} complete`}
      >
        {view.monthlyActions.length === 0 ? (
          <EmptyState message="No actions this month." />
        ) : (
          <ul className="divide-y divide-line/60">
            {view.monthlyActions.map((action) => (
              <li key={action.title} className="flex items-center justify-between gap-3 py-2.5">
                <span
                  className={`min-w-0 truncate text-sm ${
                    action.status === "done" ? "text-ink-faint line-through" : "text-ink"
                  }`}
                >
                  {action.title}
                </span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {ACTION_STATUS_LABELS[action.status]} · due {fmtDate(action.dueDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Next appointment">
        {view.nextAppointment ? (
          <div>
            <p className="text-sm font-medium text-ink">{fmtDateTime(view.nextAppointment.scheduledAt)}</p>
            <p className="mt-1 text-xs text-ink-soft">
              {view.nextAppointment.purpose} · with {view.nextAppointment.staffName} ·{" "}
              {view.nextAppointment.channel.replace("_", " ")}
            </p>
          </div>
        ) : (
          <EmptyState message="No appointment scheduled — your advisor will reach out." />
        )}
      </SectionCard>

      <SectionCard title="Wealth Academy" subtitle="Lessons your advisor assigned for you">
        {view.academy.length === 0 ? (
          <EmptyState message="No lessons assigned yet — your advisor will suggest learning as your plan progresses." />
        ) : (
          <ul className="divide-y divide-line/60">
            {view.academy.map((item) => (
              <li key={item.lessonTitle} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{item.lessonTitle}</p>
                  <p className="text-[11px] capitalize text-ink-faint">{item.format}</p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">
                  {item.completed ? "Completed" : "Assigned " + fmtDate(item.assigned)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Secure messages" subtitle="Your private thread with your advisory team">
        {view.conversations.length === 0 ? (
          <EmptyState message="No messages yet — your advisor will reach out here when there's something to discuss." />
        ) : (
          <div className="space-y-5">
            {view.conversations.map((thread, threadIndex) => (
              // Keyed by position (the client-safe projection is id-free); two
              // threads can share a subject, so subject is not a stable key.
              <div key={threadIndex}>
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink">{thread.subject}</p>
                    {thread.unreadCount > 0 ? (
                      <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[11px] font-medium text-gold-deep">
                        {thread.unreadCount} new
                      </span>
                    ) : null}
                  </div>
                  {thread.status === "closed" ? (
                    <span className="shrink-0 text-[11px] text-ink-faint">Closed</span>
                  ) : null}
                </div>
                {thread.unreadCount > 0 ? (
                  <form action={markClientThreadReadAction.bind(null, threadIndex)} className="mt-1">
                    <button
                      type="submit"
                      className="text-[11px] font-medium text-gold-deep underline-offset-2 hover:underline"
                    >
                      Mark as read
                    </button>
                  </form>
                ) : null}
                <ul className="mt-2 space-y-2">
                  {thread.messages.map((m, i) => (
                    <li
                      key={i}
                      className={`rounded-md px-3 py-2 text-sm leading-relaxed ${
                        m.from === "you"
                          ? "bg-emerald/10 text-ink"
                          : "border border-line/70 bg-ivory text-ink-soft"
                      }`}
                    >
                      <span className="mr-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                        {m.from === "you" ? "You" : "Advisor"}
                      </span>
                      {m.body}
                      <span className="ml-2 text-[11px] text-ink-faint">{fmtDateTime(m.sentAt)}</span>
                    </li>
                  ))}
                </ul>
                {thread.status === "closed" ? (
                  <p className="mt-2 text-[11px] text-ink-faint">
                    This conversation is closed. Your advisor will reopen it if there’s more to
                    discuss.
                  </p>
                ) : (
                  <form
                    action={sendClientMessageAction.bind(null, threadIndex)}
                    className="mt-3 space-y-2"
                  >
                    <label htmlFor={`reply-${threadIndex}`} className="sr-only">
                      Reply to {thread.subject}
                    </label>
                    <textarea
                      id={`reply-${threadIndex}`}
                      name="body"
                      required
                      maxLength={5000}
                      rows={2}
                      placeholder="Write a reply to your advisory team…"
                      className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-emerald px-3 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                    >
                      Send
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Progress reports">
        {view.publishedReports.length === 0 ? (
          <EmptyState message="Your first quarterly report will appear here once published." />
        ) : (
          <div className="space-y-5">
            {view.publishedReports.map((report) => (
              <div key={report.quarter}>
                <p className="text-sm font-medium text-ink">{report.quarter}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-soft marker:text-gold">
                  {report.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">Focus for next quarter:</span>{" "}
                  {report.focusForNextQuarter}
                </p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
