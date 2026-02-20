/**
 * https://github.com/cvzi/telegram-bot-cloudflare
 */

const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather https://core.telegram.org/bots#6-botfather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -

// ⚙️ Video Engine Configuration
const ENGINE_BASE_URL = typeof ENV_ENGINE_URL !== 'undefined' ? ENV_ENGINE_URL : 'http://localhost:3000'
const ENGINE_SECRET = typeof ENV_ENGINE_SECRET !== 'undefined' ? ENV_ENGINE_SECRET : SECRET

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/callback') {
    event.respondWith(handleEngineCallback(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook(event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle callbacks from Video Engine
 */
async function handleEngineCallback(event) {
  const data = await event.request.json()
  const jobId = data.id
  const status = data.status
  const chatId = data.payload?.meta?.chat_id

  if (!chatId) return new Response('Missing chat_id', { status: 400 })

  if (status === 'done') {
    const videoUrl = data.result?.url
    const thumbUrl = data.result?.thumbnailUrl

    let message = `✅ *Video Selesai!* (ID: \`${jobId}\`)\n\n`
    if (videoUrl) {
      // Try to send the video directly
      const videoResult = await sendVideo(chatId, videoUrl, `Video Anda sudah siap! (ID: ${jobId})`)
      if (!videoResult.ok) {
        // Fallback to link if direct send fails (e.g. too big for Telegram to fetch)
        message += `🎬 [Klik di sini untuk menonton/download](${videoUrl})`
        await sendMarkdownV2Text(chatId, escapeMarkdown(message, '[]()'))
      }
    } else {
      message += `⚠️ Video berhasil dibuat tapi URL tidak ditemukan.`
      await sendMarkdownV2Text(chatId, escapeMarkdown(message, '[]()'))
    }
  } else if (status === 'failed') {
    const error = data.error || 'Terjadi kesalahan sistem'
    await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal Merender Video*\n\nError: \`${error}\``, '`'))
  }

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * supports messages and callback queries (inline button presses)
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message)
  }
  if ('callback_query' in update) {
    await onCallbackQuery(update.callback_query)
  }
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook(event) {
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Send a video via URL
 * https://core.telegram.org/bots/api#sendvideo
 */
async function sendVideo(chatId, videoUrl, caption = '') {
  return (await fetch(apiUrl('sendVideo', {
    chat_id: chatId,
    video: videoUrl,
    caption
  }))).json()
}

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl(methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText(chatId, text) {
  return (await fetch(apiUrl('sendMessage', {
    chat_id: chatId,
    text
  }))).json()
}

/**
 * Send text message formatted with MarkdownV2-style
 * Keep in mind that any markdown characters _*[]()~`>#+-=|{}.! that
 * are not part of your formatting must be escaped. Incorrectly escaped
 * messages will not be sent. See escapeMarkdown()
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendMarkdownV2Text(chatId, text) {
  return (await fetch(apiUrl('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2'
  }))).json()
}

/**
 * Escape string for use in MarkdownV2-style text
 * if `except` is provided, it should be a string of characters to not escape
 * https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdown(str, except = '') {
  const all = '_*[]()~`>#+-=|{}.!\\'.split('').filter(c => !except.includes(c))
  const regExSpecial = '^$*+?.()|{}[]\\'
  const regEx = new RegExp('[' + all.map(c => (regExSpecial.includes(c) ? '\\' + c : c)).join('') + ']', 'gim')
  return str.replace(regEx, '\\$&')
}

/**
 * Send a message with a single button
 * `button` must be an button-object like `{ text: 'Button', callback_data: 'data'}`
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendInlineButton(chatId, text, button) {
  return sendInlineButtonRow(chatId, text, [button])
}

/**
 * Send a message with buttons, `buttonRow` must be an array of button objects
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendInlineButtonRow(chatId, text, buttonRow) {
  return sendInlineButtons(chatId, text, [buttonRow])
}

/**
 * Send a message with buttons, `buttons` must be an array of arrays of button objects
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendInlineButtons(chatId, text, buttons) {
  return (await fetch(apiUrl('sendMessage', {
    chat_id: chatId,
    reply_markup: JSON.stringify({
      inline_keyboard: buttons
    }),
    text
  }))).json()
}

/**
 * Answer callback query (inline button press)
 * This stops the loading indicator on the button and optionally shows a message
 * https://core.telegram.org/bots/api#answercallbackquery
 */
async function answerCallbackQuery(callbackQueryId, text = null) {
  const data = {
    callback_query_id: callbackQueryId
  }
  if (text) {
    data.text = text
  }
  return (await fetch(apiUrl('answerCallbackQuery', data))).json()
}

/**
 * Handle incoming callback_query (inline button press)
 * https://core.telegram.org/bots/api#message
 */
async function onCallbackQuery(callbackQuery) {
  await sendMarkdownV2Text(callbackQuery.message.chat.id, escapeMarkdown(`You pressed the button with data=\`${callbackQuery.data}\``, '`'))
  return answerCallbackQuery(callbackQuery.id, 'Button press acknowledged!')
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
function onMessage(message) {
  if (message.text.startsWith('/start') || message.text.startsWith('/help')) {
    return sendMarkdownV2Text(message.chat.id, '*Functions:*\n' +
      escapeMarkdown(
        '/markdown - Sends some MarkdownV2 examples\n' +
        '/generate [prompt] - Buat video AI otomatis',
        '`'))
  } else if (message.text.startsWith('/generate')) {
    const prompt = message.text.replace('/generate', '').trim()
    if (!prompt) {
      return sendMarkdownV2Text(message.chat.id, 'Silakan masukkan prompt. Contoh: `/generate Keindahan pegunungan`')
    }
    return startVideoGeneration(message.chat.id, prompt)
  } else if (message.text.startsWith('/button2')) {
    return sendTwoButtons(message.chat.id)
  } else if (message.text.startsWith('/button4')) {
    return sendFourButtons(message.chat.id)
  } else if (message.text.startsWith('/markdown')) {
    return sendMarkdownExample(message.chat.id)
  } else {
    return sendMarkdownV2Text(message.chat.id, escapeMarkdown('*Unknown command:* `' + message.text + '`\n' +
      'Use /help to see available commands.', '*`'))
  }
}

function sendTwoButtons(chatId) {
  return sendInlineButtonRow(chatId, 'Press one of the two button', [{
    text: 'Button One',
    callback_data: 'data_1'
  }, {
    text: 'Button Two',
    callback_data: 'data_2'
  }])
}

function sendFourButtons(chatId) {
  return sendInlineButtons(chatId, 'Press a button', [
    [
      {
        text: 'Button top left',
        callback_data: 'Utah'
      }, {
        text: 'Button top right',
        callback_data: 'Colorado'
      }
    ],
    [
      {
        text: 'Button bottom left',
        callback_data: 'Arizona'
      }, {
        text: 'Button bottom right',
        callback_data: 'New Mexico'
      }
    ]
  ])
}

async function sendMarkdownExample(chatId) {
  await sendMarkdownV2Text(chatId, 'This is *bold* and this is _italic_')
  await sendMarkdownV2Text(chatId, escapeMarkdown('You can write it like this: *bold* and _italic_'))
  return sendMarkdownV2Text(chatId, escapeMarkdown('...but users may write ** and __ e.g. `**bold**` and `__italic__`', '`'))
}

/**
 * Call Video Engine API
 */
async function startVideoGeneration(chatId, prompt) {
  await sendMarkdownV2Text(chatId, `🚀 *Memulai Produksi Video AI...*\nTopik: \`${escapeMarkdown(prompt)}\` \n\nMohon tunggu ya, sedang mencari aset dan narasi...`)

  // Prepare Payload
  const payload = {
    mode: 'composition',
    webhook_url: `${ENGINE_BASE_URL.replace('localhost', 'YOUR_TUNNEL_DOMAIN')}/callback`, // Note: User needs to update this
    composition: {
      template_id: 'aesthetic_vlog',
      output_format: 'shorts',
      meta: { chat_id: chatId },
      clips: [
        { query: prompt, duration: 5 }
      ],
      voice_over: {
        text: prompt, // Simple use for now
        voice: 'tnSpp4vdxKPjI9w0GnoV',
        word_highlight: true
      },
      template_overrides: {
        audio_ducking: true
      }
    }
  }

  try {
    const res = await fetch(`${ENGINE_BASE_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const result = await res.json()
    if (res.ok) {
      await sendMarkdownV2Text(chatId, escapeMarkdown(`✅ *Job Diterima!*\nJob ID: \`${result.id}\`\nStatus: \`${result.status}\`\n\nBot akan memberi tahu Anda jika sudah selesai.`))
    } else {
      throw new Error(result.error || 'Gagal membuat job')
    }
  } catch (err) {
    await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Error API Video Engine:*\n${err.message}`))
  }
}
