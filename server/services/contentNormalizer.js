// Conservative normalization for AI-generated source code.
// Important: generateObject() already returns a decoded JavaScript string.
// Do not blindly unescape quotes/backslashes because that can corrupt valid JS.

export function normalizeContent(content) {
    if (content == null) return "";

    let value = String(content);

    // Remove BOM.
    if (value.charCodeAt(0) === 0xfeff) {
        value = value.slice(1);
    }

    // Normalize line endings.
    value = value
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    // Remove accidental markdown fences only when they wrap the whole file.
    value = value.replace(
        /^\s*```(?:jsx|javascript|js|tsx|typescript|ts|css|html|react)?\s*\n/i,
        ""
    );

    value = value.replace(
        /\n?\s*```\s*$/i,
        ""
    );

    // Remove a very common prose prefix without touching valid source.
    value = value.replace(
        /^\s*(?:Here is|Here's)\s+(?:the\s+)?(?:complete\s+)?(?:code|component|file)\s*:\s*\n?/i,
        ""
    );

    return value.trim();
}
