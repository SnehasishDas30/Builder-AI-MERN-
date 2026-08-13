import { Project } from "../models/Project.js";
import { applyOperations, hashContent } from "../services/diff.js";
import { reviseProject } from "../services/ai.js";
import { validateProjectFiles } from "../services/codeValidator.js";

export function buildManifest(files) {
    const manifest = [];
    for (const [path, entry] of Object.entries(files)) {
        manifest.push({ path, hash: entry.hash, size: entry.content.length })
    }
    return manifest;
}

// POST /api/projects/:id/chat

// Send a revision prompt and return updated project.
export async function chat(req, res) {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
        res.status(400).json({ error: "prompt is required" });
        return;
    }

    if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user.userId });

    if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
    }

    // Set status to revising and save user prompt immediately
    project.status = "revising",
        project.messages.push({
            role: "user", content: prompt, timestamp: new
                Date()
        });
    await project.save();

    try {
        // Build compact manifest (path + hash + size) instead of sending all code

        const manifest = buildManifest(project.files);

        // Include ALL file contents so the AI can do accurate search/
        // replace
        const relevantFiles = {};
        for (const [path, entry] of Object.entries(project.files)) {
            relevantFiles[path] = entry.content;
        }

        // Recent messages for context (last 4 max)
        const recentMessages = project.messages.slice(-4).map((m) => ({
            role: m.role,
            content: m.content,
        }))

        console.log(
            `[AI] Revising project ${project._id}: "${prompt.slice(0,
                80)}..."` +
            `(${manifest.length} files, manifest ~${JSON.stringify(
                manifest).length} chars)`,
        );

        // Call AI with manifest + relevant files
        const result = await reviseProject(prompt, manifest,
            relevantFiles, recentMessages)

        console.log(`[AI] Got ${result.operations.length} operations: ${result.description}`);

        // Apply operations atomically in memory first.
        const { files: updatedFiles, applied, errors } =
            applyOperations(project.files, result.operations);

        // Never persist a partially applied revision.
        if (errors.length > 0) {
            console.warn("[Diff] Revision rejected:", errors);

            project.status = "completed";
            project.messages.push({
                role: "assistant",
                content:
                    `Revision rejected. No changes were saved.\n\n` +
                    errors.join("\n"),
                timestamp: new Date(),
            });
            await project.save();

            res.status(400).json({
                error: "Revision could not be applied safely.",
                errors,
                applied: [],
            });
            return;
        }

        const rawUpdatedFiles = {};
        for (const [path, entry] of Object.entries(updatedFiles)) {
            rawUpdatedFiles[path] =
                typeof entry === "string"
                    ? entry
                    : entry?.content || "";
        }

        // Validate the COMPLETE resulting project before saving it.
        const validation = validateProjectFiles(rawUpdatedFiles);

        if (!validation.valid) {
            console.warn(
                "[Validator] Revision produced invalid project:",
                validation.errors
            );

            project.status = "completed";
            project.messages.push({
                role: "assistant",
                content:
                    `Revision rejected because the resulting project failed validation.\n\n` +
                    validation.errors.join("\n"),
                timestamp: new Date(),
            });
            await project.save();

            res.status(400).json({
                error: "Revision would break the project.",
                validationErrors: validation.errors,
                applied: [],
            });
            return;
        }

        // Persist only after every operation and every resulting file
        // passes deterministic validation.
        const validatedFiles = {};
        for (const [path, content] of Object.entries(validation.files)) {
            validatedFiles[path] = {
                content,
                hash: hashContent(content),
            };
        }

        project.files = validatedFiles;
        project.markModified("files");
        project.version += 1;
        project.status = "completed";
        project.messages.push({
            role: "assistant",
            content: result.description,
            timestamp: new Date(),
        });

        await project.save();

        // Return updated project
        const filesObj = {};
        for (const [path, entry] of Object.entries(project.files)) {
            filesObj[path] = entry.content;
        }

        res.json({
            _id: project._id,
            name: project.name,
            description: project.description,
            files: filesObj,
            messages: project.messages,
            version: project.version,
            status: project.status,
            applied,
            errors,
            aiDescription: result.description,
        })

    } catch (err) {
        console.error(`[AI Revision Error] ${err.message}`);

        project.status = "completed";
        project.messages.push({
            role: "assistant",
            content: `❌ Revision failed: ${err.message || "Unknown error"}`,
            timestamp: new Date(),
        });
        await project.save();

        res.status(500).json({
            error: err.message || "Failed to process revision request",
        });
    }

}