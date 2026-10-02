import { get, set } from "../core/storage.js";
import { ask, askJSON } from "../core/gemini.js";
import { aiFooter, copyToClipboard, modal, renderMarkdown, skeleton, toast } from "../core/ui.js";

const maxChunkWords = 1000;
const maxChunkChars = 10000;
const summarySchema = {
	type: "OBJECT",
	properties: {
		shortSummary: { type: "STRING" },
		keyPoints: { type: "ARRAY", items: { type: "STRING" } },
		definitions: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { type: "STRING" }, definition: { type: "STRING" } }, required: ["term", "definition"] } },
		formulas: { type: "ARRAY", items: { type: "STRING" } },
		examPoints: { type: "ARRAY", items: { type: "STRING" } },
		possibleQuestions: { type: "ARRAY", items: { type: "STRING" } }
	},
	required: ["shortSummary", "keyPoints", "definitions", "formulas", "examPoints", "possibleQuestions"]
};
let currentNoteId = null;
let currentFlashcards = [];
let currentCardIndex = 0;
let flashcardStudyMode = false;
let flashcardIsFlipped = false;

function makeId() {
	return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHTML(value) {
	const element = document.createElement("span");
	element.textContent = String(value ?? "");
	return element.innerHTML;
}

function currentSource() {
	return document.querySelector("#notes-source").value.trim();
}

function sourceTitle() {
	const input = document.querySelector("#notes-title");
	return input.value.trim() || currentSource().split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").slice(0, 70) || "Untitled notes";
}

function updateSourceMeta() {
	const source = currentSource();
	const words = source ? source.split(/\s+/).filter(Boolean).length : 0;
	document.querySelector("#notes-word-count").textContent = `${words.toLocaleString()} words`;
	document.querySelector("#notes-length-hint").textContent = words > 8000
		? "Long notes will be summarized progressively in chunks."
		: words > 1000 ? "Long material is split into manageable summary sections." : "Around 8,000 words supported; longer material is processed in chunks.";
	return words;
}

function textChunks(source) {
	const words = source.split(/\s+/).filter(Boolean);
	const chunks = [];
	let current = [];
	let currentChars = 0;
	for (const word of words) {
		if (current.length && (current.length >= maxChunkWords || currentChars + word.length + 1 > maxChunkChars)) {
			chunks.push(current.join(" "));
			current = [];
			currentChars = 0;
		}
		current.push(word);
		currentChars += word.length + 1;
	}
	if (current.length) chunks.push(current.join(" "));
	return chunks;
}

function isSummary(value) {
	return typeof value?.shortSummary === "string"
		&& ["keyPoints", "definitions", "formulas", "examPoints", "possibleQuestions"].every((key) => Array.isArray(value[key]))
		&& value.definitions.every((item) => typeof item.term === "string" && typeof item.definition === "string")
		&& value.possibleQuestions.length >= 5;
}

function makeSummaryText(summary) {
	return [
		`## Short summary\n${summary.shortSummary}`,
		`## Key points\n${summary.keyPoints.map((item) => `- ${item}`).join("\n")}`,
		`## Important definitions\n${summary.definitions.length ? summary.definitions.map((item) => `- **${item.term}:** ${item.definition}`).join("\n") : "No definitions identified."}`,
		`## Formulas\n${summary.formulas.length ? summary.formulas.map((item) => `- ${item}`).join("\n") : "No formulas identified."}`,
		`## Exam revision points\n${summary.examPoints.map((item) => `- ${item}`).join("\n")}`,
		`## Possible questions\n${summary.possibleQuestions.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n")}`
	].join("\n\n");
}

function renderSummary(host, summary) {
	host.replaceChildren();
	const title = document.createElement("h2");
	title.className = "notes-summary-title";
	title.textContent = sourceTitle();
	host.append(title);
	const sections = [
		["Short summary", summary.shortSummary],
		["Key points", summary.keyPoints.length ? summary.keyPoints.map((item) => `- ${item}`).join("\n") : "No key points identified."],
		["Important definitions", summary.definitions.length ? summary.definitions.map((item) => `- **${item.term}:** ${item.definition}`).join("\n") : "No definitions identified."],
		["Formulas", summary.formulas.length ? summary.formulas.map((item) => `- ${item}`).join("\n") : "No formulas identified."],
		["Exam revision points", summary.examPoints.length ? summary.examPoints.map((item) => `- ${item}`).join("\n") : "No exam points identified."],
		["5 possible questions", summary.possibleQuestions.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join("\n")]
	];
	sections.forEach(([headingText, content]) => {
		const section = document.createElement("section");
		section.className = "notes-summary-section";
		const heading = document.createElement("h3");
		heading.textContent = headingText;
		section.append(heading, renderMarkdown(content));
		host.append(section);
	});
	host.append(aiFooter());
	host.hidden = false;
}

function persistCurrentNote(flashcards = currentFlashcards) {
	const source = currentSource();
	if (!source) {
		toast("Add some notes before saving.", "error");
		return null;
	}
	const notes = get("notes");
	const existing = notes.find((note) => note.id === currentNoteId);
	const note = {
		id: existing?.id || currentNoteId || makeId(),
		title: sourceTitle(),
		content: source,
		createdAt: existing?.createdAt || new Date().toISOString(),
		flashcards: flashcards || existing?.flashcards || []
	};
	currentNoteId = note.id;
	set("notes", [note, ...notes.filter((item) => item.id !== note.id)]);
	return note;
}

function wordCount(text) {
	return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function validateNotesAnswer(answer, source) {
	if (typeof answer?.fromNotes?.answer !== "string" || typeof answer.fromNotes.excerpt !== "string" || typeof answer?.generalKnowledge !== "string") return false;
	const excerpt = answer.fromNotes.excerpt.trim();
	if (wordCount(excerpt) > 20) return false;
	if (excerpt) {
		const normalize = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();
		return normalize(source).includes(normalize(excerpt));
	}
	return /not found|not in your notes|could not verify|couldn't verify/i.test(answer.fromNotes.answer);
}

function renderNotesAnswer(host, answer) {
	host.replaceChildren();
	const grounded = document.createElement("section");
	grounded.className = "notes-answer-part notes-answer-part--grounded";
	const groundedTitle = document.createElement("h3");
	groundedTitle.textContent = "📄 From your notes";
	grounded.append(groundedTitle, renderMarkdown(answer.fromNotes.answer));
	if (answer.fromNotes.excerpt) {
		const quote = document.createElement("blockquote");
		quote.textContent = `“${answer.fromNotes.excerpt}”`;
		const caption = document.createElement("span");
		caption.className = "notes-excerpt-caption";
		caption.textContent = "Supporting excerpt from your notes";
		grounded.append(quote, caption);
	}
	host.append(grounded);
	if (answer.generalKnowledge.trim()) {
		const general = document.createElement("section");
		general.className = "notes-answer-part notes-answer-part--general";
		const generalTitle = document.createElement("h3");
		generalTitle.textContent = "🌐 General knowledge";
		general.append(generalTitle, renderMarkdown(answer.generalKnowledge));
		host.append(general);
	}
	host.append(aiFooter());
	host.hidden = false;
}

function relevantNotes(source, question) {
	if (source.length <= 16000) return source;
	const terms = question.toLowerCase().split(/[^a-z0-9\u0B80-\u0BFF]+/i).filter((term) => term.length > 2);
	const paragraphs = source.split(/\n{2,}/).filter(Boolean);
	const ranked = paragraphs.map((text, index) => ({ text, index, score: terms.reduce((score, term) => score + (text.toLowerCase().includes(term) ? 1 : 0), 0) }))
		.sort((a, b) => b.score - a.score || a.index - b.index);
	const selected = [];
	let length = 0;
	for (const paragraph of ranked) {
		if (length + paragraph.text.length > 13000) continue;
		selected.push(paragraph);
		length += paragraph.text.length;
		if (length > 9500) break;
	}
	return selected.sort((a, b) => a.index - b.index).map((item) => item.text).join("\n\n") || source.slice(0, 13000);
}

function appendResultSection(host, titleText, content) {
	host.replaceChildren();
	const heading = document.createElement("h3");
	heading.textContent = titleText;
	host.append(heading, renderMarkdown(content), aiFooter());
	host.hidden = false;
}

function renderLibrary(host) {
	host.replaceChildren();
	const notes = get("notes");
	const count = document.querySelector("#notes-library-count");
	if (count) count.textContent = String(notes.length);
	if (!notes.length) {
		const empty = document.createElement("div");
		empty.className = "notes-library-empty";
		empty.innerHTML = "<span aria-hidden=\"true\">▤</span><h3>Your library is ready for its first note.</h3><p>Paste or upload class material, then save it to keep it close.</p><button class=\"button button--primary\" type=\"button\" data-library-action=\"new\">Add notes</button>";
		host.append(empty);
		return;
	}
	notes.forEach((note) => {
		const item = document.createElement("article");
		item.className = "notes-library-item";
		const content = document.createElement("div");
		content.className = "notes-library-copy";
		const title = document.createElement("h3");
		title.textContent = note.title || "Untitled notes";
		const preview = document.createElement("p");
		preview.textContent = String(note.content || "").slice(0, 180);
		const meta = document.createElement("span");
		meta.className = "notes-library-meta";
		meta.textContent = `${new Date(note.createdAt).toLocaleDateString()} · ${(note.flashcards || []).length} flashcards`;
		content.append(title, preview, meta);
		const actions = document.createElement("div");
		actions.className = "notes-library-actions";
		[["open", "Open"], ["rename", "Rename"], ["delete", "Delete"]].forEach(([action, label]) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = action === "delete" ? "quiet-button quiet-button--danger" : "quiet-button";
			button.dataset.libraryAction = action;
			button.dataset.noteId = note.id;
			button.textContent = label;
			actions.append(button);
		});
		item.append(content, actions);
		host.append(item);
	});
}

function makeRenameDialog(note, onSaved) {
	const form = document.createElement("form");
	form.className = "rename-note-form";
	form.innerHTML = "<label class=\"field\"><span>Note title</span><input name=\"title\" maxlength=\"100\" required></label><button class=\"button button--primary\" type=\"submit\">Save title</button>";
	form.elements.title.value = note.title || "Untitled notes";
	const dialog = modal({ title: "Rename note", content: form });
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const notes = get("notes");
		set("notes", notes.map((item) => item.id === note.id ? { ...item, title: form.elements.title.value.trim() } : item));
		dialog.close();
		onSaved();
		toast("Note title updated.", "success");
	});
}

