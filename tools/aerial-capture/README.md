# Aerial Camera Capture

Отдельный companion tool для ручной калибровки CS2 Aerial camera anchors.

Он не читает память CS2, не использует DLL/hooks и не меняет основной Auto Director. Единственный источник координат, `getpos` через локальный CS2 NetCon/Telnet.

## Запуск

Из корня репозитория:

```bash
npm run aerial:app
```

Для CS2 нужен launch option:

```text
-netconport 2020
```

Открой локальный demo или observer-сессию и вручную выбери карту в приложении. Aerial не требует запущенный JTs-Hud и не зависит от GSI. Поставь камеру в нужную точку и нажми **Capture current position**.

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

1. Выбери карту в приложении.
2. Проверь host `127.0.0.1` и port `2020`.
3. В CS2 поставь камеру в широкую и читаемую позицию.
4. Выбери anchor слева.
5. Добавь заметку, если нужно объяснить композицию.
6. Нажми **Capture current position**.
7. Повтори для обязательных точек.
8. Добавь optional route/post-plant points.
9. Нажми **Teleport to this anchor**, чтобы вернуться к уже сохранённой точке и перепроверить композицию.
10. Нажми **Export verified JSON**.

Все capture, notes и custom anchors сохраняются в durable draft внутри Electron `userData` и переживают перезапуск приложения. Browser `localStorage` остаётся резервным fallback. После перезапуска уже записанные anchors снова видны в списке.

Кнопка **Try read map from CS2 status** является только необязательной диагностикой. Некоторые режимы CS2 возвращают в `status` только `game`, без имени карты. Это не блокирует capture или teleport: выбранная в приложении карта считается картой текущего manifest.

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

Приложение блокирует verified export, если отсутствует обязательный anchor или в координатах есть нечисловое значение.

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

Приложение экспортирует один файл вида:

```text
de_ancient.aerial.json
```

Внутри сохраняются:

- canonical map name;
- Source 2 Hammer unit coordinate system;
- position `[x, y, z]`;
- angles `[pitch, yaw, roll]`;
- anchor kind;
- required/optional status;
- notes;
- capture timestamp;
- source marker `cs2-netcon-getpos`.

Это будет входом для будущего Aerial runtime и отдельного HLAE path layer.
