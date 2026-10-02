export function sampleResponse() {
  return "Welcome to EduGenie demo mode. Start with one clear concept, connect it to an example, then test your understanding with a practice question. Your Gemini connection can be enabled by adding an API key to `backend/.env`.";
}

export function sampleTextResponse(type, context = "", options = {}) {
  if (type !== "exam-answer") return sampleResponse();
  const lines = String(context).split("\n");
  const getValue = (label) => lines.find((line) => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() || "the topic";
  const subject = getValue("Subject");
  const topic = getValue("Topic");
  const question = getValue("Question");
  const marks = Number(options.marks) || 5;
  if (marks === 2) return `**Definition**\n${topic} is an important concept in ${subject}.\n\n**Key point**\nIt helps explain how the main ideas in ${topic} are connected.\n\n**Question focus**\n${question}\n\n**Sample response**\nDefine the term clearly, then add one relevant point from your notes.`;
  if (marks === 5) return `**Introduction**\n${topic} is a useful concept for understanding ${subject}.\n\n**Main points**\n- State the key definition.\n- Explain the main process or relationship.\n- Connect the idea to one example.\n\n**Example**\nUse a familiar course example to show how ${topic} works.\n\n**Conclusion**\nSummarize why the idea matters to the question: ${question}`;
  return `**Introduction**\n${topic} provides a framework for explaining an important part of ${subject}.\n\n**Definition**\nDefine the central terms in the question before developing the answer.\n\n**Main explanation**\n1. Establish the starting conditions.\n2. Explain the key steps and how they connect.\n3. Describe the result and its significance.\n\n**Draw manually:** Add a clearly labelled diagram of the main stages of ${topic}, with arrows showing their order.\n\n**Example**\nApply the steps to a relevant example from ${subject}.\n\n**Advantages and limitations**\nExplain one benefit of the approach and one limitation or condition.\n\n**Conclusion**\nAnswer the question directly: ${question}`;
}

export function sampleJSON() {
  return { title: "Learning checkpoint", summary: "Demo response: explain one key idea in your own words.", nextStep: "Try a practice question" };
}

function samplePracticeQuestion(topic, difficulty, index) {
  const subtopics = ["Core definition", "Key process", "Application", "Common misconception"];
  const prompts = [
    `Which statement best describes ${topic}?`,
    `Which step is central to understanding ${topic}?`,
    `How would ${topic} apply in a typical example?`,
    `Which statement about ${topic} is most accurate?`
  ];
  return {
    q: prompts[index % prompts.length],
    options: ["It connects the main idea to its supporting parts.", "It is unrelated to the surrounding concepts.", "It can only be described by memorizing a label.", "It has no practical or theoretical application."],
    correctIndex: 0,
    explanation: `${topic} is best understood by connecting its central idea with the supporting details and an example.`,
    subtopic: subtopics[index % subtopics.length]
  };
}

export function sampleStructuredResponse(type = "default", context = "", options = {}) {
  const source = String(context || "your topic");
  const topic = source.match(/(?:^|\n)Topic:\s*([^\n]+)/i)?.[1]?.trim() || source.split(/[\n,]/)[0].slice(0, 80) || "your topic";
  if (type === "explanation") {
    return {
      definition: `${topic} is the central idea being studied.`,
      simpleExplanation: `Think of ${topic} as a way to understand how related parts work together.`,
      howItWorks: "Start with the basic parts, follow how they interact, then check the result against an example.",
      realWorldExample: `A useful first example of ${topic} is a familiar process from your course or daily routine.`,
      keyPoints: ["Identify the core idea", "Connect it to an example", "Recall it without notes"],
      commonMistakes: ["Memorizing terms without understanding how they connect"],
      examPoints: ["Define the concept", "Show the key steps", "Use a relevant example"],
      relatedTopics: ["Prerequisite concepts", "Practical applications"]
    };
  }
  if (type === "concept-map") {
    return { main: topic, concepts: [{ name: "Core idea", children: ["How it works", "Why it matters"] }, { name: "Applications", children: ["Course example"] }], advanced: ["Advanced application", "Related theory"] };
  }
  if (type === "teach-back") {
    return { correct: ["You attempted to explain the main idea in your own words."], missing: ["Add one concrete example to strengthen the explanation."], misconceptions: [], clarityScore: 72, simplerModelExplanation: `${topic} becomes easier when you connect its main parts to one familiar example.` };
  }
  if (type === "notes-summary") {
    return {
      shortSummary: "Demo summary: identify the central idea, connect the supporting points, and review important terms before an exam.",
      keyPoints: ["Find the central idea", "Connect supporting details", "Recall key terms without looking"],
      definitions: [{ term: "Core concept", definition: "The main idea that organizes a topic." }],
      formulas: [],
      examPoints: ["Define the concept clearly", "Explain how its parts connect", "Support the answer with an example"],
      possibleQuestions: ["What is the central idea?", "How do the main parts connect?", "Give one example.", "What common mistake should be avoided?", "How might this topic appear in an exam?"]
    };
  }
  if (type === "notes-answer") {
    const noteText = source.match(/STUDENT NOTES:\s*([\s\S]*?)\n\s*QUESTION:/i)?.[1]?.trim() || "";
    const excerpt = noteText.split(/\s+/).filter(Boolean).slice(0, 15).join(" ");
    return {
      fromNotes: { answer: excerpt ? "Demo Mode can show a source excerpt, but cannot verify an answer against your notes." : "Not found in your notes.", excerpt },
      generalKnowledge: "This is a sample general-knowledge section. Connect a Gemini API key for a real answer."
    };
  }
  if (type === "notes-keypoints") {
    return { keyPoints: ["Identify the key idea in each section", "Notice terms that are defined", "Turn supporting details into recall prompts"] };
  }
  if (type === "notes-exam-topics") {
    return { topics: [{ topic: "Core definitions", reason: "Definitions establish the vocabulary used throughout the material.", priority: "High" }, { topic: "Processes and relationships", reason: "Explain how steps or ideas connect.", priority: "High" }, { topic: "Applications", reason: "Examples help demonstrate understanding.", priority: "Medium" }] };
  }
  if (type === "notes-questions") {
    return {
      shortQuestions: ["Define the main concept.", "Name two key points.", "What is one common mistake?", "Give one example.", "Which term is most important?"],
      longQuestions: ["Explain the main concept and how its parts connect.", "Discuss an application and support your answer with an example.", "Compare the key ideas and explain their significance."]
    };
  }
  if (type === "notes-flashcards") {
    return { cards: [{ front: "What is a core concept?", back: "The main idea that organizes a topic." }, { front: "What makes a useful example?", back: "It connects an abstract idea to a familiar situation." }, { front: "How should you review a definition?", back: "Recall it from memory, then check the precise wording." }, { front: "What is a good exam answer structure?", back: "Define the idea, explain the connection, then give an example." }, { front: "How can you spot a knowledge gap?", back: "Try explaining the idea without notes and notice where the explanation breaks down." }] };
  }
  if (type === "practice-standard" || type === "practice-mock") {
    const count = Math.min(20, Math.max(1, Number(options.count) || 5));
    return { questions: Array.from({ length: count }, (_, index) => samplePracticeQuestion(topic, options.difficulty || "medium", index)) };
  }
  if (type === "practice-adaptive") {
    return { question: samplePracticeQuestion(topic, options.difficulty || "easy", Number(options.index) || 0) };
  }
  if (type === "practice-mistake") {
    return { explanation: "The selected option does not connect the main idea to the supporting details. The correct choice does: compare each option with the definition and look for evidence in the explanation." };
  }
  if (type === "practice-simpler") {
    return { simplerExplanation: `Think of ${topic} as one main idea supported by a few connected steps. Focus on what each step changes and why the next step follows.` };
  }
  if (type === "insights-next") {
    return { activity: "Review normalization and 3NF", reason: "Recent quiz answers show these database concepts need another retrieval attempt.", estimatedMinutes: 20, actionLink: "#/practice?subject=Database%20Systems&topic=Normalization" };
  }
  if (type === "revision-questions") {
    return { questions: Array.from({ length: 5 }, (_, index) => samplePracticeQuestion(topic, "review", index)) };
  }
  if (type === "insights-next-step") {
    return { recommendation: `Practice five questions on ${topic}, then review its key definitions and examples.` };
  }
  if (type === "insights-study-next") {
    return { activity: "Review one weak topic", reason: "A short retrieval session can strengthen your least-practiced area.", estimatedMinutes: 20, actionLink: "#/practice" };
  }
  if (type === "planner-plan") {
    let input = {};
    try { input = JSON.parse(source); } catch {}
    const exam = new Date(`${input.examDate || new Date().toISOString().slice(0, 10)}T12:00:00`);
    const start = new Date(`${input.startDate || new Date().toISOString().slice(0, 10)}T12:00:00`);
    const span = Math.max(1, Math.round((exam - start) / 86400000) + 1);
    const subjects = Array.isArray(input.subjects) ? input.subjects : [];
    const tasks = subjects.flatMap((subject) => (subject.topics || []).map((name) => ({ subject: subject.subject, topic: name })));
    const days = Array.from({ length: span }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const lastDays = Math.min(3, span);
      let task;
      if (span === 1) task = { subject: "Revision + quiz", topic: `Revision and quiz: ${tasks[0]?.topic || "key concepts"}` };
      else if (index === span - 1) task = { subject: "Exam practice", topic: `Quiz: ${tasks[0]?.topic || "key concepts"}` };
      else if (index >= span - lastDays) task = { subject: "Revision", topic: `Revision: ${tasks[index % Math.max(1, tasks.length)]?.topic || "all topics"}` };
      else task = tasks[index % Math.max(1, tasks.length)] || { subject: "Review", topic: "Review class notes" };
      return { date: date.toISOString().slice(0, 10), subject: task.subject, topic: task.topic, minutes: Math.max(1, Math.min(Number(input.dailyMinutes) || 60, Math.min(45, Number(input.dailyMinutes) || 60))), done: false };
    });
    return { planTitle: `${input.subjects?.[0]?.subject || "Study"} exam plan`, days };
  }
  if (type === "exam-rescue") {
    const emergency = Number(options.hours) <= 1;
    return {
      importantConcepts: emergency ? ["Recall the core definition", "Connect the main process steps"] : ["Start with the core definition", "Connect the process steps", "Recall one representative application"],
      quickDefinitions: emergency ? [{ term: "Core concept", definition: "The central idea used to explain a topic." }] : [{ term: "Core concept", definition: "The central idea used to organize and explain a topic." }, { term: "Application", definition: "A concrete situation where the concept is used." }],
      formulas: emergency ? [] : ["No specific formula was identified in this sample."],
      frequentlyTested: emergency ? ["Definitions", "Key process"] : ["Definitions", "Process and relationships", "Applications and examples"],
      commonMistakes: emergency ? ["Listing terms without explaining their relationship"] : ["Listing terms without explaining their relationship", "Skipping labels and assumptions"],
      rapidFire: Array.from({ length: 10 }, (_, index) => ({ question: [`Define the core idea.`, `What is the first key step?`, `Why does that step matter?`, `Name one application.`, `What should a diagram label?`][index % 5], answer: [`State the central definition clearly.`, `Identify the starting condition or first stage.`, `It explains how the next part of the process follows.`, `Use a concrete course or daily-life example.`, `Label the main parts and show their relationship.`][index % 5] })),
      oneMinuteSummary: emergency ? "Define the idea, recall its key steps, and state why it matters." : "Define the main idea, explain how its parts connect, support it with an example, and finish with why it matters."
    };
  }
  if (type === "viva-question") {
    const questions = ["What is the central idea, in your own words?", "Can you explain one important step and why it matters?", "Give an example that demonstrates this topic.", "What is one common misconception, and how would you correct it?", "How would you summarize the key relationship in this topic?"];
    return { question: questions[(Number(options.index) || 0) % questions.length] };
  }
  if (type === "viva-evaluation") {
    const index = Number(options.index) || 0;
    return {
      isCorrect: true,
      keyPointsCovered: ["Attempted to explain the main idea", "Used the student's own words"],
      missingPoints: ["Add one specific example or supporting detail."],
      clarityScore: 72,
      feedback: "Good start. Make the relationship between the main idea and its example explicit.",
      nextQuestion: "Can you explain how one important step supports the main idea?",
      isComplete: index >= 4
    };
  }
  if (type === "extras-project") {
    return {
      title: "Campus Study Buddy",
      problemStatement: "Students need a simple way to organize short, focused study sessions with classmates.",
      solution: "Build a small web app that groups topics into shared study sessions and tracks completion.",
      features: ["Create a study room", "Add and reorder topics", "Track completed sessions", "Share a session link"],
      techStack: ["HTML", "CSS", "Vanilla JavaScript", "Local JSON storage"],
      difficulty: "Beginner",
      futureEnhancements: ["Add sign-in", "Add group reminders", "Show a weekly progress view"]
    };
  }
  if (type === "extras-lab") {
    return {
      aim: "Practise a core concept using a small, reversible example.",
      question: "Create a simple example that demonstrates the selected concept and explain each step.",
      expectedConcept: "Identify the input, the main operation, and the expected result.",
      sampleInput: "Use a small, temporary example dataset or a short in-memory value.",
      sampleOutput: "A short result that can be checked manually against the example input.",
      vivaQuestions: ["What concept does the exercise demonstrate?", "What changes if the input changes?", "How can you verify the result?"]
    };
  }
  if (type === "extras-english-question") {
    return { question: "Tell me about a skill you would like to learn and why it interests you." };
  }
  if (type === "extras-english-evaluation") {
    return {
      grammarCorrections: ["Use a complete sentence with a clear subject and verb."],
      vocabularySuggestions: ["Try 'develop' or 'build' for a skill you want to gain."],
      betterSentence: "I would like to develop this skill because it interests me and could help in my studies.",
      confidenceTip: "Pause briefly between ideas, then finish the sentence before adding another point."
    };
  }
  return sampleJSON();
}

function sampleDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function sampleQuestion(topic, subtopic, index, correct) {
  return {
    q: `Sample review ${index + 1}: which idea is central to ${subtopic}?`,
    options: [`${topic} connects this idea with the topic's main process.`, "The idea has no relationship to the topic.", "Only the name matters; its role is not important.", "The idea cannot be used in an example."],
    correctIndex: 0,
    chosenIndex: correct ? 0 : 1,
    explanation: `${subtopic} is important because it connects directly to ${topic}.`,
    subtopic,
    confidence: correct ? 2 : 3
  };
}

function sampleQuiz(id, subject, topic, score, daysAgo, subtopics, mode = "standard") {
  const total = 5;
  const questions = Array.from({ length: total }, (_, index) => sampleQuestion(topic, subtopics[index % subtopics.length], index, index < score));
  return { id: `sample-quiz-${id}`, date: sampleDate(daysAgo), subject, topic, difficulty: "medium", mode, score, total, timeSpentSec: 240 + id * 35, questions, status: "completed" };
}

export function sampleLearningData() {
  const today = new Date();
  const dayKey = (offset = 0) => {
    const date = new Date(today);
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const topics = [
    { id: "sample-topic-cell", subject: "Biology", topic: "Cell division", savedExplanation: "Mitosis creates two genetically identical daughter cells.", studiedAt: sampleDate(0), mastery: 64, leitnerBox: 2, nextReviewAt: sampleDate(1) },
    { id: "sample-topic-normalization", subject: "Database Systems", topic: "Normalization", savedExplanation: "Normalization organizes relational tables to reduce redundancy.", studiedAt: sampleDate(2), mastery: 42, leitnerBox: 1, nextReviewAt: sampleDate(0) },
    { id: "sample-topic-recursion", subject: "Computer Science", topic: "Recursion", savedExplanation: "A recursive function solves a problem by calling itself on a smaller case.", studiedAt: sampleDate(1), mastery: 82, leitnerBox: 3, nextReviewAt: sampleDate(0) },
    { id: "sample-topic-electrochem", subject: "Chemistry", topic: "Electrochemistry", savedExplanation: "Redox reactions transfer electrons between chemical species.", studiedAt: sampleDate(3), mastery: 91, leitnerBox: 5, nextReviewAt: sampleDate(-10) },
    { id: "sample-topic-binary", subject: "Computer Science", topic: "Binary search", savedExplanation: "Binary search halves a sorted search range after each comparison.", studiedAt: sampleDate(4), mastery: 48, leitnerBox: 1, nextReviewAt: sampleDate(-1) },
    { id: "sample-topic-statistics", subject: "Mathematics", topic: "Descriptive statistics", savedExplanation: "Summary measures describe patterns in a data set.", studiedAt: sampleDate(5), mastery: 73, leitnerBox: 2, nextReviewAt: sampleDate(-2) },
    { id: "sample-topic-inheritance", subject: "Biology", topic: "Inheritance", savedExplanation: "Alleles are inherited variants of a gene.", studiedAt: sampleDate(6), mastery: 79, leitnerBox: 3, nextReviewAt: sampleDate(-5) }
  ];
  const quizHistory = [
    sampleQuiz(1, "Biology", "Cell division", 3, 6, ["Mitosis", "Meiosis", "Chromosomes"]),
    sampleQuiz(2, "Database Systems", "Normalization", 2, 5, ["1NF", "2NF", "3NF"]),
    sampleQuiz(3, "Computer Science", "Recursion", 4, 3, ["Base case", "Recursive step", "Call stack"]),
    sampleQuiz(4, "Chemistry", "Electrochemistry", 5, 1, ["Oxidation", "Reduction", "Electrodes"], "mock"),
    sampleQuiz(5, "Computer Science", "Binary search", 2, 0, ["Sorted input", "Midpoint", "Search range"], "adaptive")
  ];
  const activity = [];
  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const count = daysAgo < 4 ? 2 + (daysAgo % 3) : daysAgo % 2;
    for (let index = 0; index < count; index += 1) {
      const types = ["topic-studied", "quiz-completed", "revision-completed"];
      activity.push({ id: `sample-activity-${daysAgo}-${index}`, type: types[index % types.length], label: `${types[index % types.length]} sample activity`, ts: sampleDate(daysAgo) });
    }
  }
  return {
    topics,
    quizHistory,
    plans: [{ id: "sample-plan-week", title: "This week's review", examDate: dayKey(14), createdAt: sampleDate(0), days: [{ date: dayKey(0), subject: "Database Systems", topic: "Normalization", minutes: 20, done: false }, { date: dayKey(0), subject: "Biology", topic: "Cell division", minutes: 15, done: false }, { date: dayKey(1), subject: "Computer Science", topic: "Recursion", minutes: 25, done: false }] }],
    activity,
    gamification: { xp: 360, level: 4, streak: 4, lastActiveDate: dayKey(0), badges: [], studyMinutes: 245 }
  };
}