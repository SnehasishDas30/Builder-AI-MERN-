import { parse } from "@babel/parser";

const VOID_ELEMENTS = [
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
];

const ALLOWED_EXTERNAL_PACKAGES = new Set([
    "react",
    "react-dom",
    "react-dom/client",
]);

const FORBIDDEN_PACKAGES = new Set([
    "axios",
    "lucide-react",
    "react-icons",
    "framer-motion",
    "@fortawesome/react-fontawesome",
    "@fortawesome/free-solid-svg-icons",
    "@fortawesome/free-brands-svg-icons",
]);

export function normalizePath(value) {
    if (!value) return "";

    let path = String(value).trim().replace(/\\/g, "/");

    if (!path.startsWith("/")) {
        path = "/" + path;
    }

    return path;
}

function isJavaScriptFile(path) {
    return path.endsWith(".js") || path.endsWith(".jsx");
}

function isCssFile(path) {
    return path.endsWith(".css");
}

function parseJavaScript(code, filePath) {
    try {
        return parse(code, {
            sourceType: "module",
            plugins: ["jsx"],
            errorRecovery: false,
        });
    } catch (err) {
        throw new Error(
            `Invalid JavaScript/JSX generated for ${filePath}: ${
                err instanceof Error ? err.message : String(err)
            }`
        );
    }
}

function walk(node, visitor) {
    if (!node || typeof node !== "object") return;

    visitor(node);

    for (const key of Object.keys(node)) {
        if (
            key === "loc" ||
            key === "start" ||
            key === "end" ||
            key === "tokens" ||
            key === "comments" ||
            key === "errors"
        ) {
            continue;
        }

        const value = node[key];

        if (Array.isArray(value)) {
            for (const child of value) {
                if (
                    child &&
                    typeof child === "object" &&
                    child.type
                ) {
                    walk(child, visitor);
                }
            }
        } else if (
            value &&
            typeof value === "object" &&
            value.type
        ) {
            walk(value, visitor);
        }
    }
}

function getExportDefaultCount(ast) {
    let count = 0;

    walk(ast, (node) => {
        if (node.type === "ExportDefaultDeclaration") {
            count += 1;
        }
    });

    return count;
}

function getImportedNames(ast) {
    const names = new Set();

    walk(ast, (node) => {
        if (node.type !== "ImportDeclaration") return;

        for (const specifier of node.specifiers || []) {
            if (specifier.local?.name) {
                names.add(specifier.local.name);
            }
        }
    });

    return names;
}

function getLocallyDefinedNames(ast) {
    const names = new Set();

    walk(ast, (node) => {
        if (
            (node.type === "FunctionDeclaration" ||
                node.type === "ClassDeclaration") &&
            node.id?.name
        ) {
            names.add(node.id.name);
        }

        if (
            node.type === "VariableDeclarator" &&
            node.id?.type === "Identifier"
        ) {
            names.add(node.id.name);
        }
    });

    return names;
}

function jsxRootName(nameNode) {
    if (!nameNode) return null;

    if (nameNode.type === "JSXIdentifier") {
        return nameNode.name;
    }

    if (nameNode.type === "JSXMemberExpression") {
        return jsxRootName(nameNode.object);
    }

    if (nameNode.type === "JSXNamespacedName") {
        return nameNode.namespace?.name || null;
    }

    return null;
}

function getJSXComponentRoots(ast) {
    const components = new Set();

    walk(ast, (node) => {
        if (node.type !== "JSXOpeningElement") return;

        const root = jsxRootName(node.name);

        if (root && /^[A-Z]/.test(root)) {
            components.add(root);
        }
    });

    return components;
}

function resolveLocalImport(currentFile, importPath) {
    if (!importPath || !importPath.startsWith(".")) {
        return null;
    }

    const currentParts = normalizePath(currentFile)
        .split("/")
        .filter(Boolean);

    currentParts.pop();

    for (const part of importPath.split("/")) {
        if (!part || part === ".") continue;

        if (part === "..") {
            if (currentParts.length > 0) {
                currentParts.pop();
            }
        } else {
            currentParts.push(part);
        }
    }

    return "/" + currentParts.join("/");
}

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

