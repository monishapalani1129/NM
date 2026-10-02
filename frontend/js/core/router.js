const routes = {
  dashboard: () => import("../modules/dashboard.js"),
  learn: () => import("../modules/learn.js"),
  notes: () => import("../modules/notes.js"),
  practice: () => import("../modules/practice.js"),
  exam: () => import("../modules/exam.js"),
  insights: () => import("../modules/insights.js"),
  planner: () => import("../modules/planner.js"),
  extras: () => import("../modules/extras.js"),
  profile: () => import("../modules/profile.js")
};

let renderSequence = 0;

export function currentRoute() {
  const route = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return routes[route] ? route : "dashboard";
}

export async function renderRoute() {
  const sequence = ++renderSequence;
  const route = currentRoute();
  const container = document.querySelector("#page-content");
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  container.innerHTML = `<div class="route-loading" aria-live="polite">Loading your workspace…</div>`;
  try {
    const module = await routes[route]();
    if (sequence !== renderSequence) return;
    container.replaceChildren();
    await module.render(container);
    if (sequence !== renderSequence) return;
    await module.init?.();
    document.querySelectorAll("[data-route]").forEach((link) => {
      const active = link.dataset.route === route;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    container.setAttribute("aria-busy", "false");
  } catch {
    if (sequence !== renderSequence) return;
    container.innerHTML = `<div class="empty-state"><span class="eyebrow">Workspace</span><h1>We couldn't open this page</h1><p>Try another section or return to your dashboard.</p><a class="button button--primary" href="#/dashboard">Open dashboard</a></div>`;
    container.setAttribute("aria-busy", "false");
  }
}

export function startRouter() {
  window.addEventListener("hashchange", renderRoute);
  if (!window.location.hash) window.location.hash = "#/dashboard";
  else renderRoute();
}

export function refreshRoute() {
  return renderRoute();
}