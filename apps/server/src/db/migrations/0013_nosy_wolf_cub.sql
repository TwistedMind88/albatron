ALTER TABLE "categories" ADD COLUMN "code" varchar(9);--> statement-breakpoint
WITH RECURSIVE tree AS (
  SELECT id, chr(64 + row_number() OVER (ORDER BY sort_order, id)::int)::text AS sig
  FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, t.sig || lpad(c.rn::text, 2, '0')
  FROM (
    SELECT id, parent_id, row_number() OVER (PARTITION BY parent_id ORDER BY sort_order, id) AS rn
    FROM categories WHERE parent_id IS NOT NULL
  ) c
  JOIN tree t ON c.parent_id = t.id
)
UPDATE categories SET code = rpad(tree.sig, 9, '0') FROM tree WHERE categories.id = tree.id;
