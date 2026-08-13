import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import pMap from "p-map";

import {
  FileCodeSchema,
  FilePlanSchema,
  RevisionResultSchema,
} from "./aiSchemas.js";

import {
  buildFileCodeSystem,
  FILE_PLAN_SYSTEM,
  REVISE_SYSTEM,
  validateFilePlan,
} from "./prompts.js";

import { normalizeContent } from "./contentNormalizer.js";

import {
  validateAndFixCode,
  validateProjectFiles,
} from "./codeValidator.js";

/*
=====================================================
CONFIGURATION
=====================================================
*/

const MODEL =
  process.env.OPENROUTER_MODEL || "openrouter/free";

const MAX_CONCURRENCY = Math.max(
  1,
  Math.min(
    parseInt(
      process.env.AI_MAX_CONCURRENCY || "1",
      10
    ) || 1,
    4
  )
);

const PLAN_RETRIES = Math.max(
  1,
  Math.min(
    parseInt(
      process.env.AI_PLAN_RETRIES || "2",
      10
    ) || 2,
    3
  )
);

const FILE_RETRY_ROUNDS = Math.max(
  1,
  Math.min(
    parseInt(
      process.env.AI_FILE_RETRY_ROUNDS || "2",
      10
    ) || 2,
    4
  )
);

const REVISION_RETRIES = Math.max(
  1,
  Math.min(
    parseInt(
      process.env.AI_REVISION_RETRIES || "3",
      10
    ) || 3,
    5
  )
);

const REQUEST_TIMEOUT_MS = Math.max(
  30_000,
  parseInt(
    process.env.AI_REQUEST_TIMEOUT_MS || "180000",
    10
  ) || 180000
);

const MAX_PROJECT_FILES = Math.max(
  4,
  Math.min(
    parseInt(
      process.env.AI_MAX_PROJECT_FILES || "30",
      10
    ) || 30,
    50
  )
);

const RETRY_BACKOFF_MS = Math.max(
  500,
  parseInt(
    process.env.AI_RETRY_BACKOFF_MS || "3000",
    10
  ) || 3000
);

/*
=====================================================
OPENROUTER
=====================================================
*/

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const model = openrouter(MODEL);

/*
=====================================================
TIMEOUT
=====================================================
*/

function createTimeoutSignal() {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  return undefined;
}

/*
=====================================================
SLEEP
=====================================================
*/

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/*
=====================================================
BASIC HELPERS
=====================================================
*/

function normalizePath(value) {
  if (!value) {
    return "";
  }

  let path = String(value)
    .trim()
    .replace(/\\/g, "/");

  if (!path.startsWith("/")) {
    path = "/" + path;
  }

  return path;
}

function isCodeFile(path) {
  return (
    path.endsWith(".js") ||
    path.endsWith(".jsx")
  );
}

function filesCount(files) {
  return Object.keys(files).length;
}

/*
=====================================================
IMPORT RESOLUTION
=====================================================
*/

function resolveLocalImport(
  currentFile,
  importPath
) {
  if (
    !importPath ||
    !importPath.startsWith(".")
  ) {
    return null;
  }

  const parts = normalizePath(currentFile)
    .split("/")
    .filter(Boolean);

  parts.pop();

  for (const part of importPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (parts.length > 0) {
        parts.pop();
      }
    } else {
      parts.push(part);
    }
  }

  return "/" + parts.join("/");
}

/*
=====================================================
CANDIDATE PATHS
=====================================================
*/

function candidatePaths(resolved) {
  const clean = normalizePath(resolved);

  if (
    clean.endsWith(".js") ||
    clean.endsWith(".jsx") ||
    clean.endsWith(".css")
  ) {
    return [clean];
  }

  return [
    `${clean}.js`,
    `${clean}.jsx`,
    `${clean}.css`,
    `${clean}/index.js`,
    `${clean}/index.jsx`,
  ];
}

/*
=====================================================
FIND MANIFEST PATH
=====================================================
*/

function findManifestPath(
  manifestPaths,
  resolved
) {
  const candidates =
    candidatePaths(resolved);

  return candidates.find((candidate) =>
    manifestPaths.has(
      normalizePath(candidate)
    )
  );
}

/*
=====================================================
PLAN NORMALIZATION
=====================================================
*/

function normalizePlan(plan) {
  const seen = new Set();
  const normalized = [];

  for (
    const rawFile of Array.isArray(
      plan?.files
    )
      ? plan.files
      : []
  ) {
    if (
      !rawFile ||
      typeof rawFile.path !== "string"
    ) {
      continue;
    }

    const path = normalizePath(
      rawFile.path
    );

    if (
      !/^\/[A-Za-z0-9_./-]+\.(js|jsx|css)$/.test(
        path
      )
    ) {
      continue;
    }

    if (seen.has(path)) {
      continue;
    }

    seen.add(path);

    const javascriptFile =
      isCodeFile(path);

    normalized.push({
      path,

      description:
        typeof rawFile.description ===
          "string" &&
        rawFile.description.trim()
          ? rawFile.description.trim()
          : `Implementation for ${path}`,

      exports:
        typeof rawFile.exports ===
          "string" &&
        rawFile.exports.trim()
          ? rawFile.exports.trim()
          : javascriptFile
            ? "default component"
            : "none",

      imports:
        Array.isArray(
          rawFile.imports
        )
          ? rawFile.imports.filter(
              (item) =>
                typeof item === "string"
            )
          : [],
    });
  }

  /*
  ALWAYS ENSURE APP.JS
  */

  if (!seen.has("/App.js")) {
    normalized.unshift({
      path: "/App.js",

      description:
        "Main React application entry point.",

      exports: "default App",

      imports: ["./styles.css"],
    });

    seen.add("/App.js");
  }

  /*
  ALWAYS ENSURE STYLES.CSS
  */

  if (!seen.has("/styles.css")) {
    normalized.push({
      path: "/styles.css",

      description:
        "Global responsive styles, typography, layout, animations and visual design.",

      exports: "none",

      imports: [],
    });

    seen.add("/styles.css");
  }

  /*
  FORCE APP CONTRACT
  */

  const app = normalized.find(
    (file) =>
      file.path === "/App.js"
  );

  if (app) {
    app.exports = "default App";

    if (!Array.isArray(app.imports)) {
      app.imports = [];
    }

    if (
      !app.imports.includes(
        "./styles.css"
      )
    ) {
      app.imports.push(
        "./styles.css"
      );
    }
  }

  return {
    ...plan,
    files: normalized,
  };
}

/*
=====================================================
ROBUST JSON PARSER
=====================================================
*/

function parseJsonFromAIResponse(
  text
) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    throw new Error(
      "AI response is empty."
    );
  }

  let cleaned = text.trim();

  /*
  Remove markdown fences.
  */

  cleaned = cleaned
    .replace(
      /^```(?:json|javascript|js|jsx|text)?\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();

  /*
  Direct JSON.
  */

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue.
  }

  /*
  Find object boundaries.
  */

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      "Could not find a JSON object in the AI response."
    );
  }

  const candidate =
    cleaned.slice(
      firstBrace,
      lastBrace + 1
    );

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `Could not parse AI JSON response: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}

/*
=====================================================
CODE EXTRACTION
=====================================================
*/

