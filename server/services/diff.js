import crypto from "crypto";

export function hashContent(content) {
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 12);
}

// Apply AI file operations (create, update, delete) to project files
export function applyOperations(currentFiles, operations) {
    const files = { ...currentFiles };
    const applied = [];
    const errors = [];

    for (const op of operations) {
        try {
            switch (op.op) {
                case "create": {
                    if (!op.content) {
                        errors.push(`create ${op.path}: missing content`);
                        break;
                    }

                    if (files[op.path]) {
                        errors.push(
                            `create ${op.path}: file already exists; use update instead`
                        );
                        break;
                    }

                    files[op.path] = {
                        content: op.content,
                        hash: hashContent(op.content),
                    };
                    applied.push(`created ${op.path}`);
                    break;
                }

                case "update": {
                    const existing = files[op.path];
                    if (!existing) {
                        errors.push(`update ${op.path}: file not found`);
                        break;
                    }
                    if (!op.search || op.replace == null) {
                        errors.push(`update ${op.path}: missing search/replace`);
                        break;
                    }

                    const newContent = searchReplace(existing.content, op.search, op.replace);

                    if (newContent === null) {
                        errors.push(`update ${op.path}: search string not found`);
                        break;
                    }

                    files[op.path] = {
                        content: newContent,
                        hash: hashContent(newContent),
                    };
                    applied.push(`updated ${op.path}`);
                    break;
                }

                case "delete": {
                    if (op.path === "/App.js" || op.path === "/styles.css") {
                        errors.push(
                            `delete ${op.path}: required project entry file cannot be deleted`
                        );
                        break;
                    }

                    if (files[op.path]) {
                        delete files[op.path];
                        applied.push(`deleted ${op.path}`);
                    } else {
                        errors.push(`delete ${op.path}: file not found`);
                    }
                    break;
                }

                default:
                    errors.push(`unknown op: ${op.op}`);
            }
        } catch (err) {
            errors.push(`${op.op} ${op.path}: ${err.message}`);
        }
    }

    return { files, applied, errors };
}

// Search and replace code with fallback whitespace normalization matching
function searchReplace(content, search, replace) {
    // 1. Exact match
    if (content.includes(search)) {
        return content.replace(search, () => replace);
    }

    // 2. Normalize line endings
    const normalizeLineEndings = (value) =>
        value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    const normalizedContent =
        normalizeLineEndings(content);

    const normalizedSearch =
        normalizeLineEndings(search);

    if (normalizedContent.includes(normalizedSearch)) {
        return normalizedContent.replace(
            normalizedSearch,
            () => replace
        );
    }

    // 3. Whitespace-normalized matching
    const normalizeWs = (value) =>
        normalizeLineEndings(value)
            .split("\n")
            .map((line) =>
                line.replace(/[ \t]+/g, " ").trim()
            )
            .join("\n")
            .trim();

    const looseContent = normalizeWs(content);
    const looseSearch = normalizeWs(search);

    if (
        looseSearch &&
        looseContent.includes(looseSearch)
    ) {
        const searchLines = looseSearch.split("\n");
        const contentLines = normalizeLineEndings(content).split("\n");

        for (
            let i = 0;
            i <= contentLines.length - searchLines.length;
            i++
        ) {
            let match = true;

            for (
                let j = 0;
                j < searchLines.length;
                j++
            ) {
                if (
                    normalizeWs(contentLines[i + j]) !==
                    searchLines[j]
                ) {
                    match = false;
                    break;
                }
            }

            if (match) {
                const before = contentLines.slice(0, i);
                const after = contentLines.slice(
                    i + searchLines.length
                );

                return [
                    ...before,
                    replace,
                    ...after,
                ].join("\n");
            }
        }
    }

    return null;
}
