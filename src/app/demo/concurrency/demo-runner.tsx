"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { formatMinor } from "../../../domain/money";
import type {
  DemoReport,
  ScenarioReport,
  DemoEvent,
  DemoEventKind,
} from "../../../lib/concurrency-demo";

interface ConcurrencyDemoRunnerProps {
  action: () => Promise<DemoReport>;
}

export function ConcurrencyDemoRunner({ action }: ConcurrencyDemoRunnerProps) {
  const [report, setReport] = useState<DemoReport | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const result = await action();
      setReport(result);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={isPending}
          className="inline-flex min-h-touch items-center justify-center rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Running simulation…" : report ? "Run again" : "Run the race"}
        </button>
        <span className="text-sm text-neutral-500">
          Ada writes a $60 expense and Grace writes a $40 expense at the same
          instant, into the same group ledger.
        </span>
      </div>

      {report && (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <ScenarioCard scenario={report.naive} tone="danger" />
          <ScenarioCard scenario={report.occ} tone="success" />
        </div>
      )}
    </div>
  );
}

function ScenarioCard({
  scenario,
  tone,
}: {
  scenario: ScenarioReport;
  tone: "danger" | "success";
}) {
  const dataLossFree = scenario.lostWrites === 0;
  const accent = tone === "success" ? "border-success" : "border-danger";

  return (
    <section
      className={`rounded-xl border-2 ${accent} bg-white p-5 shadow-sm`}
      aria-label={scenario.label}
    >
      <header>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-neutral-900">
            {scenario.label}
          </h2>
          <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
            max {scenario.maxAttempts}
          </code>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          {scenario.description}
        </p>
      </header>

      {/* Outcome banner */}
      <div
        className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${
          dataLossFree
            ? "bg-success/10 text-success"
            : "bg-danger/10 text-danger"
        }`}
        role="status"
      >
        {dataLossFree
          ? "Both writes durable — no data lost"
          : `${scenario.lostWrites} write${scenario.lostWrites === 1 ? "" : "s"} dropped — data lost`}
      </div>

      {/* Recorded vs expected */}
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Total recorded"
          value={formatMinor(scenario.recordedTotalMinor, scenario.baseCurrency)}
          tone={
            scenario.recordedTotalMinor === scenario.expectedTotalMinor
              ? "success"
              : "danger"
          }
        />
        <Stat
          label="Expected total"
          value={formatMinor(scenario.expectedTotalMinor, scenario.baseCurrency)}
          tone="neutral"
        />
      </dl>

      {/* Net positions */}
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Derived balances
        </h3>
        <ul className="mt-2 space-y-1.5" role="list">
          {scenario.netPositions.map((p) => {
            const positive = p.netMinor > 0;
            const negative = p.netMinor < 0;
            return (
              <li
                key={p.name}
                className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm"
              >
                <span className="font-medium text-neutral-900">{p.name}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    positive
                      ? "text-creditor"
                      : negative
                        ? "text-debtor"
                        : "text-neutral-500"
                  }`}
                >
                  {positive ? "+" : negative ? "−" : ""}
                  {formatMinor(Math.abs(p.netMinor), scenario.baseCurrency)}
                </span>
              </li>
            );
          })}
        </ul>
        <p
          className={`mt-2 text-xs font-medium ${
            scenario.zeroSum ? "text-success" : "text-danger"
          }`}
        >
          {scenario.zeroSum
            ? "✓ Balances sum to zero (INV-2 holds)"
            : "✗ Balances do not sum to zero"}
        </p>
      </div>

      {/* Writer attempts */}
      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Writers
        </h3>
        <ul className="mt-2 space-y-1.5" role="list">
          {scenario.writers.map((w) => (
            <li
              key={w.name}
              className="flex items-center justify-between text-sm text-neutral-700"
            >
              <span className="font-medium">{w.name}</span>
              <span className="tabular-nums text-neutral-500">
                {w.attempts} attempt{w.attempts === 1 ? "" : "s"} ·{" "}
                {w.committed ? (
                  <span className="text-success">committed</span>
                ) : (
                  <span className="text-danger">dropped</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <EventTimeline events={scenario.events} />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "neutral";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>
        {value}
      </dd>
    </div>
  );
}

const KIND_STYLES: Record<DemoEventKind, { dot: string; text: string; tag: string }> = {
  read: { dot: "bg-neutral-400", text: "text-neutral-600", tag: "READ" },
  attempt: { dot: "bg-info", text: "text-neutral-700", tag: "TXN" },
  conflict: { dot: "bg-danger", text: "text-danger", tag: "40001" },
  backoff: { dot: "bg-warning", text: "text-neutral-600", tag: "RETRY" },
  commit: { dot: "bg-success", text: "text-success", tag: "COMMIT" },
  exhausted: { dot: "bg-danger", text: "text-danger", tag: "LOST" },
};

function EventTimeline({ events }: { events: DemoEvent[] }) {
  return (
    <details className="mt-5 group">
      <summary className="cursor-pointer select-none text-sm font-medium text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500 rounded">
        Transaction timeline ({events.length} events)
      </summary>
      <ol className="mt-3 space-y-1.5 font-mono text-xs" role="list">
        {events.map((e, i) => {
          const style = KIND_STYLES[e.kind];
          return (
            <li key={i} className="flex items-start gap-2">
              <span className="w-12 shrink-0 tabular-nums text-neutral-400">
                {e.tMs}ms
              </span>
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                aria-hidden="true"
              />
              <span className="w-14 shrink-0 font-semibold text-neutral-500">
                {style.tag}
              </span>
              <span className="w-12 shrink-0 font-semibold text-neutral-700">
                {e.writer}
              </span>
              <span className={style.text}>{e.detail}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