function saveFlashcards(cards) {
	currentFlashcards = cards;
	const note = persistCurrentNote(cards);
	if (note) toast("Flashcards saved with this note.", "success");
}

function renderFlashcards(host) {
	host.replaceChildren();
	if (!currentFlashcards.length) {
		const empty = document.createElement("div");
		empty.className = "notes-library-empty flashcards-empty";
		empty.innerHTML = "<span aria-hidden=\"true\">✳</span><h3>Turn key ideas into active recall.</h3><p>Generate a small deck from the notes above, then review it here.</p>";
		host.append(empty);
		return;
	}
	const toolbar = document.createElement("div");
	toolbar.className = "flashcard-toolbar";
	const status = document.createElement("span");
	status.className = "eyebrow";
	status.textContent = flashcardStudyMode ? `STUDY MODE · CARD ${currentCardIndex + 1} OF ${currentFlashcards.length}` : `${currentFlashcards.length} CARDS · CURRENT BOX ${currentFlashcards[currentCardIndex]?.box || 1}`;
	const modeButton = document.createElement("button");
	modeButton.type = "button";
	modeButton.className = "button button--secondary";
	modeButton.id = "toggle-flashcard-study";
	modeButton.textContent = flashcardStudyMode ? "Exit study mode" : "Study flashcards";
	toolbar.append(status, modeButton);

	const card = currentFlashcards[currentCardIndex];
	const stage = document.createElement("div");
	stage.className = `flashcard-stage${flashcardIsFlipped ? " is-flipped" : ""}`;
	const face = document.createElement("button");
	face.type = "button";
	face.id = "flashcard-face";
	face.className = "flashcard-face";
	face.setAttribute("aria-label", flashcardIsFlipped ? "Flashcard answer. Activate to see the question." : "Flashcard question. Activate to reveal the answer.");
	face.setAttribute("aria-pressed", String(flashcardIsFlipped));
	const inner = document.createElement("span");
	inner.className = "flashcard-inner";
	const front = document.createElement("span");
	front.className = "flashcard-side flashcard-front";
	const frontLabel = document.createElement("small");
	frontLabel.textContent = "FRONT · QUESTION";
	const frontText = document.createElement("strong");
	frontText.textContent = card.front;
	front.append(frontLabel, frontText);
	const back = document.createElement("span");
	back.className = "flashcard-side flashcard-back";
	const backLabel = document.createElement("small");
	backLabel.textContent = "BACK · ANSWER";
	const backText = document.createElement("strong");
	backText.textContent = card.back;
	back.append(backLabel, backText);
	inner.append(front, back);
	face.append(inner);
	stage.append(face);

	const actions = document.createElement("div");
	actions.className = "flashcard-actions";
	const knew = document.createElement("button");
	knew.type = "button";
	knew.id = "flashcard-knew";
	knew.className = "button button--save";
	knew.disabled = !flashcardIsFlipped;
	knew.textContent = "Knew it";
	const didNotKnow = document.createElement("button");
	didNotKnow.type = "button";
	didNotKnow.id = "flashcard-didnt-know";
	didNotKnow.className = "button button--secondary";
	didNotKnow.disabled = !flashcardIsFlipped;
	didNotKnow.textContent = "Didn't know";
	actions.append(knew, didNotKnow);
	host.append(toolbar, stage, actions);

	face.addEventListener("click", () => {
		flashcardIsFlipped = !flashcardIsFlipped;
		renderFlashcards(host);
	});
	modeButton.addEventListener("click", () => {
		flashcardStudyMode = !flashcardStudyMode;
		currentCardIndex = 0;
		flashcardIsFlipped = false;
		renderFlashcards(host);
	});
	const markCard = (knewIt) => {
		const updated = [...currentFlashcards];
		const current = updated[currentCardIndex];
		current.box = knewIt ? Math.min(5, (current.box || 1) + 1) : 1;
		saveFlashcards(updated);
		if (flashcardStudyMode) currentCardIndex = (currentCardIndex + 1) % currentFlashcards.length;
		flashcardIsFlipped = false;
		renderFlashcards(host);
	};
	knew.addEventListener("click", () => markCard(true));
	didNotKnow.addEventListener("click", () => markCard(false));
}

