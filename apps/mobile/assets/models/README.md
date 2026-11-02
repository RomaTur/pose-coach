# MoveNet SinglePose Lightning

`movenet-lightning-int8.tflite` — неизменённая модель Google, версия 4.

- [Официальный источник](https://tfhub.dev/google/lite-model/movenet/singlepose/lightning/tflite/int8/4?lite-format=tflite).
- [Карточка модели Google](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf).
- Размер: 2 894 840 байт; идентификатор FlatBuffer: `TFL3`.
- SHA-256: `cd7cc22fa946e5d146a7b98d496853e1923e22828d3972d579973f27f91bb105`.
- Лицензия модели: Apache-2.0, **не** MIT приложения; полный текст в `LICENSE-APACHE-2.0.txt`.

Авторы модели: Francois Beletti, Yu-Hui Chen, Ard Oerlemans, Ronny Votel (Google).
Модель предназначена для оценки 17 ключевых точек одного человека, а не медицинской
оценки техники или идентификации личности. При низкой уверенности приложение
должно скрывать точки и прекращать счёт незавершённого повторения.

Заявленные Google показатели скорости не являются измерениями Pose Coach.
Формат входа конкретного TFLite-артефакта нужно проверять при загрузке:
название `int8` не означает, что входной тензор обязательно имеет знаковый тип.
