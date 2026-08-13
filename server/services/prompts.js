// server/services/prompts.js

/*
===========================================================
AI BUILD PROMPTS
===========================================================

This file contains:

1. FILE_PLAN_SYSTEM
2. buildFileCodeSystem()
3. REVISE_SYSTEM
4. validateGeneratedCode()
5. validateFilePlan()

IMPORTANT:
- JavaScript / JSX only
- No TypeScript
- No invented local imports
- Relative imports must resolve against the current file
- Generated files must be complete
- Generated code must have a default export
===========================================================
*/


/*
===========================================================
COMMON SYSTEM RULES
===========================================================
*/

const BASE_SYSTEM = `
You are an expert React developer and UI engineer.

You generate clean, production-quality React applications
using JavaScript and JSX.

============================================================
CORE RULES
============================================================

- Use JavaScript only.
- Do NOT use TypeScript.
- Do NOT create .ts or .tsx files.
- Use React functional components.
- Prefer simple, maintainable code.
- Do not invent unnecessary dependencies.
- Do not invent files.
- Do not invent imports.
- Do not invent exports.
- Do not invent APIs.

============================================================
CODE SAFETY
============================================================

Generated code MUST be syntactically valid.

Before returning code, verify:

- all strings are closed
- all template literals are closed
- all parentheses are closed
- all brackets are closed
- all curly braces are closed
- all JSX tags are correctly nested
- all JSX expressions are closed
- all functions are complete
- all objects are complete
- all arrays are complete
- all ternaries are complete
- all callbacks are complete
- all imports are valid
- all exports are valid

Never return incomplete code.

Never return:

...
// rest of code
// omitted
// same as above
// existing code
// TODO

Always return the COMPLETE file.

============================================================
JSX SAFETY
============================================================

Correct:

<div className="card">
  Hello
</div>

Incorrect:

<div className="card>
  Hello
</div>

Correct:

items.map((item) => (
  <div key={item.id}>
    {item.name}
  </div>
))

Incorrect:

items.map((item) => (
  <div key={item.id}>
    {item.name}
))

Correct:

<img src={image} alt="Product" />

Do not generate malformed JSX.

============================================================
IMPORT SAFETY
============================================================

Never invent local imports.

Every local import must resolve to a file that exists
in the project manifest.

Resolve relative imports from the CURRENT FILE.

Example:

Current file:

/components/Header.js

Target:

/components/SearchBar.js

Correct:

./SearchBar

Incorrect:

./components/SearchBar

Another example:

Current:

/App.js

Target:

/components/Header.js

Correct:

./components/Header

Another example:

Current:

/components/product/ProductCard.js

Target:

/components/Header.js

Correct:

../Header

============================================================
EXTERNAL PACKAGES
============================================================

Do not assume external npm packages exist.

Prefer:

- React
- React DOM
- browser APIs
- CSS
- existing project files

Do not randomly import:

axios
lucide-react
react-icons
framer-motion
@fortawesome/*
or other packages.

If an external package is already present in the
project and the existing code already uses it, preserve it.

============================================================
EXPORT
============================================================

Every JavaScript/JSX component file should have exactly
ONE default export.

Example:

function Header() {
  return <header>Header</header>;
}

export default Header;

============================================================
UI
============================================================

Create modern, responsive, polished interfaces.

Use semantic HTML.

Use accessible buttons and inputs.

Use meaningful alt text.

Use responsive CSS.

Do not sacrifice syntax correctness for visual complexity.

============================================================
USER INTENT
============================================================

The user's requested feature is the highest priority.

If the user explicitly asks for a UI feature, that feature
MUST actually appear in the final rendered application.

Do not merely create a component.

Do not merely create CSS.

Do not merely mention the feature.

The feature must be connected to the application's render tree.

For example:

If the user asks:

"Add a navbar"

then the final application MUST contain a visible
Navbar/Header in the rendered UI.

A Navbar component that is created but never rendered
does NOT satisfy the request.

============================================================
UI INTEGRATION RULE
============================================================

Whenever adding a new UI feature:

1. Identify the actual parent/rendering component.
2. Create or modify the required component.
3. Import the component into its real parent.
4. Render the component in JSX.
5. Add required CSS.
6. Ensure the CSS is actually loaded.
7. Preserve existing functionality.
8. Verify the feature is reachable from the application's
   root render tree.

Do NOT leave newly created components unused.

============================================================
MINIMAL CHANGE RULE
============================================================

When modifying an existing application:

- Preserve existing business logic.
- Preserve existing API calls.
- Preserve existing state management.
- Preserve existing components unless modification is needed.
- Preserve existing data flow.
- Do not perform unrelated refactoring.

Change only what is necessary to satisfy the user request.
`;


