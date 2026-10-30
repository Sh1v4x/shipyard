// Schémas JSON passés à `claude -p --json-schema`. Ils doivent rester alignés avec shared/types.ts.

const s = (description: string) => ({ type: 'string', description }) as const

export const branchNameSchema = {
  type: 'object',
  properties: { slug: s('2 to 4 English words, kebab-case') },
  required: ['slug'],
} as const

export const dailySchema = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: s('What was done, in one line'),
                pr: { type: ['integer', 'null'] },
                url: { type: ['string', 'null'] },
                status: { type: 'string', enum: ['mergée', 'ouverte', 'fermée', 'reviewée'] },
                points: { type: 'array', items: { type: 'string' } },
              },
              required: ['title', 'pr', 'url', 'status', 'points'],
            },
          },
        },
        required: ['project', 'items'],
      },
    },
    next: { type: 'array', items: { type: 'string' } },
  },
  required: ['sections', 'next'],
} as const

export const dirtyTriageSchema = {
  type: 'object',
  properties: {
    summary: s('What these files contain and the recommendation, 1 to 3 sentences'),
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, verdict: { type: 'string', enum: ['commit', 'discard', 'ask'] }, reason: { type: 'string' } },
        required: ['path', 'verdict', 'reason'],
      },
    },
    commitTitle: { type: ['string', 'null'], description: 'Commit title for the files to keep, or null' },
  },
  required: ['summary', 'files', 'commitTitle'],
} as const

export const conflictResolveSchema = {
  type: 'object',
  properties: {
    summary: s('What the base brought in, what you did, what remains, in 2 to 4 sentences'),
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: s('Relative path'),
          status: { type: 'string', enum: ['résolu', 'en attente'] },
          resolution: s('How the conflict was resolved (or why it awaits an answer)'),
          risk: { type: 'string', enum: ['aucun', 'faible', 'à vérifier'] },
        },
        required: ['file', 'status', 'resolution', 'risk'],
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: s('q1, q2…'), file: s('File concerned'), question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'file', 'question', 'options'],
      },
    },
    checks: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'skip'] }, detail: { type: 'string' } }, required: ['name', 'status', 'detail'] },
    },
  },
  required: ['summary', 'files', 'questions', 'checks'],
} as const

export const ticketDraftSchema = {
  type: 'object',
  properties: {
    summary: s('What you understood of the feature and how you split it, in 2 to 4 sentences'),
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: s('q1, q2…'), question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['id', 'question', 'options'],
      },
    },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: s('Short title in the tickets language, in the team’s ticket format'),
          description: s('Full ticket Markdown, in the tickets language'),
          type: { type: 'string', enum: ['Feature', 'Bug', 'Improvement'] },
          labels: { type: 'array', items: s('Exact name of an existing team label') },
          priority: { type: 'integer', minimum: 0, maximum: 4 },
          project: { type: ['string', 'null'], description: 'Exact name of an existing Linear project, or null' },
        },
        required: ['title', 'description', 'type', 'labels', 'priority', 'project'],
      },
    },
  },
  required: ['summary', 'questions', 'tickets'],
} as const

const finding = {
  type: 'object',
  properties: {
    id: s('f1, f2…'),
    file: s('Relative path'),
    line: { type: 'integer', description: 'Line in the new version of the file' },
    severity: { type: 'string', enum: ['bloquant', 'important', 'suggestion'] },
    title: s('One line'),
    body: s('The problem, or the comment to post'),
    fix: s('The concrete fix'),
    relatedThreadId: { type: ['string', 'null'], description: 'Existing thread on the same topic or at the same place, otherwise null' },
  },
  required: ['id', 'file', 'line', 'severity', 'title', 'body', 'fix', 'relatedThreadId'],
} as const

export const reviewSchema = {
  type: 'object',
  properties: { summary: s('2 to 3 sentences'), findings: { type: 'array', items: finding } },
  required: ['summary', 'findings'],
} as const

