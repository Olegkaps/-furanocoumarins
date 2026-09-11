# QA-инструкция — Furanocoumarins Analysis Platform

Этот документ описывает текущий контракт платформы: публичный научный поиск,
импорт XLSX, хранение таблиц в PostgreSQL, редактируемые страницы в S3/MinIO и
аутентификацию через приватный auth-master. Общая установка описана в
[README](../README.md), детали интеграции и миграции — в
[auth-master integration](AUTH_MASTER.md).

{% note info %}

Браузер обращается только к фиксированным same-origin маршрутам `/auth/*` на
`go-auth`. Сервис `authd` не публикует порт наружу и не является произвольным
reverse proxy. При недоступности auth-master защищённые операции закрываются с
ошибкой, а не переходят в режим без авторизации.

{% endnote %}

## 1. Матрица доступа

| Пользователь | Разрешено |
|---|---|
| Анонимный | `GET /ping`, metadata, autocomplete, поиск, статьи и страницы; публичные экраны `/about`, `/search`, `/table`, `/tree`, `/reference/:article_id`, `/page/:smiles` |
| Любой активный пользователь | Всё публичное, собственный профиль и сессии, а также чтение списка версий таблиц через `POST /get-tables-list` |
| Пользователь с ролью `admin` | Все изменения научных данных: импорт, активация и удаление таблиц, замена BibTeX, запись страниц |
| Superuser | Приглашения, поиск пользователей, ban/unban, ротация signing key и назначение/снятие роли `admin`; для изменения научных данных ему также нужна роль `admin` |

Пароль не является признаком роли. Пользователь без пароля может войти по
magic link и получить все назначенные полномочия. Только superuser может
назначить или снять `admin`; обычный admin не может повышать ни себя, ни другого
пользователя. Superuser нельзя забанить.

Каждый защищённый запрос заново проверяет access token и актуальное состояние
пользователя в auth-master. Ожидаемые ответы:

- нет, истёк или отозван токен — `401`;
- токен действителен, но роли недостаточно — `403`;
- auth-master недоступен или вернул недоверенный ответ — `503`;
- забаненный пользователь теряет доступ, а его refresh-сессии отзываются.

## 2. Подготовка стенда и миграция пользователей

### 2.1. Автоматизированный QA-стенд

Все зависимости и все проверки запускаются только целями корневого Makefile:

```bash
make install
make test
```

`make install` устанавливает точные frontend-зависимости и Chromium для
Playwright. `make test` сам проверяет Compose-конфигурации и поднимает
изолированный стек. Не запускайте `go test`, Playwright, Podman или Docker
напрямую: так легко обойти подготовку фикстур, миграцию или итоговую сводку.