function getLocalImportEntries(ast, filePath) {
    const entries = [];

    walk(ast, (node) => {
        let importPath = null;
        let kind = null;

        if (node.type === "ImportDeclaration") {
            importPath = node.source?.value;
            kind = "static";
        }

        if (
            node.type === "CallExpression" &&
            node.callee?.type === "Import" &&
            node.arguments?.length === 1 &&
            node.arguments[0]?.type === "StringLiteral"
        ) {
            importPath = node.arguments[0].value;
            kind = "dynamic";
        }

        if (!importPath || !importPath.startsWith(".")) {
            return;
        }

        const resolved = resolveLocalImport(
            filePath,
            importPath
        );

        if (!resolved) return;

        entries.push({
            importPath,
            resolved,
            candidates: candidatePaths(resolved),
            kind,
        });
    });

    return entries;
}

function getExternalImports(ast) {
    const packages = new Set();

    walk(ast, (node) => {
        if (node.type !== "ImportDeclaration") return;

        const value = node.source?.value;

        if (
            typeof value === "string" &&
            !value.startsWith(".") &&
            !value.startsWith("/")
        ) {
            packages.add(value);
        }
    });

    return packages;
}

function validateSourceContract(
    code,
    filePath,
    availablePaths
) {
    const ast = parseJavaScript(code, filePath);
    const errors = [];

    const defaultExportCount =
        getExportDefaultCount(ast);

    if (isJavaScriptFile(filePath)) {
        if (defaultExportCount === 0) {
            errors.push(
                `No default export found in "${filePath}". Every generated JS/JSX file must have exactly one default export.`
            );
        } else if (defaultExportCount > 1) {
            errors.push(
                `Multiple default exports found in "${filePath}".`
            );
        }
    }

    const localImports =
        getLocalImportEntries(ast, filePath);

    for (const entry of localImports) {
        const exists = entry.candidates.some(
            (candidate) =>
                availablePaths.has(
                    normalizePath(candidate)
                )
        );

        if (!exists) {
            errors.push(
                `Unresolved local import "${entry.importPath}" in "${filePath}". Expected one of: ${entry.candidates.join(
                    ", "
                )}`
            );
        }
    }

    const externalImports =
        getExternalImports(ast);

    for (const packageName of externalImports) {
        if (FORBIDDEN_PACKAGES.has(packageName)) {
            errors.push(
                `Forbidden external package "${packageName}" imported by "${filePath}".`
            );
            continue;
        }

        if (!ALLOWED_EXTERNAL_PACKAGES.has(packageName)) {
            errors.push(
                `Unapproved external package "${packageName}" imported by "${filePath}". Only React core packages and local files are allowed.`
            );
        }
    }

    const importedNames = getImportedNames(ast);
    const localNames = getLocallyDefinedNames(ast);
    const jsxComponents = getJSXComponentRoots(ast);

    for (const component of jsxComponents) {
        if (
            importedNames.has(component) ||
            localNames.has(component)
        ) {
            continue;
        }

        errors.push(
            `Possible undefined JSX component "<${component}>": it is neither imported nor defined in "${filePath}".`
        );
    }

    return {
        ast,
        errors,
        localImports,
    };
}

function applySafeJSXFixes(
    code,
    filePath,
    warnings
) {
    let value = code;

    const classPattern =
        /(<[A-Za-z][^>]*?)\bclass=/g;

    if (classPattern.test(value)) {
        value = value.replace(
            /(<[A-Za-z][^>]*?)\bclass=/g,
            "$1className="
        );

        warnings.push(
            `${filePath}: Fixed class= to className=.`
        );
    }

    const forPattern =
        /(<label[^>]*?)\bfor=/gi;

    if (forPattern.test(value)) {
        value = value.replace(
            /(<label[^>]*?)\bfor=/gi,
            "$1htmlFor="
        );

        warnings.push(
            `${filePath}: Fixed for= to htmlFor=.`
        );
    }

    for (const tag of VOID_ELEMENTS) {
        const pattern = new RegExp(
            `<${tag}(\\s[^>]*?)?(?<!/)>`,
            "gi"
        );

        if (pattern.test(value)) {
            value = value.replace(
                pattern,
                (match, attrs) =>
                    `<${tag}${attrs || ""} />`
            );

            warnings.push(
                `${filePath}: Self-closed <${tag}> elements.`
            );
        }
    }

    if (/<!--[\s\S]*?-->/.test(value)) {
        value = value.replace(
            /<!--[\s\S]*?-->/g,
            ""
        );

        warnings.push(
            `${filePath}: Removed HTML comments from JSX.`
        );
    }

    return value;
}

