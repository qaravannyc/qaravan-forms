// Default question sets, Russian first, English below — the QARAVAN pattern.
// If an event's row in monday has custom questions, those replace ALL of q1–q4.
// The photo block and the "want to lead" block always stay: they are the system.

export const attendeeQuestions = {
  ru: {
    title: (event) => `Как вам «${event}»?`,
    intro: "Пара минут — и волонтёры, которые провели это событие, узнают, что оно значило для людей.",
    q1: { type: "stars", label: "Как вам событие?", required: true },
    q2: { type: "text", label: "Что понравилось больше всего?", hint: "Ваши слова мы передадим волонтёрам, которые это провели.", required: false },
    q3: { type: "text", label: "Что сделать лучше в следующий раз?", required: false },
    q4: { type: "choice", label: "Как вы узнали об этом событии?", options: ["Instagram", "Partiful", "От друзей", "Telegram", "Сайт qaravan.org", "Другое"], required: false },
    photoAsk: { label: "Есть фото или видео с события?", yes: "Да, поделюсь", no: "Нет" },
    photoUpload: "Загрузите фото или видео",
    consent: "Разрешаю QARAVAN использовать эти фото и видео в соцсетях и материалах организации",
    credit: "Как вас подписать? (необязательно)",
    leadAsk: { label: "Хотели бы вы сами провести одно из событий?", hint: "Можно пропустить.", options: ["Да", "Может быть", "Пока нет"] },
    leadInterest: "Что было бы интересно провести?",
    submit: "Отправить",
    thanks: "Спасибо! Ваши слова дойдут до тех, кто это провёл.",
  },
  en: {
    title: (event) => `How was “${event}”?`,
    intro: "Two minutes, and the volunteers who ran this event will know what it meant to people.",
    q1: { type: "stars", label: "How was the event?", required: true },
    q2: { type: "text", label: "What did you like most?", hint: "We pass your words to the volunteers who ran it.", required: false },
    q3: { type: "text", label: "What should we do better next time?", required: false },
    q4: { type: "choice", label: "How did you hear about this event?", options: ["Instagram", "Partiful", "From friends", "Telegram", "qaravan.org", "Other"], required: false },
    photoAsk: { label: "Do you have photos or videos from the event?", yes: "Yes, I'll share", no: "No" },
    photoUpload: "Upload photos or videos",
    consent: "I allow QARAVAN to use these photos and videos in its social media and materials",
    credit: "How should we credit you? (optional)",
    leadAsk: { label: "Would you like to lead one of our events yourself?", hint: "You can skip this.", options: ["Yes", "Maybe", "Not yet"] },
    leadInterest: "What would you enjoy leading?",
    submit: "Send",
    thanks: "Thank you! Your words will reach the people who ran it.",
  },
};

export const leadQuestions = {
  ru: {
    title: (event) => `«${event}» — как всё прошло?`,
    intro: "Пять коротких вопросов. Ваши ответы помогают нам поддерживать волонтёров лучше.",
    q1: { type: "number", label: "Сколько человек пришло?", required: true },
    q2: { type: "stars_text", label: "Как всё прошло для вас?", required: false },
    q3: { type: "text", label: "Хватило ли поддержки от QARAVAN? Что помогло бы в следующий раз?", required: false },
    q4: { type: "text", label: "Что-то мешало — люди, место, техника?", required: false },
    q5: { type: "text", label: "Кто или что помогло провести событие лучше?", required: false },
    submit: "Отправить",
    thanks: "Спасибо, что провели это событие. Число участников уже в таблице.",
  },
  en: {
    title: (event) => `“${event}” — how did it go?`,
    intro: "Five short questions. Your answers help us support volunteers better.",
    q1: { type: "number", label: "How many people came?", required: true },
    q2: { type: "stars_text", label: "How did it go for you?", required: false },
    q3: { type: "text", label: "Did you get enough support from QARAVAN? What would help next time?", required: false },
    q4: { type: "text", label: "Did anything get in the way — people, venue, tech?", required: false },
    q5: { type: "text", label: "Who or what helped you run it better?", required: false },
    submit: "Send",
    thanks: "Thank you for running this event. The headcount is already in the board.",
  },
};
