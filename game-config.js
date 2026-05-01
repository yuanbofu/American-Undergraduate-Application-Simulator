/* Runtime tuning config (optional). Values here are session defaults and can be edited safely. */
window.GAME_RUNTIME_CONFIG = {
  calibration: {
    runs: 1200,
    autoApply: true,
    tuningCap: 0.08,
    targets: {
      relaxed: { admitRateMin: 0.2, admitRateMax: 0.42, waitlistRateMax: 0.16 },
      standard: { admitRateMin: 0.15, admitRateMax: 0.34, waitlistRateMax: 0.18 },
      hard: { admitRateMin: 0.1, admitRateMax: 0.27, waitlistRateMax: 0.2 }
    }
  },
  chat: {
    memoryLimitByRole: {
      counselor: 12,
      family: 9,
      peer: 9,
      interviewer: 8,
      admissions: 10,
      default: 8
    }
  },
  stateMachine: {
    actionStages: {
      confirmTerm: ["highschool"],
      submitApplications: ["application"],
      releaseNextResultBatch: ["release"],
      resolveWaitlist: ["release"],
      openOfferDialog: ["release"],
      startUndergradJourney: ["undergrad"],
      choosePostGradPath: ["grad", "career"],
      submitMastersApplications: ["grad"],
      submitPhdApplications: ["grad"],
      chooseGraduateOffer: ["grad"],
      submitJobApplications: ["career"],
      advanceInterviewRound: ["career"],
      revealNextGradResult: ["grad"],
      revealNextCareerResult: ["career"],
      chooseFinalJobOffer: ["career"],
      confirmUndergradTerm: ["undergrad"],
      confirmMastersTerm: ["grad"],
      confirmPhdTerm: ["grad"]
    }
  },
  events: {
    incidentChainMap: {
      "visa-delay": [{ id: "policy-tighten", delay: 1, chance: 0.5 }],
      "pandemic-shift": [{ id: "exchange-open", delay: 1, chance: 0.45 }],
      "competition-upset": [{ id: "mentor-letter", delay: 1, chance: 0.38 }],
      "team-break": [{ id: "mentor-connection", delay: 1, chance: 0.42 }],
      "data-loss": [{ id: "media-spotlight", delay: 1, chance: 0.3 }],
      "family-change": [{ id: "scholarship-invite", delay: 1, chance: 0.34 }],
      "test-cancel": [{ id: "sudden-award", delay: 1, chance: 0.25 }]
    }
  },
  world: {
    shiftChance: 0.42,
    historyLimit: 16
  },
  story: {
    arcTriggerChance: 0.28,
    conflictTriggerChance: 0.22,
    historyLimit: 20
  },
  data: {
    overrides: {
      universities: [],
      companies: [],
      highschoolEvents: [],
      highschoolIncidents: [],
      undergradActions: [],
      mastersActions: [],
      phdActions: [],
      undergradMiniActions: [],
      mastersMiniActions: [],
      phdMiniActions: [],
      undergradTermActions: {},
      mastersTermActions: {},
      phdTermActions: {},
      interviewQuestions: []
    }
  }
};