export const prReviewSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['review', 're-review'] },
    verdict: { type: 'string', enum: ['COMMENT', 'REQUEST_CHANGES', 'APPROVE'] },
    summary: s('Review body posted on GitHub, in the GitHub language, 1 to 2 short sentences'),
    fixedThreads: { type: 'array', items: s('threadId of a fixed thread'), description: 'Empty in review mode' },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: s('c1, c2…'),
          file: s('Relative path'),
          line: { type: 'integer', description: 'Line in the new version, present in the diff' },
          severity: { type: 'string', enum: ['bloquant', 'important', 'suggestion'] },
          body: s('The comment as it will be posted on GitHub, in the GitHub language, short and imperative'),
          threadId: { type: ['string', 'null'], description: 'Thread to reply to (re-review), otherwise null' },
          followUp: { type: ['string', 'null'], enum: ['partiel', 'non-corrigé', 'à-trancher', null], description: 'Status of the previous comment (re-review), otherwise null' },
          relatedThreadId: { type: ['string', 'null'], description: 'Other existing thread on the same topic or at the same place (not the threadId one), otherwise null' },
          pattern: { type: ['string', 'null'], description: 'Short name of the issue, for the user, if it repeats in several places, otherwise null' },
          also: {
            type: 'array',
            description: 'Other occurrences of the same issue (empty if unique)',
            items: {
              type: 'object',
              properties: {
                file: s('Relative path'),
                line: { type: 'integer', description: 'Line in the new version, present in the diff' },
                body: s('Comment posted at this spot on GitHub, in the GitHub language: short, imperative, self-contained'),
              },
              required: ['file', 'line', 'body'],
            },
          },
        },
        required: ['id', 'file', 'line', 'severity', 'body', 'threadId', 'followUp', 'relatedThreadId', 'pattern', 'also'],
      },
    },
  },
  required: ['mode', 'verdict', 'summary', 'fixedThreads', 'comments'],
} as const

export const commentsSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          threadId: s('Thread id, copied as is'),
          verdict: { type: 'string', enum: ['fix', 'skip'] },
          audit: s('Reasoning'),
          action: s('What will be done'),
          reply: s('Reply to post on GitHub, in the GitHub language, if skip; empty if fix'),
          linkedImpact: s('Linked repo: what will change there or what could break, empty if nothing'),
        },
        required: ['threadId', 'verdict', 'audit', 'action', 'reply', 'linkedImpact'],
      },
    },
  },
  required: ['items'],
} as const

export const commentsFixAllSchema = {
  type: 'object',
  properties: {
    commitTitle: s('A single commit title for all fixes'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          threadId: s('Thread id, copied as is'),
          status: { type: 'string', enum: ['fixed', 'already', 'failed'] },
          alreadyFixed: { type: ['string', 'null'], description: 'Sha of the commit that already contains the fix, otherwise null' },
          summary: s('What was done, or why it could not be'),
        },
        required: ['threadId', 'status', 'alreadyFixed', 'summary'],
      },
    },
  },
  required: ['commitTitle', 'items'],
} as const

export const findingsFixAllSchema = {
  type: 'object',
  properties: {
    commitTitle: s('A single commit title for all fixes'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: s('Finding id, copied as is'),
          status: { type: 'string', enum: ['fixed', 'already', 'failed'] },
          summary: s('What was done, or why it could not be'),
        },
        required: ['id', 'status', 'summary'],
      },
    },
  },
  required: ['commitTitle', 'items'],
} as const

export const ciAllSchema = {
  type: 'object',
  properties: {
    summary: s('Overview in 1 to 3 sentences: common causes, suggested order'),
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: s('Job id, copied as is'),
          name: s('Job name'),
          cause: s('Explanation'),
          origin: { type: 'string', enum: ['pr', 'config', 'flaky', 'infra', 'base'] },
          fix: s('Fix, « relancer le job » or « récupérer la base »'),
          fixable: { type: 'boolean' },
        },
        required: ['jobId', 'name', 'cause', 'origin', 'fix', 'fixable'],
      },
    },
  },
  required: ['summary', 'jobs'],
} as const

export const insightsSchema = {
  type: 'object',
  properties: {
    summary: s('3 to 5 sentences: what the project is, its state, the chosen focus areas'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: s('Short and telling'),
          category: { type: 'string', enum: ['feature', 'performance', 'sécurité', 'dette', 'tests', 'accessibilité', 'ux', 'dx', 'architecture'] },
          why: s('Observation or need, backed by the code'),
          proposal: s('What to do, concretely'),
          files: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          impact: { type: 'string', enum: ['faible', 'moyen', 'fort'] },
          risk: s('What could break, or empty'),
        },
        required: ['title', 'category', 'why', 'proposal', 'files', 'effort', 'impact', 'risk'],
      },
    },
  },
  required: ['summary', 'items'],
} as const

