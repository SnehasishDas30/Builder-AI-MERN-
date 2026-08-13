import { z } from "zod";

/*
========================================================
GENERATION RESULT
========================================================
*/

export const GenerationResultSchema = z.object({
    files: z.record(
        z.string(),
        z.string()
    ),

    description: z
        .string()
        .default("Generated project"),
});


/*
========================================================
FILE OPERATION
========================================================

Supported:

create
update
delete

For update:
AI may return either:

1. search + replace

OR

2. content

The revision logic will convert content-based
updates into search/replace automatically.
========================================================
*/

export const FileOpSchema = z.object({

    /*
    --------------------------------------------
    Operation type
    --------------------------------------------
    */

    op: z.enum([
        "create",
        "update",
        "delete",
    ]),


    /*
    --------------------------------------------
    File path
    --------------------------------------------

    Examples:

    /App.js
    /styles.css
    /components/ProductCard.jsx
    */

    path: z
        .string()
        .regex(
            /^\/[A-Za-z0-9_./-]+\.(js|jsx|css)$/,
            "Invalid file path"
        ),


    /*
    --------------------------------------------
    Complete content

    Mainly used for:
    create

    Can also be returned by AI for:
    update

    The revision engine converts update+content
    into update+search+replace.
    --------------------------------------------
    */

    content: z
        .string()
        .nullable()
        .optional(),


    /*
    --------------------------------------------
    Search text

    Used by Diff system for update.
    --------------------------------------------
    */

    search: z
        .string()
        .nullable()
        .optional(),


    /*
    --------------------------------------------
    Replacement text

    Used by Diff system for update.
    --------------------------------------------
    */

    replace: z
        .string()
        .nullable()
        .optional(),

});


/*
========================================================
REVISION RESULT
========================================================
*/

export const RevisionResultSchema = z.object({

    operations: z.array(
        FileOpSchema
    ),

    description: z
        .string()
        .default("Applied revisions"),

});


/*
========================================================
FILE PLAN
========================================================

AI creates the project structure.

Allowed:

.js
.jsx
.css

Every project must contain:

/App.js
/styles.css
========================================================
*/

export const FilePlanSchema = z.object({

    files: z.array(

        z.object({

            /*
            ------------------------------------
            File path
            ------------------------------------

            Correct regex:

            /App.js
            /styles.css
            /components/Card.jsx

            NOT:

            App.js
            /App.tsx
            /styles.scss
            ------------------------------------
            */

            path: z
                .string()
                .regex(
                    /^\/[A-Za-z0-9_./-]+\.(js|jsx|css)$/,
                    "Invalid file path"
                ),


            /*
            ------------------------------------
            File description
            ------------------------------------
            */

            description: z.string(),


            /*
            ------------------------------------
            Expected exports
            ------------------------------------
            */

            exports: z
                .string()
                .optional()
                .default(""),


            /*
            ------------------------------------
            Local imports

            Example:

            "./components/ProductCard"
            "./styles.css"

            npm imports should NOT be placed
            here.
            ------------------------------------
            */

            imports: z
                .array(
                    z.string()
                )
                .optional()
                .default([]),

        })

    ),


    /*
    --------------------------------------------
    Project name
    --------------------------------------------
    */

    projectName: z
        .string()
        .default("Generated Project"),


    /*
    --------------------------------------------
    Project description
    --------------------------------------------
    */

    projectDescription: z
        .string()
        .default("A React project"),

});


/*
========================================================
FILE CODE
========================================================

Used when generating a single file.

Example:

{
    "code": "import React from 'react'; ..."
}
========================================================
*/

export const FileCodeSchema = z.object({

    code: z.string(),

});