export function validateAndFixCode(
    code,
    filePath,
    context = {}
) {
    const warnings = [];

    if (typeof code !== "string") {
        throw new Error(
            `Invalid code content for ${filePath}.`
        );
    }

    let value = code
        .replace(/^\uFEFF/, "")
        .replace(/\0/g, "")
        .trim();

    const isJS = isJavaScriptFile(filePath);
    const isCSS = isCssFile(filePath);

    if (!isJS && !isCSS) {
        return {
            code: value,
            warnings,
        };
    }

    if (isCSS) {
        return {
            code: `${value}\n`,
            warnings,
        };
    }

    value = value.replace(
        /^\s*```(?:jsx?|javascript|tsx?|react)?\s*\n?/i,
        ""
    );

    value = value.replace(
        /\n?\s*```\s*$/i,
        ""
    ).trim();

    value = applySafeJSXFixes(
        value,
        filePath,
        warnings
    );

    // Parse once after safe fixes.
    // Do not use regex-based TypeScript stripping:
    // silently mutating valid JavaScript is worse
    // than retrying invalid output.

    const initialAst = (() => {
        try {
            return parseJavaScript(
                value,
                filePath
            );
        } catch {
            return null;
        }
    })();

    if (!initialAst) {
        // Re-throw the precise parser error.
        parseJavaScript(
            value,
            filePath
        );
    }

    const availablePaths = new Set(
        (context.allPlannedFiles || [])
            .map((file) =>
                normalizePath(
                    typeof file === "string"
                        ? file
                        : file?.path
                )
            )
            .filter(Boolean)
    );

    const contract =
        validateSourceContract(
            value,
            filePath,
            availablePaths
        );

    if (contract.errors.length > 0) {
        const error = new Error(
            contract.errors.join("\n")
        );

        error.validationErrors =
            contract.errors;

        error.missingImports =
            contract.localImports
                .filter(
                    (entry) =>
                        !entry.candidates.some(
                            (candidate) =>
                                availablePaths.has(
                                    normalizePath(
                                        candidate
                                    )
                                )
                        )
                )
                .map((entry) => ({
                    importPath:
                        entry.importPath,
                    candidates:
                        entry.candidates,
                }));

        throw error;
    }

    return {
        code: `${value.trim()}\n`,
        warnings,
    };
}

export function validateProjectFiles(
    files,
    options = {}
) {
    const errors = [];
    const warnings = [];
    const fixedFiles = {};

    const entries = Object.entries(
        files || {}
    );

    const availablePaths = new Set(
        entries
            .map(([path]) =>
                normalizePath(path)
            )
            .filter(Boolean)
    );

    for (const [rawPath, rawEntry] of entries) {
        const path = normalizePath(rawPath);

        const content =
            typeof rawEntry === "string"
                ? rawEntry
                : rawEntry?.content;

        if (typeof content !== "string") {
            errors.push(
                `File "${path}" does not contain string content.`
            );
            continue;
        }

        try {
            const result =
                validateAndFixCode(
                    content,
                    path,
                    {
                        allPlannedFiles:
                            Array.from(
                                availablePaths
                            ).map(
                                (filePath) => ({
                                    path: filePath,
                                })
                            ),
                    }
                );

            fixedFiles[path] =
                result.code;

            warnings.push(
                ...result.warnings
            );
        } catch (err) {
            errors.push(
                err instanceof Error
                    ? err.message
                    : String(err)
            );
        }
    }

    if (!availablePaths.has("/App.js")) {
        errors.push(
            'Required file "/App.js" is missing.'
        );
    }

    if (!availablePaths.has("/styles.css")) {
        errors.push(
            'Required file "/styles.css" is missing.'
        );
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        files: fixedFiles,
    };
}

export function validateRevisionContent(
    content,
    filePath,
    op
) {
    if (op === "delete") {
        return {
            content,
            warnings: [],
        };
    }

    if (op === "create") {
        const result =
            validateAndFixCode(
                content,
                filePath,
                {
                    // A create operation is validated
                    // again against the full project
                    // after all operations are applied.
                    allPlannedFiles: [
                        {
                            path: filePath,
                        },
                    ],
                }
            );

        return {
            content: result.code,
            warnings: result.warnings,
        };
    }

    // An update replacement may be only a fragment,
    // so do not parse it here.
    // The complete resulting file is validated
    // before it is persisted.

    return {
        content,
        warnings: [],
    };
}