# выполнение плана подтверждаемой записи через hermes

статус: реализация начата пользователем, production и writer не включены. это журнал разработки, не акт live acceptance.

## основа

- утверждённые дизайн/план находятся в `docs/superpowers/specs/2026-10-27-hermes-dashboard-write-design.md` и `docs/superpowers/plans/2026-10-27-hermes-dashboard-write.md`;
- прямая зависимость: pr #70, head `cc74d37acfca58c610b257176ec6ffbc8bd82cde`, на начало работы open;
- issue: [защита от потери правок #71](https://github.com/quazarsdaw/my-dashboard/issues/71);
- отдельная ветка первого pr: `feature/hermes-dashboard-versioned-sync`;
- исходная проверка: frontend 537/537, school 108/108, reader 14/14, python reader 10/10, check/lint обеих edge functions прошли.

## задача 1: postgres cas

- штатная cli `supabase@2.122.0` создала `20261026221536_dashboard_document_versions.sql`; имя не придумывалось/не переименовывалось;
- исходные миграции не изменены; только изолированные synthetic базы применяют их с нуля, production history не менялась;
- red: 18 postgres tests выполнялись на настоящей временной базе и падали на отсутствующих rpc/versions;
- green: 18/18 на локальном postgres 18.4, включая stale update, конкурентный first insert, move, rollback, tombstone, owner/anon isolation, guard, неизменность text и строковые bigint revisions;
- добавлена ci-проверка postgres 17/pgTAP с фиксированными официальными image/action digests. она пока не запускалась: отсутствие запуска не считается green;
- guard/write по умолчанию false; capability rpc не даёт браузеру права включить flags;
- shared-memory startup требовал разрешения вне sandbox; использовались только временный cluster, unix socket и synthetic данные, не production.

## ещё не выполнено

задачи 2–11, независимое ревью, три pr, фактические pg17/pgTAP ci, desktop/mobile synthetic acceptance. production schema/history/advisors и реальный telegram проверяются перед отдельным разрешённым deployment/activation, не подменяются локальными результатами.
