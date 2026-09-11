-- Adds a human-readable `message` to activity entries. Existing rows are backfilled from their action,
-- metadata and related task/project (same wording as src/activity/actions.ts), so this migration also
-- applies cleanly to a database that already has activity history.

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN "message" TEXT;

-- Backfill
WITH "subject" AS (
    SELECT a."id",
           coalesce(t."title", a."metadata"->>'title') AS "task_title",
           coalesce(p."name", a."metadata"->>'name') AS "project_name",
           a."metadata"->>'field' AS "field",
           CASE a."metadata"->>'field'
               WHEN 'dueDate' THEN 'due date'
               WHEN 'startDate' THEN 'start date'
               WHEN 'ownerId' THEN 'owner'
               ELSE a."metadata"->>'field'
           END AS "field_name",
           initcap(replace(a."metadata"->>'from', '_', ' ')) AS "from_label",
           initcap(replace(a."metadata"->>'to', '_', ' ')) AS "to_label"
    FROM "activity_logs" a
    LEFT JOIN "tasks" t ON t."id" = a."task_id"
    LEFT JOIN "projects" p ON p."id" = a."project_id"
)
UPDATE "activity_logs" AS a
SET "message" = CASE a."action"::text
    WHEN 'PROJECT_CREATED' THEN 'created the project "' || s."project_name" || '"'
    WHEN 'PROJECT_DELETED' THEN 'deleted the project "' || s."project_name" || '"'
    WHEN 'PROJECT_UPDATED' THEN CASE
        WHEN s."field" = 'name' THEN 'renamed the project "' || (a."metadata"->>'from') || '" to "' || (a."metadata"->>'to') || '"'
        WHEN s."field" IN ('priority', 'status') AND s."to_label" IS NOT NULL
            THEN 'changed the ' || s."field" || ' of the project "' || s."project_name" || '" to ' || s."to_label"
        ELSE 'updated the ' || s."field_name" || ' of the project "' || s."project_name" || '"'
    END
    WHEN 'TASK_CREATED' THEN 'created "' || s."task_title" || '"'
    WHEN 'TASK_DELETED' THEN 'deleted "' || s."task_title" || '"'
    WHEN 'TASK_ASSIGNED' THEN coalesce(
        'assigned "' || s."task_title" || '" to ' || (a."metadata"->>'assigneeName'),
        'unassigned "' || s."task_title" || '"')
    WHEN 'TASK_STATUS_CHANGED' THEN 'moved "' || s."task_title" || '" from ' || s."from_label" || ' to ' || s."to_label"
    WHEN 'TASK_UPDATED' THEN CASE
        WHEN s."field" = 'title' THEN 'renamed "' || (a."metadata"->>'from') || '" to "' || (a."metadata"->>'to') || '"'
        WHEN s."field" IN ('priority', 'status') AND s."to_label" IS NOT NULL
            THEN 'changed the ' || s."field" || ' of "' || s."task_title" || '" to ' || s."to_label"
        ELSE 'updated the ' || s."field_name" || ' of "' || s."task_title" || '"'
    END
END
FROM "subject" s
WHERE s."id" = a."id";

-- Rows the CASE couldn't describe (e.g. names no longer available) still get something readable.
UPDATE "activity_logs" SET "message" = lower(replace("action"::text, '_', ' ')) WHERE "message" IS NULL;

ALTER TABLE "activity_logs" ALTER COLUMN "message" SET NOT NULL;