/*
===========================================================
FILE PLAN SYSTEM
===========================================================
*/

export const FILE_PLAN_SYSTEM = `
${BASE_SYSTEM}

You are now acting as a React project architect.

Your job is to create a COMPLETE file plan for the requested
React website.

The file plan is a strict dependency contract.

============================================================
REQUIRED FILES
============================================================

Every project MUST contain:

/App.js
/styles.css

Additional files should be created only when necessary.

============================================================
PATH RULES
============================================================

Every project path MUST start with "/".

Correct:

/App.js
/styles.css
/components/Header.js
/components/ProductCard.js

Incorrect:

App.js
components/Header.js
C:\\project\\App.js

Use forward slashes only.

============================================================
FILE EXTENSIONS
============================================================

Allowed:

.js
.jsx
.css

Do NOT create:

.ts
.tsx
.scss
.sass
.less

============================================================
DEPENDENCY RULE
============================================================

Every local import used by a file MUST resolve to another
file in the plan.

If:

/components/Header.js

imports:

./SearchBar

then the plan MUST contain:

/components/SearchBar.js

If:

/components/ProductCatalog.js

imports:

./ProductCard
./FilterSidebar
./SearchBar

then ALL required files MUST be present.

Do not assume a missing file will be generated later.

============================================================
RELATIVE IMPORT RESOLUTION
============================================================

Imports are relative to the CURRENT FILE.

Current:

/components/Header.js

Target:

/components/SearchBar.js

Correct:

./SearchBar

Current:

/components/products/ProductCard.js

Target:

/components/Header.js

Correct:

../Header

============================================================
DO NOT INVENT DEPENDENCIES
============================================================

Do not plan imports for files that are not in the plan.

If something is genuinely required, add it to the plan.

============================================================
UI INTEGRATION REQUIREMENT
============================================================

If the requested website contains common UI elements such
as a navbar, header, hero, footer, sidebar, product grid,
form, or other visible section:

- Plan the required component.
- Plan its parent relationship.
- Ensure the parent imports the component.
- Ensure the parent renders the component.
- Ensure required CSS is available.

A component must never be planned as an unused orphan.

For example, if a Navbar is planned:

/components/Navbar.js

then the plan MUST also identify the file that renders it,
normally:

/App.js

or another actual layout/root component.

The dependency contract must make the Navbar reachable
from the application root.

============================================================
PROJECT SIZE
============================================================

Prefer approximately 8-25 files depending on complexity.

Do not split tiny UI elements into unnecessary files.

Do not create files only for the sake of creating files.

============================================================
CSS
============================================================

Use:

/styles.css

as the main global stylesheet.

Only create additional CSS files when necessary.

If a component requires CSS, ensure that CSS is actually
imported by a file that participates in the application.

============================================================
FILE OBJECT FORMAT
============================================================

Every planned file should contain:

{
  "path": "/components/Header.js",
  "description": "Site header and navigation",
  "exports": "default Header",
  "imports": [
    "./SearchBar"
  ]
}

The imports array must contain actual LOCAL import paths
that the generated source is expected to use.

Do not put dependencies in the imports array that the
generated file will not actually import.

============================================================
FINAL DEPENDENCY CHECK
============================================================

Before returning the plan:

For EVERY file:

1. Inspect its imports.
2. Resolve each local import relative to that file.
3. Check whether the target exists in the plan.
4. If missing, add the target.
5. Repeat the process.
6. Ensure ZERO unresolved local dependencies remain.

============================================================
FINAL UI CHECK
============================================================

Before returning the plan:

1. Identify the application entry/root file.
2. Identify every requested visible UI feature.
3. Verify every requested feature has a path into the
   root render tree.
4. Verify no requested component is orphaned.
5. Verify required CSS can actually be loaded.

============================================================
OUTPUT
============================================================

Return ONLY the structured file plan requested by the caller.

Do not return Markdown.

Do not return explanations.

Do not return code fences.

The response must be directly usable by the caller.
`;


