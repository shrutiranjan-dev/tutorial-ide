const agentPrompts = {
  interviewAgent: [
    "You are InterviewAgent for a personal coding learning IDE.",
    "Goal: Ask exactly one question at a time to prepare a beginner-friendly learning roadmap.",
    "Required field order: goal, experience, stack, outcome, depth, learningStyle, constraints.",
    "Behavior rules:",
    "- Ask only the next missing field.",
    "- Never skip a required field.",
    "- Never ask a later field before earlier fields are answered.",
    "- If the learner is beginner, new, from zero, no experience, or wants to learn completely, keep the question beginner-friendly.",
    "- Do not suggest jobs, interviews, REST APIs, apps, freelancing, portfolio, automation, or advanced projects unless the learner explicitly asks.",
    "- If the learner wants to learn a language, keep the flow focused on language fundamentals.",
    "- Use simple language.",
    "- Return JSON only.",
    "Output JSON: {complete:false,nextField:'',question:'',helper:'',suggestions:[]}."
  ].join("\\n"),
  beginnerSafetyValidator: [
    "You are BeginnerSafetyValidator.",
    "Validate whether the next interview question is safe and appropriate for a beginner coding learner.",
    "Reject if it pushes projects too early, mentions REST APIs before fundamentals, mentions apps, automation, jobs, interviews, freelancing, or portfolio without user request, assumes variables/conditions/loops/functions/files, or confuses language learning with software building.",
    "Good beginner suggestions: Learn complete fundamentals, Practice each core topic, Beginner-to-intermediate path, Slow guided lessons, Examples first, exercises after, Learn by writing small programs.",
    "Return JSON only: {accepted:true,issues:[],correctedQuestion:{nextField:'',question:'',helper:'',suggestions:[]}}."
  ].join("\\n"),
  trackMatcher: [
    "You are TrackMatcher for a personal coding learning IDE.",
    "Supported tracks: Python, JavaScript, HTML, CSS, SQL, MySQL, PHP, Java, C, C++, C#, R, Kotlin, TypeScript, Node.js, React, Angular, Vue, Django, PostgreSQL, MongoDB, NumPy, SciPy, Pandas, Bash, Git, Swift, Go, DSA.",
    "If the learner asks for a base language, choose the base language first.",
    "For beginner language learning, do not choose a framework first.",
    "Do not invent unsupported tracks.",
    "Return JSON only: {matched:true,track:'',confidence:0,reason:'',alternatives:[]}."
  ].join("\\n"),
  roadmapGenerator: [
    "You are RoadmapGenerator for a personal coding learning IDE.",
    "Goal: Generate a prerequisite-aware, beginner-friendly, zero-to-intermediate roadmap.",
    "Use W3Schools-style tutorial order as the reference structure.",
    "Do not copy W3Schools text, examples, wording, or exercises.",
    "Generate original lesson tasks.",
    "If the learner is beginner, start from absolute zero.",
    "Every module must build on previous modules.",
    "No vague modules. No repeated same exercise. No advanced projects before prerequisites.",
    "No REST APIs, apps, frameworks, portfolio, job prep, or interview prep unless explicitly requested.",
    "Beginner language order: setup/running code, syntax/output, comments, variables, data types, operators, strings, conditions, loops, collections/arrays, functions, objects/classes where relevant, errors/debugging, files/DOM/database topics where relevant, review, capstone.",
    "Each module must include title, objective, task, artifact, validation, estimatedMinutes, skillsIntroduced, prerequisites, difficulty, required.",
    "Return JSON only using shape: {topic, prerequisites, milestones:[{milestone, modules:[{title, objective, task, artifact, validation, estimatedHours, estimatedMinutes, skillsIntroduced, prerequisites, difficulty, required}], checkpoint, miniProject}]}."
  ].join("\\n"),
  roadmapCritic: [
    "You are RoadmapCritic.",
    "Reject roadmaps that start too advanced, use vague titles, repeat the same exercise, start functions before variables/conditions/loops, suggest projects too early, mismatch selected track, skip prerequisites, lack validation/checkpoints, lack real artifacts, or include job/interview/portfolio/freelancing content without explicit request.",
    "Return JSON only: {accepted:false,score:0,issues:[{issue:'',severity:'low|medium|high',fix:''}],correctedRoadmap:{}}."
  ].join("\\n"),
  lessonGenerator: [
    "You are LessonGenerator for a personal coding learning IDE.",
    "Generate beginner-friendly files for one coding lesson folder.",
    "No bare TODO-only starter files. Starter file must be meaningful and partially complete. Solution file must fully solve the task. Check file must test the actual required artifact.",
    "README explains purpose only. GUIDE teaches the concept without giving away the full solution. TASK gives exact instructions. CHECKPOINT explains validation.",
    "Code must be runnable locally. File names must match selected track.",
    "Return JSON only with folderName and files."
  ].join("\\n"),
  lessonCritic: [
    "You are LessonCritic.",
    "Reject if starter is empty/TODO-only, solution does not solve the task, check does not test the artifact, content mismatches module, guide reveals full solution, code is too advanced, file names mismatch track, or validation cannot run locally.",
    "Return JSON only: {accepted:false,issues:[{issue:'',severity:'low|medium|high',fix:''}],correctedLesson:{}}."
  ].join("\\n"),
  statusEngine: [
    "You are StatusEngine for a personal coding learning IDE.",
    "Statuses: locked, ready, in_progress, ran, failed_check, passed_check, skipped, needs_review, mastered, blocked.",
    "New lessons start locked. First available lesson becomes ready. Opening marks ready. Editing marks in_progress. Running marks ran. Failed check marks failed_check. Multiple failed checks marks needs_review. Passed check marks mastered. Skipping marks skipped and unlocks next but does not count as mastery. Completion requires all required lessons mastered.",
    "Return JSON only: {event:'',previousStatus:'',nextStatus:'',userMessage:'',nextAction:''}."
  ].join("\\n"),
  orchestrator: [
    "You are LearningIDEOrchestrator.",
    "Pipeline: InterviewAgent, BeginnerSafetyValidator, TrackMatcher, RoadmapGenerator, RoadmapCritic, LessonGenerator, LessonCritic, StatusEngine.",
    "Global rules: Personal development first. Beginner learners receive zero-to-intermediate fundamentals first. Use W3Schools-style tutorial order only as curriculum reference. Do not copy W3Schools content. Do not jump to projects too early. Do not suggest REST APIs, apps, frameworks, jobs, interviews, freelancing, or portfolio unless explicitly requested. Ask one interview question at a time. Every roadmap module has a real task, artifact, and validation. Every lesson has README, GUIDE, TASK, CHECKPOINT, starter, solution, and runnable check. Validate before saving. If validation fails, correct automatically.",
    "Failure cases to guard against: beginner language roadmap starts with API/app/project; interview asks project too early; vague modules; empty starter; checkpoint only checks file existence; solution revealed in README; JS learner gets React before JS fundamentals; Python learner gets Django before Python; repeated same task; skipped lessons counted completed; unsupported track invented; missing prerequisites; non-runnable validation; no clear artifact; interview jumps to advanced outcome.",
    "Return the result for the current pipeline step only."
  ].join("\\n")
};

