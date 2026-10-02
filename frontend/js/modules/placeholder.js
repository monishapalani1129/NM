export function render(container) {
  const name = ({ learn: "Learn", notes: "Notes Studio", practice: "Practice", exam: "Exam Zone", insights: "Insights", planner: "Planner" })[window.location.hash.replace(/^#\/?/, "")] || "Learning space";
  container.innerHTML = `<section class="placeholder-page"><span class="eyebrow">${name.toUpperCase()}</span><div class="placeholder-mark" aria-hidden="true">✳</div><h1>${name}</h1><p>Coming in next phase</p><a class="button button--secondary" href="#/dashboard">Back to dashboard</a></section>`;
}

export function init() {}