export function render(container) {
	currentNoteId = null;
	currentFlashcards = [];
	currentCardIndex = 0;
	flashcardStudyMode = false;
	flashcardIsFlipped = false;
	container.innerHTML = `
		<section class="page-heading notes-heading"><span class="eyebrow">NOTES STUDIO</span><h1>Make your notes work harder.</h1><p>Turn class material into clear summaries, grounded answers, and review-ready cards.</p></section>
		<section class="surface notes-source-panel"><div class="notes-source-head"><div><span class="eyebrow">YOUR SOURCE MATERIAL</span><h2>Bring your notes in.</h2></div><span id="notes-word-count" class="notes-word-count">0 words</span></div>
			<label class="field notes-title-field"><span>Note title</span><input id="notes-title" maxlength="100" placeholder="e.g. Week 4 · Cell biology"></label>
			<label class="field notes-source-field"><span>Paste notes or add a file</span><textarea id="notes-source" rows="8" placeholder="Paste lecture notes, reading excerpts, or class material here..."></textarea></label>
			<div class="notes-upload-row"><label class="button button--secondary notes-upload-button" for="notes-file">＋ Add .txt, .md, or PDF</label><input id="notes-file" class="visually-hidden" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"><span id="notes-length-hint" class="notes-length-hint">Around 8,000 words supported; longer material is processed in chunks.</span></div>
			<p id="notes-file-status" class="notes-file-status" role="status" aria-live="polite"></p>
		</section>
		<div class="notes-tabs" role="tablist" aria-label="Notes Studio tools">
			<button class="notes-tab is-active" type="button" role="tab" aria-selected="true" aria-controls="notes-panel-summary" data-notes-tab="summary">Summarizer</button>
			<button class="notes-tab" type="button" role="tab" aria-selected="false" aria-controls="notes-panel-ask" data-notes-tab="ask" tabindex="-1">Ask My Notes</button>
			<button class="notes-tab" type="button" role="tab" aria-selected="false" aria-controls="notes-panel-tools" data-notes-tab="tools" tabindex="-1">Study Tools</button>
			<button class="notes-tab" type="button" role="tab" aria-selected="false" aria-controls="notes-panel-flashcards" data-notes-tab="flashcards" tabindex="-1">Flashcards</button>
			<button class="notes-tab" type="button" role="tab" aria-selected="false" aria-controls="notes-panel-library" data-notes-tab="library" tabindex="-1">Library <span id="notes-library-count" class="notes-count">0</span></button>
		</div>
		<section class="notes-panel is-active" id="notes-panel-summary" role="tabpanel" data-notes-panel="summary">
			<section class="surface notes-workspace"><div class="notes-tool-heading"><div><span class="eyebrow">SUMMARIZER</span><h2>Get the shape of the material.</h2></div><button id="generate-summary" class="button button--primary" type="button">Summarize notes <span aria-hidden="true">→</span></button></div>
				<div class="notes-output-actions"><button id="copy-summary" class="button button--secondary" type="button" disabled>Copy</button><button id="save-summary" class="button button--save" type="button" disabled>Save note</button><button id="print-summary" class="button button--secondary" type="button" disabled>Print / Download</button></div>
				<p id="summary-progress" class="notes-progress" aria-live="polite"></p>
				<div id="summary-result" class="notes-summary-result notes-print-target" aria-live="polite" hidden></div>
			</section>
		</section>
		<section class="notes-panel" id="notes-panel-ask" role="tabpanel" data-notes-panel="ask" hidden>
			<section class="surface notes-workspace"><div class="notes-tool-heading"><div><span class="eyebrow">GROUNDED Q&A</span><h2>Ask My Notes</h2><p>See what came from your material and what came from general knowledge.</p></div></div>
				<form id="notes-question-form" class="notes-question-form"><label class="field" for="notes-question"><span>Your question</span><textarea id="notes-question" rows="3" maxlength="1000" required placeholder="Ask about something in the notes..."></textarea></label><button class="button button--primary" type="submit">Find the answer <span aria-hidden="true">→</span></button></form>
				<div id="notes-answer-result" class="notes-answer-result" aria-live="polite" hidden></div>
			</section>
		</section>
		<section class="notes-panel" id="notes-panel-tools" role="tabpanel" data-notes-panel="tools" hidden>
			<section class="surface notes-workspace"><div class="notes-tool-heading"><div><span class="eyebrow">ACTIVE RECALL</span><h2>Work with the tricky parts.</h2><p>Select a passage in your source above to explain it in context.</p></div></div>
				<div class="notes-study-actions"><button id="extract-keypoints" class="button button--secondary" type="button">Extract key points</button><button id="explain-selection" class="button button--secondary" type="button" disabled>Explain selected section</button><button id="find-exam-topics" class="button button--secondary" type="button">Find important exam topics</button><button id="generate-questions" class="button button--primary" type="button">Generate short + long questions</button></div>
				<div class="notes-action-results"><div id="keypoints-result" class="notes-action-result" aria-live="polite" hidden></div><div id="selection-result" class="notes-action-result" aria-live="polite" hidden></div><div id="exam-topics-result" class="notes-action-result" aria-live="polite" hidden></div><div id="questions-result" class="notes-action-result" aria-live="polite" hidden></div></div>
			</section>
		</section>
		<section class="notes-panel" id="notes-panel-flashcards" role="tabpanel" data-notes-panel="flashcards" hidden>
			<section class="surface notes-workspace"><div class="notes-tool-heading"><div><span class="eyebrow">LEITNER REVIEW</span><h2>Remember it by retrieving it.</h2><p>Cards are saved with their Leitner box on the note.</p></div><div class="flashcard-generate-actions"><button id="generate-flashcards" class="button button--primary" type="button">Generate flashcards <span aria-hidden="true">✳</span></button></div></div>
				<div id="flashcard-output" class="flashcard-output" aria-live="polite"></div>
			</section>
		</section>
		<section class="notes-panel" id="notes-panel-library" role="tabpanel" data-notes-panel="library" hidden>
			<section class="surface notes-workspace"><div class="notes-tool-heading"><div><span class="eyebrow">YOUR NOTES</span><h2>Notes library</h2><p>Open, rename, or remove saved study material.</p></div><button id="new-note" class="button button--secondary" type="button">＋ New note</button></div>
				<div id="notes-library-list" class="notes-library-list" aria-live="polite"></div>
			</section>
		</section>`;
}

