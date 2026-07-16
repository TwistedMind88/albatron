-- faza 14.4 (stavke 7-8 + 2-4): privilegije prelaze na module-kljuceve (jedan model).
-- 'dokumenti' se siri na module tipova dokumenata, 'subjekti' na klijenti+dobavljaci,
-- 'artikli' dobija i 'cenovnici' (cenovnici su do sada bili pod artikli guardom).
INSERT INTO privileges (role_id, user_id, resource, level)
SELECT p.role_id, p.user_id, m.modul, p.level
FROM privileges p
CROSS JOIN (VALUES ('ponude'),('predracuni'),('racuni'),('avansni_racuni'),('otpremnice'),('reversi'),('kalkulacije'),('porudzbine'),('priprema_uvoza'),('ulaz_robe')) AS m(modul)
WHERE p.resource = 'dokumenti';--> statement-breakpoint
INSERT INTO privileges (role_id, user_id, resource, level)
SELECT p.role_id, p.user_id, m.modul, p.level
FROM privileges p
CROSS JOIN (VALUES ('klijenti'),('dobavljaci')) AS m(modul)
WHERE p.resource = 'subjekti';--> statement-breakpoint
INSERT INTO privileges (role_id, user_id, resource, level)
SELECT p.role_id, p.user_id, 'cenovnici', p.level
FROM privileges p
WHERE p.resource = 'artikli';--> statement-breakpoint
DELETE FROM privileges WHERE resource IN ('dokumenti', 'subjekti');
