// Worked example: loan funding review (scrubbed). See reference/data-schema.md.
window.FLOW = {
  "meta": {
    "title": "Loan funding review",
    "subtitle": "How a dealer's funding package moves through a lender's systems and becomes a decision",
    "footnote": "Worked example for the interactive-sequence-explorer skill. Names are generic; IDs, values and SQL are illustrative.",
    "phasesPlain": {
      "Webhook": "LOS alert",
      "Sweep": "Timer check",
      "Stipulations": "Lender conditions"
    }
  },
  "lanes": {
    "los": {
      "name": "LOS",
      "kind": "Loan origination system",
      "plain": "The dealer-facing loan origination system. It holds each application and the documents the dealer uploads.",
      "tech": [
        [
          "Owner",
          "External (the LOS vendor)"
        ],
        [
          "Calls us",
          "POST /v1/webhooks/los/applications/{applicationNumber}"
        ],
        [
          "We call it",
          "\"application fetch\" (application) and \"documents fetch\" (documents) data sources through Los.Sdk"
        ]
      ],
      "refs": [
        "los-sdk"
      ],
      "kindPlain": "Loan origination system"
    },
    "api": {
      "name": "Lending API",
      "kind": "api-host Lambda",
      "plain": "Our API. It receives LOS's alerts, imports the application and serves the funder portal.",
      "tech": [
        [
          "Runtime",
          ".NET 10 api-host Lambda behind API Gateway, CloudFront and WAF"
        ],
        [
          "Auth",
          "Cognito OAuth2 access tokens; scopes lending-api:access, applications:webhook, funding-reviews:read, funding-reviews:decision"
        ],
        [
          "Code",
          "src/Lending.Functions/LosWebhook/LosWebhookEndpoints.cs, FundingReview/FundingReviewPortalEndpoints.cs"
        ]
      ],
      "refs": [
        "lending-api"
      ],
      "kindPlain": "Our API"
    },
    "flags": {
      "name": "Feature flags",
      "kind": "AWS AppConfig",
      "plain": "On/off switches that let us turn a feature on in one environment without a release.",
      "tech": [
        [
          "Service",
          "AWS AppConfig, application lending-api, profile feature-flags"
        ],
        [
          "Flags",
          "los-document-import (document copy), funding-review-sweep (reviews). Both created disabled, in the console"
        ],
        [
          "Refresh",
          "Cached about 15 s by IFeatureFlagsProvider"
        ]
      ],
      "refs": [
        "infrastructure"
      ],
      "kindPlain": "On/off switches"
    },
    "db": {
      "name": "Lending database",
      "kind": "Aurora PostgreSQL",
      "plain": "Where applications, work queues, document records and review results live. Every row belongs to one lender (tenant) and nothing can be deleted.",
      "tech": [
        [
          "Engine",
          "Aurora PostgreSQL 17 through RDS Proxy, IAM auth as lending_app_iam"
        ],
        [
          "Isolation",
          "Row-level security per TenantId; tenant-scoped foreign keys"
        ],
        [
          "Integrity",
          "Append-only triggers, frozen finished rows, two-way state checks"
        ],
        [
          "Schema",
          "Lending.Database package (EF Core migrations)"
        ]
      ],
      "refs": [
        "lending-database"
      ],
      "kindPlain": "Our database",
      "store": true
    },
    "sched": {
      "name": "Scheduler",
      "kind": "EventBridge Scheduler",
      "plain": "A clock. Every five minutes it wakes a background worker to see if there is work.",
      "tech": [
        [
          "Service",
          "Amazon EventBridge Scheduler, rate(5 minutes), UTC"
        ],
        [
          "Retries",
          "None on the schedule; the Lambda's async invoke retries a failed run twice"
        ],
        [
          "Input",
          "{\"job\":\"sweep\",\"scheduledTime\":<aws.scheduler.scheduled-time>,\"executionId\":<aws.scheduler.execution-id>}"
        ]
      ],
      "refs": [
        "infrastructure"
      ],
      "kindPlain": "Timer"
    },
    "worker": {
      "name": "Document worker",
      "kind": "los-document-jobs Lambda",
      "plain": "A background job that copies new or changed documents from LOS into our own secure storage.",
      "tech": [
        [
          "Function",
          "…-compute-los-document-jobs: arm64, 2048 MB, 300 s, reserved concurrency 1"
        ],
        [
          "Bundle",
          "api-host bundle with Lending__FunctionSurface=los-document-jobs"
        ],
        [
          "May",
          "Read the documents secret, GenerateDataKey on the PII key, connect as lending_app_iam, read feature flags, PutObject under los/tenants/"
        ]
      ],
      "refs": [
        "lending-api · DocumentSync"
      ],
      "kindPlain": "Background job"
    },
    "s3": {
      "name": "Document storage",
      "kind": "Amazon S3",
      "plain": "Secure file storage. Originals are kept forever (until a retention period is set) and every file is encrypted.",
      "tech": [
        [
          "Documents bucket",
          "…-compute-application-docs-{account}, prefix los/tenants/: versioned, SSE-KMS with the PII key, deletes denied, access-logged"
        ],
        [
          "Artifacts bucket",
          "…-funding-review-artifacts-{account}, prefix funding/tenants/: the document review's parses, encrypted again by the app"
        ]
      ],
      "refs": [
        "infrastructure"
      ],
      "kindPlain": "File storage"
    },
    "sweep": {
      "name": "Review sweep",
      "kind": "funding-review-jobs Lambda",
      "plain": "A background job that spots applications whose documents changed and starts a review for them.",
      "tech": [
        [
          "Function",
          "…-compute-funding-review-jobs: VPC, 512 MB, 300 s, reserved concurrency 1"
        ],
        [
          "May",
          "states:StartExecution on the funding-review state machine only; GenerateDataKey (PII envelope); RDS Proxy; AppConfig"
        ],
        [
          "Settings",
          "Lending:FundingReview:StartAgainAfter 1 min, RetireRunningAfter 75 min, MaxActiveRuns = steps reserved concurrency ÷ document concurrency"
        ]
      ],
      "refs": [
        "lending-api · FundingReview"
      ],
      "kindPlain": "Background job"
    },
    "sfn": {
      "name": "Workflow engine",
      "kind": "AWS Step Functions",
      "plain": "Runs the review's steps in order, retries a step when something is busy, and catches failures. It only ever passes IDs between steps, never customer data.",
      "tech": [
        [
          "State machine",
          "funding-review (STANDARD), execution name run-{runId}, timeout 3600 s, X-Ray on, logs ERROR without execution data"
        ],
        [
          "States",
          "Begin → Documents (Map) → Rules → SecondReading → Stips → Score → Finalize; any failure → MarkFailed → Fail"
        ],
        [
          "Retries",
          "Lambda throttles 15× up to 300 s; ModelThrottled on Document, SecondReading, Stips"
        ]
      ],
      "refs": [
        "infrastructure"
      ],
      "kindPlain": "Workflow"
    },
    "steps": {
      "name": "Review worker",
      "kind": "funding-review-steps Lambda",
      "plain": "Does the actual work of each step: reads the documents, checks the funding rules and scores the results.",
      "tech": [
        [
          "Function",
          "…-compute-funding-review-steps: VPC, 3008 MB, 900 s, reserved concurrency 5 (dev) / 10 (prod)"
        ],
        [
          "Engine",
          "Documents.Sdk in-process: PdfPig, PDFium, Textract, Bedrock, GoRules ZEN"
        ],
        [
          "Event",
          "{step, runId, tenantId, executionArn?, documentId?, error?, failure?} → {step, status, documentIds?, counts?}"
        ]
      ],
      "refs": [
        "lending-api · FundingReview"
      ],
      "kindPlain": "Workflow worker"
    },
    "textract": {
      "name": "Text reader",
      "kind": "Amazon Textract",
      "plain": "Turns scanned pages (pictures of paper) into text the system can read.",
      "tech": [
        [
          "API",
          "DetectDocumentText, synchronous, one page image per call (no S3 input)"
        ],
        [
          "When",
          "A PDF page with under 20 characters of text layer (under 200 if mostly image), each TIFF frame and each image, rendered at 200 dpi"
        ]
      ],
      "refs": [
        "documents-sdk"
      ],
      "kindPlain": "Scan-to-text service"
    },
    "bedrock": {
      "name": "AI reader",
      "kind": "Amazon Bedrock",
      "plain": "An AI model that reads the documents' fields and, separately, double-checks anything the rules flagged without being told the expected answer.",
      "tech": [
        [
          "API",
          "Bedrock Runtime Converse, structured output as one forced tool"
        ],
        [
          "Model",
          "Cross-region inference profile us.anthropic.claude-haiku-5-5 (us-east-1, us-east-2, us-west-2)"
        ],
        [
          "Guard",
          "IAM allows only that profile and the model behind it; hourly token alarm"
        ]
      ],
      "refs": [
        "documents-sdk"
      ],
      "kindPlain": "AI service"
    },
    "portal": {
      "name": "Funder portal",
      "kind": "Review UI",
      "plain": "Where a funder reviews the result, answers flagged checks and approves or returns the package.",
      "tech": [
        [
          "App",
          "funding-frontend (Next.js)"
        ],
        [
          "Calls",
          "lending-api /v1/funding-reviews/... with a client_credentials token; the funder's email in X-On-Behalf-Of-Actor-Email"
        ]
      ],
      "refs": [
        "funding-portal"
      ],
      "kindPlain": "Review screen"
    }
  },
  "seqs": {
    "a": {
      "code": "A",
      "title": "Documents arrive",
      "lanes": [
        "los",
        "api",
        "flags",
        "db",
        "sched",
        "worker",
        "s3"
      ],
      "steps": [
        {
          "id": "a1",
          "route": [
            "los",
            "api"
          ],
          "label": "docsAdded",
          "phase": "Webhook",
          "title": "LOS says new documents were added",
          "story": "A dealer uploaded documents to a loan application in LOS. LOS immediately calls our API: \"application 234892 changed, and documents were added\".",
          "why": "We don't poll LOS. It tells us when something changes, so the review can start within minutes.",
          "call": {
            "verb": "POST",
            "text": "/v1/webhooks/los/applications/{applicationNumber}?docsAdded=true"
          },
          "kv": [
            [
              "Auth",
              "Bearer token with scope lending-api:access or applications:webhook"
            ],
            [
              "Route rule",
              "applicationNumber: 1 to 18 digits"
            ],
            [
              "Idempotency",
              "X-LOS-Delivery-Id is hashed into the import's idempotency key"
            ]
          ],
          "req": {
            "cap": "Request",
            "lang": "http",
            "body": "POST /v1/webhooks/los/applications/234892?docsAdded=true HTTP/1.1\nHost: <api host>\nAuthorization: Bearer <access token>\nX-LOS-Delivery-Id: delivery-docs-f86e20e8a7dd469f8625218ab9093a54\nContent-Length: 0"
          },
          "notes": [
            "No request body: the application number in the path is the whole message.",
            "<code>docsAdded</code> is read only while the <code>los-document-import</code> flag is on. With the flag on, any value but <code>true</code> or <code>false</code> returns <code>422 los-webhook.validation-failed</code> before LOS is called.",
            "A bad application number returns <code>422</code>: <code>'applicationNumber' must contain 1 to 18 digits.</code>"
          ],
          "refs": [
            "los-sdk",
            "lending-api"
          ],
          "labelPlain": "new docs"
        },
        {
          "id": "a2",
          "route": [
            "api",
            "flags"
          ],
          "label": "flag?",
          "phase": "Webhook",
          "title": "Is document copying switched on?",
          "story": "The API checks a switch, once per request. If document copying is switched off, it imports the application and ignores the documents.",
          "why": "Each environment can turn this on separately, without shipping new code.",
          "call": {
            "verb": "SDK",
            "text": "IFeatureFlagsProvider.GetAsync() → FeatureFlags.LosDocumentImport"
          },
          "kv": [
            [
              "Flag",
              "los-document-import"
            ],
            [
              "Store",
              "AppConfig lending-api / feature-flags"
            ],
            [
              "Default",
              "Off (created disabled in the console)"
            ]
          ],
          "res": {
            "cap": "Flag value (AppConfig feature-flags profile)",
            "lang": "json",
            "body": "{\n  \"los-document-import\": { \"enabled\": true }\n}"
          },
          "refs": [
            "lending-api",
            "infrastructure"
          ],
          "labelPlain": "switched on?",
          "resLabel": "enabled: true",
          "resLabelPlain": "it's on"
        },
        {
          "id": "a3",
          "route": [
            "api",
            "los"
          ],
          "label": "fetch app",
          "phase": "Import",
          "title": "API fetches the latest application",
          "story": "The API asks LOS for the full, current application (applicants, deal, vehicle, notes) so our copy matches LOS's.",
          "why": "The alert carries only a number. We always fetch fresh data rather than trust a payload.",
          "call": {
            "verb": "SDK",
            "text": "Los.Sdk → LOS \"application fetch\" (consolidated) data source"
          },
          "kv": [
            [
              "Pipeline",
              "import, the same as POST /v1/applications/imports/los with mode: upsert, dryRun: false"
            ],
            [
              "Secret",
              "LOS:ConsolidatedFetchSecretName (Secrets Manager)"
            ],
            [
              "On a redelivery",
              "Same X-LOS-Delivery-Id: replays the stored result, no LOS call"
            ]
          ],
          "res": {
            "cap": "Provider result (summarised)",
            "lang": "json",
            "body": "{\n  \"applicationNumber\": \"234892\",\n  \"providerHttpStatusCode\": 200,\n  \"providerDurationMilliseconds\": 842,\n  \"fields\": { \"Applicant - FirstNm\": \"<encrypted at rest>\", \"Contract - Vehicle VIN\": \"<encrypted at rest>\", \"Customfields.Line Of Business\": \"Indirect\" }\n}"
          },
          "notes": [
            "Applicant data is encrypted with <code>IApplicationPiiEncryptor</code> (KMS envelope) before it is written."
          ],
          "refs": [
            "lending-api",
            "los-sdk"
          ],
          "labelPlain": "get app",
          "resLabel": "application",
          "resLabelPlain": "app details"
        },
        {
          "id": "a4",
          "route": [
            "api",
            "db"
          ],
          "label": "upsert",
          "phase": "Import",
          "title": "Application data is saved",
          "story": "The application and a record of this import are saved. If the application already exists, it's updated in place.",
          "call": {
            "verb": "SQL",
            "text": "UPSERT LoanApplications; INSERT ImportRuns, ImportItems"
          },
          "tables": [
            {
              "name": "LoanApplications",
              "op": "UPSERT",
              "cols": [
                [
                  "Id, TenantId",
                  "the Lending application id"
                ],
                [
                  "InternalApplicationId",
                  "LOS application number (234892)"
                ],
                [
                  "…",
                  "deal, applicants and vehicle (PII encrypted)"
                ]
              ],
              "sql": "INSERT INTO \"LoanApplications\"\n  (\"Id\", \"TenantId\", \"InternalApplicationId\", \"EncryptedDeal\",\n   \"EncryptedApplicants\", \"EncryptedVehicle\", \"UpdatedAt\")\nVALUES (@id, @tenant, '234892', @deal, @applicants, @vehicle, now())\nON CONFLICT (\"TenantId\", \"InternalApplicationId\") DO UPDATE\n   SET \"EncryptedDeal\"       = excluded.\"EncryptedDeal\",\n       \"EncryptedApplicants\" = excluded.\"EncryptedApplicants\",\n       \"EncryptedVehicle\"    = excluded.\"EncryptedVehicle\",\n       \"UpdatedAt\"           = now()\nRETURNING \"Id\";"
            },
            {
              "name": "ImportRuns",
              "op": "INSERT",
              "cols": [
                [
                  "Id",
                  "importRunId returned to LOS"
                ],
                [
                  "Status, SuccessfulCount",
                  "Completed, 1"
                ],
                [
                  "IdempotencyKey, RequestFingerprintSha256",
                  "from X-LOS-Delivery-Id, so a redelivery replays"
                ],
                [
                  "ImportMode, DryRun",
                  "Upsert, false"
                ]
              ],
              "sql": "-- a redelivery with the same key and fingerprint replays this run instead\nINSERT INTO \"ImportRuns\"\n  (\"Id\", \"TenantId\", \"IdempotencyKey\", \"RequestFingerprintSha256\",\n   \"ImportMode\", \"DryRun\", \"Status\", \"SuccessfulCount\", \"CreatedAt\")\nVALUES ('ed883ebe-…', '7d0e1c4a-…', @deliveryId, @fingerprint,\n        'Upsert', false, 'Completed', 1, now());"
            },
            {
              "name": "ImportItems",
              "op": "INSERT",
              "cols": [
                [
                  "ImportRunId",
                  "→ ImportRuns"
                ],
                [
                  "ApplicationNumber, Status",
                  "Succeeded"
                ]
              ],
              "sql": "INSERT INTO \"ImportItems\" (\"Id\", \"ImportRunId\", \"ApplicationNumber\", \"Status\")\nVALUES (@id, 'ed883ebe-…', '234892', 'Succeeded');"
            }
          ],
          "refs": [
            "lending-api",
            "lending-database"
          ],
          "labelPlain": "save app"
        },
        {
          "id": "a5",
          "route": [
            "api",
            "db"
          ],
          "label": "queue sync",
          "phase": "Queue",
          "title": "A document copy job is queued",
          "story": "Because documents were added, the API adds a \"copy this application's documents\" job to a queue. It doesn't wait for the copy, so LOS gets its answer in under a second.",
          "why": "LOS files can be large (one test package was 22 MB), so copying happens in the background.",
          "call": {
            "verb": "SQL",
            "text": "INSERT INTO \"DocumentSyncs\" (...) -- only if this import run has no sync yet"
          },
          "req": {
            "cap": "What is written",
            "lang": "sql",
            "body": "-- LosDocumentSyncQueue looks up the run's sync first (a replay finds it);\n-- UX_DocumentSyncs_ImportRun (TenantId, ImportRunId) is the backstop.\nINSERT INTO \"DocumentSyncs\"\n  (\"Id\", \"TenantId\", \"LoanApplicationId\", \"ApplicationNumber\",\n   \"ImportRunId\", \"Status\", \"AttemptCount\", \"NextAttemptAt\")\nVALUES\n  ('4b1f0d2e-…', '7d0e1c4a-…', 'e6af9133-…', '234892',\n   'ed883ebe-…', 'Pending', 0, now());"
          },
          "tables": [
            {
              "name": "DocumentSyncs",
              "op": "INSERT",
              "cols": [
                [
                  "Status",
                  "Pending"
                ],
                [
                  "AttemptCount",
                  "0"
                ],
                [
                  "NextAttemptAt",
                  "now (set if and only if Pending)"
                ],
                [
                  "ImportRunId",
                  "one sync per import run; must be the same tenant's run"
                ]
              ],
              "sql": "-- LosDocumentSyncQueue looks up the run's sync first (a replay finds it);\n-- UX_DocumentSyncs_ImportRun (TenantId, ImportRunId) is the backstop.\nINSERT INTO \"DocumentSyncs\"\n  (\"Id\", \"TenantId\", \"LoanApplicationId\", \"ApplicationNumber\",\n   \"ImportRunId\", \"Status\", \"AttemptCount\", \"NextAttemptAt\")\nVALUES\n  ('4b1f0d2e-…', '7d0e1c4a-…', 'e6af9133-…', '234892',\n   'ed883ebe-…', 'Pending', 0, now());"
            }
          ],
          "notes": [
            "Sent twice with the same delivery id? The second call replays the import and reaches the same sync. The metric <code>LosDocumentSyncSkipped</code> counts it with <code>reason=already_queued</code>.",
            "If the insert fails, the API answers <code>503 los-webhook.document-sync-unavailable</code>. The import is already saved, so LOS's redelivery replays it and queues the sync."
          ],
          "refs": [
            "lending-api",
            "lending-database"
          ],
          "labelPlain": "add job"
        },
        {
          "id": "a6",
          "route": [
            "api",
            "los"
          ],
          "label": "200 OK",
          "kind": "response",
          "phase": "Queue",
          "title": "API replies: received",
          "story": "LOS gets a short \"received\" answer with our import number. No applicant data is sent back unless LOS asks for it.",
          "call": {
            "verb": "200",
            "text": "application/json · ApplicationEnvelope"
          },
          "res": {
            "cap": "Response",
            "lang": "json",
            "body": "{\n  \"data\": {\n    \"importRunId\": \"ed883ebe-4910-40a1-b2c0-94e079a678c8\",\n    \"status\": \"Completed\",\n    \"requestedCount\": 1,\n    \"successfulCount\": 1,\n    \"failedCount\": 0,\n    \"items\": [\n      {\n        \"applicationNumber\": \"234892\",\n        \"loanApplicationId\": \"e6af9133-76d9-4216-9b68-48cde4c33c02\",\n        \"status\": \"Succeeded\",\n        \"errorCode\": null,\n        \"errorMessage\": null,\n        \"providerHttpStatusCode\": 200,\n        \"providerDurationMilliseconds\": 842,\n        \"application\": null\n      }\n    ]\n  },\n  \"meta\": {\n    \"correlationId\": \"ac6a5a282dddc14faf52381a51d31461\",\n    \"requestId\": \"0HNLAMTVE1SNT:00000001\",\n    \"timestamp\": \"2026-11-06T09:12:41.870Z\"\n  }\n}"
          },
          "notes": [
            "<code>includeApplication=true</code> would add the saved application to each item. It shapes only the response, so it isn't part of the request fingerprint."
          ],
          "refs": [
            "lending-api",
            "los-sdk"
          ],
          "labelPlain": "got it"
        },
        {
          "id": "a7",
          "route": [
            "sched",
            "worker"
          ],
          "label": "sweep",
          "kind": "async",
          "phase": "Sweep",
          "title": "Every 5 minutes, the document worker wakes",
          "story": "A clock wakes the document worker every five minutes. It runs one at a time, so two workers never fight over the same job.",
          "call": {
            "verb": "AWS",
            "text": "Lambda Invoke (async) …-compute-los-document-jobs"
          },
          "req": {
            "cap": "Event",
            "lang": "json",
            "body": "{\n  \"job\": \"sweep\",\n  \"scheduledTime\": \"2026-11-06T09:15:00Z\",\n  \"executionId\": \"d32c5kddcf5bb8c3\"\n}"
          },
          "res": {
            "cap": "If the flag is off",
            "lang": "json",
            "body": "{ \"job\": \"sweep\", \"status\": \"disabled\" }"
          },
          "kv": [
            [
              "Actor",
              "system:los-document-jobs:sync (audit rows trace back to the webhook call)"
            ],
            [
              "Budget",
              "300 s less a 15 s shutdown margin; stops claiming with under 60 s left"
            ]
          ],
          "refs": [
            "infrastructure",
            "lending-api · DocumentSync"
          ],
          "labelPlain": "wake up",
          "roundTrip": false
        },
        {
          "id": "a8",
          "route": [
            "worker",
            "db"
          ],
          "label": "claim",
          "phase": "Sweep",
          "title": "Worker picks the oldest waiting job",
          "story": "The worker takes the oldest waiting copy job, marks it \"in progress\" and holds it for 12 minutes, so no other run can take it at the same time.",
          "why": "Lenders whose jobs have waited longest go first, so one busy lender can't starve the others.",
          "call": {
            "verb": "SQL",
            "text": "SELECT … FOR UPDATE SKIP LOCKED; UPDATE … SET Status = 'InProgress'"
          },
          "req": {
            "cap": "Claim (one short transaction per tenant)",
            "lang": "sql",
            "body": "-- 1. recover leases that expired (worker died mid-copy)\nUPDATE \"DocumentSyncs\" SET \"Status\" = 'Pending', \"NextAttemptAt\" = now(), \"LeaseExpiresAt\" = NULL\n WHERE \"Status\" = 'InProgress' AND \"LeaseExpiresAt\" < now();\n\n-- 2. claim the oldest due sync of an application with no sync in progress\nSELECT s.\"Id\" FROM \"DocumentSyncs\" s\n WHERE s.\"TenantId\" = @tenant AND s.\"Status\" = 'Pending' AND s.\"NextAttemptAt\" <= now()\n   AND NOT EXISTS (SELECT 1 FROM \"DocumentSyncs\" r\n                    WHERE r.\"LoanApplicationId\" = s.\"LoanApplicationId\" AND r.\"Status\" = 'InProgress')\n ORDER BY s.\"CreatedAt\", s.\"Id\"\n LIMIT 1\n FOR UPDATE SKIP LOCKED;\n\nUPDATE \"DocumentSyncs\"\n   SET \"Status\" = 'InProgress', \"AttemptCount\" = \"AttemptCount\" + 1,\n       \"LeaseExpiresAt\" = now() + interval '12 minutes', \"NextAttemptAt\" = NULL\n WHERE \"Id\" = @id;"
          },
          "tables": [
            {
              "name": "DocumentSyncs",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "Pending → InProgress"
                ],
                [
                  "AttemptCount",
                  "+1 exactly (the database enforces this)"
                ],
                [
                  "LeaseExpiresAt",
                  "now + 12 min (set if and only if InProgress)"
                ],
                [
                  "UX_DocumentSyncs_InProgressApplication",
                  "at most one sync in progress per application"
                ]
              ],
              "sql": "-- 1. recover leases that expired (worker died mid-copy)\nUPDATE \"DocumentSyncs\" SET \"Status\" = 'Pending', \"NextAttemptAt\" = now(), \"LeaseExpiresAt\" = NULL\n WHERE \"Status\" = 'InProgress' AND \"LeaseExpiresAt\" < now();\n\n-- 2. claim the oldest due sync of an application with no sync in progress\nSELECT s.\"Id\" FROM \"DocumentSyncs\" s\n WHERE s.\"TenantId\" = @tenant AND s.\"Status\" = 'Pending' AND s.\"NextAttemptAt\" <= now()\n   AND NOT EXISTS (SELECT 1 FROM \"DocumentSyncs\" r\n                    WHERE r.\"LoanApplicationId\" = s.\"LoanApplicationId\" AND r.\"Status\" = 'InProgress')\n ORDER BY s.\"CreatedAt\", s.\"Id\"\n LIMIT 1\n FOR UPDATE SKIP LOCKED;\n\nUPDATE \"DocumentSyncs\"\n   SET \"Status\" = 'InProgress', \"AttemptCount\" = \"AttemptCount\" + 1,\n       \"LeaseExpiresAt\" = now() + interval '12 minutes', \"NextAttemptAt\" = NULL\n WHERE \"Id\" = @id;"
            }
          ],
          "notes": [
            "An expired lease after 6 attempts ends the sync <code>Failed</code> with <code>lease_expired</code>."
          ],
          "refs": [
            "lending-api · DocumentSync",
            "lending-database"
          ],
          "labelPlain": "pick job"
        },
        {
          "id": "a9",
          "route": [
            "worker",
            "los"
          ],
          "label": "fetch docs",
          "phase": "Copy",
          "title": "Worker downloads the documents from LOS",
          "story": "The worker asks LOS for every document on the application. They arrive together in one response.",
          "call": {
            "verb": "SDK",
            "text": "ILosApplicationDocumentClient.FetchDocumentsAsync(\"234892\", ct)"
          },
          "kv": [
            [
              "Data source",
              "LOS \"documents fetch\""
            ],
            [
              "Secret",
              "Los__DocumentsFetchSecretName"
            ],
            [
              "Limits",
              "256 MiB response cap · 240 s total · 120 s per attempt"
            ],
            [
              "Real sizes",
              "One real package: 2.9 MB, 19 PDFs. One QA response: 22 MB"
            ]
          ],
          "res": {
            "cap": "LosApplicationDocuments (SDK result)",
            "lang": "json",
            "body": "{\n  \"files\": [\n    {\n      \"imageId\": \"7741053\",\n      \"fileName\": \"<encrypted before storage>\",\n      \"declaredContentType\": \"application/pdf\",\n      \"content\": \"<decoded bytes, 183,211>\",\n      \"sourceUpdatedAt\": \"2026-11-06T09:08:12Z\",\n      \"sourceUpdatedBy\": \"<encrypted before storage>\"\n    }\n  ],\n  \"documentList\": [ { \"IMAGE_ID\": \"7741053\", \"DOCTYPE\": \"Contract\", \"VERSION\": \"2\" } ],\n  \"rejectedFiles\": [],\n  \"byteCount\": 2984113,\n  \"sha256\": \"9f2c…e41a\"\n}"
          },
          "notes": [
            "The fetch's timing, size and SHA-256 are recorded on the sync.",
            "After the first timeout or 5xx in a run, the worker claims nothing more until the next run, so an outage costs one attempt per run, not one per queued job."
          ],
          "refs": [
            "lending-api · DocumentSync",
            "los-sdk"
          ],
          "labelPlain": "get docs",
          "resLabel": "documents",
          "resLabelPlain": "documents"
        },
        {
          "id": "a9x",
          "alt": true,
          "after": "a9",
          "route": [
            "worker",
            "db"
          ],
          "label": "retry later",
          "kind": "failure",
          "phase": "What if",
          "title": "What if LOS is slow or down?",
          "story": "The job goes back in the queue with a wait that grows each time. After its last attempt it is marked failed and an alarm tells the team.",
          "call": {
            "verb": "SQL",
            "text": "UPDATE DocumentSyncs SET Status = 'Pending', NextAttemptAt = now() + backoff"
          },
          "tables": [
            {
              "name": "DocumentSyncs",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "InProgress → Pending (transient) or Failed (permanent or last attempt)"
                ],
                [
                  "SanitizedErrorCode",
                  "e.g. los_timeout, los_transient_http, budget_exhausted, empty_response_with_stored_documents"
                ],
                [
                  "NextAttemptAt",
                  "backoff schedule (code default)"
                ]
              ],
              "sql": "UPDATE \"DocumentSyncs\"\n   SET \"Status\"             = 'Pending',     -- 'Failed' if permanent or last attempt\n       \"SanitizedErrorCode\" = 'los_timeout',\n       \"NextAttemptAt\"      = now() + interval '5 minutes',  -- backoff schedule\n       \"LeaseExpiresAt\"     = NULL\n WHERE \"Id\" = @syncId AND \"Status\" = 'InProgress';"
            }
          ],
          "notes": [
            "A 401 or 403 that survives the SDK's token refresh, or an open circuit breaker, is treated as a whole-run failure. The sync is released without counting the attempt, and the invocation throws so the errors alarm pages.",
            "A run cut short by its time budget gives the attempt back, except on the run's first sync, which counts as <code>budget_exhausted</code>."
          ],
          "refs": [
            "lending-api · DocumentSync",
            "lending-database"
          ],
          "labelPlain": "try later"
        },
        {
          "id": "a10",
          "route": [
            "worker"
          ],
          "label": "diff",
          "kind": "internal",
          "phase": "Copy",
          "title": "Worker works out what changed",
          "story": "Each file is checked (a real PDF or image, under 50 MB) and compared with what we already have: new, new version, changed, retyped, back again, or removed from LOS.",
          "why": "We keep every version. Nothing is overwritten, so a review can always point at the exact file it read.",
          "call": {
            "verb": "IN",
            "text": "LosDocumentChangePlanner (in-process)"
          },
          "req": {
            "cap": "Change rules (per LOS IMAGE_ID)",
            "lang": "text",
            "body": "No stored row                         → New            upload, first row\nOpen row, same SHA-256 + version + type → Unchanged     nothing written\nSame SHA-256 + version, new type       → Retyped        new row, no upload\nDifferent version                      → NewVersion     upload, close old row\nSame version, different SHA-256        → ContentChanged upload, close old row\nClosed row, same bytes and version     → Reappeared     new row, no upload\nOpen row missing from the response     → RemovedFromSource (only when the guards allow)"
          },
          "notes": [
            "Shortcut: if the whole response hashes the same as the last successful sync, nothing changed, and nothing is written but the counts.",
            "Never closes everything: an empty response with stored documents is a transient failure (<code>empty_response_with_stored_documents</code>).",
            "Type is detected from the file's leading bytes (PDF, JPEG, PNG, TIFF). Anything else is rejected, the rest are kept, and the sync ends <code>PartiallySucceeded</code>."
          ],
          "refs": [
            "lending-api · DocumentSync"
          ],
          "labelPlain": "compare"
        },
        {
          "id": "a11",
          "route": [
            "worker",
            "s3"
          ],
          "label": "PutObject",
          "phase": "Store",
          "title": "New files are saved to storage",
          "story": "Each new or changed file is uploaded, encrypted, four at a time. Storage paths never contain file names, which can hold a customer's name.",
          "call": {
            "verb": "AWS",
            "text": "S3 PutObject  los/tenants/{tenantId}/applications/{loanApplicationId}/images/{imageId}/v{version}-{sha256}{ext}"
          },
          "req": {
            "cap": "PutObject (per file)",
            "lang": "http",
            "body": "PUT /los/tenants/7d0e1c4a-…/applications/e6af9133-…/images/7741053/v2-3b8f…c19d.pdf\nIf-None-Match: *\nx-amz-checksum-sha256: O48Ld9K…\nx-amz-server-side-encryption: aws:kms\nx-amz-server-side-encryption-aws-kms-key-id: <PII key ARN>\nContent-Type: application/pdf"
          },
          "res": {
            "cap": "Response",
            "lang": "http",
            "body": "HTTP/1.1 200 OK\nx-amz-version-id: 3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY"
          },
          "notes": [
            "<code>412</code> (the exact bytes are already there from a run that died before saving its row): put again without the condition to get a version id, and count it as uploaded."
          ],
          "refs": [
            "lending-api · DocumentSync",
            "infrastructure"
          ],
          "labelPlain": "store files",
          "resLabel": "200 ETag",
          "resLabelPlain": "saved"
        },
        {
          "id": "a12",
          "route": [
            "worker",
            "s3"
          ],
          "label": "manifest",
          "phase": "Store",
          "title": "A receipt of the copy is saved",
          "story": "A small receipt lists what arrived and what happened to each file. It holds no file names and no personal data.",
          "call": {
            "verb": "AWS",
            "text": "S3 PutObject  …/applications/{loanApplicationId}/syncs/{yyyyMMddTHHmmssZ}-{syncId}/manifest.json"
          },
          "req": {
            "cap": "manifest.json",
            "lang": "json",
            "body": "{\n  \"responseByteCount\": 2984113,\n  \"responseSha256\": \"9f2c…e41a\",\n  \"fetchedAt\": \"2026-11-06T09:15:04Z\",\n  \"files\": [\n    { \"imageId\": \"7741053\", \"documentType\": \"Contract\", \"version\": 2,\n      \"declaredContentType\": \"application/pdf\", \"detectedContentType\": \"application/pdf\",\n      \"byteCount\": 183211, \"sha256\": \"3b8f…c19d\", \"sourceUpdatedAt\": \"2026-11-06T09:08:12Z\",\n      \"outcome\": \"NewVersion\", \"objectKey\": \"…/images/7741053/v2-3b8f…c19d.pdf\" }\n  ],\n  \"rejected\": []\n}"
          },
          "refs": [
            "lending-api · DocumentSync",
            "infrastructure"
          ],
          "labelPlain": "receipt"
        },
        {
          "id": "a13",
          "route": [
            "worker",
            "db"
          ],
          "label": "commit",
          "phase": "Store",
          "title": "Document records are saved; the job is done",
          "story": "In one go, older versions are closed, the new versions are recorded and the job is marked done. Any older jobs for the same application are folded into this one.",
          "why": "These document records are what the review in route B reads. Everything is in place for it.",
          "call": {
            "verb": "SQL",
            "text": "BEGIN; UPDATE/INSERT ApplicationDocuments; UPDATE DocumentSyncs; COMMIT;"
          },
          "tables": [
            {
              "name": "ApplicationDocuments",
              "op": "UPDATE then INSERT",
              "cols": [
                [
                  "ClosedAt, ClosedReason, ClosedBySyncId",
                  "old version closed first (Superseded or RemovedFromSource)"
                ],
                [
                  "SourceImageIdentifier",
                  "LOS IMAGE_ID"
                ],
                [
                  "Sha256Hash, ObjectKey, ObjectVersionId",
                  "where the bytes live"
                ],
                [
                  "EncryptedFileName, EncryptedSourceUpdatedBy",
                  "PII, KMS-envelope ciphertext"
                ],
                [
                  "ChangeReason, PreviousDocumentId, AddedBySyncId",
                  "the version chain"
                ]
              ],
              "sql": "-- 1. close the version being replaced\nUPDATE \"ApplicationDocuments\"\n   SET \"ClosedAt\" = now(), \"ClosedReason\" = 'Superseded', \"ClosedBySyncId\" = @syncId\n WHERE \"Id\" = @previousId AND \"ClosedAt\" IS NULL;\n\n-- 2. add the new version\nINSERT INTO \"ApplicationDocuments\"\n  (\"Id\", \"TenantId\", \"LoanApplicationId\", \"SourceImageIdentifier\", \"Sha256Hash\",\n   \"ObjectKey\", \"ObjectVersionId\", \"EncryptedFileName\", \"EncryptedSourceUpdatedBy\",\n   \"ChangeReason\", \"PreviousDocumentId\", \"AddedBySyncId\")\nVALUES (@id, @tenant, @app, '88120', @sha256,\n        @objectKey, @versionId, @fileName, @updatedBy,\n        'Updated', @previousId, @syncId);"
            },
            {
              "name": "DocumentSyncs",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "InProgress → Succeeded (or PartiallySucceeded)"
                ],
                [
                  "RowsAddedCount, RowsClosedCount, BytesUploaded",
                  "counted across every attempt"
                ],
                [
                  "ManifestObjectKey, CompletedAt",
                  ""
                ],
                [
                  "older Pending syncs",
                  "→ Coalesced into this one (it must have succeeded by commit)"
                ]
              ],
              "sql": "UPDATE \"DocumentSyncs\"\n   SET \"Status\"            = 'Succeeded',\n       \"RowsAddedCount\"    = \"RowsAddedCount\" + @added,\n       \"RowsClosedCount\"   = \"RowsClosedCount\" + @closed,\n       \"BytesUploaded\"     = \"BytesUploaded\" + @bytes,\n       \"ManifestObjectKey\" = @manifestKey,\n       \"CompletedAt\"       = now(),\n       \"LeaseExpiresAt\"    = NULL\n WHERE \"Id\" = @syncId;\n\n-- older waiting syncs of the same application are covered by this one\nUPDATE \"DocumentSyncs\"\n   SET \"Status\" = 'Coalesced', \"CoalescedIntoSyncId\" = @syncId, \"NextAttemptAt\" = NULL\n WHERE \"LoanApplicationId\" = @app AND \"Status\" = 'Pending' AND \"CreatedAt\" < @claimedCreatedAt;"
            }
          ],
          "notes": [
            "Rows are append-only: inserted open, closed once, never deleted. The app role may update only the closing columns."
          ],
          "refs": [
            "lending-api · DocumentSync",
            "lending-database"
          ],
          "labelPlain": "done"
        }
      ],
      "desc": "LOS webhook → stored files"
    },
    "b": {
      "code": "B",
      "title": "Review runs",
      "lanes": [
        "portal",
        "api",
        "sched",
        "sweep",
        "flags",
        "sfn",
        "steps",
        "db",
        "s3",
        "textract",
        "bedrock"
      ],
      "steps": [
        {
          "id": "b1",
          "route": [
            "sched",
            "sweep"
          ],
          "label": "sweep",
          "kind": "async",
          "phase": "Sweep",
          "title": "Every 5 minutes, the review sweep wakes",
          "story": "A clock wakes the review sweep every five minutes to look for applications whose documents changed since their last review.",
          "call": {
            "verb": "AWS",
            "text": "Lambda Invoke (async) …-compute-funding-review-jobs"
          },
          "req": {
            "cap": "Event",
            "lang": "json",
            "body": "{\n  \"job\": \"sweep\",\n  \"scheduledTime\": \"2026-11-06T09:20:00Z\",\n  \"executionId\": \"f81a3c0d7e2b44c1\"\n}"
          },
          "kv": [
            [
              "Schedule",
              "…-funding-review-sweep, rate(5 minutes), no scheduler retries"
            ],
            [
              "Actor",
              "system:funding-review-jobs:<executionId>"
            ]
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview"
          ],
          "labelPlain": "wake up"
        },
        {
          "id": "b2",
          "route": [
            "sweep",
            "flags"
          ],
          "label": "flag?",
          "phase": "Sweep",
          "title": "Are reviews switched on?",
          "story": "The sweep checks the review switch. While it's off, the sweep does nothing and returns at once.",
          "why": "Every environment has the review system installed but idle. Turning it on is a switch, not a release.",
          "call": {
            "verb": "SDK",
            "text": "IFeatureFlagsProvider → FeatureFlags.FundingReviewSweep"
          },
          "res": {
            "cap": "Flag value, and the sweep's reply when it's off",
            "lang": "json",
            "body": "{ \"funding-review-sweep\": { \"enabled\": true } }\n\n// when disabled the sweep returns:\n{ \"job\": \"sweep\", \"status\": \"disabled\" }"
          },
          "refs": [
            "lending-api · FundingReview",
            "infrastructure"
          ],
          "labelPlain": "switched on?",
          "resLabel": "enabled: true",
          "resLabelPlain": "it's on"
        },
        {
          "id": "b3",
          "route": [
            "sweep",
            "db"
          ],
          "label": "candidates",
          "phase": "Sweep",
          "title": "Find applications whose documents changed",
          "story": "For each lender, the sweep compares every application's current documents with the set its last review covered. Only changed ones with nothing already running qualify, and only a few run at once.",
          "why": "The review is costly (AI reads every page), so it runs only when the package actually changed, and never piles up.",
          "call": {
            "verb": "SQL",
            "text": "candidate read per tenant (row-level security), 30 s statement timeout"
          },
          "req": {
            "cap": "What it compares (simplified)",
            "lang": "text",
            "body": "Candidate = an application with an active run,\n            or with no run yet,\n            or whose open document ids differ from its latest run's DocumentIds.\n\nDocumentSetHash = SHA-256 over the sorted lines \"{Id}:{Sha256Hash}\" of the\n                  application's open ApplicationDocuments versions.\n\nCapacity        = MaxActiveRuns (steps reserved concurrency ÷ document concurrency = 2)\n                  − runs Queued or Running across every tenant.\nOrder           = the change that has waited longest gets the next slot."
          },
          "tables": [
            {
              "name": "ApplicationDocuments",
              "op": "READ",
              "cols": [
                [
                  "Id, Sha256Hash",
                  "open versions only (ClosedAt IS NULL)"
                ]
              ],
              "sql": "SELECT d.\"LoanApplicationId\", d.\"Id\", d.\"Sha256Hash\"\n  FROM \"ApplicationDocuments\" d\n WHERE d.\"TenantId\" = @tenant AND d.\"ClosedAt\" IS NULL\n ORDER BY d.\"LoanApplicationId\", d.\"Id\";\n-- DocumentSetHash = SHA-256 of the sorted \"{Id}:{Sha256Hash}\" lines, computed in code"
            },
            {
              "name": "FundingReviewRuns",
              "op": "READ",
              "cols": [
                [
                  "Status, DocumentIds, DocumentSetHash",
                  "latest and active runs"
                ]
              ],
              "sql": "-- latest run per application\nSELECT DISTINCT ON (r.\"LoanApplicationId\")\n       r.\"LoanApplicationId\", r.\"Id\", r.\"Status\", r.\"DocumentIds\", r.\"DocumentSetHash\"\n  FROM \"FundingReviewRuns\" r\n WHERE r.\"TenantId\" = @tenant\n ORDER BY r.\"LoanApplicationId\", r.\"QueuedAt\" DESC;\n\n-- capacity left: runs already active\nSELECT count(*) FROM \"FundingReviewRuns\" WHERE \"Status\" IN ('Queued', 'Running');"
            },
            {
              "name": "DocumentSyncs",
              "op": "READ",
              "cols": [
                [
                  "Status",
                  "wait while a copy is Pending or InProgress"
                ]
              ],
              "sql": "-- these applications wait: their documents are still being copied\nSELECT DISTINCT \"LoanApplicationId\"\n  FROM \"DocumentSyncs\"\n WHERE \"TenantId\" = @tenant AND \"Status\" IN ('Pending', 'InProgress');"
            }
          ],
          "notes": [
            "A run still <code>Running</code> after 75 minutes is marked Failed (<code>execution_timed_out</code>) so the application can be reviewed again. A Queued run whose execution has already closed is retired as <code>execution_ended</code>.",
            "Changes beyond the cap wait for a later sweep (<code>deferred_at_capacity</code>)."
          ],
          "refs": [
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "find changes"
        },
        {
          "id": "b4",
          "route": [
            "sweep",
            "db"
          ],
          "label": "queue run",
          "phase": "Sweep",
          "title": "A review is queued for the changed package",
          "story": "The sweep records a new review with the exact documents it will read, and a sealed copy of LOS's deal data to cross-check against.",
          "call": {
            "verb": "SQL",
            "text": "INSERT INTO \"FundingReviewRuns\" (…) -- under a per-application advisory lock"
          },
          "tables": [
            {
              "name": "FundingReviewRuns",
              "op": "INSERT",
              "cols": [
                [
                  "Status, Trigger",
                  "Queued, Sweep"
                ],
                [
                  "DocumentIds",
                  "the fixed set of open versions (must be open, same application)"
                ],
                [
                  "DocumentSetHash",
                  "must match those versions"
                ],
                [
                  "PreviousRunId",
                  "the application's latest run (one chain per application)"
                ],
                [
                  "EncryptedLosBlock",
                  "cross-check block, KMS-envelope ciphertext"
                ],
                [
                  "QueuedAt",
                  "now; StartedAt stays null until the workflow begins"
                ]
              ],
              "sql": "SELECT pg_advisory_xact_lock(@applicationLockKey);  -- one sweep per application\n\nINSERT INTO \"FundingReviewRuns\"\n  (\"Id\", \"TenantId\", \"LoanApplicationId\", \"Status\", \"Trigger\", \"DocumentIds\",\n   \"DocumentSetHash\", \"PreviousRunId\", \"EncryptedLosBlock\", \"QueuedAt\")\nVALUES ('0195f6d1-…', @tenant, @app, 'Queued', 'Sweep', ARRAY[@doc1, @doc2, @doc3],\n        @setHash, @latestRunId, @losBlock, now());"
            }
          ],
          "notes": [
            "The lock re-checks that no run is active and that the latest run hasn't changed. If another sweep won, nothing is queued (<code>skipped_already_queued</code>)."
          ],
          "refs": [
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "add review"
        },
        {
          "id": "b5",
          "route": [
            "sweep",
            "sfn"
          ],
          "label": "start",
          "phase": "Sweep",
          "title": "The review workflow is started",
          "story": "The sweep starts the review workflow and hands it only two IDs: which review, and which lender. No customer data travels with it.",
          "call": {
            "verb": "AWS",
            "text": "states:StartExecution  funding-review"
          },
          "req": {
            "cap": "StartExecution",
            "lang": "json",
            "body": "{\n  \"stateMachineArn\": \"arn:aws:states:us-east-1:<account>:stateMachine:acme-dev-lending-funding-review\",\n  \"name\": \"run-0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\",\n  \"input\": \"{\\\"runId\\\":\\\"0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\\\",\\\"tenantId\\\":\\\"7d0e1c4a-2b6f-4c8e-9a1d-3f5b8c2e6a10\\\"}\"\n}"
          },
          "res": {
            "cap": "Response",
            "lang": "json",
            "body": "{\n  \"executionArn\": \"arn:aws:states:us-east-1:<account>:execution:acme-dev-lending-funding-review:run-0195f6d1-…\",\n  \"startDate\": \"2026-11-06T09:20:03Z\"\n}"
          },
          "notes": [
            "Naming the execution after the run makes starting idempotent: <code>ExecutionAlreadyExists</code> counts as success, so a retry never starts two reviews."
          ],
          "refs": [
            "lending-api · FundingReview",
            "infrastructure"
          ],
          "labelPlain": "start",
          "resLabel": "executionArn",
          "resLabelPlain": "started"
        },
        {
          "id": "b6",
          "route": [
            "sfn",
            "steps",
            "db"
          ],
          "label": "Begin",
          "phase": "Begin",
          "title": "Begin: plan which documents to read",
          "story": "The workflow's first step marks the review as running and decides how to read each document. A contract gets the contract reader, a driver's licence the licence reader, and so on.",
          "call": {
            "verb": "AWS",
            "text": "Lambda Invoke (sync) funding-review-steps · event step=Begin"
          },
          "req": {
            "cap": "Step event",
            "lang": "json",
            "body": "{\n  \"step\": \"Begin\",\n  \"runId\": \"0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\",\n  \"tenantId\": \"7d0e1c4a-2b6f-4c8e-9a1d-3f5b8c2e6a10\",\n  \"executionArn\": \"arn:aws:states:…:execution:…:run-0195f6d1-…\"\n}"
          },
          "res": {
            "cap": "Step response (ids only, kept in execution history)",
            "lang": "json",
            "body": "{\n  \"step\": \"Begin\",\n  \"status\": \"Running\",\n  \"documentIds\": [\n    \"0195f6d1-0a01-…\",\n    \"0195f6d1-0a02-…\",\n    \"0195f6d1-0a03-…\"\n  ]\n}"
          },
          "kv": [
            [
              "Engine call",
              "IDocumentReviewEngine.PlanAsync({ pack: \"funding\", documents: [{ documentId, typeName }] })"
            ],
            [
              "Skipped",
              "A document type with no schema is stored as Skipped and left out of documentIds"
            ]
          ],
          "tables": [
            {
              "name": "FundingReviewDocumentResults",
              "op": "INSERT",
              "cols": [
                [
                  "RunId, ApplicationDocumentId",
                  "one row per version"
                ],
                [
                  "Status",
                  "Pending (has a schema) or Skipped"
                ],
                [
                  "IndexTag, SchemaId, Sha256Hash",
                  "from the plan"
                ]
              ],
              "sql": "INSERT INTO \"FundingReviewDocumentResults\"\n  (\"Id\", \"RunId\", \"ApplicationDocumentId\", \"Status\", \"IndexTag\", \"SchemaId\", \"Sha256Hash\")\nVALUES\n  (@r1, @run, @doc1, 'Pending', 'RIC',   'ric-v4',             @sha1),\n  (@r2, @run, @doc2, 'Pending', 'DL',    'drivers-license-v2', @sha2),\n  (@r3, @run, @doc3, 'Skipped', 'OTHER', NULL,                 @sha3);"
            },
            {
              "name": "FundingReviewRuns",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "Queued → Running"
                ],
                [
                  "StartedAt, ExecutionArn, Versions",
                  "set once (code, rules, prompt, parse, method, model, reads)"
                ]
              ],
              "sql": "UPDATE \"FundingReviewRuns\"\n   SET \"Status\" = 'Running', \"StartedAt\" = now(), \"ExecutionArn\" = @executionArn,\n       \"Versions\" = @versions::jsonb, \"CurrentStep\" = 'Begin'\n WHERE \"Id\" = @run AND \"Status\" = 'Queued';"
            }
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "plan",
          "resLabel": "plan",
          "resLabelPlain": "plan ready"
        },
        {
          "id": "b7",
          "route": [
            "sfn",
            "steps",
            "s3"
          ],
          "label": "Document",
          "phase": "Read documents",
          "title": "Read each document: fetch the file",
          "story": "For each document (a few at a time), the worker fetches the original file. If it has read these exact bytes before, it reuses that reading and skips straight to saving.",
          "why": "Re-running a review after one new upload doesn't pay to re-read every unchanged document.",
          "call": {
            "verb": "AWS",
            "text": "S3 GetObject  los/tenants/{tenantId}/…/images/{imageId}/v{version}-{sha256}.pdf?versionId=…"
          },
          "req": {
            "cap": "Step event (Map iteration, MaxConcurrency 2 in dev, 4 in prod)",
            "lang": "json",
            "body": "{\n  \"step\": \"Document\",\n  \"runId\": \"0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\",\n  \"tenantId\": \"7d0e1c4a-2b6f-4c8e-9a1d-3f5b8c2e6a10\",\n  \"documentId\": \"0195f6d1-0a01-…\"\n}"
          },
          "kv": [
            [
              "Cache key",
              "DocumentExtractions: tenant, content hash, schema, schema version, method, model, reads, parse version"
            ],
            [
              "Cache hit",
              "result Reused, no OCR and no AI call (unless the trigger is Reread)"
            ],
            [
              "Locks",
              "the run FOR NO KEY UPDATE, the result row FOR UPDATE; a stopped run → RunNotActive"
            ]
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview"
          ],
          "labelPlain": "get file"
        },
        {
          "id": "b8",
          "route": [
            "steps",
            "textract"
          ],
          "label": "OCR",
          "phase": "Read documents",
          "title": "Scanned pages are turned into text",
          "story": "Pages that are photos or scans are sent to a text reader, one page at a time. Pages that already contain text skip this.",
          "call": {
            "verb": "AWS",
            "text": "textract:DetectDocumentText (synchronous, page image bytes in the request)"
          },
          "req": {
            "cap": "Request (per scanned page)",
            "lang": "json",
            "body": "{\n  \"Document\": { \"Bytes\": \"<PNG of page 3 rendered at 200 dpi>\" }\n}"
          },
          "res": {
            "cap": "Response (summarised)",
            "lang": "json",
            "body": "{\n  \"DocumentMetadata\": { \"Pages\": 1 },\n  \"Blocks\": [\n    { \"BlockType\": \"LINE\", \"Text\": \"<line text>\", \"Confidence\": 99.1,\n      \"Geometry\": { \"BoundingBox\": { \"Left\": 0.08, \"Top\": 0.12, \"Width\": 0.41, \"Height\": 0.02 } } }\n  ]\n}"
          },
          "notes": [
            "PdfPig reads a PDF's own text layer first. Only a page with under 20 characters (under 200 if it's mostly an image) goes to Textract. Parse version: <code>pdfpig+textract-detect-text|v1</code>."
          ],
          "refs": [
            "lending-api · FundingReview",
            "documents-sdk"
          ],
          "labelPlain": "read text",
          "resLabel": "Blocks",
          "resLabelPlain": "page text"
        },
        {
          "id": "b9",
          "route": [
            "steps",
            "bedrock"
          ],
          "label": "extract",
          "phase": "Read documents",
          "title": "The AI reads the document's fields",
          "story": "An AI model reads the pages and fills in a form for that document type: names, amounts, dates, VIN, signatures. It reads more than once and the readings vote.",
          "call": {
            "verb": "AWS",
            "text": "bedrock:InvokeModel (Converse) · us.anthropic.claude-haiku-5-5 · forced tool output"
          },
          "req": {
            "cap": "Engine request (ExtractAsync)",
            "lang": "json",
            "body": "{\n  \"document\": { \"bucket\": \"<documents bucket>\", \"key\": \"los/tenants/…/v2-3b8f…c19d.pdf\",\n                \"versionId\": \"3HL4kqtJ…\", \"contentType\": \"application/pdf\", \"sha256\": \"3b8f…c19d\" },\n  \"pack\": \"funding\",\n  \"schemaId\": \"ric\",\n  \"method\": \"vision-llm\",\n  \"reads\": 3,\n  \"parse\": { \"engine\": \"pdfpig\", \"ocrEngine\": \"textract\", \"dpi\": 200 },\n  \"artifactsPrefix\": \"funding/tenants/7d0e1c4a-…/documents/3b8f…c19d/\"\n}"
          },
          "res": {
            "cap": "One field of the result (synthetic)",
            "lang": "json",
            "body": "{\n  \"key\": \"amountFinanced\", \"label\": \"Amount financed\", \"type\": \"money\",\n  \"value\": \"$24,850.00\", \"page\": 2, \"confidence\": 0.97,\n  \"reads\": 3, \"agree\": 3, \"grade\": \"A\", \"gradeReason\": \"ImageReadsAgree\"\n}"
          },
          "notes": [
            "Votes compare values with the decimal point kept, so <code>$125.00</code> never agrees with <code>$12,500</code>.",
            "Bedrock throttling raises <code>ModelThrottled</code>, which the workflow retries."
          ],
          "refs": [
            "lending-api · FundingReview",
            "documents-sdk"
          ],
          "labelPlain": "AI reads",
          "resLabel": "fields",
          "resLabelPlain": "values"
        },
        {
          "id": "b10",
          "route": [
            "steps",
            "s3"
          ],
          "label": "parse.enc",
          "phase": "Read documents",
          "title": "The reading notes are saved, encrypted",
          "story": "The text the system read is cached so it isn't read twice. It's customer text, so it's encrypted with the lender's key before it's stored.",
          "call": {
            "verb": "AWS",
            "text": "S3 PutObject  funding/tenants/{tenantId}/documents/{sha256}/… (application/octet-stream)"
          },
          "kv": [
            [
              "Wrapper",
              "FundingReviewArtifactStore around the SDK's S3 store (DecorateObjectStore)"
            ],
            [
              "Encryption",
              "IApplicationPiiEncryptor for the tenant, on top of the bucket's SSE-KMS"
            ],
            [
              "Bad cache",
              "A parse that can't be decrypted reads as missing and is parsed again"
            ]
          ],
          "refs": [
            "lending-api · FundingReview",
            "infrastructure"
          ],
          "labelPlain": "save notes"
        },
        {
          "id": "b11",
          "route": [
            "steps",
            "db"
          ],
          "label": "Read",
          "phase": "Read documents",
          "title": "The document's result is saved",
          "story": "The fields are stored encrypted, next to a value-free summary (confidence and grade, never the values), and the document is marked read.",
          "call": {
            "verb": "SQL",
            "text": "INSERT DocumentExtractions; UPDATE FundingReviewDocumentResults SET Status = 'Read'"
          },
          "tables": [
            {
              "name": "DocumentExtractions",
              "op": "INSERT",
              "cols": [
                [
                  "EncryptedFields",
                  "the extracted values"
                ],
                [
                  "FieldSummary",
                  "value-free JSON: key, label, type, page, bbox, confidence, grade, gradeReason (a code)"
                ],
                [
                  "Sha256Hash, SchemaId, Generation",
                  "cache key; rereads get the next generation"
                ],
                [
                  "Usage, CostUsd",
                  "tokens and cost of this read"
                ]
              ],
              "sql": "INSERT INTO \"DocumentExtractions\"\n  (\"Id\", \"TenantId\", \"Sha256Hash\", \"SchemaId\", \"Generation\", \"EncryptedFields\",\n   \"FieldSummary\", \"Usage\", \"CostUsd\", \"CreatedAt\")\nVALUES (@id, @tenant, @sha256, 'ric-v4', 1, @encryptedFields,\n        @fieldSummary::jsonb, @usage::jsonb, 0.0123, now());"
            },
            {
              "name": "FundingReviewDocumentResults",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "Pending → Processing → Read (or Reused)"
                ],
                [
                  "ExtractionId",
                  "matches hash and schema"
                ],
                [
                  "OcrSummary, DurationMs",
                  ""
                ]
              ],
              "sql": "UPDATE \"FundingReviewDocumentResults\"\n   SET \"Status\" = 'Read', \"ExtractionId\" = @extractionId,\n       \"OcrSummary\" = @ocrSummary::jsonb, \"DurationMs\" = 8420\n WHERE \"Id\" = @resultId AND \"Status\" = 'Processing';"
            }
          ],
          "notes": [
            "If a document can't be read, <code>DocumentFailed</code> marks only that document Failed. The rules then treat it as unreadable rather than missing."
          ],
          "refs": [
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "save result"
        },
        {
          "id": "b12",
          "route": [
            "sfn",
            "steps",
            "db"
          ],
          "label": "Rules",
          "phase": "Rules",
          "title": "Rules: check the package against the funding rules",
          "story": "With every document read, the funding rules run: do the names, VIN, amounts and dates match LOS's deal, is everything signed, is anything missing? Each check passes, fails, or needs a person.",
          "why": "These rules are the funding team's checklist, written as decision graphs so every result can be explained.",
          "call": {
            "verb": "IN",
            "text": "IDocumentReviewEngine.EvaluateAsync (GoRules ZEN graphs, in-process)"
          },
          "req": {
            "cap": "Engine request (summarised)",
            "lang": "json",
            "body": "{\n  \"pack\": \"funding\",\n  \"applicationNumber\": \"234892\",\n  \"evidence\": [ { \"documentId\": \"0195f6d1-0a01-…\", \"tag\": \"DOC2448\", \"type\": \"RIC\",\n                   \"schemaId\": \"ric\", \"fields\": [ \"…decrypted fields…\" ] } ],\n  \"losSnapshot\": \"…decrypted block…\",\n  \"runId\": \"0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\",\n  \"trigger\": \"INITIAL_PACKAGE\"\n}"
          },
          "res": {
            "cap": "Result (summarised)",
            "lang": "json",
            "body": "{\n  \"rulesVersion\": \"funding-2026.11.1\",\n  \"overall\": \"SoftFlag\",\n  \"counts\": { \"pass\": 41, \"fail\": 2, \"review\": 3, \"notApplicable\": 12 },\n  \"checks\": [ { \"seq\": 0, \"checkId\": \"RIC-001\", \"result\": \"Fail\", \"severity\": \"HardStop\", \"documentIds\": [\"0195f6d1-0a01-…\"] } ],\n  \"stips\": [ { \"stipId\": \"12\", \"name\": \"Retail Installment Contract\", \"action\": \"Leave\" } ]\n}"
          },
          "tables": [
            {
              "name": "FundingReviewCheckResults",
              "op": "INSERT",
              "cols": [
                [
                  "Seq, CheckId, Code, Family, Result, Severity",
                  "one row per check"
                ],
                [
                  "DocumentIds",
                  "must be within the run's documents"
                ],
                [
                  "EncryptedDetail",
                  "{message, values, tier, margin}"
                ]
              ],
              "sql": "INSERT INTO \"FundingReviewCheckResults\"\n  (\"Id\", \"RunId\", \"Seq\", \"CheckId\", \"Code\", \"Family\", \"Result\", \"Severity\",\n   \"DocumentIds\", \"EncryptedDetail\")\nVALUES\n  (@c1, @run, 1, 'RIC-001', 'ric_buyer_name_matches', 'Identity', 'Pass',   'Info', ARRAY[@doc1, @doc2], @detail1),\n  (@c2, @run, 2, 'RIC-003', 'ric_form_approved',      'Contract', 'Review', 'Soft', ARRAY[@doc1],        @detail2);"
            },
            {
              "name": "FundingReviewRuns",
              "op": "UPDATE",
              "cols": [
                [
                  "Overall, Counts, Versions.rules",
                  "Clean, SoftFlag or HardStop"
                ]
              ],
              "sql": "UPDATE \"FundingReviewRuns\"\n   SET \"Overall\" = 'SoftFlag', \"Counts\" = @counts::jsonb,\n       \"Versions\" = jsonb_set(\"Versions\", '{rules}', '\"2026.11.1\"'), \"CurrentStep\" = 'Rules'\n WHERE \"Id\" = @run AND \"Status\" = 'Running';"
            }
          ],
          "notes": [
            "Required values: LOS's deal data and a line of business (Indirect or Direct Refinance) are always required. A contract date and titling state are required when a contract is in the package. A missing one fails the run (see the failure branch).",
            "The rest of the result (stipulations, assignments, the deal summary) is saved encrypted at <code>funding/tenants/{tenantId}/runs/{runId}/evaluate.json.enc</code>, written only by the attempt that stores the checks."
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "check rules",
          "resLabel": "Overall",
          "resLabelPlain": "result"
        },
        {
          "id": "b12x",
          "alt": true,
          "after": "b12",
          "route": [
            "sfn",
            "steps",
            "db"
          ],
          "label": "MarkFailed",
          "kind": "failure",
          "phase": "What if",
          "title": "What if a required value is missing?",
          "story": "If, say, LOS has no line of business for the deal, the review stops instead of guessing. It's marked Failed with a reason a person can act on, and a fresh review starts once the data is fixed.",
          "call": {
            "verb": "AWS",
            "text": "Catch States.ALL → MarkFailed → Fail (FundingReviewFailed)"
          },
          "req": {
            "cap": "MarkFailed event",
            "lang": "json",
            "body": "{\n  \"step\": \"MarkFailed\",\n  \"runId\": \"0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12\",\n  \"tenantId\": \"7d0e1c4a-2b6f-4c8e-9a1d-3f5b8c2e6a10\",\n  \"failure\": { \"Rules\": { \"Error\": \"RequiredValueMissingLineOfBusiness\", \"Cause\": \"<never stored>\" } }\n}"
          },
          "tables": [
            {
              "name": "FundingReviewRuns",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "Running → Failed"
                ],
                [
                  "ErrorStep",
                  "Rules"
                ],
                [
                  "SanitizedErrorCode",
                  "required_value_missing"
                ],
                [
                  "SanitizedErrorMessage",
                  "Required value missing: line_of_business"
                ],
                [
                  "FinishedAt",
                  "now (StartedAt stays null if it never started)"
                ]
              ],
              "sql": "UPDATE \"FundingReviewRuns\"\n   SET \"Status\" = 'Failed', \"ErrorStep\" = 'Rules',\n       \"SanitizedErrorCode\"    = 'required_value_missing',\n       \"SanitizedErrorMessage\" = 'Required value missing: line_of_business',\n       \"FinishedAt\" = now()\n WHERE \"Id\" = @run AND \"Status\" IN ('Queued', 'Running');"
            }
          ],
          "notes": [
            "No check rows are written: no silent N/A and no quiet drop from Hard Stop to Soft Flag.",
            "Lambda throttles are retried for about 50 minutes first, and the sweep's 75-minute retire is the last backstop."
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "stop"
        },
        {
          "id": "b13",
          "route": [
            "sfn",
            "steps",
            "bedrock"
          ],
          "label": "2nd read",
          "phase": "Second reading",
          "title": "Second reading: the AI double-checks, blind",
          "story": "Every check the rules flagged is re-read by the AI, without being told what the rules decided. If the second reading agrees, the system is more confident. If not, a person looks.",
          "call": {
            "verb": "AWS",
            "text": "bedrock:InvokeModel (Converse) · SecondReadAsync mode=blind"
          },
          "req": {
            "cap": "Engine request (summarised)",
            "lang": "json",
            "body": "{\n  \"pack\": \"funding\",\n  \"mode\": \"blind\",\n  \"checks\": [ { \"id\": \"0195f6d1-c001-…\", \"checkId\": \"RIC-001\", \"title\": \"…\" } ],\n  \"documents\": [ { \"documentId\": \"0195f6d1-0a01-…\", \"type\": \"RIC\", \"parseKey\": \"funding/tenants/…\" } ],\n  \"deal\": \"…deal summary…\"\n}"
          },
          "res": {
            "cap": "One reading",
            "lang": "json",
            "body": "{\n  \"id\": \"0195f6d1-c001-…\", \"verdict\": \"Issue\", \"confidence\": 92,\n  \"cleared\": false, \"confirmed\": true, \"unreadable\": false,\n  \"foundDocumentId\": \"0195f6d1-0a01-…\", \"foundPage\": 1,\n  \"explanation\": \"<encrypted before storage>\"\n}"
          },
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "documents-sdk"
          ],
          "labelPlain": "2nd read",
          "resLabel": "verdicts",
          "resLabelPlain": "verdict"
        },
        {
          "id": "b14",
          "route": [
            "steps",
            "db"
          ],
          "label": "readings",
          "phase": "Second reading",
          "title": "Second readings are saved",
          "story": "Each second reading is saved with where it found the answer (document and page), so a funder can jump straight to it.",
          "call": {
            "verb": "SQL",
            "text": "INSERT FundingReviewSecondReadings (under the run lock)"
          },
          "tables": [
            {
              "name": "FundingReviewSecondReadings",
              "op": "INSERT",
              "cols": [
                [
                  "CheckResultId",
                  "one reading per check"
                ],
                [
                  "Verdict, Confidence (0–100), Cleared, Confirmed",
                  "Cleared/Confirmed must match the verdict"
                ],
                [
                  "FoundDocumentId, FoundPage",
                  "must be a document of the same application"
                ],
                [
                  "EncryptedDetail",
                  "{explanation, doubt, foundValue, quote, …}"
                ]
              ],
              "sql": "INSERT INTO \"FundingReviewSecondReadings\"\n  (\"Id\", \"CheckResultId\", \"Verdict\", \"Confidence\", \"Cleared\", \"Confirmed\",\n   \"FoundDocumentId\", \"FoundPage\", \"EncryptedDetail\")\nVALUES (@id, @c2, 'Cleared', 92, true, false, @doc1, 3, @detail);"
            }
          ],
          "refs": [
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "save"
        },
        {
          "id": "b15",
          "route": [
            "sfn",
            "steps",
            "bedrock"
          ],
          "label": "Stips",
          "phase": "Stipulations",
          "title": "Stipulations: answer the lender's conditions",
          "story": "The deal came with conditions (\"provide proof of income\", \"signed contract\"). The AI answers each from the documents it already has.",
          "call": {
            "verb": "AWS",
            "text": "bedrock:InvokeModel (Converse) · SecondReadAsync with the open stipulations"
          },
          "res": {
            "cap": "One answer",
            "lang": "json",
            "body": "{ \"stipId\": \"12\", \"answer\": \"Yes\", \"confidence\": 95,\n  \"documentIds\": [\"0195f6d1-0a01-…\"], \"explanation\": \"<encrypted before storage>\" }"
          },
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "documents-sdk"
          ],
          "labelPlain": "conditions",
          "resLabel": "answers",
          "resLabelPlain": "answers"
        },
        {
          "id": "b16",
          "route": [
            "steps",
            "db"
          ],
          "label": "stips",
          "phase": "Stipulations",
          "title": "Stipulation answers are saved",
          "story": "Each condition gets its answer and how sure the system is. Waived or already-commented ones are left as LOS sent them.",
          "call": {
            "verb": "SQL",
            "text": "INSERT FundingReviewStipResults"
          },
          "tables": [
            {
              "name": "FundingReviewStipResults",
              "op": "INSERT",
              "cols": [
                [
                  "RunId, StipId",
                  "one row per stipulation"
                ],
                [
                  "Action",
                  "Waive or Leave"
                ],
                [
                  "Answer, AnswerConfidence (0–100), Model",
                  "when answered"
                ],
                [
                  "EncryptedDetail",
                  "{comments, reason, explanation, doubt, documents}"
                ]
              ],
              "sql": "INSERT INTO \"FundingReviewStipResults\"\n  (\"Id\", \"RunId\", \"StipId\", \"Action\", \"Answer\", \"AnswerConfidence\", \"Model\", \"EncryptedDetail\")\nVALUES (@id, @run, 'STIP-POI', 'Waive', 'Satisfied', 88, 'claude-haiku', @detail);"
            }
          ],
          "refs": [
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "save"
        },
        {
          "id": "b17",
          "route": [
            "sfn",
            "steps",
            "db"
          ],
          "label": "Score",
          "phase": "Score",
          "title": "Score: how sure are we about each check?",
          "story": "Every check gets a confidence score from all the evidence: how clearly the field was read, whether the readings agreed and what the second reading said. Sure enough, it stands on its own. Otherwise it's left for the funder.",
          "call": {
            "verb": "IN",
            "text": "IDocumentReviewEngine.ScoreAsync (confidence policy v3, in-process)"
          },
          "tables": [
            {
              "name": "FundingReviewCheckResults",
              "op": "UPDATE",
              "cols": [
                [
                  "Score",
                  "value-free summary: pressed, confidence, automatic, points, lean, evidence grades"
                ],
                [
                  "Score.encryptedDetail",
                  "the full record, including explanations, encrypted"
                ]
              ],
              "sql": "-- one statement per check; the full record stays in Score.encryptedDetail\nUPDATE \"FundingReviewCheckResults\"\n   SET \"Score\" = @score::jsonb   -- pressed, confidence, automatic, points, lean, grades\n WHERE \"Id\" = @checkId AND \"RunId\" = @run;"
            }
          ],
          "notes": [
            "Explanations can quote a document, so they are never stored in the clear."
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "score"
        },
        {
          "id": "b18",
          "route": [
            "sfn",
            "steps",
            "db"
          ],
          "label": "Finalize",
          "phase": "Result",
          "title": "Finalize: the review is ready for a funder",
          "story": "The review is complete. It records what is left for a person to confirm, which checks are hard stops, and what the reading cost. Then it waits for a funder.",
          "res": {
            "cap": "Step response",
            "lang": "json",
            "body": "{\n  \"step\": \"Finalize\",\n  \"status\": \"AwaitingReview\",\n  \"counts\": { \"toConfirm\": 3, \"hardStops\": 1, \"documentsRead\": 3, \"documentsReused\": 0, \"documentsFailed\": 0 }\n}"
          },
          "call": {
            "verb": "SQL",
            "text": "UPDATE FundingReviewRuns SET Status = 'AwaitingReview', FinishedAt = now(), …"
          },
          "tables": [
            {
              "name": "FundingReviewRuns",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "Running → AwaitingReview"
                ],
                [
                  "Counts",
                  "+ toConfirm, hardStops, documents read/reused/failed"
                ],
                [
                  "Usage, CostUsd",
                  "reading + second reading"
                ],
                [
                  "FinishedAt",
                  "now; CurrentStep null"
                ]
              ],
              "sql": "UPDATE \"FundingReviewRuns\"\n   SET \"Status\" = 'AwaitingReview', \"Counts\" = @counts::jsonb,\n       \"Usage\" = @usage::jsonb, \"CostUsd\" = 0.0842,\n       \"FinishedAt\" = now(), \"CurrentStep\" = NULL\n WHERE \"Id\" = @run AND \"Status\" = 'Running';"
            }
          ],
          "refs": [
            "infrastructure",
            "lending-api · FundingReview",
            "lending-database"
          ],
          "labelPlain": "ready",
          "resLabel": "AwaitingReview",
          "resLabelPlain": "ready"
        },
        {
          "id": "b19",
          "route": [
            "portal",
            "api",
            "db"
          ],
          "label": "GET run",
          "phase": "Funder",
          "title": "The funder opens the result",
          "story": "In the portal, the funder sees the overall outcome, every check with its evidence and confidence, the AI's second opinion and the conditions, and can open each document at the right page.",
          "call": {
            "verb": "GET",
            "text": "/v1/funding-reviews/runs/{runId}"
          },
          "kv": [
            [
              "Scope",
              "funding-reviews:read"
            ],
            [
              "Caller",
              "the portal's client_credentials client; funder email in X-On-Behalf-Of-Actor-Email"
            ],
            [
              "Archive",
              "funding review routes are not written to the API exchange archive"
            ]
          ],
          "res": {
            "cap": "Response (trimmed)",
            "lang": "json",
            "body": "{\n  \"data\": {\n    \"run\": { \"id\": \"0195f6d1-6b2a-…\", \"status\": \"AwaitingReview\", \"overall\": \"SoftFlag\" },\n    \"documentsReceived\": [\"RIC\", \"DL\"],\n    \"documentsOutstanding\": [\"POI\"],\n    \"checks\": [\n      {\n        \"seq\": 0, \"checkId\": \"RIC-001\", \"result\": \"Fail\", \"severity\": \"HardStop\",\n        \"score\": { \"pressed\": \"hard\", \"confidence\": 97, \"automatic\": true },\n        \"secondReading\": { \"verdict\": \"Issue\", \"confidence\": 92, \"foundPage\": 1 }\n      }\n    ],\n    \"stips\": [ { \"stipId\": \"12\", \"name\": \"Retail Installment Contract\", \"answer\": { \"answer\": \"Yes\", \"confidence\": 95 } } ],\n    \"actions\": []\n  },\n  \"meta\": { }\n}\n\n// header: ETag: \"W/\\\"run-0195f6d1-v7\\\"\""
          },
          "notes": [
            "Documents: <code>GET …/runs/{runId}/documents</code>. File: <code>GET …/documents/{documentId}/content-url</code> returns a short-lived presigned S3 link."
          ],
          "refs": [
            "funding-portal",
            "lending-api",
            "lending-database"
          ],
          "labelPlain": "open",
          "resLabel": "200 run",
          "resLabelPlain": "result",
          "tables": [
            {
              "name": "FundingReviewRuns",
              "op": "READ",
              "cols": [
                [
                  "Status, Overall, Counts",
                  "the headline"
                ],
                [
                  "QueuedAt, StartedAt, FinishedAt",
                  "timeline"
                ]
              ],
              "sql": "SELECT \"Id\", \"Status\", \"Overall\", \"Counts\", \"QueuedAt\", \"StartedAt\", \"FinishedAt\"\n  FROM \"FundingReviewRuns\"\n WHERE \"Id\" = @run AND \"TenantId\" = @tenant;"
            },
            {
              "name": "FundingReviewCheckResults",
              "op": "READ",
              "cols": [
                [
                  "Seq, CheckId, Result, Severity",
                  "one row per check"
                ],
                [
                  "Score",
                  "value-free confidence summary"
                ]
              ],
              "sql": "SELECT \"Seq\", \"CheckId\", \"Code\", \"Family\", \"Result\", \"Severity\", \"Score\"\n  FROM \"FundingReviewCheckResults\"\n WHERE \"RunId\" = @run\n ORDER BY \"Seq\";"
            },
            {
              "name": "FundingReviewDocumentResults",
              "op": "READ",
              "cols": [
                [
                  "Status, IndexTag",
                  "per document"
                ],
                [
                  "FieldSummary",
                  "via DocumentExtractions; codes, no values"
                ]
              ],
              "sql": "SELECT r.\"ApplicationDocumentId\", r.\"Status\", r.\"IndexTag\", e.\"FieldSummary\"\n  FROM \"FundingReviewDocumentResults\" r\n  LEFT JOIN \"DocumentExtractions\" e ON e.\"Id\" = r.\"ExtractionId\"\n WHERE r.\"RunId\" = @run;"
            }
          ]
        },
        {
          "id": "b20",
          "route": [
            "portal",
            "api",
            "db"
          ],
          "label": "decision",
          "phase": "Funder",
          "title": "The funder approves or returns",
          "story": "The funder confirms or overrides the flagged checks, then approves the package for funding or returns it to the dealer. The decision is recorded and the review is closed for good.",
          "call": {
            "verb": "POST",
            "text": "/v1/funding-reviews/runs/{runId}/decision"
          },
          "req": {
            "cap": "Request",
            "lang": "http",
            "body": "POST /v1/funding-reviews/runs/0195f6d1-6b2a-7c3e-9f10-2a4b6c8d0e12/decision HTTP/1.1\nAuthorization: Bearer <portal token, scope funding-reviews:decision>\nX-On-Behalf-Of-Actor-Email: funder@example.test\nIf-Match: W/\"run-0195f6d1-v7\"\nContent-Type: application/json\n\n{ \"decision\": \"approve\", \"note\": \"All stipulations met.\" }"
          },
          "res": {
            "cap": "Response",
            "lang": "json",
            "body": "{\n  \"data\": {\n    \"run\": { \"id\": \"0195f6d1-6b2a-…\", \"status\": \"Approved\",\n             \"decidedAt\": \"2026-11-06T10:02:17Z\", \"decisionNote\": \"All stipulations met.\" }\n  }\n}\n// 409 run_not_awaiting_review if it was already decided another way"
          },
          "tables": [
            {
              "name": "FundingReviewActions",
              "op": "INSERT",
              "cols": [
                [
                  "Target, Action",
                  "run, Approve (or Return)"
                ],
                [
                  "EncryptedNote",
                  "{note, onBehalfOfActorEmail}"
                ],
                [
                  "CreatedBy",
                  "client:cognito:<portal client>"
                ]
              ],
              "sql": "INSERT INTO \"FundingReviewActions\"\n  (\"Id\", \"TenantId\", \"RunId\", \"Target\", \"Action\", \"EncryptedNote\", \"CreatedBy\", \"CreatedAt\")\nVALUES (@id, @tenant, @run, 'run', 'Approve', @note, 'client:<portal client>', now())\nRETURNING \"Id\", \"CreatedBy\";"
            },
            {
              "name": "FundingReviewRuns",
              "op": "UPDATE",
              "cols": [
                [
                  "Status",
                  "AwaitingReview → Approved or Returned (final)"
                ],
                [
                  "DecidedAt, DecidedBy",
                  "DecidedBy must match the deciding action"
                ],
                [
                  "EncryptedDecisionNote",
                  ""
                ]
              ],
              "sql": "UPDATE \"FundingReviewRuns\"\n   SET \"Status\" = 'Approved', \"DecidedAt\" = now(), \"DecidedBy\" = @actionCreatedBy,\n       \"EncryptedDecisionNote\" = @note\n WHERE \"Id\" = @run AND \"Status\" = 'AwaitingReview';\n-- 0 rows updated means someone else decided first: 409 Conflict"
            }
          ],
          "notes": [
            "Checks are answered first with <code>POST …/runs/{runId}/answers</code> (Agree, Override, Waive, Keep).",
            "Writing back to LOS is still to be designed."
          ],
          "refs": [
            "funding-portal",
            "lending-api",
            "lending-database"
          ],
          "labelPlain": "decide",
          "resLabel": "200 Approved",
          "resLabelPlain": "recorded"
        }
      ],
      "desc": "Sweep → workflow → result"
    }
  }
};
