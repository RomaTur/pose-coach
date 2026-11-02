# Источники визуальных материалов

Этот реестр относится к поставляемым файлам, а не ко всем ресурсам установленных
зависимостей. Лицензия MIT исходного кода Pose Coach не меняет лицензии сторонних
изображений, модели и библиотек.

## Ресурсы шаблона Expo

Источник — официальный [expo-template-default, каталог assets](https://github.com/expo/expo/tree/96069ceb532ac43894f26fa393623daae850835c/templates/expo-template-default/assets)
в зафиксированной ревизии Expo. В [package.json этой же ревизии](https://github.com/expo/expo/blob/96069ceb532ac43894f26fa393623daae850835c/templates/expo-template-default/package.json)
шаблон объявляет лицензию **0BSD**. Ресурсы оставлены без изменений; это стандартные
иконки и splash шаблона, не самостоятельный брендинг Pose Coach и не заявление
о принадлежности знаков Expo проекту.

Сверка 2026-10-30: Git blob-идентификаторы каждого локального файла совпали с
соответствующими файлами публичного дерева Expo. Это подтверждает происхождение
и отсутствие изменений относительно указанной ревизии, но не является аудитом
всего содержимого репозитория или гарантией отсутствия любых приватных данных.

| Файл в Pose Coach | Файл внутри upstream `assets/` | Назначение и права |
|---|---|---|
| `apps/mobile/assets/images/android-icon-background.png` | `images/android-icon-background.png` | Фон Android-иконки; шаблон Expo, 0BSD |
| `apps/mobile/assets/images/android-icon-foreground.png` | `images/android-icon-foreground.png` | Передний слой Android-иконки; шаблон Expo, 0BSD |
| `apps/mobile/assets/images/android-icon-monochrome.png` | `images/android-icon-monochrome.png` | Монохромный слой Android-иконки; шаблон Expo, 0BSD |
| `apps/mobile/assets/images/favicon.png` | `images/favicon.png` | Иконка web-шаблона; шаблон Expo, 0BSD |
| `apps/mobile/assets/images/icon.png` | `images/icon.png` | Иконка приложения; шаблон Expo, 0BSD |
| `apps/mobile/assets/images/splash-icon.png` | `images/splash-icon.png` | Изображение splash; шаблон Expo, 0BSD |
| `apps/mobile/assets/expo.icon/Assets/grid.png` | `expo.icon/Assets/grid.png` | Растровый слой Icon Composer; шаблон Expo, 0BSD |
| `apps/mobile/assets/expo.icon/Assets/expo-symbol 2.svg` | `expo.icon/Assets/expo-symbol 2.svg` | Векторный слой Icon Composer; шаблон Expo, 0BSD |
| `apps/mobile/assets/expo.icon/icon.json` | `expo.icon/icon.json` | Конфигурация слоёв Icon Composer; шаблон Expo, 0BSD |

Наличие Android/web-ресурсов в шаблоне не означает, что эти платформы прошли
приёмку Pose Coach. Текущий проверяемый сценарий — iOS.

## Снимки приложения

| Файл | Происхождение | Что можно и нельзя заключить |
|---|---|---|
| `docs/screenshots/demo-paused.png` | Захват работающего Pose Coach 2026-10-29; iPhone 17 Pro Simulator, iOS 26.3.1 | Синтетический demo-подход на паузе, не живая камера |
| `docs/screenshots/demo-history.png` | Захват того же приложения и окружения 2026-10-29 | Сохранённый синтетический результат в отдельном разделе истории, не результат ML |

Снимки не ретушированы; данные демонстрационные, не записи пользователя.
Это исторические кадры: они **предшествуют UI-исправлениям 2026-10-30** и не
подтверждают вид или работу текущей сборки. Поверх экрана видна шестерёнка Expo
development client; она не является частью интерфейса Pose Coach. Сторонние
элементы на снимках не становятся собственными знаками проекта.

## Не изображения интерфейса

MoveNet — модель, а не визуальный ресурс. Её отдельная Apache-2.0, источник и
SHA-256 приведены в [README модели](../apps/mobile/assets/models/README.md).
Скелет рисуется из координат программно; в demo используются явно маркированные
синтетические точки, а не фотография или сгенерированный снимок человека.