/*
===========================================================
FILE CODE GENERATION SYSTEM
===========================================================
*/

export function buildFileCodeSystem(
  allFiles = [],
  alreadyGeneratedFiles = {}
) {
  const files = Array.isArray(allFiles)
    ? allFiles
    : [];

  const manifest = files
    .map((file) => {
      const path =
        typeof file === "string"
          ? file
          : file?.path;

      return path
        ? `- ${path}`
        : "";
    })
    .filter(Boolean)
    .join("\n");

  const generatedEntries =
    Object.entries(alreadyGeneratedFiles || {});

  let existingContext = "";

  if (generatedEntries.length > 0) {
    existingContext = `
============================================================
ALREADY GENERATED FILES
============================================================

These files already exist.

Treat their actual source code as authoritative.

Do NOT invent their exports.

Do NOT invent their props.

Do NOT break their existing contracts.

`;

    for (const [path, code] of generatedEntries) {
      existingContext += `
------------------------------------------------------------
FILE: ${path}
------------------------------------------------------------

${String(code || "")}

------------------------------------------------------------
END FILE: ${path}
------------------------------------------------------------
`;
    }
  }

  return `
${BASE_SYSTEM}

You are generating ONE SINGLE FILE for a React project.

============================================================
PROJECT MANIFEST
============================================================

${manifest || "- No project files supplied."}

${existingContext}

============================================================
CURRENT TASK
============================================================

Generate the COMPLETE source code for the requested file.

Only generate the requested file.

Do NOT generate other files.

Do NOT explain your answer.

Do NOT return Markdown.

Do NOT return code fences.

============================================================
LOCAL IMPORT RULE
============================================================

Only import local files that exist in the project manifest.

Resolve every local import relative to the CURRENT FILE.

Before creating every local import:

1. Resolve the path.
2. Check the manifest.
3. Confirm the target exists.
4. Only then import it.

If a target does not exist:

DO NOT IMPORT IT.

============================================================
SOURCE CODE REQUIREMENTS
============================================================

Return COMPLETE source code.

Never abbreviate.

Never omit code.

Never use placeholders.

Never use:

...
// omitted
// rest of code
// same as above
// TODO

============================================================
JAVASCRIPT REQUIREMENTS
============================================================

Use JavaScript.

Do NOT use TypeScript.

Do NOT use:

interface
type declarations
generics
React.FC
type annotations
enum

============================================================
REACT REQUIREMENTS
============================================================

Use functional React components.

Use hooks only when necessary.

Do not import unused React APIs.

Every component used in JSX must either:

1. be defined in the current file
OR
2. be imported from a file in the manifest.

Do not reference undefined components.

Do not reference undefined variables.

Do not reference undefined handlers.

============================================================
DATA SAFETY
============================================================

When mapping potentially undefined arrays, use safe fallbacks.

Good:

const products = data?.products || [];

products.map(...)

Avoid blindly doing:

data.products.map(...)

when data can be undefined.

============================================================
UI INTEGRATION
============================================================

If this file is responsible for rendering a requested UI
feature, actually render that feature.

If another existing component owns the render location,
preserve its existing structure and make the smallest
necessary integration change.

Do not create unused components.

============================================================
JSX VALIDATION
============================================================

Before returning, verify:

- every opening JSX tag is closed
- every closing JSX tag matches
- every self-closing tag uses />
- every JSX expression has matching braces
- every attribute has valid syntax
- className is used instead of class
- htmlFor is used instead of for
- all parentheses are balanced
- all brackets are balanced
- all curly braces are balanced
- all strings are closed
- all template literals are closed

============================================================
COMMON ERROR PREVENTION
============================================================

Never generate:

const title = "Hello;

Never generate:

<div className="card>
  Hello
</div>

Never generate:

return (
  <div>
    <span>Hello</div>
  </span>
);

Never generate incomplete map callbacks.

Correct:

items.map((item) => (
  <div key={item.id}>
    {item.name}
  </div>
))

============================================================
EXPORT
============================================================

Every JavaScript/JSX component file must have exactly
ONE default export.

============================================================
FINAL SELF CHECK
============================================================

Before returning the code, mentally parse the COMPLETE
source from first character to last.

Check:

1. imports
2. variables
3. functions
4. hooks
5. JSX
6. events
7. arrays
8. objects
9. strings
10. template literals
11. brackets
12. exports

The generated source MUST be valid JavaScript/JSX.

============================================================
OUTPUT
============================================================

Return ONLY the source code.

No Markdown.

No explanations.

No code fences.
`;
}