Для ручного локального запуска и первичной инициализации доменных PostgreSQL/S3
хранилищ следуйте [README](../README.md#project-launch). Legacy-команда создания
администратора больше не используется: новые аккаунты создаёт выбранный
superuser через приглашения, а права выдаются в auth-master.

### 2.2. Одноразовая миграция legacy PostgreSQL

Перед миграцией сделайте резервные копии обеих PostgreSQL и выберите ровно одну
legacy-учётную запись, которая станет superuser. DSN источника должен быть
доступен из Compose-сети.

```bash
export AUTH_MASTER_CONTEXT=../auth-master
export FURANO_SUPERUSER=selected-login-or-email
export FURANO_SOURCE_DATABASE_URL='postgres://USER:PASSWORD@postgres:5432/DB?sslmode=disable'
make auth-import
```

Цель `make auth-import`:

1. запускает authd, чтобы именно развернутая версия создала целевую схему;
2. останавливает оба writer-процесса — `authd` и `go-auth`;
3. запускает принадлежащий Furanocoumarins one-shot importer;
4. восстанавливает сервисы даже при ошибке.

Импорт нормализует login и email без учёта регистра, поэтому значения вроде
`Mixed.User@Example.Test` корректны. Коллизии после нормализации, неоднозначный
выбор superuser и drift источника отклоняются. Legacy password hashes не
читаются и не копируются. Legacy-admin получают роль `admin`; выбранный
пользователь получает `admin` и superuser authority. Точный повтор безопасен,
восстанавливает требуемые memberships и не перезаписывает пароль, который
пользователь установил после миграции.

После миграции все импортированные пользователи passwordless. Они могут
неограниченно входить новыми одноразовыми magic links и не обязаны задавать
пароль. Обычный reset-flow может при желании впервые установить пароль или
заменить существующий забытый пароль.

Проверки после миграции:

- выбранная учётная запись входит по magic link и сразу видит superuser-раздел;
- legacy-admin может менять научные данные, но не может выдавать роли;
- обычный legacy-user не может менять научные данные;
- login/email с разным регистром находят одну и ту же identity;
- повтор `make auth-import` не меняет установленный пароль и не дублирует audit
  или memberships.

## 3. Автоматические проверки

| Команда | Что проверяет |
|---|---|
| `make lint` | `go vet`, ESLint и TypeScript-совместимость frontend |
| `make test-unit` | deployment-contract скрипты, backend unit/regression, frontend unit, production build |
| `make test-race` | backend-тесты с race detector |
| `make test-integration` | реальный изолированный стек; это тот же Compose-backed browser/integration gate, что и `make test-e2e` |
| `make test-e2e` | импорт пользователей, PostgreSQL, private authd, Mailpit, go-auth, Vite и Playwright Chromium |
| `make test` | полный gate: Compose contract, lint, unit, race, integration и E2E с итоговой сводкой |

Browser/integration gate проверяет не только наличие экранов. В нём есть:

- миграция 31 mixed-case fixtures и выбранного passwordless superuser;
- повторный magic login без установки пароля;
- опциональный reset для `password_hash = NULL` и reset забытого существующего
  пароля;
- password + email OTP, неправильный/replayed OTP;
- истечение access token, single-flight refresh, ротация refresh token и отказ
  replay старого credential;
- список и отзыв пользовательских сессий, logout с серверным отзывом;
- приглашение и регистрация `/register?token=…`;
- пагинация пользователей/ролей, grant `admin`, запрет grant от обычного admin,
  ban/unban и signing-key rotation;
- отказ защищённых мутаций анонимному пользователю;
- реальный импорт детерминированного XLSX в PostgreSQL, статус `Ready`,
  активация и live-запрос `/search` к сохранённым join/ref данным;
- отказ активации missing/broken версии без потери прежней active и ровно одну
  active Ready-версию после конкурентных активаций;
- браузерный научный поиск, grouping/filtering одного result set, безопасные
  ссылки и сохранение отдельных строк для разных species/chemical даже при
  одинаковых значениях и references;
- frontend unit regression отдельно проверяет, что повтор одной domain row в
  compare series дедуплицируется; browser journey для самого compare/cmp UI
  пока относится к ручным сценариям;
- остановку Mailpit и generic-ответ на ошибку доставки magic link;
- повтор importer после намеренной порчи memberships: ремонт полномочий,
  сохранение пароля/тегов и единственной audit-записи.

Публичный UI-тест использует детерминированные mock-ответы metadata/search для
точной проверки построения запроса и рендера. Отдельный passwordless journey
проверяет live PostgreSQL import/search через настоящий backend.

### 3.1. Что остаётся ручным

Автотесты существенно уменьшают ручной регресс, но не заменяют следующие
проверки:

- production Swarm, TLS, реальные Docker secrets, внешний SMTP и cloud S3;
- запись/чтение About и substance pages через настоящий MinIO/S3;
- одновременный импорт с нескольких реальных реплик приложения и PostgreSQL;
- разрушительный corpus/fuzz для autocomplete и search на одноразовом стенде;
- браузеры кроме Chromium, responsive layout, screen reader, полная
  accessibility и визуальная регрессия;
- продолжительная нагрузка, cache TTL, workbook около 10 MiB и граничные
  zip-bomb/expanded-XML cases;
- ручная научная верификация дерева, ссылок, BibTeX и экспортированного XLSX на
  полном production-like dataset.

{% note warning %}

Injection/fuzz, удаление активной таблицы и испытания больших архивов проводите
только на изолированном стенде с disposable PostgreSQL. Не используйте
production или единственную копию научных данных.

{% endnote %}

## 4. Аутентификация, сессии и роли

### 4.1. Пароль и OTP

1. На `/login` введите login/email и пароль.
2. `POST /auth/login` должен вернуть challenge и отправить код на email, но не
   должен сразу создать браузерную сессию.
3. Введите код; UI вызывает `POST /auth/login-verify-otp` и переходит на
   `/admin`.
4. Неверный или уже использованный код должен вернуть пользователя к вводу
   пароля для нового challenge и не раскрыть подробности учётной записи.

Маршруты `POST /auth/password/2fa` и `POST /auth/password` поддерживают
step-up-подтверждение смены пароля. Проверяйте одноразовость кода, password
policy и отзыв/обновление credentials согласно ответу auth-master.

### 4.2. Magic link — полноценный повторяемый вход

1. Переключите форму `/login` в режим **Log in by mail**.
2. UI вызывает `POST /auth/login-mail` и всегда показывает generic-сообщение,
   не раскрывающее существование identity или результат доставки.
3. Письмо содержит canonical callback `/admit?token=…`.
4. Переход по ссылке один раз вызывает `POST /auth/confirm-login-mail`, сохраняет
   rotating credentials и открывает `/admin`.
5. Повтор той же ссылки показывает понятное сообщение об invalid/used link и
   ссылку на запрос нового.
6. Выйдите и запросите новый magic link: passwordless user должен снова войти
   без установки пароля.

### 4.3. Сброс пароля

На `/reset` первый шаг вызывает `POST /auth/password-reset/start`. Ответ всегда
generic. Код из письма и новый пароль отправляются в
`POST /auth/password-reset/complete`.

Одинаково проверяются два случая:

- у мигрированного пользователя пароль отсутствует — reset впервые его задаёт;
- пользователь забыл существующий пароль — reset заменяет его без знания
  старого.

Слабый пароль отклоняется, но тот же ещё действительный reset code можно
повторить с подходящим паролем. Неверный/истёкший код не должен менять пароль.
Наличие пароля не запрещает дальнейший вход по magic link.

### 4.4. Refresh, sessions и logout

- UI вызывает `POST /auth/refresh` при истечении/инвалидации access token,
  сохраняет новую rotating refresh credential и повторяет исходный запрос.
- Одновременные и поздние `401` одного поколения access token должны вызвать
  только одну ротацию. Старый refresh token после успеха не принимается.
- Временный `503` refresh не должен стирать сохранённые credentials; повтор
  после восстановления сервиса должен завершиться успешно.
- `/admin` показывает собственные сессии из `GET /auth/sessions`. Отзыв через
  `DELETE /auth/sessions/:sessionID` делает refresh этой сессии непригодным.
- BFF также предоставляет OTP step-up маршруты
  `POST /auth/sessions/revoke-otp` и
  `POST /auth/sessions/:sessionID/revoke` для соответствующего auth-master
  сценария.
- `/logout` вызывает `POST /auth/logout`, а затем очищает access, refresh,
  CSRF и сохранённое имя. Стабильный `auth-device-id` намеренно остаётся для
  идентичности этого браузера. После logout ни старый, ни уже ротированный
  конкурентным refresh credential не должны работать.

### 4.5. Приглашения и superuser-раздел

Только superuser видит и может использовать account-security controls:

1. создать invitation через `POST /auth/admin/invitations`;
2. открыть canonical `/register?token=…`, проверить предварительно заполненный
   email и зарегистрировать новый аккаунт через `POST /auth/register`;
3. найти пользователя с keyset pagination в `GET /auth/admin/users`;
4. ban/unban через `/auth/admin/users/:userID/ban`;
5. найти точную роль `admin` через paginated `/auth/admin/roles` и назначить её
   кнопкой **Grant admin**. UI снятия membership пока нет; ручная API-проверка
   использует `DELETE /auth/admin/roles/:roleID/members/:userID`;
6. выполнить `POST /auth/admin/signing-keys/rotate` и убедиться, что открытый UI
   прозрачно получает новое поколение access token.

Обычный admin получает `403` на все эти операции. После ban password, magic
link, текущий access и refresh должны быть непригодны. Superuser нельзя выбрать
для ban.

## 5. Импорт XLSX

Импорт доступен только роли `admin`. Форма отправляет `.xlsx`, имя meta-листа и
имя таблицы в `POST /create-table`. Успешный admission возвращает `import_id`,
после чего UI опрашивает `GET /table-imports/:importID` до `ready` или `broken`
с ограничением примерно 120 секунд.

- request body ограничен 10 MiB;
- распакованные данные workbook ограничены 32 MiB, отдельный XML — 4 MiB;
- процесс принимает только один импорт одновременно; второй получает `409` до
  открытия/распаковки архива, а UI сохраняет файл и поля формы;
- tracker хранится в памяти процесса: после рестарта status может вернуть
  `404`; UI предлагает проверить список таблиц и не делает слепой повтор;
- синхронный `400` до успешного admission не возвращает `import_id` и сразу
  удаляется из tracker; доступная terminal history ограничена 128 записями на
  процесс и одним часом, а сохранённое имя — 256 UTF-8 bytes;
- `ready` означает завершённый импорт, но новая версия не становится active
  автоматически;
- `broken` сопровождается безопасным UI-сообщением, подробностями в backend log
  и письмом автору;
- email об успехе напоминает активировать таблицу.

### 5.1. Строгий preflight до записи в PostgreSQL

До reservation и первой записи проверяется полный metadata/join contract.
Идентификаторы колонок обязаны соответствовать
`^[A-Za-z][A-Za-z0-9_]*$`; зарезервированные CQL-слова отклоняются без учёта
регистра. Идентификаторы внутри одного virtual sheet уникальны без учёта
регистра.

Также preflight проверяет:

- PostgreSQL-compatible column definitions состоят только из `TEXT`, `SET<TEXT>` или
  `UUID`;
- каждый virtual sheet имеет ровно один существующий primary key;
- типы и структурные модификаторы `external`, `default`, `clas`, `link`, `set`
  синтаксически полны; пустые, незакрытые, лишние и повторные модификаторы
  отклоняются;
- аргумент `default[...]` — безопасный существующий column identifier;
- `link[...]` содержит ровно один `%s` и безопасный фиксированный HTTPS или
  root-relative path template;
- external-граф не содержит неизвестных sheet, повторного использования и
  циклов;
- одна колонка на разных sheets имеет одинаковое description, а types
  различаются только допустимыми `primary`/`external` ролями.

Злые имена вроде `name); DROP TABLE data;--`, reserved keywords и дубликаты
case-variants должны завершаться preflight error без database calls. Это
проверено unit/regression tests; утверждение, что произвольное имя колонки из
XLSX достигает SQL DDL, больше не соответствует реализации.

Registry key версии таблицы резервируется PostgreSQL уникальным ключом.
Неопределённая ошибка базы останавливает импорт, чтобы не создавать вторую
таблицу с неизвестным статусом.

### 5.2. Meta-лист

Обязательные колонки: `sheet`, `column`, `type`, `description`, `show_name`.

Строки `sheet = __LIST__` регистрируют real Excel sheet:

| `column` | `type` | Значение |
|---|---|---|
| Имя real sheet | Имя virtual sheet | Например `main`, `classification`, `structures` |

Обязательны virtual sheets `main` и `classification`. Любая другая metadata
row должна ссылаться на virtual name, объявленный через `__LIST__`.

Основные type-теги:

| Тег | Контракт |
|---|---|
| `primary` | Ключ строки virtual sheet |
| `external[name]` | Join с другим virtual sheet |
| `ref[]` | Набор article IDs для последующей BibTeX-проверки |
| `search` | Search/autocomplete index, если тип совместим |
| `set` / `set[<>]` / `set[a b]` | Для первых двух backend выводит варианты из импортированных данных; явные варианты сохраняются |
| `default[column]` | Заполнение пустого значения из указанной колонки |
| `invisible` | Не показывать как обычную колонку UI |
| `clas[NN]` / `clas[NN][tag]` | Уровень таксономии для дерева |
| `SMILES` / `smiles` | Структура вещества и ссылка на substance page |
| `link[template]` | Безопасная ссылка с одним `%s` path segment |
| `table_...` | Группировка results по chemical/species domain identity |

Импорт сохраняет также отдельные обработанные строки всех virtual sheets до
join, включая неиспользованные записи. `classification` — виды, `structures` —
вещества, необязательные `publication`/`publications` — публикации из workbook.
Остальные sheets, включая `main`, тоже сохраняются. Каталог версии хранит
исходные имена sheets, ключи, metadata колонок и ссылки на отдельные таблицы;
внешние ключи в этих таблицах не заменяются присоединёнными значениями.
Глобальный `chemdb.bibtex` остаётся отдельным источником библиографии.

Проверяйте, что запись без ссылки из `main` остаётся в исходной entity-таблице,
но не появляется в joined search. Ready допустим только после сохранения всех
таблиц и каталога. Удаление версии удаляет её source-таблицы, но не BibTeX.
При миграции legacy-версии без такого каталога нельзя считать утраченные
исходные вещества восстановленными из join: для полного набора нужен workbook.

### 5.3. Строки данных и скрытый текст `#…#`

При чтении значений ячеек каждая полная пара ASCII `#` удаляется вместе с
текстом внутри, затем значение trim-ится. Обработка повторяется слева направо:

```text
alpha#secret#beta           -> alphabeta
a##b                        -> ab
only#one                    -> only#one
i# #love# Harry# Potter##   -> ilove Potter
```

Одиночный `#` и полноширинный `＃` остаются. Правило применяется к значениям
meta и data cells, но не к заголовкам колонок, markdown pages или UI-усечению.
Primary map key нормализуется тем же удалением `#…#` и trim, что и сохранённое
primary value. Поэтому одинаково аннотированные primary/external значения
join-ятся по видимому значению; коллизия двух сырых ключей после нормализации
отклоняется как duplicate, а не молча объединяется.

Другие правила:

- полностью пустая строка без ключа пропускается;
- пустой ключ при непустых данных — ошибка;
- дубликат ключа на одном real sheet или при merge в один virtual sheet —
  ошибка;
- пустой `external` key — ошибка;
- пустое non-set значение после обработки становится одним пробелом;
- `set` разделяется по пробелам и `_`;
- `default[column]` заполняет только пустое значение.

### 5.4. Версии, BibTeX и активация

- Готовая новая версия имеет `is_ok=true`, `is_active=false`.
- Активация через `POST /make-table-active/:timestamp` переключает metadata и
  поиск; проверьте, что старые filters не залипли в cache.
- Missing или Broken timestamp возвращает ошибку и сохраняет прежнюю active
  версию. Конкурентные активации сериализуются PostgreSQL транзакцией; после их
  завершения active должна быть ровно одна Ready-версия.
- `DELETE /table/:timestamp` удаляет одну версию, `DELETE /tables` — broken
  versions. Удаление active проверяйте только на disposable стенде.
- UI ограничивает число версий и скрывает create control при достижении лимита
  15.
- `PUT /bibtex` заменяет справочник. ID из `ref[]` проверяются после импорта;
  отсутствующие ссылки возвращаются как warning, а не обязательно hard failure.
- Публичная статья открывается `/reference/:article_id` через
  `GET /article/:id`.

## 6. Поиск, дерево и результаты

`GET /search?q=` принимает только известные metadata columns, строковые
литералы и allowlisted operators: `AND`, `CONTAINS`, `LIKE`, `=`, `!=`, `<`,
`>`, `<=`, `>=`. `LIKE` выполняется PostgreSQL-оператором `ILIKE`. Пустой
запрос, неизвестные identifiers, `OR 1=1`, `UNION`, `; DROP` и незавершённые
literals должны вернуть `400`, а не сырой SQL или `500`.

Валидатор ограничивает grammar, а адаптер параметризует значения PostgreSQL
`WHERE`. Поэтому ручной security corpus на изолированном PostgreSQL всё ещё
полезен. Особенно проверяйте
`GET /autocomplete/:column?value=`: path column и prefix не должны позволять
читать чужую колонку, ломать literal или выдавать backend/SQL details.

Ручной UI-checklist (в частности, compare/cmp сценарии, которых нет в browser
automation):

- metadata и autocomplete соответствуют active table;
- `invisible` не появляется обычным фильтром или result column;
- дерево использует `clas[NN]`, а counts согласованы с таблицей;
- `NoValue` нормализуется в пустое display value;
- SMILES рендерится и открывает `/page/:smiles`;
- безопасный `link[...]` URL-кодирует cell value как один path segment;
- comparison поддерживает до четырёх запросов, отмечает принадлежность строк и
  экспортирует отдельные sheets;
- повтор одной domain row в compare series не создаёт дубликат;
- две научно разные строки с разными species или chemical не схлопываются,
  даже если все остальные значения и references полностью совпадают;
- History `/history` сохраняет успешные compare groups.

## 7. Редактируемые страницы и S3/MinIO

`GET /pages/:name` публичен. Только `admin` может вызвать
`PUT /pages/:name`; лимит текста — 10 000 Unicode code points. About и
substance descriptions хранятся в S3-compatible storage, локально — MinIO.

Ручной checklist:

- admin сохраняет About, затем анонимный браузер видит новый текст;
- пользователь без `admin` получает `403`, а анонимный — `401`;
- 10 001 символ отклоняется с `400`;
- markdown `#` остаётся заголовком и не проходит XLSX `#…#` processing;
- недоступный S3 даёт контролируемую ошибку и не сообщает credentials.

## 8. Минимальный smoke после deploy

1. `GET /ping` возвращает `200`.
2. Passwordless migrated superuser входит по `/admit?token=…`.
3. Password login требует email OTP.
4. Superuser создаёт `/register?token=…`, новый пользователь регистрируется.
5. Только superuser выдаёт новому пользователю `admin`.
6. Admin импортирует маленький валидный XLSX, видит `Ready`, активирует версию.
7. Live `/search` возвращает импортированные species, chemical и references;
   таблица и дерево согласованы.
8. Анонимный пользователь видит результаты, но не может выполнить мутацию.
9. Пользователь видит свои sessions; отозванный refresh и logout replay
   отвергаются.
10. About и одна substance page читаются из configured S3/MinIO.

## 9. Карта экранов и API

| Экран | Назначение |
|---|---|
| `/`, `/about` | Публичная About page |
| `/search` | Фильтры и запуск запросов |
| `/table` | Результаты и сравнение |
| `/tree` | Филогенетическое дерево |
| `/history`, `/cache` | Сохранённые запросы и cache-related UI |
| `/page/:smiles` | Описание вещества |
| `/reference/:article_id` | BibTeX article |
| `/login`, `/reset`, `/admit?token=…`, `/register?token=…`, `/logout` | Auth journeys |
| `/admin` | Таблицы, BibTeX, sessions и superuser management |

Публичные domain API: `/ping`, `/metadata`, `/autocomplete/:column`, `/search`,
`/article/:id`, `GET /pages/:name`. Swagger UI доступен на `/docs`, когда не
отключён режимом окружения.

Auth BFF не должен принимать произвольный auth-master path. Его фиксированные
маршруты перечислены в [разделе аутентификации](#4-аутентификация-сессии-и-роли)
и router contract tests.

## 10. Шаблоны баг-репорта

### Импорт

```text
Заголовок: [Import] краткое поведение
Окружение: commit/image, compose или Swarm, active version
Пользователь: login, superuser/admin flags; секреты и токены не прикладывать
Шаги:
  1. XLSX, sheet/cell и meta sheet name
  2. table name и действие Create
  3. import_id и последний видимый state
  4. письмо, table list, activation и проверенный search query
Фактически: ...
Ожидание: ...
Вложения: минимальный XLSX, screenshot, sanitized log correlation
```

### Auth/session

```text
Заголовок: [Auth] magic/password/OTP/refresh/session/invite/ban
Окружение: commit/image, browser, время и device label
Предусловия: migrated/new, passwordless/password, admin/superuser, banned/active
Шаги: ...
Фактически: HTTP status + безопасный UI message
Ожидание: ...
Не прикладывать: access/refresh/CSRF tokens, callback token, OTP, password
```