function extractCodeFromAIResponse(
  text
) {
  if (
    typeof text !== "string" ||
    !text.trim()
  ) {
    throw new Error(
      "AI code response is empty."
    );
  }

  let cleaned = text.trim();

  /*
  Case 1:
  AI returned JSON with code.
  */

  try {
    const parsed =
      parseJsonFromAIResponse(
        cleaned
      );

    if (
      parsed &&
      typeof parsed.code ===
        "string"
    ) {
      return normalizeContent(
        parsed.code
      );
    }

    if (
      parsed &&
      typeof parsed.content ===
        "string"
    ) {
      return normalizeContent(
        parsed.content
      );
    }
  } catch {
    // Not JSON.
  }

  /*
  Case 2:
  Markdown fenced code.
  */

  cleaned = cleaned
    .replace(
      /^```(?:javascript|js|jsx|css|text)?\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();

  return normalizeContent(
    cleaned
  );
}

/*
=====================================================
DEPENDENCY FUNCTIONS
=====================================================
*/

function getDependencies(
  file,
  planFiles
) {
  const planPaths =
    new Set(
      planFiles.map((item) =>
        normalizePath(
          item.path
        )
      )
    );

  const dependencies = [];

  for (
    const importPath of Array.isArray(
      file.imports
    )
      ? file.imports
      : []
  ) {
    if (
      typeof importPath !==
        "string" ||
      !importPath.startsWith(".")
    ) {
      continue;
    }

    const resolved =
      resolveLocalImport(
        file.path,
        importPath
      );

    if (!resolved) {
      continue;
    }

    const target =
      findManifestPath(
        planPaths,
        resolved
      );

    if (
      target &&
      target !== file.path
    ) {
      dependencies.push(
        target
      );
    }
  }

  return [
    ...new Set(
      dependencies
    ),
  ];
}

/*
=====================================================
BUILD READY BATCH
=====================================================
*/

function buildReadyBatch(
  planFiles,
  generatedPaths
) {
  const generated =
    new Set(generatedPaths);

  const remaining =
    planFiles.filter(
      (file) =>
        !generated.has(
          file.path
        )
    );

  if (
    remaining.length === 0
  ) {
    return [];
  }

  const ready =
    remaining.filter(
      (file) => {
        const dependencies =
          getDependencies(
            file,
            planFiles
          );

        return dependencies.every(
          (dependency) =>
            generated.has(
              dependency
            )
        );
      }
    );

  if (ready.length > 0) {
    return ready.slice(
      0,
      MAX_CONCURRENCY
    );
  }

  /*
  Circular dependency fallback.
  */

  return [remaining[0]];
}

/*
=====================================================
PLAN REQUEST
=====================================================
*/

async function requestPlan(
  prompt
) {
  let lastError = null;

  const PLAN_SYSTEM_FAST =
    FILE_PLAN_SYSTEM ||
    `
You are a React project architect.

Your ONLY job is to create a file plan.

Return ONLY valid JSON.

Required structure:

{
  "files": [
    {
      "path": "/App.js",
      "description": "Main React application",
      "exports": "default App",
      "imports": []
    }
  ],
  "projectName": "Project Name",
  "projectDescription": "Short project description"
}

STRICT RULES:

1. Always include /App.js and /styles.css.
2. Allowed extensions are .js, .jsx and .css.
3. Never create .ts, .tsx, .scss, .sass or .less.
4. Every JavaScript file must have one default export.
5. Every local import must point to a file in the files array.
6. Resolve local imports relative to the current file.
7. Do not invent local dependencies.
8. Do not create unnecessary files.
9. imports must contain only local relative imports.
10. Return only JSON.
`;

  const planPrompt = `
Create a React website file plan for this user request:

${prompt}

IMPORTANT:

- Always include /App.js.
- Always include /styles.css.
- Every local dependency must exist in the plan.
- Keep the project within the allowed file limit.
- Do not invent components.
- Do not create unnecessary files.
`;

  for (
    let attempt = 1;
    attempt <= PLAN_RETRIES;
    attempt++
  ) {
    try {
      console.log(
        `[AI] Requesting file plan attempt ${attempt}/${PLAN_RETRIES}...`
      );

      let rawPlan = null;

      /*
      Try structured plan first.
      */

      try {
        const result =
          await generateObject({
            model,
            schema:
              FilePlanSchema,
            system:
              PLAN_SYSTEM_FAST,
            prompt: planPrompt,
            maxRetries: 0,
            abortSignal:
              createTimeoutSignal(),
          });

        if (
          result?.object
        ) {
          rawPlan =
            result.object;

          console.log(
            "[AI] Structured file plan received."
          );
        }
      } catch (
        structuredError
      ) {
        console.warn(
          `[AI] Structured plan failed: ${
            structuredError instanceof
            Error
              ? structuredError.message
              : String(
                  structuredError
                )
          }`
        );
      }

      /*
      Text fallback.
      */

      if (!rawPlan) {
        console.log(
          "[AI] Falling back to text-based file plan generation..."
        );

        const textResult =
          await generateText({
            model,
            system:
              PLAN_SYSTEM_FAST,
            prompt: planPrompt,
            maxRetries: 0,
            abortSignal:
              createTimeoutSignal(),
          });

        const text =
          typeof textResult?.text ===
          "string"
            ? textResult.text.trim()
            : "";

        if (!text) {
          throw new Error(
            "AI returned an empty file plan."
          );
        }

        rawPlan =
          parseJsonFromAIResponse(
            text
          );
      }

      /*
      SCHEMA VALIDATION
      */

      const parsedPlan =
        FilePlanSchema.parse(
          rawPlan
        );

      const plan =
        normalizePlan(
          parsedPlan
        );

      if (
        !Array.isArray(
          plan.files
        ) ||
        plan.files.length === 0
      ) {
        throw new Error(
          "AI file plan contains no files."
        );
      }

      if (
        plan.files.length >
        MAX_PROJECT_FILES
      ) {
        throw new Error(
          `The AI planned ${plan.files.length} files, which exceeds the safe limit of ${MAX_PROJECT_FILES}.`
        );
      }

      const validation =
        validateFilePlan(
          plan
        );

      if (
        !validation.valid
      ) {
        throw new Error(
          `Invalid AI file plan:\n${validation.errors.join(
            "\n"
          )}`
        );
      }

      console.log(
        `[AI] File plan validated successfully. ${plan.files.length} files planned.`
      );

      return plan;
    } catch (error) {
      lastError = error;

      console.warn(
        `[AI] File plan attempt ${attempt}/${PLAN_RETRIES} failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );

      if (
        attempt < PLAN_RETRIES
      ) {
        const waitTime =
          RETRY_BACKOFF_MS *
          attempt;

        await sleep(
          waitTime
        );
      }
    }
  }

  throw new Error(
    `Unable to create a valid project file plan after ${PLAN_RETRIES} attempts: ${
      lastError instanceof Error
        ? lastError.message
        : String(lastError)
    }`
  );
}

/*
=====================================================
VALIDATION ERROR HELPERS
=====================================================
*/

function extractValidationMissingImports(
  error
) {
  return Array.isArray(
    error?.missingImports
  )
    ? error.missingImports
    : [];
}

function buildGenerationRetryFeedback(
  error
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const validationErrors =
    Array.isArray(
      error?.validationErrors
    )
      ? error.validationErrors
      : [];

  const details =
    validationErrors.length > 0
      ? validationErrors.join(
          "\n"
        )
      : message;

  return [
    "IMPORTANT: The previous generated file was rejected by the backend validator.",
    "Regenerate the COMPLETE file from scratch.",
    "Do NOT patch only the reported line.",
    "Return ONLY valid source code.",
    "Do NOT return markdown fences.",
    "Do NOT return explanations.",
    "Do NOT use TypeScript.",
    "Do NOT use unsupported npm packages.",
    "Do NOT invent local components.",
    "Do NOT invent local files.",
    "Use ONLY local imports that exist in the supplied project manifest.",
    "For files inside /components, use sibling imports like './SearchBar', NOT './components/SearchBar'.",
    "Check every single opening and closing quote.",
    "Check every template literal backtick.",
    "Check every parenthesis.",
    "Check every square bracket.",
    "Check every object brace.",
    "Check every JSX opening and closing tag.",
    "Check every JSX expression {...}.",
    "Check every JavaScript regular expression literal.",
    "Make sure strings containing URLs, paths, or CSS values are quoted correctly.",
    "Make sure all map/filter callbacks are syntactically complete.",
    "Make sure every variable used by JSX is defined.",
    "Make sure the file has the required export.",
    "",
    "Validator feedback:",
    details,
  ].join("\n");
}