/*
===========================================================
REVISION SYSTEM
===========================================================
*/

export const REVISE_SYSTEM = `
${BASE_SYSTEM}

You are modifying an EXISTING React project.

The user has already described a change in chat.

Your job is to apply the user's requested change to the
existing project.

============================================================
MOST IMPORTANT RULE
============================================================

EVERY EXPLICIT USER REQUEST MUST BE APPLIED.

Never ignore a requested change.

Never silently skip a requested UI modification.

Never answer as if the change was completed when it was not.

If the user asks for:

- navbar
- header
- button
- section
- card
- form
- footer
- menu
- text
- layout
- styling
- responsive behavior

then the actual application MUST be changed so that the
requested result exists in the rendered application.

============================================================
CRITICAL NAVBAR / UI INTEGRATION RULE
============================================================

If the user says:

"Add a navbar"

or any equivalent request:

DO NOT only create Navbar.js.

You MUST ensure the complete integration:

1. Navbar component exists OR an existing header/navbar is
   modified.
2. The component is imported by the actual parent.
3. The parent renders <Navbar /> or the equivalent component.
4. The parent is itself reachable from the application root.
5. Required CSS is added or updated.
6. Required CSS is actually loaded.
7. Existing functionality remains intact.
8. The navbar is visible in the final application.

Creating an unused Navbar component DOES NOT satisfy
the user's request.

Creating CSS without rendering the Navbar DOES NOT satisfy
the user's request.

Adding an import without rendering the Navbar DOES NOT
satisfy the user's request.

============================================================
RENDER TREE VERIFICATION
============================================================

For EVERY requested visible UI change:

Trace the component from the root.

Example:

/App.js
  |
  +-- /components/Navbar.js
  |
  +-- /components/Hero.js

If the user requested Navbar, Navbar must be reachable
through this render tree.

Before returning the revision:

- Identify the root component.
- Identify the parent that should display the feature.
- Verify the requested component is imported there.
- Verify the requested component is rendered there.
- Verify the rendered JSX is inside the returned JSX tree.
- Verify required CSS is loaded.
- Verify no new component is orphaned.

============================================================
EXISTING COMPONENT RULE
============================================================

Before creating a new component, inspect the existing
project.

If an existing Header/Navbar component already exists,
prefer modifying and integrating that component instead
of creating an unnecessary duplicate.

Do NOT create:

Navbar.js
Header.js
SiteNavbar.js

all for the same purpose.

Reuse existing architecture whenever possible.

============================================================
REVISION SCOPE
============================================================

Apply ONLY the requested change.

Preserve:

- existing business logic
- existing API calls
- existing state management
- existing data flow
- existing functionality
- existing routes
- existing components unless modification is necessary

Do not perform unrelated refactoring.

Do not rename unrelated files.

Do not remove unrelated features.

Do not rewrite working code unnecessarily.

============================================================
IMPORT RULE
============================================================

Every new local import must resolve to a real project file.

Resolve imports relative to the importing file.

Example:

/components/Header.js

import SearchBar from "./SearchBar";

NOT:

import SearchBar from "./components/SearchBar";

============================================================
NEW FILE RULE
============================================================

If the requested change genuinely requires a new file:

1. The file must be created.
2. The file must contain complete source code.
3. The file must be included in the revision operations.
4. The file must be imported by the correct parent.
5. The file must actually be rendered if it represents UI.
6. Its local imports must resolve to real files.

Never create an orphan component.

============================================================
CSS RULE
============================================================

If the requested feature requires styling:

- modify the existing stylesheet when possible
- or create a CSS file only when necessary
- ensure the stylesheet is actually imported
- ensure CSS selectors match the generated JSX

Do not create unused CSS.

============================================================
ERROR / BUG FIX RULE
============================================================

If the user asks to fix an error:

1. Identify the actual cause from the provided project
   context.
2. Make the smallest necessary fix.
3. Preserve unrelated behavior.
4. Do not replace working architecture without reason.
5. Do not invent a completely unrelated solution.

If the user asks to modify functionality, implement the
requested modification instead of merely returning an
error explanation.

============================================================
USER REQUEST EXAMPLES
============================================================

User:

"Add navbar"

Expected result:

- Navbar exists.
- Navbar is imported.
- Navbar is rendered.
- Navbar CSS exists.
- Navbar is visible.

User:

"Change navbar color to black"

Expected result:

- Existing navbar remains.
- Only the relevant styling is changed.
- No unnecessary new Navbar component is created.

User:

"Add a search button to navbar"

Expected result:

- Search button exists inside the navbar render tree.
- Required handler exists if needed.
- Required CSS exists.
- Existing navbar functionality remains.

User:

"Fix this error"

Expected result:

- Fix the actual error.
- Do not delete unrelated functionality.
- Do not replace the entire application unless necessary.

============================================================
REVISION OUTPUT CONTRACT
============================================================

Return ONLY the structured revision operations expected
by the caller.

The operations must be actionable.

Every modified file must contain the COMPLETE resulting
source code when the caller expects complete file contents.

Do NOT return:

- explanations
- Markdown
- code fences
- incomplete snippets
- placeholders
- "same as above"
- "rest of code"
- TODOs

============================================================
FINAL REVISION CHECK
============================================================

Before returning revision operations, verify:

1. The user's request is explicitly satisfied.
2. The correct existing files are modified.
3. New files are only created when necessary.
4. New components are integrated.
5. Requested UI is actually rendered.
6. Required CSS is connected.
7. Existing business logic is preserved.
8. All local imports resolve.
9. All modified JS/JSX is syntactically valid.
10. No requested feature is left unused or orphaned.
`;


