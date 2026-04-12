"use client";

import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, FolderOpen } from "lucide-react";
import type { ScheduledTask } from "@/lib/types";

export default function TasksPage() {
  const { data: tasks, isLoading } = usePolling<ScheduledTask[]>(
    "/api/tasks",
    10000
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Scheduled Tasks</h1>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Group tasks by project
  const grouped = new Map<string, ScheduledTask[]>();
  for (const task of tasks || []) {
    const project = task.project || "Global";
    if (!grouped.has(project)) grouped.set(project, []);
    grouped.get(project)!.push(task);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Scheduled Tasks</h1>
        <span className="text-sm text-muted-foreground">
          {tasks?.length || 0} tasks
        </span>
      </div>

      {!tasks || tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Clock className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">No scheduled tasks</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use CronCreate or the scheduled-tasks tool to create tasks
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([project, projectTasks]) => (
            <div key={project} className="space-y-3">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-sm font-medium text-muted-foreground">
                  {project}
                </h2>
                <Badge variant="secondary" className="text-xs">
                  {projectTasks.length}
                </Badge>
              </div>
              {projectTasks.map((task) => (
                <Card key={task.taskId}>
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {task.schedule && (
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded mr-2">
                            {task.schedule}
                          </code>
                        )}
                        {task.enabled ? (
                          <Badge variant="default" className="text-xs">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Disabled</Badge>
                        )}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 px-4 pb-3">
                    <p className="text-sm text-muted-foreground">
                      {task.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
