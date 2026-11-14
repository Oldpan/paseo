import type { Routine, RoutineCadence, RoutineRun } from "../shared/contracts";

export const MAX_ROUTINE_RUNS = 24;

interface CronFieldBounds {
  min: number;
  max: number;
  name: string;
}

interface CronFieldMatcher {
  isWildcard: boolean;
  matches(value: number): boolean;
}

interface ParsedCronExpression {
  minute: CronFieldMatcher;
  hour: CronFieldMatcher;
  dayOfMonth: CronFieldMatcher;
  month: CronFieldMatcher;
  dayOfWeek: CronFieldMatcher;
}

interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const CRON_FIELD_BOUNDS: CronFieldBounds[] = [
  { min: 0, max: 59, name: "minute" },
  { min: 0, max: 23, name: "hour" },
  { min: 1, max: 31, name: "day-of-month" },
  { min: 1, max: 12, name: "month" },
  { min: 0, max: 6, name: "day-of-week" },
];

function createRange(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function parseStepPart(part: string, bounds: CronFieldBounds): { base: string; step: number } {
  const stepParts = part.split("/");
  if (stepParts.length > 2) {
    throw new Error(`Invalid cron ${bounds.name} step`);
  }

  const [base, stepSource] = stepParts;
  const normalizedStep = stepSource?.trim();
  const step = normalizedStep === undefined ? 1 : Number.parseInt(normalizedStep, 10);
  if (
    !Number.isInteger(step) ||
    step <= 0 ||
    (normalizedStep !== undefined && String(step) !== normalizedStep)
  ) {
    throw new Error(`Invalid cron ${bounds.name} step`);
  }

  return { base: base ?? "", step };
}

function parseField(source: string, bounds: CronFieldBounds): CronFieldMatcher {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error(`Invalid cron ${bounds.name} field`);
  }

  const allowed = new Set<number>();
  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid cron ${bounds.name} field`);
    }
    if (/^\d+\//.test(part)) {
      throw new Error(`Invalid cron ${bounds.name} step: use * or a range before /`);
    }

    const { base, step } = parseStepPart(part, bounds);

    if (base === "*") {
      for (const value of createRange(bounds.min, bounds.max, step)) {
        allowed.add(value);
      }
      continue;
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1]!, 10);
      const end = Number.parseInt(rangeMatch[2]!, 10);
      if (start > end || start < bounds.min || end > bounds.max) {
        throw new Error(`Invalid cron ${bounds.name} range`);
      }
      for (const value of createRange(start, end, step)) {
        allowed.add(value);
      }
      continue;
    }

    if (!/^\d+$/.test(base)) {
      throw new Error(`Invalid cron ${bounds.name} value`);
    }
    const value = Number.parseInt(base, 10);
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      throw new Error(`Invalid cron ${bounds.name} value`);
    }
    allowed.add(value);
  }

  return {
    isWildcard: trimmed.startsWith("*"),
    matches(value: number): boolean {
      return allowed.has(value);
    },
  };
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expressions must have 5 fields");
  }

  return {
    minute: parseField(parts[0]!, CRON_FIELD_BOUNDS[0]!),
    hour: parseField(parts[1]!, CRON_FIELD_BOUNDS[1]!),
    dayOfMonth: parseField(parts[2]!, CRON_FIELD_BOUNDS[2]!),
    month: parseField(parts[3]!, CRON_FIELD_BOUNDS[3]!),
    dayOfWeek: parseField(parts[4]!, CRON_FIELD_BOUNDS[4]!),
  };
}

function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid cron time zone: ${timeZone}`);
  }
}

function startOfNextMinute(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes() + 1,
      0,
      0,
    ),
  );
}

