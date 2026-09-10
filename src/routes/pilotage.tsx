import { createFileRoute } from "@tanstack/react-router";
import { KanbanPage } from "@/components/kanban/KanbanDevisDialog";

export const Route = createFileRoute("/pilotage")({
  component: KanbanPage,
});
