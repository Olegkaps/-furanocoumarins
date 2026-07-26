# Инструкция для тестировщика — Furanocoumarins Analysis Platform

Платформа для анализа содержания фуранокумаринов (и других веществ) в растениях: поиск/фильтры, филогенетическое дерево, таблица результатов, админка для импорта Excel (Google Sheets → `.xlsx`) и правок страниц.

Автотесты почти только на backend (Go). Frontend и сквозные сценарии нужно проверять вручную. API-справка: Swagger `http://<host>:8081/docs` (недоступна при `ENV_TYPE=TEST|AUTOTEST`).

---

## 1. Что тестируем (области)

| Зона | Кто | Суть |
|------|-----|------|
| Публичный UI | аноним | About, поиск, дерево, таблица, страница вещества, справочник (bibtex) |
| Админка | JWT admin | импорт таблиц, активация/удаление версий, загрузка bibtex |
| Auth | admin | пароль, magic-link, сброс пароля, renew JWT |
| Данные | Cassandra + S3 | активная версия таблицы, страницы в MinIO/S3 |
| Security | аноним + admin | CQL/SQL injection: autocomplete, search `q=`, DDL из Excel meta — [§5](#5-инъекции-sql--cql) |

Роли по факту две: **аноним** и **admin**. Отдельной матрицы ролей в UI нет.

---

## 2. Подготовка стенда

### 2.1. Запуск

Локально (с MinIO для редактируемых страниц):

```bash
docker compose -f docker-compose.local.yaml up -d
```

Инициализация (порядок важен):

```bash
go build -o cli ./cli
./cli init postgresql
./cli init cass_key      # keyspace chemdb
./cli init cassandra     # tables, bibtex, pages
./cli create_admin <username> <email>
```

**Важно:** `create_admin` создаёт пользователя с пустым хэшем пароля. Первый вход по паролю может не сработать — задайте пароль через **сброс пароля** (письмо) или проверьте magic-link.

### 2.2. Порты (типичный local)

| Сервис | Порт |
|--------|------|
| API (go-auth) | **8081** |
| Frontend (dev/Vite или контейнер) | зависит от запуска; в письмах — `DOMAIN_PREF` |
| Postgres | 5432 |
| Redis | 6379 |
| Cassandra | 9042 |
| MinIO | 9000 / console 9001 (`minioadmin` / `minioadmin`) |

Проверка живого API: `GET /ping`.

### 2.3. Критичные env для QA

- `VITE_REACT_APP_BACKEND_SOURCE` — URL API для фронта (обычно `http://localhost:8081`)
- `DOMAIN_PREF` — базовый URL фронта в письмах (`…/admit/<token>`)
- `ALLOW_ORIGIN` — CORS
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `MAIL`, `MAIL_SECRET`
- S3/MinIO: `S3_ENDPOINT`, ключи, `S3_BUCKET` — без них About / `/page/:smiles` не работают на запись
- `SECRET_KEY` — JWT

Без **активной** таблицы в Cassandra поиск/metadata пустые или ошибочные.

### 2.4. Автотесты (регрессия backend, не замена ручного QA)

```bash
cd backend/admin && ./scripts/test.sh
# с Postgres:
export TEST_POSTGRES_DSN="user=postgres password=postgres dbname=postgres host=127.0.0.1 port=5432 sslmode=disable"
RUN_INTEGRATION=1 ./scripts/test.sh
# Docker (без integration):
docker build backend/admin --file Dockerfile.test --build-arg VAR=$(date +%s)
```

Покрытие unit: auth, validator поиска, импорт (моки Cassandra), `#…#`-вырезка, bibtex-парсер, virtual sheets.  
**Не покрыто автотестами:** почти весь HTTP слой (search/tables/create/pages/bibtex handlers), реальный SMTP/Cassandra, **весь frontend**, e2e.

---

## 3. Бизнес-логика импорта Excel (главный фокус)

Импорт: админка → загрузка `.xlsx` + имя meta-листа + имя таблицы → `POST /create-table` (JWT).

Ответ **200 сразу**, импорт **асинхронный**. UI через ~3 с обновляет список. На почту автора уходят письма об успехе/ошибке.

Лимит тела запроса: **10 MB**. На UI: максимум **15** версий таблиц (`MAX_TABLES_COUNT`).

### 3.1. Meta-лист

Обязательные колонки: `sheet`, `column`, `type`, `description`, `show_name`.

#### Регистрация листов — `__LIST__`

Строки с `sheet = __LIST__`:

| column | type | смысл |
|--------|------|--------|
| имя реального листа Excel | виртуальное имя (`main`, `classification`, `structures`, …) | связь Excel sheet → логический лист |

Правила:

1. Листы с `sheet`, начинающимся на `__`, в meta для БД **не пишутся** (служебные).
2. Все остальные строки meta должны ссылаться на виртуальные имена, зарегистрированные через `__LIST__`, иначе ошибка:  
   `got unknown sheet name '...'. Did you register this sheet as __LIST__ ?`
3. Обязательны виртуальные листы **`main`** и **`classification`** (в тексте ошибки возможен опечаточный `classifaction`).
4. Без регистрации реального листа в `__LIST__` данные с него не попадут в импорт ожидаемым образом.

#### Теги в колонке `type` (через пробел; матч по подстроке)

| Тег | Поведение |
|-----|-----------|
| `primary` | Ключ строк виртуального листа |
| `external[name]` | Джойн к другому виртуальному листу |
| `ref[]` | ID статей; после импорта сверяются с BibTeX (см. ниже) |
| `search` | SASI-индекс (если не `set` / `external[`) |
| `set` | Множество; разделители элементов: **пробел** и **`_`** |
| `default[ColName]` | Пустые ячейки заполняются из колонки `ColName` |
| `invisible` | Не показывается в UI поиска / не входит в visible columns |
| `clas[NN]` / `clas[NN][tag]` | Уровни таксономии для дерева |
| `SMILES` / `smiles` | Химическая структура + страница вещества |
| `link[...]` | Отрисовка ссылок |
| `table_` | Используется фронтом для группировки chemical/specie |

Автодополнение типов при импорте:

- к `structures` / `external[structures…]` / primary этих листов добавляются `chemical` / `keycolumn`;
- к `classification` / `external[classification…]` — `specie` / `keycolumn`.

Согласованность: одна и та же колонка на разных листах должна иметь **одинаковый `description`**; типы могут отличаться **только** по `primary` / `external[...]`. Иначе импорт падает с ошибкой сравнения types/descriptions.

### 3.2. Вырезка скрытого текста через `#…#` / `##` ⚠️

Это **не** markdown-заголовки и **не** отдельный оператор `##`.  
Алгоритм: парные маркеры **`#` … `#`** (`RemoveHiden` при чтении ячеек Excel).

**Правила:**

1. Находится первая `#`, затем ближайшая следующая `#` — вырезается **всё между ними включительно** (оба маркера и текст).
2. Процесс **повторяется**, пока есть хотя бы одна полная пара.
3. `##` = пустая вырезка (два маркера подряд удаляются, между ними ничего нет).
4. Непарная одиночная `#` **остаётся** в строке.
5. После всех вырезок значение **обрезается по пробелам** (`Trim`).
6. Применяется к **значениям ячеек** (meta и data) при `ReadXLSXToMap`. Заголовки колонок **не** вырезаются.
7. **Асимметрия primary-ключа:** значение в хранилище для ключевых колонок из `columnNames` проходит вырезку, а **ключ map-строки** берётся из сырой ячейки (только Trim). Возможна рассинхронизация «ключ ↔ отображаемое значение», если `#…#` стоит в primary-колонке.
8. На страницах About / markdown (`/pages/...`) вырезка **не** применяется — там `#` обычный markdown.

**Эталон из unit-тестов:**

| Вход | Ожидание |
|------|----------|
| `no need remove` | без изменений |
| `i love# Harry Potter#` | `i love` |
| `i# #love# Harry# Potter##` | `ilove Potter` |
| `vis#hidden#` (ячейка в xlsx) | в данных `vis` |

**Чеклист ручной проверки вырезки:**

- [ ] Одна пара `#hidden#` в середине/в конце ячейки — скрытый фрагмент не попадает в поиск/таблицу.
- [ ] Несколько пар в одной ячейке — все пары снимаются по порядку слева направо.
- [ ] `##` удаляет только маркеры, соседний видимый текст сохраняется.
- [ ] Строка только из `##` → пустое значение (далее см. правила empty → пробел для non-set).
- [ ] Нечётное `#` (`a#b`) — `#` остаётся; импорт не обязан «чинить» строку.
- [ ] Пробелы **снаружи** вырезок триммятся; пробелы только внутри пары уходят вместе с вырезкой.
- [ ] `#…#` в meta (`type`, `column`, `__LIST__` имена) тоже обрабатывается — сломанный meta даёт ошибки импорта или неожиданные имена.
- [ ] В primary-колонке: убедиться, что поиск/джойны ведут себя предсказуемо (сырой ключ vs клипнутое значение).
- [ ] Полноширинный `＃` или другие юникод-«решётки» — **не** должны срабатывать как маркеры (ожидание: остаются как есть).
- [ ] После успешного импорта активировать таблицу и проверить ту же ячейку в UI `/table` и в поиске.

Не путать с UI-усечением длинного текста (тултип/копирование) — это отдельное поведение фронта.

### 3.3. Валидация строк данных

- Пустой ключ + полностью пустые значения → строка **пропускается**.
- Пустой ключ при непустых значениях → **ошибка**.
- Дубликат ключа на одном листе → **ошибка**.
- При merge нескольких real sheets в один virtual: один и тот же ключ на разных листах → **ошибка**.
- Без primary: ключ = склейка всех значений через `\t`.
- `external[...]`: пустой ключ → ошибка.
- Non-set пустой текст после постпроцесса → одиночный пробел `" "`.
- `default[Col]`: пустые custom-ячейки заполняются из default-колонки.
- `set`: разбиение по пробелу и `_`.

### 3.4. BibTeX и `ref[]`

- После импорта ID из колонок `ref[]` сверяются с загруженными статьями.
- Отсутствующие ID → импорт может **завершиться с предупреждением** (`Failed reference checks: …`), не обязательно hard-fail.
- Нет колонки `ref[]` → soft skip message.
- Загрузка bibtex: админка → `PUT /bibtex` (JWT). Дубликаты/битый файл — негативные кейсы.
- Публичный просмотр: `/reference/:article_id` ↔ `GET /article/:id`.

### 3.5. Жизненный цикл версий таблиц (админка)

| Действие | Ожидание |
|----------|----------|
| Импорт | Новая запись: `is_ok=false` пока не успеет, затем ok; **не** active по умолчанию |
| Письмо об ошибке | Тема вида `Creating table <file> failed.` + текст ошибки |
| Письмо об успехе | Уходит после асинхронного завершения (проверить SMTP inbox) |
| Make active | Поиск/metadata начинают отдавать эту версию; кэш поиска обновляется |
| Delete одной | Версия исчезает из списка; если удалили active — проверить поведение поиска |
| Delete all bad | Удаляются только `is_ok=false` |
| Лимит 15 | Кнопка создания скрыта/недоступна при `tables.length >= 15` |
| Без JWT | 401; редирект на `/login` |

После смены active: открыть `/search`, убедиться, что фильтры/autocomplete соответствуют **новой** meta (колонки, show_name, invisible).

---

## 4. Поиск и отображение

### 4.1. Синтаксис запроса (`GET /search?q=`)

Допускаются только имена колонок из metadata и операторы:

`AND`, `IN`, `CONTAINS`, `LIKE`, `=`, `!=`, `<`, `>`, `<=`, `>=`, скобки, запятые, строковые литералы в `'...'`.

Примеры (валидные):

```text
name = 'user'
name IN ('a', 'b') AND surname != 'x'
name LIKE 'prefix%' AND second_name CONTAINS 'token'
name = 'O''Brien'
```

Должны **отклоняться** (инъекции / неизвестные слова) — см. полный разбор в [§5](#5-инъекции-sql--cql):

```text
name = 'x' OR 1=1
name = 'x'; DROP TABLE users; --
1=1
name UNION SELECT ...
```

Пустой `q` → ошибка «search request is required».

Важно для безопасности: прошедший валидатор `q` **подставляется строкой** в `WHERE … ALLOW FILTERING` (не через placeholders). Защита = allowlist-фильтр, не параметризация.

### 4.2. UI-правила после ответа API

- Колонки с `invisible` не показываются в фильтрах/результатах.
- `default[...]` / `clas[...]` — подстановка значений по умолчанию на фронте.
- Ячейка, которая без пробелов равна `NoValue`, очищается до пустой строки.
- SMILES → рендер структуры; переход на `/page/:smiles`.
- Автокомплит: `GET /autocomplete/:column?value=`.
- Дерево (`/tree`): уровни `clas[NN]`; счётчики находок по таксонам согласованы с текущим фильтром.
- Таблица (`/table`): состав колонок = visible meta; длинные ячейки — усечение/тултип/копирование.

### 4.3. Чеклист поиска

- [ ] Metadata грузится (`GET /metadata`) после активации таблицы.
- [ ] Корректный фильтр → строки в таблице и на дереве.
- [ ] Неверный оператор / чужая колонка → понятная ошибка, не 500.
- [ ] Invisible-колонка недоступна в UI и не «утекает» в выдачу как обычное поле.
- [ ] Autocomplete отдаёт префиксы только по indexed/searchable колонкам (по факту данных стенда); отдельно — негативы инъекций из [§5.1](#51-autocomplete--наибольший-риск-публичный-cql).
- [ ] После смены active-таблицы старые фильтры/колонки не «залипают» из кэша дольше ожидаемого TTL (`SEARCH_CACHE_TTL`, дефолт ~5m — учесть при ретестах).

---

## 5. Инъекции SQL / CQL

В проекте две БД с разным риском:

| БД | Где используется | Типичный риск |
|----|------------------|---------------|
| **PostgreSQL** | пользователи / auth | низкий — запросы с `$1` placeholders |
| **Cassandra (CQL)** | поиск, autocomplete, импорт DDL, meta/data | **средний–высокий** — местами `fmt.Sprintf` / конкатенация |

Cassandra редко исполняет «несколько statements через `;`» как классический SQL, но всё равно опасны: **подмена условия WHERE**, чтение чужих колонок, порча DDL при импорте, DoS через `ALLOW FILTERING` / широкий `LIKE`.

Карта опасных путей:

```text
GET /autocomplete/:column?value=  →  SELECT {column} … LIKE '{value}%'     ← конкат, без ValidateRequest
GET /search?q=                    →  ValidateRequest → WHERE {q}           ← конкат после фильтра
POST /create-table (Excel meta)   →  CREATE TABLE / SASI INDEX ({column})  ← идентификаторы из xlsx
Postgres auth / pages / article   →  ? / $1                                ← параметризация
```

### 5.1. Autocomplete — наибольший риск (публичный CQL)

`GET /autocomplete/:column?value=` — **без JWT**, **без** `ValidateRequest`.

Итоговый CQL по сути:

```text
SELECT <column> FROM <active_table_data>
WHERE <column> LIKE '<value>%'
LIMIT 1000
```

И `:column`, и `value` попадают в строку запроса как есть.

**Ожидание при атаке:** 4xx / пустой список / ошибка парсера CQL; **не** полный дамп таблицы, **не** чтение чужих таблиц/keyspace, в теле ошибки по возможности без сырого CQL.

Чеклист:

- [ ] Базовый успех: реальное имя колонки из metadata + обычный префикс → до 1000 подсказок.
- [ ] Пустой `value` → 400.
- [ ] Breakout из LIKE через кавычку, например: `x' OR species LIKE '`, `x%' OR species LIKE '%'`, `x'' OR species LIKE '`.
- [ ] В `value`: `;`, `--`, перевод строки, `%00`, очень длинная строка.
- [ ] `:column` **нет** в metadata: `not_a_column`, `*`, выдуманные идентификаторы.
- [ ] `:column` с фрагментом условия: пробелы, `)`, попытка дописать `WHERE` / `ALLOW FILTERING` / комментарии.
- [ ] URL-кодирование: `%27` (`'`), `%20`, двойное кодирование — поведение как у raw breakout (блок, а не успех).
- [ ] Префикс `%` / широкий паттерн — допустим отказ или нагрузка; зафиксировать timeout/500 vs контролируемый ответ (`LIMIT 1000` — не бесконечная выдача).

Автотестов на autocomplete / `GetPrefix` **нет** — только ручная проверка.

### 5.2. Search `q=` — публичный CQL за фильтром

`GET /search?q=` → `ValidateRequest` → конкатенация в:

```text
SELECT <visible_columns> FROM <active_table_data>
WHERE <q> ALLOW FILTERING
```

Фильтр оставляет только: известные имена колонок из meta, операторы `AND IN CONTAINS LIKE = != < > <= >=`, скобки, запятые, литералы `'...'`. Всё, что остаётся после вырезания — ошибка.

| Уже покрыто unit-тестами (нужен smoke на HTTP) | Слабые места фильтра (давить вручную) |
|-----------------------------------------------|----------------------------------------|
| `OR 1=1`, `UNION`, `; DROP…`, `--`, `SELECT` снаружи кавычек | обход пробелами/табами/переносами |
| неизвестная колонка / пустой `q` | Unicode-пробелы, формы без пробелов вокруг операторов |
| безопасные `LIKE` / `IN` / `O''Brien` | содержимое **внутри** `'...'` фильтром не разбирается |
| | сравнение колонка=колонка (`name = surname`) может пройти фильтр |
| | после злого импорта «разрешённые» имена колонок сами становятся частью allowlist и SELECT |

Чеклист:

- [ ] Корпус из §4.1 и `validator_test.go` через **реальный** `GET /search` → **400** (UserError), не 500 с текстом CQL.
- [ ] Обходы: `name='x'` (без пробелов), табы/newline вокруг `AND`/`=`, Unicode spaces.
- [ ] Внутри кавычек: `name = 'x'' OR name = '''` — либо валидный литерал, либо 400; **не** новые clauses.
- [ ] `OR`, `1=1`, неизвестные идентификаторы → 400.
- [ ] (связка с импортом) если когда-то активировали таблицу с «ломаным» именем колонки — search не должен менять `FROM`/выполнять DDL через SELECT-list.

### 5.3. Импорт Excel → DDL / SASI (CQL, нужен JWT admin)

Имена физических таблиц серверные: `chemdb.{meta,data,species}_<timestamp>` (безопасная нормализация времени).  
**Имена колонок из meta** идут в `CREATE TABLE` / `PRIMARY KEY` / `INSERT` list / `CREATE CUSTOM INDEX … SASI` **без санитизации идентификаторов**.

Значения строк и display-имя таблицы (`name` формы) — в основном через `?` placeholders.

| Вход | Как попадает в CQL | Риск |
|------|-------------------|------|
| meta `column` | идентификатор в DDL/SASI | **высокий** (compromised/trusted admin) |
| meta `type` с SQL-текстом | в DDL тип **принудительно** `TEXT` / `SET<TEXT>` | низкий (unit: DROP из type не попадает в colDefs) |
| form `name` / filename | значение в `chemdb.tables` | низкий (parameterized); физические таблицы не из этой строки |
| description / show_name / ячейки данных | `?` | низкий |

Чеклист (на отдельном стенде, не на прод-данных):

- [ ] Колонка `name'; DROP TABLE users; --` (или с пробелами/кавычками/`x TEXT, y TEXT` / `foo)`) — импорт **падает чисто** или отклоняется; registry `chemdb.tables` и чужие data-таблицы **целы**.
- [ ] `type = text; DROP TABLE chemdb.tables` — импорт может пройти; в схеме только TEXT/SET, без исполнения DROP (согласуется с unit).
- [ ] Колонка с тегом `search` + «ломаным» именем — ошибка SASI без collateral damage.
- [ ] Form `name='; DELETE FROM chemdb.tables; --` — строка сохраняется как имя версии; DROP/CREATE physical tables по-прежнему `*_timestamp`.
- [ ] Успешный импорт странного, но валидного для CQL идентификатора → activate → `/search` и `/autocomplete` с этой колонкой (second-order).

Unit (`import_table_test.go`) документирует: malicious **type** нейтрализуется; malicious **column name** **прокидывается** в colDefs как литерал — на живой Cassandra обязательно руками.

### 5.4. Postgres auth — ожидание «инъекции нет»

`FindByLoginOrEmail` / `UpdatePassword` / `ExistsWithRole` — `$1`, `$2`.

- [ ] Логин `' OR '1'='1`, `admin'--`, длинная строка → обычный fail auth (401/400), не список пользователей и не 500 SQL.
- [ ] То же в email на magic-link / change-password.

Покрыто sqlmock + optional `RUN_INTEGRATION` — ручной smoke достаточен.

### 5.5. Параметризованные CQL (низкий приоритет, smoke)

| Эндпоинт | Привязка | Что проверить |
|----------|----------|---------------|
| `GET /article/:id` | `article_id = ?` | кавычки/`;` в id → miss или hit по ключу, не rewrite WHERE |
| `GET/PUT /pages/:name` | `name = ?` | то же для CQL; отдельно (если в скоупе) path traversal в S3-ключе |
| `POST /make-table-active/:timestamp`, `DELETE /table/:timestamp` | timestamp парсится → REST `?` | битый timestamp → 400; в `DROP TABLE` не попадает сырая строка path |
| `PUT /bibtex` | values через `?` | злые article id как данные; ref-check читает колонку из **meta**, не из HTTP body |

Second-order: если в registry уже лежат отравленные `table_meta` / `table_data` / имена колонок после кривого импорта — delete/bibtex/ref-check могут конкатенировать **доверительные** имена из БД. Имеет смысл после негативного импорта проверить activate/delete/list.

### 5.6. DoS / кэш (смежно)

- Ключ кэша поиска включает полный `q` → много разных валидных запросов раздувают memory cache.
- Autocomplete всегда `LIMIT 1000`, без того же кэша — нагрузка на Cassandra при широких префиксах.

### 5.7. Как фиксировать баг по инъекции

```text
Заголовок: [CQL|SQL inject] поверхность + краткий эффект
Поверхность: autocomplete | search | import DDL | auth | pages | …
Запрос: метод, URL, raw query/body (или xlsx)
Ожидание: 4xx / отказ / нет лишних строк / registry цел
Фактически: статус, фрагмент ответа, побочный эффект (строки, drop, timeout)
Доказательство: до/после SELECT COUNT по контрольной таблице; скрин Network
```

Критерий **fail**: получение данных вне запрошенного префикса/фильтра; изменение/удаление чужих объектов; исполнение DDL из HTTP-параметра; 500 с полным текстом вредоносного CQL при тривиальном вводе (желательно избегать even on reject).

---

## 6. Авторизация

| Сценарий | UI | API | Ожидание |
|----------|----|-----|----------|
| Логин паролем | `/login` | `POST /auth/login` | JWT → `/admin` |
| Неверный пароль / юзер | | | 401/400, сообщение об ошибке |
| Magic-link запрос | login без пароля | `POST /auth/login-mail` | «Mail sent», письмо со ссылкой `{DOMAIN_PREF}/admit/{token}` (`lin…`) |
| Confirm magic-link | `/admit/:code` | `POST /auth/confirm-login-mail` | JWT, вход в админку |
| Сброс пароля | `/reset` → письмо (`psw…`) → admit | change + confirm | новый пароль работает на login |
| Истечение ссылки | | | TTL **1 час** (Redis); повторное использование кода — отказ (one-time) |
| Renew | автоматически (фронт) | `POST /auth/renew-token` | новый JWT при валидной сессии |
| Logout | `/logout` | client-only | токен из localStorage (`auth-token`) очищен, `/admin` недоступен |
| Защищённые методы без токена | | create/list/activate/delete/bibtex/pages PUT/renew | **401** |

Проверить реальный ящик SMTP, не только unit MIME.

---

## 7. Страницы (S3 / MinIO)

| Маршрут | Доступ | Поведение |
|---------|--------|-----------|
| `/about`, контент About | GET публичный | `GET /pages/:name` |
| `/page/:smiles` | GET публичный | markdown вещества |
| Сохранение | admin JWT | `PUT /pages/:name`, лимит **10 000** символов (runes) |

Чеклист:

- [ ] Без S3 — чтение/запись страниц падает предсказуемо.
- [ ] Admin сохраняет About → аноним видит обновление.
- [ ] Контент > 10 000 символов → 400.
- [ ] Markdown с `#` заголовками **не** режется алгоритмом импорта.

---

## 8. Рекомендуемые тест-наборы (приоритизация)

### P0 — дым после деплоя

1. `GET /ping` → 200.  
2. Есть active-таблица → `/search` открывается, metadata не пустая.  
3. Login admin → `/admin` список таблиц.  
4. Простой поиск → таблица + дерево.  
5. About открывается.

### P0 — инъекции CQL (публичные поверхности)

1. Autocomplete (§5.1): breakout `value` / подмена `column` → нет дампа, предпочтительно 4xx.  
2. Search (§5.2): корпус `OR 1=1` / `; DROP` / `UNION` → HTTP 400, не 500 с сырым CQL.

### P1 — импорт, вырезка `#…#`, DDL-инъекции

1. Валидный workbook (meta + `__LIST__` + `main` + `classification`) → success mail, `is_ok=true`.  
2. Активация → поиск видит новые данные.  
3. Ячейки с `#hidden#` / `##` — скрытый текст отсутствует в UI и search.  
4. Негатив: нет `__LIST__` для листа; нет `classification`; duplicate key; пустой key с данными.  
5. `ref[]` с отсутствующим bibtex ID — предупреждение/частичный успех по контракту стенда.  
6. Битый/не xlsx файл → 400 на upload или error mail.  
7. Злые имена колонок / type / form `name` (§5.3) — registry и чужие таблицы целы.

### P2 — auth и админ-операции

Magic-link, reset, 401 на protected, delete bad, лимит 15 таблиц, renew, logout.  
SQL-smoke на login (`' OR '1'='1`) — §5.4.

### P3 — отображение, граничные, «безопасные» эндпоинты

`invisible`, `set` с `_`/пробелами, `default[...]`, `clas[...]` дерево, SMILES→страница, NoValue, функциональный autocomplete, XSS/markdown на pages, большой файл ~10 MB, CORS.  
Smoke article/pages/timestamp (§5.5); нагрузка autocomplete/cache (§5.6).

---

## 9. Карта экранов

| URL | Назначение |
|-----|------------|
| `/` → `/about` | About |
| `/search` | Фильтры |
| `/table` | Результаты |
| `/tree` | Филогенетическое дерево |
| `/page/:smiles` | Описание вещества |
| `/reference/:article_id` | Статья |
| `/login`, `/logout`, `/reset`, `/admit/:code` | Auth |
| `/admin` | Таблицы + bibtex |

Публичные API (без JWT): `/ping`, `/metrics`, `/docs`, `/metadata`, `/autocomplete/:column`, `/search`, `/article/:id`, `/pages/:name`, auth endpoints (кроме renew).

С JWT: `/auth/renew-token`, `/create-table`, `/get-tables-list`, `/make-table-active/:timestamp`, `DELETE /table/:timestamp`, `DELETE /tables`, `PUT /bibtex`, `PUT /pages/:name`.

---

## 10. Что уже закрыто автотестами (меньше ручного повтора)

Имеет смысл **smoke**, а не полный перебор тех же кейсов:

- `RemoveHiden` и применение при чтении xlsx  
- правила validator поиска и отсев SQL-подобных payload (`validator_test.go`) — **без** HTTP/live CQL  
- Postgres: payload логина уходит в args (sqlmock); не заменяет browser smoke  
- import mock: malicious **type** не попадает в colDefs; malicious **column name** наоборот **прокидывается** — на Cassandra проверять руками  
- сценарии auth service + HTTP auth handlers (in-memory mail)  
- import_table на моках (meta, sheets, ref check, external)  
- virtual_sheet postprocess (`set`, `default`, empty→space)  
- bibtex parse + наличие article IDs  
- magic-link store (one-time, expiry) в памяти  

**Не покрыто автотестами (обязательный ручной фокус по security):** autocomplete/`GetPrefix`, HTTP search с Cassandra, живой DDL/SASI из Excel, second-order после activate.

Ручной акцент — **реальный стек**: Cassandra, SMTP, MinIO, браузер, async create-table, смена active, UI дерева/таблицы, §5.

---

## 11. Шаблон баг-репорта (импорт / вырезка)

```text
Заголовок: [Import/#] краткое поведение
Окружение: compose/local, версии таблиц, active timestamp
Шаги:
  1. Файл xlsx (приложить) — лист, ячейка, исходная строка
  2. meta sheet name, table name
  3. Create → письмо / is_ok / activate
  4. Где смотрели результат: UI table / search q=… / API
Фактически: …
Ожидание: по правилам RemoveHiden / meta / __LIST__ …
Вложения: xlsx, скрин, тело письма ошибки
```

---

## 12. Краткая шпаргалка по вырезке

```
"alpha#secret#beta"     → "alphabeta"   (после trim: как есть)
"a##b"                  → "ab"
"only#one"              → "only#one"    (пар нет)
"i# #love# Harry# Potter##" → "ilove Potter"
```

Работает **только при импорте Excel**, для значений ячеек.  
Страницы и markdown — вне этой логики.
