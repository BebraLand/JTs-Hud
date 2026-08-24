# Aerial Camera Capture

Отдельный companion tool для ручной калибровки CS2 Aerial camera anchors.

Он не читает память CS2, не использует DLL/hooks и не меняет основной Auto Director. Aerial использует уже установленный JTs-Hud CS2 GSI config для чтения текущей карты, а координаты камеры читаются и применяются через локальный CS2 NetCon/Telnet.

## Запуск

Из корня репозитория:

```bash
npm run aerial:app
```

Для CS2 нужен launch option:

```text
-netconport 2020
```

JTs-Hud должен быть запущен, потому что именно его listener принимает установленный GSI config на:

```text
http://localhost:23415/cs2/input
```

JTs-Hud принимает POST `/cs2/input`, хранит последний payload и предоставляет read-only GET `/cs2/state` для Aerial. Aerial не открывает собственный GSI listener и не имеет отдельной настройки GSI port.

## Рабочий порядок

Инструмент ограничен текущим BebraLand MAT active map pool:

```text
de_ancient
de_anubis
de_cache
de_dust2
de_inferno
de_mirage
de_nuke
de_overpass
```

Vertigo намеренно не включён: в MAT active pool используется Cache.

Для каждой карты:

1. Запусти JTs-Hud и убедись, что его GSI listener работает на `127.0.0.1:23415`.
2. Запусти Aerial.
3. Открой локальный demo или observer-сессию в CS2.
4. Проверь Telnet host `127.0.0.1` и port `2020`.
5. Дай Aerial определить карту через **Read map from JTs-Hud GSI**.
6. В CS2 поставь камеру в широкую и читаемую позицию.
7. Выбери anchor слева.
8. Добавь заметку, если нужно объяснить композицию.
9. Нажми **Capture current position**.
10. Повтори для обязательных точек и optional route/post-plant points.
11. Нажми **Teleport to this anchor**, чтобы вернуться к уже сохранённой точке и перепроверить композицию.
12. Нажми **Export verified JSON**.

Все capture, notes и custom anchors сохраняются в durable draft внутри Electron `userData` и переживают перезапуск приложения. Browser `localStorage` остаётся резервным fallback. После перезапуска уже записанные anchors снова видны в списке.

Кнопка **Read map from JTs-Hud GSI** читает последний payload из `GET http://127.0.0.1:23415/cs2/state`. Если JTs-Hud не запущен или CS2 ещё не отправил GSI, Aerial показывает диагностическую ошибку и позволяет выбрать карту вручную. Telnet `status` для определения карты не используется, потому что некоторые режимы CS2 возвращают там только `game`.

## Обязательные точки первой версии

```text
T Spawn
CT Spawn
Mid
A Site
B Site
```

Рекомендуемые дополнительные anchors:

```text
A Main / Approach
B Main / Approach
Long
Short
A Post-plant
B Post-plant
Map Wide Overview
```

Если у карты нет настоящих Long или Short, можно оставить точку пустой или добавить map-specific custom anchor.

## Проверка качества

Приложение блокирует verified export, если у текущей карты отсутствует обязательный anchor или в координатах есть нечисловое значение. Экспорт собирает все сохранённые карты в один bundle.

После того как manifest будет готов, его можно проверить отдельным geometry/topology validator. В репозитории уже есть advisory visibility-заготовка: она принимает сохранённые `position + angles` камеры и позиции игроков из replay/GSI и для каждого anchor вычисляет:

- находится ли игрок внутри FOV камеры;
- есть ли static-geometry LOS к нескольким body points;
- виден ли игрок фактически, а не только находится ли он по направлению камеры;
- расстояние, alignment и first intersection distance;
- причину `visible`, `occluded`, `outside-frustum`, `dead` или `missing-position`.

Это позволяет иметь несколько камер на одном site и позже выбирать ту, которая действительно показывает plant/entry/retake. Smoke, dynamic doors, breakables и временная игровая окклюзия не считаются доказанными static geometry, поэтому слой остаётся advisory и не переключает камеру напрямую.

Полная проверка будет смотреть:

- находится ли anchor в границах карты;
- не внутри ли он solid geometry;
- есть ли свободное направление взгляда;
- не дублирует ли он соседний anchor;
- видны ли нужные site/portal areas;
- подходит ли он для wide, route или post-plant shot.

## Формат результата

Приложение экспортирует один универсальный файл для всех карт:

```text
jts-aerial-anchors.json
```

Формат bundle имеет `schemaVersion: 2` и содержит map manifests внутри `maps`:

```json
{
  "schemaVersion": 2,
  "coordinateSystem": "source2-hammer-units",
  "source": "cs2-netcon-getpos",
  "maps": {
    "de_ancient": { "schemaVersion": 1, "map": "de_ancient", "anchors": {} },
    "de_dust2": { "schemaVersion": 1, "map": "de_dust2", "anchors": {} }
  }
}
```

Внутри каждого map manifest сохраняются:

- canonical map name;
- Source 2 Hammer unit coordinate system;
- position `[x, y, z]`;
- angles `[pitch, yaw, roll]`;
- anchor kind;
- required/optional status;
- notes;
- capture timestamp;
- source marker `cs2-netcon-getpos`.

Import поддерживает и старый одиночный v1 файл, и новый bundle v2. При импорте bundle все карты записываются обратно в локальные drafts, поэтому после одного Import JSON доступны сразу Ancient, Dust2 и остальные сохранённые карты. Bundle будет входом для будущего Aerial runtime и отдельного HLAE path layer.