/*
=====================================================
MISSING DEPENDENCY PLAN
=====================================================
*/

function addMissingPlans(
  plan,
  missingImports,
  ownerFile
) {
  const existing =
    new Set(
      plan.files.map(
        (file) =>
          normalizePath(
            file.path
          )
      )
    );

  const additions = [];

  for (
    const missing of missingImports
  ) {
    const candidates =
      Array.isArray(
        missing?.candidates
      )
        ? missing.candidates
        : [];

    const target =
      candidates.find(
        (candidate) =>
          /\.(js|jsx)$/.test(
            candidate
          )
      ) ||
      candidates.find(
        (candidate) =>
          /\.css$/.test(
            candidate
          )
      ) ||
      candidates[0];

    if (!target) {
      continue;
    }

    const path =
      normalizePath(target);

    if (
      !/^\/[A-Za-z0-9_./-]+\.(js|jsx|css)$/.test(
        path
      )
    ) {
      continue;
    }

    if (existing.has(path)) {
      continue;
    }

    existing.add(path);

    const name =
      path
        .split("/")
        .pop()
        ?.replace(
          /\.(js|jsx|css)$/,
          ""
        );

    additions.push({
      path,

      description:
        `Supporting component required by ${ownerFile.path}: ${
          name || path
        }.`,

      exports:
        path.endsWith(".css")
          ? "none"
          : "default component",

      imports: [],
    });
  }

  if (
    additions.length > 0
  ) {
    plan.files.push(
      ...additions
    );
  }

  return additions;
}

/*
=====================================================
GENERATE ONE FILE
=====================================================
*/

async function generateSingleFile(
  file,
  allFiles,
  prompt,
  alreadyGeneratedFiles,
  validationFeedback = ""
) {
  const system =
    buildFileCodeSystem(
      allFiles,
      alreadyGeneratedFiles
    );

  const userMsg = `
Project request:

${prompt}

Write the COMPLETE source code for exactly this file:

${file.path}

Purpose:

${file.description}

AUTHORITATIVE PROJECT MANIFEST:

${allFiles
  .map(
    (item) =>
      `${item.path} | imports: ${
        Array.isArray(
          item.imports
        )
          ? item.imports.join(
              ", "
            )
          : "none"
      } | exports: ${
        item.exports || "none"
      }`
  )
  .join("\n")}

STRICT RULES:

1. The project manifest is authoritative.
2. Do NOT invent local files.
3. Do NOT invent local components.
4. Do NOT import a component that does not exist in the manifest.
5. Every local import must resolve to a manifest file.
6. If this file is /components/Header.js and SearchBar is /components/SearchBar.js, import it as "./SearchBar".
7. NEVER import "./components/SearchBar" from "/components/Header.js".
8. Every JS/JSX file must have exactly one default export unless the manifest explicitly specifies otherwise.
9. Do not use TypeScript.
10. Do not use unsupported npm packages.
11. Define every variable before using it.
12. Make array/object props safe against undefined values.
13. Every button and interaction must have valid handlers where appropriate.
14. Every JSX opening tag must have a matching closing tag or be self-closing.
15. Every string must be properly quoted.
16. Every template literal must have matching backticks.
17. Every parenthesis, bracket, and brace must be closed.
18. Be especially careful with JSX attributes containing URLs, regular expressions, paths, or quoted strings.
19. Do not accidentally create JavaScript regular expressions from text containing '/'.
20. Do not return markdown code fences.
21. Return ONLY the source code.
22. Before returning, mentally parse the COMPLETE file for JavaScript/JSX syntax errors.
23. If the previous attempt failed, regenerate the COMPLETE file instead of making a tiny patch.

${
  validationFeedback
    ? `
PREVIOUS VALIDATION FAILURE:

${validationFeedback}

This is a HARD REPAIR REQUEST.

Generate the complete corrected file now.
`
    : ""
}
`;

  console.log(
    `[AI] Creating file: ${file.path}...`
  );

  let code = null;

  /*
  TEXT FIRST
  */

  try {
    const textResult =
      await generateText({
        model,
        system,
        prompt: userMsg,
        maxRetries: 0,
        abortSignal:
          createTimeoutSignal(),
      });

    code =
      extractCodeFromAIResponse(
        textResult?.text
      );

    if (code) {
      console.log(
        `[AI] Text code generation succeeded for ${file.path}.`
      );
    }
  } catch (textError) {
    console.warn(
      `[AI] Text generation failed for ${file.path}: ${
        textError instanceof Error
          ? textError.message
          : String(textError)
      }`
    );
  }

  /*
  STRUCTURED FALLBACK
  */

  if (!code) {
    try {
      console.log(
        `[AI] Trying structured code generation fallback for ${file.path}...`
      );

      const result =
        await generateObject({
          model,
          schema:
            FileCodeSchema,
          system,
          prompt: userMsg,
          maxRetries: 0,
          abortSignal:
            createTimeoutSignal(),
        });

      if (
        result?.object &&
        typeof result.object.code ===
          "string"
      ) {
        code =
          result.object.code;

        console.log(
          `[AI] Structured code generation succeeded for ${file.path}.`
        );
      }
    } catch (
      structuredError
    ) {
      console.warn(
        `[AI] Structured code generation failed for ${file.path}: ${
          structuredError instanceof
          Error
            ? structuredError.message
            : String(
                structuredError
              )
        }`
      );
    }
  }

  if (
    typeof code !== "string"
  ) {
    throw new Error(
      `AI could not generate code for ${file.path}.`
    );
  }

  code =
    normalizeContent(code);

  if (
    !code ||
    !code.trim()
  ) {
    throw new Error(
      `Generated code is empty for ${file.path}.`
    );
  }

  /*
  CODE VALIDATION
  */

  const validation =
    validateAndFixCode(
      code,
      file.path,
      {
        allPlannedFiles:
          allFiles,
      }
    );

  code =
    validation.code;

  if (
    Array.isArray(
      validation.warnings
    ) &&
    validation.warnings.length >
      0
  ) {
    console.log(
      `[Validator] ${file.path}:\n  - ${validation.warnings.join(
        "\n  - "
      )}`
    );
  }

  return {
    path: file.path,
    code,
  };
}

/*
=====================================================
GENERATE BATCH
=====================================================
*/

async function generateBatch(
  batch,
  plan,
  prompt,
  files,
  callbacks,
  retryFeedback
) {
  const results =
    await pMap(
      batch,
      async (file) => {
        try {
          if (
            callbacks?.onFileStart
          ) {
            await callbacks.onFileStart(
              file.path
            );
          }

          const result =
            await generateSingleFile(
              file,
              plan.files,
              prompt,
              files,
              retryFeedback.get(
                file.path
              ) || ""
            );

          return {
            success: true,
            file,
            result,
          };
        } catch (error) {
          return {
            success: false,
            file,
            error,
          };
        }
      },
      {
        concurrency: Math.min(
          MAX_CONCURRENCY,
          batch.length
        ),
      }
    );

  return results;
}

/*
=====================================================
GENERATE PROJECT
=====================================================
*/