function createCronDatePartsReader(timeZone: string | undefined): (date: Date) => CronDateParts {
  if (timeZone === undefined) {
    return (date: Date) => ({
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay(),
    });
  }

  assertValidTimeZone(timeZone);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (date: Date) => {
    const values: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== "literal") {
        values[part.type] = part.value;
      }
    }

    const year = Number.parseInt(values.year ?? "0", 10);
    const month = Number.parseInt(values.month ?? "1", 10);
    const dayOfMonth = Number.parseInt(values.day ?? "1", 10);

    return {
      minute: Number.parseInt(values.minute ?? "0", 10),
      hour: Number.parseInt(values.hour ?? "0", 10),
      dayOfMonth,
      month,
      dayOfWeek: new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay(),
    };
  };
}

export function validateRoutineCadence(cadence: RoutineCadence): void {
  if (cadence.type === "every") {
    if (!Number.isInteger(cadence.everyMs) || cadence.everyMs <= 0) {
      throw new Error("Routine interval must be a positive integer in milliseconds.");
    }
    return;
  }
  parseCronExpression(cadence.expression);
  if (cadence.timezone !== undefined) {
    assertValidTimeZone(cadence.timezone);
  }
}

export function computeNextRoutineRunAt(cadence: RoutineCadence, afterMs: number): number {
  if (cadence.type === "every") {
    return afterMs + cadence.everyMs;
  }

  const cron = parseCronExpression(cadence.expression);
  const hasWildcardDay = cron.dayOfMonth.isWildcard || cron.dayOfWeek.isWildcard;
  const readDateParts = createCronDatePartsReader(cadence.timezone);
  const limit = 366 * 24 * 60;
  let cursor = startOfNextMinute(new Date(afterMs));

  for (let index = 0; index < limit; index += 1) {
    const { minute, hour, dayOfMonth, month, dayOfWeek } = readDateParts(cursor);
    const dayOfMonthMatches = cron.dayOfMonth.matches(dayOfMonth);
    const dayOfWeekMatches = cron.dayOfWeek.matches(dayOfWeek);
    const bothDaysMatch = dayOfMonthMatches && dayOfWeekMatches;
    const eitherDayMatches = dayOfMonthMatches || dayOfWeekMatches;
    const dayMatches = hasWildcardDay ? bothDaysMatch : eitherDayMatches;

    if (
      cron.minute.matches(minute) &&
      cron.hour.matches(hour) &&
      cron.month.matches(month) &&
      dayMatches
    ) {
      return cursor.getTime();
    }

    cursor = new Date(cursor.getTime() + 60_000);
  }

  throw new Error(`Unable to compute next run time for cron expression: ${cadence.expression}`);
}

export function advanceNextRoutineRunAtPast(
  cadence: RoutineCadence,
  nextRunAtMs: number,
  nowMs: number,
): number {
  if (nextRunAtMs > nowMs) {
    return nextRunAtMs;
  }
  if (cadence.type === "every") {
    const steps = Math.floor((nowMs - nextRunAtMs) / cadence.everyMs) + 1;
    return nextRunAtMs + steps * cadence.everyMs;
  }
  return computeNextRoutineRunAt(cadence, nowMs);
}

export function countSettledRoutineRuns(routine: Pick<Routine, "runs">): number {
  return routine.runs.filter((run) => run.status !== "running" && run.outcome !== "skipped").length;
}

export function shouldCompleteRoutine(
  routine: Pick<Routine, "maxRuns" | "expiresAt" | "runs">,
  nowMs: number,
): boolean {
  if (routine.expiresAt !== null && routine.expiresAt <= nowMs) {
    return true;
  }
  if (routine.maxRuns === null) {
    return false;
  }
  return countSettledRoutineRuns(routine) >= routine.maxRuns;
}

export function firstLineSummary(text: string, maxLength = 160): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength - 1)}…`;
}

export function appendRoutineRun(runs: readonly RoutineRun[], run: RoutineRun): RoutineRun[] {
  const next = [...runs, run];
  return next.length > MAX_ROUTINE_RUNS ? next.slice(-MAX_ROUTINE_RUNS) : next;
}

export function updateRoutineRun(
  runs: readonly RoutineRun[],
  runId: string,
  updater: (run: RoutineRun) => RoutineRun,
): RoutineRun[] {
  return runs.map((run) => (run.id === runId ? updater(run) : run));
}
