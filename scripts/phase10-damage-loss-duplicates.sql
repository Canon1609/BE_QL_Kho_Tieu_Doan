-- READ ONLY: inspect legacy dimension duplicates before applying reconciliation migration.
-- NULL dimensions are normalized to 0 exactly as in the original unique-index expression.
SELECT report_id, material_id, location_id, source_id,
       COALESCE(condition_id, 0) AS condition_key,
       COALESCE(borrow_line_id, 0) AS borrow_key,
       COUNT(*) AS duplicate_count,
       GROUP_CONCAT(id ORDER BY id) AS item_ids
FROM damage_loss_items
GROUP BY report_id, material_id, location_id, source_id,
         COALESCE(condition_id, 0), COALESCE(borrow_line_id, 0)
HAVING COUNT(*) > 1
ORDER BY report_id, material_id, location_id, source_id;

-- Read-only migration/history and expected repair migration dependency checks.
SELECT name FROM SequelizeMeta ORDER BY name;
SHOW TABLES LIKE 'damage_repair_%';
SHOW INDEX FROM damage_loss_items;