export function init() {
	const root = document.querySelector("#page-content");
	const sourceInput = root.querySelector("#notes-source");
	const titleInput = root.querySelector("#notes-title");
	const fileStatus = root.querySelector("#notes-file-status");
	const summaryResult = root.querySelector("#summary-result");
	let lastSummary = null;
	let summaryGeneration = 0;
	const clearSummary = () => {
		lastSummary = null;
		summaryGeneration += 1;
		summaryResult.hidden = true;
		summaryResult.replaceChildren();
		root.querySelector("#summary-progress").textContent = "";
		["#generate-summary", "#copy-summary", "#save-summary", "#print-summary"].forEach((selector) => { root.querySelector(selector).disabled = false; });
		["#copy-summary", "#save-summary", "#print-summary"].forEach((selector) => { root.querySelector(selector).disabled = true; });
	};
	const tabs = [...root.querySelectorAll("[data-notes-tab]")];
	const panels = [...root.querySelectorAll("[data-notes-panel]")];
	const selectTab = (name) => {
		tabs.forEach((tab) => {
			const active = tab.dataset.notesTab === name;
			tab.classList.toggle("is-active", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		});
		panels.forEach((panel) => {
			const active = panel.dataset.notesPanel === name;
			panel.hidden = !active;
			panel.classList.toggle("is-active", active);
		});
		if (name === "library") renderLibrary(root.querySelector("#notes-library-list"));
		if (name === "flashcards") renderFlashcards(root.querySelector("#flashcard-output"));
	};
	tabs.forEach((tab, index) => {
		tab.addEventListener("click", () => selectTab(tab.dataset.notesTab));
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			tabs[next].focus();
			selectTab(tabs[next].dataset.notesTab);
		});
	});
	const notes = get("notes");
	root.querySelector("#notes-library-count").textContent = String(notes.length);
	const requestedNoteId = new URLSearchParams(window.location.hash.split("?")[1] || "").get("note");
	const requestedNote = notes.find((note) => note.id === requestedNoteId);
	if (requestedNote) {
		currentNoteId = requestedNote.id;
		currentFlashcards = requestedNote.flashcards || [];
		sourceInput.value = requestedNote.content || "";
		titleInput.value = requestedNote.title || "";
	}
	updateSourceMeta();
	sourceInput.addEventListener("input", () => {
		updateSourceMeta();
		const savedNote = get("notes").find((note) => note.id === currentNoteId);
		if (savedNote && sourceInput.value !== savedNote.content) currentFlashcards = [];
		clearSummary();
	});
	titleInput.addEventListener("input", () => {
		if (!summaryResult.hidden && lastSummary) renderSummary(summaryResult, lastSummary);
	});
	sourceInput.addEventListener("select", updateSelectionButton);
	sourceInput.addEventListener("keyup", updateSelectionButton);
	sourceInput.addEventListener("mouseup", updateSelectionButton);
	function updateSelectionButton() {
		root.querySelector("#explain-selection").disabled = sourceInput.selectionStart === sourceInput.selectionEnd;
	}

	root.querySelector("#notes-file").addEventListener("change", async (event) => {
		const [file] = event.target.files || [];
		if (!file) return;
		const extension = file.name.split(".").pop().toLowerCase();
		fileStatus.textContent = `Reading ${file.name}...`;
		try {
			let text = "";
			if (extension === "txt" || extension === "md") {
				text = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result || ""));
					reader.onerror = () => reject(new Error("This file could not be read."));
					reader.readAsText(file);
				});
			} else if (extension === "pdf") {
				if (!window.pdfjsLib) throw new Error("PDF reading is unavailable right now. Paste the text into the notes area instead.");
				window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
				const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
				const pages = [];
				for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
					const page = await pdf.getPage(pageNumber);
					const content = await page.getTextContent();
					pages.push(content.items.map((item) => item.str).join(" "));
				}
				text = pages.join("\n\n").trim();
				if (!text) throw new Error("No selectable text was found. This PDF may be scanned or unsupported; try paste mode or run OCR first.");
			} else {
				throw new Error("Choose a .txt, .md, or text-based PDF file, or paste your notes.");
			}
			if (!text.trim()) throw new Error("This file appears to be empty. Try another file or paste mode.");
			sourceInput.value = text;
			titleInput.value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
			currentNoteId = null;
			currentFlashcards = [];
			fileStatus.textContent = `${file.name} is ready.`;
			sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
			toast("Notes imported successfully.", "success");
		} catch (error) {
			const message = error.message || "We couldn't extract text from this file.";
			fileStatus.textContent = extension === "pdf" && !/paste|scanned|selectable text/i.test(message)
				? "We couldn't extract selectable text from this PDF. It may be scanned or unsupported; try paste mode."
				: message;
			toast(fileStatus.textContent, "error");
		} finally {
			event.target.value = "";
		}
	});

	async function summarizeNotes() {
		const source = currentSource();
		if (!source) {
			toast("Paste notes or upload a file before summarizing.", "error");
			sourceInput.focus();
			return;
		}
		const chunks = textChunks(source);
		const generation = ++summaryGeneration;
		const progress = root.querySelector("#summary-progress");
		const button = root.querySelector("#generate-summary");
		const controls = ["#copy-summary", "#save-summary", "#print-summary"].map((selector) => root.querySelector(selector));
		button.disabled = true;
		controls.forEach((control) => { control.disabled = true; });
		summaryResult.hidden = false;
		summaryResult.replaceChildren(skeleton(6));
		progress.textContent = `${updateSourceMeta().toLocaleString()} words · preparing ${chunks.length} section${chunks.length === 1 ? "" : "s"}...`;
		const validate = (value) => isSummary(value);
		const requestSummary = (context, task) => askJSON({
			task,
			context,
			demoType: "notes-summary",
			responseSchema: summarySchema,
			outputFormat: "Return JSON with shortSummary:string, keyPoints:string[], definitions:[{term:string,definition:string}], formulas:string[], examPoints:string[], and exactly five possibleQuestions:string[]. Include only information supported by the notes; use empty arrays when absent."
		}, validate);
		try {
			let summary;
			if (chunks.length === 1) {
				summary = await requestSummary(`SOURCE NOTES:\n${chunks[0]}`, "Summarize the supplied notes for efficient college-level revision.");
			} else {
				const partials = [];
				for (let index = 0; index < chunks.length; index += 1) {
					progress.textContent = `Long notes detected · summarizing section ${index + 1} of ${chunks.length}...`;
					partials.push(await requestSummary(`SOURCE NOTES SECTION ${index + 1} OF ${chunks.length}:\n${chunks[index]}`, "Summarize this section faithfully. Capture its key ideas, definitions, formulas, exam points, and possible questions."));
				}
				progress.textContent = "Combining section summaries into one revision guide...";
				summary = await requestSummary(`PROGRESSIVE SECTION SUMMARIES:\n${JSON.stringify(partials)}`, "Combine these progressive section summaries into a coherent, non-repetitive revision guide. Preserve the distinction between definitions, formulas, key points, exam points, and possible questions.");
			}
			if (generation !== summaryGeneration) return;
			if (!validate(summary)) throw new Error("The summary did not match the expected format.");
			lastSummary = summary;
			renderSummary(summaryResult, summary);
			progress.textContent = chunks.length > 1 ? `Summarized progressively across ${chunks.length} sections.` : "Summary ready.";
			controls.forEach((control) => { control.disabled = false; });
		} catch {
			progress.textContent = "";
			summaryResult.replaceChildren();
			toast("The notes could not be summarized. Please try again.", "error");
		} finally {
			if (generation === summaryGeneration) button.disabled = false;
		}
	}
	root.querySelector("#generate-summary").addEventListener("click", summarizeNotes);
	root.querySelector("#copy-summary").addEventListener("click", async () => {
		if (!lastSummary) return;
		try { await copyToClipboard(makeSummaryText(lastSummary)); } catch { toast("Clipboard access is unavailable in this browser.", "error"); }
	});
	root.querySelector("#save-summary").addEventListener("click", () => {
		if (!lastSummary) return;
		const note = persistCurrentNote(currentFlashcards);
		if (note) {
			root.querySelector("#notes-library-count").textContent = String(get("notes").length);
			toast("Your notes have been saved to the library.", "success");
		}
	});
	root.querySelector("#print-summary").addEventListener("click", () => { if (lastSummary) window.print(); });

	root.querySelector("#notes-question-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		const source = currentSource();
		const question = root.querySelector("#notes-question").value.trim();
		if (!source) {
			toast("Add your notes before asking a question.", "error");
			return;
		}
		const host = root.querySelector("#notes-answer-result");
		const button = event.currentTarget.querySelector("button[type=submit]");
		button.disabled = true;
		host.hidden = false;
		host.replaceChildren(skeleton(3));
		const noteContext = relevantNotes(source, question);
		const requestContext = `STUDENT NOTES:\n${noteContext}\n\nQUESTION:\n${question}`;
		const schema = {
			type: "OBJECT",
			properties: {
				fromNotes: { type: "OBJECT", properties: { answer: { type: "STRING" }, excerpt: { type: "STRING" } }, required: ["answer", "excerpt"] },
				generalKnowledge: { type: "STRING" }
			},
			required: ["fromNotes", "generalKnowledge"]
		};
		try {
			const answer = await askJSON({
				task: "Answer the student's question using the notes first. Separate note-supported claims from general knowledge. If an answer is absent from the notes, explicitly say 'Not found in your notes.' Never present general knowledge as note-supported. The excerpt must be an exact verbatim passage from the supplied notes and no longer than 20 words; use an empty excerpt if there is no support.",
				context: requestContext,
				demoType: "notes-answer",
				responseSchema: schema,
				outputFormat: "Return JSON shaped as {fromNotes:{answer:string,excerpt:string},generalKnowledge:string}. Keep generalKnowledge empty when unnecessary."
			}, (data) => validateNotesAnswer(data, source));
			renderNotesAnswer(host, answer);
		} catch {
			host.replaceChildren();
			toast("That question could not be answered. Try rephrasing it.", "error");
		} finally {
			button.disabled = false;
		}
	});

	async function runKeyPoints() {
		const source = currentSource();
		if (!source) return toast("Add notes before extracting key points.", "error");
		const host = root.querySelector("#keypoints-result");
		host.hidden = false;
		host.replaceChildren(skeleton(3));
		const data = await askJSON({ task: "Extract the most useful key points from these notes without adding outside facts.", context: source.slice(0, 18000), demoType: "notes-keypoints", responseSchema: { type: "OBJECT", properties: { keyPoints: { type: "ARRAY", items: { type: "STRING" } } }, required: ["keyPoints"] }, outputFormat: "Return JSON with keyPoints:string[]." }, (value) => Array.isArray(value?.keyPoints) && value.keyPoints.every((item) => typeof item === "string"));
		appendResultSection(host, "Key points", data.keyPoints.map((item) => `- ${item}`).join("\n"));
	}
	root.querySelector("#extract-keypoints").addEventListener("click", runKeyPoints);

	root.querySelector("#explain-selection").addEventListener("click", async () => {
		const start = sourceInput.selectionStart;
		const end = sourceInput.selectionEnd;
		const selected = sourceInput.value.slice(start, end).trim();
		if (!selected) return toast("Select a section of your notes first.", "error");
		const host = root.querySelector("#selection-result");
		host.hidden = false;
		host.replaceChildren(skeleton(3));
		const text = await ask({ task: "Explain the selected passage in simpler language, define difficult terms, and keep the explanation faithful to the surrounding notes.", context: `SURROUNDING NOTES:\n${sourceInput.value.slice(Math.max(0, start - 1800), Math.min(sourceInput.value.length, end + 1800))}\n\nSELECTED SECTION:\n${selected}`, outputFormat: "A brief explanation followed by one example if useful." });
		appendResultSection(host, "Selected section explained", text);
	});

	root.querySelector("#find-exam-topics").addEventListener("click", async () => {
		const source = currentSource();
		if (!source) return toast("Add notes before finding exam topics.", "error");
		const host = root.querySelector("#exam-topics-result");
		host.hidden = false;
		host.replaceChildren(skeleton(3));
		const data = await askJSON({ task: "Identify likely exam topics from these notes and briefly explain their importance. Do not claim certainty about an exam.", context: source.slice(0, 18000), demoType: "notes-exam-topics", responseSchema: { type: "OBJECT", properties: { topics: { type: "ARRAY", items: { type: "OBJECT", properties: { topic: { type: "STRING" }, reason: { type: "STRING" }, priority: { type: "STRING" } }, required: ["topic", "reason", "priority"] } } }, required: ["topics"] }, outputFormat: "Return JSON with topics:[{topic,reason,priority}]." }, (value) => Array.isArray(value?.topics) && value.topics.every((item) => typeof item.topic === "string" && typeof item.reason === "string" && typeof item.priority === "string"));
		const content = data.topics.map((item) => `- **${item.topic}** (${item.priority} priority): ${item.reason}`).join("\n");
		appendResultSection(host, "Important exam topics", content);
	});

	root.querySelector("#generate-questions").addEventListener("click", async () => {
		const source = currentSource();
		if (!source) return toast("Add notes before generating questions.", "error");
		const host = root.querySelector("#questions-result");
		host.hidden = false;
		host.replaceChildren(skeleton(4));
		const data = await askJSON({ task: "Create recall questions based only on these notes, with a short-answer section and a long-answer section.", context: source.slice(0, 18000), demoType: "notes-questions", responseSchema: { type: "OBJECT", properties: { shortQuestions: { type: "ARRAY", items: { type: "STRING" } }, longQuestions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["shortQuestions", "longQuestions"] }, outputFormat: "Return JSON with shortQuestions:string[] and longQuestions:string[]." }, (value) => Array.isArray(value?.shortQuestions) && Array.isArray(value?.longQuestions));
		appendResultSection(host, "Short-answer questions", data.shortQuestions.map((item, index) => `${index + 1}. ${item}`).join("\n"));
		const second = document.createElement("section");
		second.className = "notes-generated-section";
		const heading = document.createElement("h3");
		heading.textContent = "Long-answer questions";
		second.append(heading, renderMarkdown(data.longQuestions.map((item, index) => `${index + 1}. ${item}`).join("\n")));
		host.append(second);
	});

	const flashcardOutput = root.querySelector("#flashcard-output");
	root.querySelector("#generate-flashcards").addEventListener("click", async () => {
		const source = currentSource();
		if (!source) return toast("Add notes before generating flashcards.", "error");
		const button = root.querySelector("#generate-flashcards");
		button.disabled = true;
		flashcardOutput.replaceChildren(skeleton(4));
		try {
			const data = await askJSON({
				task: "Create concise active-recall flashcards from the notes. Each front should ask one clear question; each back should answer only from the notes.",
				context: source.slice(0, 18000),
				demoType: "notes-flashcards",
				responseSchema: { type: "OBJECT", properties: { cards: { type: "ARRAY", items: { type: "OBJECT", properties: { front: { type: "STRING" }, back: { type: "STRING" } }, required: ["front", "back"] } } }, required: ["cards"] },
				outputFormat: "Return JSON with cards:[{front:string,back:string}]. Provide between 5 and 12 cards."
			}, (value) => Array.isArray(value?.cards) && value.cards.length >= 3 && value.cards.every((card) => typeof card.front === "string" && typeof card.back === "string"));
			currentFlashcards = data.cards.slice(0, 12).map((card) => ({ front: card.front, back: card.back, box: 1 }));
			currentCardIndex = 0;
			flashcardStudyMode = false;
			flashcardIsFlipped = false;
			persistCurrentNote(currentFlashcards);
			renderFlashcards(flashcardOutput);
			toast("Flashcards generated and saved with this note.", "success");
		} catch {
			flashcardOutput.replaceChildren();
			toast("Flashcards could not be generated. Please try again.", "error");
		} finally {
			button.disabled = false;
		}
	});

	root.querySelector("#notes-library-list").addEventListener("click", (event) => {
		const button = event.target.closest("[data-library-action]");
		if (!button) return;
		const action = button.dataset.libraryAction;
		if (action === "new") {
			currentNoteId = null;
			currentFlashcards = [];
			sourceInput.value = "";
			titleInput.value = "";
			clearSummary();
			updateSourceMeta();
			selectTab("summary");
			sourceInput.focus();
			return;
		}
		const note = get("notes").find((item) => item.id === button.dataset.noteId);
		if (!note) return;
		if (action === "open") {
			currentNoteId = note.id;
			currentFlashcards = note.flashcards || [];
			currentCardIndex = 0;
			sourceInput.value = note.content || "";
			titleInput.value = note.title || "";
			clearSummary();
			updateSourceMeta();
			selectTab("summary");
			sourceInput.focus();
		} else if (action === "rename") {
			makeRenameDialog(note, () => renderLibrary(root.querySelector("#notes-library-list")));
		} else if (action === "delete" && window.confirm(`Delete “${note.title}” from your notes library?`)) {
			set("notes", get("notes").filter((item) => item.id !== note.id));
			if (currentNoteId === note.id) {
				currentNoteId = null;
				currentFlashcards = [];
				sourceInput.value = "";
				titleInput.value = "";
				clearSummary();
				updateSourceMeta();
			}
			renderLibrary(root.querySelector("#notes-library-list"));
			toast("Note deleted.", "success");
		}
	});
	root.querySelector("#new-note").addEventListener("click", () => {
		currentNoteId = null;
		currentFlashcards = [];
		sourceInput.value = "";
		titleInput.value = "";
		clearSummary();
		updateSourceMeta();
		selectTab("summary");
		sourceInput.focus();
	});
}