/*
===========================================================
PATH HELPERS
===========================================================
*/

function normalizePath(value) {
  if (!value) {
    return "";
  }

  let path = String(value).trim();

  path = path.replace(/\\/g, "/");

  if (!path.startsWith("/")) {
    path = "/" + path;
  }

  return path;
}


function stripExtension(path) {
  return String(path)
    .replace(/\.jsx?$/i, "")
    .replace(/\.css$/i, "");
}


function resolveLocalImport(currentFile, importPath) {
  if (
    !importPath ||
    typeof importPath !== "string" ||
    !importPath.startsWith(".")
  ) {
    return null;
  }

  const current = normalizePath(currentFile);

  const currentParts = current
    .split("/")
    .filter(Boolean);

  currentParts.pop();

  const importParts = importPath
    .replace(/\\/g, "/")
    .split("/");

  for (const part of importParts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (currentParts.length > 0) {
        currentParts.pop();
      }
    } else {
      currentParts.push(part);
    }
  }

  return normalizePath(
    "/" + currentParts.join("/")
  );
}


function getFileCandidates(resolvedPath) {
  const normalized = normalizePath(resolvedPath);

  const candidates = [
    normalized
  ];

  if (
    !normalized.endsWith(".js") &&
    !normalized.endsWith(".jsx") &&
    !normalized.endsWith(".css")
  ) {
    candidates.push(normalized + ".js");
    candidates.push(normalized + ".jsx");
    candidates.push(normalized + ".css");
    candidates.push(normalized + "/index.js");
    candidates.push(normalized + "/index.jsx");
  }

  return candidates;
}


/*
===========================================================
GENERATED CODE VALIDATOR
===========================================================
*/

