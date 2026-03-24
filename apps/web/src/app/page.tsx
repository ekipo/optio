"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { TaskCard } from "@/components/task-card";
import Link from "next/link";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  Loader2,
  Activity,
  CheckCircle,
  AlertTriangle,
  GitPullRequest,
  Circle,
  Cpu,
  HardDrive,
  RefreshCw,
  Container,
  Database,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  DollarSign,
  BarChart3,
  Gauge,
  Clock,
  Zap,
  FolderGit2,
  ListTodo,
  ArrowRight,
  Rocket,
  GitBranch,
  Bot,
  GitMerge,
} from "lucide-react";
import { StateBadge } from "@/components/state-badge";

const STATUS_COLORS: Record<string, string> = {
  Running: "text-success",
  Ready: "text-success",
  ready: "text-success",
  Succeeded: "text-text-muted",
  Pending: "text-warning",
  provisioning: "text-warning",
  ImagePullBackOff: "text-error",
  ErrImagePull: "text-error",
  CrashLoopBackOff: "text-error",
  Error: "text-error",
  error: "text-error",
  Failed: "text-error",
  failed: "text-error",
  NotReady: "text-error",
  Unknown: "text-text-muted",
};

function formatK8sResource(value: string | undefined): string {
  if (!value) return "—";
  const kiMatch = value.match(/^(\d+)Ki$/);
  if (kiMatch) {
    const ki = parseInt(kiMatch[1], 10);
    if (ki >= 1048576) return `${(ki / 1048576).toFixed(1)} Gi`;
    if (ki >= 1024) return `${(ki / 1024).toFixed(0)} Mi`;
    return `${ki} Ki`;
  }
  const miMatch = value.match(/^(\d+)Mi$/);
  if (miMatch) {
    const mi = parseInt(miMatch[1], 10);
    if (mi >= 1024) return `${(mi / 1024).toFixed(1)} Gi`;
    return `${mi} Mi`;
  }
  const giMatch = value.match(/^(\d+)Gi$/);
  if (giMatch) return `${giMatch[1]} Gi`;
  const bytes = parseInt(value, 10);
  if (!isNaN(bytes)) {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} Gi`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} Mi`;
  }
  return value;
}

interface TaskStats {
  total: number;
  running: number;
  needsAttention: number;
  prOpened: number;
  completed: number;
  failed: number;
}