export async function generateProject(
  prompt,
  callbacks
) {
  if (
    !prompt ||
    typeof prompt !== "string"
  ) {
    throw new Error(
      "Project prompt must be a non-empty string."
    );
  }

  console.log(
    `[AI] Phase 1: Planning file structure for: "${prompt.slice(
      0,
      100
    )}..."`
  );

  /*
  PHASE 1
  */

  const plan =
    await requestPlan(
      prompt
    );

  if (
    callbacks?.onPlan
  ) {
    await callbacks.onPlan(
      plan
    );
  }

  console.log(
    `[AI] Phase 2: Generating ${plan.files.length} files (dependency-aware concurrency=${MAX_CONCURRENCY})`
  );

  const files = {};

  const attempts =
    new Map();

  const retryFeedback =
    new Map();

  let safetyIterations = 0;

  /*
  GENERATION LOOP
  */

  while (
    filesCount(files) <
    plan.files.length
  ) {
    safetyIterations += 1;

    if (
      safetyIterations >
      MAX_PROJECT_FILES * 5
    ) {
      throw new Error(
        "Generation stopped because the dependency queue did not make progress."
      );
    }

    const batch =
      buildReadyBatch(
        plan.files,
        Object.keys(files)
      );

    if (
      batch.length === 0
    ) {
      break;
    }

    const results =
      await generateBatch(
        batch,
        plan,
        prompt,
        files,
        callbacks,
        retryFeedback
      );

    let madeProgress =
      false;

    for (
      const entry of results
    ) {
      /*
      SUCCESS
      */

      if (
        entry.success
      ) {
        const path =
          normalizePath(
            entry.result.path
          );

        files[path] =
          entry.result.code;

        madeProgress = true;

        attempts.delete(
          path
        );

        retryFeedback.delete(
          path
        );

        if (
          callbacks?.onFileComplete
        ) {
          await callbacks.onFileComplete(
            path,
            entry.result.code
          );
        }

        continue;
      }

      /*
      FAILURE
      */

      const file =
        entry.file;

      const error =
        entry.error;

      const missingImports =
        extractValidationMissingImports(
          error
        );

      /*
      ADD MISSING DEPENDENCIES
      */

      if (
        missingImports.length >
        0
      ) {
        const additions =
          addMissingPlans(
            plan,
            missingImports,
            file
          );

        if (
          additions.length >
          0
        ) {
          if (
            plan.files.length >
            MAX_PROJECT_FILES
          ) {
            throw new Error(
              `AI generation discovered too many dependencies. Project would exceed the safe limit of ${MAX_PROJECT_FILES} files.`
            );
          }

          console.warn(
            `[AI] Added ${additions.length} missing dependency file(s): ${additions
              .map(
                (item) =>
                  item.path
              )
              .join(", ")}`
          );

          if (
            callbacks?.onPlan
          ) {
            await callbacks.onPlan(
              plan
            );
          }

          retryFeedback.set(
            file.path,
            [
              "The previous code imported missing local files.",
              "Those dependencies have now been added to the manifest.",
              "Regenerate the COMPLETE file.",
              "Use ONLY the exact manifest paths.",
              "Double-check all relative imports.",
            ].join("\n")
          );

          continue;
        }
      }

      /*
      NORMAL RETRY
      */

      const count =
        (attempts.get(
          file.path
        ) || 0) + 1;

      attempts.set(
        file.path,
        count
      );

      retryFeedback.set(
        file.path,
        buildGenerationRetryFeedback(
          error
        )
      );

      console.warn(
        `[AI] File ${file.path} failed attempt ${count}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );

      if (
        count >
        FILE_RETRY_ROUNDS
      ) {
        throw new Error(
          `File ${file.path} failed after ${FILE_RETRY_ROUNDS} retry rounds: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`
        );
      }

      await sleep(
        RETRY_BACKOFF_MS *
          count
      );
    }

    if (
      !madeProgress &&
      results.every(
        (entry) =>
          entry.success ===
          false
      )
    ) {
      await sleep(
        RETRY_BACKOFF_MS
      );

      continue;
    }
  }

  /*
  CHECK MISSING FILES
  */

  if (
    Object.keys(files).length !==
    plan.files.length
  ) {
    const missing =
      plan.files
        .map(
          (file) =>
            file.path
        )
        .filter(
          (path) =>
            !files[path]
        );

    throw new Error(
      `Generation finished with missing files: ${missing.join(
        ", "
      )}`
    );
  }

  /*
  FINAL PROJECT VALIDATION
  */

  let finalFiles = {
    ...files,
  };

  for (
    let repairRound = 0;
    repairRound <=
    FILE_RETRY_ROUNDS;
    repairRound++
  ) {
    const finalValidation =
      validateProjectFiles(
        finalFiles
      );

    if (
      finalValidation.valid
    ) {
      finalFiles =
        finalValidation.files;

      break;
    }

    if (
      repairRound ===
      FILE_RETRY_ROUNDS
    ) {
      throw new Error(
        `Final project validation failed:\n${finalValidation.errors.join(
          "\n"
        )}`
      );
    }

    const affectedPaths =
      new Set();

    for (
      const error of
        finalValidation.errors
    ) {
      const matches =
        error.match(
          /"\/[^"]+\.(?:js|jsx|css)"/g
        ) || [];

      for (
        const match of
          matches
      ) {
        affectedPaths.add(
          match.slice(
            1,
            -1
          )
        );
      }
    }

    if (
      affectedPaths.size ===
      0
    ) {
      for (
        const file of
          plan.files
      ) {
        if (
          isCodeFile(
            file.path
          )
        ) {
          affectedPaths.add(
            file.path
          );
        }
      }
    }

    const repairBatch =
      plan.files.filter(
        (file) =>
          affectedPaths.has(
            file.path
          ) &&
          isCodeFile(
            file.path
          )
      );

    console.warn(
      `[AI] Final validation repair round ${
        repairRound + 1
      }/${FILE_RETRY_ROUNDS}: ${repairBatch
        .map(
          (file) =>
            file.path
        )
        .join(", ")}`
    );

    const repairFeedback =
      new Map();

    for (
      const file of
        repairBatch
    ) {
      repairFeedback.set(
        file.path,
        [
          "The final project validator rejected this file.",
          "Regenerate the COMPLETE file from scratch.",
          "Do not patch only one line.",
          "Fix every reported problem.",
          "Keep all valid existing behavior unless it directly conflicts with the validator errors.",
          "Do not invent new dependencies.",
          "Use only files from the project manifest.",
          "Check every JSX tag, string, template literal, bracket, brace, parenthesis and regular expression.",
          "",
          "Final validation errors:",
          ...finalValidation.errors,
        ].join("\n")
      );
    }

    const repairResults =
      await generateBatch(
        repairBatch,
        plan,
        prompt,
        finalFiles,
        callbacks,
        repairFeedback
      );

    for (
      const entry of
        repairResults
    ) {
      if (
        !entry.success
      ) {
        throw new Error(
          `Repair failed for ${entry.file.path}: ${
            entry.error instanceof
            Error
              ? entry.error.message
              : String(
                  entry.error
                )
          }`
        );
      }

      finalFiles[
        entry.result.path
      ] =
        entry.result.code;

      if (
        callbacks?.onFileComplete
      ) {
        await callbacks.onFileComplete(
          entry.result.path,
          entry.result.code
        );
      }
    }
  }

  /*
  PROJECT METADATA
  */

  const description =
    typeof plan.projectDescription ===
      "string" &&
    plan.projectDescription.trim()
      ? plan.projectDescription.trim()
      : "Generated React project";

  return {
    files: finalFiles,

    description,

    projectName:
      typeof plan.projectName ===
        "string" &&
      plan.projectName.trim()
        ? plan.projectName.trim()
        : "Generated Project",

    plan,
  };
}

/*
=====================================================
REVISION HELPERS
=====================================================
*/

function normalizeRevisionOperationType(
  value
) {
  const opStr =
    String(value || "")
      .trim()
      .toLowerCase();

  if (
    ["create", "add", "new"].includes(
      opStr
    )
  ) {
    return "create";
  }

  if (
    [
      "update",
      "edit",
      "modify",
      "patch",
    ].includes(opStr)
  ) {
    return "update";
  }

  if (
    [
      "delete",
      "remove",
      "del",
      "rm",
    ].includes(opStr)
  ) {
    return "delete";
  }

  return opStr;
}

/*
=====================================================
REVISION CONTENT HELPERS
=====================================================
*/

function normalizeRevisionText(
  value
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .replace(
      /\r\n/g,
      "\n"
    )
    .replace(
      /\r/g,
      "\n"
    );
}

function normalizeRevisionForComparison(
  value
) {
  return normalizeRevisionText(
    value
  )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      / \*\n \*/g,
      "\n"
    )
    .trim();
}

/*
=====================================================
EXACT / FUZZY SEARCH HELPERS
=====================================================
*/

function escapeRegExp(
  value
) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function normalizeRevisionForLookup(
  value
) {
  return normalizeRevisionText(
    value
  )
    .replace(
      /\u00a0/g,
      " "
    )
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n[ \t]+/g,
      "\n"
    )
    .replace(
      /[ \t]+\n/g,
      "\n"
    )
    .trim();
}

function findExactCurrentSearch(
  currentContent,
  aiSearch
) {
  if (
    typeof currentContent !==
      "string" ||
    typeof aiSearch !==
      "string"
  ) {
    return null;
  }

  if (!aiSearch.length) {
    return null;
  }

  /*
  1. EXACT RAW MATCH
  */

  if (
    currentContent.includes(
      aiSearch
    )
  ) {
    return aiSearch;
  }

  /*
  2. NEWLINE NORMALIZED
  */

  const currentNormalized =
    normalizeRevisionText(
      currentContent
    );

  const searchNormalized =
    normalizeRevisionText(
      aiSearch
    );

  if (searchNormalized) {
    const normalizedIndex =
      currentNormalized.indexOf(
        searchNormalized
      );

    if (
      normalizedIndex !==
      -1
    ) {
      const raw =
        extractRawSubstringByNormalizedRange(
          currentContent,
          normalizedIndex,
          searchNormalized.length
        );

      if (
        raw !== null
      ) {
        return raw;
      }
    }
  }

  /*
  3. WHITESPACE NORMALIZED
  */

  const currentLoose =
    normalizeRevisionForComparison(
      currentContent
    );

  const searchLoose =
    normalizeRevisionForComparison(
      aiSearch
    );

  if (
    currentLoose &&
    searchLoose
  ) {
    const looseIndex =
      currentLoose.indexOf(
        searchLoose
      );

    if (
      looseIndex !==
      -1
    ) {
      if (
        currentLoose ===
        searchLoose
      ) {
        return currentContent;
      }

      const looseRaw =
        findLooseRawSubstring(
          currentContent,
          aiSearch
        );

      if (
        looseRaw !== null
      ) {
        return looseRaw;
      }
    }
  }

  /*
  4. LINE BASED
  */

  const lineBased =
    findLineBasedCurrentSearch(
      currentContent,
      aiSearch
    );

  if (
    lineBased !== null
  ) {
    return lineBased;
  }

  return null;
}

function findLineBasedCurrentSearch(
  currentContent,
  aiSearch
) {
  const currentLines =
    normalizeRevisionText(
      currentContent
    ).split("\n");

  const searchLines =
    normalizeRevisionText(
      aiSearch
    ).split("\n");

  if (
    currentLines.length ===
      0 ||
    searchLines.length ===
      0
  ) {
    return null;
  }

  while (
    searchLines.length >
      0 &&
    !searchLines[0].trim()
  ) {
    searchLines.shift();
  }

  while (
    searchLines.length >
      0 &&
    !searchLines[
      searchLines.length - 1
    ].trim()
  ) {
    searchLines.pop();
  }

  if (
    searchLines.length ===
    0
  ) {
    return null;
  }

  const normalizedSearchLines =
    searchLines.map(
      (line) =>
        normalizeRevisionForComparison(
          line
        )
    );

  const meaningfulLength =
    normalizedSearchLines
      .join("")
      .length;

  if (
    meaningfulLength < 3
  ) {
    return null;
  }

  for (
    let start = 0;
    start <=
    currentLines.length -
      searchLines.length;
    start++
  ) {
    let matches = true;

    for (
      let offset = 0;
      offset <
      searchLines.length;
      offset++
    ) {
      const currentLine =
        normalizeRevisionForComparison(
          currentLines[
            start + offset
          ]
        );

      const searchLine =
        normalizedSearchLines[
          offset
        ];

      if (
        currentLine !==
        searchLine
      ) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return extractRawLines(
        currentContent,
        start,
        searchLines.length
      );
    }
  }

  return null;
}

function extractRawLines(
  rawContent,
  startLine,
  lineCount
) {
  const matches = [];

  const regex =
    /.*(?:\r\n|\n|\r|$)/g;

  let match;

  while (
    (match =
      regex.exec(
        rawContent
      )) !== null
  ) {
    matches.push(
      match[0]
    );

    if (
      match[0] === "" &&
      regex.lastIndex >=
        rawContent.length
    ) {
      break;
    }
  }

  if (
    startLine < 0 ||
    startLine >=
      matches.length
  ) {
    return null;
  }

  const selected =
    matches.slice(
      startLine,
      startLine +
        lineCount
    );

  if (
    selected.length !==
    lineCount
  ) {
    return null;
  }

  return selected.join(
    ""
  );
}

function findLooseRawSubstring(
  currentContent,
  aiSearch
) {
  const searchLines =
    normalizeRevisionText(
      aiSearch
    )
      .split("\n")
      .filter(
        (line) =>
          line.trim()
      );

  if (
    searchLines.length ===
    0
  ) {
    return null;
  }

  if (
    normalizeRevisionForComparison(
      aiSearch
    ).length < 5
  ) {
    return null;
  }

  const normalizedSearch =
    searchLines
      .map(
        (line) =>
          normalizeRevisionForComparison(
            line
          )
      )
      .join("\n");

  const rawLines =
    splitRawLines(
      currentContent
    );

  const normalizedCurrentLines =
    rawLines.map(
      (line) =>
        normalizeRevisionForComparison(
          line
        )
    );

  for (
    let start = 0;
    start <
    normalizedCurrentLines.length;
    start++
  ) {
    let currentSequence =
      "";

    for (
      let end = start;
      end <
      normalizedCurrentLines.length;
      end++
    ) {
      if (
        !normalizedCurrentLines[
          end
        ]
      ) {
        continue;
      }

      currentSequence +=
        currentSequence
          ? "\n" +
            normalizedCurrentLines[
              end
            ]
          : normalizedCurrentLines[
              end
            ];

      if (
        currentSequence ===
        normalizedSearch
      ) {
        return rawLines
          .slice(
            start,
            end + 1
          )
          .join("");
      }

      if (
        currentSequence.length >
        normalizedSearch.length
      ) {
        break;
      }
    }
  }

  return null;
}

function splitRawLines(
  rawContent
) {
  return (
    rawContent
      .match(
        /.*(?:\r\n|\n|\r|$)/g
      )
      ?.filter(
        (line, index, array) =>
          !(
            line === "" &&
            index ===
              array.length - 1
          )
      ) || []
  );
}

function extractRawSubstringByNormalizedRange(
  rawContent,
  normalizedStart,
  normalizedLength
) {
  let normalizedPosition =
    0;

  let rawStart = -1;
  let rawEnd = -1;

  for (
    let index = 0;
    index <
    rawContent.length;
    index++
  ) {
    const char =
      rawContent[index];

    if (
      normalizedPosition ===
      normalizedStart
    ) {
      rawStart = index;
    }

    if (
      char === "\r" &&
      rawContent[
        index + 1
      ] === "\n"
    ) {
      normalizedPosition += 1;
      index += 1;
    } else {
      normalizedPosition += 1;
    }

    if (
      normalizedPosition ===
      normalizedStart +
        normalizedLength
    ) {
      rawEnd =
        index + 1;

      break;
    }
  }

  if (
    rawStart === -1 ||
    rawEnd === -1
  ) {
    return null;
  }

  return rawContent.slice(
    rawStart,
    rawEnd
  );
}

/*
=====================================================
CURRENT FILE MAP
=====================================================
*/

function buildRelevantFileMap(
  relevantFiles
) {
  const result = {};

  for (
    const [
      rawPath,
      content,
    ] of Object.entries(
      relevantFiles || {}
    )
  ) {
    const path =
      normalizePath(
        rawPath
      );

    if (
      !path ||
      typeof content !==
        "string"
    ) {
      continue;
    }

    result[path] =
      content;
  }

  return result;
}

/*
=====================================================
REVISION OPERATION CHANGE CHECK
=====================================================
*/

function operationActuallyChangesFile(
  operation,
  relevantFiles
) {
  if (
    !operation ||
    typeof operation.path !==
      "string"
  ) {
    return false;
  }

  if (
    operation.op ===
    "create"
  ) {
    return (
      typeof operation.content ===
        "string" &&
      operation.content.trim()
        .length > 0
    );
  }

  if (
    operation.op ===
    "delete"
  ) {
    return true;
  }

  if (
    operation.op !==
    "update"
  ) {
    return false;
  }

  const current =
    relevantFiles?.[
      normalizePath(
        operation.path
      )
    ];

  if (
    typeof current !==
    "string"
  ) {
    return (
      typeof operation.replace ===
        "string" &&
      operation.replace.trim()
        .length > 0
    );
  }

  const search =
    typeof operation.search ===
      "string"
      ? operation.search
      : "";

  const replace =
    typeof operation.replace ===
      "string"
      ? operation.replace
      : "";

  if (
    !search ||
    !replace
  ) {
    return false;
  }

  return (
    normalizeRevisionText(
      search
    ) !==
    normalizeRevisionText(
      replace
    )
  );
}

/*
=====================================================
NORMALIZE REVISION OPERATIONS
=====================================================
*/

function normalizeRevisionOperations(
  operations,
  relevantFiles
) {
  if (
    !Array.isArray(
      operations
    )
  ) {
    return [];
  }

  const normalizedRelevantFiles =
    buildRelevantFileMap(
      relevantFiles
    );

  return operations
    .filter(
      (operation) =>
        operation &&
        typeof operation ===
          "object"
    )
    .map((rawOperation) => {
      const operation = {
        ...rawOperation,
      };

      operation.op =
        normalizeRevisionOperationType(
          operation.op
        );

      operation.path =
        normalizePath(
          operation.path
        );

      if (
        operation.content !=
          null &&
        typeof operation.content ===
          "string"
      ) {
        operation.content =
          normalizeContent(
            operation.content
          );
      }

      /*
      CREATE
      */

      if (
        operation.op ===
        "create"
      ) {
        if (
          typeof operation.content !==
          "string"
        ) {
          throw new Error(
            `Create operation for ${operation.path} is missing content.`
          );
        }

        delete operation.search;
        delete operation.replace;

        return operation;
      }

      /*
      DELETE
      */

      if (
        operation.op ===
        "delete"
      ) {
        delete operation.content;
        delete operation.search;
        delete operation.replace;

        return operation;
      }

      /*
      UPDATE
      */

      if (
        operation.op ===
        "update"
      ) {
        const currentContent =
          normalizedRelevantFiles[
            operation.path
          ];

        if (
          typeof operation.search ===
            "string" &&
          typeof operation.replace ===
            "string"
        ) {
          if (
            typeof currentContent ===
            "string"
          ) {
            const exactSearch =
              findExactCurrentSearch(
                currentContent,
                operation.search
              );

            if (
              exactSearch !==
              null
            ) {
              operation.search =
                exactSearch;
            }
          }

          delete operation.content;

          return operation;
        }

        if (
          typeof operation.content ===
          "string"
        ) {
          if (
            typeof currentContent !==
            "string"
          ) {
            throw new Error(
              `Cannot convert content-based update for ${operation.path} because the current file content was not provided in relevantFiles.`
            );
          }

          operation.search =
            currentContent;

          operation.replace =
            normalizeContent(
              operation.content
            );

          delete operation.content;

          return operation;
        }

        throw new Error(
          `Update operation for ${operation.path} is missing search/replace.`
        );
      }

      throw new Error(
        `Unknown revision operation "${operation.op}" for ${operation.path}.`
      );
    });
}

/*
=====================================================
VALIDATE REVISION OPERATIONS
=====================================================
*/

function validateRevisionOperations(
  operations,
  manifest,
  relevantFiles
) {
  const errors = [];

  const normalizedRelevantFiles =
    buildRelevantFileMap(
      relevantFiles
    );

  const manifestPaths =
    new Set(
      (manifest || []).map(
        (file) =>
          normalizePath(
            file.path
          )
      )
    );

  const createdPaths =
    new Set();

  for (
    const operation of
      operations
  ) {
    if (
      !operation ||
      typeof operation !==
        "object"
    ) {
      errors.push(
        "Invalid revision operation."
      );

      continue;
    }

    const path =
      normalizePath(
        operation.path
      );

    if (!path) {
      errors.push(
        "Revision operation is missing path."
      );

      continue;
    }

    if (
      !/^\/[A-Za-z0-9_./-]+\.(js|jsx|css)$/.test(
        path
      )
    ) {
      errors.push(
        `Invalid revision path: ${path}`
      );

      continue;
    }

    /*
    CREATE
    */

    if (
      operation.op ===
      "create"
    ) {
      if (
        manifestPaths.has(
          path
        )
      ) {
        errors.push(
          `Cannot create ${path} because it already exists.`
        );
      }

      if (
        createdPaths.has(
          path
        )
      ) {
        errors.push(
          `File ${path} is being created more than once.`
        );
      }

      if (
        typeof operation.content !==
        "string"
      ) {
        errors.push(
          `Create ${path} is missing content.`
        );
      }

      createdPaths.add(
        path
      );

      continue;
    }

    /*
    DELETE
    */

    if (
      operation.op ===
      "delete"
    ) {
      if (
        !manifestPaths.has(
          path
        )
      ) {
        errors.push(
          `Cannot delete ${path} because it does not exist in the current manifest.`
        );
      }

      continue;
    }

    /*
    UPDATE
    */

    if (
      operation.op ===
      "update"
    ) {
      if (
        !manifestPaths.has(
          path
        )
      ) {
        errors.push(
          `Cannot update ${path} because it does not exist in the current manifest.`
        );

        continue;
      }

      if (
        typeof operation.search !==
        "string"
      ) {
        errors.push(
          `Update ${path} is missing search.`
        );

        continue;
      }

      if (
        typeof operation.replace !==
        "string"
      ) {
        errors.push(
          `Update ${path} is missing replace.`
        );

        continue;
      }

      if (
        typeof normalizedRelevantFiles[
          path
        ] === "string"
      ) {
        if (
          normalizeRevisionText(
            operation.search
          ) ===
          normalizeRevisionText(
            operation.replace
          )
        ) {
          errors.push(
            `Update ${path} does not change the file because search and replace are identical.`
          );

          continue;
        }
      }

      const currentContent =
        normalizedRelevantFiles[
          path
        ];

      if (
        typeof currentContent !==
        "string"
      ) {
        errors.push(
          `Update ${path} cannot be verified because its current file content was not provided in relevantFiles.`
        );

        continue;
      }

      const exactSearch =
        findExactCurrentSearch(
          currentContent,
          operation.search
        );

      if (
        exactSearch ===
        null
      ) {
        errors.push(
          `Update ${path} search text does not exist in the current file.`
        );

        continue;
      }

      operation.search =
        exactSearch;

      if (
        normalizeRevisionText(
          exactSearch
        ) ===
        normalizeRevisionText(
          operation.replace
        )
      ) {
        errors.push(
          `Update ${path} would replace the selected code with identical content.`
        );
      }

      continue;
    }

    errors.push(
      `Unsupported revision operation "${operation.op}" for ${path}.`
    );
  }

  return {
    valid:
      errors.length === 0,
    errors,
  };
}

/*
=====================================================
BUILD REVISION RETRY FEEDBACK
=====================================================
*/

function buildRevisionRetryFeedback(
  validationErrors,
  relevantFiles
) {
  const filePaths =
    Object.keys(
      relevantFiles || {}
    );

  return [
    "The previous revision result was NOT applied because the revision operations were invalid.",
    "You MUST generate a real modification for the user's request.",
    "Do not return an empty operations array unless the request genuinely requires no change.",
    "For every UPDATE operation:",
    "1. The path MUST already exist in the manifest.",
    "2. The search MUST be copied from the actual current file content supplied below.",
    "3. The search MUST be an exact substring of that current file OR a contiguous source section with only harmless whitespace/line-ending differences.",
    "4. The replace MUST contain the new code.",
    "5. search and replace MUST NOT be identical.",
    "6. Do NOT invent old code.",
    "7. If changing the complete file is necessary, use the COMPLETE CURRENT FILE as search and the COMPLETE NEW FILE as replace.",
    "8. Do NOT return content for UPDATE when search/replace can be used.",
    "9. Preserve unrelated functionality.",
    "10. Modify only files necessary for the user's request.",
    "11. Do not change fonts, styling, components, imports, or architecture unless the user's request requires that change.",
    "12. Do not return a no-op operation.",
    "",
    "Files whose content is available:",
    ...filePaths,
    "",
    "VALIDATION ERRORS:",
    ...validationErrors,
  ].join("\n");
}

/*
=====================================================
REVISION PROMPT BUILDER
=====================================================
*/

function buildRevisionPrompt(
  prompt,
  manifest,
  relevantFiles,
  recentMessages,
  retryFeedback = ""
) {
  const contextParts = [];

  contextParts.push(
    "## Current Project Files (manifest)"
  );

  contextParts.push(
    "```"
  );

  for (
    const file of
      manifest || []
  ) {
    contextParts.push(
      `${normalizePath(
        file.path
      )} (${
        file.hash ||
        "no-hash"
      }, ${
        file.size || 0
      }B)`
    );
  }

  contextParts.push(
    "```"
  );

  /*
  CURRENT SOURCE
  */

  if (
    Object.keys(
      relevantFiles || {}
    ).length > 0
  ) {
    contextParts.push(
      "\n## AUTHORITATIVE CURRENT FILE CONTENT"
    );

    contextParts.push(
      "The source below is the exact current project content. Use this as the source of truth for UPDATE search values."
    );

    for (
      const [
        rawPath,
        rawContent,
      ] of Object.entries(
        relevantFiles
      )
    ) {
      const path =
        normalizePath(
          rawPath
        );

      if (
        typeof rawContent !==
        "string"
      ) {
        continue;
      }

      contextParts.push(
        `\n### ${path}`
      );

      contextParts.push(
        "BEGIN CURRENT FILE"
      );

      contextParts.push(
        rawContent
      );

      contextParts.push(
        "END CURRENT FILE"
      );
    }
  }

  /*
  RECENT CONVERSATION
  */

  if (
    Array.isArray(
      recentMessages
    ) &&
    recentMessages.length >
      0
  ) {
    contextParts.push(
      "\n## Recent Conversation"
    );

    for (
      const message of
        recentMessages.slice(
          -5
        )
    ) {
      if (
        message &&
        typeof message ===
          "object"
      ) {
        contextParts.push(
          `${message.role}: ${message.content}`
        );
      }
    }
  }

  /*
  USER REQUEST
  */

  contextParts.push(
    `\n## USER REVISION REQUEST\n${prompt}`
  );

  /*
  RETRY FEEDBACK
  */

  if (retryFeedback) {
    contextParts.push(
      `\n## HARD REVISION REPAIR INSTRUCTIONS\n${retryFeedback}`
    );
  }

  contextParts.push(`
## REVISION EXECUTION CONTRACT

The user wants the EXISTING project modified.

Do not merely describe what should change.

Return actual structured operations that can be applied directly.

For a normal modification use:

{
  "op": "update",
  "path": "/App.js",
  "search": "EXACT CURRENT CODE",
  "replace": "NEW CODE"
}

The "search" value MUST come from the actual current file content supplied above.

The "replace" value MUST contain the requested change.

The operation MUST produce a real change.

If a new file is genuinely required:

{
  "op": "create",
  "path": "/components/NewComponent.js",
  "content": "COMPLETE FILE"
}

If a file must be removed:

{
  "op": "delete",
  "path": "/components/OldComponent.js"
}

IMPORTANT:

- Never invent existing code.
- Never use a fake search value.
- Never return an update where search === replace.
- Never update a nonexistent file.
- Never create a duplicate existing file.
- Never modify unrelated files.
- Preserve existing functionality.
- Preserve existing architecture.
- Preserve existing components.
- Make only the requested change.
- If the requested change affects a parent and a new component, update BOTH the new component and the parent import/rendering.
- Ensure all local imports resolve to manifest files.
- Ensure every created JS file has a valid default export.
- Use JavaScript/JSX only.
- Do not use TypeScript.
- Do not change fonts unless explicitly requested by the user.
- Do not change styling unless explicitly requested by the user.
- Do not change existing search behavior unless explicitly requested by the user.
- Do not change existing components unless necessary for the requested modification.
- Return ONLY valid structured JSON.
`);

  return contextParts.join(
    "\n"
  );
}

/*
=====================================================
REVISION PROJECT
=====================================================
*/

export async function reviseProject(
  prompt,
  manifest,
  relevantFiles,
  recentMessages = []
) {
  if (
    !prompt ||
    typeof prompt !==
      "string"
  ) {
    throw new Error(
      "Revision prompt must be a non-empty string."
    );
  }

  /*
  NORMALIZE MANIFEST
  */

  const normalizedManifest =
    Array.isArray(
      manifest
    )
      ? manifest
          .filter(
            (file) =>
              file &&
              typeof file ===
                "object"
          )
          .map(
            (file) => ({
              ...file,
              path: normalizePath(
                file.path
              ),
            })
          )
      : [];

  if (
    normalizedManifest.length ===
    0
  ) {
    throw new Error(
      "Revision cannot start because the project manifest is empty."
    );
  }

  /*
  NORMALIZE CURRENT FILES
  */

  const normalizedRelevantFiles =
    buildRelevantFileMap(
      relevantFiles
    );

  if (
    Object.keys(
      normalizedRelevantFiles
    ).length === 0
  ) {
    console.warn(
      "[AI] Revision received no current file contents. Updates cannot be safely verified."
    );
  }

  console.log(
    "[AI] Revising project..."
  );

  let lastError =
    null;

  let lastValidationErrors =
    [];

  /*
  REVISION RETRY LOOP
  */

  for (
    let revisionAttempt = 1;
    revisionAttempt <=
    REVISION_RETRIES;
    revisionAttempt++
  ) {
    try {
      console.log(
        `[AI] Revision attempt ${revisionAttempt}/${REVISION_RETRIES}...`
      );

      const revisionPrompt =
        buildRevisionPrompt(
          prompt,
          normalizedManifest,
          normalizedRelevantFiles,
          recentMessages,
          revisionAttempt >
            1
            ? buildRevisionRetryFeedback(
                lastValidationErrors,
                normalizedRelevantFiles
              )
            : ""
        );

      let rawParsed =
        null;

      /*
      TEXT FIRST
      */

      try {
        console.log(
          "[AI] Trying text-based revision..."
        );

       const textResult =
  await generateText({
    model,

    system: `${REVISE_SYSTEM}

IMPORTANT OUTPUT FORMAT:

Return ONLY one valid JSON object.

Do NOT use markdown fences.
Do NOT use \`\`\`json.
Do NOT add explanations.
Do NOT add comments outside JSON.

The JSON MUST have exactly this top-level structure:

{
  "operations": [
    {
      "op": "update",
      "path": "/App.js",
      "search": "exact existing code",
      "replace": "new code"
    }
  ]
}

Allowed operations:

UPDATE:
{
  "op": "update",
  "path": "/existing/file.js",
  "search": "exact current code",
  "replace": "new code"
}

CREATE:
{
  "op": "create",
  "path": "/new/file.js",
  "content": "complete source code"
}

DELETE:
{
  "op": "delete",
  "path": "/existing/file.js"
}

The response must be valid JSON and nothing else.`,

    prompt: revisionPrompt,

    maxRetries: 0,

    abortSignal:
      createTimeoutSignal(),
  });

        const text =
          typeof textResult?.text ===
          "string"
            ? textResult.text.trim()
            : "";

        if (!text) {
          throw new Error(
            "AI returned an empty revision response."
          );
        }

        console.log(
          `[AI] Text revision response length: ${text.length}`
        );

        rawParsed =
          parseJsonFromAIResponse(
            text
          );

        if (
          !rawParsed ||
          typeof rawParsed !==
            "object" ||
          !Array.isArray(
            rawParsed.operations
          )
        ) {
          throw new Error(
            "AI text revision returned invalid JSON structure. Expected { operations: [] }."
          );
        }

        console.log(
          `[AI] Text revision parsed successfully with ${rawParsed.operations.length} operation(s).`
        );
      } catch (
        textError
      ) {
        console.warn(
          `[AI] Text revision failed: ${
            textError instanceof
            Error
              ? textError.message
              : String(
                  textError
                )
          }`
        );
      }

      /*
      STRUCTURED FALLBACK
      */

      if (!rawParsed) {
        try {
          console.log(
            "[AI] Trying structured revision fallback..."
          );

          const result =
            await generateObject({
              model,
              schema:
                RevisionResultSchema,
              system:
                REVISE_SYSTEM,
              prompt:
                revisionPrompt,
              maxRetries: 0,
              abortSignal:
                createTimeoutSignal(),
            });

          if (
            result?.object &&
            typeof result.object ===
              "object" &&
            Array.isArray(
              result.object
                .operations
            )
          ) {
            rawParsed =
              result.object;

            console.log(
              `[AI] Structured revision received with ${rawParsed.operations.length} operation(s).`
            );
          }
        } catch (
          structuredError
        ) {
          console.warn(
            `[AI] Structured revision failed: ${
              structuredError instanceof
              Error
                ? structuredError.message
                : String(
                    structuredError
                  )
            }`
          );
        }
      }

      if (!rawParsed) {
        throw new Error(
          "AI could not generate a valid revision response."
        );
      }

      /*
      SCHEMA VALIDATION
      */

      const parsed =
        RevisionResultSchema.parse(
          rawParsed
        );

      /*
      NORMALIZE OPERATIONS
      */

      let normalizedOperations;

      try {
        normalizedOperations =
          normalizeRevisionOperations(
            parsed.operations,
            normalizedRelevantFiles
          );
      } catch (error) {
        throw new Error(
          `Revision normalization failed: ${
            error instanceof
            Error
              ? error.message
              : String(
                  error
                )
          }`
        );
      }

      /*
      EMPTY OPERATION PROTECTION
      */

      if (
        normalizedOperations.length ===
        0
      ) {
        lastValidationErrors = [
          "AI returned zero revision operations for a non-empty modification request.",
        ];

        throw new Error(
          "AI returned zero revision operations for a non-empty modification request."
        );
      }

      /*
      VALIDATE OPERATIONS
      */

      const operationValidation =
        validateRevisionOperations(
          normalizedOperations,
          normalizedManifest,
          normalizedRelevantFiles
        );

      if (
        !operationValidation.valid
      ) {
        lastValidationErrors =
          operationValidation.errors;

        const validationError =
          new Error(
            `Revision operations are invalid:\n${operationValidation.errors.join(
              "\n"
            )}`
          );

        validationError.validationErrors =
          operationValidation.errors;

        throw validationError;
      }

      /*
      VERIFY ACTUAL CHANGE
      */

      const actualChanges =
        normalizedOperations.filter(
          (operation) =>
            operationActuallyChangesFile(
              operation,
              normalizedRelevantFiles
            )
        );

      if (
        actualChanges.length ===
        0
      ) {
        lastValidationErrors = [
          "The AI returned revision operations, but none of them would actually modify the current project.",
        ];

        throw new Error(
          "Revision contains no actual file changes."
        );
      }

      /*
      FINAL RESULT
      */

      const result = {
        ...parsed,
        operations:
          normalizedOperations,
      };

      console.log(
        `[AI] Got ${result.operations.length} valid revision operation(s).`
      );

      for (
        const operation of
          result.operations
      ) {
        console.log(
          `[AI] Revision operation: ${operation.op} ${operation.path}`
        );

        if (
          operation.op ===
          "update"
        ) {
          console.log(
            `[AI]   search length: ${
              operation.search?.length ||
              0
            }`
          );

          console.log(
            `[AI]   replace length: ${
              operation.replace?.length ||
              0
            }`
          );

          console.log(
            `[AI]   actual change: ${operationActuallyChangesFile(
              operation,
              normalizedRelevantFiles
            )}`
          );
        }

        if (
          operation.op ===
          "create"
        ) {
          console.log(
            `[AI]   create content length: ${
              operation.content?.length ||
              0
            }`
          );
        }
      }

      return result;
    } catch (error) {
      lastError =
        error;

      if (
        error &&
        typeof error ===
          "object" &&
        Array.isArray(
          error.validationErrors
        )
      ) {
        lastValidationErrors =
          error.validationErrors;
      }

      console.warn(
        `[AI] Revision attempt ${revisionAttempt}/${REVISION_RETRIES} failed: ${
          error instanceof
          Error
            ? error.message
            : String(
                error
              )
        }`
      );

      if (
        revisionAttempt <
        REVISION_RETRIES
      ) {
        const waitTime =
          RETRY_BACKOFF_MS *
          revisionAttempt;

        console.log(
          `[AI] Retrying revision in ${waitTime}ms...`
        );

        await sleep(
          waitTime
        );
      }
    }
  }

  throw new Error(
    `Unable to generate a valid project revision after ${REVISION_RETRIES} attempts: ${
      lastError instanceof
      Error
        ? lastError.message
        : String(
            lastError
          )
    }`
  );
}

/*
=====================================================
APPLY REVISION OPERATIONS
=====================================================
*/

export function applyRevisionOperations(
  files,
  operations
) {
  const updatedFiles = {
    ...files,
  };

  for (
    const operation of
      operations
  ) {
    const path =
      normalizePath(
        operation.path
      );

    /*
    CREATE
    */

    if (
      operation.op ===
      "create"
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          updatedFiles,
          path
        )
      ) {
        throw new Error(
          `Cannot create ${path}: file already exists.`
        );
      }

      updatedFiles[path] =
        normalizeContent(
          operation.content
        );

      continue;
    }

    /*
    DELETE
    */

    if (
      operation.op ===
      "delete"
    ) {
      if (
        !Object.prototype.hasOwnProperty.call(
          updatedFiles,
          path
        )
      ) {
        throw new Error(
          `Cannot delete ${path}: file does not exist.`
        );
      }

      delete updatedFiles[
        path
      ];

      continue;
    }

    /*
    UPDATE
    */

    if (
      operation.op ===
      "update"
    ) {
      if (
        !Object.prototype.hasOwnProperty.call(
          updatedFiles,
          path
        )
      ) {
        throw new Error(
          `Cannot update ${path}: file does not exist.`
        );
      }

      const currentContent =
        updatedFiles[path];

      if (
        typeof operation.search !==
          "string" ||
        typeof operation.replace !==
          "string"
      ) {
        throw new Error(
          `Invalid update operation for ${path}.`
        );
      }

      const firstIndex =
        currentContent.indexOf(
          operation.search
        );

      if (
        firstIndex === -1
      ) {
        throw new Error(
          `Search text not found in ${path}.`
        );
      }

      const secondIndex =
        currentContent.indexOf(
          operation.search,
          firstIndex +
            operation.search
              .length
        );

      if (
        secondIndex !== -1
      ) {
        throw new Error(
          `Search text is not unique in ${path}.`
        );
      }

      const updatedContent =
        currentContent.slice(
          0,
          firstIndex
        ) +
        operation.replace +
        currentContent.slice(
          firstIndex +
            operation.search
              .length
        );

      if (
        updatedContent ===
        currentContent
      ) {
        throw new Error(
          `Update produced no change in ${path}.`
        );
      }

      updatedFiles[path] =
        normalizeContent(
          updatedContent
        );
    }
  }

  return updatedFiles;
}