export const followupSchema = {
  type: 'object',
  properties: {
    summary: s('2 to 3 sentences: what is done, what remains, what is disputed'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          threadId: s('Thread id, copied as is'),
          status: { type: 'string', enum: ['corrigé', 'partiel', 'non-corrigé', 'contesté'] },
          explanation: s('What was done in the code, and whether the author’s reply is justified'),
          reply: s('Proposed reply in the GitHub thread, in the GitHub language; empty when resolving is enough'),
          resolve: { type: 'boolean', description: 'Suggest resolving the thread: fixed, or the author’s argument is justified' },
        },
        required: ['threadId', 'status', 'explanation', 'reply', 'resolve'],
      },
    },
  },
  required: ['summary', 'items'],
} as const

export const prPrepareSchema = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: s('Conventional commits title, in English'), files: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'files'],
      },
    },
    title: s('PR title, in English'),
    body: s('Markdown description, in the PR description language'),
  },
  required: ['commits', 'title', 'body'],
} as const

export const commentReplySchema = {
  type: 'object',
  properties: { reply: s('Reply posted in the GitHub thread, in the GitHub language') },
  required: ['reply'],
} as const

export const fixSchema = {
  type: 'object',
  properties: {
    changed: { type: 'boolean' },
    commitTitle: s('Commit title'),
    summary: s('What was done'),
    alreadyFixed: { type: ['string', 'null'], description: 'Sha of the branch commit that already contains the fix, otherwise null' },
  },
  required: ['changed', 'commitTitle', 'summary'],
} as const

export const testSchema = {
  type: 'object',
  properties: {
    suite: {
      type: 'object',
      properties: { command: { type: 'string' }, passed: { type: 'integer' }, failed: { type: 'integer' }, summary: { type: 'string' } },
      required: ['command', 'passed', 'failed', 'summary'],
    },
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'warn'] },
          detail: { type: 'string' },
          decision: {
            type: ['object', 'null'],
            description: 'Point the test cannot settle alone (product choice, ticket question, ambiguous behavior), otherwise null',
            properties: {
              question: s('The question to settle, in one sentence'),
              options: {
                type: 'array',
                description: '2 to 4 possible answers',
                items: {
                  type: 'object',
                  properties: { label: s('The answer, in a few words'), fix: { type: ['string', 'null'], description: 'What to change in the code for this answer; null to keep as is' } },
                  required: ['label', 'fix'],
                },
              },
            },
            required: ['question', 'options'],
          },
        },
        required: ['name', 'status', 'detail'],
      },
    },
    setup: s('What had to be prepared for testing (environment, data), empty if nothing'),
    lessons: {
      type: 'array',
      description: 'Lessons useful for future tests',
      items: {
        type: 'object',
        properties: { scope: { type: 'string', enum: ['project', 'branch'] }, text: { type: 'string' } },
        required: ['scope', 'text'],
      },
    },
  },
  required: ['suite', 'scenarios'],
} as const

export const checksAnalyzeSchema = {
  type: 'object',
  properties: {
    summary: s('What the check reports and what deserves fixing'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: s('Short, stable id'),
          source: s('Tool or report section'),
          file: { type: ['string', 'null'] },
          line: { type: ['integer', 'null'] },
          problem: { type: 'string' },
          introduced: { type: 'boolean', description: 'Introduced by the PR' },
          blocking: { type: 'boolean', description: 'Oxlint finding on a line added by the PR: blocks the PR' },
          verdict: { type: 'string', enum: ['fix', 'ignore', 'manual'] },
          reason: { type: 'string' },
          fix: s('Concrete fix, or manual action outside the repo'),
        },
        required: ['id', 'source', 'file', 'line', 'problem', 'introduced', 'blocking', 'verdict', 'reason', 'fix'],
      },
    },
  },
  required: ['summary', 'items'],
} as const