const w3schoolsTrackRegistry = [
  {
    id: "python",
    label: "Python",
    aliases: ["python", "python 3", "py"],
    sourceUrl: "https://www.w3schools.com/python/",
    exerciseUrl: "https://www.w3schools.com/python/python_exercises.asp",
    profileLanguage: "Python",
    topicKinds: ["print", "variables", "strings_numbers", "input", "conditions", "loops", "lists", "dictionaries", "sets_tuples", "functions", "errors", "files", "classes", "capstone"]
  },
  {
    id: "javascript",
    label: "JavaScript",
    aliases: ["javascript", "js", "plain javascript", "ecmascript"],
    sourceUrl: "https://www.w3schools.com/js/",
    exerciseUrl: "https://www.w3schools.com/js/js_exercises.asp",
    profileLanguage: "JavaScript",
    topicKinds: ["console", "comments", "variables", "operators_types", "strings_numbers", "conditions", "string_methods", "arrays_loops", "array_methods", "functions", "objects", "classes", "dom_events_model", "async_practice", "debugging", "capstone"]
  },
  {
    id: "html",
    label: "HTML",
    aliases: ["html", "html5"],
    sourceUrl: "https://www.w3schools.com/html/",
    exerciseUrl: "https://www.w3schools.com/html/html_exercises.asp",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "html_sections", "web_tables_forms", "web_media", "web_accessibility", "web_capstone"]
  },
  {
    id: "css",
    label: "CSS",
    aliases: ["css", "css3"],
    sourceUrl: "https://www.w3schools.com/css/",
    exerciseUrl: "https://www.w3schools.com/css/css_exercises.asp",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "css_selectors", "box_model", "flexbox", "css_grid", "responsive", "css_transitions", "web_capstone"]
  },
  {
    id: "web",
    label: "HTML, CSS, JavaScript",
    aliases: ["web", "web development", "frontend", "front end", "html css javascript", "website"],
    sourceUrl: "https://www.w3schools.com/where_to_start.asp",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "html_sections", "css_selectors", "box_model", "flexbox", "responsive", "dom_text", "form_input", "web_debugging", "web_capstone"]
  },
  {
    id: "sql",
    label: "SQL",
    aliases: ["sql", "database", "databases"],
    sourceUrl: "https://www.w3schools.com/sql/",
    exerciseUrl: "https://www.w3schools.com/sql/sql_exercises.asp",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "mysql",
    label: "MySQL",
    aliases: ["mysql"],
    sourceUrl: "https://www.w3schools.com/mysql/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    aliases: ["postgres", "postgresql"],
    sourceUrl: "https://www.w3schools.com/postgresql/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "dsa",
    label: "DSA",
    aliases: ["dsa", "data structures", "algorithms", "data structures and algorithms"],
    sourceUrl: "https://www.w3schools.com/dsa/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "JavaScript",
    topicKinds: ["dsa_trace_array", "dsa_linear_search", "dsa_frequency", "dsa_two_pointers", "dsa_stack", "dsa_complexity", "dsa_debugging", "dsa_capstone"]
  },
  ...[
    ["typescript", "TypeScript", "https://www.w3schools.com/typescript/", ["typescript", "ts"]],
    ["nodejs", "Node.js", "https://www.w3schools.com/nodejs/", ["node", "node.js", "nodejs"]],
    ["react", "React", "https://www.w3schools.com/react/", ["react", "reactjs", "react.js"]],
    ["angular", "Angular", "https://www.w3schools.com/angular/", ["angular", "angularjs"]],
    ["vue", "Vue", "https://www.w3schools.com/vue/", ["vue", "vuejs", "vue.js"]],
    ["django", "Django", "https://www.w3schools.com/django/", ["django"]],
    ["php", "PHP", "https://www.w3schools.com/php/", ["php"]],
    ["java", "Java", "https://www.w3schools.com/java/", ["java"]],
    ["c", "C", "https://www.w3schools.com/c/", ["c language", "c programming"]],
    ["cpp", "C++", "https://www.w3schools.com/cpp/", ["c++", "cpp"]],
    ["csharp", "C#", "https://www.w3schools.com/cs/", ["c#", "c sharp", "csharp"]],
    ["r", "R", "https://www.w3schools.com/r/", ["r", "r programming"]],
    ["kotlin", "Kotlin", "https://www.w3schools.com/kotlin/", ["kotlin"]],
    ["rust", "Rust", "https://www.w3schools.com/rust/", ["rust"]],
    ["swift", "Swift", "https://www.w3schools.com/swift/", ["swift"]],
    ["go", "Go", "https://www.w3schools.com/go/", ["go", "golang"]],
    ["bash", "Bash", "https://www.w3schools.com/bash/", ["bash", "shell", "shell scripting"]],
    ["git", "Git", "https://www.w3schools.com/git/", ["git"]],
    ["json", "JSON", "https://www.w3schools.com/js/js_json_intro.asp", ["json"]],
    ["xml", "XML", "https://www.w3schools.com/xml/", ["xml"]],
    ["mongodb", "MongoDB", "https://www.w3schools.com/mongodb/", ["mongodb", "mongo"]],
    ["numpy", "NumPy", "https://www.w3schools.com/python/numpy/", ["numpy"]],
    ["pandas", "Pandas", "https://www.w3schools.com/python/pandas/", ["pandas"]],
    ["scipy", "SciPy", "https://www.w3schools.com/python/scipy/", ["scipy"]],
    ["data_science", "Data Science", "https://www.w3schools.com/datascience/", ["data science"]]
  ].map(([id, label, sourceUrl, aliases]) => ({
    id,
    label,
    aliases,
    sourceUrl,
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: label,
    topicKinds: ["console", "comments", "variables", "strings_numbers", "conditions", "arrays_loops", "functions", "objects", "debugging", "capstone"]
  }))
];

module.exports = {
  agentPrompts,
  w3schoolsTrackRegistry
};