export default function OverviewPage() {
  const [taskStats, setTaskStats] = useState<TaskStats | null>(null);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [dismissedEvents, setDismissedEvents] = useState<Set<number>>(new Set());
  const [expandedPods, setExpandedPods] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<{
    available: boolean;
    fiveHour?: { utilization: number | null; resetsAt: string | null };
    sevenDay?: { utilization: number | null; resetsAt: string | null };
    sevenDaySonnet?: { utilization: number | null; resetsAt: string | null };
    sevenDayOpus?: { utilization: number | null; resetsAt: string | null };
  } | null>(null);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metricsHistory, setMetricsHistory] = useState<
    { time: number; cpuPercent: number; memoryPercent: number; pods: number; agents: number }[]
  >([]);
  const MAX_HISTORY = 60; // 10 minutes at 10s intervals

  const refresh = () => {
    Promise.all([api.listTasks({ limit: 100 }), api.getClusterOverview().catch(() => null)])
      .then(([tasksRes, clusterRes]) => {
        const tasks = tasksRes.tasks;
        setTaskStats({
          total: tasks.length,
          running: tasks.filter((t: any) => t.state === "running").length,
          needsAttention: tasks.filter((t: any) => t.state === "needs_attention").length,
          prOpened: tasks.filter((t: any) => t.state === "pr_opened").length,
          completed: tasks.filter((t: any) => t.state === "completed").length,
          failed: tasks.filter((t: any) => t.state === "failed").length,
        });
        setRecentTasks(tasks.slice(0, 5));
        if (clusterRes) {
          setCluster(clusterRes);
          const node = clusterRes.nodes?.[0];
          if (node) {
            const memPercent =
              node.memoryUsedGi && node.memoryTotalGi
                ? Math.round((parseFloat(node.memoryUsedGi) / parseFloat(node.memoryTotalGi)) * 100)
                : 0;
            setMetricsHistory((prev) => {
              const next = [
                ...prev,
                {
                  time: Date.now(),
                  cpuPercent: node.cpuPercent ?? 0,
                  memoryPercent: memPercent,
                  pods: clusterRes.summary?.totalPods ?? 0,
                  agents: clusterRes.summary?.agentPods ?? 0,
                },
              ];
              return next.slice(-MAX_HISTORY);
            });
          }
        }
      })
      .finally(() => setLoading(false));
  };

  const refreshUsage = () => {
    api
      .getUsage()
      .then((res) => setUsage(res.usage))
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    refreshUsage();
    const interval = setInterval(refresh, 10000);
    // Usage endpoint is rate-limited — poll every 5 minutes
    const usageInterval = setInterval(refreshUsage, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
      clearInterval(usageInterval);
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="h-8 w-32 rounded-lg bg-bg-card animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-bg-card animate-pulse" />
          ))}
        </div>
        <div className="h-16 rounded-xl bg-bg-card animate-pulse" />
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-bg-card animate-pulse" />
            ))}
          </div>
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-bg-card animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isFirstRun = taskStats?.total === 0;

  const totalCost = recentTasks.reduce((sum: number, t: any) => {
    return sum + (t.costUsd ? parseFloat(t.costUsd) : 0);
  }, 0);

  const { nodes, pods, events, summary } = cluster ?? {
    nodes: [],
    pods: [],
    events: [],
    summary: {
      totalPods: 0,
      runningPods: 0,
      agentPods: 0,
      infraPods: 0,
      totalNodes: 0,
      readyNodes: 0,
    },
  };

  if (isFirstRun) {
    return <WelcomeHero cluster={cluster} summary={summary} nodes={nodes} />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {taskStats?.running
              ? `${taskStats.running} task${taskStats.running !== 1 ? "s" : ""} running`
              : "All quiet"}
            {taskStats?.needsAttention
              ? ` · ${taskStats.needsAttention} need${taskStats.needsAttention !== 1 ? "" : "s"} attention`
              : ""}
          </p>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-muted transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="Running"
          value={taskStats?.running ?? 0}
          color="text-primary"
          href="/tasks"
        />
        <StatCard
          icon={AlertTriangle}
          label="Attention"
          value={taskStats?.needsAttention ?? 0}
          color="text-warning"
          href="/tasks"
        />
        <StatCard
          icon={GitPullRequest}
          label="PRs Open"
          value={taskStats?.prOpened ?? 0}
          color="text-success"
          href="/tasks"
        />
        <StatCard
          icon={CheckCircle}
          label="Completed"
          value={taskStats?.completed ?? 0}
          color="text-success"
          href="/tasks"
        />
      </div>

      {/* Claude Max usage */}
      {usage?.available && (
        <div className="rounded-xl border border-border/50 bg-bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-xs font-medium text-text-heading">Claude Max Usage</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {usage.fiveHour && usage.fiveHour.utilization != null && (
              <UsageMeter
                label="5-hour"
                utilization={usage.fiveHour.utilization}
                resetsAt={usage.fiveHour.resetsAt}
              />
            )}
            {usage.sevenDay && usage.sevenDay.utilization != null && (
              <UsageMeter
                label="7-day"
                utilization={usage.sevenDay.utilization}
                resetsAt={usage.sevenDay.resetsAt}
              />
            )}
            {usage.sevenDaySonnet && usage.sevenDaySonnet.utilization != null && (
              <UsageMeter
                label="7d Sonnet"
                utilization={usage.sevenDaySonnet.utilization}
                resetsAt={usage.sevenDaySonnet.resetsAt}
              />
            )}
            {usage.sevenDayOpus && usage.sevenDayOpus.utilization != null && (
              <UsageMeter
                label="7d Opus"
                utilization={usage.sevenDayOpus.utilization}
                resetsAt={usage.sevenDayOpus.resetsAt}
              />
            )}
          </div>
        </div>
      )}

      {/* Cluster health bar */}
      <div className="rounded-xl border border-border/50 bg-bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4 text-xs">
            {nodes[0] && (
              <span className="flex items-center gap-1.5 text-text-muted font-mono border-r border-border pr-4 mr-1">
                {nodes[0].name} <span className="text-text-muted/50">/ optio</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Circle
                className={cn(
                  "w-2 h-2 fill-current",
                  summary.readyNodes > 0 ? "text-success" : "text-error",
                )}
              />
              <span className="text-text-muted">Nodes</span>
              <span className="font-medium">
                {summary.readyNodes}/{summary.totalNodes}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Container className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Pods</span>
              <span className="font-medium">
                {summary.runningPods}/{summary.totalPods}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Agents</span>
              <span className="font-medium">{summary.agentPods}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-text-muted" />
              <span className="text-text-muted">Infra</span>
              <span className="font-medium">{summary.infraPods}</span>
            </span>
          </div>
          {nodes[0] && (
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {nodes[0].cpuPercent != null ? (
                  <>
                    <span className="font-medium text-text">{nodes[0].cpuPercent}%</span> of{" "}
                    {nodes[0].cpu} cores
                  </>
                ) : (
                  <>{nodes[0].cpu} cores</>
                )}
              </span>
              <span className="flex items-center gap-1">
                <HardDrive className="w-3 h-3" />
                {nodes[0].memoryUsedGi != null ? (
                  <>
                    <span className="font-medium text-text">{nodes[0].memoryUsedGi}</span> /{" "}
                    {nodes[0].memoryTotalGi} Gi
                  </>
                ) : (
                  <>{formatK8sResource(nodes[0].memory)}</>
                )}
              </span>
              {totalCost > 0 && (
                <span className="flex items-center gap-1 border-l border-border pl-3 ml-1">
                  <DollarSign className="w-3 h-3" />
                  <span className="font-medium text-text">${totalCost.toFixed(2)}</span>
                  <span className="text-text-muted">total</span>
                </span>
              )}
              <button
                onClick={() => setShowMetrics(!showMetrics)}
                className="flex items-center gap-1 ml-2 pl-3 border-l border-border text-text-muted hover:text-text transition-colors"
              >
                <BarChart3 className="w-3 h-3" />
                {showMetrics ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Expandable metrics charts */}
        {showMetrics && (
          <div className="border-t border-border/30 px-4 py-4">
            {metricsHistory.length > 1 ? (
              <>
                <div className="grid grid-cols-3 gap-6">
                  <MiniChart
                    label="CPU"
                    data={metricsHistory.map((m) => m.cpuPercent)}
                    suffix="%"
                    color="var(--color-primary)"
                    max={100}
                  />
                  <MiniChart
                    label="Memory"
                    data={metricsHistory.map((m) => m.memoryPercent)}
                    suffix="%"
                    color="var(--color-info)"
                    max={100}
                  />
                  <MiniChart
                    label="Pods"
                    data={metricsHistory.map((m) => m.pods)}
                    suffix=""
                    color="var(--color-success)"
                  />
                </div>
                <div className="text-[10px] text-text-muted/40 mt-2 text-right">
                  {metricsHistory.length} samples · refreshing every 10s
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted/50 text-center py-3">
                Collecting metrics data... graphs will appear in a few seconds.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two-column: Recent tasks + Pods */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Recent tasks */}
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-heading">Recent Tasks</h2>
            <div className="flex items-center gap-2">
              <Link
                href="/tasks/new"
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> New
              </Link>
              <Link href="/tasks" className="text-xs text-primary hover:underline">
                All →
              </Link>
            </div>
          </div>
          {recentTasks.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="No tasks yet"
              description="Create your first task to get an AI agent working on your code."
              action={{ label: "Create a task", href: "/tasks/new" }}
            />
          ) : (
            <div className="grid gap-2">
              {recentTasks.map((task: any) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>

        {/* Pods */}
        <div className="min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-text-heading">Pods</h2>
            <Link href="/cluster" className="text-xs text-primary hover:underline">
              Cluster →
            </Link>
          </div>
          {pods.length === 0 ? (
            <EmptyState
              icon={Container}
              title="No pods running"
              description="Pods spin up automatically when you create a task."
            />
          ) : (
            <div className="space-y-1.5">
              {pods.map((pod: any) => {
                const color = STATUS_COLORS[pod.status] ?? "text-text-muted";
                const isExpanded = expandedPods.has(pod.name);
                const podTasks = pod.isOptioManaged
                  ? recentTasks.filter((t: any) => t.containerId === pod.name)
                  : [];

                return (
                  <div key={pod.name} className="rounded-md border border-border bg-bg-card">
                    <button
                      onClick={() => {
                        if (!pod.isOptioManaged) return;
                        setExpandedPods((prev) => {
                          const next = new Set(prev);
                          if (next.has(pod.name)) next.delete(pod.name);
                          else next.add(pod.name);
                          return next;
                        });
                      }}
                      className={cn(
                        "w-full text-left p-2.5",
                        pod.isOptioManaged && "cursor-pointer hover:bg-bg-hover",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Circle className={cn("w-2 h-2 fill-current shrink-0", color)} />
                        <span className="font-mono text-xs font-medium truncate">{pod.name}</span>
                        {pod.isOptioManaged && (
                          <>
                            <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                              workspace
                            </span>
                            <ChevronDown
                              className={cn(
                                "w-3 h-3 text-text-muted ml-auto shrink-0 transition-transform",
                                isExpanded && "rotate-180",
                              )}
                            />
                          </>
                        )}
                        {pod.isInfra && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-info/10 text-info">
                            infra
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-text-muted mt-1 ml-4">
                        <span className={color}>{pod.status}</span>
                        {pod.cpuMillicores != null && (
                          <span className="flex items-center gap-0.5">
                            <Cpu className="w-2.5 h-2.5" />
                            {pod.cpuMillicores}m
                          </span>
                        )}
                        {pod.memoryMi != null && (
                          <span className="flex items-center gap-0.5">
                            <HardDrive className="w-2.5 h-2.5" />
                            {pod.memoryMi} Mi
                          </span>
                        )}
                        {pod.restarts > 0 && (
                          <span className="text-warning">{pod.restarts} restarts</span>
                        )}
                        <span className="font-mono">{pod.image?.split("/").pop()}</span>
                        {pod.startedAt && <span>{formatRelativeTime(pod.startedAt)}</span>}
                      </div>
                    </button>

                    {/* Expanded: show tasks */}
                    {isExpanded && (
                      <div className="border-t border-border px-2.5 py-2 space-y-1">
                        {podTasks.length > 0 ? (
                          podTasks.map((t: any) => (
                            <Link
                              key={t.id}
                              href={`/tasks/${t.id}`}
                              className="flex items-center justify-between p-1.5 rounded hover:bg-bg-hover text-xs"
                            >
                              <span className="truncate">{t.title}</span>
                              <StateBadge state={t.state} />
                            </Link>
                          ))
                        ) : (
                          <div className="text-[10px] text-text-muted py-1">No recent tasks</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent events */}
          {events.filter((_: any, i: number) => !dismissedEvents.has(i)).length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-text-muted">Recent Events</h3>
                {dismissedEvents.size < events.length && (
                  <button
                    onClick={() =>
                      setDismissedEvents(new Set(events.map((_: any, i: number) => i)))
                    }
                    className="text-[10px] text-text-muted hover:text-text"
                  >
                    Dismiss all
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {events.slice(0, 8).map((event: any, i: number) => {
                  if (dismissedEvents.has(i)) return null;
                  return (
                    <div key={i} className="p-2.5 rounded-md border border-border bg-bg-card group">
                      <div className="flex items-center gap-2">
                        <AlertTriangle
                          className={cn(
                            "w-3 h-3 shrink-0",
                            event.type === "Warning" ? "text-warning" : "text-info",
                          )}
                        />
                        <span className="text-xs font-medium">{event.reason}</span>
                        <span className="text-[10px] text-text-muted font-mono">
                          {event.involvedObject}
                        </span>
                        {event.count > 1 && (
                          <span className="text-[10px] text-text-muted">x{event.count}</span>
                        )}
                        <span className="flex-1" />
                        {event.lastTimestamp && (
                          <span className="text-[10px] text-text-muted/50">
                            {formatRelativeTime(event.lastTimestamp)}
                          </span>
                        )}
                        <button
                          onClick={() => setDismissedEvents((prev) => new Set([...prev, i]))}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-hover text-text-muted transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-text-muted mt-1 ml-5 truncate">
                        {event.message}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Welcome Hero (first-run state) ────────────────────────────────────── */

function WelcomeHero({ cluster, summary, nodes }: { cluster: any; summary: any; nodes: any[] }) {
  const clusterReady = summary.readyNodes > 0;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Hero */}
      <div className="text-center pt-8 pb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-6">
          <Zap className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Welcome to Optio</h1>
        <p className="text-lg text-text-muted max-w-xl mx-auto leading-relaxed">
          AI-powered workflow orchestration for your codebase. Submit a task, and Optio spins up an
          agent that writes code, opens a PR, and handles review — all on autopilot.
        </p>
      </div>

      {/* Pipeline visualization */}
      <div className="rounded-xl border border-border/50 bg-bg-card p-6 mb-8">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-5 text-center">
          How it works
        </h2>
        <div className="flex items-center justify-center gap-3 md:gap-4 flex-wrap">
          <PipelineStep icon={ListTodo} label="Submit Task" sublabel="Issue or manual" />
          <PipelineArrow />
          <PipelineStep icon={Bot} label="Agent Runs" sublabel="Isolated K8s pod" active />
          <PipelineArrow />
          <PipelineStep icon={GitBranch} label="Opens PR" sublabel="With code changes" />
          <PipelineArrow />
          <PipelineStep icon={GitMerge} label="Merged" sublabel="Auto on approval" />
        </div>
      </div>

      {/* Getting started cards */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <OnboardingCard
          step={1}
          icon={FolderGit2}
          title="Add a repository"
          description="Connect a GitHub repo so Optio knows where to work."
          href="/repos"
          actionLabel="Add repo"
        />
        <OnboardingCard
          step={2}
          icon={Rocket}
          title="Create your first task"
          description="Describe what you want built or fixed — Optio handles the rest."
          href="/tasks/new"
          actionLabel="New task"
        />
        <OnboardingCard
          step={3}
          icon={Activity}
          title="Watch it run"
          description="Stream logs in real time as the agent writes code and opens a PR."
          href="/tasks"
          actionLabel="View tasks"
        />
      </div>

      {/* Cluster status hint */}
      <div className="rounded-xl border border-border/50 bg-bg-subtle p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Circle
            className={cn(
              "w-2.5 h-2.5 fill-current shrink-0",
              clusterReady ? "text-success" : "text-warning",
            )}
          />
          <div>
            <span className="text-sm font-medium">
              {clusterReady ? "Cluster is ready" : "Cluster connecting..."}
            </span>
            <span className="text-xs text-text-muted ml-2">
              {summary.readyNodes}/{summary.totalNodes} nodes
              {summary.totalPods > 0 && ` · ${summary.totalPods} pods`}
            </span>
          </div>
        </div>
        <Link
          href="/cluster"
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          Details <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function PipelineStep({
  icon: Icon,
  label,
  sublabel,
  active,
}: {
  icon: any;
  label: string;
  sublabel: string;
  active?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-[80px]">
      <div
        className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center border transition-colors",
          active
            ? "bg-primary/15 border-primary/30 text-primary"
            : "bg-bg-hover border-border/50 text-text-muted",
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-center">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-text-muted">{sublabel}</div>
      </div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="hidden md:flex items-center text-border-strong pt-[-10px]">
      <div className="w-6 h-px bg-border-strong" />
      <ArrowRight className="w-3 h-3 -ml-0.5" />
    </div>
  );
}

function OnboardingCard({
  step,
  icon: Icon,
  title,
  description,
  href,
  actionLabel,
}: {
  step: number;
  icon: any;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border/50 bg-bg-card hover:bg-bg-card-hover hover:border-border-strong p-5 transition-all"
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-bold text-text-muted/40 tabular-nums">
          {String(step).padStart(2, "0")}
        </span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <h3 className="text-sm font-semibold mb-1 group-hover:text-primary transition-colors">
        {title}
      </h3>
      <p className="text-xs text-text-muted leading-relaxed mb-3">{description}</p>
      <span className="text-xs text-primary flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
        {actionLabel} <ArrowRight className="w-3 h-3" />
      </span>
    </Link>
  );
}

/* ─── Reusable empty state ──────────────────────────────────────────────── */

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: any;
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 rounded-xl border border-dashed border-border bg-bg-subtle/50">
      <div className="w-10 h-10 rounded-lg bg-bg-hover flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-text-muted" />
      </div>
      <p className="text-sm font-medium text-text-muted mb-1">{title}</p>
      <p className="text-xs text-text-muted/70 text-center max-w-xs mb-3">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-hover transition-colors"
        >
          {action.label} <ArrowRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  );
}

/* ─── Dashboard sub-components ──────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  href,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  href?: string;
}) {
  const inner = (
    <div
      className={cn(
        "p-4 rounded-xl border border-border/50 bg-bg-card relative overflow-hidden transition-colors",
        href && "hover:bg-bg-card-hover hover:border-border-strong cursor-pointer",
      )}
    >
      <Icon className={cn("w-8 h-8 absolute top-3 right-3 opacity-[0.12]", color)} />
      <span className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</span>
      <div className="mt-1.5">
        <span className="text-3xl font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{inner}</Link>;
  }
  return inner;
}

function UsageMeter({
  label,
  utilization,
  resetsAt,
}: {
  label: string;
  utilization: number;
  resetsAt: string | null;
}) {
  const pct = Math.min(utilization, 100);
  const color = pct >= 80 ? "bg-error" : pct >= 50 ? "bg-warning" : "bg-primary";
  const textColor = pct >= 80 ? "text-error" : pct >= 50 ? "text-warning" : "text-primary";

  let resetLabel: string | null = null;
  if (resetsAt) {
    const diff = new Date(resetsAt).getTime() - Date.now();
    if (diff > 0) {
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      resetLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-text-muted">{label}</span>
        <span className={cn("text-[11px] font-medium tabular-nums", textColor)}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-border/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {resetLabel && (
        <div className="flex items-center gap-1 mt-1">
          <Clock className="w-2.5 h-2.5 text-text-muted/50" />
          <span className="text-[10px] text-text-muted/50">resets in {resetLabel}</span>
        </div>
      )}
    </div>
  );
}

function MiniChart({
  label,
  data,
  suffix,
  color,
  max: fixedMax,
}: {
  label: string;
  data: number[];
  suffix: string;
  color: string;
  max?: number;
}) {
  if (data.length < 2) return null;
  const current = data[data.length - 1];
  const max = fixedMax ?? Math.max(...data, 1);
  const min = fixedMax != null ? 0 : Math.min(...data);
  const range = max - min || 1;

  const w = 240;
  const h = 48;
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-text-muted">{label}</span>
        <span className="text-[11px] font-medium tabular-nums">
          {current}
          {suffix}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#grad-${label})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {/* Current value dot */}
        <circle
          cx={points[points.length - 1].x}
          cy={points[points.length - 1].y}
          r="2.5"
          fill={color}
        />
      </svg>
    </div>
  );
}