export const manualTestSchema = {
  type: 'object',
  properties: {
    setup: s('What was prepared (dependencies, .env, database, data), empty if nothing'),
    services: {
      type: 'array',
      description: 'Commands to keep running during the test, started by Shipyard',
      items: {
        type: 'object',
        properties: {
          name: s('Short name (API, front, Metro…)'),
          cwd: s('Absolute directory to run the command in'),
          command: s('Shell command, in the foreground'),
          port: { type: ['integer', 'null'], description: 'Port that answers once the service is ready, null if none' },
        },
        required: ['name', 'cwd', 'command', 'port'],
      },
    },
    url: { type: ['string', 'null'], description: 'Page to open in Chrome, null for a mobile app' },
    access: s('Test accounts and data to know, empty if nothing'),
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          expected: { type: 'string' },
          command: { type: ['string', 'null'], description: 'Verification command to run in a terminal (read-only), otherwise null' },
          url: { type: ['string', 'null'], description: 'Full URL of the app page where to do the step (including port and test data ids), otherwise null' },
        },
        required: ['title', 'detail', 'expected'],
      },
    },
    lessons: testSchema.properties.lessons,
  },
  required: ['setup', 'services', 'url', 'access', 'steps'],
} as const

export const ciSchema = {
  type: 'object',
  properties: {
    cause: s('Explanation'),
    origin: { type: 'string', enum: ['pr', 'config', 'flaky', 'infra', 'base'] },
    fix: s('Fix or « relancer le job »'),
    fixable: { type: 'boolean' },
  },
  required: ['cause', 'origin', 'fix', 'fixable'],
} as const

export const commitPlanSchema = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: s('Title only, following the repo convention, in English'),
          project: s('Id of the worktree project holding the files (given in the context)'),
          files: { type: 'array', items: { type: 'string' }, description: 'Paths relative to this project’s worktree' },
        },
        required: ['title', 'project', 'files'],
      },
    },
    excluded: {
      type: 'array',
      items: { type: 'object', properties: { file: { type: 'string' }, reason: { type: 'string' } }, required: ['file', 'reason'] },
    },
    notes: s('Point of attention, or empty string'),
  },
  required: ['commits', 'excluded', 'notes'],
} as const

export const commitFixSchema = {
  type: 'object',
  properties: {
    fixed: { type: 'boolean' },
    summary: s('What was fixed, or why it is not possible'),
    newTitle: { type: ['string', 'null'], description: 'Corrected title if the message was rejected, otherwise null' },
  },
  required: ['fixed', 'summary', 'newTitle'],
} as const

export const hookFixPlanSchema = {
  type: 'object',
  properties: {
    cause: s('What the hook complains about, and why'),
    proposal: s('The proposed fix, concrete'),
    disablesRule: { type: 'boolean', description: 'The fix disables a rule (biome-ignore, ts-expect-error, oxlint-disable…)' },
    newTitle: { type: ['string', 'null'], description: 'Corrected title if only the commit message is at fault, otherwise null' },
  },
  required: ['cause', 'proposal', 'disablesRule', 'newTitle'],
} as const

export const ticketPlanSchema = {
  type: 'object',
  properties: {
    summary: s('Chosen approach'),
    steps: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, details: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['title', 'details', 'files'] },
    },
    screenshots: {
      type: 'array',
      items: { type: 'object', properties: { name: s('kebab-case, used as the file name'), platform: { type: 'string', enum: ['web', 'android'] }, route: s('Web route, or Android screen and how to get there'), description: { type: 'string' } }, required: ['name', 'platform', 'route', 'description'] },
    },
    risks: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    reply: { type: ['string', 'null'], description: 'Reply to the user’s message about the plan, null for a first plan' },
  },
  required: ['summary', 'steps', 'screenshots', 'risks', 'questions'],
} as const

export const ticketWorkSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    changes: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, change: { type: 'string' } }, required: ['file', 'change'] } },
    checks: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string', enum: ['pass', 'fail', 'skip'] }, detail: { type: 'string' } }, required: ['name', 'status', 'detail'] },
    },
    screenshots: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, platform: { type: 'string', enum: ['web', 'android'] }, description: { type: 'string' }, before: { type: ['string', 'null'] }, after: { type: ['string', 'null'] } },
        required: ['name', 'platform', 'description', 'before', 'after'],
      },
    },
    appNote: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'changes', 'checks', 'screenshots', 'appNote', 'risks', 'followUps'],
} as const

export const testCheckSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail', 'unclear'] },
    command: s('Command actually run'),
    output: s('Useful excerpt of the output, 30 lines at most'),
    explanation: s('Comparison with the expected result, calculations included, in 1 to 3 sentences'),
  },
  required: ['verdict', 'command', 'output', 'explanation'],
} as const
