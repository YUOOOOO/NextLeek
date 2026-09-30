import { createRouter, createWebHistory } from "vue-router";

import DashboardView from "../views/DashboardView.vue";
import StrategyView from "../views/StrategyView.vue";
import WorkspaceView from "../views/WorkspaceView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: DashboardView },
    { path: "/research", component: WorkspaceView, props: { mode: "research" } },
    { path: "/strategies", component: StrategyView },
    { path: "/live", component: WorkspaceView, props: { mode: "live" } },
  ],
});