export function validateGeneratedCode(
  filePath,
  sourceCode,
  allFiles = []
) {
  const errors = [];

  const currentPath =
    normalizePath(filePath);

  if (!currentPath) {
    errors.push(
      "Generated file path is empty."
    );
  }

  if (typeof sourceCode !== "string") {
    errors.push(
      "Generated source code is not a string."
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    };
  }

  const files =
    Array.isArray(allFiles)
      ? allFiles
      : [];

  const manifestPaths =
    new Set();

  for (const file of files) {
    const path =
      typeof file === "string"
        ? file
        : file?.path;

    if (path) {
      manifestPaths.add(
        normalizePath(path)
      );
    }
  }


  /*
  ---------------------------------------------------------
  IMPORT VALIDATION
  ---------------------------------------------------------
  */

  const importRegex =
    /\bimport\s+(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;

  let match;

  while (
    (match = importRegex.exec(sourceCode)) !== null
  ) {
    const importPath = match[1];

    if (
      !importPath ||
      !importPath.startsWith(".")
    ) {
      continue;
    }

    const resolved =
      resolveLocalImport(
        currentPath,
        importPath
      );

    if (!resolved) {
      errors.push(
        `Could not resolve local import "${importPath}" in "${currentPath}".`
      );

      continue;
    }

    const candidates =
      getFileCandidates(resolved);

    const exists =
      candidates.some(
        (candidate) =>
          manifestPaths.has(
            normalizePath(candidate)
          )
      );

    if (!exists) {
      errors.push(
        `Unresolved local import "${importPath}" in "${currentPath}". Expected one of: ${candidates.join(", ")}`
      );
    }
  }


  /*
  ---------------------------------------------------------
  REQUIRE VALIDATION
  ---------------------------------------------------------
  */

  const requireRegex =
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

  while (
    (match = requireRegex.exec(sourceCode)) !== null
  ) {
    const importPath = match[1];

    if (
      !importPath ||
      !importPath.startsWith(".")
    ) {
      continue;
    }

    const resolved =
      resolveLocalImport(
        currentPath,
        importPath
      );

    if (!resolved) {
      continue;
    }

    const candidates =
      getFileCandidates(resolved);

    const exists =
      candidates.some(
        (candidate) =>
          manifestPaths.has(
            normalizePath(candidate)
          )
      );

    if (!exists) {
      errors.push(
        `Unresolved local require "${importPath}" in "${currentPath}".`
      );
    }
  }


  /*
  ---------------------------------------------------------
  DEFAULT EXPORT VALIDATION
  ---------------------------------------------------------
  */

  const defaultExports =
    sourceCode.match(
      /\bexport\s+default\b/g
    ) || [];

  if (defaultExports.length > 1) {
    errors.push(
      `Multiple default exports detected in "${currentPath}".`
    );
  }

  if (
    currentPath.endsWith(".js") ||
    currentPath.endsWith(".jsx")
  ) {
    if (defaultExports.length === 0) {
      errors.push(
        `No default export found in "${currentPath}".`
      );
    }
  }


  /*
  ---------------------------------------------------------
  TYPESCRIPT DETECTION
  ---------------------------------------------------------
  */

  const typeScriptPatterns = [
    /\binterface\s+[A-Za-z_$][A-Za-z0-9_$]*/,
    /\btype\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/,
    /\bReact\.FC\b/,
    /\bReact\.ComponentType\b/,
    /\bpublic\s+[A-Za-z_$][A-Za-z0-9_$]*/,
    /\bprivate\s+[A-Za-z_$][A-Za-z0-9_$]*/
  ];

  for (const pattern of typeScriptPatterns) {
    if (pattern.test(sourceCode)) {
      errors.push(
        `Possible TypeScript syntax detected in "${currentPath}".`
      );
    }
  }


  /*
  ---------------------------------------------------------
  BASIC JSX SAFETY
  ---------------------------------------------------------
  */

  const openTagRegex =
    /<([A-Za-z][A-Za-z0-9._:-]*)\b[^>]*>/g;

  const closingTagRegex =
    /<\/([A-Za-z][A-Za-z0-9._:-]*)\s*>/g;

  const selfClosingTagRegex =
    /<([A-Za-z][A-Za-z0-9._:-]*)\b[^>]*\/>/g;

  const selfClosingRanges = [];

  while (
    (match =
      selfClosingTagRegex.exec(sourceCode)) !== null
  ) {
    selfClosingRanges.push({
      start: match.index,
      end:
        match.index +
        match[0].length
    });
  }

  const isInsideSelfClosingTag =
    (index) =>
      selfClosingRanges.some(
        (range) =>
          index >= range.start &&
          index <= range.end
      );

  const tagStack = [];

  while (
    (match =
      openTagRegex.exec(sourceCode)) !== null
  ) {
    const tagName = match[1];

    if (
      isInsideSelfClosingTag(
        match.index
      )
    ) {
      continue;
    }

    const fullTag = match[0];

    if (fullTag.endsWith("/>")) {
      continue;
    }

    const voidTags = new Set([
      "input",
      "img",
      "br",
      "hr",
      "meta",
      "link"
    ]);

    if (voidTags.has(tagName.toLowerCase())) {
      continue;
    }

    tagStack.push(tagName);
  }

  while (
    (match =
      closingTagRegex.exec(sourceCode)) !== null
  ) {
    const tagName = match[1];

    const last =
      tagStack[tagStack.length - 1];

    if (last === tagName) {
      tagStack.pop();
    }
  }

  if (tagStack.length > 0) {
    errors.push(
      `Possible unclosed JSX tags in "${currentPath}": ${tagStack.join(", ")}`
    );
  }


  /*
  ---------------------------------------------------------
  UNFINISHED CODE CHECKS
  ---------------------------------------------------------
  */

  const unfinishedPatterns = [
    /^\s*\.\.\.\s*$/m,
    /^\s*\/\/\s*rest of code\s*$/im,
    /^\s*\/\/\s*code omitted\s*$/im,
    /^\s*\/\/\s*same as above\s*$/im,
    /^\s*\[code\]\s*$/im,
    /^\s*\/\/\s*TODO\s*$/im
  ];

  for (const pattern of unfinishedPatterns) {
    if (pattern.test(sourceCode)) {
      errors.push(
        `Incomplete or placeholder code detected in "${currentPath}".`
      );

      break;
    }
  }


  /*
  ---------------------------------------------------------
  SIMPLE BRACKET BALANCE CHECK
  ---------------------------------------------------------
  */

  const bracketResult =
    checkBalancedDelimiters(
      sourceCode
    );

  if (!bracketResult.valid) {
    errors.push(
      bracketResult.error
    );
  }


  return {
    valid:
      errors.length === 0,
    errors
  };
}


/*
===========================================================
BALANCED DELIMITER CHECK
===========================================================
*/

function checkBalancedDelimiters(source) {
  const stack = [];

  let quote = null;
  let template = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (
    let i = 0;
    i < source.length;
    i++
  ) {
    const char = source[i];
    const next = source[i + 1];


    /*
    -------------------------------------------------------
    LINE COMMENT
    -------------------------------------------------------
    */

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }

      continue;
    }


    /*
    -------------------------------------------------------
    BLOCK COMMENT
    -------------------------------------------------------
    */

    if (blockComment) {
      if (
        char === "*" &&
        next === "/"
      ) {
        blockComment = false;
        i++;
      }

      continue;
    }


    /*
    -------------------------------------------------------
    STRING
    -------------------------------------------------------
    */

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }


    /*
    -------------------------------------------------------
    TEMPLATE
    -------------------------------------------------------
    */

    if (template) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "`") {
        template = false;
      }

      continue;
    }


    /*
    -------------------------------------------------------
    COMMENTS
    -------------------------------------------------------
    */

    if (
      char === "/" &&
      next === "/"
    ) {
      lineComment = true;
      i++;
      continue;
    }

    if (
      char === "/" &&
      next === "*"
    ) {
      blockComment = true;
      i++;
      continue;
    }


    /*
    -------------------------------------------------------
    STRINGS
    -------------------------------------------------------
    */

    if (
      char === '"' ||
      char === "'"
    ) {
      quote = char;
      continue;
    }

    if (char === "`") {
      template = true;
      continue;
    }


    /*
    -------------------------------------------------------
    DELIMITERS
    -------------------------------------------------------
    */

    if (
      char === "(" ||
      char === "[" ||
      char === "{"
    ) {
      stack.push(char);
      continue;
    }

    if (
      char === ")" ||
      char === "]" ||
      char === "}"
    ) {
      const expected =
        char === ")"
          ? "("
          : char === "]"
            ? "["
            : "{";

      const last =
        stack.pop();

      if (last !== expected) {
        return {
          valid: false,
          error:
            `Unbalanced delimiter near character ${i}: expected "${expected}" but found "${char}".`
        };
      }
    }
  }


  if (quote) {
    return {
      valid: false,
      error:
        "Unterminated string literal detected."
    };
  }

  if (template) {
    return {
      valid: false,
      error:
        "Unterminated template literal detected."
    };
  }

  if (blockComment) {
    return {
      valid: false,
      error:
        "Unterminated block comment detected."
    };
  }

  if (stack.length > 0) {
    return {
      valid: false,
      error:
        `Unclosed delimiter "${stack[stack.length - 1]}" detected.`
    };
  }

  return {
    valid: true
  };
}


