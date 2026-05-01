import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");

function bootstrap(url = "http://localhost") {
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (!window.crypto) {
    window.crypto = webcrypto;
  }
  if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
    window.HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.close) {
    window.HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
  window.eval(appJs);
  return dom;
}

function clickFirstCard(window, containerId) {
  const container = window.document.getElementById(containerId);
  const first = container?.querySelector("button");
  if (!first) {
    throw new Error(`No selectable button in #${containerId}`);
  }
  first.click();
}

function clickCardByText(window, containerId, text) {
  const container = window.document.getElementById(containerId);
  const target = Array.from(container?.querySelectorAll("button") || []).find((button) =>
    button.textContent.includes(text),
  );
  if (!target) {
    throw new Error(`No card containing "${text}" in #${containerId}`);
  }
  target.click();
}

function startBasicGame(window) {
  const doc = window.document;
  doc.getElementById("studentName").value = "Test User";
  clickFirstCard(window, "profileOptions");
  clickFirstCard(window, "backgroundOptions");
  clickFirstCard(window, "difficultyOptions");
  clickFirstCard(window, "testPlanOptions");
  clickFirstCard(window, "counselorOptions");
  window.startGame();
}

function getStateSnapshot(window) {
  return JSON.parse(window.serializeStateForDev());
}

function applyStateSnapshot(window, nextState) {
  const message = window.applyDevState(JSON.stringify(nextState));
  expect(message).toContain("已应用");
}

function waitForTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chess-game app", () => {
  it("can start game from setup", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const setupCard = window.document.getElementById("setupCard");
    const termLabel = window.document.getElementById("termLabel");
    expect(setupCard.classList.contains("hidden")).toBe(true);
    expect(termLabel.textContent).toContain("高一上");
  });

  it("makes counselor scoring prefer major-aligned high school projects", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const csMajor = {
      id: "cs_engineering",
      weights: { research: 0.3, quant: 0.25, business: 0.1, leadership: 0.1, impact: 0.1, writing: 0.1, creative: 0.05 },
      tags: ["科研"],
    };
    const alignedEvent = {
      id: "aligned-research",
      title: "算法实验室助研",
      tags: ["科研", "数据"],
      effects: { research: 10, awards: 6, leadership: 2 },
      cost: 1800,
      time: 2,
      projectId: "research-track",
    };
    const offMajorEvent = {
      id: "off-major-business",
      title: "商业案例孵化",
      tags: ["商业", "创业"],
      effects: { internship: 10, leadership: 3, activities: 6 },
      cost: 1800,
      time: 2,
      projectId: "startup-track",
    };

    const alignedScore = window.scoreEventForCounselor(alignedEvent, csMajor, null);
    const offMajorScore = window.scoreEventForCounselor(offMajorEvent, csMajor, null);
    expect(alignedScore).toBeGreaterThan(offMajorScore);
  });

  it("uses activity-major alignment in undergrad admission evaluation, not only raw quality", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.majorId = "cs_engineering";
    snapshot.stats = {
      ...snapshot.stats,
      gpa: 3.86,
      test: 1490,
      english: 106,
      activities: 72,
      awards: 66,
      leadership: 58,
      essay: 70,
      essayTrack: 74,
      recStrength: 68,
      reputation: 60,
      stress: 30,
      finance: 62,
    };
    snapshot.essayChoices = ["research"];
    snapshot.recChoice = "teacher";
    snapshot.schoolEssays = { cmu: "research" };
    snapshot.tagCounts = { 科研: 5, 商业: 1, 人文: 1 };
    snapshot.majorActivityAlignment = { weightedScore: 4.7, totalWeight: 5, totalItems: 5, alignedItems: 4 };
    applyStateSnapshot(window, snapshot);

    const school = window.getLegacySchoolById("cmu");
    const alignedEval = window.evaluateApplication(school, { preview: true });

    const weakSnapshot = getStateSnapshot(window);
    weakSnapshot.majorActivityAlignment = { weightedScore: 2.1, totalWeight: 5, totalItems: 5, alignedItems: 0 };
    applyStateSnapshot(window, weakSnapshot);
    const offMajorEval = window.evaluateApplication(school, { preview: true });

    expect(alignedEval.portfolioAlignment).toBeGreaterThan(offMajorEval.portfolioAlignment);
    expect(alignedEval.chance).toBeGreaterThan(offMajorEval.chance);
    expect(alignedEval.fitScore).toBeGreaterThan(offMajorEval.fitScore);
  });

  it("keeps test, english, and GPA mini actions available every high school term", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    for (let term = 0; term <= 5; term += 1) {
      const text = window.document.getElementById("miniActions").textContent;
      expect(text).toContain("标化刷题冲刺");
      expect(text).toContain("英语输入强化");
      expect(text).toContain("课堂补弱答疑");
      if (term < 5) {
        const snapshot = getStateSnapshot(window);
        snapshot.termIndex = term + 1;
        applyStateSnapshot(window, snapshot);
        window.drawEvents();
        window.updateUI();
      }
    }
  });

  it("assigns a random ivy legacy school when using the legacy background", () => {
    const dom = bootstrap();
    const { window } = dom;
    const doc = window.document;
    doc.getElementById("studentName").value = "Legacy User";
    clickFirstCard(window, "profileOptions");
    clickCardByText(window, "backgroundOptions", "Legacy");
    clickFirstCard(window, "difficultyOptions");
    clickFirstCard(window, "testPlanOptions");
    clickFirstCard(window, "counselorOptions");
    window.startGame();

    const snapshot = getStateSnapshot(window);
    expect(snapshot.backgroundId).toBe("legacy");
    expect([
      "harvard",
      "princeton",
      "yale",
      "columbia",
      "upenn",
      "cornell",
      "brown",
      "dartmouth",
    ]).toContain(snapshot.legacySchoolId);
    expect(typeof snapshot.legacySchoolName).toBe("string");
    expect(snapshot.legacySchoolName.length).toBeGreaterThan(0);
    expect(snapshot.log.some((line) => String(line).includes("Legacy 院校"))).toBe(true);
  });

  it("applies the legacy admissions boost only to the assigned ivy school", () => {
    const dom = bootstrap();
    const { window } = dom;
    const doc = window.document;
    doc.getElementById("studentName").value = "Legacy Boost";
    clickFirstCard(window, "profileOptions");
    clickCardByText(window, "backgroundOptions", "Legacy");
    clickFirstCard(window, "difficultyOptions");
    clickFirstCard(window, "testPlanOptions");
    clickFirstCard(window, "counselorOptions");
    window.startGame();

    const snapshot = getStateSnapshot(window);
    snapshot.stats.gpa = 3.84;
    snapshot.stats.test = 1500;
    snapshot.stats.english = 108;
    snapshot.stats.activities = 76;
    snapshot.stats.awards = 68;
    snapshot.stats.leadership = 72;
    snapshot.stats.essay = 74;
    snapshot.stats.essayTrack = 78;
    snapshot.stats.recStrength = 74;
    snapshot.stats.reputation = 62;
    applyStateSnapshot(window, snapshot);

    const boostedSnapshot = getStateSnapshot(window);
    const legacySchoolId = boostedSnapshot.legacySchoolId;
    const legacySchool = window.getLegacySchoolById(legacySchoolId);
    const boosted = window.evaluateApplication(legacySchool, { preview: true });

    boostedSnapshot.legacySchoolId = null;
    boostedSnapshot.legacySchoolName = null;
    applyStateSnapshot(window, boostedSnapshot);
    const baseline = window.evaluateApplication(legacySchool, { preview: true });

    expect(boosted.legacyBonusApplied).toBe(true);
    expect(boosted.chance).toBeGreaterThan(baseline.chance);
    expect(boosted.score).toBeGreaterThan(baseline.score);
  });

  it("includes enriched stage project catalogs across high school, undergrad, masters and phd", () => {
    const dom = bootstrap();
    const { window } = dom;
    const snapshot = window.buildDevDataSnapshot();

    expect(snapshot.highschoolEvents.some((item) => item.id === "robotics-research-team")).toBe(true);
    expect(snapshot.undergradActions.some((item) => item.id === "ug-data-product-studio")).toBe(true);
    expect(snapshot.undergradMiniActions.some((item) => item.id === "ug-mini-prototype-polish")).toBe(true);
    expect((snapshot.undergradTermActions["6"] || []).some((item) => item.id === "ug-t6-engineering-prototype")).toBe(true);
    expect(snapshot.mastersActions.some((item) => item.id === "ms-pre-doc-track")).toBe(true);
    expect(snapshot.mastersMiniActions.some((item) => item.id === "ms-mini-mock-defense")).toBe(true);
    expect(snapshot.phdActions.some((item) => item.id === "phd-methods-consortium")).toBe(true);
    expect(snapshot.phdExtraActions.some((item) => item.id === "phd-x-founder-spinout")).toBe(true);
  });

  it("tracks dominant route, combo reactions and transparent feedback after a themed high school term", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.currentEvents = [
      {
        id: "combo-research",
        title: "实验室研究推进",
        desc: "强化研究主线。",
        effects: { awards: 6, research: 8, stress: 1 },
        cost: 0,
        time: 2,
        tags: ["科研"],
        projectId: "research-track",
      },
      {
        id: "combo-writing",
        title: "政策写作简报",
        desc: "把研究转成可传播成果。",
        effects: { essayTrack: 8, essay: 4, reputation: 2 },
        cost: 0,
        time: 2,
        tags: ["政策", "写作"],
      },
    ];
    snapshot.selectedEventIds = ["combo-research", "combo-writing"];
    snapshot.selectedMiniIds = ["research-note"];
    snapshot.timeBudget = 8;
    snapshot.cash = 50000;
    snapshot.termIndex = 0;
    applyStateSnapshot(window, snapshot);

    window.confirmTerm();
    window.updateUI();

    const after = getStateSnapshot(window);
    expect(after.routeScores.research).toBeGreaterThan(0);
    expect(after.comboHistory.some((item) => item.id === "research-output")).toBe(true);
    expect(after.feedbackLedger.length).toBeGreaterThan(0);
    expect(window.document.getElementById("routeHeadline").textContent).toContain("主路线");
    expect(window.document.getElementById("routeFeedbackList").textContent).toContain("顺风");
  });

  it("stores legacy progress and rehydrates automatic new-game-plus bonuses", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.finalChoice = "mit";
    snapshot.results = [
      {
        id: "mit",
        name: "Massachusetts Institute of Technology",
        region: "US",
        qsRank: 1,
        status: "录取",
      },
    ];
    snapshot.jobOutcome = {
      chosenOfferCompanyId: "google",
      chosenOfferCompany: "Google",
      applications: [
        {
          companyId: "google",
          company: "Google",
          role: "Software Engineer",
          status: "录用",
          salaryLow: 150000,
          salaryHigh: 220000,
        },
      ],
    };
    snapshot.seasonRun = {
      seasonId: "2026-S2",
      startedAt: Date.now(),
      score: 0,
      finished: false,
      completedChallenges: [],
      leaderboardRank: null,
    };
    applyStateSnapshot(window, snapshot);

    window.finalizeSeasonRun();
    const legacy = window.readLegacyProgress();
    expect(legacy.completedRuns).toBe(1);
    expect(legacy.bestScore).toBeGreaterThan(0);

    window.resetGame();
    const summary = window.document.getElementById("legacySummary").textContent;
    expect(summary).toContain("已完成 1 局");
    expect(summary).toContain("当前自动加成");
  });

  it("harmonizes paradoxical rd results so multiple top admits do not coexist with all easier schools rejecting", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const schools = window
      .buildDevDataSnapshot()
      .universities.filter((item) => Number.isFinite(item.qsRank))
      .sort((a, b) => a.qsRank - b.qsRank);
    const eliteA = schools[2];
    const eliteB = schools[5];
    const easierA = schools[26];
    const easierB = schools[40];

    const makeResult = (school, status, chance) => ({
      ...school,
      status,
      chance,
      fitScore: 0.82,
      academicScore: 0.88,
      holisticScore: 0.8,
      selectivityScore: school.qsRank <= 10 ? 0.9 : school.qsRank <= 30 ? 0.68 : 0.45,
      scoreGap: school.qsRank <= 10 ? 0.03 : 0.18,
      stressPenaltyScore: 0.02,
      worldModifier: 0.01,
      roundChoice: "rd",
      structurePenaltyScore: 0,
      structureTierAtSubmit: "匹配",
      reasons: [],
      tips: [],
      decisionDrivers: { plus: [], minus: [], line: "" },
      explainability: { line: "", breakdown: [], scoreDelta: 0 },
      batch: "rd",
      released: true,
      revealed: false,
      email: `${school.id}@example.edu`,
      emailNote: "",
    });

    const adjusted = window.harmonizeApplicationBatchResults([
      makeResult(eliteA, "录取", 0.12),
      makeResult(eliteB, "录取", 0.14),
      makeResult(easierA, "拒绝", 0.46),
      makeResult(easierB, "拒绝", 0.51),
    ]);

    const easierStatuses = adjusted.slice(2).map((item) => item.status);
    expect(easierStatuses.some((status) => status !== "拒绝")).toBe(true);
  });

  it("rescues unrealistic all-reject outcomes when every safety school is denied", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const schools = window
      .buildDevDataSnapshot()
      .universities.filter((item) => Number.isFinite(item.qsRank))
      .sort((a, b) => a.qsRank - b.qsRank);
    const saferA = schools[35];
    const saferB = schools[48];
    const reach = schools[4];

    const makeResult = (school, status, chance) => ({
      ...school,
      status,
      chance,
      fitScore: 0.78,
      academicScore: 0.85,
      holisticScore: 0.74,
      selectivityScore: school.qsRank <= 10 ? 0.9 : school.qsRank <= 60 ? 0.58 : 0.42,
      scoreGap: school.qsRank <= 10 ? -0.01 : 0.22,
      stressPenaltyScore: 0.01,
      worldModifier: 0.01,
      roundChoice: "rd",
      structurePenaltyScore: 0,
      structureTierAtSubmit: "保底",
      reasons: [],
      tips: [],
      decisionDrivers: { plus: [], minus: [], line: "" },
      explainability: { line: "", breakdown: [], scoreDelta: 0 },
      batch: "rd",
      released: true,
      revealed: false,
      email: `${school.id}@example.edu`,
      emailNote: "",
    });

    const adjusted = window.harmonizeApplicationBatchResults([
      makeResult(reach, "拒绝", 0.18),
      makeResult(saferA, "拒绝", 0.76),
      makeResult(saferB, "拒绝", 0.81),
    ]);

    const saferStatuses = adjusted.slice(1).map((item) => item.status);
    expect(saferStatuses.some((status) => status === "录取")).toBe(true);
  });

  it("finalizes interviewer chat after 2 concise answers", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.postGradPath = "job";
    snapshot.jobOutcome = {
      offerCount: 0,
      interviewRound: 1,
      applications: [
        {
          companyId: "google",
          company: "Google",
          role: "Software Engineer",
          location: "Mountain View",
          difficulty: 0.62,
          difficultyLabel: "高",
          chance: 0.52,
          baseChance: 0.52,
          status: "面试中",
          salaryLow: 130000,
          salaryHigh: 190000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: true,
          interviewTranscript: [],
          reason: "初筛通过",
        },
      ],
      offers: [],
      score: 0.7,
      universitySignal: 0.7,
      educationLabel: "本科毕业",
      majorName: "计算机科学/工程",
    };
    snapshot.chatContext = snapshot.chatContext || {};
    snapshot.chatContext.interviewSession = null;
    snapshot.log = [];
    snapshot.difficultyId = "relaxed";
    applyStateSnapshot(window, snapshot);

    const originalRandom = window.Math.random;
    window.Math.random = () => 0;
    try {
      const q1 = window.generateInterviewerReply("开始面试");
      expect(q1).toContain("1/2");

      const q2 = window.generateInterviewerReply(
        "我做过一个课程项目，当时主要负责核心功能，最后按时交付，效果不错。",
      );
      expect(q2).toContain("2/2");

      const done = window.generateInterviewerReply(
        "如果事情很多，我会先排优先级，先做影响最大的，再同步进度和结果。",
      );
      expect(done).toContain("面试结论");

      const after = getStateSnapshot(window);
      const app = after.jobOutcome.applications[0];
      expect(app.status).toBe("录用");
      expect(app.chatInterviewPending).toBe(false);
      expect(app.interviewTranscript.length).toBeGreaterThan(0);
    } finally {
      window.Math.random = originalRandom;
    }
  });

  it("shows a small reminder to tell interviewers '放弃' before choosing final job when interviews remain", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.undergradCurrentYear = 8;
    snapshot.postGradPath = "job";
    snapshot.jobOutcome = {
      offerCount: 1,
      interviewRound: 1,
      applications: [
        {
          companyId: "google",
          company: "Google",
          role: "Software Engineer",
          location: "Mountain View",
          difficulty: 0.62,
          difficultyLabel: "高",
          chance: 0.82,
          baseChance: 0.52,
          status: "录用",
          salaryLow: 130000,
          salaryHigh: 190000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: false,
          interviewTranscript: [],
          revealed: true,
          reason: "面试表现稳定",
        },
        {
          companyId: "meta",
          company: "Meta",
          role: "Software Engineer",
          location: "Menlo Park",
          difficulty: 0.68,
          difficultyLabel: "高",
          chance: 0.48,
          baseChance: 0.48,
          status: "面试中",
          salaryLow: 125000,
          salaryHigh: 185000,
          majorFit: 0.95,
          interviewRound: 1,
          chatInterviewPending: true,
          interviewTranscript: [],
          revealed: true,
          reason: "待完成面试",
        },
      ],
      offers: [],
      score: 0.74,
      universitySignal: 0.72,
      educationLabel: "本科毕业",
      majorName: "计算机科学/工程",
      chosenOfferCompanyId: null,
    };
    applyStateSnapshot(window, snapshot);

    const note = window.document.getElementById("careerReleaseNote").textContent;
    const btn = window.document.getElementById("chooseFinalJobBtn");
    expect(note).toContain("发送“放弃”");
    expect(btn.disabled).toBe(true);
    expect(String(btn.title)).toContain("发送“放弃”");
  });

  it("shows final result summary only after all letters are opened", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "ed_release";
    snapshot.resultReleaseStage = "early";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        code: "US",
        type: "research",
        strengths: ["law", "business_mgmt"],
        qsRank: 4,
        chance: 0.71,
        fitScore: 0.83,
        academicScore: 0.8,
        holisticScore: 0.76,
        selectivityScore: 0.66,
        scoreGap: 0.09,
        stressPenaltyScore: 0.01,
        status: "录取",
        roundChoice: "ed",
        aidPercent: 0.95,
        netCost: 4000,
        aidDelay: false,
        netCostFirstYear: 4000,
        aidFirstYear: 0.95,
        reasons: ["学术表现强", "专业匹配度高"],
        tips: [],
        decisionDrivers: {
          line: "主因：学术硬指标拉动；短板：无明显短板",
          summary: ["学术 80", "活动 76", "匹配 83", "门槛 66"],
        },
        structurePenaltyScore: 0,
        structureTierAtSubmit: "match",
        renewalPolicy: {
          requiredGpa: 3.25,
          requiredEngagement: 62,
          retentionChance: 0.82,
          expectedAidPercent: 0.92,
        },
        estimatedFourYearCost: 23000,
        batch: "ed",
        released: true,
        revealed: false,
        email: "admissions@harvard.edu",
        emailNote: "",
      },
      {
        id: "mit",
        name: "Massachusetts Institute of Technology",
        country: "United States",
        code: "US",
        type: "polytechnic",
        strengths: ["cs_engineering"],
        qsRank: 1,
        chance: 0.49,
        fitScore: 0.78,
        academicScore: 0.72,
        holisticScore: 0.65,
        selectivityScore: 0.72,
        scoreGap: -0.03,
        stressPenaltyScore: 0.02,
        status: "拒绝",
        roundChoice: "ed",
        aidPercent: null,
        netCost: null,
        aidDelay: false,
        netCostFirstYear: null,
        aidFirstYear: null,
        reasons: ["院校录取门槛高"],
        tips: ["补强活动深度"],
        decisionDrivers: {
          line: "主因：综合评估；短板：院校门槛高于当前分值",
          summary: ["学术 72", "活动 65", "匹配 78", "门槛 72"],
        },
        structurePenaltyScore: 0,
        structureTierAtSubmit: "reach",
        renewalPolicy: null,
        estimatedFourYearCost: null,
        batch: "ed",
        released: true,
        revealed: false,
        email: "admissions@mit.edu",
        emailNote: "",
      },
    ];
    applyStateSnapshot(window, snapshot);

    const summary = window.document.getElementById("resultSummary");
    expect(summary.textContent).toContain("0 / 2");

    const firstCard = window.document.querySelector("#resultsList .result-card");
    expect(firstCard).toBeTruthy();
    firstCard.click();
    expect(summary.textContent).toContain("1 / 2");

    const cards = window.document.querySelectorAll("#resultsList .result-card");
    expect(cards.length).toBe(2);
    cards[1].click();
    expect(summary.textContent).toContain("已放榜");
    expect(summary.textContent).not.toContain("已查看");
  });

  it("keeps aggregate review data hidden until all release emails are opened", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.resultReleaseStage = "regular";
    snapshot.results = [
      {
        id: "cmu",
        name: "Carnegie Mellon University",
        qsRank: 58,
        country: "United States",
        region: "us",
        status: "录取",
        chance: 0.42,
        fitScore: 0.78,
        academicScore: 0.74,
        holisticScore: 0.66,
        selectivityScore: 0.61,
        scoreGap: 0.08,
        stressPenaltyScore: 0.02,
        aidPercent: 0.5,
        netCost: 32000,
        reasons: ["专业匹配度高"],
        tips: [],
        decisionDrivers: { line: "主因：匹配度高", summary: ["学术 74", "活动 66"] },
        renewalPolicy: { requiredGpa: 3.2, requiredEngagement: 55, retentionChance: 0.82 },
        estimatedFourYearCost: 128000,
        batch: "rd",
        released: true,
        revealed: true,
        email: "admission@cmu.edu",
        emailNote: "",
        cost: 64000,
      },
      {
        id: "ucla",
        name: "University of California, Los Angeles",
        qsRank: 42,
        country: "United States",
        region: "us",
        status: "拒绝",
        chance: 0.33,
        fitScore: 0.71,
        academicScore: 0.7,
        holisticScore: 0.62,
        selectivityScore: 0.68,
        scoreGap: -0.03,
        stressPenaltyScore: 0.02,
        aidPercent: null,
        netCost: null,
        reasons: ["竞争激烈"],
        tips: ["补强活动深度"],
        decisionDrivers: { line: "主因：门槛略高", summary: ["学术 70", "活动 62"] },
        renewalPolicy: null,
        estimatedFourYearCost: null,
        batch: "rd",
        released: true,
        revealed: false,
        email: "admission@ucla.edu",
        emailNote: "",
        cost: 66000,
      },
    ];
    applyStateSnapshot(window, snapshot);

    expect(window.document.getElementById("outcomeMetrics").textContent.trim()).toBe("");
    expect(window.document.getElementById("reviewPanel").classList.contains("hidden")).toBe(true);
    expect(window.document.getElementById("financePanel").classList.contains("hidden")).toBe(true);

    const cards = window.document.querySelectorAll("#resultsList .result-card");
    cards[1].click();

    expect(window.document.getElementById("outcomeMetrics").textContent).toContain("匹配度指数");
    expect(window.document.getElementById("reviewPanel").classList.contains("hidden")).toBe(false);
    expect(window.document.getElementById("financePanel").classList.contains("hidden")).toBe(false);
  });

  it("blocks choosing final offer until waitlist updates are resolved and fully viewed", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const admitSchool = window.getLegacySchoolById("cmu");
    const waitlistSchool = window.getLegacySchoolById("ucla");
    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.resultReleaseStage = "regular";
    snapshot.results = [
      {
        ...admitSchool,
        status: "录取",
        chance: 0.42,
        fitScore: 0.78,
        academicScore: 0.74,
        holisticScore: 0.66,
        selectivityScore: 0.61,
        scoreGap: 0.08,
        stressPenaltyScore: 0.02,
        aidPercent: 0.5,
        netCost: 32000,
        reasons: ["专业匹配度高"],
        tips: [],
        decisionDrivers: { line: "主因：匹配度高", summary: ["学术 74", "活动 66"] },
        renewalPolicy: { requiredGpa: 3.2, requiredEngagement: 55, retentionChance: 0.82 },
        estimatedFourYearCost: 128000,
        batch: "rd",
        released: true,
        revealed: true,
        email: "admission@cmu.edu",
        emailNote: "",
      },
      {
        ...waitlistSchool,
        status: "候补",
        chance: 0.28,
        fitScore: 0.7,
        academicScore: 0.69,
        holisticScore: 0.61,
        selectivityScore: 0.66,
        scoreGap: -0.02,
        stressPenaltyScore: 0.02,
        aidPercent: null,
        netCost: null,
        reasons: ["名额紧张"],
        tips: ["等待候补更新"],
        decisionDrivers: { line: "主因：接近门槛", summary: ["学术 69", "活动 61"] },
        renewalPolicy: null,
        estimatedFourYearCost: null,
        batch: "rd",
        released: true,
        revealed: true,
        email: "admission@ucla.edu",
        emailNote: "",
      },
    ];
    applyStateSnapshot(window, snapshot);

    expect(window.document.getElementById("chooseOfferBtn").disabled).toBe(true);
    expect(window.document.getElementById("offerNote").textContent).toContain("先更新并查看完所有候补结果");

    const random = window.Math.random;
    window.Math.random = () => 0.99;
    window.resolveWaitlist();
    window.Math.random = random;

    expect(window.document.getElementById("chooseOfferBtn").disabled).toBe(true);
    expect(window.document.getElementById("offerNote").textContent).toContain("候补结果");

    const sealedCard = window.document.querySelector("#resultsList .result-card.sealed");
    expect(sealedCard).toBeTruthy();
    sealedCard.click();

    expect(window.document.getElementById("chooseOfferBtn").disabled).toBe(false);
    expect(window.document.getElementById("offerNote").textContent).toContain("可选择最终去向");
  });

  it("recommends jobs by selected major and supports multi-role companies", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.majorId = "cs_engineering";
    applyStateSnapshot(window, snapshot);

    const pool = window.getRecommendedJobPool(60);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((item) => window.getJobMajorFit(item) >= 0.8)).toBe(true);

    const companyRoles = new Map();
    pool.forEach((item) => {
      if (!companyRoles.has(item.name)) {
        companyRoles.set(item.name, new Set());
      }
      companyRoles.get(item.name).add(item.role);
    });
    const multiRoleCompanyCount = [...companyRoles.values()].filter((roles) => roles.size >= 2).length;
    expect(multiRoleCompanyCount).toBeGreaterThan(0);
  });

  it("keeps elite-school chance lower than mid-tier under same profile", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.majorId = "cs_engineering";
    snapshot.termIndex = 6;
    snapshot.difficultyId = "relaxed";
    snapshot.counselorId = "elite";
    snapshot.essayChoices = ["research"];
    snapshot.recChoice = "teacher";
    snapshot.feeWaiverChoice = "none";
    snapshot.stats.gpa = 4;
    snapshot.stats.test = 1600;
    snapshot.stats.english = 120;
    snapshot.stats.activities = 100;
    snapshot.stats.awards = 100;
    snapshot.stats.leadership = 100;
    snapshot.stats.essay = 100;
    snapshot.stats.essayTrack = 100;
    snapshot.stats.recStrength = 100;
    snapshot.stats.reputation = 100;
    snapshot.stats.stress = 20;
    applyStateSnapshot(window, snapshot);

    const eliteSchool = {
      id: "elite-mock",
      name: "Elite Mock",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 2,
      region: "US",
    };
    const midSchool = {
      id: "mid-mock",
      name: "Mid Mock",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 80,
      region: "US",
    };

    const eliteEval = window.evaluateApplication(eliteSchool, { preview: true, roundOverride: "rd" });
    const midEval = window.evaluateApplication(midSchool, { preview: true, roundOverride: "rd" });

    expect(eliteEval.chance).toBeLessThan(midEval.chance);
    expect(midEval.chance - eliteEval.chance).toBeGreaterThan(0.2);
  });

  it("uses realistic probability bands so stronger profiles see easier schools as match or safety", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.majorId = "cs_engineering";
    snapshot.termIndex = 6;
    snapshot.difficultyId = "relaxed";
    snapshot.counselorId = "elite";
    snapshot.essayChoices = ["research"];
    snapshot.recChoice = "teacher";
    snapshot.feeWaiverChoice = "none";
    snapshot.stats.gpa = 4;
    snapshot.stats.test = 1600;
    snapshot.stats.english = 120;
    snapshot.stats.activities = 100;
    snapshot.stats.awards = 100;
    snapshot.stats.leadership = 100;
    snapshot.stats.essay = 100;
    snapshot.stats.essayTrack = 100;
    snapshot.stats.recStrength = 100;
    snapshot.stats.reputation = 100;
    snapshot.stats.stress = 12;
    applyStateSnapshot(window, snapshot);

    const eliteSchool = {
      id: "elite-realistic",
      name: "Elite Realistic",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 3,
      region: "US",
    };
    const easierSchool = {
      id: "easier-realistic",
      name: "Easier Realistic",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 165,
      region: "US",
    };

    const eliteEval = window.evaluateApplication(eliteSchool, { preview: true, roundOverride: "rd" });
    const easierEval = window.evaluateApplication(easierSchool, { preview: true, roundOverride: "rd" });

    expect(eliteEval.chance).toBeLessThan(0.32);
    expect(easierEval.chance).toBeGreaterThan(0.58);
    expect(window.getSchoolTierByChance(0.78).label).toBe("保底");
    expect(window.getSchoolTierByChance(0.5).label).toBe("匹配");
    expect(window.getSchoolTierByChance(0.22).label).toBe("冲刺");
    expect(window.getSchoolTierByChance(easierEval.chance).label).not.toBe("冲刺");
  });

  it("reflects regional admission styles so Australia is steadier than Singapore for similar schools", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.majorId = "cs_engineering";
    snapshot.termIndex = 6;
    snapshot.difficultyId = "standard";
    snapshot.essayChoices = ["research"];
    snapshot.recChoice = "teacher";
    snapshot.feeWaiverChoice = "none";
    snapshot.stats.gpa = 3.88;
    snapshot.stats.test = 1510;
    snapshot.stats.english = 112;
    snapshot.stats.activities = 82;
    snapshot.stats.awards = 72;
    snapshot.stats.leadership = 70;
    snapshot.stats.essay = 80;
    snapshot.stats.essayTrack = 84;
    snapshot.stats.recStrength = 78;
    snapshot.stats.reputation = 68;
    snapshot.stats.stress = 24;
    applyStateSnapshot(window, snapshot);

    const sgSchool = {
      id: "sg-style",
      name: "SG Style",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 38,
      region: "SG",
    };
    const auSchool = {
      id: "au-style",
      name: "AU Style",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 38,
      region: "AU",
    };

    const sgEval = window.evaluateApplication(sgSchool, { preview: true, roundOverride: "rd" });
    const auEval = window.evaluateApplication(auSchool, { preview: true, roundOverride: "rd" });

    expect(auEval.chance).toBeGreaterThan(sgEval.chance);
    expect(auEval.chance - sgEval.chance).toBeGreaterThan(0.05);
  });

  it("reflects major competition so cs is harder than law at the same elite school", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const school = {
      id: "major-compare",
      name: "Major Compare University",
      type: "research",
      strengths: ["cs_engineering", "law"],
      qsRank: 14,
      region: "US",
    };

    const csSnapshot = getStateSnapshot(window);
    csSnapshot.majorId = "cs_engineering";
    csSnapshot.termIndex = 6;
    csSnapshot.difficultyId = "standard";
    csSnapshot.essayChoices = ["research"];
    csSnapshot.recChoice = "teacher";
    csSnapshot.feeWaiverChoice = "none";
    csSnapshot.stats.gpa = 3.96;
    csSnapshot.stats.test = 1550;
    csSnapshot.stats.english = 116;
    csSnapshot.stats.activities = 86;
    csSnapshot.stats.awards = 80;
    csSnapshot.stats.leadership = 78;
    csSnapshot.stats.essay = 88;
    csSnapshot.stats.essayTrack = 90;
    csSnapshot.stats.recStrength = 84;
    csSnapshot.stats.reputation = 74;
    csSnapshot.stats.stress = 18;
    applyStateSnapshot(window, csSnapshot);
    const csEval = window.evaluateApplication(school, { preview: true, roundOverride: "rd" });

    const lawSnapshot = getStateSnapshot(window);
    lawSnapshot.majorId = "law";
    lawSnapshot.essayChoices = ["impact"];
    applyStateSnapshot(window, lawSnapshot);
    const lawEval = window.evaluateApplication(school, { preview: true, roundOverride: "rd" });

    expect(lawEval.chance).toBeGreaterThan(csEval.chance);
    expect(lawEval.chance - csEval.chance).toBeGreaterThan(0.03);
  });

  it("blocks graduate enrollment before all graduate letters are opened", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.postGradPath = "masters";
    snapshot.gradApplicationType = "masters";
    snapshot.gradResults = [
      {
        id: "mit",
        name: "MIT",
        country: "United States",
        qsRank: 1,
        programType: "masters",
        chance: 0.62,
        status: "录取",
        revealed: false,
      },
      {
        id: "stanford",
        name: "Stanford",
        country: "United States",
        qsRank: 3,
        programType: "masters",
        chance: 0.42,
        status: "拒绝",
        revealed: false,
      },
    ];
    applyStateSnapshot(window, snapshot);

    window.chooseGraduateOffer("mit");
    const afterBlocked = getStateSnapshot(window);
    expect(afterBlocked.mastersStarted).toBe(false);
    expect(afterBlocked.selectedGradOfferId).toBeNull();

    window.revealNextGradResult();
    window.revealNextGradResult();
    window.chooseGraduateOffer("mit");
    const afterPass = getStateSnapshot(window);
    expect(afterPass.mastersStarted).toBe(true);
    expect(afterPass.selectedGradOfferId).toBe("mit");
  });

  it("supports undergrad side actions (AI, loan, part-time, skip)", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 1;
    snapshot.undergradProfile = { gpa: 3.4, research: 40, internship: 35, leadership: 30, stress: 48 };
    snapshot.cash = 5000;
    applyStateSnapshot(window, snapshot);

    window.handleHigherEdAiPlan("undergrad");
    const aiNote = window.document.getElementById("undergradAiNote").textContent;
    expect(aiNote.length).toBeGreaterThan(0);

    const beforeLoan = getStateSnapshot(window);
    window.applyHigherEdLoan("undergrad");
    const afterLoan = getStateSnapshot(window);
    expect(afterLoan.cash).toBeGreaterThan(beforeLoan.cash);

    const beforePartTime = getStateSnapshot(window);
    window.applyHigherEdPartTime("undergrad");
    const afterPartTime = getStateSnapshot(window);
    expect(afterPartTime.cash).toBeGreaterThan(beforePartTime.cash);

    window.skipUndergradTerm();
    const afterSkip = getStateSnapshot(window);
    expect(afterSkip.undergradCurrentYear).toBe(2);
  });

  it("can enter undergrad flow immediately after choosing final school in release stage", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.resultReleaseStage = "regular";
    snapshot.finalChoice = null;
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        region: "US",
        status: "录取",
        batch: "rd",
        released: true,
        revealed: true,
        fitScore: 0.82,
        academicScore: 0.8,
        holisticScore: 0.75,
        chance: 0.7,
      },
    ];
    applyStateSnapshot(window, snapshot);

    window.chooseOffer("harvard");
    const afterChoose = getStateSnapshot(window);
    expect(afterChoose.applicationStage).toBe("complete");
    expect(afterChoose.finalChoice).toBe("harvard");
    expect(window.getMainViewStage()).toBe("undergrad");

    window.startUndergradJourney();
    const afterStart = getStateSnapshot(window);
    expect(afterStart.undergradStarted).toBe(true);
    expect(afterStart.undergradCurrentYear).toBe(1);
  });

  it("blocks selecting the same school again in RD after an ED application", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 6;
    snapshot.applicationStage = "rd_apply";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        batch: "ed",
        roundChoice: "ed",
        status: "候补",
        released: true,
        revealed: true,
      },
    ];
    snapshot.selectedSchools = [];
    applyStateSnapshot(window, snapshot);

    window.toggleSchool("harvard");
    const after = getStateSnapshot(window);
    expect(after.selectedSchools).toEqual([]);
    expect(window.document.getElementById("appNotice").textContent).toContain("RD 不能重复申请");
    expect(window.document.getElementById("schoolList").textContent).toContain("已在 ED 提交，本轮 RD 不可重复申请");
  });

  it("shows ED waitlist update letters automatically during RD release", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.resultReleaseStage = "regular";
    snapshot.waitlistUpdated = false;
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        region: "US",
        batch: "ed",
        roundChoice: "ed",
        status: "候补",
        released: true,
        revealed: true,
        fitScore: 0.76,
        academicScore: 0.74,
        holisticScore: 0.72,
        chance: 0.48,
        structurePenaltyScore: 0,
      },
      {
        id: "mit",
        name: "Massachusetts Institute of Technology",
        country: "United States",
        region: "US",
        batch: "rd",
        roundChoice: "rd",
        status: "拒绝",
        released: true,
        revealed: true,
        fitScore: 0.62,
        academicScore: 0.7,
        holisticScore: 0.64,
        chance: 0.31,
        structurePenaltyScore: 0,
      },
    ];
    applyStateSnapshot(window, snapshot);

    const after = getStateSnapshot(window);
    const updatedHarvard = after.results.find((item) => item.id === "harvard");
    expect(["录取", "拒绝"]).toContain(updatedHarvard.status);
    expect(updatedHarvard.revealed).toBe(false);
    expect(updatedHarvard.waitlistRevealStage).toBe("rd_release");

    const scope = window.getStageResultScope();
    expect(scope.some((item) => item.id === "harvard")).toBe(true);
    expect(window.document.getElementById("resultsList").textContent).toContain("Harvard University");
  });

  it("creates per-company interviewer contacts and proactive messages", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.postGradPath = "job";
    snapshot.jobOutcome = {
      offerCount: 0,
      interviewRound: 1,
      applications: [
        {
          companyId: "google-swe",
          company: "Google",
          role: "Software Engineer",
          location: "Mountain View",
          difficulty: 0.62,
          difficultyLabel: "高",
          chance: 0.52,
          baseChance: 0.52,
          status: "面试中",
          salaryLow: 130000,
          salaryHigh: 190000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: true,
          interviewTranscript: [],
          revealed: true,
          interviewerInviteRound: 0,
          reason: "初筛通过",
        },
      ],
      offers: [],
      score: 0.7,
      universitySignal: 0.7,
      educationLabel: "本科毕业",
      majorName: "计算机科学/工程",
      chosenOfferCompanyId: null,
      chosenOfferCompany: null,
      chosenOfferRole: null,
      finalizedAt: 0,
    };
    snapshot.chatLog = [];
    applyStateSnapshot(window, snapshot);

    window.pushInterviewerProactiveMessages("job_submit");
    const after = getStateSnapshot(window);
    expect(after.chatLog.some((msg) => msg.targetRole === "interviewer-google-swe")).toBe(true);

    const roleOptions = Array.from(window.document.querySelectorAll("#chatRole option")).map((item) => item.value);
    expect(roleOptions).toContain("interviewer-google-swe");
  });

  it("supports choosing a final job offer", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.postGradPath = "job";
    snapshot.jobOutcome = {
      offerCount: 2,
      interviewRound: 1,
      applications: [
        {
          companyId: "google-swe",
          company: "Google",
          role: "Software Engineer",
          location: "Mountain View",
          difficulty: 0.62,
          difficultyLabel: "高",
          chance: 0.52,
          baseChance: 0.52,
          status: "录用",
          salaryLow: 180000,
          salaryHigh: 240000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: false,
          interviewTranscript: [{ round: 1, score: 85, chance: 0.61, passed: true, ts: Date.now() }],
          revealed: true,
          interviewerInviteRound: 1,
          reason: "面试通过",
        },
        {
          companyId: "meta-swe",
          company: "Meta",
          role: "Software Engineer",
          location: "Menlo Park",
          difficulty: 0.66,
          difficultyLabel: "高",
          chance: 0.49,
          baseChance: 0.49,
          status: "录用",
          salaryLow: 170000,
          salaryHigh: 230000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: false,
          interviewTranscript: [{ round: 1, score: 83, chance: 0.58, passed: true, ts: Date.now() }],
          revealed: true,
          interviewerInviteRound: 1,
          reason: "面试通过",
        },
      ],
      offers: [],
      score: 0.7,
      universitySignal: 0.7,
      educationLabel: "本科毕业",
      majorName: "计算机科学/工程",
      chosenOfferCompanyId: null,
      chosenOfferCompany: null,
      chosenOfferRole: null,
      finalizedAt: 0,
      bestOfferCompany: "Google",
      tier: "拿到正式 Offer",
    };
    applyStateSnapshot(window, snapshot);

    window.chooseFinalJobOffer("meta-swe");
    const after = getStateSnapshot(window);
    expect(after.jobOutcome.chosenOfferCompanyId).toBe("meta-swe");
    expect(after.jobOutcome.chosenOfferCompany).toBe("Meta");
    expect(after.jobOutcome.offers.some((line) => String(line).includes("最终工作去向"))).toBe(true);
  });

  it("applies built-in developer flow templates by _devApplyFlow", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const message = window.applyDevState(
      JSON.stringify({
        _devApplyFlow: "masters",
      }),
    );
    expect(message).toContain("硕士阶段");

    const after = getStateSnapshot(window);
    expect(after.devMode).toBe(true);
    expect(after.undergradGraduated).toBe(true);
    expect(after.mastersStarted).toBe(true);
    expect(after.mastersGraduated).toBe(false);
  });

  it("applies _devPatch overrides on top of flow template", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const message = window.applyDevState(
      JSON.stringify({
        _devApplyFlow: "career",
        _devPatch: {
          cash: 321000,
          jobOutcome: {
            chosenOfferCompanyId: "google-swe",
            chosenOfferCompany: "Google",
          },
        },
      }),
    );
    expect(message).toContain("_devPatch");

    const after = getStateSnapshot(window);
    expect(after.cash).toBe(321000);
    expect(after.jobOutcome.chosenOfferCompanyId).toBe("google-swe");
    expect(after.jobOutcome.chosenOfferCompany).toBe("Google");
    expect(after.jobOutcome.applications.length).toBeGreaterThan(0);
  });

  it("switches developer flow templates through quick buttons", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);

    const phdButton = window.document.querySelector('[data-dev-flow="phd"]');
    expect(phdButton).toBeTruthy();
    phdButton.click();

    const after = getStateSnapshot(window);
    expect(after.devMode).toBe(true);
    expect(after.phdStarted).toBe(true);
    expect(after.mastersGraduated).toBe(true);
  });

  it("shows admissions quick actions for BS-MS / BS-MS-PhD and can trigger them", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = false;
    snapshot.combinedDegreeEligible = true;
    snapshot.combinedDegreeApplied = false;
    snapshot.directPhdApplied = false;
    snapshot.directPhdApproved = false;
    snapshot.stats.awards = 98;
    snapshot.stats.activities = 94;
    snapshot.stats.essayTrack = 90;
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        code: "US",
        type: "research",
        strengths: ["law", "business_mgmt"],
        qsRank: 4,
        chance: 0.74,
        fitScore: 0.86,
        academicScore: 0.85,
        holisticScore: 0.8,
        selectivityScore: 0.66,
        scoreGap: 0.12,
        stressPenaltyScore: 0.01,
        status: "录取",
        roundChoice: "rd",
        aidPercent: 0.8,
        netCost: 12000,
        aidDelay: false,
        netCostFirstYear: 12000,
        aidFirstYear: 0.8,
        reasons: ["学术表现强", "专业匹配度高"],
        tips: [],
        decisionDrivers: {
          line: "主因：学术硬指标拉动；短板：无明显短板",
          summary: ["学术 85", "活动 80", "匹配 86", "门槛 66"],
        },
        structurePenaltyScore: 0,
        structureTierAtSubmit: "match",
        renewalPolicy: {
          requiredGpa: 3.25,
          requiredEngagement: 62,
          retentionChance: 0.82,
          expectedAidPercent: 0.8,
        },
        estimatedFourYearCost: 46000,
        batch: "rd",
        released: true,
        revealed: true,
        email: "admissions@harvard.edu",
        emailNote: "",
      },
    ];
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-harvard";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请本硕连读");
    expect(labels).toContain("申请本硕博连读");

    const firstActionBtn = window.document.querySelector("#chatActionPanel .chat-action-btn");
    expect(firstActionBtn).toBeTruthy();
    firstActionBtn.click();

    const after = getStateSnapshot(window);
    expect(after.chatLog.some((msg) => msg.role === "user" && String(msg.text).includes("申请本硕"))).toBe(true);
    expect(after.combinedDegreeApplied || after.directPhdApplied).toBe(true);
  });

  it("shows pre-enrollment combined-degree buttons for the final enrolled undergrad school regardless of profile strength", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        qsRank: 4,
        chance: 0.22,
        fitScore: 0.56,
        academicScore: 0.52,
        holisticScore: 0.48,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        released: true,
        revealed: true,
      },
    ];
    snapshot.undergradStarted = false;
    snapshot.undergradGraduated = false;
    snapshot.mastersStarted = false;
    snapshot.phdStarted = false;
    snapshot.combinedDegreeApplied = false;
    snapshot.combinedDegreeApproved = false;
    snapshot.directPhdApplied = false;
    snapshot.directPhdApproved = false;
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-harvard";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请本硕连读");
    expect(labels).toContain("申请本硕博连读");

    const undergradYearChoices = window.document.getElementById("undergradYearChoices").textContent;
    expect(undergradYearChoices).toContain("已解锁连读申请");
  });

  it("shows admissions quick action for MS-PhD and can trigger it", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.undergradProfile = { gpa: 3.88, research: 90, internship: 78, leadership: 70, stress: 30 };
    snapshot.postGradPath = "masters";
    snapshot.gradApplicationType = "masters";
    snapshot.gradProgramMode = "masters";
    snapshot.gradSelectedSchools = ["cambridge"];
    snapshot.gradResults = [
      {
        id: "cambridge",
        name: "University of Cambridge",
        country: "United Kingdom",
        qsRank: 6,
        programType: "masters",
        chance: 0.53,
        status: "录取",
        revealed: true,
      },
    ];
    snapshot.msPhdApplied = false;
    snapshot.msPhdApproved = false;
    snapshot.msPhdSchoolId = null;
    applyStateSnapshot(window, snapshot);

    const roleOptions = Array.from(window.document.querySelectorAll("#chatRole option")).map((item) => item.value);
    expect(roleOptions).toContain("admissions-cambridge");

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-cambridge";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请硕博连读");

    const msPhdBtn = Array.from(window.document.querySelectorAll("#chatActionPanel .chat-action-btn")).find((btn) =>
      String(btn.textContent).includes("申请硕博连读"),
    );
    expect(msPhdBtn).toBeTruthy();
    msPhdBtn.click();

    const after = getStateSnapshot(window);
    expect(after.chatLog.some((msg) => msg.role === "user" && String(msg.text).includes("申请硕博连读"))).toBe(true);
    expect(after.msPhdApplied).toBe(true);
  });

  it("supports BS-MS / BS-MS-PhD applications during the final two undergrad semesters and confirms direct masters start after approval", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 7;
    snapshot.undergradProfile = { gpa: 3.9, research: 92, internship: 70, leadership: 68, stress: 30 };
    snapshot.combinedDegreeApplied = false;
    snapshot.combinedDegreeApproved = false;
    snapshot.combinedDegreeSchoolId = "harvard";
    snapshot.directPhdApplied = false;
    snapshot.directPhdApproved = false;
    snapshot.directPhdSchoolId = null;
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        code: "US",
        type: "research",
        strengths: ["law", "business_mgmt"],
        qsRank: 4,
        chance: 0.76,
        fitScore: 0.86,
        academicScore: 0.84,
        holisticScore: 0.8,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        released: true,
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-harvard";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请本硕连读");
    expect(labels).toContain("申请本硕博连读");

    const bsmsBtn = Array.from(window.document.querySelectorAll("#chatActionPanel .chat-action-btn")).find((btn) =>
      String(btn.textContent).includes("申请本硕连读"),
    );
    expect(bsmsBtn).toBeTruthy();
    const originalRandom = window.Math.random;
    window.Math.random = () => 0;
    try {
      bsmsBtn.click();
    } finally {
      window.Math.random = originalRandom;
    }

    const afterApply = getStateSnapshot(window);
    expect(afterApply.combinedDegreeApplied).toBe(true);
    expect(afterApply.combinedDegreeApproved).toBe(true);
    expect(afterApply.combinedDegreeSchoolId).toBe("harvard");

    afterApply.undergradGraduated = true;
    afterApply.undergradCurrentYear = 8;
    applyStateSnapshot(window, afterApply);

    window.choosePostGradPath("masters");
    const decisionTitle = window.document.getElementById("decisionTitle");
    expect(String(decisionTitle?.textContent || "")).toContain("本硕连读");
    const directBtn = Array.from(window.document.querySelectorAll("#decisionOptions .choice")).find((btn) =>
      String(btn.textContent).includes("直接入读硕士"),
    );
    expect(directBtn).toBeTruthy();
    directBtn.click();
    const afterPath = getStateSnapshot(window);
    expect(afterPath.mastersStarted).toBe(true);
    expect(afterPath.mastersSchoolId).toBe("harvard");
    expect(afterPath.gradResults.length).toBe(0);
  });

  it("automatically announces combined-degree results at the next semester boundary", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 7;
    snapshot.undergradProfile = { gpa: 3.92, research: 94, internship: 70, leadership: 68, stress: 24 };
    snapshot.combinedDegreeSchoolId = "harvard";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        qsRank: 4,
        chance: 0.76,
        fitScore: 0.86,
        academicScore: 0.84,
        holisticScore: 0.8,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        released: true,
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-harvard";
    chatRole.dispatchEvent(new window.Event("change"));
    const bsmsBtn = Array.from(window.document.querySelectorAll("#chatActionPanel .chat-action-btn")).find((btn) =>
      String(btn.textContent).includes("申请本硕连读"),
    );
    const originalRandom = window.Math.random;
    window.Math.random = () => 0;
    try {
      bsmsBtn.click();
    } finally {
      window.Math.random = originalRandom;
    }

    let afterApply = getStateSnapshot(window);
    expect(afterApply.combinedDegreeApproved).toBe(true);
    expect(afterApply.pendingCombinedAnnouncements.length).toBe(1);

    window.skipUndergradTerm();
    afterApply = getStateSnapshot(window);
    expect(afterApply.pendingCombinedAnnouncements.length).toBe(0);
    expect(afterApply.chatLog.some((msg) => String(msg.text).includes("已自动公布连读结果"))).toBe(true);
  });

  it("allows switching to job path instead of being forced into a combined masters track", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.undergradCurrentYear = 8;
    snapshot.undergradProfile = { gpa: 3.9, research: 92, internship: 70, leadership: 68, stress: 30 };
    snapshot.combinedDegreeApplied = true;
    snapshot.combinedDegreeApproved = true;
    snapshot.combinedDegreeSchoolId = "harvard";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        code: "US",
        type: "research",
        strengths: ["law", "business_mgmt"],
        qsRank: 4,
        chance: 0.76,
        fitScore: 0.86,
        academicScore: 0.84,
        holisticScore: 0.8,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        released: true,
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);

    window.choosePostGradPath("masters");
    const jobBtn = Array.from(window.document.querySelectorAll("#decisionOptions .choice")).find((btn) =>
      String(btn.textContent).includes("直接找工作"),
    );
    expect(jobBtn).toBeTruthy();
    jobBtn.click();

    const afterPath = getStateSnapshot(window);
    expect(afterPath.postGradPath).toBe("job");
    expect(afterPath.mastersStarted).toBe(false);
    expect(afterPath.combinedDegreeApproved).toBe(true);
  });

  it("hides BS-MS / BS-MS-PhD actions during middle undergrad semesters", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 5;
    snapshot.undergradProfile = { gpa: 3.9, research: 92, internship: 70, leadership: 68, stress: 30 };
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        qsRank: 4,
        chance: 0.76,
        fitScore: 0.86,
        academicScore: 0.84,
        holisticScore: 0.8,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        released: true,
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-harvard";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).not.toContain("申请本硕连读");
    expect(labels).not.toContain("申请本硕博连读");
  });

  it("shows MS-PhD actions during the first or final two masters semesters once masters has started", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.postGradPath = "masters";
    snapshot.gradApplicationType = "masters";
    snapshot.gradProgramMode = "masters";
    snapshot.mastersStarted = true;
    snapshot.mastersGraduated = false;
    snapshot.mastersCurrentYear = 2;
    snapshot.mastersSchoolId = "cambridge";
    snapshot.mastersSchoolName = "University of Cambridge";
    snapshot.mastersProfile = { gpa: 3.82, research: 86, internship: 64, leadership: 56, stress: 28, thesis: 62 };
    snapshot.gradResults = [];
    snapshot.msPhdApplied = false;
    snapshot.msPhdApproved = false;
    snapshot.msPhdSchoolId = null;
    snapshot.msPhdLastWindow = null;
    applyStateSnapshot(window, snapshot);

    let chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-cambridge";
    chatRole.dispatchEvent(new window.Event("change"));
    let labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).not.toContain("申请硕博连读");

    const lateMasters = getStateSnapshot(window);
    lateMasters.mastersCurrentYear = 3;
    applyStateSnapshot(window, lateMasters);

    chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-cambridge";
    chatRole.dispatchEvent(new window.Event("change"));
    labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请硕博连读");
  });

  it("keeps MS-PhD action visible during the first masters semester after immediate enrollment", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.postGradPath = "masters";
    snapshot.gradApplicationType = "masters";
    snapshot.gradProgramMode = "masters";
    snapshot.mastersStarted = true;
    snapshot.mastersGraduated = false;
    snapshot.mastersCurrentYear = 1;
    snapshot.mastersSchoolId = "cambridge";
    snapshot.mastersSchoolName = "University of Cambridge";
    snapshot.mastersProfile = { gpa: 3.55, research: 58, internship: 52, leadership: 48, stress: 26, thesis: 28 };
    snapshot.gradResults = [
      {
        id: "cambridge",
        name: "University of Cambridge",
        country: "United Kingdom",
        qsRank: 6,
        programType: "masters",
        chance: 0.27,
        status: "录取",
        revealed: true,
        majorId: snapshot.majorId,
      },
    ];
    snapshot.selectedGradOfferId = "cambridge";
    snapshot.msPhdApplied = false;
    snapshot.msPhdApproved = false;
    snapshot.msPhdSchoolId = null;
    snapshot.msPhdLastWindow = null;
    applyStateSnapshot(window, snapshot);

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "admissions-cambridge";
    chatRole.dispatchEvent(new window.Event("change"));

    const labels = Array.from(
      window.document.querySelectorAll("#chatActionPanel .chat-action-btn strong"),
    ).map((item) => item.textContent.trim());
    expect(labels).toContain("申请硕博连读");
  });

  it("blocks submitApplications when main stage is not application", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.results = [];
    snapshot.selectedSchools = ["harvard", "mit", "stanford"];
    applyStateSnapshot(window, snapshot);

    window.submitApplications();
    const after = getStateSnapshot(window);
    expect(after.results.length).toBe(0);
    expect(window.document.getElementById("appNotice").textContent).toContain("当前阶段不可执行");
  });

  it("runs balance calibration and records recommended tuning", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        qsRank: 4,
        status: "录取",
        roundChoice: "rd",
        batch: "rd",
        chance: 0.62,
        fitScore: 0.8,
        academicScore: 0.78,
        holisticScore: 0.75,
        selectivityScore: 0.68,
        scoreGap: 0.1,
        stressPenaltyScore: 0.01,
        revealed: true,
      },
    ];
    snapshot.selectedSchools = ["harvard", "mit", "stanford", "cambridge"];
    applyStateSnapshot(window, snapshot);

    window.runBalanceCalibration();
    const after = getStateSnapshot(window);
    expect(after.balanceCalibration).toBeTruthy();
    expect(after.balanceCalibration.recommendedTuning).toBeTruthy();
    expect(typeof after.balanceCalibration.recommendedTuning.chanceShift).toBe("number");
    expect(typeof after.balanceCalibration.recommendedTuning.waitlistShift).toBe("number");
    expect(typeof after.balanceCalibration.recommendedTuning.selectivityShift).toBe("number");
    expect(typeof after.balanceCalibration.recommendedTuning.elitePenaltyShift).toBe("number");
    if (after.balanceCalibration.autoApplied) {
      expect(after.dynamicBalanceTuning).toEqual(after.balanceCalibration.recommendedTuning);
    }
    expect(window.document.getElementById("balanceCalibrateNote").textContent).toContain("校准完成");
  });

  it("prefers due chained incidents from queue", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 4;
    snapshot.incidentChainQueue = [{ id: "policy-tighten", dueTerm: 4, source: "visa-delay" }];
    applyStateSnapshot(window, snapshot);

    const incident = window.rollIncident();
    expect(incident).toBeTruthy();
    expect(incident.id).toBe("policy-tighten");
    expect(incident.chainSource).toBe("visa-delay");

    const after = getStateSnapshot(window);
    expect(after.incidentChainQueue.length).toBe(0);
  });

  it("exports professional final report sections", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.exportSummary();
    const report = window.document.getElementById("exportText").textContent;
    expect(report).toContain("【基础档案】");
    expect(report).toContain("【申请结果】");
    expect(report).toContain("【阶段成长】");
    expect(report).toContain("【风险复盘】");
    expect(report).toContain("【关键时间线】");
  });

  it("updates role memory card after chat turns", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "我预算比较紧，想要平衡选校并控制压力";
    send.click();

    const after = getStateSnapshot(window);
    expect(after.chatRoleCards).toBeTruthy();
    expect(after.chatRoleCards.counselor).toBeTruthy();
    expect(Number(after.chatRoleCards.counselor.turns || 0)).toBeGreaterThan(0);
    expect(window.document.getElementById("chatRoleCardSummary").textContent.length).toBeGreaterThan(0);
  });

  it("shows teacher role in chat contacts", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);
    const roleOptions = Array.from(window.document.querySelectorAll("#chatRole option")).map((item) => item.value);
    expect(roleOptions).toContain("teacher");
  });

  it("hides client AI config in public release and sanitizes stored settings", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    expect(window.document.getElementById("chatAiConfigControls").classList.contains("hidden")).toBe(true);
    expect(window.document.getElementById("chatAiPublicNote").classList.contains("hidden")).toBe(false);

    const mode = window.document.getElementById("chatAiMode");
    const model = window.document.getElementById("chatAiModel");
    const baseUrl = window.document.getElementById("chatAiBaseUrl");
    const apiKey = window.document.getElementById("chatAiKey");

    mode.value = "offline";
    mode.dispatchEvent(new window.Event("change"));
    model.value = "mimo-2";
    model.dispatchEvent(new window.Event("change"));
    baseUrl.value = "https://example.com/v1";
    baseUrl.dispatchEvent(new window.Event("change"));
    apiKey.value = "tp-test-key";
    apiKey.dispatchEvent(new window.Event("change"));

    const raw = window.localStorage.getItem("college-sim-chat-ai-settings-v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.mode).toBe("mimo");
    expect(parsed.model).toBe("mimo-v2.5");
    expect(parsed.baseUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1");
    expect(parsed.apiKey).toBe("");
  });

  it("supports built-in AI in static-file mode without requiring user input", async () => {
    const dom = bootstrap("file:///Users/yuanbo/Documents/college-sim/index.html");
    const { window } = dom;
    startBasicGame(window);

    const calls = [];
    window.fetch = (url, options = {}) => {
      calls.push({ url: String(url), options });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "静态文件模式 AI 回复" } }],
        }),
      });
    };

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "帮我看一下这学期安排";
    send.click();
    await waitForTick();
    await waitForTick();

    const banner = window.document.getElementById("fileModeBanner");
    expect(banner.classList.contains("hidden")).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toBe("https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
    const latestAi = [...getStateSnapshot(window).chatLog].reverse().find((msg) => msg.role === "ai");
    expect(String(latestAi?.text || "")).toContain("静态文件模式 AI 回复");
  });

  it("reveals temporary AI config in developer mode and uses the user's own key without persisting it", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);

    expect(window.document.getElementById("chatAiConfigControls").classList.contains("hidden")).toBe(false);
    expect(window.document.getElementById("chatAiPublicNote").textContent).toContain("你自己的 API Key");

    const mode = window.document.getElementById("chatAiMode");
    const model = window.document.getElementById("chatAiModel");
    const baseUrl = window.document.getElementById("chatAiBaseUrl");
    const apiKey = window.document.getElementById("chatAiKey");
    expect(apiKey.value).toBe("");

    mode.value = "mimo";
    mode.dispatchEvent(new window.Event("change"));
    model.value = "mimo-dev-user";
    model.dispatchEvent(new window.Event("change"));
    baseUrl.value = "https://dev-user.example/v1";
    baseUrl.dispatchEvent(new window.Event("change"));
    apiKey.value = "tp-user-own-key";
    apiKey.dispatchEvent(new window.Event("change"));

    const raw = window.localStorage.getItem("college-sim-chat-ai-settings-v1");
    const parsed = JSON.parse(String(raw || "{}"));
    expect(parsed.apiKey).toBe("");
    expect(parsed.model).toBe("mimo-dev-user");
    expect(parsed.baseUrl).toBe("https://dev-user.example/v1");

    const calls = [];
    window.fetch = (url, options = {}) => {
      calls.push({ url: String(url), options });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "开发者模式 AI 回复" } }],
        }),
      });
    };

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "帮我看看这学期要做什么";
    send.click();
    await waitForTick();
    await waitForTick();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].url).toBe("https://dev-user.example/v1/chat/completions");
    expect(String(calls[0].options?.headers?.Authorization || "")).toBe("Bearer tp-user-own-key");
  });

  it("falls back to the built-in API when developer mode leaves the API field blank", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);

    const apiKey = window.document.getElementById("chatAiKey");
    expect(apiKey.value).toBe("");
    expect(window.document.getElementById("chatAiStatus").textContent).toContain("将自动使用内置 API");

    const calls = [];
    window.fetch = (url, options = {}) => {
      calls.push({ url: String(url), options });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "开发者空 Key 也能走内置 AI" } }],
        }),
      });
    };

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "帮我看一下本学期安排";
    send.click();
    await waitForTick();
    await waitForTick();

    expect(calls.length).toBeGreaterThan(0);
    expect(String(calls[0].options?.headers?.Authorization || "")).toMatch(/^Bearer tp-/);
  });

  it("falls back to offline reply when MiMo request fails", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.fetch = () => Promise.reject(new Error("network down"));
    const mode = window.document.getElementById("chatAiMode");
    mode.value = "mimo";
    mode.dispatchEvent(new window.Event("change"));

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "你好，帮我看一下本学期安排";
    send.click();
    await waitForTick();
    await waitForTick();

    const state = getStateSnapshot(window);
    const aiMsgs = state.chatLog.filter((msg) => msg.role === "ai" && msg.targetRole === "counselor");
    expect(aiMsgs.length).toBeGreaterThan(0);
    expect(window.document.getElementById("chatAiStatus").textContent).toContain("自动切换离线");
  });

  it("uses MiMo path for interviewer role when enabled", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.postGradPath = "job";
    snapshot.jobOutcome = {
      offerCount: 0,
      interviewRound: 1,
      applications: [
        {
          companyId: "google",
          company: "Google",
          role: "Software Engineer",
          location: "Mountain View",
          difficulty: 0.62,
          difficultyLabel: "高",
          chance: 0.52,
          baseChance: 0.52,
          status: "面试中",
          salaryLow: 130000,
          salaryHigh: 190000,
          majorFit: 1,
          interviewRound: 1,
          chatInterviewPending: true,
          interviewTranscript: [],
          reason: "初筛通过",
        },
      ],
      offers: [],
      score: 0.7,
      universitySignal: 0.7,
      educationLabel: "本科毕业",
      majorName: "计算机科学/工程",
    };
    applyStateSnapshot(window, snapshot);

    window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ reply: "AI 面试官回复（重写）" }),
      });
    const mode = window.document.getElementById("chatAiMode");
    mode.value = "mimo";
    mode.dispatchEvent(new window.Event("change"));

    const chatRole = window.document.getElementById("chatRole");
    chatRole.value = "interviewer-google";
    chatRole.dispatchEvent(new window.Event("change"));
    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "开始面试";
    send.click();
    await waitForTick();
    await waitForTick();

    const state = getStateSnapshot(window);
    const latestAi = [...state.chatLog].reverse().find((msg) => msg.role === "ai" && msg.targetRole === "interviewer-google");
    expect(latestAi).toBeTruthy();
    expect(String(latestAi.text)).toContain("AI 面试官回复（重写）");
    expect(window.document.getElementById("chatAiStatus").textContent).toContain("已响应");
  });

  it("does not send max_tokens in normal MiMo chat requests", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const bodies = [];
    window.fetch = (_url, options = {}) => {
      bodies.push(JSON.parse(String(options.body || "{}")));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "AI 正常正文" } }],
        }),
      });
    };
    const mode = window.document.getElementById("chatAiMode");
    mode.value = "mimo";
    mode.dispatchEvent(new window.Event("change"));

    const input = window.document.getElementById("chatInput");
    const send = window.document.getElementById("chatSend");
    input.value = "结合我的情况给我详细建议";
    send.click();
    await waitForTick();
    await waitForTick();

    expect(bodies.length).toBeGreaterThan(0);
    expect("max_tokens" in bodies[0]).toBe(false);
    expect("apiKey" in bodies[0]).toBe(false);
  });

  it("auto-locks a custom AI project in high school into the current term", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "社区法律素养播客",
                  desc: "邀请老师与律师做案例讨论，并输出面向高中生的短音频内容。",
                  time: 2,
                  cost: 1800,
                  tags: ["法律", "写作", "公益"],
                  isLongTerm: true,
                  track: "impact-project",
                  effects: { leadership: 5, essayTrack: 4, reputation: 3, stress: 2 },
                  reason: "有稳定输出和真实组织成本，适合作为持续项目。",
                }),
              },
            },
          ],
        }),
      });

    window.openCustomProjectDialog("highschool");
    window.document.getElementById("customProjectIdea").value = "我想做一个面向高中生的法律素养播客。";
    await window.generateCustomProjectEstimate();

    const after = getStateSnapshot(window);
    const customEvent = after.currentEvents.find((item) => item.aiCustom);
    expect(customEvent).toBeTruthy();
    expect(customEvent.title).toBe("社区法律素养播客");
    expect(after.selectedEventIds).toContain(customEvent.id);
    expect(after.customProjectUsedThisTerm).toBe(true);
    expect(window.document.getElementById("customProjectNote").textContent).toContain("已自动加入本学期");
  });

  it("can generate a custom AI project during undergrad with stage-specific effects", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 1;
    snapshot.undergradProfile = { gpa: 3.5, research: 36, internship: 28, leadership: 22, stress: 40 };
    applyStateSnapshot(window, snapshot);

    window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "校园产品验证实验",
                  desc: "围绕一个真实学生需求做小规模产品调研、原型和验证。",
                  time: 3,
                  cost: 2600,
                  tags: ["数据", "创业", "领导力"],
                  isLongTerm: false,
                  track: "",
                  effects: { research: 5, internship: 6, leadership: 4, stress: 3 },
                  reason: "更偏短期冲刺型项目，能同时提升求职与实践。",
                }),
              },
            },
          ],
        }),
      });

    window.openCustomProjectDialog("undergrad");
    window.document.getElementById("customProjectIdea").value = "我想做一个服务校园生活的产品验证项目。";
    await window.generateCustomProjectEstimate();

    const after = getStateSnapshot(window);
    const termState = after.higherEdTermState.undergrad;
    const customEvent = (termState.currentEvents || []).find((item) => item.aiCustom);
    expect(customEvent).toBeTruthy();
    expect(customEvent.effects.internship).toBe(6);
    expect(termState.selectedEventIds).toContain(customEvent.id);
    expect(termState.customProjectUsed).toBe(true);
  });

  it("falls back to a rule-based custom project draft when AI returns malformed content", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "这个想法不错，我建议你做一个长期项目，重点提升表达和影响力。",
              },
            },
          ],
        }),
      });

    window.openCustomProjectDialog("highschool");
    window.document.getElementById("customProjectIdea").value = "我想做一个长期播客项目，讨论校园法律与公共议题。";
    await window.generateCustomProjectEstimate();

    const note = window.document.getElementById("customProjectNote").textContent;
    expect(note).toContain("已按规则估算并自动加入本学期");
    expect(window.document.getElementById("customProjectPreview").classList.contains("hidden")).toBe(false);

    const after = getStateSnapshot(window);
    const customEvent = after.currentEvents.find((item) => item.aiCustom);
    expect(customEvent).toBeTruthy();
    expect(customEvent.projectId).toBeTruthy();
  });

  it("requests json_object mode for custom AI project estimation", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const seenBodies = [];
    window.fetch = (_url, options = {}) => {
      seenBodies.push(JSON.parse(String(options.body || "{}")));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "法律播客计划",
                  desc: "持续输出法律案例讨论。",
                  time: 2,
                  cost: 1000,
                  tags: ["法律", "写作"],
                  isLongTerm: true,
                  track: "impact-project",
                  effects: { leadership: 4, essayTrack: 4, reputation: 3, stress: 2 },
                  reason: "兼顾输出、组织和申请叙事。",
                }),
              },
            },
          ],
        }),
      });
    };

    window.openCustomProjectDialog("highschool");
    window.document.getElementById("customProjectIdea").value = "我想做一个法律播客。";
    await window.generateCustomProjectEstimate();

    expect(seenBodies.length).toBeGreaterThan(0);
    expect(seenBodies[0].response_format).toEqual({ type: "json_object" });
  });

  it("prevents rerolling another custom project within the same term", async () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.fetch = () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "校园科技公号",
                  desc: "持续发布实验拆解与校园科技观察。",
                  time: 2,
                  cost: 900,
                  tags: ["科研", "写作"],
                  isLongTerm: true,
                  track: "research-track",
                  effects: { research: 4, essayTrack: 3, stress: 2 },
                  reason: "适合做成连续输出型项目。",
                }),
              },
            },
          ],
        }),
      });

    window.openCustomProjectDialog("highschool");
    window.document.getElementById("customProjectIdea").value = "我想做一个校园科技观察公号。";
    await window.generateCustomProjectEstimate();

    const launcherButton = Array.from(window.document.querySelectorAll("#eventCards .event-card button")).find((button) =>
      button.textContent.includes("本学期已使用"),
    );
    expect(launcherButton).toBeTruthy();
    expect(launcherButton.disabled).toBe(true);

    expect(window.document.getElementById("generateCustomProjectBtn").disabled).toBe(true);
    window.openCustomProjectDialog("highschool");
    expect(window.document.getElementById("eventNotice").textContent).toContain("本学期已锁定 AI 自定义项目");
  });

  it("injects full user snapshot into AI prompt context", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.currentEvents = [
      { id: "custom-event-1", title: "科研项目推进", effects: { time: 2 } },
      { id: "custom-event-2", title: "公益活动组织", effects: { time: 1 } },
    ];
    snapshot.selectedEventIds = ["custom-event-1"];
    snapshot.selectedMiniIds = ["mock-essay"];
    snapshot.undergradHistory = [{ term: 1, actionName: "核心课程夯实" }];
    snapshot.mastersHistory = [{ term: 1, actionName: "论文选题与综述" }];
    snapshot.phdHistory = [{ term: 1, actionName: "开题与问题定义" }];
    applyStateSnapshot(window, snapshot);

    const messages = window.buildMimoChatMessages("counselor", "我这学期怎么办", "离线回复");
    const prompt = String(messages[messages.length - 1].content || "");
    expect(prompt).toContain("用户档案JSON");
    expect(prompt).toContain("科研项目推进");
    expect(prompt).toContain("文书片段打磨");
    expect(prompt).toContain("核心课程夯实");
  });

  it("separates graduate application UI from masters study UI", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.postGradPath = "masters";
    snapshot.mastersStarted = true;
    snapshot.mastersGraduated = false;
    snapshot.mastersCurrentYear = 2;
    snapshot.mastersSchoolId = "cambridge";
    snapshot.mastersSchoolName = "University of Cambridge";
    applyStateSnapshot(window, snapshot);

    expect(window.getMainViewStage()).toBe("masters");
    expect(window.document.getElementById("gradArea").classList.contains("hidden")).toBe(true);
    expect(window.document.getElementById("mastersArea").classList.contains("hidden")).toBe(false);
    expect(window.document.getElementById("mastersPanel").classList.contains("hidden")).toBe(false);
  });

  it("separates phd study UI from graduate application UI", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.mastersStarted = true;
    snapshot.mastersGraduated = true;
    snapshot.phdStarted = true;
    snapshot.phdGraduated = false;
    snapshot.phdCurrentYear = 3;
    snapshot.phdSchoolId = "mit";
    snapshot.phdSchoolName = "Massachusetts Institute of Technology";
    snapshot.postGradPath = "phd";
    applyStateSnapshot(window, snapshot);

    expect(window.getMainViewStage()).toBe("phd");
    expect(window.document.getElementById("gradArea").classList.contains("hidden")).toBe(true);
    expect(window.document.getElementById("phdArea").classList.contains("hidden")).toBe(false);
    expect(window.document.getElementById("phdPanel").classList.contains("hidden")).toBe(false);
  });

  it("forces an academic repeat year when undergrad graduation performance is too poor", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = false;
    snapshot.undergradCurrentYear = 8;
    snapshot.cash = 9000;
    snapshot.loanBalance = 0;
    snapshot.undergradProfile = { gpa: 1.9, research: 12, internship: 10, leadership: 18, stress: 96 };
    snapshot.results = [
      {
        id: "harvard",
        name: "Harvard University",
        country: "United States",
        qsRank: 4,
        status: "录取",
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);

    window.skipUndergradTerm();
    const after = getStateSnapshot(window);
    expect(after.undergradGraduated).toBe(false);
    expect(after.undergradCurrentYear).toBe(7);
    expect(after.academicRepeatCounts.undergrad).toBe(1);
    expect(after.loanBalance).toBeGreaterThan(0);
    expect(after.log.some((line) => String(line).includes("学业审核未过"))).toBe(true);
  });

  it("supports waiting another year in the career stage after zero offers", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "harvard";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.undergradCurrentYear = 8;
    snapshot.postGradPath = "job";
    snapshot.cash = 5000;
    snapshot.loanBalance = 0;
    snapshot.jobOutcome = {
      applications: [
        {
          companyId: "google",
          company: "Google",
          role: "Software Engineer",
          status: "拒绝",
          revealed: true,
          hiringStage: "终面",
          chance: 0.3,
        },
      ],
      offers: ["Google · Software Engineer · 拒绝"],
      interviewCount: 0,
      offerCount: 0,
    };
    applyStateSnapshot(window, snapshot);

    window.takeStageRepeatYear("career");
    const after = getStateSnapshot(window);
    expect(after.undergradGraduated).toBe(true);
    expect(after.postGradPath).toBe("job");
    expect(after.jobOutcome).toBe(null);
    expect(after.cash).toBe(0);
    expect(after.loanBalance).toBeGreaterThan(0);
    expect(after.stageRepeatCounts.career).toBe(1);
  });

  it("applies dev tuning only when developer mode is enabled", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.document.getElementById("devTuneChance").value = "0.05";
    window.document.getElementById("devTuneWaitlist").value = "0.03";
    window.applyDevTuneFromInputs();
    let after = getStateSnapshot(window);
    expect(Number(after.dynamicBalanceTuning.chanceShift || 0)).toBe(0);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);
    window.document.getElementById("devTuneChance").value = "0.05";
    window.document.getElementById("devTuneWaitlist").value = "0.03";
    window.document.getElementById("devTuneSelectivity").value = "-0.02";
    window.document.getElementById("devTuneElite").value = "0.01";
    window.applyDevTuneFromInputs();
    after = getStateSnapshot(window);
    expect(Number(after.dynamicBalanceTuning.chanceShift || 0)).toBeCloseTo(0.05, 4);
    expect(Number(after.dynamicBalanceTuning.waitlistShift || 0)).toBeCloseTo(0.03, 4);
  });

  it("applies dev data patch for interview question bank", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);

    const patch = {
      interviewQuestions: [
        {
          id: "test-interview-question",
          type: "case",
          tags: ["business", "general"],
          promptText: "请说明你如何提升{{company}}的{{role}}效率。",
          keywords: ["效率", "数据", "方案", "结果"],
          dimensions: { structure: 0.3, relevance: 0.4, evidence: 0.2, clarity: 0.1 },
        },
      ],
    };
    window.document.getElementById("devDataTextarea").value = JSON.stringify(patch);
    window.applyDevDataPatchFromTextarea();

    const note = window.document.getElementById("devDataNote").textContent;
    expect(note).toContain("面试题库");
    const probe = window.pickInterviewQuestionForApp(
      { companyId: "demo-company-analyst", company: "Demo Labs", role: "Data Analyst", interviewRound: 1 },
      0,
    );
    expect(probe).toBeTruthy();
    expect(typeof probe.prompt).toBe("function");
  });

  it("supports developer data patches for undergrad, masters, and phd content pools", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.devMode = true;
    applyStateSnapshot(window, snapshot);

    const patch = {
      undergradExtraActions: [
        {
          id: "test-ug-extra",
          name: "测试本科终极项目",
          desc: "用于验证开发者模式后期内容补丁",
          projectId: "research",
          effects: { gpa: 0.08, research: 12, internship: 4, leadership: 3, stress: 5, cost: 6800 },
        },
      ],
      mastersTermActions: {
        1: [
          {
            id: "test-ms-term",
            name: "测试硕士学期项目",
            desc: "用于验证硕士学期池覆盖",
            effects: { gpa: 0.06, research: 9, internship: 2, leadership: 2, stress: 3, cost: 3000, thesis: 4 },
          },
        ],
      },
      phdIncidents: [
        {
          id: "test-phd-incident",
          type: "惊喜",
          title: "测试博士事件",
          desc: "用于验证博士事件池补丁",
          chance: 0.08,
          minTerm: 1,
          options: [{ label: "接受", effects: { publication: 2, research: 1 } }],
        },
      ],
    };
    window.document.getElementById("devDataTextarea").value = JSON.stringify(patch);
    window.applyDevDataPatchFromTextarea();

    const note = window.document.getElementById("devDataNote").textContent;
    expect(note).toContain("本科扩展项目");
    expect(note).toContain("硕士学期项目");
    expect(note).toContain("博士意外事件");

    const dataSnapshot = window.buildDevDataSnapshot();
    expect(dataSnapshot.undergradExtraActions.some((item) => item.id === "test-ug-extra")).toBe(true);
    expect(dataSnapshot.mastersTermActions["1"].some((item) => item.id === "test-ms-term")).toBe(true);
    expect(dataSnapshot.phdIncidents.some((item) => item.id === "test-phd-incident")).toBe(true);
  });

  it("shows causal chain entry in letter dialog", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    window.openLetter({
      id: "harvard",
      name: "Harvard University",
      email: "admissions@harvard.edu",
      emailNote: "",
      status: "录取",
      roundChoice: "rd",
      aidPercent: 0.9,
      netCost: 3000,
      fitScore: 0.82,
      academicScore: 0.79,
      holisticScore: 0.74,
      selectivityScore: 0.68,
      scoreGap: 0.11,
      stressPenaltyScore: 0.01,
      reasons: ["学术表现强", "专业匹配度高"],
      decisionDrivers: { line: "主因：学术硬指标拉动", summary: ["学术 79"] },
      explainability: { line: "解释：综合分高于门槛。", breakdown: ["学术 79", "匹配 82"] },
      tips: [],
      revealed: true,
    });

    const letterButtons = Array.from(window.document.querySelectorAll("#letterBody button"));
    expect(letterButtons.some((btn) => String(btn.textContent).includes("因果链"))).toBe(true);
  });

  it("reminds undergrad applicants that revealed waitlist/reject results can be appealed in chat", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const school = window.getLegacySchoolById("cmu");
    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "rd_release";
    snapshot.resultReleaseStage = "regular";
    snapshot.results = [
      {
        ...school,
        email: "admission@cmu.edu",
        status: "拒绝",
        chance: 0.21,
        fitScore: 0.67,
        academicScore: 0.73,
        holisticScore: 0.58,
        reasons: ["竞争激烈"],
        revealed: true,
        batch: "rd",
      },
    ];
    applyStateSnapshot(window, snapshot);
    window.updateUI();

    expect(window.document.getElementById("resultsSubtitle").textContent).toContain("聊天窗复议");
    expect(window.document.getElementById("resultSummary").textContent).toContain("聊天窗复议");
    expect(window.document.getElementById("resultsList").textContent).toContain("聊天窗提交申诉");
  });

  it("adds graduate appeal guidance after revealed grad decisions", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const school = window.getLegacySchoolById("nus");
    const snapshot = getStateSnapshot(window);
    snapshot.termIndex = 7;
    snapshot.applicationStage = "complete";
    snapshot.finalChoice = "cmu";
    snapshot.undergradStarted = true;
    snapshot.undergradGraduated = true;
    snapshot.postGradPath = "masters";
    snapshot.gradApplicationType = "masters";
    snapshot.gradResults = [
      {
        ...school,
        majorId: snapshot.majorId,
        majorName: "计算机科学",
        programType: "masters",
        chance: 0.24,
        status: "候补",
        reason: "研究潜力可见，但名额有限。",
        reasons: ["研究潜力可见", "名额有限"],
        fitScore: 0.69,
        revealed: true,
      },
    ];
    applyStateSnapshot(window, snapshot);
    window.updateUI();

    expect(window.document.getElementById("gradReleaseNote").textContent).toContain("聊天窗复议");
    expect(window.document.getElementById("gradResultsGrid").textContent).toContain("聊天窗提交申诉");
  });

  it("uses world state to shift admission and career chances", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const base = getStateSnapshot(window);
    base.termIndex = 6;
    base.difficultyId = "standard";
    base.majorId = "cs_engineering";
    base.essayChoices = ["research"];
    base.recChoice = "teacher";
    base.feeWaiverChoice = "none";
    base.stats.gpa = 3.9;
    base.stats.test = 1520;
    base.stats.english = 112;
    base.stats.activities = 82;
    base.stats.awards = 78;
    base.stats.leadership = 76;
    base.stats.essay = 80;
    base.stats.essayTrack = 84;
    base.stats.recStrength = 79;
    base.stats.reputation = 72;
    base.stats.stress = 34;

    const targetSchool = {
      id: "world-impact-uni",
      name: "World Impact University",
      country: "United States",
      region: "US",
      type: "research",
      strengths: ["cs_engineering"],
      qsRank: 35,
    };
    const targetCompany = {
      id: "world-impact-company",
      name: "World Dynamics Labs",
      role: "AI Engineer",
      location: "US",
      salaryLow: 140000,
      salaryHigh: 210000,
      difficulty: 0.75,
      preferredMajors: ["cs_engineering"],
      preferredTags: ["科研"],
    };

    base.worldState = { visaEase: 82, policySupport: 79, industryBoom: 81, economyStrength: 77 };
    applyStateSnapshot(window, base);
    const highAdmission = window.evaluateApplication(targetSchool, { preview: true, roundOverride: "rd" }).chance;
    const highCareer = window.evaluateCompanyApplication(targetCompany, 0.76, 0.78, {
      educationLabel: "本科毕业",
      degreeBonus: 0,
    }).chance;

    const low = getStateSnapshot(window);
    low.worldState = { visaEase: 22, policySupport: 24, industryBoom: 21, economyStrength: 25 };
    applyStateSnapshot(window, low);
    const lowAdmission = window.evaluateApplication(targetSchool, { preview: true, roundOverride: "rd" }).chance;
    const lowCareer = window.evaluateCompanyApplication(targetCompany, 0.76, 0.78, {
      educationLabel: "本科毕业",
      degreeBonus: 0,
    }).chance;

    expect(highAdmission).toBeGreaterThan(lowAdmission);
    expect(highCareer).toBeGreaterThan(lowCareer);
  });

  it("advances a continuous story arc after resolving a story decision", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.cash = 100000;
    snapshot.termIndex = 2; // 高二上，对应剧情 term=3
    snapshot.storyArcs = {
      active: [
        {
          id: "arc-cross-border-pivot",
          stage: "highschool",
          stepIndex: 0,
          dueTerm: 3,
          startedAt: Date.now(),
          history: [],
        },
      ],
      completed: [],
      history: [],
    };
    applyStateSnapshot(window, snapshot);

    const decision = window.maybeBuildStoryArcDecision("highschool");
    expect(decision).toBeTruthy();
    expect(String(decision.title)).toContain("连续剧情");
    expect(decision.options.length).toBeGreaterThan(1);

    window.resolveDecision(decision, decision.options[0]);
    const after = getStateSnapshot(window);
    const active = (after.storyArcs?.active || []).find((item) => item.id === "arc-cross-border-pivot");
    expect(active).toBeTruthy();
    expect(Number(active.stepIndex || 0)).toBeGreaterThanOrEqual(1);
    expect(Number(active.dueTerm || 0)).toBeGreaterThanOrEqual(4);
    expect((after.worldHistory || []).length).toBeGreaterThan(0);
  });

  it("resolves multi-role conflict decisions and updates role relationships", () => {
    const dom = bootstrap();
    const { window } = dom;
    startBasicGame(window);

    const snapshot = getStateSnapshot(window);
    snapshot.cash = 100000;
    snapshot.termIndex = 2;
    snapshot.conflictCooldown = 0;
    snapshot.usedConflictDecisionIds = [];
    applyStateSnapshot(window, snapshot);

    const originalRandom = window.Math.random;
    window.Math.random = () => 0;
    try {
      const before = getStateSnapshot(window);
      const decision = window.maybeBuildConflictDecision("highschool");
      expect(decision).toBeTruthy();
      expect(String(decision.title)).toContain("多角色分歧");

      window.resolveDecision(decision, decision.options[0]);
      const after = getStateSnapshot(window);
      expect((after.usedConflictDecisionIds || []).length).toBeGreaterThan(0);
      expect(Number(after.chatRelationships.counselor || 0)).toBeGreaterThan(Number(before.chatRelationships.counselor || 0));
      expect(Number(after.chatRelationships.family || 0)).toBeLessThan(Number(before.chatRelationships.family || 0));
    } finally {
      window.Math.random = originalRandom;
    }
  });
});
