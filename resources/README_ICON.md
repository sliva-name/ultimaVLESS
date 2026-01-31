# Инструкция по созданию иконки приложения

Для отображения логотипа в качестве иконки приложения в Windows необходимо создать файл `logo.ico` из `logo.svg`.

**ВАЖНО:** Иконка должна содержать размер **256x256 пикселей** или больше, иначе electron-builder выдаст ошибку.

## Вариант 1: Онлайн конвертер (рекомендуется)

1. Откройте файл `resources/bin/logo.svg` в браузере
2. Используйте онлайн конвертер SVG в ICO, например:
   - https://convertio.co/svg-ico/
   - https://cloudconvert.com/svg-to-ico
   - https://www.icoconverter.com/
   - https://realfavicongenerator.net/favicon_converter
3. **При конвертации ОБЯЗАТЕЛЬНО выберите размеры:**
   - 16x16
   - 32x32
   - 48x48
   - 64x64
   - 128x128
   - **256x256** (ОБЯЗАТЕЛЬНО!)
   - 512x512 (опционально, для лучшего качества)
4. Сохраните результат как `resources/bin/logo.ico` (замените существующий файл)

## Вариант 2: Использование ImageMagick (если установлен)

```bash
# Создайте ICO файл с размерами, включая обязательный 256x256
magick convert resources/bin/logo.svg -define icon:auto-resize=256,128,64,48,32,16 resources/bin/logo.ico
```

**Проверка размера:**
```bash
magick identify resources/bin/logo.ico
```

Должны быть видны все размеры, включая 256x256.

## Вариант 3: Использование Inkscape + ImageMagick

```bash
# Сначала экспортируйте SVG в PNG разных размеров (ОБЯЗАТЕЛЬНО включая 256x256!)
inkscape resources/bin/logo.svg --export-filename=icon-256.png -w 256 -h 256
inkscape resources/bin/logo.svg --export-filename=icon-128.png -w 128 -h 128
inkscape resources/bin/logo.svg --export-filename=icon-64.png -w 64 -h 64
inkscape resources/bin/logo.svg --export-filename=icon-48.png -w 48 -h 48
inkscape resources/bin/logo.svg --export-filename=icon-32.png -w 32 -h 32
inkscape resources/bin/logo.svg --export-filename=icon-16.png -w 16 -h 16

# Затем объедините в ICO (256x256 должен быть включен!)
magick convert icon-16.png icon-32.png icon-48.png icon-64.png icon-128.png icon-256.png resources/bin/logo.ico

# Удалите временные PNG файлы
rm icon-*.png
```

## Проверка иконки

После создания файла `resources/bin/logo.ico`, проверьте, что он содержит размер 256x256:

**Windows:**
- Откройте свойства файла `logo.ico`
- Во вкладке "Подробно" должны быть видны все размеры

**ImageMagick:**
```bash
magick identify resources/bin/logo.ico
```

Должны быть видны все размеры, включая **256x256**.

После создания правильного файла `resources/bin/logo.ico`, иконка будет автоматически использоваться при сборке приложения.