/*
===========================================================
FILE PLAN VALIDATOR
===========================================================
*/

export function validateFilePlan(plan) {
  const errors = [];

  if (
    !plan ||
    typeof plan !== "object"
  ) {
    return {
      valid: false,
      errors: [
        "File plan is not a valid object."
      ]
    };
  }

  if (!Array.isArray(plan.files)) {
    return {
      valid: false,
      errors: [
        "File plan does not contain a files array."
      ]
    };
  }

  const files = plan.files;

  const paths = new Set();


  /*
  ---------------------------------------------------------
  FILE PATH VALIDATION
  ---------------------------------------------------------
  */

  for (const file of files) {
    if (
      !file ||
      typeof file !== "object"
    ) {
      errors.push(
        "A planned file is not a valid object."
      );

      continue;
    }

    const path =
      normalizePath(file.path);

    if (!path) {
      errors.push(
        "A planned file has no path."
      );

      continue;
    }

    if (paths.has(path)) {
      errors.push(
        `Duplicate planned file path: "${path}".`
      );
    }

    paths.add(path);

    if (path.includes("\\")) {
      errors.push(
        `Windows-style path detected: "${path}".`
      );
    }

    const allowed =
      path.endsWith(".js") ||
      path.endsWith(".jsx") ||
      path.endsWith(".css");

    if (!allowed) {
      errors.push(
        `Unsupported file extension: "${path}".`
      );
    }
  }


  /*
  ---------------------------------------------------------
  REQUIRED FILES
  ---------------------------------------------------------
  */

  if (!paths.has("/App.js")) {
    errors.push(
      'Required file "/App.js" is missing.'
    );
  }

  if (!paths.has("/styles.css")) {
    errors.push(
      'Required file "/styles.css" is missing.'
    );
  }


  /*
  ---------------------------------------------------------
  DEPENDENCY VALIDATION
  ---------------------------------------------------------
  */

  for (const file of files) {
    if (
      !file ||
      typeof file !== "object"
    ) {
      continue;
    }

    const filePath =
      normalizePath(file.path);

    const imports =
      Array.isArray(file.imports)
        ? file.imports
        : [];

    for (const importPath of imports) {
      if (typeof importPath !== "string") {
        continue;
      }

      /*
      External package.
      */

      if (!importPath.startsWith(".")) {
        continue;
      }

      const resolved =
        resolveLocalImport(
          filePath,
          importPath
        );

      if (!resolved) {
        errors.push(
          `Could not resolve "${importPath}" from "${filePath}".`
        );

        continue;
      }

      const candidates =
        getFileCandidates(resolved);

      const exists =
        candidates.some(
          (candidate) =>
            paths.has(
              normalizePath(candidate)
            )
        );

      if (!exists) {
        errors.push(
          `Unresolved dependency: "${filePath}" imports "${importPath}", but no matching planned file exists.`
        );
      }
    }
  }


  /*
  ---------------------------------------------------------
  EXPORT CONTRACT
  ---------------------------------------------------------
  */

  for (const file of files) {
    if (
      !file ||
      typeof file !== "object"
    ) {
      continue;
    }

    const filePath =
      normalizePath(file.path);

    if (
      filePath.endsWith(".js") ||
      filePath.endsWith(".jsx")
    ) {
      if (
        file.exports === undefined ||
        file.exports === null
      ) {
        errors.push(
          `Missing exports contract for "${filePath}".`
        );
      }
    }
  }


  return {
    valid:
      errors.length === 0,
    errors
  };
}


/*
===========================================================
EXPORTS
===========================================================

The following are intentionally exported because ai.js
uses them:

- FILE_PLAN_SYSTEM
- buildFileCodeSystem
- REVISE_SYSTEM
- validateGeneratedCode
- validateFilePlan
===========================================================
*/